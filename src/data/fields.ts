/**
 * Chargement des champs (grilles) pour la carte : choix de la fenêtre à lire,
 * dialogue avec les workers, cache des échéances déjà décodées, et
 * échantillonnage ponctuel (valeur sous le curseur, particules).
 */
import { DOMAINS, type GridSpec, type LayerPlan, type ReadSpec } from './catalog';
import type { FieldJob, ReadWindow, WorkerIn, WorkerOut } from './field-worker';
import { omFileUrl, type RunMeta } from './om';

export const NODATA = -9999;
const VALID = -9000;

/** Grille régulière lat/lon effectivement en mémoire (fenêtre + sous-échantillonnage). */
export interface Raster {
  nx: number;
  ny: number;
  lonMin: number;
  latMin: number;
  dx: number;
  dy: number;
  /** Nombre de colonnes pour un tour complet du globe ; 0 si la grille ne boucle pas. */
  period: number;
}

export interface ScalarField extends Raster {
  data: Float32Array;
}

export interface VectorField extends Raster {
  u: Float32Array;
  v: Float32Array;
}

export interface Frame {
  key: string;
  time: number;
  scalar: ScalarField;
  vector: VectorField | null;
  bytes: number;
}

export interface ViewBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Au-delà de ce nombre de cellules, on lit une fenêtre ou on sous-échantillonne. */
const MAX_CELLS = 1_500_000;
const MAX_DIM = 2048;
const ALIGN = 64;

const isGlobal = (g: GridSpec) => g.nx * g.dx >= 360 - g.dx * 1.5;

/**
 * Fenêtre de lecture pour une vue donnée. Les petites grilles sont lues en
 * entier ; les grandes sont réduites à la vue (avec marge), puis
 * sous-échantillonnées si la fenêtre reste trop lourde.
 */
export function chooseWindow(g: GridSpec, view: ViewBounds): ReadWindow {
  let x0 = 0;
  let x1 = g.nx;
  let y0 = 0;
  let y1 = g.ny;
  const global = isGlobal(g);

  if (g.nx * g.ny > MAX_CELLS) {
    const lonSpan = view.east - view.west;
    const latSpan = view.north - view.south;
    const mLon = lonSpan * 0.6;
    const mLat = latSpan * 0.6;
    const south = view.south - mLat;
    const north = view.north + mLat;
    y0 = Math.max(0, Math.floor((south - g.latMin) / g.dy / ALIGN) * ALIGN);
    y1 = Math.min(g.ny, Math.ceil((north - g.latMin) / g.dy / ALIGN) * ALIGN + 1);
    const west = view.west - mLon;
    const east = view.east + mLon;
    const gridEast = g.lonMin + g.nx * g.dx;
    // Vue qui franchit l'antiméridien ou très large : on garde toute la largeur.
    const crosses = global && (west < g.lonMin || east > gridEast || east - west > 300);
    if (!crosses) {
      x0 = Math.max(0, Math.floor((west - g.lonMin) / g.dx / ALIGN) * ALIGN);
      x1 = Math.min(g.nx, Math.ceil((east - g.lonMin) / g.dx / ALIGN) * ALIGN + 1);
    }
    if (x1 <= x0 || y1 <= y0) {
      // Vue hors de la grille : fenêtre minimale, le rendu n'affichera rien.
      x0 = 0;
      x1 = Math.min(g.nx, ALIGN);
      y0 = 0;
      y1 = Math.min(g.ny, ALIGN);
    }
  }

  const w = x1 - x0;
  const h = y1 - y0;
  let stride = Math.max(1, Math.ceil(Math.sqrt((w * h) / MAX_CELLS)));
  stride = Math.max(stride, Math.ceil(w / MAX_DIM), Math.ceil(h / MAX_DIM));
  return { x0, x1, y0, y1, stride, wrap: global && x0 === 0 && x1 === g.nx };
}

/** La fenêtre courante suffit-elle encore pour cette vue ? */
export function windowCovers(g: GridSpec, win: ReadWindow, view: ViewBounds): boolean {
  const ideal = chooseWindow(g, view);
  if (ideal.stride < win.stride) return false;
  const full = win.x0 === 0 && win.x1 === g.nx && win.y0 === 0 && win.y1 === g.ny;
  if (full) return true;
  const inside = (lo: number, hi: number, vLo: number, vHi: number, min: number, max: number) =>
    (vLo >= lo || lo <= min) && (vHi <= hi || hi >= max);
  const gridEast = g.lonMin + g.nx * g.dx;
  const gridNorth = g.latMin + g.ny * g.dy;
  const lonLo = g.lonMin + win.x0 * g.dx;
  const lonHi = g.lonMin + win.x1 * g.dx;
  // Une grille mondiale boucle : le bord de la grille n'y est pas une limite, la
  // vue qui le dépasse doit être relue sur toute la largeur.
  const lonOk =
    (win.x0 === 0 && win.x1 === g.nx) ||
    (isGlobal(g)
      ? view.west >= lonLo && view.east <= lonHi
      : inside(lonLo, lonHi, view.west, view.east, g.lonMin, gridEast));
  const latOk = inside(g.latMin + win.y0 * g.dy, g.latMin + win.y1 * g.dy, view.south, view.north, g.latMin, gridNorth);
  return lonOk && latOk;
}

