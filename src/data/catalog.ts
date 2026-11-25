/**
 * Catalogue des couches et des modèles.
 *
 * Les grilles viennent des fichiers « data_spatial » d'Open-Meteo (un fichier
 * .om par échéance, lu par requêtes HTTP partielles). Ajouter une couche ou un
 * modèle se fait ici, sans toucher au rendu.
 */

export interface GridSpec {
  nx: number;
  ny: number;
  lonMin: number;
  latMin: number;
  dx: number;
  dy: number;
}

const grid = (nx: number, ny: number, lonMin: number, latMin: number, dx: number, dy = dx): GridSpec => ({
  nx,
  ny,
  lonMin,
  latMin,
  dx,
  dy,
});

/** Grilles régulières lat/lon des domaines utilisés (origine au sud-ouest). */
export const DOMAINS: Record<string, GridSpec> = {
  ecmwf_ifs025: grid(1440, 721, -180, -90, 0.25),
  ncep_gfs013: grid(3072, 1536, -180, -89.912126125, 0.1171875, 0.11714935),
  ncep_gfs025: grid(1440, 721, -180, -90, 0.25),
  dwd_icon: grid(2879, 1441, -180, -90, 0.125),
  dwd_icon_eu: grid(1377, 657, -23.5, 29.5, 0.0625),
  meteofrance_arome_france0025: grid(1121, 717, -12, 37.5, 0.025),
  meteofrance_wave: grid(4320, 2041, -180 + 1 / 24, -80 + 1 / 24, 1 / 12),
  meteofrance_currents: grid(4320, 2041, -180 + 1 / 24, -80 + 1 / 24, 1 / 12),
  ecmwf_wam025: grid(1440, 721, -180, -90, 0.25),
  ncep_gfswave025: grid(1440, 721, -180, -90, 0.25),
  dwd_ewam: grid(526, 721, -10.5, 30, 0.1, 0.05),
  dwd_gwam: grid(1440, 699, -180, -85.25, 0.25),
};

export type ModelKind = 'wave' | 'atmo' | 'ocean';

export interface ModelDef {
  id: string;
  kind: ModelKind;
  label: string;
  provider: string;
  /** Résolution lisible, ex. « 0,08° · 9 km ». */
  resolution: string;
  /** Portée et pas de temps, ex. « 10 j · 3 h ». */
  horizon: string;
  /**
   * Heures entre deux mises à jour du modèle chez Open-Meteo (`update_interval_seconds` de
   * son fichier `static/meta.json`).
   */
  updateHours: number;
  /** Zone couverte, pour les modèles régionaux. */
  region?: string;
  /** Variable -> domaine qui la porte. */
  vars: Record<string, string>;
  /** Les directions de vagues du fichier indiquent où vont les vagues (et non d'où elles viennent). */
  waveDirTowards?: boolean;
}

const all = (domain: string, names: string[]): Record<string, string> =>
  Object.fromEntries(names.map((n) => [n, domain]));

const WAVE_TOTAL = ['wave_height', 'wave_direction', 'wave_period'];
const WAVE_PARTS = [
  'swell_wave_height',
  'swell_wave_direction',
  'swell_wave_period',
  'wind_wave_height',
  'wind_wave_direction',
  'wind_wave_period',
];
const ATMO = [
  'wind_u_component_10m',
  'wind_v_component_10m',
  'wind_gusts_10m',
  'precipitation',
  'cloud_cover',
  'temperature_2m',
];

