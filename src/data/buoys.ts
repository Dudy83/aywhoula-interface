/**
 * Bouées houlographiques : dernière mesure de quatre réseaux publics.
 *
 *  - NDBC (NOAA) : Amérique du Nord surtout, plus les bouées du Met Office britannique.
 *    Ses fichiers n'ont pas d'en-têtes CORS : on passe par le relais /proxy/ndbc
 *    (voir vite.config.ts, vercel.json).
 *  - Puertos del Estado : côtes espagnoles. C'est l'interface du site Portus, ouverte
 *    aux navigateurs mais non documentée : elle peut changer sans préavis.
 *  - Marine Institute : bouées météo-océaniques irlandaises (ERDDAP, CC BY 4.0).
 *  - CANDHIS (Cerema) : côtes françaises. Son API demande une clé ; on lit donc le
 *    tableau des relevés de la page publique de chaque bouée, par le relais
 *    /proxy/candhis (pas d'en-têtes CORS). La mise en page peut changer sans préavis.
 *
 * Un réseau qui ne répond pas est ignoré : les autres s'affichent quand même.
 */
import { CANDHIS_STATIONS } from './candhis-stations';

export type BuoySource = 'ndbc' | 'pde' | 'imi' | 'candhis';

export interface BuoyObs {
  /** Identifiant unique : réseau et code de station, par exemple « pde:2136 ». */
  id: string;
  source: BuoySource;
  /** Code de la station chez son réseau. */
  station: string;
  /** Nom fourni avec la mesure ; null pour le NDBC, dont les noms arrivent à part. */
  name: string | null;
  lat: number;
  lon: number;
  time: number;
  /** Hauteur significative (m). */
  waveHeight: number | null;
  /** Hauteur de la plus haute vague (m). */
  maxWaveHeight: number | null;
  /** Période dominante, de pic ou significative selon le réseau (s). */
  dominantPeriod: number | null;
  /** Période moyenne (s). */
  averagePeriod: number | null;
  /** Direction de provenance des vagues (°). */
  waveDirection: number | null;
  windDirection: number | null;
  /** Vent moyen (m/s). */
  windSpeed: number | null;
  gust: number | null;
  pressure: number | null;
  airTemperature: number | null;
  waterTemperature: number | null;
}

export interface BuoySpectral {
  time: number;
  swellHeight: number | null;
  swellPeriod: number | null;
  swellDirection: string | null;
  windWaveHeight: number | null;
  windWavePeriod: number | null;
  windWaveDirection: string | null;
  steepness: string | null;
}

/** Un relevé passé : les mêmes grandeurs que BuoyObs, dans les mêmes unités. */
export interface BuoyHistoryPoint {
  time: number;
  waveHeight: number | null;
  maxWaveHeight: number | null;
  dominantPeriod: number | null;
  waveDirection: number | null;
  windSpeed: number | null;
  waterTemperature: number | null;
}

export interface BuoyNetwork {
  /** Nom court, pour les crédits et les favoris. */
  label: string;
  /** Phrase de source affichée sous les mesures. */
  note: string;
  url: (station: string) => string;
  linkLabel: (station: string) => string;
}

export const BUOY_NETWORKS: Record<BuoySource, BuoyNetwork> = {
  ndbc: {
    label: 'NOAA NDBC',
    note: 'Mesures en temps réel du National Data Buoy Center (NOAA), période dominante et direction des vagues les plus énergétiques.',
    url: (station) => `https://www.ndbc.noaa.gov/station_page.php?station=${station}`,
    linkLabel: (station) => `Station ${station} sur le site du NDBC`,
  },
  pde: {
    label: 'Puertos del Estado',
    note: 'Mesures en temps réel de Puertos del Estado (Espagne), période de pic et direction de provenance au pic.',
    url: () => 'https://portus.puertos.es/',
    linkLabel: () => 'Voir sur Portus, le site de Puertos del Estado',
  },
  imi: {
    label: 'Marine Institute',
    note: 'Mesures en temps réel du Marine Institute (Irlande), sous licence CC BY 4.0. Période de pic et direction moyenne des vagues.',
    url: () => 'https://erddap.marine.ie/erddap/tabledap/IWBNetwork.html',
    linkLabel: () => 'Données du Marine Institute',
  },
  candhis: {
    label: 'CANDHIS',
    note: 'Mesures en temps réel du réseau CANDHIS (Cerema), sous Licence Ouverte, lues sur la page publique de la bouée. Période significative (Th1/3) et direction de provenance au pic.',
    url: (station) => `https://candhis.cerema.fr/_public_/campagne.php?${candhisQuery(station)}`,
    linkLabel: () => 'Voir sur le site CANDHIS',
  },
};

