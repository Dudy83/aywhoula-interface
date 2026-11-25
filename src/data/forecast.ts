/**
 * Prévision ponctuelle (un spot, un point de la carte) : API Open-Meteo, par le relais
 * du serveur (`/api/meteo`, qui porte la clé), plusieurs modèles de vagues et de vent
 * en parallèle (Premium) ; et les demandes des types d'affichage de la ligne de temps.
 */
import { api, ApiError } from './api';
import { DEFAULT_MODELS } from './catalog';

export type Series = (number | null)[];

export interface WaveSeries {
  height: Series;
  direction: Series;
  period: Series;
  peakPeriod: Series;
  swellHeight: Series;
  swellDirection: Series;
  swellPeriod: Series;
  swell2Height: Series;
  swell2Direction: Series;
  swell2Period: Series;
  windWaveHeight: Series;
  windWaveDirection: Series;
  windWavePeriod: Series;
}

export interface WindSeries {
  speed: Series;
  gust: Series;
  direction: Series;
  temperature: Series;
  precipitation: Series;
  cloud: Series;
}

export interface PointForecast {
  /** Heures (ms UTC), pas horaire. */
  times: number[];
  wave: Record<string, WaveSeries>;
  wind: Record<string, WindSeries>;
  /** Niveau de la mer par rapport au niveau moyen (m), marée comprise. */
  seaLevel: Series | null;
  seaTemperature: Series | null;
  isDay: Series | null;
  /** Lever et coucher du soleil (ms UTC) par jour. */
  sun: { rise: number; set: number }[];
  /** Raison lisible si une famille de données manque. */
  waveError: string | null;
  windError: string | null;
}

export interface ForecastModel {
  /** Nom du modèle dans l'API. */
  key: string;
  label: string;
  /** Modèles de la carte auxquels il correspond. */
  mapIds: string[];
}

export const WAVE_FORECAST_MODELS: ForecastModel[] = [
  { key: 'meteofrance_wave', label: 'MFWAM', mapIds: ['mfwam'] },
  { key: 'ecmwf_wam025', label: 'ECMWF WAM', mapIds: ['ecwam'] },
  { key: 'ncep_gfswave025', label: 'GFS Wave', mapIds: ['gfswave'] },
];

export const WIND_FORECAST_MODELS: ForecastModel[] = [
  { key: 'meteofrance_seamless', label: 'AROME · ARPEGE', mapIds: ['arome'] },
  { key: 'ecmwf_ifs025', label: 'ECMWF IFS', mapIds: ['ecmwf'] },
  { key: 'gfs_seamless', label: 'GFS', mapIds: ['gfs'] },
  { key: 'icon_seamless', label: 'ICON', mapIds: ['icon', 'iconeu'] },
];

const WAVE_VARS: Record<keyof WaveSeries, string> = {
  height: 'wave_height',
  direction: 'wave_direction',
  period: 'wave_period',
  peakPeriod: 'wave_peak_period',
  swellHeight: 'swell_wave_height',
  swellDirection: 'swell_wave_direction',
  swellPeriod: 'swell_wave_period',
  swell2Height: 'secondary_swell_wave_height',
  swell2Direction: 'secondary_swell_wave_direction',
  swell2Period: 'secondary_swell_wave_period',
  windWaveHeight: 'wind_wave_height',
  windWaveDirection: 'wind_wave_direction',
  windWavePeriod: 'wind_wave_period',
};

const WIND_VARS: Record<keyof WindSeries, string> = {
  speed: 'wind_speed_10m',
  gust: 'wind_gusts_10m',
  direction: 'wind_direction_10m',
  temperature: 'temperature_2m',
  precipitation: 'precipitation',
  cloud: 'cloud_cover',
};

/** Jours de prévision : 3 en version gratuite, jusqu'à 16 avec Premium, selon ce que fournit chaque modèle. */
export const FREE_DAYS = 5;
export const PREMIUM_DAYS = 16;

/**
 * Les modèles de la version gratuite : ceux de `DEFAULT_MODELS` du catalogue. Le serveur
 * refuse les autres sans Premium (`server/src/routes/meteo.ts`, à garder aligné).
 */