export const MODELS: ModelDef[] = [
  {
    id: 'mfwam',
    kind: 'wave',
    label: 'MFWAM',
    provider: 'Météo-France',
    resolution: '0,08° · 9 km',
    horizon: '10 j · 3 h',
    updateHours: 12,
    vars: all('meteofrance_wave', [...WAVE_TOTAL, ...WAVE_PARTS]),
    waveDirTowards: true,
  },
  {
    id: 'ecwam',
    kind: 'wave',
    label: 'ECMWF WAM',
    provider: 'ECMWF',
    resolution: '0,25° · 28 km',
    horizon: '15 j · 3 h',
    updateHours: 6,
    vars: all('ecmwf_wam025', [...WAVE_TOTAL, 'wave_peak_period']),
  },
  {
    id: 'gfswave',
    kind: 'wave',
    label: 'GFS Wave',
    provider: 'NOAA',
    resolution: '0,25° · 28 km',
    horizon: '16 j · 1 h',
    updateHours: 6,
    vars: all('ncep_gfswave025', [...WAVE_TOTAL, ...WAVE_PARTS]),
  },
  {
    id: 'ewam',
    kind: 'wave',
    label: 'EWAM',
    provider: 'DWD',
    resolution: '0,05° · 5 km',
    horizon: '3 j · 1 h',
    updateHours: 12,
    region: 'Europe',
    vars: all('dwd_ewam', [...WAVE_TOTAL, ...WAVE_PARTS]),
  },
  {
    id: 'gwam',
    kind: 'wave',
    label: 'GWAM',
    provider: 'DWD',
    resolution: '0,25° · 28 km',
    horizon: '7 j · 3 h',
    updateHours: 12,
    vars: all('dwd_gwam', [...WAVE_TOTAL, ...WAVE_PARTS]),
  },
  {
    id: 'ecmwf',
    kind: 'atmo',
    label: 'ECMWF IFS',
    provider: 'ECMWF',
    resolution: '0,25° · 28 km',
    horizon: '15 j · 3 h',
    updateHours: 6,
    vars: all('ecmwf_ifs025', ATMO),
  },
  {
    id: 'gfs',
    kind: 'atmo',
    label: 'GFS',
    provider: 'NOAA',
    resolution: '0,12° · 13 km',
    horizon: '16 j · 1 h',
    updateHours: 6,
    vars: {
      ...all('ncep_gfs013', ATMO.filter((v) => v !== 'wind_gusts_10m')),
      wind_gusts_10m: 'ncep_gfs025',
    },
  },
  {
    id: 'icon',
    kind: 'atmo',
    label: 'ICON',
    provider: 'DWD',
    resolution: '0,125° · 13 km',
    horizon: '7 j · 1 h',
    updateHours: 6,
    vars: all('dwd_icon', ATMO),
  },
  {
    id: 'iconeu',
    kind: 'atmo',
    label: 'ICON-EU',
    provider: 'DWD',
    resolution: '0,06° · 7 km',
    horizon: '1 à 5 j · 1 h',
    updateHours: 3,
    region: 'Europe',
    vars: all('dwd_icon_eu', ATMO),
  },
  {
    id: 'arome',
    kind: 'atmo',
    label: 'AROME',
    provider: 'Météo-France',
    resolution: '0,025° · 2,5 km',
    horizon: '2 j · 1 h',
    updateHours: 3,
    region: 'France et mers voisines',
    vars: all('meteofrance_arome_france0025', ATMO),
  },
  {
    id: 'mfcur',
    kind: 'ocean',
    label: 'MF Courants',
    provider: 'Météo-France · Mercator Océan',
    resolution: '0,08° · 9 km',
    horizon: '10 j · 1 h',
    updateHours: 24,
    vars: all('meteofrance_currents', ['ocean_u_current', 'ocean_v_current']),
  },
];

export const MODEL_BY_ID: Record<string, ModelDef> = Object.fromEntries(MODELS.map((m) => [m.id, m]));

export const DEFAULT_MODELS: Record<ModelKind, string> = { wave: 'mfwam', atmo: 'ecmwf', ocean: 'mfcur' };

export type LayerId =
  | 'waves'
  | 'swell'
  | 'period'
  | 'windwave'
  | 'currents'
  | 'wind'
  | 'gusts'
  | 'rain'
  | 'clouds'
  | 'temp';

export type PaletteId = 'height' | 'wind' | 'period' | 'rain' | 'clouds' | 'temp' | 'current';
export type Quantity = 'height' | 'wind' | 'period' | 'rain' | 'percent' | 'temp' | 'current';

/** Comment obtenir la grandeur colorée. */
export type ScalarSource =
  /** Première variable disponible dans le modèle. */
  | { type: 'var'; names: string[] }
  /** Norme d'un vecteur (u, v). */
  | { type: 'speed'; u: string; v: string };

/** Comment obtenir le champ de mouvement des particules. */
export type VectorSource =
  | { type: 'uv'; u: string; v: string }
  /** Direction de provenance en degrés (première variable disponible). */
  | { type: 'dir'; names: string[] };

