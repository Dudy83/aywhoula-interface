/**
 * La frise des jours : la barre du bas du téléphone, sans lieu ou sous la ligne d'un lieu réduit. Une piste sur
 * toute la largeur, une étiquette par jour séparée par un filet (« Ven. 27 », aujourd'hui en gras ; au-delà de
 * sept jours, le numéro seul), la partie passée en accent et un curseur rond sur l'heure de la carte.
 * Elle couvre les jours de la ligne de temps de la carte (`timeline.times`), à partir d'aujourd'hui, et s'arrête
 * à la limite de la version gratuite (`timeLimit`) : la zone Premium reste dans le tableau et les courbes de la
 * feuille d'un lieu. Toucher la piste ou faire glisser le curseur amène la carte, en direct, à l'échéance la
 * plus proche ; c'est le même `time` que la carte, le tableau et la lecture, qui fait avancer le curseur.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { nearestIndex } from '../lib/time';
import { useStore } from '../state/store';
import { dayLong, dayShort, nextDay, useAxisDays } from './timeline/shared';

/** Au-delà de ce nombre de jours, une étiquette n'a plus que le numéro du jour. */
const FULL_LABEL_MAX_DAYS = 7;
/** Plus étroit, un jour n'a pas la place de « Sam. 28 » : le numéro seul, comme sur l'axe des courbes. */
const FULL_LABEL_MIN_W = 46;

/** « 10 h », ou « 10 h 30 » dans un fuseau décalé d'une demi-heure. */
function spokenHour(t: number): string {
  const d = new Date(t);
  const minutes = d.getMinutes();
  return minutes === 0 ? `${d.getHours()} h` : `${d.getHours()} h ${String(minutes).padStart(2, '0')}`;
}

/** Le même moment, un jour plus tard ou plus tôt, à la même heure de l'horloge (changement d'heure compris). */
function shiftDays(t: number, days: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** L'heure de la carte, à l'échéance de la frise la plus proche de `t`. La lecture s'arrête, comme sur la ligne de temps. */
function goTo(steps: readonly number[], t: number): void {
  const store = useStore.getState();
  const next = steps[nearestIndex(steps, t)];
  if (next === undefined) return;
  if (store.playing) store.setPlaying(false);
  if (next !== store.time) store.setTime(next);
}

export function DayStrip() {
  const times = useStore((s) => s.timeline?.times);
  const time = useStore((s) => s.time);
  const limit = useStore((s) => s.timeLimit);
  const axis = useAxisDays();
  const [track, setTrack] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const dragging = useRef<number | null>(null);

  // La largeur de la piste décide de la forme des étiquettes.
  useEffect(() => {
    if (!track) return;
    const measure = () => setWidth(track.clientWidth);
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    measure();
    return () => ro.disconnect();
  }, [track]);

  // Les jours de la frise, d'aujourd'hui au dernier permis, et leurs échéances.
  const { days, steps } = useMemo(() => {
    if (!times?.length) return { days: [] as number[], steps: [] as number[] };
    const end = Math.min(times[times.length - 1], limit ?? Infinity);
    const days = axis.filter((d) => d <= end && nextDay(d) > times[0]);
    if (days.length === 0) return { days, steps: [] as number[] };
    return { days, steps: times.filter((t) => t >= days[0] && t <= end) };
  }, [times, limit, axis]);

  if (days.length === 0 || steps.length === 0) {
    return (
      <div className="day-strip" aria-busy="true" aria-label="Chargement des échéances">
        <div className="day-strip-track" />
      </div>
    );
  }

  const t0 = days[0];
  const t1 = nextDay(days[days.length - 1]);
  /** La place d'un moment sur la piste, en pourcentage de sa largeur. */
  const at = (t: number) => Math.min(100, Math.max(0, ((t - t0) / (t1 - t0)) * 100));
  const full = days.length <= FULL_LABEL_MAX_DAYS && (width === 0 || width / days.length >= FULL_LABEL_MIN_W);
  const index = nearestIndex(steps, time);
  const cursor = at(time);

  const timeAt = (clientX: number): number => {
    const r = track!.getBoundingClientRect();
    return t0 + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (t1 - t0);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !track) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = e.pointerId;
    goTo(steps, timeAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current === e.pointerId && track) goTo(steps, timeAt(e.clientX));
  };
  const onPointerEnd = () => {
    dragging.current = null;
  };

  // Flèches : une échéance ; Page haut et Page bas : un jour ; Début et Fin : les bouts de la frise.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let target: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') target = steps.find((t) => t > time) ?? steps[steps.length - 1];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') target = steps.findLast((t) => t < time) ?? steps[0];
    else if (e.key === 'PageUp') target = shiftDays(time, 1);
    else if (e.key === 'PageDown') target = shiftDays(time, -1);
    else if (e.key === 'Home') target = steps[0];
    else if (e.key === 'End') target = steps[steps.length - 1];
    if (target == null) return;
    e.preventDefault();
    goTo(steps, target);
  };

  return (
    <div
      className="day-strip"
      role="slider"
      tabIndex={0}
      aria-label="Échéance affichée sur la carte"
      aria-valuemin={0}
      aria-valuemax={steps.length - 1}
      aria-valuenow={index}
      aria-valuetext={`${dayLong.format(time)}, ${spokenHour(time)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      <div className="day-strip-days" aria-hidden="true">
        {days.map((day) => (
          <span key={day} className="day-strip-day" data-today={day === axis[0] || undefined} style={{ left: `${at(day)}%`, width: `${at(nextDay(day)) - at(day)}%` }}>
            {full ? dayShort.format(day) : new Date(day).getDate()}
          </span>
        ))}
      </div>
      <div ref={setTrack} className="day-strip-track" aria-hidden="true">
        <span className="day-strip-past" style={{ width: `${cursor}%` }} />
        <span className="day-strip-thumb" style={{ left: `${cursor}%` }} />
      </div>
    </div>
  );
}