/** Station dont la position est connue d'avance, sans attendre une mesure. */
export interface BuoyStation {
  id: string;
  source: BuoySource;
  station: string;
  name: string;
  lat: number;
  lon: number;
}

/**
 * Bouées placées sur la carte avant toute mesure. Celles dont la mesure manque
 * (panne, relais absent) y restent : leur panneau renvoie vers le site du réseau.
 */
export const KNOWN_STATIONS: BuoyStation[] = CANDHIS_STATIONS.map(([station, name, lat, lon]) => ({
  id: `candhis:${station}`,
  source: 'candhis',
  station,
  name,
  lat,
  lon,
}));

const CACHE_MS = 10 * 60_000;
/** Une station muette depuis plus longtemps n'est plus du temps réel : on ne l'affiche pas. */
const STALE_MS = 12 * 3_600_000;
const KNOT = 0.514444;

export function parseBuoyId(id: string): { source: BuoySource; station: string } {
  const at = id.indexOf(':');
  const head = id.slice(0, at);
  return at > 0 && head in BUOY_NETWORKS ? { source: head as BuoySource, station: id.slice(at + 1) } : { source: 'ndbc', station: id };
}

const finite = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/* ----------------------------------------------------------------------- NDBC */

const NDBC = '/proxy/ndbc';

const num = (s: string | undefined): number | null => {
  if (s === undefined || s === 'MM' || s === 'N/A') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const text = (s: string | undefined): string | null => (s === undefined || s === 'MM' || s === 'N/A' ? null : s);

async function ndbcText(path: string): Promise<string> {
  const res = await fetch(`${NDBC}${path}`);
  if (!res.ok) throw new Error(`NDBC ${res.status}`);
  const body = await res.text();
  // Un relais mal configuré renvoie la page de l'app au lieu du fichier.
  if (/^\s*<!doctype html/i.test(body)) throw new Error('Relais NDBC non configuré');
  return body;
}

const rows = (body: string): string[][] =>
  body
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.trim().split(/\s+/));

async function loadNdbc(): Promise<BuoyObs[]> {
  const body = await ndbcText('/data/latest_obs/latest_obs.txt');
  const out: BuoyObs[] = [];
  for (const c of rows(body)) {
    // STN LAT LON YYYY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES PTDY ATMP WTMP DEWP VIS TIDE
    const waveHeight = num(c[11]);
    const lat = Number(c[1]);
    const lon = Number(c[2]);
    if (waveHeight === null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      id: `ndbc:${c[0]}`,
      source: 'ndbc',
      station: c[0],
      name: null,
      lat,
      lon,
      time: Date.UTC(+c[3], +c[4] - 1, +c[5], +c[6], +c[7]),
      windDirection: num(c[8]),
      windSpeed: num(c[9]),
      gust: num(c[10]),
      waveHeight,
      maxWaveHeight: null,
      dominantPeriod: num(c[12]),
      averagePeriod: num(c[13]),
      waveDirection: num(c[14]),
      pressure: num(c[15]),
      airTemperature: num(c[17]),
      waterTemperature: num(c[18]),
    });
  }
  return out;
}

async function ndbcHistory(station: string): Promise<BuoyHistoryPoint[]> {
  const body = await ndbcText(`/data/realtime2/${station.toUpperCase()}.txt`);
  const since = Date.now() - 5 * 24 * 3_600_000;
  const out: BuoyHistoryPoint[] = [];
  for (const c of rows(body)) {
    // YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE
    const time = Date.UTC(+c[0], +c[1] - 1, +c[2], +c[3], +c[4]);
    if (!Number.isFinite(time) || time < since) continue;
    out.push({
      time,
      windSpeed: num(c[6]),
      waveHeight: num(c[8]),
      maxWaveHeight: null,
      dominantPeriod: num(c[9]),
      waveDirection: num(c[11]),
      waterTemperature: num(c[14]),
    });
  }
  return out.reverse();
}

/** Le nom d'une bouée : celui que donne son réseau, sinon celui de la liste du NDBC, sinon son code. */
export function buoyName(b: { name: string | null; station: string }, known: Map<string, string>): string {
  return b.name || known.get(b.station.toUpperCase()) || `Bouée ${b.station}`;
}

let names: Promise<Map<string, string>> | null = null;

