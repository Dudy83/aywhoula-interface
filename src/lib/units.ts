export type WindUnit = 'kn' | 'kmh' | 'ms' | 'bft';
export type HeightUnit = 'm' | 'ft';
export type TempUnit = 'c' | 'f';

export interface Units {
  wind: WindUnit;
  height: HeightUnit;
  temp: TempUnit;
}

export const WIND_UNIT_LABEL: Record<WindUnit, string> = { kn: 'nd', kmh: 'km/h', ms: 'm/s', bft: 'Bft' };
export const HEIGHT_UNIT_LABEL: Record<HeightUnit, string> = { m: 'm', ft: 'ft' };
export const TEMP_UNIT_LABEL: Record<TempUnit, string> = { c: '°C', f: '°F' };

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmt(value: number, digits: 0 | 1 | 2 = 0): string {
  if (!Number.isFinite(value)) return '–';
  return (digits === 0 ? nf0 : digits === 1 ? nf1 : nf2).format(value);
}

const BEAUFORT_LIMITS = [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];

export function beaufort(ms: number): number {
  let b = 0;
  while (b < BEAUFORT_LIMITS.length && ms >= BEAUFORT_LIMITS[b]) b++;
  return b;
}

export function windValue(ms: number, unit: WindUnit): number {
  switch (unit) {
    case 'kn':
      return ms * 1.943844;
    case 'kmh':
      return ms * 3.6;
    case 'bft':
      return beaufort(ms);
    default:
      return ms;
  }
}

export function formatWind(ms: number | null | undefined, unit: WindUnit): string {
  if (ms == null || !Number.isFinite(ms)) return '–';
  return fmt(windValue(ms, unit), unit === 'ms' ? 1 : 0);
}

export function heightValue(m: number, unit: HeightUnit): number {
  return unit === 'ft' ? m * 3.28084 : m;
}

export function formatHeight(m: number | null | undefined, unit: HeightUnit): string {
  if (m == null || !Number.isFinite(m)) return '–';
  return fmt(heightValue(m, unit), 1);
}

export function tempValue(c: number, unit: TempUnit): number {
  return unit === 'f' ? c * 1.8 + 32 : c;
}

export function formatTemp(c: number | null | undefined, unit: TempUnit): string {
  if (c == null || !Number.isFinite(c)) return '–';
  return fmt(tempValue(c, unit), 0);
}

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

/** Point cardinal (notation française : O pour ouest) d'une direction en degrés. */
export function cardinal(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return '–';
  return CARDINALS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** La latitude et la longitude, chacune en un morceau : « 48,10° N », « 4,95° O ». */
export function coordParts(lat: number, lon: number): [string, string] {
  return [`${fmt(Math.abs(lat), 2)}° ${lat >= 0 ? 'N' : 'S'}`, `${fmt(Math.abs(lon), 2)}° ${lon >= 0 ? 'E' : 'O'}`];
}

export function formatCoord(lat: number, lon: number): string {
  return coordParts(lat, lon).join(' · ');
}
