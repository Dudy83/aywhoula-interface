/**
 * Synchronisation des favoris et des préférences (unités, thème, vue du jour) avec le compte.
 *
 * Au premier passage connecté sur un appareil, ses favoris et ceux du compte sont réunis
 * (union par identifiant) et les préférences du compte, s'il en a, remplacent celles de
 * l'appareil. L'appareil n'est rattaché au compte (`syncedAccount`) qu'une fois cette fusion
 * reçue par le serveur : si elle échoue, elle se refait au passage suivant.
 *
 * Ensuite le compte fait foi, mais rien de ce qui a été fait ici ne se perd : chaque ajout
 * ou retrait de favori et chaque préférence changée sont notés dans `unsent` (enregistré
 * dans le navigateur) tant que le compte ne les a pas reçus. Avant chaque envoi, la liste du
 * compte est relue et ces changements y sont rejoués : ceux faits entre-temps sur un autre
 * appareil ne sont pas écrasés, ceux faits ici hors ligne ne sont pas oubliés.
 *
 * Un compte gratuit garde 3 favoris, et ne dépasse ce nombre que par une seule fusion. Quand
 * il refuse une fusion (premier passage d'un autre appareil, import de l'ancienne origine),
 * l'appareil garde ce qui tient et l'offre s'ouvre ; les favoris refusés restent notés dans
 * `unsent.refused`, et partent dès que le compte passe en Premium. Si l'appareil quitte ce
 * compte avant (déconnexion, suppression, connexion d'un autre compte), ils reviennent dans
 * ses favoris.
 *
 * Pour un visiteur, rien ne quitte l'appareil.
 */
import type { Me, SyncedPreferences } from '../state/account';
import {
  hasUnsentFavorites,
  journalFavorites,
  NOTHING_UNSENT,
  replayFavorites,
  sanitizeFavorites,
  sanitizePreferences,
  useStore,
  type PreferenceField,
  type Selection,
  type Unsent,
} from '../state/store';
import { api, ApiError } from './api';

/** Délai après le dernier changement avant l'envoi : une rafale de clics ne fait qu'une requête. */
const PUSH_DELAY = 600;
/** Favoris de la version gratuite (comme `FREE_FAVORITES` du compte et du serveur). */
const FREE_FAVORITES = 3;

export interface SyncHooks {
  /** Le serveur refuse ce que l'appli croyait permis : elle redemande l'état du compte. */
  refresh: () => Promise<unknown>;
  /**
   * L'offre. `merge` : le compte gratuit n'a pas pris tous les favoris d'une fusion. Sans
   * raison : un favori de plus que la version gratuite n'en garde.
   */
  offer: (reason?: 'merge') => void;
  /** Le compte a-t-il Premium, d'après ce que l'appli en sait à l'instant ? */
  premium: () => boolean;
}

let unsubscribe: (() => void) | null = null;
let timer = 0;
/** Incrémenté à chaque démarrage ou arrêt : une réponse d'un passage précédent est ignorée. */
let generation = 0;
/** Le compte en cours de synchronisation, et ce que l'appli fait quand le serveur refuse. */
let account: string | null = null;
let hooks: SyncHooks | null = null;
/** Un passage à la fois : celui qui tourne, et s'il faut en refaire un après lui. */
let running: Promise<void> | null = null;
let again = false;

const wire = (favorites: Selection[]): Selection[] =>
  favorites.map((f) => ({ id: f.id, kind: f.kind, name: f.name, lat: f.lat, lon: f.lon, ...(f.detail ? { detail: f.detail } : {}) }));

const sameList = (a: Selection[], b: Selection[]): boolean => JSON.stringify(wire(a)) === JSON.stringify(wire(b));

/** La liste `a`, suivie des lieux de `b` qu'elle n'a pas. */
function union(a: Selection[], b: Selection[]): Selection[] {
  const known = new Set(a.map((f) => f.id));
  return [...a, ...b.filter((f) => !known.has(f.id))];
}

const preferencesOf = (): SyncedPreferences => {
  const { units, theme, dayView, dayStep, reopenLast } = useStore.getState();
  return { units: { wind: units.wind, height: units.height, temp: units.temp }, theme, dayView, dayStep, reopenLast };
};

/** La valeur d'un champ de préférence. */
function field(p: SyncedPreferences, name: PreferenceField): string {
  switch (name) {
    case 'theme':
      return p.theme;
    case 'dayView':
      return p.dayView;
    case 'dayStep':
      return p.dayStep;
    case 'reopenLast':
      return String(p.reopenLast);
    default:
      return p.units[name];
  }
}

/** Les préférences `base`, avec les champs `fields` pris dans `from`. */
function withFields(base: SyncedPreferences, from: SyncedPreferences, fields: PreferenceField[]): SyncedPreferences {
  const pick = <T,>(name: PreferenceField, mine: T, theirs: T): T => (fields.includes(name) ? mine : theirs);
  return {
    units: {
      wind: pick('wind', from.units.wind, base.units.wind),
      height: pick('height', from.units.height, base.units.height),
      temp: pick('temp', from.units.temp, base.units.temp),
    },
    theme: pick('theme', from.theme, base.theme),
    dayView: pick('dayView', from.dayView, base.dayView),
    dayStep: pick('dayStep', from.dayStep, base.dayStep),
    reopenLast: pick('reopenLast', from.reopenLast, base.reopenLast),
  };
}

