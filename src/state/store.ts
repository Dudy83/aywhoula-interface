import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_MODELS,
  LAYER_BY_ID,
  MODEL_BY_ID,
  modelSupports,
  modelsForLayer,
  type LayerId,
  type ModelDef,
  type ModelKind,
} from '../data/catalog';
import type { ForecastChoice } from '../data/sea-state';
import type { HeightUnit, TempUnit, Units, WindUnit } from '../lib/units';
import { isWebUrl } from '../lib/url';

export type ThemeChoice = 'auto' | 'light' | 'dark';
export type DayView = 'table' | 'curves';
/** Pas du détail du jour, pour le tableau comme pour les courbes : une heure sur 1, 3, 5 ou 12. */
export type DayStep = '1h' | '3h' | '5h' | '12h';
export const DAY_STEP_HOURS: Record<DayStep, number> = { '1h': 1, '3h': 3, '5h': 5, '12h': 12 };
/** La ligne de temps : la prévision du lieu en courbes ou en tableau. */
export type TimelineView = 'curves' | 'table';
/**
 * Ce que montrent le tableau et les courbes de la ligne de temps : vagues et vent (par défaut), la houle en
 * détail, le vent, la météo, ou la marée et le courant.
 */
export type TimelineProfile = 'waves' | 'swell' | 'wind' | 'weather' | 'tide';
export const TIMELINE_PROFILES: readonly TimelineProfile[] = ['waves', 'swell', 'wind', 'weather', 'tide'];
/** « Mesuré contre prévu » d'une bouée : une barre par heure, ou des courbes. */
export type BuoyView = 'bars' | 'curves';
/**
 * Le dialog du lieu ouvert : réduit en petite carte, ouvert, ou agrandi en plein écran (téléphone). Sur
 * ordinateur, un point de la carte n'a pas de dialog : seulement sa petite carte.
 */
export type Sheet = 'reduced' | 'open' | 'expanded';
export type PlaceKind = 'point' | 'spot' | 'beach' | 'buoy' | 'webcam';

/** Ce qui est sélectionné sur la carte et détaillé dans le panneau. */
export interface Selection {
  kind: PlaceKind;
  id: string;
  name: string;
  lon: number;
  lat: number;
  /** Sports pratiqués (spots) ou adresse (webcams). */
  detail?: string;
}

export interface Timeline {
  /** Échéances du modèle affiché (ms UTC). */
  times: number[];
  /** Heure du run. */
  ref: number;
  modelId: string;
}

export interface Readout {
  value: number;
  direction: number | null;
}

export type FieldStatus = 'loading' | 'ready' | 'error';

/** Les préférences gardées dans le compte, champ par champ. */
export type PreferenceField = 'wind' | 'height' | 'temp' | 'theme' | 'dayView' | 'dayStep' | 'reopenLast';

/**
 * Ce que cet appareil a changé et que le compte n'a pas encore reçu (hors ligne, onglet fermé
 * trop tôt, serveur indisponible). Gardé avec les préférences : à la prochaine synchronisation,
 * ces changements sont rejoués sur ce que contient le compte, au lieu d'être écrasés par lui.
 */
export interface Unsent {
  /** Favoris ajoutés ici. */
  added: Selection[];
  /** Identifiants des favoris retirés ici. */
  removed: string[];
  /** Les ajouts viennent d'une fusion (import de l'ancienne origine) : ils ne comptent pas comme de nouveaux favoris. */
  merge: boolean;
  /**
   * Favoris d'une fusion que le compte gratuit n'a pas pris (il en garde 3). Ils ne sont plus
   * dans la liste, et ne sont pas renvoyés tant que le compte est gratuit : ils partent dès
   * qu'il passe en Premium. Si l'appareil quitte ce compte avant, ils reviennent dans sa liste.
   */
  refused: Selection[];
  /** Préférences changées ici ; leur valeur est celle du store. */
  preferences: PreferenceField[];
}

export const NOTHING_UNSENT: Unsent = { added: [], removed: [], merge: false, refused: [], preferences: [] };

export const hasUnsentFavorites = (unsent: Unsent): boolean => unsent.added.length > 0 || unsent.removed.length > 0;

