/**
 * La ligne de temps sur 16 jours : la barre du bas de l'ordinateur, et la barre du dialog d'un lieu sur
 * téléphone. Elle montre l'un des cinq types d'affichage (`timelineProfile`, `./timeline/profiles.tsx`) :
 * vagues et vent (par défaut), la houle en détail, le vent, la météo, la marée et le courant.
 * En courbes : deux couloirs de hauteur fixe, l'échelle de chacun dans une colonne fixe à gauche, un seul
 * curseur et les valeurs de l'heure de la carte dans des bulles accrochées à lui, les heures puis les jours
 * en abscisse ; sept jours à l'écran sur ordinateur, deux et un bout du troisième dans le dialog du
 * téléphone, les suivants en faisant défiler. En tableau : deux groupes de lignes séparés par un filet,
 * qui défile de côté. Le pas (1, 3, 5 ou 12 h) est le même pour les deux vues : une colonne du tableau, un
 * point des courbes. Les valeurs sont celles du modèle de la carte, pour le lieu ouvert, sinon le dernier
 * ouvert (une bouée : à la bouée ; une webcam : au lieu qu'elle filme, sinon à la caméra).
 * Version gratuite : les jours de Premium (du sixième au seizième) gardent l'échelle et le pas des jours
 * ouverts, désactivés (couloirs hachurés, cases vides), sous l'étiquette « +11 jours » ; toucher la zone ouvre
 * l'offre.
 */
import { ChartSpline, Table2 } from 'lucide-react';
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FREE_DAYS, type PointForecast } from '../data/forecast';
import { at } from '../data/sea-state';
import { formatHour, HOUR, nearestIndex, startOfLocalDay } from '../lib/time';
import { openOffer, usePremium } from '../state/account';
import { DAY_STEP_HOURS, useStore, type TimelineView } from '../state/store';
import { Arrow, Segmented } from './common';
import { useTimelineData } from './timeline/data';
import { curvesFor, tableRows, type Bubble, type Ctx, type Geo } from './timeline/profiles';
import {
  AXIS_TOP,
  BUBBLE_GAP,
  BUBBLE_H,
  dayLong,
  dayShort,
  FoldLabel,
  HOURS_H,
  hourLabel,
  LANE_H,
  LANE_TOP,
  LANE1_TOP,
  LANE2_H,
  LANE2_HEAD_TOP,
  LANE2_TOP,
  nextDay,
  offerLabel,
  PLOT_H,
  SCALE_W,
  THREE_HOURS_MIN_W,
  useAxisDays,
} from './timeline/shared';

/** Les jours à l'écran dans la barre du bas, comme la bande des jours d'avant : sept et un bout du huitième. */
export const DOCK_DAYS = 7.3;
/** Les jours à l'écran dans le dialog d'un lieu sur téléphone : deux et un bout du troisième. */
export const SHEET_DAYS = 2.3;

/** Une prévision vide, tant qu'il n'y a pas de lieu ou que la sienne n'est pas arrivée : les titres restent. */
const EMPTY: PointForecast = { times: [], wave: {}, wind: {}, seaLevel: null, seaTemperature: null, isDay: null, sun: [], waveError: null, windError: null };

/** La largeur d'un élément, suivie ; l'élément n'apparaît qu'après le chargement des échéances. */
function useElementWidth(el: HTMLElement | null, fallback: number): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!el) return;
    const measure = () => setWidth(Math.max(120, el.clientWidth));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [el]);
  return width;
}

/** Une molette verticale fait défiler de côté ce qui défile de côté : le tableau, les courbes. */
function useSideWheel(box: HTMLElement | null): void {
  useEffect(() => {
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || box.scrollWidth <= box.clientWidth) return;
      box.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, [box]);
}

/** Amène la carte au pas le plus proche de ce moment ; le store le garde dans la version gratuite. */
function goTo(t: number): void {
  const store = useStore.getState();
  const times = store.timeline?.times;
  if (!times || times.length === 0) return;
  if (store.playing) store.setPlaying(false);
  const end = Math.min(times[times.length - 1], store.timeLimit ?? Infinity);
  store.setTime(times[nearestIndex(times, Math.min(end, Math.max(times[0], t)))]);
}

