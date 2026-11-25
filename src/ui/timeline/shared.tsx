/**
 * Ce que partagent les courbes et le tableau de la ligne de temps : la géométrie des courbes, les jours de
 * l'axe, les légendes des couloirs, et l'étiquette des jours de Premium (version gratuite).
 */
import { useMemo } from 'react';
import { FREE_DAYS, PREMIUM_DAYS } from '../../data/forecast';
import { DAY, formatHour, HOUR, startOfLocalDay } from '../../lib/time';
import { fmt } from '../../lib/units';
import { BrandMark } from '../common';

export const nextDay = (day: number): number => startOfLocalDay(day + DAY + 3 * HOUR);
export const dayShort = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' });
export const dayLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
export const isNumber = (v: number | null): v is number => v != null && Number.isFinite(v);
export const offerLabel = `Premium : la prévision jusqu’à ${PREMIUM_DAYS} jours. Voir l’offre`;

/** Les jours de Premium, désactivés en version gratuite : du sixième au seizième. */
export const FOLDED_DAYS = PREMIUM_DAYS - FREE_DAYS;

/*
 * Géométrie des courbes (px), la même sur ordinateur et sur téléphone, et pour tous les types d'affichage.
 * De haut en bas : le titre du premier couloir, ce couloir, le titre du second, ce couloir, la ligne des
 * heures, celle des jours. L'échelle, dans sa colonne fixe à gauche, reprend les mêmes hauteurs.
 */
export const SCALE_W = 34;
export const HEAD_H = 16;
export const HEAD_GAP = 3;
export const LANE1_H = 90;
export const LANE2_H = 66;
export const LANE_GAP = 8;
export const AXIS_GAP = 6;
export const HOURS_H = 16;
export const DAYS_H = 18;
export const LANE1_TOP = HEAD_H + HEAD_GAP;
export const LANE2_HEAD_TOP = LANE1_TOP + LANE1_H + LANE_GAP;
export const LANE2_TOP = LANE2_HEAD_TOP + HEAD_H + HEAD_GAP;
export const AXIS_TOP = LANE2_TOP + LANE2_H + AXIS_GAP;
export const PLOT_H = AXIS_TOP + HOURS_H + DAYS_H;
export const LANE_H = [LANE1_H, LANE2_H] as const;
export const LANE_TOP = [LANE1_TOP, LANE2_TOP] as const;
/** Une bulle de valeur : sa hauteur, et l'écart entre elle et le curseur. */
export const BUBBLE_H = 18;
export const BUBBLE_GAP = 7;
/** Un jour d'au moins cette largeur montre 06 h, 12 h et 18 h ; plus étroit, 12 h seulement. */
export const THREE_HOURS_MIN_W = 140;
/** Un jour d'au moins cette largeur porte une flèche toutes les 3 heures ; plus étroit, toutes les 6. */
export const ARROWS_3H_MIN_W = 150;

/** La position dans un couloir de hauteur `h` d'une valeur entre `lo` et `hi` : `hi` à 4 px du haut, `lo` en bas. */
export function yIn(h: number, lo: number, hi: number, v: number): number {
  const c = Math.min(hi, Math.max(lo, v));
  return h - ((c - lo) / (hi - lo || 1)) * (h - 4);
}

/** Une valeur de l'échelle : « 4 m », « 1,5 m », « 0,75 m », « 0 » ; `signed` : « +4 m », « −4 m ». */
export function scaleLabel(v: number, unit: string, signed = false): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  const digits = Number.isInteger(a) ? 0 : Number.isInteger(Math.round(a * 1000) / 100) ? 1 : 2;
  const sign = v < 0 ? '−' : signed ? '+' : '';
  return `${sign}${fmt(a, digits)} ${unit}`;
}

/** Les 16 jours de l'axe à partir d'aujourd'hui (début de chaque jour, heure locale), refaits à chaque heure. */
export function useAxisDays(): number[] {
  const hour = Math.floor(Date.now() / HOUR);
  return useMemo(() => {
    const out: number[] = [];
    let day = startOfLocalDay(hour * HOUR);
    for (let k = 0; k < PREMIUM_DAYS; k++) {
      out.push(day);
      day = nextDay(day);
    }
    return out;
  }, [hour]);
}

/** « 15 » pour une heure ronde, « 15:30 » sinon (fuseaux décalés d'une demi-heure), comme le panneau. */
export function hourLabel(t: number): string {
  const d = new Date(t);
  return d.getMinutes() === 0 ? String(d.getHours()).padStart(2, '0') : formatHour(t);
}

/**
 * La légende d'une courbe dans le titre de son couloir : un petit trait dessiné comme elle (plein, pointillé,
 * d'accent), un carré pour des barres, ou le texte seul.
 */
export function LineKey({ label, kind = 'line', color }: { label: string; kind?: 'line' | 'dashed' | 'accent' | 'square' | 'text'; color?: string }) {
  return (
    <span className="tl-key">
      {kind === 'square' ? (
        <span className="tl-key-square" style={color ? { background: color } : undefined} aria-hidden="true" />
      ) : kind === 'text' ? null : (
        <svg width={16} height={6} viewBox="0 0 16 6" aria-hidden="true">
          <line className={kind === 'dashed' ? 'ov-gust' : kind === 'accent' ? 'ov-accent' : 'ov-line'} x1={1} x2={15} y1={3} y2={3} />
        </svg>
      )}
      {label}
    </span>
  );
}

/**
 * L'étiquette des jours de Premium : « +11 jours », et dessous le logo et « Premium » en accent, sur une petite
 * carte. Toucher la zone qui la porte ouvre l'offre.
 */
export function FoldLabel() {
  return (
    <span className="fold-label">
      <span className="fold-label-days">+{FOLDED_DAYS} jours</span>
      <span className="fold-label-brand">
        <span className="pbadge-tile" aria-hidden="true">
          <BrandMark />
        </span>
        Premium
      </span>
    </span>
  );
}
