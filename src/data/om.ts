/** Métadonnées des runs et adresses des fichiers d'échéance (bucket public Open-Meteo sur S3). */

const BASE = 'https://openmeteo.s3.amazonaws.com/data_spatial';
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
    const res = await fetch(`${BASE}/${domain}/latest.json`, { cache: 'no-cache' });
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

export function omFileUrl(domain: string, referenceTime: number, validTime: number): string {
  const r = new Date(referenceTime);
  const v = new Date(validTime);
  const run = `${r.getUTCFullYear()}/${p2(r.getUTCMonth() + 1)}/${p2(r.getUTCDate())}/${p2(r.getUTCHours())}${p2(r.getUTCMinutes())}Z`;
  const file = `${v.getUTCFullYear()}-${p2(v.getUTCMonth() + 1)}-${p2(v.getUTCDate())}T${p2(v.getUTCHours())}${p2(v.getUTCMinutes())}`;
  return `${BASE}/${domain}/${run}/${file}.om`;
}