/** Noms des stations du NDBC (fichier XML à part), indexés par code de station. */
export function loadBuoyNames(): Promise<Map<string, string>> {
  names ??= ndbcText('/activestations.xml')
    .then((xml) => {
      const map = new Map<string, string>();
      const re = /<station\s+id="([^"]+)"[^>]*?\sname="([^"]*)"/g;
      for (let m = re.exec(xml); m; m = re.exec(xml)) {
        map.set(m[1].toUpperCase(), m[2].replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"'));
      }
      return map;
    })
    .catch(() => {
      names = null;
      return new Map<string, string>();
    });
  return names;
}

/* --------------------------------------------------------- Puertos del Estado */

const PDE = 'https://portus.puertos.es/portussvr/api';

interface PdeStation {
  id: number;
  nombre: string;
  latitud: number;
  longitud: number;
  disponible: boolean;
  boya: boolean;
}

interface PdeLast {
  /** Heure UTC, « 2026-11-12 11:00:00.0 ». */
  fecha: string;
  datos: { paramEseoo: string; valor: string; factor: number; averia: boolean }[];
}

/** Exécute `task` sur chaque élément, `width` à la fois : on ménage un serveur qui ne nous doit rien. */
async function pooled<T>(items: T[], width: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
}

async function loadPde(): Promise<BuoyObs[]> {
  const res = await fetch(`${PDE}/estaciones/hist/WAVE?locale=es`);
  if (!res.ok) throw new Error(`Puertos del Estado ${res.status}`);
  const stations = ((await res.json()) as PdeStation[]).filter((s) => s.disponible && s.boya);
  const out: BuoyObs[] = [];
  await pooled(stations, 6, async (s) => {
    try {
      const r = await fetch(`${PDE}/lastData/station/${s.id}?locale=es`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '["WAVE","WIND","WATER_TEMP"]',
      });
      if (!r.ok) return;
      const last = (await r.json()) as PdeLast;
      const value = (key: string): number | null => {
        const d = last.datos.find((x) => x.paramEseoo === key && !x.averia);
        return d ? finite(Number(d.valor) / d.factor) : null;
      };
      const time = Date.parse(`${last.fecha.slice(0, 19).replace(' ', 'T')}Z`);
      const waveHeight = value('Hm0');
      if (waveHeight === null || !Number.isFinite(time) || Date.now() - time > STALE_MS) return;
      out.push({
        id: `pde:${s.id}`,
        source: 'pde',
        station: String(s.id),
        name: s.nombre.replace(/^Boya (Costera )?de /i, ''),
        // Une bouée dérive autour de son ancre : sa position mesurée prime sur celle du catalogue.
        lat: value('Latitude') ?? s.latitud,
        lon: value('Longitude') ?? s.longitud,
        time,
        waveHeight,
        maxWaveHeight: value('Hmax'),
        dominantPeriod: value('Tp'),
        averagePeriod: value('Tm02'),
        waveDirection: value('MeanDirPeak') ?? value('MeanDir'),
        windDirection: value('WindDir'),
        windSpeed: value('WindSpeed'),
        gust: null,
        pressure: null,
        airTemperature: null,
        waterTemperature: value('WaterTemp'),
      });
    } catch {
      // Station muette ou réponse illisible : les autres suffisent.
    }
  });
  return out;
}

/* ----------------------------------------------------------- Marine Institute */

const IMI = 'https://erddap.marine.ie/erddap/tabledap/IWBNetwork.json';

interface ErddapTable {
  table: { columnNames: string[]; rows: (string | number | null)[][] };
}

/** Lit une table ERDDAP en objets indexés par nom de colonne. */
async function erddap(query: string): Promise<Record<string, string | number | null>[]> {
  const res = await fetch(`${IMI}?${query}`);
  if (!res.ok) throw new Error(`Marine Institute ${res.status}`);
  const { table } = (await res.json()) as ErddapTable;
  return table.rows.map((row) => Object.fromEntries(table.columnNames.map((name, i) => [name, row[i]])));
}

const knots = (n: unknown): number | null => {
  const v = finite(n);
  return v === null ? null : v * KNOT;
};

