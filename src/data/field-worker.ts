/// <reference lib="webworker" />
/**
 * Télécharge les blocs de grille que le serveur prépare (`/grilles/…`), hors du fil principal, puis
 * prépare les tableaux pour le rendu : assemblage de la fenêtre, valeur « sans donnée »,
 * prolongement vers la côte.
 */
import { blockUrl } from './om';

export const NODATA = -9999;

/** Points de côté d'un bloc. Au niveau L (un point sur 2^L), il couvre 256 · 2^L cellules de la grille. */
const BLOCK = 256;
/** Blocs téléchargés en même temps par un worker. */
const PARALLEL = 6;

/**
 * Fenêtre de lecture dans la grille (indices, borne haute exclue) et pas de sous-échantillonnage.
 * Le pas vaut 2^L, L étant le niveau de réduction des blocs ; la fenêtre est alignée sur eux : ses
 * bornes sont des multiples de 256 · 2^L, ou le bord de la grille.
 */
export interface ReadWindow {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  stride: number;
  /** La fenêtre fait le tour du globe : le prolongement boucle en longitude. */
  wrap: boolean;
}

/** `field` est l'adresse du champ (une échéance d'un run), donnée par `fieldUrl` de `om.ts`. */
export type FieldJob = { id: number; field: string; win: ReadWindow; dilate: number } & (
  | { op: 'scalar'; variable: string; scale: number }
  | { op: 'speed'; u: string; v: string }
  | { op: 'dir'; variable: string; towards: boolean }
);

export type WorkerIn = { type: 'job'; job: FieldJob } | { type: 'abort'; id: number };

export type WorkerOut =
  | { id: number; ok: true; nx: number; ny: number; arrays: Float32Array[] }
  | { id: number; ok: false; aborted: boolean; error: string };

const controllers = new Map<number, AbortController>();

/* ----------------------------------------------------------- téléchargement */

let active = 0;
const queue: (() => void)[] = [];

/** Au plus `PARALLEL` téléchargements à la fois, dans l'ordre des demandes : l'échéance affichée d'abord. */
async function limited<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  if (active >= PARALLEL) await new Promise<void>((resolve) => queue.push(resolve));
  else active++;
  try {
    // Une lecture annulée pendant son attente ne part pas.
    signal.throwIfAborted();
    return await task();
  } finally {
    // La place passe au suivant sans être rendue : le compte ne redescend que si personne n'attend.
    const next = queue.shift();
    if (next) next();
    else active--;
  }
}

/** « AWG1 », lu comme un entier gros-boutiste. */
const MAGIC = 0x41574731;
const HEADER_BYTES = 16;
/** Le code « pas de donnée » d'un bloc. */
const NO_DATA_CODE = 65535;

/**
 * Relit un bloc et le pose dans le tableau de la fenêtre, à partir de (row0, col0).
 *
 * Format (petit-boutiste) : `AWG1`, largeur et hauteur (uint16), `scale` et `offset` (float32), puis
 * `w × h` codes uint16, ligne par ligne du sud au nord. Chaque ligne est écrite en différences : la
 * somme courante, modulo 65536, redonne les codes. Valeur = code / scale + offset ; le code 65535
 * devient `NODATA`.
 */
function placeBlock(buffer: ArrayBuffer, out: Float32Array, outNx: number, row0: number, col0: number, w: number, h: number): void {
  const view = new DataView(buffer);
  if (buffer.byteLength < HEADER_BYTES || view.getUint32(0) !== MAGIC) throw new Error('Bloc de grille illisible');
  if (view.getUint16(4, true) !== w || view.getUint16(6, true) !== h || buffer.byteLength !== HEADER_BYTES + w * h * 2) {
    throw new Error('Bloc de grille inattendu');
  }
  const scale = view.getFloat32(8, true);
  const offset = view.getFloat32(12, true);
  let at = HEADER_BYTES;
  for (let r = 0; r < h; r++) {
    let code = 0;
    const dst = (row0 + r) * outNx + col0;
    for (let c = 0; c < w; c++) {
      code = (code + view.getUint16(at, true)) & 0xffff;
      at += 2;
      out[dst + c] = code === NO_DATA_CODE ? NODATA : code / scale + offset;
    }
  }
}