const windowKey = (w: ReadWindow) => `${w.x0}:${w.x1}:${w.y0}:${w.y1}:${w.stride}`;

function rasterFor(g: GridSpec, win: ReadWindow, nx: number, ny: number): Raster {
  const dx = g.dx * win.stride;
  return {
    nx,
    ny,
    lonMin: g.lonMin + win.x0 * g.dx,
    latMin: g.latMin + win.y0 * g.dy,
    dx,
    dy: g.dy * win.stride,
    period: win.wrap ? Math.round(360 / dx) : 0,
  };
}

/* ------------------------------------------------------------------ workers */

type JobInput = FieldJob extends infer J ? (J extends unknown ? Omit<J, 'id'> : never) : never;

interface Pending {
  resolve: (r: { nx: number; ny: number; arrays: Float32Array[] }) => void;
  reject: (e: Error) => void;
}

class WorkerPool {
  private workers: Worker[] = [];
  private pending = new Map<number, Pending & { worker: Worker }>();
  private nextId = 1;
  private cursor = 0;

  private spawn(): Worker {
    const worker = new Worker(new URL('./field-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerOut>) => {
      const msg = event.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve({ nx: msg.nx, ny: msg.ny, arrays: msg.arrays });
      else p.reject(msg.aborted ? new DOMException('Lecture annulée', 'AbortError') : new Error(msg.error));
    };
    // Worker qui ne se charge pas ou qui plante : on le retire et on fait échouer
    // ses lectures, sinon elles resteraient en attente pour toujours.
    const fail = () => {
      this.workers = this.workers.filter((w) => w !== worker);
      worker.terminate();
      for (const [id, p] of this.pending) {
        if (p.worker !== worker) continue;
        this.pending.delete(id);
        p.reject(new Error('La lecture des données a été interrompue.'));
      }
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    return worker;
  }

  run(job: JobInput, signal?: AbortSignal): Promise<{ nx: number; ny: number; arrays: Float32Array[] }> {
    if (this.workers.length < 2) this.workers.push(this.spawn());
    const worker = this.workers[this.cursor++ % this.workers.length];
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, worker });
      const message: WorkerIn = { type: 'job', job: { ...job, id } as FieldJob };
      worker.postMessage(message);
      signal?.addEventListener(
        'abort',
        () => {
          if (this.pending.has(id)) worker.postMessage({ type: 'abort', id } satisfies WorkerIn);
        },
        { once: true },
      );
    });
  }
}

const pool = new WorkerPool();

/* ------------------------------------------------------------------- frames */

/** Passes de prolongement vers la côte pour les couches masquées sur terre. */
const COAST_DILATE = 3;

async function readSpec(
  spec: ReadSpec,
  meta: RunMeta,
  time: number,
  win: ReadWindow,
  dilate: number,
  stepHours: number,
  signal?: AbortSignal,
) {
  const url = omFileUrl(spec.domain, meta.referenceTime, time);
  const base = { url, win, dilate };
  if (spec.op === 'scalar') {
    return pool.run({ ...base, op: 'scalar', variable: spec.variable, scale: spec.perHour ? 1 / stepHours : 1 }, signal);
  }
  if (spec.op === 'speed') return pool.run({ ...base, op: 'speed', u: spec.u, v: spec.v }, signal);
  return pool.run({ ...base, op: 'dir', variable: spec.variable, towards: spec.towards }, signal);
}

export interface FrameRequest {
  plan: LayerPlan;
  /** Métadonnées du run pour chaque domaine du plan. */
  metas: Record<string, RunMeta>;
  /** Indice de l'échéance dans le domaine de la grandeur colorée. */
  index: number;
  windows: Record<string, ReadWindow>;
}

function nearestTime(times: number[], t: number): number {
  let best = times[0];
  for (const x of times) if (Math.abs(x - t) < Math.abs(best - t)) best = x;
  return best;
}