async function loadImi(): Promise<BuoyObs[]> {
  const fields =
    'station_id,longitude,latitude,time,AtmosphericPressure,WindDirection,WindSpeed,Gust,WaveHeight,WavePeriod,MeanWaveDirection,Hmax,AirTemperature,SeaTemperature,Tp';
  const table = await erddap(`${fields}&time%3E=now-12hours&orderByMax(%22station_id,time%22)`);
  const out: BuoyObs[] = [];
  for (const r of table) {
    const waveHeight = finite(r.WaveHeight);
    const lat = finite(r.latitude);
    const lon = finite(r.longitude);
    const time = Date.parse(String(r.time));
    if (waveHeight === null || lat === null || lon === null || !Number.isFinite(time)) continue;
    const station = String(r.station_id);
    out.push({
      id: `imi:${station}`,
      source: 'imi',
      station,
      name: `Bouée ${station}`,
      lat,
      lon,
      time,
      waveHeight,
      maxWaveHeight: finite(r.Hmax),
      dominantPeriod: finite(r.Tp),
      averagePeriod: finite(r.WavePeriod),
      waveDirection: finite(r.MeanWaveDirection),
      windDirection: finite(r.WindDirection),
      windSpeed: knots(r.WindSpeed),
      gust: knots(r.Gust),
      pressure: finite(r.AtmosphericPressure),
      airTemperature: finite(r.AirTemperature),
      waterTemperature: finite(r.SeaTemperature),
    });
  }
  return out;
}

async function imiHistory(station: string): Promise<BuoyHistoryPoint[]> {
  const id = encodeURIComponent(`"${station}"`);
  const fields = 'time,WaveHeight,Hmax,Tp,MeanWaveDirection,WindSpeed,SeaTemperature';
  const table = await erddap(`${fields}&station_id=${id}&time%3E=now-5days&orderBy(%22time%22)`);
  return table
    .map((r) => ({
      time: Date.parse(String(r.time)),
      waveHeight: finite(r.WaveHeight),
      maxWaveHeight: finite(r.Hmax),
      dominantPeriod: finite(r.Tp),
      waveDirection: finite(r.MeanWaveDirection),
      windSpeed: knots(r.WindSpeed),
      waterTemperature: finite(r.SeaTemperature),
    }))
    .filter((p) => Number.isFinite(p.time));
}

/* -------------------------------------------------------------------- CANDHIS */

const CANDHIS = '/proxy/candhis';

/** Le site désigne une bouée par son code de campagne encodé en base64, et n'accepte que cette forme exacte. */
function candhisQuery(station: string): string {
  return btoa(`camp=${station}`);
}

/** Relevés lus au dernier chargement, par code de station, du plus ancien au plus récent. */
let candhisHistory = new Map<string, BuoyHistoryPoint[]>();

/** Contenu texte des cellules `tag` d'un morceau de tableau HTML. */
function htmlCells(html: string, tag: 'th' | 'td'): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  return [...html.matchAll(re)].map((m) => m[1].replace(/<[^>]*>/g, '').trim());
}

/**
 * Lit le tableau des relevés d'une page de bouée (48 heures, un relevé par
 * demi-heure, heures UTC). Les colonnes sont repérées par leur en-tête ; une page
 * sans ce tableau donne une liste vide.
 */
