/**
 * Les alertes : ce que l'API échange, et de quoi les lire à l'écran. Tout est en unités SI ;
 * l'affichage convertit dans les unités des préférences.
 */
import { formatHeight, formatWind, HEIGHT_UNIT_LABEL, WIND_UNIT_LABEL, type Units } from '../lib/units';
import type { Selection } from '../state/store';
import { api } from './api';
import { loadBeaches, loadSpots } from './places';

/** Les créneaux de la journée, dans l'ordre. */
export const PARTS = ['dawn', 'morning', 'afternoon', 'evening'] as const;
export type Part = (typeof PARTS)[number];
export const PART_LABEL: Record<Part, string> = { dawn: 'Aube', morning: 'Matin', afternoon: 'Après-midi', evening: 'Soir' };

export type WindMode = 'any' | 'offshore' | 'sectors';
export const LEAD_DAYS = [1, 2, 3, 5] as const;
export type LeadDays = (typeof LEAD_DAYS)[number];

/** 10 alertes au plus par compte. */
export const MAX_ALERTS = 10;

/** Le lieu d'une alerte : un spot, une plage ou un point de la carte. */
export interface AlertPlace {
  /** Identifiant du lieu dans l'appli (`osm:…`), ou `null` pour un point de la carte. */
  id: string | null;
  kind: 'point' | 'spot' | 'beach';
  name: string;
  lat: number;
  lon: number;
}

/** Les réglages d'une alerte. `swellMax` et `windMax` à `null` : pas de limite haute. */
export interface AlertSettings {
  place: AlertPlace;
  /** Hauteur de houle, en mètres. */
  swellMin: number;
  swellMax: number | null;
  /** Période minimum, en secondes. */
  periodMin: number;
  /** Vent maximum, en m/s. */
  windMax: number | null;
  windMode: WindMode;
  /** Secteurs de provenance du vent : masque de 16 bits, bit 0 = nord, sens des aiguilles d'une montre. */
  sectors: number;
  parts: Part[];
  leadDays: LeadDays;
  channels: { push: boolean; email: boolean };
}

export interface Alert extends AlertSettings {
  id: string;
  paused: boolean;
  /** Prochain créneau dans le délai de l'alerte (ISO 8601), ou `null` s'il n'y en a pas en vue. */
  next: { start: string; end: string } | null;
}

/** Un créneau que les réglages auraient déclenché, avec les valeurs de son milieu. */
export interface PreviewSlot {
  day: string;
  part: Part;
  start: string;
  end: string;
  swell: number | null;
  period: number | null;
  wind: number | null;
  windDir: number | null;
}

/** Haut du curseur de houle (m) et du curseur de vent (nd) : au maximum, plus de limite haute. */
export const SWELL_SCALE_MAX = 4;
export const WIND_SCALE_MAX_KN = 40;
export const KNOT = 1 / 1.943844;

export const listAlerts = (): Promise<Alert[]> => api<{ alerts: Alert[] }>('/api/alerts').then((r) => r.alerts);
export const createAlert = (settings: AlertSettings): Promise<Alert> => api<{ alert: Alert }>('/api/alerts', { json: settings }).then((r) => r.alert);
export const updateAlert = (id: string, settings: AlertSettings): Promise<Alert> =>
  api<{ alert: Alert }>(`/api/alerts/${id}`, { method: 'PATCH', json: settings }).then((r) => r.alert);
export const pauseAlert = (id: string, paused: boolean): Promise<Alert> =>
  api<{ alert: Alert }>(`/api/alerts/${id}`, { method: 'PATCH', json: { paused } }).then((r) => r.alert);
export const deleteAlert = (id: string): Promise<void> => api(`/api/alerts/${id}`, { method: 'DELETE' }).then(() => undefined);
export const previewAlert = (settings: AlertSettings, signal?: AbortSignal): Promise<PreviewSlot[]> =>
  api<{ slots: PreviewSlot[] }>('/api/alerts/preview', { json: settings, signal }).then((r) => r.slots);

/** Un lieu de l'appli peut-il porter une alerte ? Une alerte suit la prévision d'un point : ni bouée, ni webcam. */
export const canAlert = (selection: Selection): boolean => selection.kind === 'point' || selection.kind === 'spot' || selection.kind === 'beach';

/** Le lieu d'une alerte, à partir de ce qui est sélectionné sur la carte. */
export function placeOf(selection: Selection, fallbackName: string): AlertPlace {
  const known = selection.kind === 'spot' || selection.kind === 'beach';
  return {
    id: known ? selection.id : null,
    kind: known ? (selection.kind as 'spot' | 'beach') : 'point',
    name: selection.name || fallbackName,
    lat: selection.lat,
    lon: selection.lon,
  };
}

/** La sélection qui rouvre le panneau du lieu d'une alerte. */
export function selectionOf(place: AlertPlace): Selection {
  return {
    kind: place.kind,
    id: place.id ?? `point:${place.lat.toFixed(3)},${place.lon.toFixed(3)}`,
    name: place.name,
    lat: place.lat,
    lon: place.lon,
  };
}

/**
 * Secteurs de terre d'un lieu : connus pour un spot ou une plage dont l'orientation a été
 * calculée (`scripts/orientation.mjs`), 0 sinon. « De terre » n'est proposé que dans ce cas.
 */
export async function landSectors(place: AlertPlace): Promise<number> {
  if (!place.id || place.kind === 'point') return 0;
  try {
    const list = place.kind === 'spot' ? await loadSpots() : await loadBeaches();
    return list.find((p) => p.id === place.id)?.off ?? 0;
  } catch {
    return 0;
  }
}

