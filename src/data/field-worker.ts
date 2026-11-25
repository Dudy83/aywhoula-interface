/// <reference lib="webworker" />
/**
 * Lit des variables dans les fichiers .om (requêtes HTTP partielles + décodage
 * WebAssembly) hors du fil principal, puis prépare les tableaux pour le rendu :
 * sous-échantillonnage, valeur « sans donnée », prolongement vers la côte.
 */
import { LruBlockCache, OmDataType, OmHttpBackend } from '@openmeteo/file-reader';

export const NODATA = -9999;

/** Fenêtre de lecture dans la grille (indices, borne haute exclue) et pas de sous-échantillonnage. */
export interface ReadWindow {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  stride: number;
  /** La fenêtre fait le tour du globe : le prolongement boucle en longitude. */
  wrap: boolean;
}

export type FieldJob = { id: number; url: string; win: ReadWindow; dilate: number } & (
  | { op: 'scalar'; variable: string; scale: number }
  | { op: 'speed'; u: string; v: string }
  | { op: 'dir'; variable: string; towards: boolean }
);

export type WorkerIn = { type: 'job'; job: FieldJob } | { type: 'abort'; id: number };

export type WorkerOut =
  | { id: number; ok: true; nx: number; ny: number; arrays: Float32Array[] }
  | { id: number; ok: false; aborted: boolean; error: string };

const cache = new LruBlockCache(64 * 1024, 256);
const backends = new Map<string, OmHttpBackend>();
const controllers = new Map<number, AbortController>();

function backendFor(url: string): OmHttpBackend {
  let b = backends.get(url);
  if (b) {
    backends.delete(url);
  } else {
    b = new OmHttpBackend({ url, eTagValidation: false });
    if (backends.size >= 24) {
      const oldest = backends.keys().next().value as string;
      void backends.get(oldest)?.close();
      backends.delete(oldest);
    }
  }
  backends.set(url, b);
  return b;
}

interface Raw {
  data: Float32Array;
  nx: number;
  ny: number;
}

async function readVariables(url: string, names: string[], win: ReadWindow, signal: AbortSignal): Promise<Raw[]> {
  return backendFor(url).withReader(cache, async (reader) => {
    const out: Raw[] = [];
    for (const name of names) {
      const child = await reader.getChildByName(name);
      if (!child) throw new Error(`Variable « ${name} » absente du fichier`);
      try {
        const [ny, nx] = child.getDimensions();
        const y1 = Math.min(win.y1, ny);
        const x1 = Math.min(win.x1, nx);
        const data = await child.read({
          type: OmDataType.FloatArray,
          ranges: [
            { start: win.y0, end: y1 },
            { start: win.x0, end: x1 },
          ],
          signal,
        });
        out.push({ data, nx: x1 - win.x0, ny: y1 - win.y0 });
      } finally {
        child.dispose();
      }
    }
    return out;
  });
}

/** Garde un point sur `stride` dans chaque direction. */
function decimate(raw: Raw, stride: number): Raw {
  if (stride <= 1) return raw;
  const nx = Math.ceil(raw.nx / stride);
  const ny = Math.ceil(raw.ny / stride);
  const data = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const src = j * stride * raw.nx;
    const dst = j * nx;
    for (let i = 0; i < nx; i++) data[dst + i] = raw.data[src + i * stride];
  }
  return { data, nx, ny };
}

/**
 * Prolonge les valeurs valides sur les cellules voisines sans donnée (moyenne
 * des voisins valides), `passes` fois. Sert à amener le champ des modèles de
 * vagues jusqu'au trait de côte réel, que le masque de la carte découpe ensuite.
 */
function dilate(arrays: Float32Array[], nx: number, ny: number, passes: number, wrap: boolean): void {
  if (passes <= 0) return;
  const ref = arrays[0];
  const n = nx * ny;
  let frontier: number[] = [];
  for (let k = 0; k < n; k++) {
    if (ref[k] !== NODATA) continue;
    const i = k % nx;
    const j = (k - i) / nx;
    if (hasValidNeighbour(ref, i, j, nx, ny, wrap)) frontier.push(k);
  }
  const sums = arrays.map(() => 0);
  for (let pass = 0; pass < passes && frontier.length > 0; pass++) {
    const filled = new Float32Array(frontier.length * arrays.length);
    for (let f = 0; f < frontier.length; f++) {
      const k = frontier[f];
      const i = k % nx;
      const j = (k - i) / nx;
      let count = 0;
      sums.fill(0);
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= ny) continue;
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          let ii = i + di;
          if (ii < 0 || ii >= nx) {
            if (!wrap) continue;
            ii = (ii + nx) % nx;
          }
          const kk = jj * nx + ii;
          if (ref[kk] === NODATA) continue;
          count++;
          for (let a = 0; a < arrays.length; a++) sums[a] += arrays[a][kk];
        }
      }
      for (let a = 0; a < arrays.length; a++) filled[f * arrays.length + a] = count > 0 ? sums[a] / count : NODATA;
    }
    const next = new Set<number>();
    for (let f = 0; f < frontier.length; f++) {
      const k = frontier[f];
      for (let a = 0; a < arrays.length; a++) arrays[a][k] = filled[f * arrays.length + a];
    }
    if (pass + 1 < passes) {
      for (const k of frontier) {
        const i = k % nx;
        const j = (k - i) / nx;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= ny) continue;
          for (let di = -1; di <= 1; di++) {
            let ii = i + di;
            if (ii < 0 || ii >= nx) {
              if (!wrap) continue;
              ii = (ii + nx) % nx;
            }
            const kk = jj * nx + ii;
            if (ref[kk] === NODATA) next.add(kk);
          }
        }
      }
    }
    frontier = [...next];
  }
}

