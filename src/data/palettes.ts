/**
 * Palettes de données : mêmes couleurs sur la carte (texture de correspondance)
 * et dans les tableaux de prévision. Les valeurs sont en unités SI.
 */
import type { PaletteId } from './catalog';

export type Rgba = [number, number, number, number];
type Stop = [value: number, color: string, alpha?: number];

export interface Palette {
  id: PaletteId;
  min: number;
  max: number;
  /** Table RGBA non prémultipliée, LUT_SIZE entrées réparties linéairement sur [min, max]. */
  lut: Uint8Array;
  /** Graduations de la légende (valeurs SI). */
  ticks: number[];
}

export const LUT_SIZE = 1024;

const HEIGHT: Stop[] = [
  [0, '#0d1b33'],
  [0.5, '#123a6e'],
  [1, '#1663a8'],
  [1.5, '#1a8db6'],
  [2, '#22b2a4'],
  [2.5, '#4dcc7c'],
  [3, '#a4da50'],
  [4, '#f1d03c'],
  [5, '#f59c30'],
  [6.5, '#e85230'],
  [8, '#c62c5a'],
  [10, '#91299d'],
  [13, '#ead8f6'],
];

const WIND: Stop[] = [
  [0, '#1c2c45'],
  [2.5, '#255a8d'],
  [5, '#2a8ba8'],
  [7.5, '#35b08c'],
  [10, '#7fcb58'],
  [13, '#d8d445'],
  [16, '#f3a936'],
  [20, '#ec6c34'],
  [25, '#d53c4e'],
  [30, '#a82f86'],
  [40, '#e8d6f3'],
];

const PERIOD: Stop[] = [
  [0, '#191d38'],
  [4, '#2a3b8c'],
  [7, '#3873c2'],
  [9, '#3babb8'],
  [11, '#5fcc88'],
  [13, '#c5da52'],
  [15, '#f4b93b'],
  [17, '#f07c36'],
  [20, '#d43f5c'],
  [24, '#f1d3e7'],
];

const TEMP: Stop[] = [
  [-30, '#cbb8ea'],
  [-20, '#7a60c1'],
  [-10, '#3d62c8'],
  [0, '#399fd5'],
  [5, '#45bfb0'],
  [10, '#6cce7b'],
  [15, '#c2da56'],
  [20, '#f1cf3f'],
  [25, '#f59c35'],
  [30, '#ea5c34'],
  [35, '#c9324f'],
  [45, '#7c1f5d'],
];

// Au-delà de 16 mm/h la couleur ne change plus : l'échelle reste lisible pour les pluies courantes.
const RAIN: Stop[] = [
  [0, '#3f7fc4', 0],
  [0.1, '#3f7fc4', 0.35],
  [0.5, '#3a90d6', 0.85],
  [1, '#36b2c8', 1],
  [2, '#43c78b', 1],
  [4, '#b5d74c', 1],
  [8, '#f2c93c', 1],
  [12, '#f08b34', 1],
  [16, '#d9385a', 1],
];

const CURRENT: Stop[] = [
  [0, '#0f1e36'],
  [0.1, '#174a7a'],
  [0.25, '#1d7fa6'],
  [0.5, '#2fb596'],
  [0.8, '#9bd655'],
  [1.2, '#f0cf3d'],
  [1.8, '#f08a33'],
  [2.5, '#d9405a'],
  [3.5, '#e9d5f2'],
];

function cloudStops(dark: boolean): Stop[] {
  const c = dark ? '#eef1f4' : '#4a5563';
  return [
    [0, c, 0],
    [15, c, 0.04],
    [50, c, 0.4],
    [85, c, 0.78],
    [100, c, 0.92],
  ];
}