export function frameKey(req: FrameRequest): string {
  const { plan, metas, index, windows } = req;
  const sMeta = metas[plan.scalar.domain];
  const parts = [plan.key, sMeta.referenceTime, sMeta.validTimes[index], windowKey(windows[plan.scalar.domain])];
  if (plan.vector) parts.push(metas[plan.vector.domain].referenceTime, windowKey(windows[plan.vector.domain]));
  return parts.join('|');
}

async function buildFrame(req: FrameRequest, key: string, signal?: AbortSignal): Promise<Frame> {
  const { plan, metas, index, windows } = req;
  const sDomain = plan.scalar.domain;
  const sMeta = metas[sDomain];
  const times = sMeta.validTimes;
  const time = times[index];
  // Durée du pas : écart à l'échéance précédente (ou suivante pour la première).
  const stepMs = index > 0 ? time - times[index - 1] : times.length > 1 ? times[1] - time : 3_600_000;
  const stepHours = Math.max(1, stepMs / 3_600_000);
  const dilate = plan.layer.opacity.land === 0 ? COAST_DILATE : 0;

  const sWin = windows[sDomain];
  const sPromise = readSpec(plan.scalar, sMeta, time, sWin, dilate, stepHours, signal);

  let vPromise: ReturnType<typeof readSpec> | null = null;
  let vWin: ReadWindow | null = null;
  let vDomain = '';
  if (plan.vector) {
    vDomain = plan.vector.domain;
    const vMeta = metas[vDomain];
    vWin = windows[vDomain];
    vPromise = readSpec(plan.vector, vMeta, nearestTime(vMeta.validTimes, time), vWin, dilate, stepHours, signal);
    // Le vecteur est un plus : s'il manque, on affiche quand même le champ.
    vPromise.catch(() => undefined);
  }

  const s = await sPromise;
  const scalar: ScalarField = { ...rasterFor(DOMAINS[sDomain], sWin, s.nx, s.ny), data: s.arrays[0] };
  let vector: VectorField | null = null;
  if (plan.scalar.op === 'speed' && plan.layer.particles) {
    vector = { ...rasterFor(DOMAINS[sDomain], sWin, s.nx, s.ny), u: s.arrays[1], v: s.arrays[2] };
  } else if (vPromise && vWin) {
    try {
      const v = await vPromise;
      const [u, vv] = plan.vector!.op === 'speed' ? [v.arrays[1], v.arrays[2]] : [v.arrays[0], v.arrays[1]];
      vector = { ...rasterFor(DOMAINS[vDomain], vWin, v.nx, v.ny), u, v: vv };
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      vector = null;
    }
  }
  const bytes = scalar.data.byteLength + (vector ? vector.u.byteLength + vector.v.byteLength : 0);
  return { key, time, scalar, vector, bytes };
}

interface CacheEntry {
  promise: Promise<Frame>;
  frame: Frame | null;
  controller: AbortController;
  used: number;
}

const lowMemory = ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
const CACHE_BYTES = (lowMemory ? 120 : 320) * 1024 * 1024;

class FrameCache {
  private entries = new Map<string, CacheEntry>();
  private clock = 0;

  /** Échéance déjà décodée, si elle est en cache. */
  peek(key: string): Frame | null {
    const e = this.entries.get(key);
    if (!e?.frame) return null;
    e.used = ++this.clock;
    return e.frame;
  }

  load(req: FrameRequest): Promise<Frame> {
    const key = frameKey(req);
    let e = this.entries.get(key);
    if (!e) {
      const controller = new AbortController();
      const entry: CacheEntry = {
        controller,
        frame: null,
        used: 0,
        promise: buildFrame(req, key, controller.signal).then(
          (frame) => {
            entry.frame = frame;
            this.prune();
            return frame;
          },
          (err) => {
            if (this.entries.get(key) === entry) this.entries.delete(key);
            throw err;
          },
        ),
      };
      entry.promise.catch(() => undefined);
      e = entry;
      this.entries.set(key, e);
    }
    e.used = ++this.clock;
    return e.promise;
  }

  /** Annule les lectures en cours qui ne font pas partie des clés à garder. */
  cancelExcept(keep: Set<string>): void {
    for (const [key, e] of this.entries) {
      if (!e.frame && !keep.has(key)) {
        e.controller.abort();
        this.entries.delete(key);
      }
    }
  }

  private prune(): void {
    let total = 0;
    for (const e of this.entries.values()) total += e.frame?.bytes ?? 0;
    if (total <= CACHE_BYTES) return;
    const loaded = [...this.entries.entries()].filter(([, e]) => e.frame).sort((a, b) => a[1].used - b[1].used);
    for (const [key, e] of loaded) {
      if (total <= CACHE_BYTES * 0.8) break;
      total -= e.frame!.bytes;
      this.entries.delete(key);
    }
  }
}

