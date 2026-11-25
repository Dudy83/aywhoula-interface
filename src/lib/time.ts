const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' });
const dayLongFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const hourFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const runFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** « jeu. 12 » */
export function formatDay(t: number): string {
  return dayFmt.format(t);
}

const dayMonthFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

/** « jeu. 12 nov. » */
export function formatDayMonth(t: number): string {
  return dayMonthFmt.format(t);
}

/** « jeudi 12 novembre » */
export function formatDayLong(t: number): string {
  return dayLongFmt.format(t);
}

/** « 14:00 » en heure locale du navigateur. */
export function formatHour(t: number): string {
  return hourFmt.format(t);
}

/** Heure seule, sans minutes : « 14 h ». */
export function formatHourShort(t: number): string {
  return `${new Date(t).getHours()} h`;
}

/** Run d'un modèle : « mer. 11 nov. 12Z ». */
export function formatRun(t: number): string {
  return `${runFmt.format(t)} ${String(new Date(t).getUTCHours()).padStart(2, '0')}Z`;
}

export function startOfLocalDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** « il y a 12 min », « il y a 3 h », « il y a 2 j ». */
export function formatAgo(t: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

/** Indice du temps le plus proche de `t` dans une liste triée. */
export function nearestIndex(times: readonly number[], t: number): number {
  if (times.length === 0) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return Math.abs(times[lo] - t) <= Math.abs(times[hi] - t) ? lo : hi;
}

/** Indice `i` tel que times[i] <= t < times[i+1] (borné), et fraction entre les deux. */
export function bracket(times: readonly number[], t: number): { index: number; mix: number } {
  const n = times.length;
  if (n === 0) return { index: -1, mix: 0 };
  if (t <= times[0]) return { index: 0, mix: 0 };
  if (t >= times[n - 1]) return { index: n - 1, mix: 0 };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return { index: lo, mix: (t - times[lo]) / (times[hi] - times[lo]) };
}