const SPECS: Record<PaletteId, { stops: (dark: boolean) => Stop[]; ticks: number[] }> = {
  height: { stops: () => HEIGHT, ticks: [0, 1, 2, 3, 4, 6, 8, 12] },
  wind: { stops: () => WIND, ticks: [0, 2.57, 5.14, 7.72, 10.29, 15.43, 20.58, 30.87] },
  period: { stops: () => PERIOD, ticks: [0, 4, 8, 10, 12, 14, 17, 20] },
  temp: { stops: () => TEMP, ticks: [-20, -10, 0, 10, 20, 30, 40] },
  rain: { stops: () => RAIN, ticks: [0, 2, 4, 8, 12, 16] },
  clouds: { stops: cloudStops, ticks: [0, 25, 50, 75, 100] },
  current: { stops: () => CURRENT, ticks: [0, 0.25, 0.5, 1, 1.5, 2.5] },
};

/** Les palettes, et les points de couleur de chacune : pour les publier (`scripts/public-data.mjs`). */
export const PALETTE_IDS = Object.keys(SPECS) as PaletteId[];
export const paletteStops = (id: PaletteId, dark: boolean): [value: number, color: string, alpha?: number][] => SPECS[id].stops(dark);

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toLinear = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (x: number) => {
  const c = x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
};

function rgbToOklab([r8, g8, b8]: [number, number, number]): [number, number, number] {
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function buildLut(stops: Stop[]): Uint8Array {
  const min = stops[0][0];
  const max = stops[stops.length - 1][0];
  const labs = stops.map((s) => rgbToOklab(hexToRgb(s[1])));
  const lut = new Uint8Array(LUT_SIZE * 4);
  let seg = 0;
  for (let i = 0; i < LUT_SIZE; i++) {
    const value = min + ((max - min) * i) / (LUT_SIZE - 1);
    while (seg < stops.length - 2 && value > stops[seg + 1][0]) seg++;
    const [v0, , a0 = 1] = stops[seg];
    const [v1, , a1 = 1] = stops[seg + 1];
    const t = Math.min(1, Math.max(0, (value - v0) / (v1 - v0)));
    const A = labs[seg];
    const B = labs[seg + 1];
    const [r, g, b] = oklabToRgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
    lut[i * 4] = r;
    lut[i * 4 + 1] = g;
    lut[i * 4 + 2] = b;
    lut[i * 4 + 3] = Math.round((a0 + (a1 - a0) * t) * 255);
  }
  return lut;
}

const cache = new Map<string, Palette>();

export function getPalette(id: PaletteId, dark: boolean): Palette {
  const key = `${id}|${id === 'clouds' ? dark : ''}`;
  let p = cache.get(key);
  if (!p) {
    const spec = SPECS[id];
    const stops = spec.stops(dark);
    p = { id, min: stops[0][0], max: stops[stops.length - 1][0], lut: buildLut(stops), ticks: spec.ticks };
    cache.set(key, p);
  }
  return p;
}

export function paletteColor(p: Palette, value: number): Rgba {
  const t = Math.min(1, Math.max(0, (value - p.min) / (p.max - p.min)));
  const i = Math.round(t * (LUT_SIZE - 1)) * 4;
  return [p.lut[i], p.lut[i + 1], p.lut[i + 2], p.lut[i + 3] / 255];
}

/** Couleur de fond CSS d'une cellule de tableau, et encre lisible par-dessus. */
export function cellColors(p: Palette, value: number | null | undefined): { background: string; color: string } | null {
  if (value == null || !Number.isFinite(value)) return null;
  const [r, g, b, a] = paletteColor(p, value);
  const lum = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return {
    background: `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`,
    color: lum > 0.36 ? '#10151c' : '#f7f9fb',
  };
}

/** Dégradé CSS de la légende. */
export function paletteGradient(p: Palette, steps = 24): string {
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const [r, g, b, a] = paletteColor(p, p.min + ((p.max - p.min) * i) / steps);
    parts.push(`rgba(${r}, ${g}, ${b}, ${a.toFixed(2)}) ${((i / steps) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}