/** Les flèches avancent la carte du pas choisi (au moins d'une échéance) ; Début et Fin vont aux bouts. */
function keyStep(e: React.KeyboardEvent<HTMLElement>): void {
  const store = useStore.getState();
  const times = store.timeline?.times;
  if (!times || times.length === 0) return;
  const i = nearestIndex(times, store.time);
  let k: number | null = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    k = nearestIndex(times, store.time + delta * DAY_STEP_HOURS[store.dayStep] * HOUR);
    if (k === i) k = i + delta;
  } else if (e.key === 'Home') k = 0;
  else if (e.key === 'End') k = times.length - 1;
  if (k == null) return;
  e.preventDefault();
  goTo(times[Math.min(times.length - 1, Math.max(0, k))]);
}

/** Courbes ou tableau, comme le détail du jour du panneau. */
export function TimelineViewSwitch() {
  const view = useStore((s) => s.timelineView);
  const setView = useStore((s) => s.setTimelineView);
  return (
    <div className="tl-view">
      <Segmented<TimelineView>
        label="Affichage de la ligne de temps"
        value={view}
        onChange={setView}
        iconOnly
        options={[
          { value: 'curves', label: 'Courbes', icon: <ChartSpline size={15} aria-hidden="true" /> },
          { value: 'table', label: 'Tableau', icon: <Table2 size={15} aria-hidden="true" /> },
        ]}
      />
    </div>
  );
}

/** La ligne de temps, en courbes ou en tableau. `visibleDays` : les jours à l'écran dans les courbes. */
export function Timeline({ visibleDays = DOCK_DAYS }: { visibleDays?: number }) {
  const ready = useStore((s) => s.timeline !== null);
  const view = useStore((s) => s.timelineView);
  if (!ready) return <div className="timeline timeline-skeleton" aria-busy="true" aria-label="Chargement des échéances" />;
  return view === 'curves' ? <TimelineCurves visibleDays={visibleDays} /> : <TimelineTable />;
}

/**
 * Les bulles d'un couloir, de haut en bas, sans se chevaucher : chacune centrée sur sa valeur quand elle le
 * peut, sans monter dans le titre du couloir ni descendre sous son bas.
 */
function placeBubbles(list: Bubble[]): (Bubble & { top: number })[] {
  const out: (Bubble & { top: number })[] = [];
  for (const lane of [0, 1] as const) {
    const items = list
      .filter((b) => b.lane === lane)
      .map((b) => ({ ...b, top: LANE_TOP[lane] + b.y - BUBBLE_H / 2 }))
      .sort((a, b) => a.top - b.top);
    const min = LANE_TOP[lane] - 6;
    const max = LANE_TOP[lane] + LANE_H[lane] - BUBBLE_H / 2;
    items.forEach((it, k) => {
      it.top = Math.max(it.top, k === 0 ? min : items[k - 1].top + BUBBLE_H + 2);
    });
    const overflow = items.length ? items[items.length - 1].top - max : 0;
    if (overflow > 0) for (const it of items) it.top = Math.max(min, it.top - overflow);
    out.push(...items);
  }
  return out;
}

/* ------------------------------------------------------------------ courbes */

/**
 * Les 16 jours en deux couloirs, un trait par jour. L'échelle de chaque couloir se tient dans une colonne fixe
 * à gauche ; les titres disent la légende des traits et ne défilent pas : en gratuit, leur largeur suit la
 * frontière de la zone Premium à l'écran. Un seul curseur traverse les deux couloirs jusqu'à l'axe des heures,
 * avec une pastille sur chaque courbe et les valeurs de l'heure de la carte dans des bulles, à droite du
 * curseur (à gauche quand la place manque). `visibleDays` jours à l'écran, les suivants en faisant défiler (la
 * barre, la molette, le doigt). À la souris, on fait glisser le curseur ; au doigt, on touche une heure et on
 * glisse pour faire défiler.
 */
