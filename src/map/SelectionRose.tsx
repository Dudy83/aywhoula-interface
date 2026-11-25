/**
 * Contenu de l'épingle de sélection, rendu par un portail dans l'élément du `Marker` de
 * `MapView`. Autour du point, la rose : une flèche par composante (vagues, houle, 2ᵉ houle,
 * vent), posée du côté d'où elle vient et pointée vers le point, avec son étiquette. Mêmes
 * modèles, même heure, mêmes chiffres que le panneau de prévision.
 *
 * Une bouée garde l'étiquette de la couche (c'est une mesure, la rose une prévision), et
 * l'étiquette revient aussi quand la prévision ne se charge pas.
 *
 * Le mouvement : apparition échelonnée à la pose, puis rotation lissée des flèches et
 * glissement des étiquettes quand l'heure change. Une boucle `requestAnimationFrame`
 * écrit directement dans le DOM, et seulement tant que quelque chose bouge.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LAYER_BY_ID, type LayerId } from '../data/catalog';
import { beyondForecast, hourIndex, pickSeries, roseAt, ROSE_KEYS, type RoseArrow, type RoseKey } from '../data/sea-state';
import { formatQuantity, quantityUnit } from '../lib/quantity';
import { HOUR } from '../lib/time';
import { cardinal, fmt, formatHeight, formatWind, HEIGHT_UNIT_LABEL, WIND_UNIT_LABEL, type Units } from '../lib/units';
import { useStore, type Readout, type Selection } from '../state/store';
import { Chip, HEIGHT, WIND } from '../ui/common';
import { useForecast } from '../ui/useForecast';
import { mapApi } from './api';

/** Géométrie (px CSS, la même sur téléphone et sur ordinateur). Les flèches sont dessinées venant du nord, puis tournées. */
const RING = 24;
const TIP = 27;
const HEAD_LEN = 8;
const HEAD_HALF = 5;
const TAIL = 72;
const SHAFT_IN = TIP + HEAD_LEN;
/** Rayon du cercle contre lequel se rangent les étiquettes. */
const LABEL_R = 76;
const BOX = 2 * (TAIL + 18);

/** Durées (ms), toutes sur la courbe de l'app (`--ease`). */
const T = {
  ripple: 520,
  ringDelay: 40,
  ring: 240,
  arrowDelay: 100,
  arrowStagger: 60,
  arrow: 240,
  arrowSlide: 12,
  label: 160,
  labelSlide: 4,
  leave: 160,
  leaveSlide: 8,
  reduced: 120,
  /** Lissage exponentiel des angles et des étiquettes. */
  smooth: 90,
} as const;

/** Deux étiquettes voisines ne s'échangent que si leurs flèches se sont croisées de plus de SWAP px. */
const SWAP = 8;
const LABEL_GAP = 4;

/** Couches dont la rose montre déjà la valeur : pour les autres, une pastille s'ajoute. */
const ROSE_LAYERS = new Set<LayerId>(['waves', 'swell', 'period', 'wind', 'gusts']);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const norm = (deg: number) => ((deg % 360) + 360) % 360;
const shortest = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** `cubic-bezier(0.25, 1, 0.5, 1)`, la courbe `--ease` de `styles.css`. */
const ease = (() => {
  const cx = 0.75;
  const bx = 3 * (0.5 - 0.25) - cx;
  const ax = 1 - cx - bx;
  const cy = 3;
  const by = 3 * (1 - 1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-5) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return sy(clamp01(t));
  };
})();

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

const valueText = (a: RoseArrow, units: Units): string =>
  a.key === 'wind'
    ? `${formatWind(a.value, units.wind)} ${WIND_UNIT_LABEL[units.wind]}`
    : `${formatHeight(a.value, units.height)} ${HEIGHT_UNIT_LABEL[units.height]}`;

const detailText = (a: RoseArrow, units: Units): string => {
  if (a.key === 'wind') return a.gust != null ? `raf. ${formatWind(a.gust, units.wind)}` : '';
  return a.period != null ? `${fmt(a.period)} s` : '';
};

interface LayerInfo {
  label: string;
  value: string;
  unit: string;
  dir: string | null;
}

