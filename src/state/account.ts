/**
 * Le compte et ce qui s'ouvre autour de lui : la connexion, l'offre Premium, le profil. Rien
 * n'est enregistré ici : la session vit dans un cookie que seul le serveur lit, et l'état
 * du compte se redemande à `/api/me` à chaque ouverture.
 */
import { create } from 'zustand';
import {
  canAlert,
  createAlert,
  deleteAlert,
  listAlerts,
  pauseAlert,
  placeOf,
  selectionOf,
  updateAlert,
  type Alert,
  type AlertPlace,
  type AlertSettings,
} from '../data/alerts';
import { api, ApiError } from '../data/api';
import { loadBeaches, loadSpots } from '../data/places';
import { forgetPush, refreshPush } from '../data/push';
import { startSync, stopSync } from '../data/sync';
import { formatCoord, type Units } from '../lib/units';
import { mapApi } from '../map/api';
import { authCall, authClient } from './auth-client';
import type { DayStep, DayView, Selection, ThemeChoice } from './store';
import { useStore } from './store';

/** Les préférences gardées dans le compte : les mêmes champs que le store. */
export interface SyncedPreferences {
  units: Units;
  theme: ThemeChoice;
  dayView: DayView;
  dayStep: DayStep;
  reopenLast: boolean;
}

export type Plan = 'monthly' | 'yearly';

/** L'abonnement, tel que le serveur le recopie de Stripe. Montants en centimes, dates ISO 8601. */
export interface SubscriptionInfo {
  /** Les cinq états de la carte d'abonnement du profil. */
  state: 'free' | 'trial' | 'premium' | 'failed' | 'canceled';
  plan: Plan | null;
  amount: number | null;
  currency: string | null;
  trialEnd: string | null;
  trialDays: number;
  /** Prochain prélèvement, ou fin de Premium quand l'abonnement est résilié. */
  periodEnd: string | null;
  card: { brand: string; last4: string } | null;
  paymentFailedAt: string | null;
  paymentFailedAmount: number | null;
  /** Paiement refusé : jusqu'à quand Premium reste ouvert. */
  activeUntil: string | null;
  /**
   * L'essai gratuit a déjà servi à cette personne. `null` : le serveur ne le sait pas (Stripe
   * n'a pas répondu à temps) ; l'appli ne lance alors pas le paiement toute seule.
   */
  trialUsed: boolean | null;
}

export interface Me {
  id: string;
  email: string;
  /** Date de création du compte, ISO 8601. */
  createdAt: string;
  premium: boolean;
  subscription: SubscriptionInfo;
  preferences: SyncedPreferences | null;
  alertCount: number;
}

/** Favoris de la version gratuite. Ceux déjà enregistrés au-delà sont gardés ; le suivant ouvre l'offre. */
export const FREE_FAVORITES = 3;

/** Action à reprendre une fois connecté. Au retour de Google, elle revient dans l'adresse (`?reprise=`). */
export type Resume = { action: 'profile' } | { action: 'trial'; plan: Plan };

const PLAN_WORD: Record<Plan, string> = { yearly: 'annuel', monthly: 'mensuel' };
const planOf = (word: string | null): Plan | null => (word === 'annuel' ? 'yearly' : word === 'mensuel' ? 'monthly' : null);

const encodeResume = (resume: Resume): string => (resume.action === 'trial' ? `offre:${PLAN_WORD[resume.plan]}` : 'profil');

function decodeResume(value: string | null): Resume | null {
  if (value === 'profil') return { action: 'profile' };
  const plan = value?.startsWith('offre:') ? planOf(value.slice(6)) : null;
  return plan ? { action: 'trial', plan } : null;
}

/** Ce qui s'affiche par-dessus l'appli : fenêtre sur ordinateur, feuille sur téléphone. */
export type Overlay =
  | { kind: 'signin'; resume: Resume; email?: string; notice?: string }
  /** L'étape du code. `code` : rempli par le lien de l'email ; il attend alors que la personne touche « Me connecter ». */
  | { kind: 'sent'; resume: Resume; email: string; code?: string }
  | { kind: 'delete' }
  /**
   * L'offre Premium. `start` : la session Checkout s'ouvre tout de suite (retour d'un lien de
   * connexion). `notice` : ce qui vient de l'ouvrir, quand ce n'est pas un verrou touché.
   */
  | { kind: 'offer'; plan: Plan; start?: boolean; notice?: string }
  /** Retour de Stripe : `waiting` tant que le droit Premium n'est pas arrivé, `late` s'il tarde. */
  | { kind: 'welcome'; phase: 'waiting' | 'ready' | 'late' };