/** Note ce qui sépare deux listes de favoris : les lieux ajoutés et les lieux retirés. */
export function journalFavorites(unsent: Unsent, before: Selection[], after: Selection[], merge = false): Unsent {
  const was = new Set(before.map((f) => f.id));
  const is = new Set(after.map((f) => f.id));
  const added = after.filter((f) => !was.has(f.id));
  const removed = before.filter((f) => !is.has(f.id)).map((f) => f.id);
  if (added.length === 0 && removed.length === 0) return unsent;
  const addedIds = new Set(added.map((f) => f.id));
  return {
    ...unsent,
    // Un lieu retiré puis remis (ou l'inverse) : le dernier geste l'emporte.
    added: [...unsent.added.filter((f) => !addedIds.has(f.id) && !removed.includes(f.id)), ...added],
    removed: [...unsent.removed.filter((id) => !addedIds.has(id) && !removed.includes(id)), ...removed],
    merge: unsent.merge || (merge && added.length > 0),
    // Un favori refusé que l'on remet à la main redevient un ajout comme un autre ; retiré, il n'attend plus rien.
    refused: unsent.refused.filter((f) => !addedIds.has(f.id) && !removed.includes(f.id)),
  };
}

/** Rejoue des changements non envoyés sur une liste relue du compte. */
export function replayFavorites(remote: Selection[], unsent: Unsent): Selection[] {
  const kept = remote.filter((f) => !unsent.removed.includes(f.id));
  const known = new Set(kept.map((f) => f.id));
  return [...kept, ...unsent.added.filter((f) => !known.has(f.id))];
}

const journalPreferences = (unsent: Unsent, fields: PreferenceField[]): Unsent => ({
  ...unsent,
  preferences: [...unsent.preferences, ...fields.filter((f) => !unsent.preferences.includes(f))],
});

interface State {
  layer: LayerId;
  models: Record<ModelKind, string>;
  units: Units;
  theme: ThemeChoice;
  animate: boolean;
  /** Détail du jour dans le panneau de prévision : tableau de pastilles, ou courbes. */
  dayView: DayView;
  /** Pas du détail du jour, pour les deux vues. */
  dayStep: DayStep;
  /** À l'ouverture de l'appli, rouvrir le panneau sur le dernier lieu ouvert. */
  reopenLast: boolean;
  /** Le dernier lieu ouvert dans le panneau ; fermer le panneau ne l'efface pas. */
  lastSelection: Selection | null;
  /** La vue de la ligne de temps (gardée sur cet appareil). */
  timelineView: TimelineView;
  /** Le type d'affichage de la ligne de temps (gardé sur cet appareil, pas synchronisé avec le compte). */
  timelineProfile: TimelineProfile;
  /** La vue de « Mesuré contre prévu » d'une bouée (gardée sur cet appareil). */
  buoyView: BuoyView;
  /**
   * L'heure la plus lointaine permise (ms), ou `null` : en version gratuite, la fin du cinquième jour,
   * quel que soit le modèle ; au-delà, c'est Premium. Posée par `App` selon le compte.
   */
  timeLimit: number | null;
  show: { places: boolean; buoys: boolean; webcams: boolean };
  favorites: Selection[];
  view: { lng: number; lat: number; zoom: number };
  /** Identifiant du compte avec lequel cet appareil a déjà fusionné ses favoris et ses préférences. */
  syncedAccount: string | null;
  /** Ce que le compte n'a pas encore reçu de cet appareil ; vide tant qu'il n'a pas fusionné. */
  unsent: Unsent;

  time: number;
  playing: boolean;
  timeline: Timeline | null;
  status: FieldStatus;
  error: string | null;
  /** Le modèle affiché couvre-t-il la zone visible ? */
  covered: boolean;
  selection: Selection | null;
  /** La hauteur du dialog du lieu ouvert ; chaque lieu choisi l'ouvre. */
  sheet: Sheet;
  readout: Readout | null;
  /**
   * Modèles choisis pour la prévision du lieu ouvert. L'appli ne propose plus de les comparer : ils
   * restent à `null`, et la prévision suit le modèle de la carte (`pickSeries`).
   */
  forecastChoice: ForecastChoice;