const samePreferences = (a: SyncedPreferences, b: SyncedPreferences): boolean =>
  (['wind', 'height', 'temp', 'theme', 'dayView', 'dayStep', 'reopenLast'] as const).every((name) => field(a, name) === field(b, name));

/** Envoie la liste au compte. `refused` : le serveur n'en veut pas (402, la limite de la version gratuite). */
async function putFavorites(favorites: Selection[], merge: boolean): Promise<'ok' | 'refused' | 'failed'> {
  try {
    await api('/api/me/favorites', { method: 'PUT', json: merge ? { favorites: wire(favorites), merge: true } : { favorites: wire(favorites) } });
    return 'ok';
  } catch (err) {
    return err instanceof ApiError && err.premium ? 'refused' : 'failed';
  }
}

/** Ce que la version gratuite garde d'une fusion refusée : les favoris du compte d'abord, puis ceux de l'appareil tant qu'il reste de la place. */
function fit(kept: Selection[], wanted: Selection[]): Selection[] {
  if (kept.length >= FREE_FAVORITES) return kept;
  return union(kept, wanted).slice(0, FREE_FAVORITES);
}

/**
 * Les favoris : relit ceux du compte, y joint ce que l'appareil a de son côté (tous ses
 * favoris au premier passage, ses changements non envoyés ensuite), puis envoie le résultat.
 */
async function syncFavorites(accountId: string, run: number): Promise<void> {
  let remote: Selection[];
  try {
    remote = sanitizeFavorites((await api<{ favorites: unknown }>('/api/me/favorites')).favorites);
  } catch {
    return;
  }
  if (run !== generation) return;

  const before = useStore.getState();
  const first = before.syncedAccount !== accountId;
  // Ce qu'une fusion s'est vu refuser attend dans `refused`. Premium n'a pas de limite : dès
  // que le compte l'a, ces favoris repartent avec les autres ajouts.
  const parked = first ? [] : before.unsent.refused;
  const resend = parked.length > 0 && (hooks?.premium() ?? false);
  const journal: Unsent = resend
    ? { ...before.unsent, added: union(before.unsent.added, parked.filter((f) => !before.unsent.removed.includes(f.id))), refused: [] }
    : before.unsent;
  const merge = first || journal.merge;
  let wanted = first ? union(remote, before.favorites) : replayFavorites(remote, journal);
  let refused = first ? [] : journal.refused;
  // L'appareil montre tout de suite la liste réunie ; le journal ne bouge pas tant que rien n'est parti.
  if (!sameList(wanted, before.favorites)) useStore.setState({ favorites: wanted });
  /** La liste que l'appareil montre pendant ce passage : ce qui change ensuite vient de la personne. */
  let shown = wanted;

  if (!sameList(wanted, remote)) {
    let outcome = await putFavorites(wanted, merge);
    if (run !== generation) return;
    if (outcome === 'refused') {
      // Le serveur n'accorde pas ce que l'appli croyait permis (Premium terminé, fusion déjà
      // faite) : elle se remet d'accord avec lui, puis refait la demande avec ce que la
      // version gratuite garde. Le compte fait foi.
      await hooks?.refresh();
      if (run !== generation) return;
      const now = useStore.getState();
      const gone = first ? [] : now.unsent.removed;
      const kept = remote.filter((f) => !gone.includes(f.id));
      const asked = wanted.filter((f) => !gone.includes(f.id));
      if (merge) {
        // Une fusion, au premier passage comme pour un import : on garde ce qui tient, et le
        // reste attend Premium dans `refused`.
        wanted = fit(kept, asked);
        const fits = new Set(wanted.map((f) => f.id));
        refused = union(parked, asked.filter((f) => !fits.has(f.id)));
      } else {
        // Un favori de plus que la version gratuite n'en garde : il n'est pas pris.
        wanted = kept;
        refused = parked;
      }
      // Au premier passage, l'appareil n'est pas encore rattaché au compte : rien n'est écrit
      // avant que le compte ait reçu la liste, pour que la fusion puisse se refaire en entier.
      if (!first) {
        useStore.setState({ favorites: wanted, unsent: { ...now.unsent, added: [], merge: false, refused } });
        shown = wanted;
      }
      outcome = sameList(wanted, remote) ? 'ok' : await putFavorites(wanted, false);
      if (run !== generation) return;
      // L'offre : avec son message quand des favoris d'une fusion n'ont pas été pris.
      if (outcome === 'ok' && (!merge || refused.length > parked.length)) hooks?.offer(merge ? 'merge' : undefined);
    }
    // Hors ligne, ou serveur indisponible : la fusion, ou le journal, restent à faire.
    if (outcome !== 'ok') return;
  }

  // Reçu par le compte. L'appareil lui est rattaché, et le journal ne garde que ce qui a
  // changé ici pendant l'envoi, avec les favoris refusés.
  const after = useStore.getState();
  const rest = journalFavorites({ ...NOTHING_UNSENT, preferences: first ? [] : after.unsent.preferences, refused }, shown, after.favorites);
  // Fusion refusée au premier passage : la liste réunie laisse la place à ce que le compte garde.
  useStore.setState({ syncedAccount: accountId, unsent: rest, ...(shown === wanted ? {} : { favorites: replayFavorites(wanted, rest) }) });
}