/** Ce qui prend la place du panneau d'un point (une feuille sur téléphone). */
export type Side =
  | { kind: 'profile' }
  /** « Mes alertes ». */
  | { kind: 'alerts' }
  /** « Nouvelle alerte » sur un lieu, ou l'alerte à modifier. `place` suit le lieu choisi sur la carte. */
  | { kind: 'alert'; place: AlertPlace | null; alert: Alert | null };

interface AccountState {
  /** `loading` tant que `/api/me` n'a pas répondu. */
  status: 'loading' | 'guest' | 'signed';
  me: Me | null;
  overlay: Overlay | null;
  /** Panneau ouvert à la place de celui d'un point. */
  side: Side | null;
  /** Les alertes du compte ; `null` tant qu'elles ne sont pas lues (ou sans Premium). */
  alerts: Alert[] | null;
}

export const useAccount = create<AccountState>()(() => ({
  status: 'loading',
  me: null,
  overlay: null,
  side: null,
  alerts: null,
}));

/** Le compte a-t-il Premium ? Faux pour un visiteur. */
export const usePremium = (): boolean => useAccount((s) => s.me?.premium ?? false);
const isPremium = (): boolean => useAccount.getState().me?.premium ?? false;

/** Le lieu d'une alerte : le nom du spot, sinon ses coordonnées. */
const alertPlace = (selection: Selection): AlertPlace => placeOf(selection, formatCoord(selection.lat, selection.lon));

// Choisir un lieu referme le profil et « Mes alertes » : le panneau du point reprend sa place.
// Formulaire d'alerte ouvert : le lieu choisi (par « Changer », ou sur la carte) devient celui de l'alerte.
useStore.subscribe((s, p) => {
  if (!s.selection || s.selection === p.selection) return;
  const { side } = useAccount.getState();
  if (side?.kind === 'alert' && canAlert(s.selection)) useAccount.setState({ side: { ...side, place: alertPlace(s.selection) } });
  else useAccount.setState({ side: null });
});

export const closeOverlay = (): void => useAccount.setState({ overlay: null });
export const closeSide = (): void => useAccount.setState({ side: null });
export const openProfile = (): void => useAccount.setState({ side: { kind: 'profile' } });
export const toggleProfile = (): void => useAccount.setState((s) => ({ side: s.side?.kind === 'profile' ? null : { kind: 'profile' } }));

export function openSignIn(resume: Resume = { action: 'profile' }, options: { email?: string; notice?: string } = {}): void {
  useAccount.setState({ overlay: { kind: 'signin', resume, ...options } });
}

export const openDeleteAccount = (): void => useAccount.setState({ overlay: { kind: 'delete' } });

/** L'offre Premium : chaque verrou y mène (jours au-delà de la version gratuite, cloche, alerte d'une bouée, 4e favori). */
export const openOffer = (plan: Plan = 'yearly'): void => useAccount.setState({ overlay: { kind: 'offer', plan } });

/** Ce que dit l'offre quand le compte gratuit n'a pas pris tous les favoris d'un appareil. */
const FAVORITES_NOTICE = 'Le compte gratuit garde 3 favoris. Avec Premium, tous vos favoris vous suivent.';

/**
 * L'offre ouverte par la synchronisation des favoris, pas par un geste : elle ne remplace pas
 * une autre fenêtre déjà ouverte (bienvenue, suppression du compte), et complète l'offre si
 * c'est elle qui l'est.
 */
function offerFromSync(reason?: 'merge'): void {
  const { overlay } = useAccount.getState();
  if (overlay && overlay.kind !== 'offer') return;
  useAccount.setState({ overlay: { kind: 'offer', plan: 'yearly', ...overlay, ...(reason === 'merge' ? { notice: FAVORITES_NOTICE } : {}) } });
}

let providers: Promise<{ google: boolean }> | null = null;