export interface ParticleStyle {
  /** Pixels par image (à 60 i/s) pour une unité de vecteur. */
  speed: number;
  /** Persistance de la traînée par image (0–1). */
  fade: number;
  /** D'où vient l'opacité : norme du vecteur ou grandeur colorée. */
  alphaFrom: 'vector' | 'scalar';
  /** Valeurs donnant l'opacité minimale et maximale. */
  alphaRange: [number, number];
}

export interface LayerDef {
  id: LayerId;
  group: 'sea' | 'air';
  kind: ModelKind;
  label: string;
  /** Précision affichée sous la légende. */
  hint: string;
  palette: PaletteId;
  quantity: Quantity;
  scalar: ScalarSource;
  vector: VectorSource | null;
  particles: ParticleStyle | null;
  /** Opacité du champ sur la mer et sur la terre (0 = masqué sur terre). */
  opacity: { water: number; land: number };
  /** Cumul par pas de temps dans le fichier, à ramener à l'heure. */
  perHour?: boolean;
}

const WAVE_PARTICLES: ParticleStyle = { speed: 0.55, fade: 0.94, alphaFrom: 'scalar', alphaRange: [0.2, 2.2] };
const WIND_PARTICLES: ParticleStyle = { speed: 0.105, fade: 0.955, alphaFrom: 'vector', alphaRange: [0.5, 14] };
const WIND_UV: VectorSource = { type: 'uv', u: 'wind_u_component_10m', v: 'wind_v_component_10m' };

export const LAYERS: LayerDef[] = [
  {
    id: 'waves',
    group: 'sea',
    kind: 'wave',
    label: 'Vagues',
    hint: 'Hauteur significative, houle et mer du vent réunies',
    palette: 'height',
    quantity: 'height',
    scalar: { type: 'var', names: ['wave_height'] },
    vector: { type: 'dir', names: ['wave_direction'] },
    particles: WAVE_PARTICLES,
    opacity: { water: 0.96, land: 0 },
  },
  {
    id: 'swell',
    group: 'sea',
    kind: 'wave',
    label: 'Houle',
    hint: 'Hauteur de la houle primaire',
    palette: 'height',
    quantity: 'height',
    scalar: { type: 'var', names: ['swell_wave_height'] },
    vector: { type: 'dir', names: ['swell_wave_direction'] },
    particles: WAVE_PARTICLES,
    opacity: { water: 0.96, land: 0 },
  },
  {
    id: 'period',
    group: 'sea',
    kind: 'wave',
    label: 'Période',
    hint: 'Période de la houle (période pic pour ECMWF WAM)',
    palette: 'period',
    quantity: 'period',
    scalar: { type: 'var', names: ['swell_wave_period', 'wave_peak_period', 'wave_period'] },
    vector: { type: 'dir', names: ['swell_wave_direction', 'wave_direction'] },
    particles: { ...WAVE_PARTICLES, alphaRange: [3, 12] },
    opacity: { water: 0.96, land: 0 },
  },
  {
    id: 'windwave',
    group: 'sea',
    kind: 'wave',
    label: 'Mer du vent',
    hint: 'Vagues levées par le vent local',
    palette: 'height',
    quantity: 'height',
    scalar: { type: 'var', names: ['wind_wave_height'] },
    vector: { type: 'dir', names: ['wind_wave_direction'] },
    particles: WAVE_PARTICLES,
    opacity: { water: 0.96, land: 0 },
  },
  {
    id: 'currents',
    group: 'sea',
    kind: 'ocean',
    label: 'Courants',
    hint: 'Courant de surface, marée comprise',
    palette: 'current',
    quantity: 'current',
    scalar: { type: 'speed', u: 'ocean_u_current', v: 'ocean_v_current' },
    vector: { type: 'uv', u: 'ocean_u_current', v: 'ocean_v_current' },
    particles: { speed: 1.5, fade: 0.95, alphaFrom: 'vector', alphaRange: [0.03, 0.8] },
    opacity: { water: 0.96, land: 0 },
  },
  {
    id: 'wind',
    group: 'air',
    kind: 'atmo',
    label: 'Vent',
    hint: 'Vent moyen à 10 m',
    palette: 'wind',
    quantity: 'wind',
    scalar: { type: 'speed', u: 'wind_u_component_10m', v: 'wind_v_component_10m' },
    vector: WIND_UV,
    particles: WIND_PARTICLES,
    opacity: { water: 0.96, land: 0.8 },
  },
  {
    id: 'gusts',
    group: 'air',
    kind: 'atmo',
    label: 'Rafales',
    hint: 'Rafales à 10 m',
    palette: 'wind',
    quantity: 'wind',
    scalar: { type: 'var', names: ['wind_gusts_10m'] },
    vector: WIND_UV,
    particles: WIND_PARTICLES,
    opacity: { water: 0.96, land: 0.8 },
  },
  {
    id: 'rain',
    group: 'air',
    kind: 'atmo',
    label: 'Pluie',
    hint: 'Précipitations par heure',
    palette: 'rain',
    quantity: 'rain',
    scalar: { type: 'var', names: ['precipitation'] },
    vector: null,
    particles: null,
    opacity: { water: 0.92, land: 0.92 },
    perHour: true,
  },
  {
    id: 'clouds',
    group: 'air',
    kind: 'atmo',
    label: 'Nuages',
    hint: 'Couverture nuageuse totale',
    palette: 'clouds',
    quantity: 'percent',
    scalar: { type: 'var', names: ['cloud_cover'] },
    vector: null,
    particles: null,
    opacity: { water: 0.9, land: 0.9 },
  },
  {
    id: 'temp',
    group: 'air',
    kind: 'atmo',
    label: 'Température',
    hint: "Température de l'air à 2 m",
    palette: 'temp',
    quantity: 'temp',
    scalar: { type: 'var', names: ['temperature_2m'] },
    vector: null,
    particles: null,
    opacity: { water: 0.94, land: 0.8 },
  },
];