const forMap = (models: ForecastModel[], mapId: string): ForecastModel => models.find((m) => m.mapIds.includes(mapId)) ?? models[0];
const FREE_WAVE_MODEL = forMap(WAVE_FORECAST_MODELS, DEFAULT_MODELS.wave);
const FREE_WIND_MODEL = forMap(WIND_FORECAST_MODELS, DEFAULT_MODELS.atmo);

interface ApiResponse {
  hourly?: Record<string, (number | null)[]>;
  daily?: Record<string, (number | null)[]>;
}

/** Une demande au relais. Ses erreurs portent la phrase à montrer, et disent si la demande exige Premium. */
const call = (path: string, params: Record<string, string>): Promise<ApiResponse> => api<ApiResponse>(`${path}?${new URLSearchParams(params)}`);

/** Réaligne une série sur l'axe de temps commun. */
function align(times: number[], srcTimes: (number | null)[] | undefined, values: (number | null)[] | undefined): Series {
  if (!srcTimes || !values) return times.map(() => null);
  const byTime = new Map<number, number | null>();
  for (let i = 0; i < srcTimes.length; i++) {
    const t = srcTimes[i];
    if (t != null) byTime.set(t * 1000, values[i] ?? null);
  }
  return times.map((t) => byTime.get(t) ?? null);
}

const hasData = (s: Series) => s.some((v) => v != null);

const cache = new Map<string, { at: number; promise: Promise<unknown> }>();
const TTL = 15 * 60_000;

/** Une réponse gardée 15 minutes sous sa clé ; un échec n'est pas gardé. */
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.promise as Promise<T>;
  const promise = load();
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

/**
 * La prévision d'un point. Version gratuite : 5 jours et le seul modèle par défaut ;
 * Premium : 16 jours et tous les modèles. Les deux ne partagent pas le même cache.
 */
export function getForecast(lat: number, lon: number, premium: boolean): Promise<PointForecast> {
  return cached(`${premium ? 'premium' : 'gratuit'}:${lat.toFixed(3)},${lon.toFixed(3)}`, () => load(lat, lon, premium));
}

/** La hauteur des vagues prévue d'heure en heure (ms UTC), des deux jours passés à la fin du jour même. */
export interface RecentWaves {
  times: number[];
  height: Series;
}

/**
 * Ce qu'un modèle prévoyait des vagues sur les deux derniers jours, et prévoit pour le jour même : ce
 * qu'une bouée compare à ses mesures. Une demande à part de la prévision du point (`past_days=2`,
 * `forecast_days=1`, la seule hauteur des vagues, un seul modèle), dans le même cache, sous sa clé.
 */
export function getRecentWaves(lat: number, lon: number, model: string, premium: boolean): Promise<RecentWaves> {
  return cached(`${premium ? 'premium' : 'gratuit'}:passé:${model}:${lat.toFixed(3)},${lon.toFixed(3)}`, async () => {
    const res = await call('/api/meteo/marine', {
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: 'wave_height',
      models: model,
      past_days: '2',
      forecast_days: '1',
      timeformat: 'unixtime',
      timezone: 'GMT',
      cell_selection: 'sea',
    });
    const source = res.hourly?.time ?? [];
    const times = source.filter((t): t is number => t != null).map((t) => t * 1000);
    // Un seul modèle : l'API ne suffixe pas le nom de la variable.
    return { times, height: align(times, source, res.hourly?.wave_height) };
  });
}

/** Les types d'affichage de la ligne de temps qui ont leur propre demande (« Vagues et vent » garde celle du point). */
export type DetailProfile = 'swell' | 'wind' | 'weather' | 'tide';

/**
 * Les variables de chaque type, et son service : la houle sur le modèle de vagues de la carte, le vent et la
 * météo sur son modèle d'atmosphère, la marée et le courant sans modèle (Open-Meteo choisit le sien, comme
 * pour le niveau de la mer). Le relais n'accepte rien d'autre (`server/src/routes/meteo.ts`). La météo prend la
 * cellule la plus proche, terre comprise (`nearest`) : un point à terre a la météo de la terre, pas celle de la
 * case de mer la plus proche ; les autres types restent sur la mer.
 */
const DETAIL_REQUESTS: Record<
  DetailProfile,
  { path: '/api/meteo/marine' | '/api/meteo/forecast'; hourly: string[]; model: boolean; cell?: 'nearest' }