interface Raw {
  data: Float32Array;
  nx: number;
  ny: number;
}

/**
 * Télécharge les blocs d'une variable qui couvrent la fenêtre et les assemble dans son tableau,
 * `NODATA` là où il n'y a pas de donnée.
 */
async function readVariable(field: string, variable: string, win: ReadWindow, signal: AbortSignal): Promise<Raw> {
  const level = Math.log2(win.stride);
  // Cellules de la grille que couvre un bloc à ce niveau.
  const span = BLOCK * win.stride;
  if (!Number.isInteger(level) || win.x0 % span !== 0 || win.y0 % span !== 0) throw new Error('Fenêtre de lecture non alignée sur les blocs');
  const nx = Math.ceil((win.x1 - win.x0) / win.stride);
  const ny = Math.ceil((win.y1 - win.y0) / win.stride);
  const bx0 = win.x0 / span;
  const by0 = win.y0 / span;
  const data = new Float32Array(nx * ny);
  const reads: Promise<void>[] = [];
  for (let row0 = 0; row0 < ny; row0 += BLOCK) {
    for (let col0 = 0; col0 < nx; col0 += BLOCK) {
      const url = blockUrl(field, variable, level, by0 + row0 / BLOCK, bx0 + col0 / BLOCK);
      // Un bloc du bord de la fenêtre, donc de la grille, est plus petit.
      const w = Math.min(BLOCK, nx - col0);
      const h = Math.min(BLOCK, ny - row0);
      reads.push(
        limited(signal, async () => {
          const res = await fetch(url, { signal });
          if (!res.ok) throw new Error(`Bloc de grille indisponible (${res.status})`);
          placeBlock(await res.arrayBuffer(), data, nx, row0, col0, w, h);
        }),
      );
    }
  }
  await Promise.all(reads);
  return { data, nx, ny };
}

function readVariables(field: string, names: string[], win: ReadWindow, signal: AbortSignal): Promise<Raw[]> {
  return Promise.all(names.map((name) => readVariable(field, name, win, signal)));
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
    const [{ data, nx, ny }] = await readVariables(job.field, [job.variable], job.win, signal);
    const scale = job.scale;
    if (scale !== 1) {
      for (let k = 0; k < data.length; k++) {
        const x = data[k];
        if (x !== NODATA) data[k] = x * scale;
      }
    }
    dilate([data], nx, ny, job.dilate, job.win.wrap);
    return { nx, ny, arrays: [data] };
  }

  if (job.op === 'speed') {
    const [U, V] = await readVariables(job.field, [job.u, job.v], job.win, signal);
    const { nx, ny } = U;
    const u = U.data;
    const v = V.data;
    const speed = new Float32Array(u.length);
    for (let k = 0; k < u.length; k++) {
      const a = u[k];
      const b = v[k];
      if (a === NODATA || b === NODATA) {
        speed[k] = u[k] = v[k] = NODATA;
      } else {
        speed[k] = Math.hypot(a, b);
      }
    }
    dilate([speed, u, v], nx, ny, job.dilate, job.win.wrap);
    return { nx, ny, arrays: [speed, u, v] };
  }

  // Direction (degrés) -> vecteur unitaire dans le sens du déplacement.
  const [{ data, nx, ny }] = await readVariables(job.field, [job.variable], job.win, signal);
  const u = new Float32Array(data.length);
  const v = new Float32Array(data.length);
  const sign = job.towards ? 1 : -1;
  for (let k = 0; k < data.length; k++) {
    const d = data[k];
    if (d === NODATA) {
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
      // Un bloc a manqué : les autres téléchargements de cette lecture ne servent plus à rien.
      controller.abort();
      (self as DedicatedWorkerGlobalScope).postMessage(out);
    })
    .finally(() => controllers.delete(job.id));
};