/* --------------------------------------------------------------- en toutes lettres */

/** Les 16 secteurs en toutes lettres, du nord dans le sens des aiguilles d'une montre. */
export const SECTOR_NAMES = [
  'nord',
  'nord-nord-est',
  'nord-est',
  'est-nord-est',
  'est',
  'est-sud-est',
  'sud-est',
  'sud-sud-est',
  'sud',
  'sud-sud-ouest',
  'sud-ouest',
  'ouest-sud-ouest',
  'ouest',
  'ouest-nord-ouest',
  'nord-ouest',
  'nord-nord-ouest',
];

/** « de nord », « d'est » : la préposition s'élide devant une voyelle. */
const from = (name: string): string => (/^[eo]/.test(name) ? `d’${name}` : `de ${name}`);

/**
 * Les secteurs d'un masque, en toutes lettres : « d'est à sud-est », « de nord-ouest »,
 * « de nord à est et de sud à sud-ouest ». Chaîne vide pour un masque vide.
 */
export function sectorsPhrase(mask: number): string {
  const on = (i: number) => (mask & (1 << (((i % 16) + 16) % 16))) !== 0;
  if ((mask & 0xffff) === 0xffff) return 'de toutes les directions';
  const arcs: string[] = [];
  for (let i = 0; i < 16; i++) {
    // Un arc commence là où le secteur précédent est éteint.
    if (!on(i) || on(i - 1)) continue;
    let end = i;
    while (on(end + 1)) end++;
    arcs.push(end === i ? from(SECTOR_NAMES[i]) : `${from(SECTOR_NAMES[i])} à ${SECTOR_NAMES[end % 16]}`);
  }
  return arcs.length <= 1 ? (arcs[0] ?? '') : `${arcs.slice(0, -1).join(', ')} et ${arcs[arcs.length - 1]}`;
}

/** Le nom court d'un lieu : « Hossegor » pour « Hossegor · La Gravière ». */
export const shortName = (name: string): string => name.split(' · ')[0].trim() || name;

const NBSP = ' ';

/** « 1,2 à 2,5 m », « 1,2 m et plus ». Un nombre reste collé à son unité. */
export function swellRange(min: number, max: number | null, units: Units): string {
  const unit = HEIGHT_UNIT_LABEL[units.height];
  if (max == null) return `${formatHeight(min, units.height)}${NBSP}${unit} et plus`;
  return `${formatHeight(min, units.height)} à ${formatHeight(max, units.height)}${NBSP}${unit}`;
}

/** « 15 nd » */
export const windText = (ms: number, units: Units): string => `${formatWind(ms, units.wind)}${NBSP}${WIND_UNIT_LABEL[units.wind]}`;

/** Les pastilles d'une alerte dans « Mes alertes » : houle, période, vent. */
export function alertChips(alert: AlertSettings, units: Units): string[] {
  const chips: string[] = [];
  if (alert.swellMin > 0 || alert.swellMax != null) {
    chips.push(alert.swellMin > 0 ? `Houle ${swellRange(alert.swellMin, alert.swellMax, units)}` : `Houle jusqu’à ${formatHeight(alert.swellMax!, units.height)}${NBSP}${HEIGHT_UNIT_LABEL[units.height]}`);
  }
  chips.push(`Période ≥ ${alert.periodMin}${NBSP}s`);
  const direction = alert.windMode === 'offshore' ? 'de terre' : alert.windMode === 'sectors' ? sectorsPhrase(alert.sectors) : '';
  if (alert.windMax != null) chips.push(`Vent ≤ ${windText(alert.windMax, units)}${direction ? `, ${direction}` : ''}`);
  else if (direction) chips.push(`Vent ${direction}`);
  return chips;
}

/** « Matin et soir · 3 jours avant · notification et email » */
export function alertSummary(alert: AlertSettings): string {
  const parts = PARTS.filter((p) => alert.parts.includes(p)).map((p) => PART_LABEL[p].toLowerCase());
  const day = parts.length === PARTS.length ? 'toute la journée' : parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}` : (parts[0] ?? '');
  const lead = alert.leadDays === 1 ? 'la veille' : `${alert.leadDays} jours avant`;
  const channels = [alert.channels.push ? 'notification' : '', alert.channels.email ? 'email' : ''].filter(Boolean).join(' et ');
  const text = [day, lead, channels].filter(Boolean).join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const weekdayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const DAY_MS = 86_400_000;

/** « 7 h », ou « 7 h 30 ». Heure locale de l'appareil, comme dans le reste de l'appli. */
export function hourText(time: number): string {
  const d = new Date(time);
  return `${d.getHours()}${NBSP}h${d.getMinutes() ? `${NBSP}${String(d.getMinutes()).padStart(2, '0')}` : ''}`;
}

/** « aujourd'hui », « demain », ou le jour de la semaine. */
export function dayText(time: number, now = Date.now()): string {
  const start = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((start(time) - start(now)) / DAY_MS);
  return days === 0 ? 'aujourd’hui' : days === 1 ? 'demain' : weekdayFmt.format(time);
}

/** « samedi, de 7 h à 11 h » */
export const slotText = (start: string, end: string, separator = ', '): string =>
  `${dayText(Date.parse(start))}${separator}de ${hourText(Date.parse(start))} à ${hourText(Date.parse(end))}`;
