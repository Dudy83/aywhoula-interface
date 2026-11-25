/**
 * Les petites fonctions de dessin des courbes, communes au détail du jour du panneau et à la ligne de
 * temps : même tracé, mêmes échelles rondes, mêmes chiffres.
 */
import type { Units } from '../lib/units';

/** Le trait d'une série ; une valeur manquante lève le crayon. */
export function pathFor(xs: number[], ys: (number | null)[]): string {
  let d = '';
  let pen = false;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i];
    if (y == null) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${xs[i].toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** L'aire sous une série, refermée sur `base` ; une valeur manquante la coupe. */
export function areaFor(xs: number[], ys: (number | null)[], base: number): string {
  let d = '';
  let start = -1;
  for (let i = 0; i <= xs.length; i++) {
    const y = i < xs.length ? ys[i] : null;
    if (y != null) {
      if (start < 0) {
        start = i;
        d += `M${xs[i].toFixed(1)} ${base}L${xs[i].toFixed(1)} ${y.toFixed(1)}`;
      } else {
        d += `L${xs[i].toFixed(1)} ${y.toFixed(1)}`;
      }
    } else if (start >= 0) {
      d += `L${xs[i - 1].toFixed(1)} ${base}Z`;
      start = -1;
    }
  }
  return d;
}

/** La première échelle ronde qui contient la valeur. */
export const niceMax = (v: number, steps: number[]): number => steps.find((s) => s >= v) ?? Math.ceil(v);

export const heightSteps = (units: Units): number[] => (units.height === 'ft' ? [3, 4, 6, 8, 12, 16, 20, 30, 40] : [1, 1.5, 2, 3, 4, 6, 8, 10, 14]);

export const windSteps = (units: Units): number[] =>
  units.wind === 'bft' ? [6, 8, 10, 12] : units.wind === 'ms' ? [10, 15, 20, 30, 40] : units.wind === 'kmh' ? [30, 40, 60, 80, 120, 160] : [15, 20, 30, 40, 60, 80];