/**
 * Les moyens de connexion branchés sur le serveur (`GET /api/auth/providers`) : lus une fois, à la première
 * ouverture de la connexion, puis gardés en mémoire. Si la demande échoue, Google passe pour absent : son
 * bouton reste caché.
 */
export function loadProviders(): Promise<{ google: boolean }> {
  providers ??= api<{ google?: unknown }>('/api/auth/providers').then(
    (p) => ({ google: p?.google === true }),
    () => ({ google: false }),
  );
  return providers;
}

/*
 * Better-Auth répond par un code d'erreur, en anglais : voici les phrases de l'appli pour chacun, sinon pour
 * le statut. Un code usé par trois essais ratés est mort, comme un code expiré : il en faut un autre.
 */
const SEND_ERRORS = {
  INVALID_EMAIL: 'Demande invalide.',
  429: 'Trop de demandes de lien depuis cette connexion. Réessayez dans une heure.',
};
const CODE_ERRORS = {
  INVALID_OTP: 'Ce code n’est pas le bon.',
  OTP_EXPIRED: 'Ce code ne marche plus. Demandez un nouveau lien.',
  TOO_MANY_ATTEMPTS: 'Ce code ne marche plus. Demandez un nouveau lien.',
  429: 'Trop d’essais depuis cette connexion. Réessayez dans une heure.',
};
/** Les refus qu'écrit le serveur d'Aywhoula, avec leur phrase : plafonds d'envoi, email qui ne part pas. */
const SERVER_ERRORS = ['ADDRESS_LIMIT', 'SITE_LIMIT', 'EMAIL_FAILED'];

const sameAddress = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Le compte de cette adresse est-il connecté ici ? */
export function signedInAs(email: string): boolean {
  const { me } = useAccount.getState();
  return me !== null && sameAddress(me.email, email);
}

/**
 * La connexion en cours : l'adresse et l'action à reprendre, gardées dans le navigateur le temps de vie du
 * code (15 minutes). Le lien de l'email peut s'ouvrir dans un autre onglet du même appareil : c'est là qu'il
 * retrouve quoi reprendre. Rien du compte lui-même n'est enregistré, et l'adresse n'y reste pas : elle est
 * effacée à la connexion, ou à la première ouverture de l'appli passé ce délai.
 */
const PENDING_KEY = 'aywhoula:connexion';
const PENDING_MS = 15 * 60_000;

function rememberSignIn(email: string, resume: Resume): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ email: email.trim().toLowerCase(), resume: encodeResume(resume), at: Date.now() }));
  } catch {
    // Stockage refusé : le lien de l'email ouvrira le profil.
  }
}

function forgetSignIn(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Rien à oublier.
  }
}

/** La connexion en cours, si elle a moins de 15 minutes. Périmée ou illisible, elle est effacée. */
function pendingSignIn(): { email: string; resume: Resume | null } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as { email?: unknown; resume?: unknown; at?: unknown } | null;
    if (saved === null) return null;
    if (typeof saved.email === 'string' && typeof saved.at === 'number' && Math.abs(Date.now() - saved.at) <= PENDING_MS) {
      return { email: saved.email, resume: decodeResume(typeof saved.resume === 'string' ? saved.resume : null) };
    }
  } catch {
    // Illisible : effacée comme une connexion périmée.
  }
  forgetSignIn();
  return null;
}

/** L'action que la connexion de cette adresse devait reprendre, si elle a été demandée ici il y a moins de 15 minutes. */
function pendingResume(email: string): Resume | null {
  const pending = pendingSignIn();
  return pending && sameAddress(pending.email, email) ? pending.resume : null;
}

