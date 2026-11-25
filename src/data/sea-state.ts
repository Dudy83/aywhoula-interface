/**
 * L'état de la mer et du vent à une heure donnée, tel que le montrent le panneau de
 * prévision et la rose de sélection : mêmes modèles, même heure, mêmes chiffres.
 */
import { HOUR, nearestIndex } from '../lib/time';
import { WAVE_FORECAST_MODELS, WIND_FORECAST_MODELS, type ForecastModel, type PointForecast, type Series, type WaveSeries, type WindSeries } from './forecast';

export const at = (s: Series | null | undefined, i: number): number | null => (s ? (s[i] ?? null) : null);
export const hasData = (s: Series): boolean => s.some((v) => v != null);

/**
 * L'état de la mer mis en avant : la houle primaire quand le modèle la sépare
 * de la mer du vent, sinon les vagues totales.
 */
export interface Sea {
  label: 'Houle' | 'Vagues';
  height: Series;
  period: Series;
  direction: Series;
}

export function seaOf(wave: WaveSeries | null): Sea | null {
  if (!wave) return null;
  if (hasData(wave.swellHeight)) {
    return { label: 'Houle', height: wave.swellHeight, period: wave.swellPeriod, direction: wave.swellDirection };
  }
  return { label: 'Vagues', height: wave.height, period: hasData(wave.peakPeriod) ? wave.peakPeriod : wave.period, direction: wave.direction };
}

/** Les vagues totales, quand la houle mise en avant ne les montre pas déjà. */
export interface Total {
  height: Series;
  direction: Series;
}

export function totalOf(wave: WaveSeries | null, sea: Sea | null): Total | null {
  return wave && sea?.label === 'Houle' && hasData(wave.height) ? { height: wave.height, direction: wave.direction } : null;
}

/**
 * Modèle de la prévision ponctuelle : celui choisi dans le panneau ; sinon celui de la carte, s'il couvre
 * l'heure affichée (`covers`) ; sinon le premier de la liste qui la couvre (MFWAM s'arrête à 10 jours,
 * ECMWF WAM va à 15) ; sinon celui de la carte, sinon le premier disponible.
 */
export function pickModel(
  models: ForecastModel[],
  available: Record<string, unknown>,
  choice: string | null,
  mapId: string,
  covers?: (key: string) => boolean,
): string | null {
  if (choice && choice in available) return choice;
  const fromMap = models.find((m) => m.mapIds.includes(mapId) && m.key in available)?.key;
  if (fromMap && (!covers || covers(fromMap))) return fromMap;
  const covering = covers ? models.find((m) => m.key in available && covers(m.key))?.key : undefined;
  return covering ?? fromMap ?? models.find((m) => m.key in available)?.key ?? null;
}

/** Modèles choisis pour la prévision d'un lieu (`null` : celui de la carte). L'appli n'en propose plus d'autre : ils restent à `null`. */
export interface ForecastChoice {
  wave: string | null;
  wind: string | null;
}

/** Les séries de vagues et de vent retenues pour un point, pour le panneau comme pour la rose. */
export function pickSeries(fc: PointForecast, choice: ForecastChoice, mapModels: { wave: string; atmo: string }, index?: number) {
  // `index` : l'heure affichée ; le modèle retenu doit la couvrir, si l'un d'eux le peut.
  const covered = (series: Series | undefined): boolean => index != null && index >= 0 && series?.[index] != null;
  const waveCovers = index == null ? undefined : (key: string) => covered(fc.wave[key]?.height);
  const windCovers = index == null ? undefined : (key: string) => covered(fc.wind[key]?.speed);
  const waveKey = pickModel(WAVE_FORECAST_MODELS, fc.wave, choice.wave, mapModels.wave, waveCovers);
  const windKey = pickModel(WIND_FORECAST_MODELS, fc.wind, choice.wind, mapModels.atmo, windCovers);
  return {
    waveKey,
    windKey,
    wave: waveKey ? fc.wave[waveKey] : null,
    wind: windKey ? fc.wind[windKey] : null,
  };
}

/** Index de l'heure affichée (`hour` = heure du store arrondie, en heures) dans les heures de la prévision. */
export function hourIndex(times: readonly number[], hour: number): number {
  return Math.max(0, nearestIndex(times, (hour || Math.round(Date.now() / HOUR)) * HOUR));
}

/**
 * L'heure affichée sur la carte dépasse-t-elle la prévision du point ? La carte va plus loin
 * que les jours de la version gratuite : le panneau et la rose ne montrent alors pas la
 * dernière heure connue à la place d'une heure qu'ils n'ont pas.
 */
export function beyondForecast(times: readonly number[], hour: number): boolean {
  return times.length > 0 && hour > 0 && hour * HOUR > times[times.length - 1] + HOUR / 2;
}

/** Hauteur à partir de laquelle la 2ᵉ houle est montrée : la même que dans « Autres mesures ». */
export const SWELL2_MIN = 0.05;

export type RoseKey = 'waves' | 'swell' | 'swell2' | 'wind';

/** Une flèche de la rose de sélection. Valeurs en unités SI. */
export interface RoseArrow {
  key: RoseKey;
  name: string;
  /** Direction de provenance, en degrés. */
  from: number;
  /** Hauteur (m) ou vitesse du vent (m/s). */
  value: number;
  /** Période (s), quand l'étiquette la donne. */
  period: number | null;
  /** Rafale (m/s), pour le vent. */
  gust: number | null;
}

/** Ordre des flèches, qui est aussi celui de leur apparition. */
export const ROSE_KEYS: readonly RoseKey[] = ['waves', 'swell', 'swell2', 'wind'];

const num = (v: number | null): v is number => v != null && Number.isFinite(v);

/**
 * Les flèches de la rose à un index de la prévision. Mêmes règles que le panneau : la houle
 * quand le modèle la sépare (les vagues totales s'ajoutent alors, sans période), sinon les
 * vagues totales avec leur période ; la 2ᵉ houle à partir de `SWELL2_MIN` ; le vent avec sa
 * rafale. Une flèche dont la valeur ou la direction manque n'est pas donnée.
 */
export function roseAt(wave: WaveSeries | null, wind: WindSeries | null, index: number): RoseArrow[] {
  const out: RoseArrow[] = [];
  const sea = seaOf(wave);
  if (wave && sea?.label === 'Houle') {
    const h = at(wave.height, index);
    const d = at(wave.direction, index);
    if (num(h) && num(d)) out.push({ key: 'waves', name: 'Vagues', from: d, value: h, period: null, gust: null });
    const sh = at(wave.swellHeight, index);
    const sd = at(wave.swellDirection, index);
    if (num(sh) && num(sd)) out.push({ key: 'swell', name: 'Houle', from: sd, value: sh, period: at(wave.swellPeriod, index), gust: null });
    const s2 = at(wave.swell2Height, index);
    const s2d = at(wave.swell2Direction, index);
    if (num(s2) && s2 >= SWELL2_MIN && num(s2d)) {
      out.push({ key: 'swell2', name: '2ᵉ houle', from: s2d, value: s2, period: at(wave.swell2Period, index), gust: null });
    }
  } else if (sea) {
    const h = at(sea.height, index);
    const d = at(sea.direction, index);
    if (num(h) && num(d)) out.push({ key: 'waves', name: 'Vagues', from: d, value: h, period: at(sea.period, index), gust: null });
  }
  if (wind) {
    const v = at(wind.speed, index);
    const d = at(wind.direction, index);
    if (num(v) && num(d)) out.push({ key: 'wind', name: 'Vent', from: d, value: v, period: null, gust: at(wind.gust, index) });
  }
  return out;
}