  setLayer: (layer: LayerId) => void;
  setModel: (kind: ModelKind, id: string) => void;
  setUnits: (units: Partial<Units>) => void;
  setTheme: (theme: ThemeChoice) => void;
  setAnimate: (animate: boolean) => void;
  setDayView: (dayView: DayView) => void;
  setDayStep: (dayStep: DayStep) => void;
  setReopenLast: (reopenLast: boolean) => void;
  setTimelineView: (timelineView: TimelineView) => void;
  setTimelineProfile: (timelineProfile: TimelineProfile) => void;
  setBuoyView: (buoyView: BuoyView) => void;
  setSheet: (sheet: Sheet) => void;
  toggleShow: (key: keyof State['show']) => void;
  toggleFavorite: (place: Selection) => void;
  setFavorites: (favorites: Selection[]) => void;
  setSyncedAccount: (id: string | null) => void;
  setView: (view: State['view']) => void;
  setTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  setTimeline: (timeline: Timeline | null) => void;
  setStatus: (status: FieldStatus, error?: string | null) => void;
  setCovered: (covered: boolean) => void;
  select: (selection: Selection | null) => void;
  setReadout: (readout: Readout | null) => void;
  setForecastChoice: (kind: keyof ForecastChoice, key: string | null) => void;
}

const STORAGE_KEY = 'aywhoula';

const PLACE_KINDS: readonly PlaceKind[] = ['point', 'spot', 'beach', 'buoy', 'webcam'];
const PREFERENCE_FIELDS: readonly PreferenceField[] = ['wind', 'height', 'temp', 'theme', 'dayView', 'dayStep', 'reopenLast'];
const DAY_STEPS: readonly DayStep[] = ['1h', '3h', '5h', '12h'];
const TIMELINE_VIEWS: readonly TimelineView[] = ['curves', 'table'];
const BUOY_VIEWS: readonly BuoyView[] = ['bars', 'curves'];
const WIND_UNITS: readonly WindUnit[] = ['kn', 'kmh', 'ms', 'bft'];
const HEIGHT_UNITS: readonly HeightUnit[] = ['m', 'ft'];
const TEMP_UNITS: readonly TempUnit[] = ['c', 'f'];
const THEMES: readonly ThemeChoice[] = ['auto', 'light', 'dark'];

const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Ne garde d'une liste de favoris que les lieux bien formés, une fois chacun. Elle peut venir
 * du navigateur, du compte ou de l'adresse (`#import=`) : rien n'y est tenu pour sûr.
 */
export function sanitizeFavorites(value: unknown): Selection[] {
  if (!Array.isArray(value)) return [];
  const out: Selection[] = [];
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const { id, kind, name, lon, lat, detail } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !id || id.length > 200 || seen.has(id)) continue;
    if (!PLACE_KINDS.includes(kind as PlaceKind)) continue;
    if (!finite(lon) || !finite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 360) continue;
    const place: Selection = { kind: kind as PlaceKind, id, name: typeof name === 'string' ? name.slice(0, 200) : '', lon, lat };
    // Le détail d'une webcam devient un lien : seulement une adresse http(s).
    if (typeof detail === 'string' && detail && (kind !== 'webcam' || isWebUrl(detail))) place.detail = detail.slice(0, 500);
    seen.add(id);
    out.push(place);
  }
  return out;
}

/** Les champs des préférences synchronisées avec le compte. */
interface SyncedFields {
  units: Units;
  theme: ThemeChoice;
  dayView: DayView;
  dayStep: DayStep;
  reopenLast: boolean;
}

/**
 * Les préférences d'un compte, validées comme le reste de ce qui en vient : toute valeur
 * inconnue laisse celle de `fallback`.
 */
export function sanitizePreferences(value: unknown, fallback: SyncedFields): SyncedFields {
  const p = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const units = p.units && typeof p.units === 'object' ? (p.units as Record<string, unknown>) : {};
  return {
    units: {
      wind: oneOf(WIND_UNITS, units.wind, fallback.units.wind),
      height: oneOf(HEIGHT_UNITS, units.height, fallback.units.height),
      temp: oneOf(TEMP_UNITS, units.temp, fallback.units.temp),
    },
    theme: oneOf(THEMES, p.theme, fallback.theme),
    dayView: p.dayView === 'curves' ? 'curves' : p.dayView === 'table' ? 'table' : fallback.dayView,
    dayStep: oneOf(DAY_STEPS, p.dayStep, fallback.dayStep),
    reopenLast: typeof p.reopenLast === 'boolean' ? p.reopenLast : fallback.reopenLast,
  };
}

/** Le journal des changements non envoyés, relu du navigateur : rien n'y est tenu pour sûr. */
function sanitizeUnsent(value: unknown): Unsent {
  const p = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    added: sanitizeFavorites(p.added),
    removed: Array.isArray(p.removed) ? (p.removed as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200) : [],
    merge: p.merge === true,
    refused: sanitizeFavorites(p.refused),
    preferences: Array.isArray(p.preferences) ? PREFERENCE_FIELDS.filter((f) => (p.preferences as unknown[]).includes(f)) : [],
  };
}