/** Demande le code de connexion, puis montre « Vérifiez votre boîte mail ». */
export async function requestLoginLink(email: string, resume: Resume): Promise<void> {
  await authCall(authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' }), SEND_ERRORS, SERVER_ERRORS);
  rememberSignIn(email, resume);
  useAccount.setState({ overlay: { kind: 'sent', resume, email } });
}

/**
 * Le code à 6 chiffres de l'email, saisi ici ou rempli par son lien : il ouvre la session dans cette
 * appli même, puis reprend l'action en cours. Sur iPhone, le lien s'ouvre dans Safari, dont les cookies
 * ne sont pas ceux de l'appli installée : le code saisi est le chemin qui la connecte.
 */
export async function signInWithCode(email: string, code: string, resume: Resume): Promise<void> {
  await authCall(authClient.signIn.emailOtp({ email, otp: code }), CODE_ERRORS);
  forgetSignIn();
  await refreshAccount();
  useAccount.setState({ overlay: null });
  runResume(resume);
}

/**
 * « Continuer avec Google » : le navigateur part chez Google. Au retour, l'appli lit `?reprise=…` (connecté,
 * avec l'action à reprendre) ou `?connexion=google` (le parcours n'a pas abouti).
 */
export async function signInWithGoogle(resume: Resume): Promise<void> {
  const callbackURL = `/?${new URLSearchParams({ reprise: encodeResume(resume) })}`;
  // Un refus du serveur se dit comme le retour d'un parcours qui a échoué.
  await authCall(authClient.signIn.social({ provider: 'google', callbackURL, errorCallbackURL: '/?connexion=google' }), { default: NOTICES.google });
}

/**
 * Le serveur dit autre chose que ce que l'appli croit du droit Premium : 402 `premium`
 * (l'appli le croyait ouvert) ou 409 `already_premium` (elle le croyait absent). L'appli
 * redemande l'état du compte, puis refait la demande, qui se relit alors avec le bon droit.
 */
const disagrees = (err: unknown): boolean => err instanceof ApiError && (err.premium || err.code === 'already_premium');

async function agreed<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (err) {
    if (!disagrees(err)) throw err;
    await refreshAccount();
    return request();
  }
}

/** À appeler quand une demande faite ailleurs que dans ce fichier échoue : vrai si le compte a été redemandé. */
export async function reconcile(err: unknown): Promise<boolean> {
  if (!disagrees(err)) return false;
  await refreshAccount();
  return true;
}

/**
 * « Commencer l'essai gratuit » : la connexion si besoin, puis la page de paiement de Stripe.
 * L'appli ne voit jamais la carte bancaire.
 */
export async function startCheckout(plan: Plan): Promise<void> {
  if (useAccount.getState().status !== 'signed') {
    openSignIn({ action: 'trial', plan });
    return;
  }
  try {
    await agreed(async () => {
      // Déjà abonné (le serveur vient de le dire, ou l'appli le savait) : le profil dit où en est l'abonnement.
      if (isPremium()) {
        useAccount.setState({ overlay: null, side: { kind: 'profile' } });
        return;
      }
      const { url } = await api<{ url: string }>('/api/billing/checkout', { json: { plan } });
      window.location.assign(url);
    });
  } catch (err) {
    // Un abonnement existe déjà et attend un paiement : il ne s'en ouvre pas un second, celui-là
    // se règle (ou se résilie) dans le portail de Stripe.
    if (!(err instanceof ApiError) || err.code !== 'subscription_pending') throw err;
    await openPortal();
  }
}

/** Le portail client de Stripe : formule, carte, factures, résiliation, reprise. */
export async function openPortal(): Promise<void> {
  const { url } = await api<{ url: string }>('/api/billing/portal', { method: 'POST' });
  window.location.assign(url);
}

/* -------------------------------------------------------------------- alertes */

/** Relit les alertes du compte. Sans Premium, il n'y en a pas à montrer. */
export async function loadAlerts(): Promise<void> {
  try {
    await agreed(async () => {
      if (!isPremium()) {
        useAccount.setState({ alerts: null });
        return;
      }
      useAccount.setState({ alerts: await listAlerts() });
    });
  } catch {
    // Les alertes déjà lues restent affichées ; le panneau redemandera.
  }
}

/** « Mes alertes ». En version gratuite, l'offre. */
export function openAlerts(): void {
  if (!isPremium()) {
    openOffer();
    return;
  }
  useAccount.setState({ side: { kind: 'alerts' } });
  void loadAlerts();
}

/**
 * « Nouvelle alerte » sur le lieu sélectionné (ou sans lieu : le formulaire demande d'en
 * choisir un). En version gratuite, la cloche ouvre l'offre.
 */
export function newAlert(selection: Selection | null = useStore.getState().selection): void {
  if (!isPremium()) {
    openOffer();
    return;
  }
  useAccount.setState({ side: { kind: 'alert', place: selection && canAlert(selection) ? alertPlace(selection) : null, alert: null } });
}