/** La valeur de la couche active à cet endroit, comme l'étiquette d'avant la rose. */
function layerInfo(layer: LayerId, readout: Readout | null, units: Units, withLabel: boolean): LayerInfo | null {
  if (!readout) return null;
  const q = LAYER_BY_ID[layer].quantity;
  return {
    label: withLabel ? LAYER_BY_ID[layer].label : '',
    value: formatQuantity(q, readout.value, units),
    unit: quantityUnit(q, units),
    dir: readout.direction === null ? null : cardinal(readout.direction),
  };
}

/** Contenu de l'épingle : un composant neuf à chaque sélection, pour que la rose refasse son apparition. */
export function SelectionRose() {
  const selection = useStore((s) => s.selection);
  if (!selection) return null;
  return <PinContent key={selection.id} selection={selection} />;
}

function PinContent({ selection }: { selection: Selection }) {
  const isBuoy = selection.kind === 'buoy';
  const { data: fc, error } = useForecast(isBuoy ? null : selection);
  const units = useStore((s) => s.units);
  const layer = useStore((s) => s.layer);
  const readout = useStore((s) => s.readout);
  const hour = useStore((s) => Math.round(s.time / HOUR));
  const choice = useStore((s) => s.forecastChoice);
  const models = useStore((s) => s.models);
  const animate = useStore((s) => s.animate);
  const reduced = usePrefersReducedMotion();
  const still = reduced || !animate;

  const arrows = useMemo(() => {
    if (!fc) return [];
    const index = hourIndex(fc.times, hour);
    const { wave, wind } = pickSeries(fc, choice, models, index);
    return roseAt(wave, wind, index);
  }, [fc, choice, models, hour]);

  // Bouée, prévision indisponible, ou heure au-delà de la prévision du point (la carte va plus
  // loin que les jours de la version gratuite) : l'étiquette de la couche, comme avant la rose.
  if (isBuoy || error || (fc && beyondForecast(fc.times, hour))) {
    const info = layerInfo(layer, readout, units, false);
    return (
      <>
        <span className="pin-target" />
        {info && (
          <span className="pin-value">
            <b>{info.value}</b> {info.unit}
            {info.dir && <span className="pin-dir">{info.dir}</span>}
          </span>
        )}
      </>
    );
  }

  return (
    <Rose
      selection={selection}
      arrows={arrows}
      units={units}
      layer={ROSE_LAYERS.has(layer) ? null : layerInfo(layer, readout, units, true)}
      still={still}
    />
  );
}

/** État d'animation d'une flèche et de son étiquette. */
interface ArrowAnim {
  present: boolean;
  angle: number;
  target: number;
  appear: number;
  leave: number | null;
  vis: number;
  labelVis: number;
  labelOff: number;
  lx: number | null;
  ly: number | null;
  w: number;
  h: number;
}

interface Anim {
  placedAt: number;
  arrows: Partial<Record<RoseKey, ArrowAnim>>;
  layer: { w: number; h: number } | null;
  raf: number;
  last: number;
  order: [string[], string[]];
  revealed: boolean;
}

interface LabelItem {
  key: string;
  angle: number;
  w: number;
  h: number;
  anim?: ArrowAnim;
  side: 0 | 1;
  want: number;
  cy: number;
  x: number;
  y: number;
}

/**
 * Range les étiquettes en deux colonnes, à gauche et à droite de la rose, collées au cercle
 * de rayon LABEL_R. Chaque étiquette vise la hauteur de la queue de sa flèche ; dans une
 * colonne, l'ordre de l'image précédente tient tant que deux flèches ne se sont pas croisées
 * de plus de SWAP px ; on empile avec LABEL_GAP d'écart puis on recentre la colonne. Les
 * flèches, elles, gardent leur vraie direction.
 */
