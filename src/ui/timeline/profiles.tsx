/**
 * Les cinq types d'affichage de la ligne de temps : ce que montrent le tableau (deux groupes de lignes,
 * séparés par un filet) et les courbes (deux couloirs de hauteur fixe, leurs échelles, leurs bulles). La
 * géométrie ne change pas d'un type à l'autre ; les valeurs suivent les unités des réglages, et une donnée
 * absente s'affiche « – », sans courbe.
 */
import {
  Anchor,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Layers,
  Moon,
  Sun,
  Waves,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { tideExtremes, type PointForecast, type Series, type WaveSeries, type WindSeries } from '../../data/forecast';
import { cellColors, type Palette } from '../../data/palettes';
import { at, type Sea, type Total } from '../../data/sea-state';
import { formatQuantity, quantityUnit } from '../../lib/quantity';
import { formatHour } from '../../lib/time';
import {
  beaufort,
  cardinal,
  fmt,
  formatHeight,
  formatTemp,
  formatWind,
  heightValue,
  HEIGHT_UNIT_LABEL,
  tempValue,
  TEMP_UNIT_LABEL,
  windValue,
  WIND_UNIT_LABEL,
  type HeightUnit,
  type Units,
  type WindUnit,
} from '../../lib/units';
import type { TimelineProfile } from '../../state/store';
import { areaFor, heightSteps, niceMax, pathFor, windSteps } from '../chart';
import { Arrow, Chip, CURRENT, HEIGHT, PERIOD, RAIN, TEMP, WIND } from '../common';
import { ARROWS_3H_MIN_W, BUBBLE_H, isNumber, LANE1_H, LANE2_H, LineKey, scaleLabel, yIn } from './shared';

/* ------------------------------------------------------------------- types */

export interface ProfileMeta {
  id: TimelineProfile;
  name: string;
  /** Le nom du déclencheur sous 900 px. */
  short: string;
  icon: LucideIcon;
  text: string;
}

export const PROFILES: ProfileMeta[] = [
  { id: 'waves', name: 'Vagues et vent', short: 'Vagues', icon: Waves, text: 'Houle, vagues, période et vent : pour le surf.' },
  { id: 'swell', name: 'Houle en détail', short: 'Houle', icon: Layers, text: 'Les deux houles et la mer du vent, avec leurs périodes.' },
  { id: 'wind', name: 'Vent', short: 'Vent', icon: Wind, text: 'Vent, rafales, direction et force : kite, windsurf, voile.' },
  { id: 'weather', name: 'Météo', short: 'Météo', icon: CloudSun, text: 'Ciel, température, pluie et vent.' },
  { id: 'tide', name: 'Marée et courant', short: 'Marée', icon: Anchor, text: 'Hauteur d’eau, courant et température de l’eau.' },
];

export const PROFILE_BY_ID = Object.fromEntries(PROFILES.map((p) => [p.id, p])) as Record<TimelineProfile, ProfileMeta>;

/** Ce que les types lisent : la prévision du point, ses séries retenues, et celles du type (par variable). */
export interface Ctx {
  units: Units;
  fc: PointForecast;
  wave: WaveSeries | null;
  wind: WindSeries | null;
  sea: Sea | null;
  total: Total | null;
  d: Record<string, Series> | null;
}

/**
 * Une ligne du tableau : son libellé, son unité, sa case pour une heure, et ce qu'elle dit à un lecteur d'écran.
 * `tall` : sa case porte une flèche sous la valeur (32 px de haut au lieu de 20).
 */
export interface Row {
  label: string;
  unit?: string;
  cell: (i: number) => ReactNode;
  say: (i: number) => string;
  tall?: boolean;
}

/** Ce que les courbes savent de l'axe : les points du pas, toutes les heures ouvertes, la position d'un instant. */
export interface Geo {
  times: number[];
  pts: number[];
  xs: number[];
  hourly: number[];
  x: (t: number) => number;
  width: number;
  dayW: number;
  /** Préfixe des identifiants des dégradés de ce graphique. */
  id: string;
  /** L'heure de la carte dans la prévision, ou -1. */
  here: number;
}

/** Un couloir : sa légende, son unité, son échelle, son dessin, et les pastilles du curseur. */
export interface Lane {
  keys: ReactNode;
  unit: string;
  ticks: { y: number; label: string }[];
  body: ReactNode;
  dots: number[];
}

/** Une bulle accrochée au curseur, centrée à `y` dans son couloir ; `dir` ajoute une flèche et une direction. */
export interface Bubble {
  lane: 0 | 1;
  y: number;
  text: string;
  dir?: { from: number; label: string };
}

/** Une pastille ronde posée au-dessus d'une courbe (le ciel de la météo), à `y` dans le premier couloir. */
export interface Pill {
  key: number;
  x: number;
  y: number;
  icon: LucideIcon;
  label: string;
}

export interface Curves {
  lanes: [Lane, Lane];
  bubbles: Bubble[];
  pills: Pill[];
}

/* --------------------------------------------------------------- utilitaires */

const HEIGHT_WORD: Record<HeightUnit, string> = { m: 'm', ft: 'pieds' };
const WIND_WORD: Record<WindUnit, string> = { kn: 'nœuds', kmh: 'km/h', ms: 'm/s', bft: 'Beaufort' };
const ARROW_PATH = 'M8 1.5 12.6 13 8 10.4 3.4 13Z';

const series = (ctx: Ctx, name: string): Series | null => ctx.d?.[name] ?? null;
const valuesAt = (s: Series | null | undefined, pts: number[]) => pts.map((i) => at(s, i));
const maxOf = (...lists: (number | null)[][]) => Math.max(...lists.flat().filter(isNumber));
const periodText = (p: number | null) => (p == null ? 'inconnue' : `${fmt(p)} secondes`);

/** La valeur du courant dans l'unité affichée : en nœuds avec le vent en nœuds, sinon en m/s. */
const currentValue = (ms: number, units: Units) => (units.wind === 'kn' ? ms * 1.943844 : ms);
const currentSteps = (units: Units) => (units.wind === 'kn' ? [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8] : [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]);
const tideSteps = (units: Units) => (units.height === 'ft' ? [2, 3, 4, 6, 8, 10, 15, 20, 30] : [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10]);
const RAIN_STEPS = [1, 2, 4, 6, 10, 15, 20];

/** Les graduations d'une échelle de `lo` à `hi` : le haut, le milieu et le bas. */
function ticksFor(h: number, lo: number, hi: number, label: (v: number) => string) {
  return [hi, (lo + hi) / 2, lo].map((v) => ({ y: yIn(h, lo, hi, v), label: label(v) }));
}

/** Le dégradé d'une palette sous une courbe (130 arrêts au plus), ou l'aire grise quand il n'a pas de quoi se tracer. */
function gradient(id: string, palette: Palette, values: (number | null)[], xs: number[], width: number): { defs: ReactNode; fill?: string } {
  const stride = Math.max(1, Math.ceil(values.length / 130));
  const stops = values.flatMap((v, k) => {
    if (k % stride !== 0) return [];
    const colors = cellColors(palette, v);
    return colors ? [{ key: k, offset: Math.min(1, Math.max(0, xs[k] / width)), color: colors.background }] : [];
  });
  if (stops.length < 2) return { defs: null };
  return {
    defs: (
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={0} x2={width} y1={0} y2={0}>
          {stops.map((s) => (
            <stop key={s.key} offset={s.offset} stopColor={s.color} />
          ))}
        </linearGradient>
      </defs>
    ),
    fill: `url(#${id})`,
  };
}

function area(d: string, g: { fill?: string }) {
  return <path d={d} fill={g.fill} className={g.fill ? undefined : 'ov-area'} />;
}

/** Une flèche dessinée dans un couloir, qui pointe vers `towards` (degrés, dans le sens des aiguilles d'une montre). */
function arrowAt(key: string | number, x: number, y: number, towards: number, size: number, color?: string) {
  return (
    <path
      key={key}
      className="tl-arrow"
      d={ARROW_PATH}
      style={color ? { fill: color } : undefined}
      transform={`translate(${x.toFixed(1)} ${y}) rotate(${Math.round(towards)}) scale(${size / 16}) translate(-8 -8)`}
    />
  );
}

/** Les heures où se pose un repère (une flèche) : toutes les 3 h quand un jour est assez large, sinon toutes les 6. */
const markEvery = (geo: Geo) => (geo.dayW >= ARROWS_3H_MIN_W ? 3 : 6);
const hourOf = (t: number) => new Date(t).getHours();

/* ------------------------------------------------------------- les cases */

const heightCell = (units: Units, m: number | null, from?: number | null) => <Chip value={m} text={formatHeight(m, units.height)} palette={HEIGHT} from={from} />;
const periodCell = (p: number | null) => <Chip value={p} text={p == null ? '–' : fmt(p)} palette={PERIOD} />;
const windCell = (units: Units, ms: number | null) => <Chip value={ms} text={formatWind(ms, units.wind)} palette={WIND} />;
const tempCell = (units: Units, c: number | null) => <Chip value={c} text={formatTemp(c, units.temp)} palette={TEMP} />;

/** La direction d'où vient le vent : la flèche (vers où il va) et la provenance en lettres. */
const fromCell = (deg: number | null) => (
  <span className="hourcol-dir">
    <Arrow from={deg} size={13} />
    <span>{cardinal(deg)}</span>
  </span>
);

/** La direction où porte un courant : la flèche et la direction en lettres. */
const towardsCell = (deg: number | null) => (
  <span className="hourcol-dir">
    <Arrow from={deg == null ? null : deg + 180} size={13} />
    <span>{cardinal(deg)}</span>
  </span>
);

/** Le ciel d'une heure, d'après le code du temps présent (WMO) et le jour ou la nuit. */
export function skyOf(code: number | null, day: boolean): { icon: LucideIcon; word: string } | null {
  if (code == null) return null;
  if (code === 0) return { icon: day ? Sun : Moon, word: 'dégagé' };
  if (code <= 2) return { icon: day ? CloudSun : CloudMoon, word: 'quelques nuages' };
  if (code === 3) return { icon: Cloud, word: 'couvert' };
  if (code === 45 || code === 48) return { icon: CloudFog, word: 'brouillard' };
  if (code >= 51 && code <= 57) return { icon: CloudDrizzle, word: 'bruine' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: CloudRain, word: code >= 80 ? 'averses' : 'pluie' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: CloudSnow, word: 'neige' };
  if (code > 86) return { icon: CloudLightning, word: 'orage' };
  return { icon: Cloud, word: 'nuageux' };
}

const isDayAt = (ctx: Ctx, i: number) => at(series(ctx, 'is_day'), i) !== 0;

const skyCell = (ctx: Ctx, i: number) => {
  const sky = skyOf(at(series(ctx, 'weather_code'), i), isDayAt(ctx, i));
  if (!sky) return <span className="chip" data-empty>–</span>;
  const Icon = sky.icon;
  return (
    <span className="hourcol-sky" title={sky.word}>
      <Icon size={18} aria-hidden="true" />
    </span>
  );
};

/** La pluie d'une heure : une case neutre « 0 » sans pluie, sinon à la couleur de sa palette. */
const rainCell = (mm: number | null) => {
  if (mm == null) return <Chip value={null} text="–" palette={RAIN} />;
  if (mm < 0.05) {
    return (
      <span className="chip" data-neutral>
        0
      </span>
    );
  }
  return <Chip value={mm} text={fmt(mm, 1)} palette={RAIN} />;
};
const rainText = (mm: number | null) => (mm == null ? 'pluie inconnue' : mm < 0.05 ? 'pas de pluie' : `pluie ${fmt(mm, 1)} mm`);

/** La marée monte-t-elle à cette heure ? D'après l'heure d'avant et celle d'après. */
function rising(level: Series | null, i: number): boolean | null {
  const now = at(level, i);
  if (now == null) return null;
  const next = at(level, i + 1);
  const prev = at(level, i - 1);
  if (next != null && prev != null) return next > prev;
  if (next != null) return next > now;
  if (prev != null) return now > prev;
  return null;
}

const tideCell = (units: Units, level: Series | null, i: number) => {
  const m = at(level, i);
  if (m == null) return <Chip value={null} text="–" palette={HEIGHT} />;
  const up = rising(level, i);
  return (
    <span className="chip" data-neutral data-dir={up == null ? undefined : true}>
      {formatHeight(m, units.height)}
      {up != null && <Arrow from={up ? 180 : 0} size={11} />}
    </span>
  );
};

/* -------------------------------------------------------------- le tableau */

/** Les lignes dont la case porte une flèche : les hauteurs avec leur provenance, les directions, la marée. */
const TALL = new Set(['Vagues', 'Houle', 'Houle 1', 'Houle 2', 'Mer du vent', 'Vient de', 'Va vers', 'Marée']);

/** Les deux groupes de lignes du tableau d'un type. */
export function tableRows(profile: TimelineProfile, ctx: Ctx): { top: Row[]; bottom: Row[] } {
  const rows = rowsOf(profile, ctx);
  const mark = (r: Row): Row => ({ ...r, tall: TALL.has(r.label) });
  return { top: rows.top.map(mark), bottom: rows.bottom.map(mark) };
}

function rowsOf(profile: TimelineProfile, ctx: Ctx): { top: Row[]; bottom: Row[] } {
  const { units, sea, total, wind, wave } = ctx;
  const hUnit = HEIGHT_UNIT_LABEL[units.height];
  const wUnit = WIND_UNIT_LABEL[units.wind];
  const tUnit = TEMP_UNIT_LABEL[units.temp];
  const v = (name: string, i: number) => at(series(ctx, name), i);
  const heightSay = (label: string, m: number | null, from?: number | null) =>
    `${label} ${formatHeight(m, units.height)} ${hUnit}${from != null && m != null ? `, de ${cardinal(from)}` : ''}`;
  const waves: Row = {
    label: 'Vagues',
    unit: hUnit,
    cell: (i) => heightCell(units, at(wave?.height, i), at(wave?.direction, i)),
    say: (i) => heightSay('vagues', at(wave?.height, i), at(wave?.direction, i)),
  };

  switch (profile) {
    case 'swell': {
      const swellRows = (label: string, prefix: string): Row[] => [
        {
          label,
          unit: hUnit,
          cell: (i) => heightCell(units, v(`${prefix}_height`, i), v(`${prefix}_direction`, i)),
          say: (i) => heightSay(label.toLowerCase(), v(`${prefix}_height`, i), v(`${prefix}_direction`, i)),
        },
        { label: 'Période', unit: 's', cell: (i) => periodCell(v(`${prefix}_period`, i)), say: (i) => `période ${periodText(v(`${prefix}_period`, i))}` },
      ];
      return {
        top: [...swellRows('Houle 1', 'swell_wave'), ...swellRows('Houle 2', 'secondary_swell_wave')],
        bottom: swellRows('Mer du vent', 'wind_wave'),
      };
    }
    case 'wind':
      return {
        top: [
          { label: 'Vent', unit: wUnit, cell: (i) => windCell(units, v('wind_speed_10m', i)), say: (i) => `vent ${formatWind(v('wind_speed_10m', i), units.wind)} ${wUnit}` },
          { label: 'Rafales', unit: wUnit, cell: (i) => windCell(units, v('wind_gusts_10m', i)), say: (i) => `rafales ${formatWind(v('wind_gusts_10m', i), units.wind)} ${wUnit}` },
          {
            label: 'Force',
            unit: 'Beaufort',
            cell: (i) => {
              const ms = v('wind_speed_10m', i);
              return <Chip value={ms} text={ms == null ? '–' : String(beaufort(ms))} palette={WIND} />;
            },
            say: (i) => {
              const ms = v('wind_speed_10m', i);
              return ms == null ? 'force inconnue' : `force ${beaufort(ms)}`;
            },
          },
        ],
        bottom: [
          { label: 'Vient de', cell: (i) => fromCell(v('wind_direction_10m', i)), say: (i) => `de ${cardinal(v('wind_direction_10m', i))}` },
          waves,
        ],
      };
    case 'weather':
      return {
        top: [
          {
            label: 'Ciel',
            cell: (i) => skyCell(ctx, i),
            say: (i) => `ciel ${skyOf(v('weather_code', i), isDayAt(ctx, i))?.word ?? 'inconnu'}`,
          },
          { label: 'Temp.', unit: tUnit, cell: (i) => tempCell(units, v('temperature_2m', i)), say: (i) => `température ${formatTemp(v('temperature_2m', i), units.temp)} ${tUnit}` },
          { label: 'Ressenti', unit: tUnit, cell: (i) => tempCell(units, v('apparent_temperature', i)), say: (i) => `ressenti ${formatTemp(v('apparent_temperature', i), units.temp)} ${tUnit}` },
          { label: 'Pluie', unit: 'mm', cell: (i) => rainCell(v('precipitation', i)), say: (i) => rainText(v('precipitation', i)) },
        ],
        bottom: [
          { label: 'Vent', unit: wUnit, cell: (i) => windCell(units, v('wind_speed_10m', i)), say: (i) => `vent ${formatWind(v('wind_speed_10m', i), units.wind)} ${wUnit}` },
          { label: 'Vient de', cell: (i) => fromCell(v('wind_direction_10m', i)), say: (i) => `de ${cardinal(v('wind_direction_10m', i))}` },
        ],
      };
    case 'tide': {
      const level = series(ctx, 'sea_level_height_msl');
      const cUnit = quantityUnit('current', units);
      return {
        top: [
          {
            label: 'Marée',
            unit: hUnit,
            cell: (i) => tideCell(units, level, i),
            say: (i) => {
              const up = rising(level, i);
              return `marée ${formatHeight(at(level, i), units.height)} ${hUnit}${up == null ? '' : up ? ', montante' : ', descendante'}`;
            },
          },
          {
            label: 'Courant',
            unit: cUnit,
            cell: (i) => {
              const ms = v('ocean_current_velocity', i);
              return <Chip value={ms} text={ms == null ? '–' : formatQuantity('current', ms, units)} palette={CURRENT} />;
            },
            say: (i) => {
              const ms = v('ocean_current_velocity', i);
              return `courant ${ms == null ? 'inconnu' : `${formatQuantity('current', ms, units)} ${cUnit}`}`;
            },
          },
          { label: 'Va vers', cell: (i) => towardsCell(v('ocean_current_direction', i)), say: (i) => `vers ${cardinal(v('ocean_current_direction', i))}` },
        ],
        bottom: [
          {
            label: 'Eau',
            unit: tUnit,
            cell: (i) => {
              const c = v('sea_surface_temperature', i);
              return <Chip value={c} text={c == null ? '–' : fmt(tempValue(c, units.temp), 1)} palette={TEMP} />;
            },
            say: (i) => {
              const c = v('sea_surface_temperature', i);
              return `eau ${c == null ? 'inconnue' : `${fmt(tempValue(c, units.temp), 1)} ${tUnit}`}`;
            },
          },
          waves,
        ],
      };
    }
    default: {
      // Vagues et vent : l'affichage d'avant les types, sans changement.
      const seaLabel = sea?.label ?? 'Vagues';
      return {
        top: [
          ...(total
            ? [
                {
                  label: 'Vagues',
                  unit: hUnit,
                  cell: (i: number) => heightCell(units, at(total.height, i), at(total.direction, i)),
                  say: (i: number) => `vagues ${formatHeight(at(total.height, i), units.height)} ${hUnit}`,
                },
              ]
            : []),
          {
            label: seaLabel,
            unit: hUnit,
            cell: (i) => heightCell(units, at(sea?.height, i), at(sea?.direction, i)),
            say: (i) => `${seaLabel.toLowerCase()} ${formatHeight(at(sea?.height, i), units.height)} ${hUnit}`,
          },
          { label: 'Période', unit: 's', cell: (i) => periodCell(at(sea?.period, i)), say: (i) => `période ${periodText(at(sea?.period, i))}` },
        ],
        bottom: [
          { label: 'Vent', unit: wUnit, cell: (i) => windCell(units, at(wind?.speed, i)), say: (i) => `vent ${formatWind(at(wind?.speed, i), units.wind)} ${wUnit}` },
          { label: 'Rafales', unit: wUnit, cell: (i) => windCell(units, at(wind?.gust, i)), say: (i) => `rafales ${formatWind(at(wind?.gust, i), units.wind)} ${wUnit}` },
          { label: 'Vient de', cell: (i) => fromCell(at(wind?.direction, i)), say: (i) => `de ${cardinal(at(wind?.direction, i))}` },
        ],
      };
    }
  }
}

/* -------------------------------------------------------------- les courbes */

/** Les deux couloirs d'un type, ses bulles et, pour la météo, les pastilles du ciel. */
export function curvesFor(profile: TimelineProfile, ctx: Ctx, geo: Geo): Curves {
  switch (profile) {
    case 'swell':
      return swellCurves(ctx, geo);
    case 'wind':
      return windCurves(ctx, geo);
    case 'weather':
      return weatherCurves(ctx, geo);
    case 'tide':
      return tideCurves(ctx, geo);
    default:
      return wavesCurves(ctx, geo);
  }
}

/** Le couloir du vent et des rafales, en commun à « Vagues et vent » et à « Vent » (ce dernier avec le dégradé). */
function windLane(ctx: Ctx, geo: Geo, h: number, speed: Series | null, gust: Series | null, colored: boolean) {
  const { units } = ctx;
  const wUnit = WIND_UNIT_LABEL[units.wind];
  const speeds = valuesAt(speed, geo.pts);
  const gusts = valuesAt(gust, geo.pts);
  const top = niceMax(windValue(Math.max(5, maxOf(speeds, gusts)), units.wind), windSteps(units));
  const y = (ms: number | null) => (ms == null ? null : yIn(h, 0, top, windValue(ms, units.wind)));
  const g = colored ? gradient(`${geo.id}w`, WIND, speeds, geo.xs, geo.width) : { defs: null };
  const now = geo.here >= 0 ? at(speed, geo.here) : null;
  const gustNow = geo.here >= 0 ? at(gust, geo.here) : null;
  const lane: Lane = {
    keys: (
      <>
        <LineKey label="Vent" />
        <LineKey label="Rafales" kind="dashed" />
      </>
    ),
    unit: `vitesse, en ${WIND_WORD[units.wind]}`,
    ticks: speeds.some(isNumber) ? ticksFor(h, 0, top, (v) => scaleLabel(v, wUnit)) : [],
    body: (
      <>
        {g.defs}
        {area(areaFor(geo.xs, speeds.map(y), h), g)}
        <path className="ov-gust" d={pathFor(geo.xs, gusts.map(y))} />
        <path className="ov-line" d={pathFor(geo.xs, speeds.map(y))} />
      </>
    ),
    dots: now != null ? [y(now)!] : [],
  };
  return { lane, now, gustNow, y };
}

function wavesCurves(ctx: Ctx, geo: Geo): Curves {
  const { units, sea, total, wind } = ctx;
  const hUnit = HEIGHT_UNIT_LABEL[units.height];
  const wUnit = WIND_UNIT_LABEL[units.wind];
  const seaValues = valuesAt(sea?.height, geo.pts);
  const totals = total ? valuesAt(total.height, geo.pts) : [];
  const top = niceMax(heightValue(Math.max(0.5, maxOf(seaValues, totals)), units.height), heightSteps(units));
  const y = (m: number | null) => (m == null ? null : yIn(LANE1_H, 0, top, heightValue(m, units.height)));
  const g = gradient(`${geo.id}s`, HEIGHT, seaValues, geo.xs, geo.width);
  const seaNow = geo.here >= 0 ? at(sea?.height, geo.here) : null;
  const totalNow = geo.here >= 0 && total ? at(total.height, geo.here) : null;
  const windFrom = geo.here >= 0 ? at(wind?.direction, geo.here) : null;
  const w = windLane(ctx, geo, LANE2_H, wind?.speed ?? null, wind?.gust ?? null, false);

  const bubbles: Bubble[] = [];
  if (seaNow != null) {
    const seaY = y(seaNow)!;
    // Les vagues juste au-dessus de la houle, sur sa pastille.
    if (totalNow != null) bubbles.push({ lane: 0, y: seaY - BUBBLE_H - 2, text: `vagues ${formatHeight(totalNow, units.height)} ${hUnit}` });
    bubbles.push({ lane: 0, y: seaY, text: `${(sea?.label ?? 'Vagues').toLowerCase()} ${formatHeight(seaNow, units.height)} ${hUnit}` });
  }
  if (w.now != null) {
    bubbles.push({ lane: 1, y: w.y(w.now)!, text: `vent ${formatWind(w.now, units.wind)} ${wUnit}`, dir: windFrom == null ? undefined : { from: windFrom, label: cardinal(windFrom) } });
  }

  return {
    lanes: [
      {
        keys: (
          <>
            <LineKey label={sea?.label ?? 'Vagues'} />
            {total && <LineKey label="Vagues" kind="dashed" />}
          </>
        ),
        unit: `hauteur, en ${HEIGHT_WORD[units.height]}`,
        ticks: seaValues.some(isNumber) ? ticksFor(LANE1_H, 0, top, (v) => scaleLabel(v, hUnit)) : [],
        body: (
          <>
            {g.defs}
            {area(areaFor(geo.xs, seaValues.map(y), LANE1_H), g)}
            {total && <path className="ov-gust" d={pathFor(geo.xs, totals.map(y))} />}
            <path className="ov-line" d={pathFor(geo.xs, seaValues.map(y))} />
          </>
        ),
        dots: seaNow != null ? [y(seaNow)!] : [],
      },
      w.lane,
    ],
    bubbles,
    pills: [],
  };
}

function swellCurves(ctx: Ctx, geo: Geo): Curves {
  const { units } = ctx;
  const hUnit = HEIGHT_UNIT_LABEL[units.height];
  const s1 = valuesAt(series(ctx, 'swell_wave_height'), geo.pts);
  const s2 = valuesAt(series(ctx, 'secondary_swell_wave_height'), geo.pts);
  const ws = valuesAt(series(ctx, 'wind_wave_height'), geo.pts);
  const p1 = valuesAt(series(ctx, 'swell_wave_period'), geo.pts);
  const p2 = valuesAt(series(ctx, 'secondary_swell_wave_period'), geo.pts);
  const top = niceMax(heightValue(Math.max(0.5, maxOf(s1, s2, ws)), units.height), heightSteps(units));
  const y = (m: number | null) => (m == null ? null : yIn(LANE1_H, 0, top, heightValue(m, units.height)));
  const yp = (s: number | null) => (s == null ? null : yIn(LANE2_H, 0, 20, s));
  const g = gradient(`${geo.id}s`, HEIGHT, s1, geo.xs, geo.width);
  const now = (name: string) => (geo.here >= 0 ? at(series(ctx, name), geo.here) : null);
  const [h1, h2, d1, d2, q1, q2] = [
    now('swell_wave_height'),
    now('secondary_swell_wave_height'),
    now('swell_wave_direction'),
    now('secondary_swell_wave_direction'),
    now('swell_wave_period'),
    now('secondary_swell_wave_period'),
  ];

  const bubbles: Bubble[] = [];
  if (h1 != null) bubbles.push({ lane: 0, y: y(h1)!, text: `houle 1 · ${formatHeight(h1, units.height)} ${hUnit}`, dir: d1 == null ? undefined : { from: d1, label: cardinal(d1) } });
  if (h2 != null) bubbles.push({ lane: 0, y: y(h2)!, text: `houle 2 · ${formatHeight(h2, units.height)} ${hUnit}`, dir: d2 == null ? undefined : { from: d2, label: cardinal(d2) } });
  const periods = [q1, q2].filter(isNumber);
  if (periods.length) bubbles.push({ lane: 1, y: yp(q1 ?? q2)!, text: periods.map((p) => `${fmt(p)} s`).join(' et ') });

  return {
    lanes: [
      {
        keys: (
          <>
            <LineKey label="Houle 1" />
            <LineKey label="Houle 2" kind="accent" />
            <LineKey label="Mer du vent" kind="dashed" />
          </>
        ),
        unit: `hauteur, en ${HEIGHT_WORD[units.height]}`,
        ticks: s1.some(isNumber) || s2.some(isNumber) || ws.some(isNumber) ? ticksFor(LANE1_H, 0, top, (v) => scaleLabel(v, hUnit)) : [],
        body: (
          <>
            {g.defs}
            {area(areaFor(geo.xs, s1.map(y), LANE1_H), g)}
            <path className="ov-gust" d={pathFor(geo.xs, ws.map(y))} />
            <path className="ov-line" d={pathFor(geo.xs, s1.map(y))} />
            <path className="ov-accent" d={pathFor(geo.xs, s2.map(y))} />
          </>
        ),
        dots: [h1, h2].filter(isNumber).map((m) => y(m)!),
      },
      {
        keys: (
          <>
            <LineKey label="Période de la houle 1" />
            <LineKey label="de la houle 2" kind="accent" />
          </>
        ),
        unit: 'en secondes',
        ticks: p1.some(isNumber) || p2.some(isNumber) ? ticksFor(LANE2_H, 0, 20, (v) => scaleLabel(v, 's')) : [],
        body: (
          <>
            <path className="ov-line" d={pathFor(geo.xs, p1.map(yp))} />
            <path className="ov-accent" d={pathFor(geo.xs, p2.map(yp))} />
          </>
        ),
        dots: [q1, q2].filter(isNumber).map((p) => yp(p)!),
      },
    ],
    bubbles,
    pills: [],
  };
}

function windCurves(ctx: Ctx, geo: Geo): Curves {
  const { units } = ctx;
  const wUnit = WIND_UNIT_LABEL[units.wind];
  const speed = series(ctx, 'wind_speed_10m');
  const direction = series(ctx, 'wind_direction_10m');
  const w = windLane(ctx, geo, LANE1_H, speed, series(ctx, 'wind_gusts_10m'), true);
  const every = markEvery(geo);
  const marks = geo.hourly.filter((i) => hourOf(geo.times[i]) % every === 0);
  const from = geo.here >= 0 ? at(direction, geo.here) : null;
  const ARROW_Y = 22;

  const bubbles: Bubble[] = [];
  if (w.gustNow != null) bubbles.push({ lane: 0, y: w.y(w.gustNow)!, text: `rafales ${formatWind(w.gustNow, units.wind)} ${wUnit}` });
  if (w.now != null) bubbles.push({ lane: 0, y: w.y(w.now)!, text: `vent ${formatWind(w.now, units.wind)} ${wUnit} · force ${beaufort(w.now)}` });
  if (from != null) bubbles.push({ lane: 1, y: ARROW_Y, text: 'vient du', dir: { from, label: cardinal(from) } });

  return {
    lanes: [
      w.lane,
      {
        keys: <LineKey label="D’où vient le vent" kind="text" />,
        unit: 'couleur : la vitesse',
        ticks: [],
        body: (
          <>
            {marks.map((i) => {
              const deg = at(direction, i);
              if (deg == null) return null;
              return arrowAt(i, geo.x(geo.times[i]), ARROW_Y, deg + 180, 15, cellColors(WIND, at(speed, i))?.background);
            })}
            {marks
              .filter((i) => hourOf(geo.times[i]) % 6 === 0 && at(direction, i) != null)
              .map((i) => (
                <text key={`c${i}`} className="tl-mark-text" x={geo.x(geo.times[i])} y={48} textAnchor="middle">
                  {cardinal(at(direction, i))}
                </text>
              ))}
          </>
        ),
        dots: [],
      },
    ],
    bubbles,
    pills: [],
  };
}

function weatherCurves(ctx: Ctx, geo: Geo): Curves {
  const { units } = ctx;
  const tUnit = TEMP_UNIT_LABEL[units.temp];
  const temperature = series(ctx, 'temperature_2m');
  const rain = series(ctx, 'precipitation');
  const temps = valuesAt(temperature, geo.pts);
  const shown = temps.filter(isNumber).map((c) => tempValue(c, units.temp));
  // L'échelle : du minimum moins 1 degré au maximum plus 1, au moins 6 degrés.
  let lo = shown.length ? Math.floor(Math.min(...shown) - 1) : 0;
  let hi = shown.length ? Math.ceil(Math.max(...shown) + 1) : 6;
  if (hi - lo < 6) {
    lo = Math.floor((lo + hi) / 2 - 3);
    hi = lo + 6;
  }
  const y = (c: number | null) => (c == null ? null : yIn(LANE1_H, lo, hi, tempValue(c, units.temp)));
  const g = gradient(`${geo.id}t`, TEMP, temps, geo.xs, geo.width);
  const rains = geo.hourly.map((i) => at(rain, i));
  const top = niceMax(Math.max(0.5, ...rains.filter(isNumber)), RAIN_STEPS);
  const yr = (mm: number) => yIn(LANE2_H, 0, top, mm);
  const hourW = Math.max(1, geo.dayW / 24 - 1);
  const now = (s: Series | null) => (geo.here >= 0 ? at(s, geo.here) : null);
  const [tNow, aNow, rNow] = [now(temperature), now(series(ctx, 'apparent_temperature')), now(rain)];

  // Le ciel toutes les 6 heures, dans une pastille au-dessus de la courbe.
  const pills: Pill[] = geo.hourly.flatMap((i) => {
    if (hourOf(geo.times[i]) % 6 !== 0) return [];
    const sky = skyOf(at(series(ctx, 'weather_code'), i), isDayAt(ctx, i));
    const c = at(temperature, i);
    if (!sky || c == null) return [];
    return [{ key: i, x: geo.x(geo.times[i]), y: Math.max(12, y(c)! - 18), icon: sky.icon, label: sky.word }];
  });

  const bubbles: Bubble[] = [];
  if (tNow != null) {
    bubbles.push({ lane: 0, y: y(tNow)!, text: `${formatTemp(tNow, units.temp)} ${tUnit}${aNow == null ? '' : ` · ressenti ${formatTemp(aNow, units.temp)} ${tUnit}`}` });
  }
  if (rNow != null) bubbles.push({ lane: 1, y: Math.min(yr(rNow), LANE2_H - 9), text: rNow < 0.05 ? 'pas de pluie' : `pluie ${fmt(rNow, 1)} mm` });

  return {
    lanes: [
      {
        keys: (
          <>
            <LineKey label="Température" />
            <LineKey label="et le ciel" kind="text" />
          </>
        ),
        unit: `en ${tUnit}`,
        ticks: shown.length ? ticksFor(LANE1_H, lo, hi, (v) => `${fmt(v, Number.isInteger(v) ? 0 : 1)} ${tUnit}`) : [],
        body: (
          <>
            {g.defs}
            {area(areaFor(geo.xs, temps.map(y), LANE1_H), g)}
            <path className="ov-line" d={pathFor(geo.xs, temps.map(y))} />
          </>
        ),
        dots: tNow != null ? [y(tNow)!] : [],
      },
      {
        keys: <LineKey label="Pluie, heure par heure" kind="square" color={cellColors(RAIN, 1)?.background} />,
        unit: 'en mm',
        ticks: rains.some(isNumber) ? ticksFor(LANE2_H, 0, top, (v) => scaleLabel(v, 'mm')) : [],
        body: (
          <>
            {geo.hourly.map((i, k) => {
              const mm = rains[k];
              if (mm == null || mm < 0.05) return null;
              const x = geo.x(geo.times[i]);
              const yy = yr(mm);
              return <rect key={i} x={x} y={yy} width={hourW} height={Math.max(1, LANE2_H - yy)} fill={cellColors(RAIN, mm)?.background} />;
            })}
          </>
        ),
        dots: [],
      },
    ],
    bubbles,
    pills,
  };
}

function tideCurves(ctx: Ctx, geo: Geo): Curves {
  const { units, fc } = ctx;
  const hUnit = HEIGHT_UNIT_LABEL[units.height];
  const level = series(ctx, 'sea_level_height_msl');
  const current = series(ctx, 'ocean_current_velocity');
  const towards = series(ctx, 'ocean_current_direction');
  // Heure par heure, quel que soit le pas : la marée a une période d'un peu plus de 12 heures, qu'un pas de 3 ou
  // de 12 heures déformerait ; ses pleines et basses mers tombent ainsi sous leur étiquette.
  const hx = geo.hourly.map((i) => geo.x(geo.times[i]));
  const levels = valuesAt(level, geo.hourly);
  const amplitude = Math.max(0.25, ...levels.filter(isNumber).map((m) => Math.abs(heightValue(m, units.height))));
  const T = niceMax(amplitude, tideSteps(units));
  const y = (m: number | null) => (m == null ? null : yIn(LANE1_H, -T, T, heightValue(m, units.height)));
  const cUnit = quantityUnit('current', units);
  const speeds = valuesAt(current, geo.hourly);
  const cTop = niceMax(Math.max(units.wind === 'kn' ? 0.5 : 0.25, ...speeds.filter(isNumber).map((ms) => currentValue(ms, units))), currentSteps(units));
  const yc = (ms: number | null) => (ms == null ? null : yIn(LANE2_H, 0, cTop, currentValue(ms, units)));
  const g = gradient(`${geo.id}c`, CURRENT, speeds, hx, geo.width);
  const end = geo.times[geo.hourly[geo.hourly.length - 1] ?? 0] ?? 0;
  const start = geo.times[geo.hourly[0] ?? 0] ?? 0;
  const extremes = level ? tideExtremes(fc.times, level).filter((e) => e.time >= start && e.time <= end) : [];
  const every = markEvery(geo);
  const marks = geo.hourly.filter((i) => hourOf(geo.times[i]) % every === 0);
  const now = (s: Series | null) => (geo.here >= 0 ? at(s, geo.here) : null);
  const [lNow, cNow, dNow] = [now(level), now(current), now(towards)];
  const up = geo.here >= 0 ? rising(level, geo.here) : null;

  const bubbles: Bubble[] = [];
  if (lNow != null) bubbles.push({ lane: 0, y: y(lNow)!, text: `${formatHeight(lNow, units.height)} ${hUnit}${up == null ? '' : up ? ' · montante' : ' · descendante'}` });
  if (cNow != null) {
    bubbles.push({
      lane: 1,
      y: yc(cNow)!,
      text: `courant ${formatQuantity('current', cNow, units)} ${cUnit}`,
      dir: dNow == null ? undefined : { from: dNow + 180, label: cardinal(dNow) },
    });
  }

  return {
    lanes: [
      {
        keys: (
          <>
            <LineKey label="Hauteur d’eau" />
            <LineKey label="PM, BM : pleines et basses mers" kind="text" />
          </>
        ),
        unit: 'par rapport au niveau moyen',
        ticks: levels.some(isNumber) ? ticksFor(LANE1_H, -T, T, (v) => scaleLabel(v, hUnit, true)) : [],
        body: (
          <>
            {/* L'aire de la hauteur d'eau, au bleu de la palette des hauteurs. */}
            <path d={areaFor(hx, levels.map(y), LANE1_H)} fill={cellColors(HEIGHT, 1.2)?.background} fillOpacity={0.45} />
            <path className="ov-line" d={pathFor(hx, levels.map(y))} />
            {extremes.map((e) => (
              <text key={e.time} className="tl-tide-mark" x={geo.x(e.time)} y={e.high ? y(e.level)! - 6 : Math.min(LANE1_H - 2, y(e.level)! + 12)} textAnchor="middle">
                {e.high ? 'PM' : 'BM'} {formatHour(e.time)}
              </text>
            ))}
          </>
        ),
        dots: lNow != null ? [y(lNow)!] : [],
      },
      {
        keys: (
          <>
            <LineKey label="Courant" />
            <LineKey label="flèche : où il porte" kind="text" />
          </>
        ),
        unit: `vitesse, en ${cUnit === 'nd' ? 'nœuds' : 'm/s'}`,
        ticks: speeds.some(isNumber) ? ticksFor(LANE2_H, 0, cTop, (v) => scaleLabel(v, cUnit)) : [],
        body: (
          <>
            {g.defs}
            {area(areaFor(hx, speeds.map(yc), LANE2_H), g)}
            <path className="ov-line" d={pathFor(hx, speeds.map(yc))} />
            {marks.map((i) => {
              const deg = at(towards, i);
              if (deg == null) return null;
              return arrowAt(i, geo.x(geo.times[i]), 8, deg, 11, cellColors(CURRENT, at(current, i))?.background);
            })}
          </>
        ),
        dots: cNow != null ? [yc(cNow)!] : [],
      },
    ],
    bubbles,
    pills: [],
  };
}