/** Rouvre une alerte dans le formulaire, et amène son lieu à l'écran. */
export function editAlert(alert: Alert): void {
  useAccount.setState({ side: { kind: 'alert', place: alert.place, alert } });
  useStore.getState().select(selectionOf(alert.place));
  mapApi.focus(alert.place.lon, alert.place.lat, 10);
}

function replaceAlert(alert: Alert): void {
  useAccount.setState((s) => {
    const list = s.alerts ?? [];
    return { alerts: list.some((a) => a.id === alert.id) ? list.map((a) => (a.id === alert.id ? alert : a)) : [...list, alert] };
  });
}

/** Enregistre une alerte, nouvelle ou modifiée, puis revient à « Mes alertes ». */
export async function saveAlert(settings: AlertSettings, id: string | null): Promise<void> {
  replaceAlert(await agreed(() => (id ? updateAlert(id, settings) : createAlert(settings))));
  useAccount.setState({ side: { kind: 'alerts' } });
}

export async function setAlertPaused(id: string, paused: boolean): Promise<void> {
  replaceAlert(await agreed(() => pauseAlert(id, paused)));
}

export async function removeAlert(id: string): Promise<void> {
  await agreed(() => deleteAlert(id));
  useAccount.setState((s) => ({ alerts: s.alerts?.filter((a) => a.id !== id) ?? null, side: { kind: 'alerts' } }));
}

/* -------------------------------------------------------------------- favoris */

/**
 * Ajoute ou retire un favori. En version gratuite, on en garde 3 : ajouter le suivant
 * ouvre l'offre. Retirer reste toujours possible.
 */
export function toggleFavorite(place: Selection): void {
  const { favorites, toggleFavorite: toggle } = useStore.getState();
  const adding = !favorites.some((f) => f.id === place.id);
  if (adding && !isPremium() && favorites.length >= FREE_FAVORITES) {
    openOffer();
    return;
  }
  toggle(place);
}

let lastCheck = 0;

/**
 * Redemande l'état du compte. Connecté : le fuseau du navigateur part au serveur, et la
 * synchronisation des favoris et des préférences démarre. Renvoie vrai si une session existe.
 */
export async function refreshAccount(): Promise<boolean> {
  lastCheck = Date.now();
  let me: Me;
  try {
    me = await api<Me>('/api/me');
  } catch (err) {
    // 401 : pas de session. Toute autre erreur (réseau, serveur) laisse l'état tel qu'il est,
    // sauf au tout premier passage, où l'appli se comporte comme pour un visiteur.
    if (useAccount.getState().status === 'loading' || (err instanceof ApiError && err.status === 401)) {
      stopSync();
      useAccount.setState({ status: 'guest', me: null });
    }
    return false;
  }
  const previous = useAccount.getState();
  // Un compte arrive : à la première réponse connectée, ou parce que ce n'est plus celui d'avant (le lien d'un
  // email de connexion ouvert ici pour une autre adresse). Ses alertes et sa synchronisation repartent de zéro.
  const arrived = previous.status !== 'signed' || previous.me?.id !== me.id;
  useAccount.setState({ status: 'signed', me, ...(arrived ? { alerts: null } : {}) });
  if (arrived) {
    void api('/api/me/timezone', { method: 'PUT', json: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }).catch(() => undefined);
    void startSync(me, SYNC_HOOKS);
    // L'abonnement aux notifications de cet appareil suit le compte connecté.
    void refreshPush();
  } else if (me.premium && !previous.me?.premium) {
    // Premium vient d'arriver : les favoris qu'une fusion s'était vu refuser partent maintenant.
    void startSync(me, SYNC_HOOKS);
  }
  if (me.premium && useAccount.getState().alerts === null) void loadAlerts();
  if (!me.premium) {
    // Premium s'est arrêté : les alertes et leurs panneaux se referment, l'offre reprend sa place aux verrous.
    const { side } = useAccount.getState();
    useAccount.setState({ alerts: null, ...(side && side.kind !== 'profile' ? { side: null } : {}) });
  }
  return true;
}