/** L'appareil avait-il déjà des préférences enregistrées à l'ouverture ? Lu avant que le store n'écrive. */
let hadStoredState = false;
try {
  hadStoredState = localStorage.getItem(STORAGE_KEY) !== null || localStorage.getItem('windaube') !== null;
} catch {
  // Stockage indisponible.
}

// Reprise des favoris et réglages enregistrés sous l'ancien nom de l'app.
try {
  const legacy = localStorage.getItem('windaube');
  if (legacy !== null) {
    if (localStorage.getItem(STORAGE_KEY) === null) localStorage.setItem(STORAGE_KEY, legacy);
    localStorage.removeItem('windaube');
  }
} catch {
  // Stockage indisponible : rien à reprendre.
}

/** Ce qui est enregistré dans le navigateur (`partialize`). Une nouvelle préférence passe aussi par `mergePersisted`. */
const persistedOf = (s: State) => ({
  layer: s.layer,
  models: s.models,
  units: s.units,
  theme: s.theme,
  animate: s.animate,
  dayView: s.dayView,
  dayStep: s.dayStep,
  reopenLast: s.reopenLast,
  lastSelection: s.lastSelection,
  timelineView: s.timelineView,
  timelineProfile: s.timelineProfile,
  buoyView: s.buoyView,
  show: s.show,
  favorites: s.favorites,
  view: s.view,
  syncedAccount: s.syncedAccount,
  unsent: s.unsent,
});
type PersistedState = ReturnType<typeof persistedOf>;