function parseCandhis(html: string): BuoyHistoryPoint[] {
  const mark = html.search(/<th\b[^>]*>(?:\s*<[^>]+>)*\s*H1\/3/);
  if (mark < 0) return [];
  const head = html.lastIndexOf('<thead', mark);
  const body = html.indexOf('<tbody', mark);
  const end = html.indexOf('</table>', body);
  if (head < 0 || body < 0 || end < 0) return [];
  const labels = htmlCells(html.slice(head, body), 'th');
  const column = (start: string) => labels.findIndex((label) => label.startsWith(start));
  const at = { height: column('H1/3'), max: column('Hmax'), period: column('Th1/3'), direction: column('Dir'), water: column('Temp') };
  const out: BuoyHistoryPoint[] = [];
  for (const row of html.slice(body, end).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const c = htmlCells(row[1], 'td');
    // Une case vide est une mesure manquante, pas un zéro.
    const value = (i: number): number | null => (i >= 0 && c[i] ? finite(Number(c[i])) : null);
    // Date « 13/11/2026 » et heure « 08:30 », dans les deux premières colonnes.
    const [day, month, year] = (c[0] ?? '').split('/').map(Number);
    const [hour, minute] = (c[1] ?? '').split(':').map(Number);
    const time = Date.UTC(year, month - 1, day, hour, minute);
    const waveHeight = value(at.height);
    if (!Number.isFinite(time) || waveHeight === null) continue;
    out.push({
      time,
      waveHeight,
      maxWaveHeight: value(at.max),
      dominantPeriod: value(at.period),
      waveDirection: value(at.direction),
      windSpeed: null,
      waterTemperature: value(at.water),
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

async function loadCandhis(): Promise<BuoyObs[]> {
  const out: BuoyObs[] = [];
  const histories = new Map<string, BuoyHistoryPoint[]>();
  await pooled(CANDHIS_STATIONS, 4, async ([station, name, lat, lon]) => {
    try {
      // Sans cookies : le site ouvre une session à chaque page, dont l'app n'a pas l'usage.
      const res = await fetch(`${CANDHIS}/campagne.php?${candhisQuery(station)}`, { credentials: 'omit' });
      if (!res.ok) return;
      const history = parseCandhis(await res.text());
      const last = history[history.length - 1];
      if (!last || Date.now() - last.time > STALE_MS) return;
      histories.set(station, history);
      out.push({
        id: `candhis:${station}`,
        source: 'candhis',
        station,
        name,
        lat,
        lon,
        time: last.time,
        waveHeight: last.waveHeight,
        maxWaveHeight: last.maxWaveHeight,
        dominantPeriod: last.dominantPeriod,
        averagePeriod: null,
        waveDirection: last.waveDirection,
        windDirection: null,
        windSpeed: null,
        gust: null,
        pressure: null,
        airTemperature: null,
        waterTemperature: last.waterTemperature,
      });
    } catch {
      // Bouée en panne ou page illisible : elle reste sur la carte, sans mesure.
    }
  });
  candhisHistory = histories;
  return out;
}

/* ------------------------------------------------------------------- ensemble */

const LOADERS: Record<BuoySource, () => Promise<BuoyObs[]>> = { ndbc: loadNdbc, pde: loadPde, imi: loadImi, candhis: loadCandhis };
const feeds = new Map<BuoySource, { at: number; promise: Promise<BuoyObs[]> }>();

function feed(source: BuoySource): Promise<BuoyObs[]> {
  const hit = feeds.get(source);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const entry = { at: Date.now(), promise: LOADERS[source]() };
  feeds.set(source, entry);
  entry.promise.catch(() => {
    if (feeds.get(source) === entry) feeds.delete(source);
  });
  return entry.promise;
}

/**
 * Dernière mesure de chaque bouée, tous réseaux confondus. `onPartial` reçoit la
 * liste à chaque réseau qui répond : la carte se remplit sans attendre le plus lent.
 */
export async function loadBuoys(onPartial?: (list: BuoyObs[]) => void): Promise<BuoyObs[]> {
  const all: BuoyObs[] = [];
  await Promise.all(
    (Object.keys(LOADERS) as BuoySource[]).map((source) =>
      feed(source).then(
        (list) => {
          all.push(...list);
          onPartial?.([...all]);
        },
        () => undefined,
      ),
    ),
  );
  return all;
}

/** Dernière mesure d'une bouée ; ne charge que son réseau. */
export async function loadBuoy(id: string): Promise<BuoyObs | null> {
  const { source, station } = parseBuoyId(id);
  const list = await feed(source);
  return list.find((b) => b.station === station) ?? null;
}

/**
 * Les relevés récents d'une bouée, du plus ancien au plus récent : cinq jours pour
 * le NDBC et le Marine Institute, 48 heures pour CANDHIS ; vide si l'app ne les lit pas.
 */
export function loadBuoyHistory(id: string): Promise<BuoyHistoryPoint[]> {
  const { source, station } = parseBuoyId(id);
  if (source === 'ndbc') return ndbcHistory(station);
  if (source === 'imi') return imiHistory(station);
  // La page d'une bouée CANDHIS porte déjà ses relevés : ils sont lus avec la dernière mesure.
  if (source === 'candhis') return feed(source).then(() => candhisHistory.get(station) ?? []);
  return Promise.resolve([]);
}

/** Décomposition houle / mer du vent la plus récente ; seul le NDBC la fournit. */
export async function loadBuoySpectral(id: string): Promise<BuoySpectral | null> {
  const { source, station } = parseBuoyId(id);
  if (source !== 'ndbc') return null;
  const body = await ndbcText(`/data/realtime2/${station.toUpperCase()}.spec`);
  const c = rows(body)[0];
  if (!c) return null;
  // YY MM DD hh mm WVHT SwH SwP WWH WWP SwD WWD STEEPNESS APD MWD
  return {
    time: Date.UTC(+c[0], +c[1] - 1, +c[2], +c[3], +c[4]),
    swellHeight: num(c[6]),
    swellPeriod: num(c[7]),
    windWaveHeight: num(c[8]),
    windWavePeriod: num(c[9]),
    swellDirection: text(c[10]),
    windWaveDirection: text(c[11]),
    steepness: text(c[12]),
  };
}