function TimelineCurves({ visibleDays }: { visibleDays: number }) {
  const times = useStore((s) => s.timeline?.times);
  const time = useStore((s) => s.time);
  const units = useStore((s) => s.units);
  const stepHours = useStore((s) => DAY_STEP_HOURS[s.dayStep]);
  const premium = usePremium();
  const data = useTimelineData();
  const { place, fc, profile } = data;
  const days = useAxisDays();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const heads = useRef<(HTMLDivElement | null)[]>([]);
  const viewW = useElementWidth(scroller, 640);
  const gradientId = `tl${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // Un glissé de la souris en cours : la ligne ne tourne pas la page sous le pointeur.
  const dragging = useRef(false);
  // Un doigt posé : une touche sans glissé choisit l'heure, un glissé fait défiler la ligne.
  const touch = useRef<{ id: number; x: number } | null>(null);
  useSideWheel(scroller);

  const t0 = days[0];
  const t1 = nextDay(days[days.length - 1]);
  const lockedFrom = premium ? null : days[FREE_DAYS];
  // Les seize jours à la même échelle. En gratuit, ceux de Premium (du sixième au seizième) sont une zone
  // désactivée, à la largeur de jour des jours ouverts : on fait défiler jusqu'au bout.
  const dayW = viewW / Math.min(days.length, visibleDays);
  const width = dayW * days.length;
  const x = (t: number) => Math.min(width, Math.max(0, ((t - t0) / (t1 - t0)) * width));
  const openEnd = lockedFrom ?? t1;
  const lockX = lockedFrom == null ? width : x(lockedFrom);

  // Un point par pas, et toutes les heures (barres de pluie, flèches) ; en gratuit, rien après les jours ouverts.
  const ft = fc?.times;
  const pts = useMemo(() => {
    const out: number[] = [];
    if (!ft) return out;
    for (let i = 0; i < ft.length; i++) {
      if (ft[i] < t0 || ft[i] > t1 || (lockedFrom != null && ft[i] >= lockedFrom)) continue;
      if (new Date(ft[i]).getHours() % stepHours === 0) out.push(i);
    }
    return out;
  }, [ft, t0, t1, lockedFrom, stepHours]);
  const hourly = useMemo(() => {
    const out: number[] = [];
    if (!ft) return out;
    for (let i = 0; i < ft.length; i++) if (ft[i] >= t0 && ft[i] < openEnd) out.push(i);
    return out;
  }, [ft, t0, openEnd]);
  const xs = ft ? pts.map((i) => x(ft[i])) : [];

  // Le curseur, et l'heure de la carte dans la prévision quand elle la couvre.
  const cursorX = x(time);
  const near = ft && ft.length ? nearestIndex(ft, time) : -1;
  const here = ft && near >= 0 && Math.abs(ft[near] - time) <= HOUR && (lockedFrom == null || time < lockedFrom) ? near : -1;
  const selectedDay = startOfLocalDay(time);

  const ctx: Ctx = { units, fc: fc ?? EMPTY, wave: data.wave, wind: data.wind, sea: data.sea, total: data.total, d: data.d };
  const geo: Geo = { times: ft ?? [], pts, xs, hourly, x, width, dayW, id: gradientId, here };
  const { lanes, bubbles, pills } = curvesFor(profile, ctx, geo);

  // Le curseur reste en vue : quand l'heure de la carte sort de l'écran (flèches, lecture), la ligne tourne
  // la page. Un défilement à la main n'est pas repris tant que l'heure ne change pas.
  useLayoutEffect(() => {
    const box = scroller;
    if (!box || dragging.current || box.scrollWidth <= box.clientWidth + 1) return;
    const left = box.scrollLeft;
    const view = box.clientWidth;
    let next: number | null = null;
    if (cursorX < left + 2) next = cursorX - (view * 2) / 3;
    else if (cursorX > left + view - 2) next = cursorX - view / 3;
    if (next != null) box.scrollLeft = Math.max(0, Math.min(next, box.scrollWidth - view));
  }, [cursorX, scroller]);

  // Les titres des couloirs ne défilent pas : leur largeur suit la frontière de la zone Premium à l'écran.
  // Sous 250 px, l'unité se cache ; sous 110 px, le titre aussi. Réglé sans nouveau rendu pendant le défilement.
  const fitHeads = useCallback(() => {
    const frontier = lockedFrom == null ? viewW : Math.min(viewW, lockX - (scroller?.scrollLeft ?? 0));
    const w = Math.max(0, frontier - 6);
    for (const el of heads.current) {
      if (!el) continue;
      el.style.width = `${w}px`;
      el.dataset.fit = w < 110 ? 'none' : w < 250 ? 'title' : 'all';
    }
  }, [lockedFrom, viewW, lockX, scroller]);
  useLayoutEffect(fitHeads);

  /** Le fond d'un couloir : un trait par jour ouvert, les filets de la moitié et du haut de l'échelle. */
  const backdrop = (h: number, grid: boolean) => (
    <>
      {days.slice(1).map((d) => (lockedFrom != null && d >= lockedFrom ? null : <line key={d} className="lane-tick" x1={x(d)} x2={x(d)} y1={0} y2={h} />))}
      {grid && <line className="ov-grid" x1={0} x2={lockX} y1={4} y2={4} />}
      {grid && <line className="ov-grid" x1={0} x2={lockX} y1={(h + 4) / 2} y2={(h + 4) / 2} />}
    </>
  );

  // Les bulles : à droite du curseur, ou à gauche quand la place manque avant la zone Premium ou la fin de la
  // piste. Leur largeur est estimée d'après le texte (11 px, gras), sans attendre un rendu pour la mesurer.
  const placed = placeBubbles(bubbles);
  const estimate = (b: Bubble) => b.text.length * 6.4 + 16 + (b.dir ? 18 + b.dir.label.length * 7.5 : 0);
  const widest = Math.max(0, ...placed.map(estimate));
  const side = cursorX + BUBBLE_GAP + widest > Math.min(width, lockX) - 2 && cursorX - BUBBLE_GAP - widest >= 0 ? 'left' : 'right';

  const plotX = (clientX: number) => clientX - host!.getBoundingClientRect().left;
  const timeAt = (px: number): number => t0 + (Math.min(width, Math.max(0, px)) / width) * (t1 - t0);
  const inZone = (px: number) => lockedFrom != null && px >= lockX;
  // Une heure choisie : la carte y va, sauf dans la zone Premium, qui ouvre l'offre.
  const choose = (clientX: number) => {
    const px = plotX(clientX);
    if (inZone(px)) openOffer();
    else goTo(timeAt(px));
  };

  const count = times?.length ?? 0;
  const showThree = dayW >= THREE_HOURS_MIN_W;
  const zoneH = LANE2_TOP + LANE2_H - LANE1_TOP;

  return (
    <div className="timeline tl" data-profile={profile} aria-busy={data.loading || undefined}>
      <div className="tl-frame">
        <svg className="tl-scale" width={SCALE_W} height={PLOT_H} aria-hidden="true">
          {lanes.map((lane, k) =>
            lane.ticks.map((t) => (
              <text key={`${k}${t.label}${t.y}`} x={SCALE_W - 4} y={LANE_TOP[k] + t.y} dy="0.34em">
                {t.label}
              </text>
            )),
          )}
        </svg>
        <div
          ref={setScroller}
          className="tl-scroll"
          role="slider"
          tabIndex={0}
          aria-label="Échéance affichée sur la carte"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, count - 1)}
          aria-valuenow={times && count ? nearestIndex(times, time) : 0}
          aria-valuetext={`${dayLong.format(time)}, ${formatHour(time)}`}
          onKeyDown={keyStep}
          onScroll={fitHeads}
        >
          <div
            ref={setHost}
            className="tl-plot"
            style={{ width, height: PLOT_H }}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('.tl-fold-label')) return;
              if (e.pointerType === 'touch') {
                touch.current = { id: e.pointerId, x: e.clientX };
                return;
              }
              if (inZone(plotX(e.clientX))) {
                openOffer();
                return;
              }
              e.currentTarget.setPointerCapture(e.pointerId);
              dragging.current = true;
              goTo(timeAt(plotX(e.clientX)));
            }}
            onPointerMove={(e) => {
              // Le doigt a sa capture implicite : seul le glissé de la souris déplace le curseur.
              if (dragging.current && e.currentTarget.hasPointerCapture(e.pointerId)) goTo(timeAt(plotX(e.clientX)));
            }}
            onPointerUp={(e) => {
              const start = touch.current;
              touch.current = null;
              if (start && start.id === e.pointerId && Math.abs(e.clientX - start.x) <= 8) choose(e.clientX);
            }}
            onPointerCancel={() => {
              touch.current = null;
            }}
            onLostPointerCapture={() => {
              dragging.current = false;
            }}
          >
            {lanes.map((lane, k) => (
              <svg
                key={k}
                className="tl-lane"
                style={{ top: LANE_TOP[k] }}
                width={width}
                height={LANE_H[k]}
                viewBox={`0 0 ${width} ${LANE_H[k]}`}
                aria-hidden="true"
              >
                {backdrop(LANE_H[k], lane.ticks.length > 0)}
                {lane.body}
                {lane.dots.map((y, n) => (
                  <circle key={n} className="ov-dot" cx={cursorX} cy={y} r={4} />
                ))}
              </svg>
            ))}
            {pills.map((p) => {
              const Icon = p.icon;
              return (
                <span key={p.key} className="tl-sky" style={{ left: p.x, top: LANE1_TOP + p.y }} title={p.label} aria-hidden="true">
                  <Icon size={14} />
                </span>
              );
            })}
            <span className="tl-cursor" style={{ left: cursorX, top: LANE1_TOP, height: AXIS_TOP - LANE1_TOP }} aria-hidden="true" />
            <div className="tl-hours" style={{ top: AXIS_TOP, width }} aria-hidden="true">
              {days.flatMap((day) =>
                (showThree ? [6, 12, 18] : [12]).map((h) => {
                  const t = new Date(day).setHours(h, 0, 0, 0);
                  return (
                    <span key={t} data-locked={(lockedFrom != null && t >= lockedFrom) || undefined} style={{ left: x(t) }}>
                      {String(h).padStart(2, '0')} h
                    </span>
                  );
                }),
              )}
            </div>
            <div className="tl-axis" style={{ top: AXIS_TOP + HOURS_H }} aria-hidden="true">
              {days.map((day) => (
                <span
                  key={day}
                  data-selected={day === selectedDay || undefined}
                  data-locked={(lockedFrom != null && day >= lockedFrom) || undefined}
                  style={{ left: x(day) }}
                >
                  {dayW >= 46 ? dayShort.format(day) : new Date(day).getDate()}
                </span>
              ))}
            </div>
            {placed.map((b, k) => (
              <span key={k} className="tl-bubble" data-side={side} style={{ left: cursorX, top: b.top }} aria-hidden="true">
                {b.text}
                {b.dir && (
                  <span className="tl-bubble-dir">
                    <Arrow from={b.dir.from} size={11} />
                    {b.dir.label}
                  </span>
                )}
              </span>
            ))}
            {lockedFrom != null && (
              <>
                {/* La zone Premium : chaque couloir continue, hachuré, un filet à chaque début de jour. L'étiquette reste
                    collée à gauche de la partie visible de la zone, centrée en hauteur. */}
                {LANE_TOP.map((top, k) => (
                  <span key={k} className="tl-lock" style={{ left: lockX, width: width - lockX, top, height: LANE_H[k] }} aria-hidden="true" />
                ))}
                {days
                  .filter((d) => d > lockedFrom)
                  .map((d) => (
                    <span key={d} className="tl-lock-day" style={{ left: x(d), top: LANE1_TOP, height: PLOT_H - LANE1_TOP }} aria-hidden="true" />
                  ))}
                <span className="tl-fold-front" style={{ left: lockX, width: width - lockX, top: LANE1_TOP, height: zoneH }}>
                  <button type="button" className="tl-fold-label" aria-label={offerLabel} onClick={() => openOffer()}>
                    <FoldLabel />
                  </button>
                </span>
              </>
            )}
          </div>
        </div>
        {lanes.map((lane, k) => (
          <div
            key={k}
            ref={(el) => {
              heads.current[k] = el;
            }}
            className="lane-head"
            style={{ top: k === 0 ? 0 : LANE2_HEAD_TOP }}
          >
            <span className="tl-keys">{lane.keys}</span>
            <span className="lane-unit">{lane.unit}</span>
          </div>
        ))}
      </div>
      {!place && <span className="tl-hint">Touchez la carte pour voir la prévision d’un point</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ tableau */

function RowLabel({ row, text, unit }: { row: number; text: string; unit?: string }) {
  return (
    <span className="band-label" style={{ gridRow: row }}>
      {text}
      {unit && <span className="band-unit">{unit}</span>}
    </span>
  );
}

/**
 * Le tableau sur toute la prévision : une colonne par pas, les jours au-dessus, les libellés fixes à gauche,
 * les lignes du type choisi en deux groupes. La colonne de l'heure de la carte montre cette heure et reste en
 * vue, au milieu. Version gratuite : après les jours ouverts, les jours de Premium jusqu'à la fin du seizième,
 * au même pas, désactivés : le nom de chaque jour, l'heure de chaque colonne et une case vide hachurée par
 * ligne, de la taille d'une vraie case. L'étiquette reste dans la partie visible de la zone, qui ouvre l'offre.
 */
function TimelineTable() {
  // À l'heure près : pendant la lecture, le tableau (des centaines de pastilles) ne se redessine pas à chaque image.
  const time = useStore((s) => Math.round(s.time / HOUR)) * HOUR;
  const units = useStore((s) => s.units);
  const premium = usePremium();
  const data = useTimelineData();
  const { place, fc, profile, sea, wind, d } = data;
  const days = useAxisDays();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const lockedFrom = premium ? null : days[FREE_DAYS];
  const stepHours = useStore((s) => DAY_STEP_HOURS[s.dayStep]);

  // Une colonne par pas, d'aujourd'hui à la fin du modèle (en gratuit, à la fin des jours ouverts).
  const slots = useMemo(() => {
    const out: number[] = [];
    if (!fc) return out;
    const details = d ? Object.values(d) : [];
    for (let i = 0; i < fc.times.length; i++) {
      const t = fc.times[i];
      if (t < days[0] || (lockedFrom != null && t >= lockedFrom) || new Date(t).getHours() % stepHours !== 0) continue;
      if (at(sea?.height, i) != null || at(wind?.speed, i) != null || details.some((s) => s[i] != null)) out.push(i);
    }
    return out;
  }, [fc, sea, wind, d, days, lockedFrom, stepHours]);

  const ft = fc?.times ?? [];
  const cols = [...slots];
  let active = -1;
  for (let k = 0; k < slots.length; k++) if (ft[slots[k]] <= time) active = k;
  if (active >= 0 && active === slots.length - 1 && time >= ft[slots[active]] + stepHours * HOUR) active = -1;
  if (active >= 0) {
    // La colonne de la tranche en cours montre l'heure de la carte, pas le début de la tranche.
    const exact = nearestIndex(ft, time);
    if (Math.abs(ft[exact] - time) <= HOUR / 2 && exact >= slots[active]) cols[active] = exact;
  }

  // En gratuit, les jours de Premium : une colonne désactivée par pas, du début du sixième jour à la fin du seizième.
  const ghosts = useMemo(() => {
    const out: number[] = [];
    if (lockedFrom == null) return out;
    const end = nextDay(days[days.length - 1]);
    for (let t = lockedFrom; t < end; t += HOUR) if (new Date(t).getHours() % stepHours === 0) out.push(t);
    return out;
  }, [lockedFrom, days, stepHours]);

  // La colonne de l'heure de la carte reste en vue, au milieu quand c'est possible.
  useLayoutEffect(() => {
    const box = scroller;
    const col = box?.querySelector<HTMLElement>('.hourcol[aria-current="time"]');
    if (!box || !col) return;
    const shift = col.getBoundingClientRect().left - box.getBoundingClientRect().left - (box.clientWidth - col.offsetWidth) / 2;
    box.scrollLeft = Math.max(0, Math.min(box.scrollLeft + shift, box.scrollWidth - box.clientWidth));
  }, [active, slots.length, stepHours, scroller]);

  useSideWheel(scroller);

  if (!place || !fc) {
    return (
      <div className="timeline tl tl-table">
        <div className="tl-empty">{place ? 'Chargement de la prévision…' : 'Touchez la carte pour voir la prévision d’un point'}</div>
      </div>
    );
  }

  const ctx: Ctx = { units, fc, wave: data.wave, wind, sea, total: data.total, d };
  const { top, bottom } = tableRows(profile, ctx);
  // Ligne 1 : les jours. Ligne 2 : l'heure. Puis le premier groupe, un filet, le second.
  const sepRow = 3 + top.length;

  // Les jours au-dessus de leurs colonnes.
  const groups: { day: number; start: number; count: number }[] = [];
  cols.forEach((i, k) => {
    const day = startOfLocalDay(ft[i]);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.count++;
    else groups.push({ day, start: k, count: 1 });
  });
  const starts = new Set(groups.map((g) => g.start));
  // Les jours de la zone Premium, chacun au-dessus de ses colonnes.
  const ghostDays: { day: number; start: number; count: number }[] = [];
  ghosts.forEach((t, k) => {
    const day = startOfLocalDay(t);
    const g = ghostDays[ghostDays.length - 1];
    if (g && g.day === day) g.count++;
    else ghostDays.push({ day, start: k, count: 1 });
  });

  return (
    <div className="timeline tl tl-table" data-profile={profile} aria-busy={data.loading || undefined}>
      <div className="band-scroll" ref={setScroller} tabIndex={0} role="group" aria-label={stepHours === 1 ? 'Prévision du point, heure par heure' : `Prévision du point, toutes les ${stepHours} heures`} onKeyDown={keyStep}>
        <div
          className="band"
          style={{
            gridTemplateColumns: `56px repeat(${cols.length}, 40px)${ghosts.length ? ` repeat(${ghosts.length}, 40px)` : ''}`,
            gridTemplateRows: `16px repeat(${sepRow - 2}, auto) 9px repeat(${bottom.length}, auto)`,
          }}
        >
          <span className="band-label" style={{ gridRow: 1 }} />
          <span className="band-label band-label-hour" style={{ gridRow: 2 }}>
            Heure
          </span>
          {top.map((r, k) => (
            <RowLabel key={`t${k}`} row={3 + k} text={r.label} unit={r.unit} />
          ))}
          <span className="band-sep" style={{ gridRow: sepRow }} aria-hidden="true" />
          {/* Dans la colonne des libellés, la ligne du filet cache aussi ce qui défile dessous (les jours repliés). */}
          <span className="band-label band-label-sep" style={{ gridRow: sepRow }} aria-hidden="true" />
          {bottom.map((r, k) => (
            <RowLabel key={`b${k}`} row={sepRow + 1 + k} text={r.label} unit={r.unit} />
          ))}
          {groups.map((g) => (
            <span key={g.day} className="tl-day" style={{ gridColumn: `${g.start + 2} / span ${g.count}`, gridRow: 1 }} aria-hidden="true">
              {/* Un jour d'une seule colonne (au pas de 12 h, la fin d'aujourd'hui) n'a la place que du numéro. */}
              <span className="tl-day-name">{g.count >= 2 ? dayShort.format(g.day) : new Date(g.day).getDate()}</span>
            </span>
          ))}
          {cols.map((i, k) => {
            const t = ft[i];
            const night = fc.isDay ? fc.isDay[i] === 0 : false;
            return (
              <button
                key={k}
                type="button"
                tabIndex={-1}
                className="hourcol"
                style={{ gridColumn: k + 2, gridRow: '2 / -1' }}
                aria-current={k === active ? 'time' : undefined}
                data-night={night || undefined}
                data-daystart={(k > 0 && starts.has(k)) || undefined}
                aria-label={`${dayLong.format(t)}, ${formatHour(t)} : ${top.map((r) => r.say(i)).join(', ')} ; ${bottom.map((r) => r.say(i)).join(', ')}`}
                onClick={() => goTo(t)}
              >
                <span className="hourcol-hour">{hourLabel(t)}</span>
                {top.map((r, n) => (
                  <Fragment key={`t${n}`}>{r.cell(i)}</Fragment>
                ))}
                <span />
                {bottom.map((r, n) => (
                  <Fragment key={`b${n}`}>{r.cell(i)}</Fragment>
                ))}
              </button>
            );
          })}
          {ghosts.length > 0 && (
            <>
              {ghostDays.map((g) => (
                <Fragment key={g.day}>
                  <span className="tl-day tl-ghost-day" style={{ gridColumn: `${cols.length + 2 + g.start} / span ${g.count}`, gridRow: 1 }} aria-hidden="true">
                    <span className="tl-day-name">{g.count >= 2 ? dayShort.format(g.day) : new Date(g.day).getDate()}</span>
                  </span>
                  {/* Le filet entre deux jours, comme entre les jours ouverts. */}
                  <span className="tl-ghost-sep" style={{ gridColumn: cols.length + 2 + g.start, gridRow: '1 / -1' }} aria-hidden="true" />
                </Fragment>
              ))}
              {ghosts.map((t, k) => (
                <span key={t} className="tl-ghost-col" style={{ gridColumn: cols.length + 2 + k, gridRow: '2 / -1' }} aria-hidden="true">
                  <span className="hourcol-hour">{hourLabel(t)}</span>
                  {top.map((r, n) => (
                    <span key={`t${n}`} className="tl-ghost-chip" data-tall={r.tall || undefined} />
                  ))}
                  <span />
                  {bottom.map((r, n) => (
                    <span key={`b${n}`} className="tl-ghost-chip" data-tall={r.tall || undefined} />
                  ))}
                </span>
              ))}
              {/* Toute la zone ouvre l'offre ; l'étiquette reste dans sa partie visible pendant le défilement. */}
              <button type="button" className="tl-fold-cover" style={{ gridColumn: `${cols.length + 2} / span ${ghosts.length}`, gridRow: '1 / -1' }} aria-label={offerLabel} onClick={() => openOffer()}>
                <span className="tl-fold-stick">
                  <FoldLabel />
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