export const useStore = create<State>()(
  persist(
    (set) => ({
      layer: 'waves',
      models: DEFAULT_MODELS,
      units: { wind: 'kn', height: 'm', temp: 'c' },
      theme: 'auto',
      animate: true,
      dayView: 'table',
      dayStep: '3h',
      reopenLast: true,
      lastSelection: null,
      // Au premier lancement, le tableau, sur ordinateur comme sur téléphone ; ensuite, le choix fait ici.
      timelineView: 'table',
      timelineProfile: 'waves',
      buoyView: 'bars',
      timeLimit: null,
      show: { places: true, buoys: true, webcams: false },
      favorites: [],
      // Golfe de Gascogne.
      view: { lng: -4.2, lat: 45.6, zoom: 4.6 },
      syncedAccount: null,
      unsent: NOTHING_UNSENT,

      time: 0,
      playing: false,
      timeline: null,
      status: 'loading',
      error: null,
      covered: true,
      selection: null,
      sheet: 'open',
      readout: null,
      forecastChoice: { wave: null, wind: null },

      // La valeur lue sous le point appartient à l'ancienne couche : on l'efface en attendant la nouvelle.
      setLayer: (layer) => set({ layer, playing: false, readout: null }),
      setModel: (kind, id) => set((s) => ({ models: { ...s.models, [kind]: id }, playing: false, readout: null })),
      // Sur un appareil rattaché à un compte, chaque changement de préférence ou de favori est
      // noté dans `unsent` jusqu'à ce que le compte l'ait reçu (`src/data/sync.ts`).
      setUnits: (units) =>
        set((s) => ({
          units: { ...s.units, ...units },
          unsent: s.syncedAccount ? journalPreferences(s.unsent, (Object.keys(units) as (keyof Units)[]).filter((k) => units[k] !== s.units[k])) : s.unsent,
        })),
      setTheme: (theme) => set((s) => ({ theme, unsent: s.syncedAccount && theme !== s.theme ? journalPreferences(s.unsent, ['theme']) : s.unsent })),
      setAnimate: (animate) => set({ animate }),
      setDayView: (dayView) => set((s) => ({ dayView, unsent: s.syncedAccount && dayView !== s.dayView ? journalPreferences(s.unsent, ['dayView']) : s.unsent })),
      setDayStep: (dayStep) => set((s) => ({ dayStep, unsent: s.syncedAccount && dayStep !== s.dayStep ? journalPreferences(s.unsent, ['dayStep']) : s.unsent })),
      setTimelineView: (timelineView) => set({ timelineView }),
      setTimelineProfile: (timelineProfile) => set({ timelineProfile }),
      setBuoyView: (buoyView) => set({ buoyView }),
      setSheet: (sheet) => set({ sheet }),
      setReopenLast: (reopenLast) =>
        set((s) => ({ reopenLast, unsent: s.syncedAccount && reopenLast !== s.reopenLast ? journalPreferences(s.unsent, ['reopenLast']) : s.unsent })),
      toggleShow: (key) => set((s) => ({ show: { ...s.show, [key]: !s.show[key] } })),
      toggleFavorite: (place) =>
        set((s) => {
          const favorites = s.favorites.some((f) => f.id === place.id) ? s.favorites.filter((f) => f.id !== place.id) : [...s.favorites, place];
          return { favorites, unsent: s.syncedAccount ? journalFavorites(s.unsent, s.favorites, favorites) : s.unsent };
        }),
      setFavorites: (favorites) => set((s) => ({ favorites, unsent: s.syncedAccount ? journalFavorites(s.unsent, s.favorites, favorites) : s.unsent })),
      // L'appareil change de compte, ou le quitte : ce qui restait à envoyer était pour l'ancien.
      // Les favoris qu'une fusion s'était vu refuser, eux, sont à l'appareil : ils reviennent
      // dans sa liste avant que le journal soit vidé.
      setSyncedAccount: (syncedAccount) =>
        set((s) => {
          const known = new Set(s.favorites.map((f) => f.id));
          return { syncedAccount, favorites: [...s.favorites, ...s.unsent.refused.filter((f) => !known.has(f.id))], unsent: NOTHING_UNSENT };
        }),
      setView: (view) => set({ view }),
      // Toute heure passe par la limite de la version gratuite : la ligne de temps, la lecture, les liens.
      // On s'arrête sur le dernier pas du modèle avant la limite, pas entre deux pas.
      setTime: (time) =>
        set((s) => {
          if (s.timeLimit == null || time <= s.timeLimit) return { time };
          const times = s.timeline?.times ?? [];
          let clamped = s.timeLimit;
          for (let i = times.length - 1; i >= 0; i--) {
            if (times[i] <= s.timeLimit) {
              clamped = times[i];
              break;
            }
          }
          return { time: clamped };
        }),
      setPlaying: (playing) => set({ playing }),
      setTimeline: (timeline) => set({ timeline }),
      setStatus: (status, error = null) => set({ status, error }),
      setCovered: (covered) => set({ covered }),
      // La prévision suit le modèle de la carte. Le dernier lieu ouvert reste noté quand le dialog se
      // ferme ; un lieu choisi (ou touché à nouveau sur la carte) rouvre le dialog.
      select: (selection) =>
        set((s) => ({ selection, lastSelection: selection ?? s.lastSelection, sheet: 'open', readout: null, forecastChoice: { wave: null, wind: null } })),
      setReadout: (readout) => set({ readout }),
      setForecastChoice: (kind, key) => set((s) => ({ forecastChoice: { ...s.forecastChoice, [kind]: key } })),
    }),
    {
      name: STORAGE_KEY,
      // Version 2 (25 novembre 2026) : le tableau devient la vue par défaut de la barre du temps, une seule fois,
      // pour les installations existantes aussi ; ensuite, le choix de chacun est gardé. Ce que la migration rend
      // passe ensuite par `mergePersisted`, champ par champ, comme tout ce qui est relu.
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted && typeof persisted === 'object' ? (persisted as Record<string, unknown>) : {};
        return (version < 2 ? { ...state, timelineView: 'table' } : state) as PersistedState;
      },
      partialize: persistedOf,
      merge: (persisted, current) => mergePersisted(persisted, current),
    },
  ),
);

/**
 * Valide un état relu (du navigateur, ou de l'ancienne origine par `#import=`) et le pose
 * sur l'état courant : toute valeur inconnue ou mal formée laisse la valeur courante.
 */