function layoutLabels(items: LabelItem[], order: [string[], string[]]): void {
  const cols: [LabelItem[], LabelItem[]] = [[], []];
  for (const it of items) {
    const ux = Math.sin(rad(it.angle));
    it.want = -Math.cos(rad(it.angle)) * LABEL_R;
    it.side = ux < -1e-6 || (Math.abs(ux) <= 1e-6 && norm(it.angle) > 180) ? 0 : 1;
    cols[it.side].push(it);
  }
  cols.forEach((col, side) => {
    if (!col.length) return;
    const previous = order[side];
    col.sort((p, q) => {
      const ip = previous.indexOf(p.key);
      const iq = previous.indexOf(q.key);
      return ip < 0 || iq < 0 ? p.want - q.want : ip - iq;
    });
    for (let pass = 0; pass < col.length; pass++) {
      for (let i = 0; i < col.length - 1; i++) {
        if (col[i].want > col[i + 1].want + SWAP) [col[i], col[i + 1]] = [col[i + 1], col[i]];
      }
    }
    order[side] = col.map((it) => it.key);
    let prev: LabelItem | null = null;
    for (const it of col) {
      it.cy = prev ? Math.max(it.want, prev.cy + (prev.h + it.h) / 2 + LABEL_GAP) : it.want;
      prev = it;
    }
    const shift = col.reduce((sum, it) => sum + (it.cy - it.want), 0) / col.length;
    for (const it of col) {
      it.cy -= shift;
      const top = it.cy - it.h / 2;
      const bottom = it.cy + it.h / 2;
      const near = top <= 0 && bottom >= 0 ? 0 : Math.min(Math.abs(top), Math.abs(bottom));
      const edge = Math.sqrt(Math.max(0, LABEL_R * LABEL_R - near * near));
      it.x = it.side === 0 ? -edge - it.w : edge;
      it.y = top;
    }
  });
}