/**
 * Les préférences : celles du compte, s'il en a, remplacent celles de l'appareil, sauf les
 * champs changés ici et pas encore envoyés, qui sont rejoués par-dessus.
 */
async function syncPreferences(accountId: string, run: number): Promise<void> {
  // Tant que la fusion des favoris n'a pas rattaché l'appareil au compte, rien d'autre ne part.
  if (useStore.getState().syncedAccount !== accountId) return;
  let stored: unknown;
  try {
    stored = (await api<{ preferences: unknown }>('/api/me/preferences')).preferences;
  } catch {
    return;
  }
  if (run !== generation) return;

  const local = preferencesOf();
  const fields = useStore.getState().unsent.preferences;
  // Sans préférences dans le compte, celles de l'appareil lui sont envoyées.
  const remote = stored ? sanitizePreferences(stored, local) : null;
  const wanted = remote ? withFields(remote, local, fields) : local;
  if (!samePreferences(wanted, local)) {
    useStore.setState({ units: wanted.units, theme: wanted.theme, dayView: wanted.dayView, dayStep: wanted.dayStep, reopenLast: wanted.reopenLast });
  }

  if (!remote || !samePreferences(wanted, remote)) {
    try {
      await api('/api/me/preferences', { method: 'PUT', json: wanted });
    } catch {
      return;
    }
    if (run !== generation) return;
  }
  // Reçu : ne restent au journal que les champs changés ici pendant l'envoi.
  const now = preferencesOf();
  const { unsent } = useStore.getState();
  const rest = unsent.preferences.filter((name) => field(now, name) !== field(wanted, name));
  if (rest.length !== unsent.preferences.length) useStore.setState({ unsent: { ...unsent, preferences: rest } });
}

/** Un passage complet. Un seul tourne à la fois : une demande arrivée pendant ce temps en relance un après lui. */
function pass(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  const run = generation;
  const accountId = account;
  if (!accountId) return Promise.resolve();
  running = (async () => {
    try {
      await syncFavorites(accountId, run);
      if (run === generation) await syncPreferences(accountId, run);
    } finally {
      running = null;
    }
    // Demandé pendant ce passage : par un changement fait ici, ou pour un autre compte (ce
    // passage-ci s'est alors arrêté en route). Le suivant repart de l'état du moment.
    if (again) {
      again = false;
      await pass();
    }
  })();
  return running;
}

/** Envoie dans un instant ce qui vient de changer ici. */
function schedule(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = 0;
    void pass();
  }, PUSH_DELAY);
}

const hasUnsent = (): boolean => {
  const { unsent } = useStore.getState();
  return hasUnsentFavorites(unsent) || unsent.preferences.length > 0;
};

/** Relit le compte, le réunit avec l'appareil, puis suit les changements. */
export async function startSync(me: Me, withHooks: SyncHooks): Promise<void> {
  window.clearTimeout(timer);
  timer = 0;
  // Un passage en cours pour un autre compte est abandonné ; pour le même, il se termine d'abord.
  if (account !== me.id) generation++;
  // L'appareil était rattaché à un autre compte : il le quitte. Ce que ce compte avait refusé
  // d'une fusion revient dans ses favoris, et le journal qui lui était destiné est vidé.
  const attached = useStore.getState().syncedAccount;
  if (attached && attached !== me.id) useStore.getState().setSyncedAccount(null);
  account = me.id;
  hooks = withHooks;
  again = false;
  await pass();

  if (account !== me.id || unsubscribe) return;
  // Tout changement fait ici est noté dans `unsent` par le store : c'est lui qu'on suit.
  unsubscribe = useStore.subscribe((s, p) => {
    if (s.unsent !== p.unsent && hasUnsent()) schedule();
  });
  // Ce qui a changé pendant le premier passage, ou qui n'a pas pu partir : à envoyer.
  if (hasUnsent()) schedule();
}

/** À la déconnexion : plus rien ne part vers le compte. */
export function stopSync(): void {
  generation++;
  unsubscribe?.();
  unsubscribe = null;
  window.clearTimeout(timer);
  timer = 0;
  account = null;
  hooks = null;
  again = false;
}

// La connexion revient : ce qui n'a pas pu partir (une fusion, un favori ajouté hors ligne) part maintenant.
window.addEventListener('online', () => {
  if (account) void pass();
});
