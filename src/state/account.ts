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

/** Action à reprendre une fois connecté : le lien de connexion la ramène dans l'adresse (`?reprise=`). */
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
  | { kind: 'sent'; resume: Resume; email: string }
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

/** Adresse du parcours Google, avec l'action à reprendre au retour. */
export const googleSignInUrl = (resume: Resume): string => `/api/auth/google?${new URLSearchParams({ resume: encodeResume(resume) })}`;

/** Demande le lien de connexion, puis montre « Vérifiez votre boîte mail ». */
export async function requestLoginLink(email: string, resume: Resume): Promise<void> {
  await api('/api/auth/email', { json: { email, resume: encodeResume(resume) } });
  useAccount.setState({ overlay: { kind: 'sent', resume, email } });
}

/**
 * Le code à 6 chiffres reçu dans le même email, saisi ici : il ouvre la session dans cette
 * appli même, puis reprend l'action en cours. Sur iPhone, le lien s'ouvre dans Safari, dont
 * les cookies ne sont pas ceux de l'appli installée : le code est le chemin qui la connecte.
 */
export async function signInWithCode(email: string, code: string): Promise<void> {
  const { resume } = await api<{ resume: string | null }>('/api/auth/email/code', { json: { email, code } });
  await refreshAccount();
  useAccount.setState({ overlay: null });
  const action = decodeResume(resume);
  if (action) runResume(action);
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
  const wasSigned = previous.status === 'signed';
  useAccount.setState({ status: 'signed', me });
  if (!wasSigned) {
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
  await api('/api/auth/logout', { method: 'POST' });
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

const NOTICES: Record<string, string> = {
  expire: 'Ce lien a expiré ou a déjà servi. Demandez-en un nouveau.',
  google: 'La connexion avec Google n’a pas abouti. Réessayez, ou recevez un lien par email.',
  'google-email': 'Google n’a pas confirmé cette adresse email. Recevez plutôt un lien par email.',
};

/**
 * À l'ouverture de l'appli : lit les paramètres d'adresse qui concernent le compte, les
 * retire de l'adresse, demande l'état du compte, puis ouvre ce qui était demandé.
 *
 * - `?compte` : la connexion pour un visiteur, le profil sinon ;
 * - `?panneau=profil` : le profil ;
 * - `?offre=annuel` ou `?offre=mensuel` (liens de la vitrine) : l'offre, avec ce choix ;
 * - `?premium=bienvenue` et `?premium=offre` : les retours de Stripe, paiement fait ou abandonné ;
 * - `?reprise=…` : retour d'un lien de connexion, avec l'action à reprendre ;
 * - `?connexion=…` : un lien expiré ou un parcours Google qui n'a pas abouti ;
 * - `?panneau=alertes` et `?panneau=alerte` : « Mes alertes » et « Nouvelle alerte » ;
 * - `?lieu=…&heure=…` : le lien profond d'une notification ou d'un email d'alerte.
 */
export async function startAccount(): Promise<void> {
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
  const notice = NOTICES[q.get('connexion') ?? ''];
  const handled = ['compte', 'panneau', 'offre', 'premium', 'session_id', 'reprise', 'connexion', 'lieu', 'heure'].filter((key) => q.has(key));
  if (handled.length > 0) {
    for (const key of handled) q.delete(key);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  const signed = await refreshAccount();
  if (notice && !signed) openSignIn({ action: 'profile' }, { notice });
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