/** Ce que fait la synchronisation quand le serveur refuse un favori : redemander le compte, puis montrer l'offre. */
const SYNC_HOOKS = { refresh: refreshAccount, offer: offerFromSync, premium: isPremium };

export async function signOut(): Promise<void> {
  // Avant de fermer la session : cet appareil ne doit plus recevoir les alertes du compte.
  await forgetPush();
  await authCall(authClient.signOut());
  stopSync();
  useStore.getState().setSyncedAccount(null);
  useAccount.setState({ status: 'guest', me: null, overlay: null, alerts: null });
}

export async function deleteAccount(): Promise<void> {
  await api('/api/me', { method: 'DELETE' });
  stopSync();
  useStore.getState().setSyncedAccount(null);
  useAccount.setState({ status: 'guest', me: null, overlay: null, alerts: null });
}

const COORDS = /^(-?[0-9]+(?:[.][0-9]+)?),(-?[0-9]+(?:[.][0-9]+)?)$/;

/**
 * Lien profond des notifications et des emails d'alerte : `?lieu=<identifiant ou lat,lng>`
 * ouvre le panneau du point, `&heure=<ISO 8601>` amène la carte et le panneau au début du créneau.
 */
async function openPlaceLink(place: string, hour: string | null): Promise<void> {
  const time = hour ? Date.parse(hour) : NaN;
  // Posée avant que la ligne de temps soit connue : le contrôleur de la carte la garde si elle est dans sa portée.
  if (Number.isFinite(time)) useStore.getState().setTime(time);

  let selection: Selection | null = null;
  const coords = COORDS.exec(place);
  if (coords) {
    const lat = Number(coords[1]);
    const lon = Number(coords[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) selection = { kind: 'point', id: `point:${lat.toFixed(3)},${lon.toFixed(3)}`, name: '', lat, lon };
  } else {
    // Un identifiant : parmi les favoris, les alertes du compte, puis les fichiers de spots et de plages.
    const favorite = useStore.getState().favorites.find((f) => f.id === place);
    const alert = useAccount.getState().alerts?.find((a) => a.place.id === place);
    if (favorite) selection = favorite;
    else if (alert) selection = selectionOf(alert.place);
    else {
      const [spots, beaches] = await Promise.all([loadSpots().catch(() => []), loadBeaches().catch(() => [])]);
      const found = spots.find((p) => p.id === place) ?? beaches.find((p) => p.id === place);
      if (found) selection = { kind: found.kind === 'spot' ? 'spot' : 'beach', id: found.id, name: found.name, lat: found.lat, lon: found.lon };
    }
  }
  if (!selection) return;
  useStore.getState().select(selection);
  mapApi.focus(selection.lon, selection.lat, 10);
}

function runResume(resume: Resume): void {
  if (resume.action === 'profile' || isPremium()) {
    openProfile();
    return;
  }
  // La connexion demandée depuis l'offre mène droit au paiement tant que l'essai est à prendre :
  // rien n'est prélevé avant sept jours. Un compte qui a déjà eu son essai serait prélevé tout
  // de suite : l'offre se rouvre (« S'abonner ») et attend le clic. Elle attend aussi quand le
  // serveur ne sait pas (`null`) : le paiement ne part tout seul que sur un « non » certain.
  const trialUsed = useAccount.getState().me?.subscription.trialUsed;
  useAccount.setState({ overlay: { kind: 'offer', plan: resume.plan, start: trialUsed === false } });
}

/** Redemande le compte toutes les `every` ms jusqu'à ce que Premium soit là, `during` ms au plus. */
async function pollPremium(every: number, during: number): Promise<void> {
  const deadline = Date.now() + during;
  while (!isPremium() && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, every));
    await refreshAccount();
  }
}

/**
 * Retour de Stripe Checkout. Le droit Premium arrive par un webhook, quelques instants après
 * la redirection : on redemande le compte toutes les 1,5 seconde pendant 20 secondes. S'il
 * tarde, l'écran dit « Presque prêt », et l'appli continue de demander toutes les 5 secondes
 * pendant 2 minutes : Premium s'ouvre tout seul dès que le webhook est passé.
 */