> = {
  swell: {
    path: '/api/meteo/marine',
    hourly: [
      'swell_wave_height',
      'swell_wave_period',
      'swell_wave_direction',
      'secondary_swell_wave_height',
      'secondary_swell_wave_period',
      'secondary_swell_wave_direction',
      'wind_wave_height',
      'wind_wave_period',
      'wind_wave_direction',
    ],
    model: true,
  },
  wind: { path: '/api/meteo/forecast', hourly: ['wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m'], model: true },
  weather: {
    path: '/api/meteo/forecast',
    hourly: ['temperature_2m', 'apparent_temperature', 'precipitation', 'weather_code', 'is_day', 'wind_speed_10m', 'wind_direction_10m'],
    model: true,
    cell: 'nearest',
  },
  tide: { path: '/api/meteo/marine', hourly: ['sea_level_height_msl', 'ocean_current_velocity', 'ocean_current_direction', 'sea_surface_temperature'], model: false },
};

/** Les séries d'un type, par nom de variable de l'API, en unités SI, sur leurs heures (ms UTC). */
export interface DetailSeries {
  times: number[];
  values: Record<string, Series>;
}

/**
 * Les séries d'un type d'affichage de la ligne de temps : une demande à part, faite quand on choisit le type,
 * avec ses seules variables et le modèle de la carte pour sa famille (`model`, ignoré pour la marée), dans le
 * même cache que la prévision du point, sous sa clé. Le courant arrive en km/h : il est rendu en m/s.
 */
export function getDetailSeries(profile: DetailProfile, lat: number, lon: number, model: string | null, premium: boolean): Promise<DetailSeries> {
  const spec = DETAIL_REQUESTS[profile];
  const used = spec.model ? model : null;
  return cached(`${premium ? 'premium' : 'gratuit'}:${profile}:${used ?? 'sans modèle'}:${lat.toFixed(3)},${lon.toFixed(3)}`, async () => {
    const res = await call(spec.path, {
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: spec.hourly.join(','),
      ...(used ? { models: used } : {}),
      forecast_days: String(premium ? PREMIUM_DAYS : FREE_DAYS),
      timeformat: 'unixtime',
      timezone: 'GMT',
      cell_selection: spec.cell ?? 'sea',
    });
    const source = res.hourly?.time ?? [];
    const times = source.filter((t): t is number => t != null).map((t) => t * 1000);
    const values: Record<string, Series> = {};
    // Un seul modèle, ou aucun : l'API ne suffixe pas le nom des variables.
    for (const variable of spec.hourly) values[variable] = align(times, source, res.hourly?.[variable]);
    if (values.ocean_current_velocity) values.ocean_current_velocity = values.ocean_current_velocity.map((v) => (v == null ? null : v / 3.6));
    return { times, values };
  });
}