function hasValidNeighbour(ref: Float32Array, i: number, j: number, nx: number, ny: number, wrap: boolean): boolean {
  for (let dj = -1; dj <= 1; dj++) {
    const jj = j + dj;
    if (jj < 0 || jj >= ny) continue;
    for (let di = -1; di <= 1; di++) {
      let ii = i + di;
      if (ii < 0 || ii >= nx) {
        if (!wrap) continue;
        ii = (ii + nx) % nx;
      }
      if (ref[jj * nx + ii] !== NODATA) return true;
    }
  }
  return false;
}

const DEG = Math.PI / 180;

async function run(job: FieldJob, signal: AbortSignal): Promise<{ nx: number; ny: number; arrays: Float32Array[] }> {
  if (job.op === 'scalar') {
    const [raw] = await readVariables(job.url, [job.variable], job.win, signal);
    const { data, nx, ny } = decimate(raw, job.win.stride);
    const scale = job.scale;
    for (let k = 0; k < data.length; k++) {
      const x = data[k];
      data[k] = x !== x ? NODATA : x * scale;
    }
    dilate([data], nx, ny, job.dilate, job.win.wrap);
    return { nx, ny, arrays: [data] };
  }

  if (job.op === 'speed') {
    const [rawU, rawV] = await readVariables(job.url, [job.u, job.v], job.win, signal);
    const U = decimate(rawU, job.win.stride);
    const V = decimate(rawV, job.win.stride);
    const { nx, ny } = U;
    const u = U.data;
    const v = V.data;
    const speed = new Float32Array(u.length);
    for (let k = 0; k < u.length; k++) {
      const a = u[k];
      const b = v[k];
      if (a !== a || b !== b) {
        speed[k] = u[k] = v[k] = NODATA;
      } else {
        speed[k] = Math.hypot(a, b);
      }
    }
    dilate([speed, u, v], nx, ny, job.dilate, job.win.wrap);
    return { nx, ny, arrays: [speed, u, v] };
  }

  // Direction (degrés) -> vecteur unitaire dans le sens du déplacement.
  const [raw] = await readVariables(job.url, [job.variable], job.win, signal);
  const { data, nx, ny } = decimate(raw, job.win.stride);
  const u = new Float32Array(data.length);
  const v = new Float32Array(data.length);
  const sign = job.towards ? 1 : -1;
  for (let k = 0; k < data.length; k++) {
    const d = data[k];
    if (d !== d) {
      u[k] = v[k] = NODATA;
    } else {
      u[k] = sign * Math.sin(d * DEG);
      v[k] = sign * Math.cos(d * DEG);
    }
  }
  dilate([u, v], nx, ny, job.dilate, job.win.wrap);
  return { nx, ny, arrays: [u, v] };
}

self.onmessage = (event: MessageEvent<WorkerIn>) => {
  const msg = event.data;
  if (msg.type === 'abort') {
    controllers.get(msg.id)?.abort();
    return;
  }
  const { job } = msg;
  const controller = new AbortController();
  controllers.set(job.id, controller);
  run(job, controller.signal)
    .then(({ nx, ny, arrays }) => {
      const out: WorkerOut = { id: job.id, ok: true, nx, ny, arrays };
      (self as DedicatedWorkerGlobalScope).postMessage(
        out,
        arrays.map((a) => a.buffer as ArrayBuffer),
      );
    })
    .catch((err: unknown) => {
      const out: WorkerOut = {
        id: job.id,
        ok: false,
        aborted: controller.signal.aborted,
        error: err instanceof Error ? err.message : String(err),
      };
      (self as DedicatedWorkerGlobalScope).postMessage(out);
    })
    .finally(() => controllers.delete(job.id));
};