async function awaitPremium(): Promise<void> {
  // La fenêtre a pu être refermée entre-temps : on n'en rouvre pas une.
  const show = (phase: 'ready' | 'late'): void => {
    if (useAccount.getState().overlay?.kind === 'welcome') useAccount.setState({ overlay: { kind: 'welcome', phase } });
  };
  useAccount.setState({ overlay: { kind: 'welcome', phase: 'waiting' } });
  await pollPremium(1500, 20_000);
  if (!isPremium()) {
    show('late');
    await pollPremium(5000, 120_000);
  }
  if (isPremium()) show('ready');
}

const NOTICES = {
  google: 'La connexion avec Google n’a pas abouti. Réessayez, ou recevez un lien par email.',
  'google-email': 'Google n’a pas confirmé cette adresse email. Recevez plutôt un lien par email.',
};

/** Les codes d'erreur de Better-Auth qui veulent dire « Google n'a pas confirmé cette adresse ». */
const UNCONFIRMED = ['email_not_verified', 'account_not_linked'];

/** Ce que porte le lien de l'email de connexion : l'adresse, et son code s'il est lisible. */
interface LoginLink {
  email: string;
  code: string | null;
}

/**
 * Lit `connexion` et `code` là où le lien de l'email les porte : dans le fragment de l'adresse, ou dans sa
 * chaîne de requête pour un lien envoyé sous l'ancienne forme. Seule une adresse email fait un lien :
 * tout autre `connexion=` est un retour de Google qui a échoué. L'adresse est montrée telle quelle avant
 * tout geste : rien qui porte une espace ou plus d'un `@` n'est pris pour une adresse, un lien fabriqué n'y
 * glisse pas une phrase.
 */
function loginLinkOf(params: URLSearchParams): LoginLink | null {
  const email = params.get('connexion');
  const code = params.get('code');
  return email && email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email) ? { email, code: code && /^[0-9]{6}$/.test(code) ? code : null } : null;
}

/**
 * Le lien de l'email, pris dans le fragment de l'adresse (`#connexion=<adresse>&code=<code>`). Le navigateur
 * n'envoie un fragment à aucun serveur, ni dans une requête, ni dans un en-tête `Referer`. Lu, il est aussitôt
 * retiré de la barre d'adresse et de l'historique. `null` : le fragment ne porte pas de lien de connexion.
 */
function takeHashLink(): LoginLink | null {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.slice(1));
  if (!params.has('connexion')) return null;
  window.history.replaceState(null, '', url.pathname + url.search);
  return loginLinkOf(params);
}

/**
 * Ouvre ce que demande le lien de l'email : l'étape du code, adresse et code remplis, où la personne lit avec
 * quelle adresse elle va se connecter avant de toucher « Me connecter ». Rien ne part d'ici.
 */
function openLoginLink(link: LoginLink): void {
  if (signedInAs(link.email)) {
    // Ce compte est déjà connecté ici (le code a servi dans un autre onglet) : il ne reste qu'à reprendre.
    const pending = pendingResume(link.email);
    forgetSignIn();
    runResume(pending ?? { action: 'profile' });
    return;
  }
  const pending = pendingResume(link.email) ?? { action: 'profile' };
  // Sans code lisible, on repart de l'adresse.
  if (link.code) useAccount.setState({ overlay: { kind: 'sent', resume: pending, email: link.email, code: link.code } });
  else openSignIn(pending, { email: link.email });
}

/**
 * À l'ouverture de l'appli : lit les paramètres d'adresse qui concernent le compte, les
 * retire de l'adresse, demande l'état du compte, puis ouvre ce qui était demandé.
 *
 * - `?compte` : la connexion pour un visiteur, le profil sinon ;
 * - `?panneau=profil` : le profil ;
 * - `?offre=annuel` ou `?offre=mensuel` (liens de la vitrine) : l'offre, avec ce choix ;
 * - `?premium=bienvenue` et `?premium=offre` : les retours de Stripe, paiement fait ou abandonné ;
 * - `?reprise=…` : retour de Google, connecté, avec l'action à reprendre ;
 * - `?connexion=google` (et `&error=…`, de Better-Auth) : un parcours Google qui n'a pas abouti ;
 * - `#connexion=<adresse>&code=<code>` : le lien de l'email de connexion, dans le fragment de l'adresse, que le
 *   navigateur n'envoie à aucun serveur. Il ouvre l'étape du code, adresse et code remplis : rien ne part tant
 *   que la personne n'a pas touché « Me connecter ». Un lien envoyé sous l'ancienne forme,
 *   `?connexion=<adresse>&code=<code>`, se lit de la même façon ;
 * - `?panneau=alertes` et `?panneau=alerte` : « Mes alertes » et « Nouvelle alerte » ;
 * - `?lieu=…&heure=…` : le lien profond d'une notification ou d'un email d'alerte.
 */