export const LAYER_BY_ID = Object.fromEntries(LAYERS.map((l) => [l.id, l])) as Record<LayerId, LayerDef>;

const firstAvailable = (model: ModelDef, names: string[]): string | undefined => names.find((n) => n in model.vars);

/** Un modèle sait-il produire cette couche ? */
export function modelSupports(model: ModelDef, layer: LayerDef): boolean {
  if (model.kind !== layer.kind) return false;
  const s = layer.scalar;
  return s.type === 'var' ? firstAvailable(model, s.names) !== undefined : s.u in model.vars && s.v in model.vars;
}

export function modelsForLayer(layer: LayerDef): ModelDef[] {
  return MODELS.filter((m) => modelSupports(m, layer));
}

/** Une lecture à faire dans un fichier d'échéance. */
export type ReadSpec =
  | { op: 'scalar'; domain: string; variable: string; perHour: boolean }
  | { op: 'speed'; domain: string; u: string; v: string }
  | { op: 'dir'; domain: string; variable: string; towards: boolean };

export interface LayerPlan {
  key: string;
  layer: LayerDef;
  model: ModelDef;
  /** Lecture de la grandeur colorée (une lecture « speed » fournit aussi le vecteur). */
  scalar: ReadSpec;
  /** Lecture séparée du vecteur, si la grandeur colorée ne le fournit pas. */
  vector: ReadSpec | null;
  /** Variable effectivement affichée (utile quand la couche a des replis). */
  variable: string;
}

/** Traduit (couche, modèle) en lectures concrètes. Renvoie null si le modèle ne sait pas faire. */
export function resolvePlan(layer: LayerDef, model: ModelDef): LayerPlan | null {
  if (!modelSupports(model, layer)) return null;
  let scalar: ReadSpec;
  let variable: string;
  if (layer.scalar.type === 'var') {
    variable = firstAvailable(model, layer.scalar.names)!;
    scalar = { op: 'scalar', domain: model.vars[variable], variable, perHour: !!layer.perHour };
  } else {
    variable = layer.scalar.u;
    scalar = { op: 'speed', domain: model.vars[layer.scalar.u], u: layer.scalar.u, v: layer.scalar.v };
  }

  let vector: ReadSpec | null = null;
  const vs = layer.vector;
  if (vs && layer.particles) {
    if (vs.type === 'uv') {
      const sameAsScalar = scalar.op === 'speed' && scalar.u === vs.u && scalar.v === vs.v;
      if (!sameAsScalar && vs.u in model.vars && vs.v in model.vars) {
        vector = { op: 'speed', domain: model.vars[vs.u], u: vs.u, v: vs.v };
      }
    } else {
      const dir = firstAvailable(model, vs.names);
      if (dir) vector = { op: 'dir', domain: model.vars[dir], variable: dir, towards: !!model.waveDirTowards };
    }
  }
  return { key: `${layer.id}|${model.id}`, layer, model, scalar, vector, variable };
}
