/** Spots, plages et webcams (fichiers tirés d'OpenStreetMap) et recherche de lieux. */

export interface Place {
  id: string;
  kind: 'spot' | 'beach' | 'webcam';
  name: string;
  lon: number;
  lat: number;
  /** Sports (spots) : « surf », « kite », « windsurf », séparés par des virgules. */
  sports?: string;
  /** Adresse de la page (webcams). */
  url?: string;
  /**
   * Secteurs de terre (spots et plages) : les directions d'où vient un vent de terre. Masque
   * de 16 bits, bit 0 = nord, sens des aiguilles d'une montre ; 0 quand l'orientation n'est
   * pas connue. Calculé par `scripts/orientation.mjs`.
   */
  off?: number;
  /** Nom normalisé pour la recherche. */
  norm: string;
}

export const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

interface DataFile {
  rows: (string | number)[][];
}

async function loadFile(name: string): Promise<DataFile> {
  const res = await fetch(`/data/${name}.json`);
  if (!res.ok) throw new Error(`Fichier ${name} indisponible`);
  return (await res.json()) as DataFile;
}

/** Garde le résultat en mémoire, mais pas un échec : l'appel suivant réessaie. */
function cached<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => {
    if (!promise) {
      const attempt = load();
      promise = attempt;
      attempt.catch(() => {
        if (promise === attempt) promise = null;
      });
    }
    return promise;
  };
}

export const loadSpots = cached<Place[]>(() =>
  loadFile('spots').then((f) =>
    f.rows.map((r) => ({
      id: `osm:${r[0]}`,
      kind: 'spot' as const,
      name: String(r[1]),
      lon: Number(r[2]),
      lat: Number(r[3]),
      sports: String(r[4]),
      off: Number(r[5]) || 0,
      norm: normalize(String(r[1])),
    })),
  ),
);

export const loadBeaches = cached<Place[]>(() =>
  loadFile('beaches').then((f) =>
    f.rows.map((r) => ({
      id: `osm:${r[0]}`,
      kind: 'beach' as const,
      name: String(r[1]),
      lon: Number(r[2]),
      lat: Number(r[3]),
      off: Number(r[4]) || 0,
      norm: normalize(String(r[1])),
    })),
  ),
);

export const loadWebcams = cached<Place[]>(() =>
  loadFile('webcams').then((f) =>
    f.rows.map((r) => {
      const url = String(r[4]);
      let host = '';
      try {
        host = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        host = '';
      }
      const name = String(r[1]) || host || 'Webcam';
      return {
        id: `osm:${r[0]}`,
        kind: 'webcam' as const,
        name,
        lon: Number(r[2]),
        lat: Number(r[3]),
        url,
        norm: normalize(name),
      };
    }),
  ),
);

const SPORT_LABEL: Record<string, string> = { surf: 'Surf', kite: 'Kitesurf', windsurf: 'Windsurf' };

export function sportsLabel(sports: string | undefined): string {
  if (!sports) return '';
  return sports
    .split(',')
    .map((s) => SPORT_LABEL[s] ?? s)
    .join(' · ');
}

/** Distance approchée en km (suffisante pour trier des résultats). */
export function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const x = (lon2 - lon1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.hypot(x, y) * 6371;
}

export interface PlaceHit {
  place: Place;
  distance: number;
}

/**
 * Cherche dans les spots et les plages. Les noms qui commencent par la requête
 * passent avant ceux qui la contiennent ; à égalité, le plus proche du centre
 * de la carte d'abord (il y a beaucoup de « Plage Nord »).
 */
export async function searchPlaces(query: string, near: { lon: number; lat: number }, limit = 8): Promise<PlaceHit[]> {
  const q = normalize(query);
  if (q.length < 2) return [];
  const [s, b] = await Promise.all([loadSpots(), loadBeaches().catch(() => [] as Place[])]);
  const scored: { place: Place; rank: number; distance: number }[] = [];
  const consider = (place: Place, bonus: number) => {
    const at = place.norm.indexOf(q);
    if (at < 0) return;
    const wordStart = at === 0 || place.norm[at - 1] === ' ';
    const rank = (at === 0 ? 0 : wordStart ? 1 : 2) + bonus;
    scored.push({ place, rank, distance: distanceKm(near.lon, near.lat, place.lon, place.lat) });
  };
  for (const p of s) consider(p, 0);
  for (const p of b) consider(p, 0.5);
  scored.sort((x, y) => Math.floor(x.rank) - Math.floor(y.rank) || x.distance - y.distance || x.rank - y.rank);
  return scored.slice(0, limit).map(({ place, distance }) => ({ place, distance }));
}

export interface GeoHit {
  id: string;
  name: string;
  context: string;
  lon: number;
  lat: number;
}

/** Villes et lieux-dits, via le géocodeur d'Open-Meteo (par le relais du serveur). */
export async function geocode(query: string, signal?: AbortSignal): Promise<GeoHit[]> {
  if (query.trim().length < 2) return [];
  const url = `/api/meteo/geocoding?${new URLSearchParams({
    name: query.trim(),
    count: '5',
    language: 'fr',
    format: 'json',
  })}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    results?: { id: number; name: string; admin1?: string; country?: string; latitude: number; longitude: number }[];
  };
  return (json.results ?? []).map((r) => ({
    id: `geo:${r.id}`,
    name: r.name,
    context: [r.admin1, r.country].filter(Boolean).join(', '),
    lon: r.longitude,
    lat: r.latitude,
  }));
}