export async function startAccount(): Promise<void> {
  // Le lien de l'email d'abord : son fragment quitte la barre d'adresse avant toute autre lecture.
  const hashLink = takeHashLink();
  const url = new URL(window.location.href);
  const q = url.searchParams;
  const wantsAccount = q.has('compte');
  const panel = q.get('panneau');
  const wantsProfile = panel === 'profil';
  const place = q.get('lieu');
  const hour = q.get('heure');
  const offer = q.has('offre') ? (planOf(q.get('offre')) ?? 'yearly') : null;
  const stripeReturn = q.get('premium');
  const resume = decodeResume(q.get('reprise'));
  const connexion = q.get('connexion');
  // Un lien envoyé sous l'ancienne forme porte l'adresse et le code dans la chaîne de requête.
  const queryLink = loginLinkOf(q);
  const link = hashLink ?? queryLink;
  const notice = connexion && !queryLink ? NOTICES[UNCONFIRMED.includes(q.get('error') ?? '') ? 'google-email' : 'google'] : null;
  // Avec `connexion` partent son code et ce que Better-Auth ajoute à un retour en erreur.
  const handled = ['compte', 'panneau', 'offre', 'premium', 'session_id', 'reprise', 'connexion', 'lieu', 'heure', ...(connexion === null ? [] : ['code', 'error', 'error_description'])].filter((key) => q.has(key));
  if (handled.length > 0) {
    for (const key of handled) q.delete(key);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  // Une connexion en cours restée là plus de 15 minutes s'efface à cette lecture.
  pendingSignIn();

  const signed = await refreshAccount();
  if (link) openLoginLink(link);
  else if (notice && !signed) openSignIn({ action: 'profile' }, { notice });
  else if (stripeReturn === 'bienvenue' && signed) void awaitPremium();
  else if (resume && signed) runResume(resume);
  else if (offer || stripeReturn === 'offre') {
    // Déjà abonné : l'offre n'a plus rien à proposer, le profil dit où en est l'abonnement.
    if (isPremium()) openProfile();
    else openOffer(offer ?? 'yearly');
  } else if (wantsProfile || (wantsAccount && signed)) openProfile();
  else if (wantsAccount) openSignIn();
  // Les alertes : pour un abonné, le panneau ; sinon l'offre, après la connexion s'il le faut.
  else if (panel === 'alertes' || panel === 'alerte') {
    if (isPremium()) {
      await loadAlerts();
      if (panel === 'alerte') newAlert();
      else openAlerts();
    } else if (signed) openOffer();
    else openSignIn();
  }
  if (place) void openPlaceLink(place, hour);

  // La connexion revient. L'appli ouverte hors ligne se tient pour un visiteur, faute de réponse
  // de `/api/me` ; si l'appareil est rattaché à un compte, on le redemande : la session est
  // peut-être toujours là, et ce qui a été fait hors ligne peut partir.
  window.addEventListener('online', () => {
    if (useAccount.getState().status === 'guest' && useStore.getState().syncedAccount) void refreshAccount();
  });

  // Le lien de l'email ouvert là où l'appli l'est déjà (l'appli installée qui reprend le lien, ou le lien collé
  // dans la barre d'adresse) : seul le fragment change, la page ne se recharge pas.
  window.addEventListener('hashchange', () => {
    const arrived = takeHashLink();
    if (arrived) openLoginLink(arrived);
  });

  // Au retour sur l'onglet, le compte a pu changer ailleurs (autre onglet, autre appareil, portail Stripe) :
  // on le redemande, et avec lui ses favoris et ses préférences.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 5 * 60_000) return;
    void refreshAccount().then(() => {
      const { me } = useAccount.getState();
      if (me) void startSync(me, SYNC_HOOKS);
    });
  });
}
