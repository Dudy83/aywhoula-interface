/**
 * Métadonnées des runs et adresses des blocs de grille. Tout se lit sous `/grilles/`, sur l'origine
 * de l'appli : le serveur prépare les blocs à partir des fichiers d'Open-Meteo, le navigateur ne
 * parle plus à S3.
 */

const BASE = '/grilles';
const META_TTL = 10 * 60_000;

export interface RunMeta {
  domain: string;
  /** Heure du run (ms UTC). */
  referenceTime: number;
  /** Échéances disponibles (ms UTC), triées. */
  validTimes: number[];
  variables: Set<string>;
}

/** « 2026-11-12T00:00Z » ou « 2026-11-12T00:00:00Z » -> ms UTC. */
function parseUtc(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

const metaCache = new Map<string, { at: number; promise: Promise<RunMeta> }>();

export function getRunMeta(domain: string): Promise<RunMeta> {
  const hit = metaCache.get(domain);
  if (hit && Date.now() - hit.at < META_TTL) return hit.promise;
  const promise = (async () => {
    // Le `latest.json` d'Open-Meteo, relayé tel quel par le serveur, qui dit de le garder une minute.
    const res = await fetch(`${BASE}/${domain}/latest.json`);
    if (!res.ok) throw new Error(`Métadonnées ${domain} indisponibles (${res.status})`);
    const json = (await res.json()) as { reference_time: string; valid_times: string[]; variables: string[] };
    const validTimes = json.valid_times.map(parseUtc).filter(Number.isFinite);
    if (validTimes.length === 0) throw new Error(`Aucune échéance pour ${domain}`);
    return {
      domain,
      referenceTime: parseUtc(json.reference_time),
      validTimes,
      variables: new Set(json.variables),
    };
  })();
  metaCache.set(domain, { at: Date.now(), promise });
  promise.catch(() => {
    if (metaCache.get(domain)?.promise === promise) metaCache.delete(domain);
  });
  return promise;
}

const p2 = (n: number) => String(n).padStart(2, '0');

/**
 * L'adresse d'un champ, c'est-à-dire d'une échéance d'un run : `/grilles/<domaine>/<run>/<échéance>`.
 * Le run a la forme du chemin d'Open-Meteo (`2026/11/26/0000Z`), l'échéance celle du nom de son
 * fichier (`2026-11-26T1200`).
 */
export function fieldUrl(domain: string, referenceTime: number, validTime: number): string {
  const r = new Date(referenceTime);
  const v = new Date(validTime);
  const run = `${r.getUTCFullYear()}/${p2(r.getUTCMonth() + 1)}/${p2(r.getUTCDate())}/${p2(r.getUTCHours())}${p2(r.getUTCMinutes())}Z`;
  const time = `${v.getUTCFullYear()}-${p2(v.getUTCMonth() + 1)}-${p2(v.getUTCDate())}T${p2(v.getUTCHours())}${p2(v.getUTCMinutes())}`;
  return `${BASE}/${domain}/${run}/${time}`;
}

/**
 * L'adresse d'un bloc d'une variable d'un champ : le bloc (by, bx) du niveau de réduction `level`
 * (un point sur 2^level de la grille). Un bloc ne change jamais : le navigateur le garde.
 */
export function blockUrl(field: string, variable: string, level: number, by: number, bx: number): string {
  return `${field}/${variable}/${level}/${by}-${bx}.bin`;
}
