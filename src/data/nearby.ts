/**
 * Ce qu'il y a autour d'un lieu, pour le dialog d'un lieu et la ligne de temps : les spots, plages,
 * webcams et bouées voisins, le lieu que filme une webcam, et ce que l'orientation d'un spot ou d'une
 * plage (masque `off`) dit d'une houle ou d'un vent. Distances en km, directions en degrés de provenance.
 */
import { useEffect, useState } from 'react';
import { fmt } from '../lib/units';
import type { Selection } from '../state/store';
import { SECTOR_NAMES, sectorsPhrase } from './alerts';
import { BUOY_NETWORKS, buoyName, KNOWN_STATIONS, loadBuoyNames, loadBuoys, type BuoyObs, type BuoySource } from './buoys';
import { distanceKm, loadBeaches, loadSpots, loadWebcams, sportsLabel, type Place } from './places';

/** Un élément voisin et sa distance (km). */
export interface Near<T> {
  item: T;
  km: number;
}

/** Les `limit` éléments les plus proches à moins de `maxKm`, du plus proche au plus loin. */
export function nearest<T extends { lon: number; lat: number }>(
  list: readonly T[],
  lon: number,
  lat: number,
  maxKm: number,
  limit: number,
  keep: (item: T) => boolean = () => true,
): Near<T>[] {
  // Un premier tri en degrés évite de calculer la distance de chaque lieu du monde.
  const dLat = maxKm / 110;
  const dLon = maxKm / (110 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  const out: Near<T>[] = [];
  for (const item of list) {
    if (Math.abs(item.lat - lat) > dLat || Math.abs(item.lon - lon) > dLon || !keep(item)) continue;
    const km = distanceKm(lon, lat, item.lon, item.lat);
    if (km <= maxKm) out.push({ item, km });
  }
  return out.sort((a, b) => a.km - b.km).slice(0, limit);
}

/** Les spots et les plages, ensemble ; un fichier qui ne répond pas compte pour une liste vide. */
export async function loadCoastPlaces(): Promise<Place[]> {
  const [spots, beaches] = await Promise.all([loadSpots().catch(() => [] as Place[]), loadBeaches().catch(() => [] as Place[])]);
  return [...spots, ...beaches];
}

export const loadWebcamList = (): Promise<Place[]> => loadWebcams().catch(() => [] as Place[]);

/** Une webcam filme le lieu (plage ou spot) le plus proche d'elle, à moins de 1 km. */
export const FILMED_KM = 1;

export async function filmedPlace(lon: number, lat: number): Promise<Near<Place> | null> {
  return nearest(await loadCoastPlaces(), lon, lat, FILMED_KM, 1)[0] ?? null;
}

/** Le résultat d'un calcul asynchrone, refait quand `key` change ; `undefined` tant qu'il n'est pas arrivé. */
export function useAsync<T>(key: string | null, run: () => Promise<T>): T | undefined {
  const [state, setState] = useState<{ key: string; value: T } | null>(null);
  useEffect(() => {
    if (key == null) return;
    let cancelled = false;
    run().then(
      (value) => !cancelled && setState({ key, value }),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
    // `run` change à chaque rendu ; ce qu'il calcule ne dépend que de `key`.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state && state.key === key ? state.value : undefined;
}

/** Le lieu que filme une webcam : `undefined` tant qu'on le cherche, `null` sans lieu à moins de 1 km. */
export function useFilmedPlace(webcam: { lon: number; lat: number } | null): Near<Place> | null | undefined {
  return useAsync(webcam ? `${webcam.lon},${webcam.lat}` : null, () => filmedPlace(webcam!.lon, webcam!.lat));
}

/**
 * Le point dont la ligne de temps et le dialog montrent la prévision : le lieu lui-même ; pour une webcam,
 * le lieu qu'elle filme, sinon la caméra. `null` tant que ce lieu se cherche.
 */
export function useForecastPoint(place: Selection | null): { lat: number; lon: number } | null {
  const filmed = useFilmedPlace(place?.kind === 'webcam' ? place : null);
  if (!place) return null;
  if (place.kind !== 'webcam') return place;
  if (filmed === undefined) return null;
  return filmed ? filmed.item : place;
}

/** La sélection qui ouvre un spot, une plage ou une webcam, comme un toucher sur la carte. */
export const placeSelection = (p: Place): Selection => ({
  kind: p.kind,
  id: p.id,
  name: p.name,
  lon: p.lon,
  lat: p.lat,
  detail: p.kind === 'webcam' ? p.url : sportsLabel(p.sports) || undefined,
});

/* --------------------------------------------------------------------- bouées */

/** Une bouée de la carte, avec sa dernière mesure, ou `null` si elle n'en publie pas en ce moment. */
export interface BuoyPlace {
  id: string;
  source: BuoySource;
  station: string;
  name: string;
  lon: number;
  lat: number;
  obs: BuoyObs | null;
}

export const buoySelection = (b: BuoyPlace): Selection => ({
  kind: 'buoy',
  id: b.id,
  name: b.name,
  lon: b.lon,
  lat: b.lat,
  detail: `${BUOY_NETWORKS[b.source].label} · ${b.station}`,
});

/**
 * Toutes les bouées, mesurées ou non, une fois que chaque réseau a répondu (ou échoué) : avant, une
 * bouée d'un réseau en retard passerait pour muette. Les mêmes lectures que la carte, en cache.
 */
export async function loadBuoyPlaces(): Promise<BuoyPlace[]> {
  const [obs, names] = await Promise.all([loadBuoys(), loadBuoyNames()]);
  const seen = new Set(obs.map((b) => b.id));
  return [
    ...obs.map((b) => ({ id: b.id, source: b.source, station: b.station, name: buoyName(b, names), lon: b.lon, lat: b.lat, obs: b })),
    ...KNOWN_STATIONS.filter((s) => !seen.has(s.id)).map((s) => ({ ...s, obs: null })),
  ];
}

/** Une mesure de moins de 2 heures : la bouée publie en ce moment. */
export const LIVE_MS = 2 * 3_600_000;
export const isLive = (obs: BuoyObs | null | undefined, now = Date.now()): boolean => obs != null && now - obs.time < LIVE_MS;

/* ---------------------------------------------------------------- orientation */

/** Le secteur (0 à 15, 0 = nord, sens des aiguilles d'une montre) d'une direction. */
export const sectorOf = (deg: number): number => Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;

/**
 * La direction d'où vient une houle ou un vent est-elle côté terre ? D'après le masque `off` d'un spot ou
 * d'une plage (bit k : le secteur k × 22,5° est côté terre à moins de 2 km). `null` quand l'orientation
 * n'est pas connue (masque nul) ou la direction manque.
 */
export const fromLand = (off: number | undefined, deg: number | null | undefined): boolean | null =>
  off && deg != null && Number.isFinite(deg) ? (off & (1 << sectorOf(deg))) !== 0 : null;

/** « de l'ouest », « du sud-sud-est » : d'où vient une houle ou un vent. */
export function fromWords(deg: number): string {
  const name = SECTOR_NAMES[sectorOf(deg)];
  return /^[eo]/.test(name) ? `de l’${name}` : `du ${name}`;
}

/**
 * Les bonnes conditions d'un spot, tirées de son masque : la houle des secteurs côté mer, le vent des
 * secteurs côté terre. `null` quand l'orientation n'est pas connue.
 */
export function goodConditions(off: number | undefined): string | null {
  if (!off) return null;
  const sea = ~off & 0xffff;
  return [sea ? `houle ${sectorsPhrase(sea)}` : '', `vent de terre ${sectorsPhrase(off & 0xffff)}`].filter(Boolean).join(', ');
}

/** Direction (degrés depuis le nord) pour aller d'un point à un autre. */
export function bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** Écart entre deux directions, de 0 à 180°. */
export const angleGap = (a: number, b: number): number => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/* ---------------------------------------------------------- trajet de la houle */

/** Vitesse de groupe d'une houle au large : g·T/4π, soit 2,81 km/h par seconde de période. */
const GROUP_KMH_PER_S = 2.81;

/** Temps de trajet d'une houle de période `period` (s) sur `km`, en minutes arrondies aux 5 minutes. */
export const travelMinutes = (km: number, period: number): number => Math.round((km / (GROUP_KMH_PER_S * period)) * 12) * 5;

/** « 40 min », « 1 h 10 », « 2 h », d'un seul tenant (espaces insécables). */
export function durationText(minutes: number): string {
  const nb = ' ';
  if (minutes < 5) return `moins de 5${nb}min`;
  if (minutes < 60) return `${minutes}${nb}min`;
  const m = minutes % 60;
  return `${Math.floor(minutes / 60)}${nb}h${m ? `${nb}${String(m).padStart(2, '0')}` : ''}`;
}

/** Une houle arrive-t-elle d'une bouée jusqu'à un lieu ? Il est dans la direction où elle va, à 60° près. */
export const downstream = (from: number, buoy: { lon: number; lat: number }, place: { lon: number; lat: number }): boolean =>
  angleGap(bearing(buoy.lon, buoy.lat, place.lon, place.lat), (from + 180) % 360) <= 60;

export interface Arrival {
  place: Place;
  km: number;
  minutes: number;
}

/**
 * Les spots et plages où arrive la houle mesurée par une bouée : à moins de 70 km, dans la direction où va
 * la houle (à 60° près) et ouverts à elle (le secteur d'où elle vient est côté mer). Les quatre où elle
 * arrive le plus tôt ; à temps égal, un spot avant une plage. Une plage à moins de 1,5 km d'un spot du même
 * nom n'est pas comptée deux fois.
 */
export function swellArrivals(places: readonly Place[], buoy: { lon: number; lat: number }, from: number, period: number): Arrival[] {
  const spots = places.filter((p) => p.kind === 'spot');
  const open = nearest(places, buoy.lon, buoy.lat, 70, Infinity, (p) => fromLand(p.off, from) === false && downstream(from, buoy, p));
  return open
    .filter((n) => n.item.kind === 'spot' || nearest(spots, n.item.lon, n.item.lat, 1.5, 1, (s) => s.norm === n.item.norm).length === 0)
    .map((n) => ({ place: n.item, km: n.km, minutes: travelMinutes(n.km, period) }))
    .sort((a, b) => a.minutes - b.minutes || Number(a.place.kind !== 'spot') - Number(b.place.kind !== 'spot') || a.km - b.km)
    .slice(0, 4);
}

/* --------------------------------------------------------------------- textes */

/** « 6,9 km », « 33 km ». `decimals` : toujours un chiffre après la virgule (« 26,0 km »). */
export function kmText(km: number, decimals = false): string {
  return `${fmt(km, decimals || km < 10 ? 1 : 0)} km`;
}

/** « à 90 m », « à 1,2 km » : une courte distance, en mètres sous le kilomètre. */
export function shortDistanceText(km: number): string {
  return km < 1 ? `${Math.max(10, Math.round(km * 100) * 10)} m` : kmText(km);
}

/** Le site d'une adresse : « webcam-hd.fr ». */
export function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}
