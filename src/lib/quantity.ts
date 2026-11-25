import type { Quantity } from '../data/catalog';
import { fmt, formatHeight, formatTemp, formatWind, HEIGHT_UNIT_LABEL, TEMP_UNIT_LABEL, WIND_UNIT_LABEL, type Units } from './units';

/** Unité affichée pour une grandeur, selon les préférences. */
export function quantityUnit(q: Quantity, units: Units): string {
  switch (q) {
    case 'height':
      return HEIGHT_UNIT_LABEL[units.height];
    case 'wind':
      return WIND_UNIT_LABEL[units.wind];
    case 'period':
      return 's';
    case 'rain':
      return 'mm/h';
    case 'percent':
      return '%';
    case 'temp':
      return TEMP_UNIT_LABEL[units.temp];
    case 'current':
      return units.wind === 'kn' ? 'nd' : 'm/s';
  }
}

/** Valeur SI -> texte dans l'unité choisie (sans l'unité). */
export function formatQuantity(q: Quantity, value: number, units: Units): string {
  switch (q) {
    case 'height':
      return formatHeight(value, units.height);
    case 'wind':
      return formatWind(value, units.wind);
    case 'period':
      return fmt(value, 0);
    case 'rain':
      return fmt(value, 1);
    case 'percent':
      return fmt(value, 0);
    case 'temp':
      return formatTemp(value, units.temp);
    case 'current':
      return units.wind === 'kn' ? fmt(value * 1.943844, 1) : fmt(value, 2);
  }
}

export interface Tick {
  /** Position sur l'échelle, en unité SI. */
  value: number;
  label: string;
}

const BEAUFORT_MS = [0, 0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
const plain = (values: number[], toSi: (v: number) => number, digits: 0 | 1 = 0): Tick[] =>
  values.map((v) => ({ value: toSi(v), label: fmt(v, v % 1 === 0 ? 0 : digits || 1) }));

/**
 * Graduations de la légende : des valeurs rondes dans l'unité affichée,
 * placées à leur position réelle sur l'échelle (qui, elle, est en SI).
 */
export function legendTicks(q: Quantity, units: Units, fallback: number[]): Tick[] {
  switch (q) {
    case 'height':
      return units.height === 'ft'
        ? plain([0, 3, 6, 10, 15, 20, 30, 40], (v) => v / 3.28084)
        : plain([0, 1, 2, 3, 4, 6, 8, 12], (v) => v);
    case 'wind':
      if (units.wind === 'kn') return plain([0, 10, 20, 30, 40, 60], (v) => v / 1.943844);
      if (units.wind === 'kmh') return plain([0, 20, 40, 60, 80, 120], (v) => v / 3.6);
      if (units.wind === 'bft') return plain([0, 2, 4, 6, 8, 10, 12], (v) => BEAUFORT_MS[v]);
      return plain([0, 5, 10, 15, 20, 30], (v) => v);
    case 'temp':
      return units.temp === 'f'
        ? plain([0, 20, 40, 60, 80, 100], (v) => (v - 32) / 1.8)
        : plain([-20, -10, 0, 10, 20, 30, 40], (v) => v);
    case 'current':
      return units.wind === 'kn'
        ? plain([0, 1, 2, 3, 5], (v) => v / 1.943844)
        : plain([0, 0.5, 1, 1.5, 2.5], (v) => v, 1);
    case 'rain':
      return fallback.map((v) => ({ value: v, label: v > 0 && v < 1 ? fmt(v, 1) : fmt(v) }));
    default:
      return fallback.map((v) => ({ value: v, label: fmt(v) }));
  }
}