function mergePersisted(persisted: unknown, current: State): State {
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const p = obj(persisted);
  const models = obj(p.models);
  const units = obj(p.units);
  const show = obj(p.show);
  const view = obj(p.view);
  const validView = finite(view.lng) && finite(view.lat) && finite(view.zoom) && Math.abs(view.lat) <= 90 && view.zoom >= 0 && view.zoom <= 24;
  return {
    ...current,
    layer: typeof p.layer === 'string' && p.layer in LAYER_BY_ID ? (p.layer as LayerId) : current.layer,
    models: {
      wave: typeof models.wave === 'string' ? models.wave : current.models.wave,
      atmo: typeof models.atmo === 'string' ? models.atmo : current.models.atmo,
      ocean: typeof models.ocean === 'string' ? models.ocean : current.models.ocean,
    },
    units: {
      wind: oneOf(WIND_UNITS, units.wind, current.units.wind),
      height: oneOf(HEIGHT_UNITS, units.height, current.units.height),
      temp: oneOf(TEMP_UNITS, units.temp, current.units.temp),
    },
    theme: oneOf(THEMES, p.theme, current.theme),
    animate: flag(p.animate, current.animate),
    dayView: p.dayView === 'curves' ? 'curves' : p.dayView === 'table' ? 'table' : current.dayView,
    dayStep: oneOf(DAY_STEPS, p.dayStep, current.dayStep),
    reopenLast: flag(p.reopenLast, current.reopenLast),
    lastSelection: p.lastSelection ? (sanitizeFavorites([p.lastSelection])[0] ?? null) : current.lastSelection,
    timelineView: oneOf(TIMELINE_VIEWS, p.timelineView, current.timelineView),
    timelineProfile: oneOf(TIMELINE_PROFILES, p.timelineProfile, current.timelineProfile),
    buoyView: oneOf(BUOY_VIEWS, p.buoyView, current.buoyView),
    show: {
      places: flag(show.places, current.show.places),
      buoys: flag(show.buoys, current.show.buoys),
      webcams: flag(show.webcams, current.show.webcams),
    },
    favorites: Array.isArray(p.favorites) ? sanitizeFavorites(p.favorites) : current.favorites,
    view: validView ? { lng: view.lng as number, lat: view.lat as number, zoom: view.zoom as number } : current.view,
    syncedAccount: typeof p.syncedAccount === 'string' ? p.syncedAccount : null,
    // Sans compte rattaché, il n'y a rien à lui envoyer.
    unsent: typeof p.syncedAccount === 'string' ? sanitizeUnsent(p.unsent) : NOTHING_UNSENT,
  };
}

/**
 * Données de l'ancienne origine. Quand l'appli vivait sur aywhoula.com, favoris et réglages
 * étaient enregistrés sous cette origine ; la vitrine qui l'a remplacée les passe une fois
 * dans l'adresse, `#import=<JSON en base64url>`. On ajoute les favoris absents, on reprend
 * les préférences seulement si cet appareil n'en a pas encore, puis on efface le fragment.
 *
 * Sur un appareil déjà rattaché à un compte, l'import est une fusion : les favoris ajoutés
 * sont notés dans `unsent` comme tels, et la synchronisation les joint à la liste du compte.
 */
function importFromHash(): void {
  const match = /^#import=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
  if (!match) return;
  try {
    const bytes = Uint8Array.from(atob(match[1].replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { state?: unknown } | null;
    const state = useStore.getState();
    const incoming = mergePersisted(parsed?.state, useStore.getInitialState());
    const known = new Set(state.favorites.map((f) => f.id));
    const favorites = [...state.favorites, ...incoming.favorites.filter((f) => !known.has(f.id))];
    if (hadStoredState) {
      useStore.setState({ favorites, ...(state.syncedAccount ? { unsent: journalFavorites(state.unsent, state.favorites, favorites, true) } : {}) });
    } else {
      const { layer, models, units, theme, animate, dayView, dayStep, reopenLast, show, view } = incoming;
      useStore.setState({ layer, models, units, theme, animate, dayView, dayStep, reopenLast, show, view, favorites });
    }
  } catch {
    // Fragment illisible : on l'efface sans rien reprendre.
  }
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}

importFromHash();
// L'appli déjà ouverte dans l'onglet : le lien de la vitrine ne recharge pas la page, il change le fragment.
window.addEventListener('hashchange', importFromHash);

/**
 * Modèle réellement affiché pour une couche : le choix de l'utilisateur s'il
 * sait produire la couche, sinon le premier modèle qui le peut.
 */
export function effectiveModel(layerId: LayerId, models: Record<ModelKind, string>): ModelDef {
  const layer = LAYER_BY_ID[layerId];
  const chosen = MODEL_BY_ID[models[layer.kind]];
  if (chosen && modelSupports(chosen, layer)) return chosen;
  return modelsForLayer(layer)[0];
}

export function isFavorite(favorites: Selection[], id: string | undefined): boolean {
  return !!id && favorites.some((f) => f.id === id);
}