export const frameCache = new FrameCache();

/* ----------------------------------------------------------- échantillonnage */

function gridX(r: Raster, lon: number): number {
  let fx = (lon - r.lonMin) / r.dx;
  if (r.period > 0) {
    fx %= r.period;
    if (fx < 0) fx += r.period;
  }
  return fx;
}

/** Interpolation bilinéaire qui ignore les cellules sans donnée. Renvoie NaN hors données. */
export function sampleScalar(f: ScalarField, lon: number, lat: number): number {
  const fx = gridX(f, lon);
  const fy = (lat - f.latMin) / f.dy;
  if (fy < -0.5 || fy > f.ny - 0.5) return NaN;
  if (f.period === 0 && (fx < -0.5 || fx > f.nx - 0.5)) return NaN;
  const x0f = Math.floor(fx);
  const y0f = Math.floor(fy);
  const tx = fx - x0f;
  const ty = fy - y0f;
  let x0 = x0f;
  let x1 = x0f + 1;
  if (f.period > 0) {
    x0 %= f.period;
    x1 %= f.period;
    if (x0 >= f.nx) x0 = f.nx - 1;
    if (x1 >= f.nx) x1 = 0;
  } else {
    x0 = Math.min(f.nx - 1, Math.max(0, x0));
    x1 = Math.min(f.nx - 1, Math.max(0, x1));
  }
  const y0 = Math.min(f.ny - 1, Math.max(0, y0f));
  const y1 = Math.min(f.ny - 1, Math.max(0, y0f + 1));
  const d = f.data;
  const v00 = d[y0 * f.nx + x0];
  const v10 = d[y0 * f.nx + x1];
  const v01 = d[y1 * f.nx + x0];
  const v11 = d[y1 * f.nx + x1];
  let sum = 0;
  let w = 0;
  if (v00 > VALID) {
    const k = (1 - tx) * (1 - ty);
    sum += v00 * k;
    w += k;
  }
  if (v10 > VALID) {
    const k = tx * (1 - ty);
    sum += v10 * k;
    w += k;
  }
  if (v01 > VALID) {
    const k = (1 - tx) * ty;
    sum += v01 * k;
    w += k;
  }
  if (v11 > VALID) {
    const k = tx * ty;
    sum += v11 * k;
    w += k;
  }
  return w > 0.001 ? sum / w : NaN;
}

/** Échantillonne (u, v) dans `out`. Renvoie false hors données. */
export function sampleVector(f: VectorField, lon: number, lat: number, out: Float32Array | number[]): boolean {
  const fx = gridX(f, lon);
  const fy = (lat - f.latMin) / f.dy;
  if (fy < -0.5 || fy > f.ny - 0.5) return false;
  if (f.period === 0 && (fx < -0.5 || fx > f.nx - 0.5)) return false;
  const x0f = Math.floor(fx);
  const y0f = Math.floor(fy);
  const tx = fx - x0f;
  const ty = fy - y0f;
  let x0 = x0f;
  let x1 = x0f + 1;
  if (f.period > 0) {
    x0 %= f.period;
    x1 %= f.period;
    if (x0 >= f.nx) x0 = f.nx - 1;
    if (x1 >= f.nx) x1 = 0;
  } else {
    x0 = Math.min(f.nx - 1, Math.max(0, x0));
    x1 = Math.min(f.nx - 1, Math.max(0, x1));
  }
  const y0 = Math.min(f.ny - 1, Math.max(0, y0f));
  const y1 = Math.min(f.ny - 1, Math.max(0, y0f + 1));
  const i00 = y0 * f.nx + x0;
  const i10 = y0 * f.nx + x1;
  const i01 = y1 * f.nx + x0;
  const i11 = y1 * f.nx + x1;
  const u = f.u;
  const v = f.v;
  let su = 0;
  let sv = 0;
  let w = 0;
  if (u[i00] > VALID) {
    const k = (1 - tx) * (1 - ty);
    su += u[i00] * k;
    sv += v[i00] * k;
    w += k;
  }
  if (u[i10] > VALID) {
    const k = tx * (1 - ty);
    su += u[i10] * k;
    sv += v[i10] * k;
    w += k;
  }
  if (u[i01] > VALID) {
    const k = (1 - tx) * ty;
    su += u[i01] * k;
    sv += v[i01] * k;
    w += k;
  }
  if (u[i11] > VALID) {
    const k = tx * ty;
    su += u[i11] * k;
    sv += v[i11] * k;
    w += k;
  }
  if (w < 0.001) return false;
  out[0] = su / w;
  out[1] = sv / w;
  return true;
}