async function load(lat: number, lon: number, premium: boolean): Promise<PointForecast> {
  const waveModels = premium ? WAVE_FORECAST_MODELS : [FREE_WAVE_MODEL];
  const windModels = premium ? WIND_FORECAST_MODELS : [FREE_WIND_MODEL];
  // Quand un seul modèle est demandé, l'API ne suffixe pas le nom des variables.
  const column = (variable: string, model: ForecastModel, models: ForecastModel[]) => (models.length === 1 ? variable : `${variable}_${model.key}`);
  const common = {
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    forecast_days: String(premium ? PREMIUM_DAYS : FREE_DAYS),
    timeformat: 'unixtime',
    timezone: 'GMT',
    cell_selection: 'sea',
  };
  const [waveRes, oceanRes, windRes] = await Promise.allSettled([
    call('/api/meteo/marine', {
      ...common,
      hourly: Object.values(WAVE_VARS).join(','),
      models: waveModels.map((m) => m.key).join(','),
    }),
    call('/api/meteo/marine', {
      ...common,
      hourly: 'sea_level_height_msl,sea_surface_temperature',
    }),
    call('/api/meteo/forecast', {
      ...common,
      hourly: [...Object.values(WIND_VARS), 'is_day'].join(','),
      daily: 'sunrise,sunset',
      models: windModels.map((m) => m.key).join(','),
      wind_speed_unit: 'ms',
    }),
  ]);

  // Le relais refuse ce que l'appli croyait permis (Premium terminé entre-temps) : la demande
  // entière échoue, pour être refaite une fois l'état du compte redemandé (`useForecast`).
  for (const res of [waveRes, oceanRes, windRes]) {
    if (res.status === 'rejected' && res.reason instanceof ApiError && res.reason.premium) throw res.reason;
  }

  const waveH = waveRes.status === 'fulfilled' ? waveRes.value.hourly : undefined;
  const oceanH = oceanRes.status === 'fulfilled' ? oceanRes.value.hourly : undefined;
  const windH = windRes.status === 'fulfilled' ? windRes.value.hourly : undefined;
  const master = windH?.time ?? waveH?.time ?? oceanH?.time;
  if (!master) {
    const reason = windRes.status === 'rejected' ? (windRes.reason as Error).message : 'réponse vide';
    throw new Error(`Prévisions indisponibles : ${reason}`);
  }
  const times = master.filter((t): t is number => t != null).map((t) => t * 1000);

  const wave: Record<string, WaveSeries> = {};
  for (const model of waveModels) {
    const series = {} as WaveSeries;
    for (const [field, variable] of Object.entries(WAVE_VARS) as [keyof WaveSeries, string][]) {
      series[field] = align(times, waveH?.time, waveH?.[column(variable, model, waveModels)]);
    }
    // Un modèle qui ne rend que des zéros ici masque ce point (GFS Wave sur les cellules côtières) :
    // il n'est ni retenu ni proposé, comme s'il n'avait rien rendu.
    if (series.height.some((v) => v != null && v > 0)) wave[model.key] = series;
  }

  const wind: Record<string, WindSeries> = {};
  for (const model of windModels) {
    const series = {} as WindSeries;
    for (const [field, variable] of Object.entries(WIND_VARS) as [keyof WindSeries, string][]) {
      series[field] = align(times, windH?.time, windH?.[column(variable, model, windModels)]);
    }
    if (hasData(series.speed)) wind[model.key] = series;
  }

  const firstKey = (obj: Record<string, unknown> | undefined, prefix: string) =>
    obj ? Object.keys(obj).find((k) => k === prefix || k.startsWith(`${prefix}_`)) : undefined;

  const dayKey = firstKey(windH, 'is_day');
  const isDay = dayKey ? align(times, windH?.time, windH?.[dayKey]) : null;

  const sun: PointForecast['sun'] = [];
  if (windRes.status === 'fulfilled' && windRes.value.daily) {
    const daily = windRes.value.daily;
    const rise = daily[firstKey(daily, 'sunrise') ?? ''];
    const set = daily[firstKey(daily, 'sunset') ?? ''];
    if (rise && set) {
      for (let i = 0; i < rise.length; i++) {
        const r = rise[i];
        const s = set[i];
        if (r != null && s != null) sun.push({ rise: r * 1000, set: s * 1000 });
      }
    }
  }

  const seaLevel = oceanH ? align(times, oceanH.time, oceanH.sea_level_height_msl) : null;
  const seaTemperature = oceanH ? align(times, oceanH.time, oceanH.sea_surface_temperature) : null;

  return {
    times,
    wave,
    wind,
    seaLevel: seaLevel && hasData(seaLevel) ? seaLevel : null,
    seaTemperature: seaTemperature && hasData(seaTemperature) ? seaTemperature : null,
    isDay: isDay && hasData(isDay) ? isDay : null,
    sun,
    waveError:
      Object.keys(wave).length > 0
        ? null
        : waveRes.status === 'rejected'
          ? 'Pas de données de vagues pour ce point.'
          : 'Aucun modèle de vagues ne couvre ce point (trop loin de la mer).',
    windError: Object.keys(wind).length > 0 ? null : 'Prévisions de vent indisponibles pour ce point.',
  };
}

export interface TideExtreme {
  time: number;
  level: number;
  high: boolean;
}

/** Pleines et basses mers, affinées par interpolation parabolique entre les points horaires. */
export function tideExtremes(times: number[], level: Series): TideExtreme[] {
  const out: TideExtreme[] = [];
  for (let i = 1; i < level.length - 1; i++) {
    const a = level[i - 1];
    const b = level[i];
    const c = level[i + 1];
    if (a == null || b == null || c == null) continue;
    const high = b > a && b >= c;
    const low = b < a && b <= c;
    if (!high && !low) continue;
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
    out.push({
      time: times[i] + shift * (times[i + 1] - times[i]),
      level: b - 0.25 * (a - c) * shift,
      high,
    });
  }
  return out;
}