function Rose({
  selection,
  arrows,
  units,
  layer,
  still,
}: {
  selection: Selection;
  arrows: RoseArrow[];
  units: Units;
  layer: LayerInfo | null;
  still: boolean;
}) {
  const rippleRef = useRef<SVGCircleElement>(null);
  const ringRef = useRef<SVGGElement>(null);
  const arrowRefs = useRef<Partial<Record<RoseKey, SVGGElement | null>>>({});
  const slideRefs = useRef<Partial<Record<RoseKey, SVGGElement | null>>>({});
  const labelRefs = useRef<Partial<Record<RoseKey, HTMLDivElement | null>>>({});
  const layerRef = useRef<HTMLDivElement>(null);
  /** Dernière valeur de chaque flèche : une flèche qui s'en va s'efface avec ses chiffres. */
  const lastSeen = useRef<Partial<Record<RoseKey, RoseArrow>>>({});
  const anim = useRef<Anim | null>(null);
  const stillRef = useRef(still);
  const frameRef = useRef<(t: number) => void>(() => undefined);

  const kick = () => {
    const a = anim.current;
    if (!a || a.raf) return;
    a.last = performance.now();
    a.raf = requestAnimationFrame((t) => frameRef.current(t));
  };

  frameRef.current = (t: number) => {
    const a = anim.current;
    if (!a) return;
    a.raf = 0;
    const dt = Math.min(64, Math.max(0, t - a.last));
    a.last = t;
    const red = stillRef.current;
    const k = red ? 1 : 1 - Math.exp(-dt / T.smooth);
    const since = t - a.placedAt;
    let busy = false;

    // L'onde de pose, puis l'anneau.
    const pr = clamp01(since / T.ripple);
    const ripple = rippleRef.current;
    if (ripple) {
      ripple.setAttribute('r', (9 + 49 * ease(pr)).toFixed(2));
      ripple.setAttribute('opacity', red || pr >= 1 ? '0' : (0.65 * (1 - pr)).toFixed(3));
    }
    if (!red && pr < 1) busy = true;
    const pg = red ? clamp01(since / T.reduced) : ease(clamp01((since - T.ringDelay) / T.ring));
    if (pg < 1) busy = true;
    const ring = ringRef.current;
    if (ring) {
      ring.setAttribute('opacity', pg.toFixed(3));
      ring.setAttribute('transform', `scale(${red ? 1 : ((16 + 8 * pg) / RING).toFixed(4)})`);
    }

    // Les flèches.
    for (const key of ROSE_KEYS) {
      const s = a.arrows[key];
      if (!s) continue;
      const gap = shortest(s.target - s.angle);
      if (Math.abs(gap) < 0.05) s.angle = s.target;
      else {
        s.angle = norm(s.angle + gap * k);
        busy = true;
      }
      const p = red ? clamp01((t - s.appear) / T.reduced) : ease(clamp01((t - s.appear) / T.arrow));
      if (p < 1) busy = true;
      let vis = p;
      let off = red ? 0 : T.arrowSlide * (1 - p);
      if (s.leave != null) {
        const q = clamp01((t - s.leave) / (red ? T.reduced : T.leave));
        if (q < 1) busy = true;
        vis *= 1 - ease(q);
        off += red ? 0 : T.leaveSlide * ease(q);
      }
      s.vis = vis;
      arrowRefs.current[key]?.setAttribute('transform', `rotate(${s.angle.toFixed(2)})`);
      const slide = slideRefs.current[key];
      slide?.setAttribute('transform', `translate(0 ${(-off).toFixed(2)})`);
      slide?.setAttribute('opacity', vis.toFixed(3));
      const pl = red ? p : ease(clamp01((t - s.appear - T.arrow) / T.label));
      if (s.present && pl < 1) busy = true;
      s.labelVis = s.leave != null ? Math.min(pl, vis) : pl;
      s.labelOff = red ? 0 : T.labelSlide * (1 - pl);
    }

    // Les étiquettes.
    const items: LabelItem[] = [];
    for (const key of ROSE_KEYS) {
      const s = a.arrows[key];
      const el = labelRefs.current[key];
      if (!s || !el) continue;
      if (!s.present && s.vis <= 0.001) {
        el.style.opacity = '0';
        continue;
      }
      items.push({ key, angle: s.angle, w: s.w, h: s.h, anim: s, side: 1, want: 0, cy: 0, x: 0, y: 0 });
    }
    if (a.layer && layerRef.current) items.push({ key: 'layer', angle: 180, w: a.layer.w, h: a.layer.h, side: 1, want: 0, cy: 0, x: 0, y: 0 });
    layoutLabels(items, a.order);
    for (const it of items) {
      const s = it.anim;
      if (!s) {
        const el = layerRef.current;
        if (el) {
          el.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px)`;
          el.style.opacity = pg.toFixed(3);
        }
        continue;
      }
      if (s.lx == null || s.ly == null || red) {
        s.lx = it.x;
        s.ly = it.y;
      } else {
        s.lx += (it.x - s.lx) * k;
        s.ly += (it.y - s.ly) * k;
        if (Math.abs(it.x - s.lx) > 0.3 || Math.abs(it.y - s.ly) > 0.3) busy = true;
      }
      const el = labelRefs.current[it.key as RoseKey];
      if (!el) continue;
      const dx = (it.side === 0 ? -1 : 1) * s.labelOff;
      el.style.transform = `translate(${(s.lx + dx).toFixed(1)}px, ${s.ly.toFixed(1)}px)`;
      el.style.opacity = s.labelVis.toFixed(3);
    }

    // Une fois, quand les flèches arrivent : la carte se décale pour montrer toute la rose.
    if (!a.revealed && items.some((it) => it.anim?.present)) {
      a.revealed = true;
      const box = { left: -TAIL, top: -TAIL, right: TAIL, bottom: TAIL };
      for (const it of items) {
        box.left = Math.min(box.left, it.x);
        box.top = Math.min(box.top, it.y);
        box.right = Math.max(box.right, it.x + it.w);
        box.bottom = Math.max(box.bottom, it.y + it.h);
      }
      mapApi.revealRose(selection.lon, selection.lat, box);
    }

    if (busy) a.raf = requestAnimationFrame((time) => frameRef.current(time));
  };

  // Pose : l'apparition commence maintenant.
  useLayoutEffect(() => {
    const now = performance.now();
    anim.current = { placedAt: now, arrows: {}, layer: null, raf: 0, last: now, order: [[], []], revealed: false };
    kick();
    return () => {
      if (anim.current?.raf) cancelAnimationFrame(anim.current.raf);
      anim.current = null;
    };
    // kick ne lit que des refs : l'effet ne dépend de rien d'autre.
  }, []);

  useEffect(() => {
    stillRef.current = still;
    kick();
  });

  const layerKey = layer ? `${layer.label}|${layer.value}|${layer.unit}|${layer.dir ?? ''}` : '';

  // Nouvelles valeurs : cibles des flèches, entrées et sorties, tailles des étiquettes.
  useLayoutEffect(() => {
    const a = anim.current;
    if (!a) return;
    const now = performance.now();
    const base = Math.max(now, a.placedAt + T.arrowDelay);
    let entering = 0;
    for (const key of ROSE_KEYS) {
      const next = arrows.find((x) => x.key === key);
      const s = a.arrows[key];
      if (next) {
        lastSeen.current[key] = next;
        if (!s || !s.present) {
          a.arrows[key] = {
            present: true,
            angle: next.from,
            target: next.from,
            appear: base + entering * T.arrowStagger,
            leave: null,
            vis: 0,
            labelVis: 0,
            labelOff: T.labelSlide,
            lx: null,
            ly: null,
            w: 0,
            h: 0,
          };
          entering++;
        } else s.target = next.from;
      } else if (s?.present) {
        s.present = false;
        s.leave = now;
      }
      const el = labelRefs.current[key];
      const cur = a.arrows[key];
      if (el && cur) {
        cur.w = el.offsetWidth;
        cur.h = el.offsetHeight;
      }
    }
    a.layer = layerRef.current ? { w: layerRef.current.offsetWidth, h: layerRef.current.offsetHeight } : null;
    kick();
  }, [arrows, units, layerKey]);

  const summary = arrows
    .map((x) => {
      const detail = detailText(x, units);
      return `${x.name} ${valueText(x, units)}${detail ? `, ${detail}` : ''}, de ${cardinal(x.from)}`;
    })
    .join('. ');

  return (
    <>
      <div className="rose">
        <svg className="rose-svg" width={BOX} height={BOX} viewBox={`${-BOX / 2} ${-BOX / 2} ${BOX} ${BOX}`} style={{ left: -BOX / 2, top: -BOX / 2 }} aria-hidden="true">
          <circle ref={rippleRef} className="rose-ripple" r={9} opacity={0} />
          <g ref={ringRef} opacity={0}>
            <circle className="rose-halo" r={RING} strokeWidth={3.6} />
            <circle className="rose-line rose-ring" r={RING} strokeWidth={1.5} />
          </g>
          {ROSE_KEYS.map((key) =>
            arrows.some((x) => x.key === key) || lastSeen.current[key] ? (
              <g
                key={key}
                ref={(el) => {
                  arrowRefs.current[key] = el;
                }}
              >
                <g
                  ref={(el) => {
                    slideRefs.current[key] = el;
                  }}
                  opacity={0}
                >
                  <line className="rose-halo" x1={0} y1={-TAIL} x2={0} y2={-SHAFT_IN} strokeWidth={4.4} />
                  <line className="rose-line" x1={0} y1={-TAIL} x2={0} y2={-SHAFT_IN} strokeWidth={2.2} />
                  <path className="rose-head" d={`M0 ${-TIP} L${HEAD_HALF} ${-SHAFT_IN} L${-HEAD_HALF} ${-SHAFT_IN} Z`} />
                </g>
              </g>
            ) : null,
          )}
        </svg>
      </div>
      <span className="pin-target" data-appear={still ? 'still' : 'move'} />
      <div className="rose" role="img" aria-label={summary || 'Point sélectionné'}>
        {ROSE_KEYS.map((key) => {
          const x = arrows.find((y) => y.key === key) ?? lastSeen.current[key];
          if (!x) return null;
          const text = valueText(x, units);
          const detail = detailText(x, units);
          return (
            <div
              key={key}
              className="rose-label"
              ref={(el) => {
                labelRefs.current[key] = el;
              }}
              style={{ opacity: 0 }}
            >
              <span className="rose-name">{x.name}</span>
              <span className="rose-value" key={text}>
                <Chip value={x.value} text={text} palette={x.key === 'wind' ? WIND : HEIGHT} />
              </span>
              {detail && <span className="rose-detail">{detail}</span>}
            </div>
          );
        })}
        {layer && (
          <div className="rose-layer" ref={layerRef} style={{ opacity: 0 }}>
            {layer.label} <b>{layer.value}</b> {layer.unit}
            {layer.dir && <span className="pin-dir">{layer.dir}</span>}
          </div>
        )}
      </div>
    </>
  );
}
