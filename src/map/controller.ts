/**
 * Fait le lien entre l'état de l'app (couche, modèle, heure) et la couche WebGL :
 * résout les lectures à faire, charge les échéances utiles, anime la lecture.
 *
 * Il est créé dès que la carte est montée, avant son fond : les grilles de la vue de départ sont lues
 * pendant que le style, les tuiles et les polices se chargent, au lieu de n'être demandées qu'après.
 */
import type { Map as MlMap } from 'maplibre-gl';
import { DOMAINS, LAYER_BY_ID, resolvePlan, type GridSpec, type LayerPlan } from '../data/catalog';
import type { ReadWindow } from '../data/field-worker';
import { chooseWindow, frameCache, frameKey, windowCovers, type FrameRequest, type ViewBounds } from '../data/fields';
import { getRunMeta, type RunMeta } from '../data/om';
import { getPalette } from '../data/palettes';
import { bracket, HOUR, nearestIndex } from '../lib/time';
import { effectiveModel, useStore, type FieldStatus } from '../state/store';
import type { FieldLayer } from './FieldLayer';

/** Vitesse de lecture : heures de prévision par seconde réelle. */
const PLAY_HOURS_PER_SECOND = 5;
/** Délai avant de retenter un préchargement qui a échoué. */
const PREFETCH_RETRY_MS = 10_000;

export function viewBounds(map: MlMap): ViewBounds {
  const b = map.getBounds();
  const south = Math.max(-85, b.getSouth());
  const north = Math.min(85, b.getNorth());
  const span = b.getEast() - b.getWest();
  if (span >= 360) return { west: -180, east: 180, south, north };
  const west = ((((b.getWest() + 180) % 360) + 360) % 360) - 180;
  return { west, east: west + span, south, north };
}

function intersects(g: GridSpec, view: ViewBounds): boolean {
  const gridNorth = g.latMin + g.ny * g.dy;
  if (view.north < g.latMin || view.south > gridNorth) return false;
  if (g.nx * g.dx >= 359) return true;
  const gridEast = g.lonMin + g.nx * g.dx;
  // La vue peut être exprimée au-delà de 180° quand elle franchit l'antiméridien.
  for (const shift of [0, -360]) {
    if (view.west + shift <= gridEast && view.east + shift >= g.lonMin) return true;
  }
  return false;
}

export class FieldController {
  private plan: LayerPlan | null = null;
  private metas: Record<string, RunMeta> | null = null;
  private windows: Record<string, ReadWindow> = {};
  private generation = 0;
  private raf = 0;
  private lastTick = 0;
  private refreshTimer = 0;
  /** Préchargements en échec récents (clé -> date), pour ne pas les relancer en boucle. */
  private prefetchFailed = new Map<string, number>();
  /** Échéance que la lecture attend pour avancer. */
  private awaited: string | null = null;
  /**
   * L'état du champ, tel que le contrôleur le connaît. Le contrôleur lit ses grilles dès que la carte est
   * montée, mais tant que le fond de carte n'est pas dessiné (`markShown`), rien n'en sort : ni l'état vers
   * le store (« prêt » veut toujours dire que le champ se voit, et l'écran de démarrage ne s'efface pas
   * plus tôt qu'avant), ni les échéances vers la couche (sans océan pour lui servir de masque, elle
   * n'aurait rien à montrer, et son animation prendrait au fond de carte le temps de se dessiner).
   */
  private status: FieldStatus = 'loading';
  private statusError: string | null = null;
  private shown = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly map: MlMap,
    private readonly layer: FieldLayer,
    private dark: boolean,
  ) {
    this.unsubscribe = useStore.subscribe((s, p) => {
      if (s.layer !== p.layer || s.models !== p.models) void this.applyPlan(false);
      else if (s.time !== p.time) this.update();
      if (s.playing && !p.playing) this.startLoop();
      if (s.selection !== p.selection) this.publishReadout();
    });
    map.on('moveend', this.update);
    // Un nouveau run peut arriver pendant la session.
    this.refreshTimer = window.setInterval(() => void this.applyPlan(true), 15 * 60_000);
    void this.applyPlan(false);
  }

  destroy(): void {
    this.generation++;
    this.unsubscribe();
    this.map.off('moveend', this.update);
    cancelAnimationFrame(this.raf);
    clearInterval(this.refreshTimer);
  }

  /**
   * Le fond de carte est dessiné (événement `load` de MapLibre) : les échéances déjà lues passent à la
   * couche, et l'état du champ se publie désormais.
   */
  markShown(): void {
    if (this.shown) return;
    this.shown = true;
    this.update();
    const store = useStore.getState();
    if (store.status !== this.status || store.error !== this.statusError) store.setStatus(this.status, this.statusError);
  }

  private setStatus(status: FieldStatus, error: string | null = null): void {
    this.status = status;
    this.statusError = error;
    if (this.shown) useStore.getState().setStatus(status, error);
  }

  setDark(dark: boolean): void {
    if (dark === this.dark) return;
    this.dark = dark;
    if (this.plan) this.layer.setPalette(getPalette(this.plan.layer.palette, dark));
  }

  private async applyPlan(refreshOnly: boolean): Promise<void> {
    const store = useStore.getState();
    const layerDef = LAYER_BY_ID[store.layer];
    const model = effectiveModel(store.layer, store.models);
    const plan = resolvePlan(layerDef, model);
    if (!plan) return;
    const samePlan = this.plan?.key === plan.key;
    if (refreshOnly && !samePlan) return;

    const gen = ++this.generation;
    if (!samePlan) {
      this.plan = plan;
      this.metas = null;
      this.windows = {};
      this.prefetchFailed.clear();
      this.layer.setFrames(null, null, 0);
      this.layer.setPalette(getPalette(layerDef.palette, this.dark));
      this.layer.setStyle({
        opacityWater: layerDef.opacity.water,
        opacityLand: layerDef.opacity.land,
        particles: layerDef.particles,
      });
      this.setStatus('loading');
    }

    try {
      const domains = [...new Set([plan.scalar.domain, ...(plan.vector ? [plan.vector.domain] : [])])];
      const list = await Promise.all(domains.map(getRunMeta));
      if (gen !== this.generation) return;
      const previousRef = this.metas?.[plan.scalar.domain]?.referenceTime;
      this.metas = Object.fromEntries(list.map((m) => [m.domain, m]));
      const main = this.metas[plan.scalar.domain];
      const state = useStore.getState();
      if (!samePlan || previousRef !== main.referenceTime || !state.timeline) {
        state.setTimeline({ times: main.validTimes, ref: main.referenceTime, modelId: model.id });
      }
      const times = main.validTimes;
      const last = times[times.length - 1];
      const inRange = state.time >= times[0] && state.time <= last;
      // Hors de la portée du modèle : au-delà de sa fin, sa dernière échéance (un jour lointain choisi
      // dans le panneau reste au plus près) ; avant son début, maintenant.
      const target = times[nearestIndex(times, inRange || state.time > last ? state.time : Date.now())];
      if (!state.playing && target !== state.time) state.setTime(target);
      this.update();
    } catch (err) {
      if (gen !== this.generation) return;
      // Un rafraîchissement manqué ne remet pas en cause ce qui est affiché : on réessaiera.
      if (refreshOnly && this.metas) return;
      this.setStatus('error', err instanceof Error ? err.message : String(err));
    }
  }

  private request(index: number): FrameRequest {
    return { plan: this.plan!, metas: this.metas!, index, windows: this.windows };
  }

  private readonly update = (): void => {
    const { plan, metas } = this;
    if (!plan || !metas) return;
    const store = useStore.getState();
    const times = metas[plan.scalar.domain].validTimes;

    const view = viewBounds(this.map);
    for (const domain of Object.keys(metas)) {
      const grid = DOMAINS[domain];
      const current = this.windows[domain];
      if (!current || !windowCovers(grid, current, view)) this.windows[domain] = chooseWindow(grid, view);
    }
    const covered = intersects(DOMAINS[plan.scalar.domain], view);
    if (covered !== store.covered) store.setCovered(covered);

    const { index, mix } = bracket(times, store.time);
    const blend = mix > 0.002 && index + 1 < times.length;
    const reqA = this.request(index);
    const keyA = frameKey(reqA);
    const reqB = blend ? this.request(index + 1) : null;
    const keyB = reqB ? frameKey(reqB) : null;

    // On prépare les échéances suivantes pour que le pas suivant soit immédiat.
    const ahead: FrameRequest[] = [];
    const count = store.playing ? 3 : 1;
    for (let k = 1; k <= count; k++) {
      const i = index + (blend ? 1 : 0) + k;
      if (i < times.length) ahead.push(this.request(i));
    }
    const keep = new Set([keyA, ...(keyB ? [keyB] : []), ...ahead.map(frameKey)]);
    frameCache.cancelExcept(keep);

    const gen = this.generation;
    const again = () => {
      if (gen === this.generation) this.update();
    };
    const failed = (err: unknown) => {
      if (gen !== this.generation || (err as Error)?.name === 'AbortError') return;
      this.setStatus('error', 'Données indisponibles pour cette échéance.');
    };

    const a = frameCache.peek(keyA);
    const b = keyB ? frameCache.peek(keyB) : null;
    if (!a) frameCache.load(reqA).then(again, failed);
    if (reqB && !b) frameCache.load(reqB).then(again, failed);
    for (const req of ahead) {
      const key = frameKey(req);
      if (Date.now() - (this.prefetchFailed.get(key) ?? 0) < PREFETCH_RETRY_MS) continue;
      frameCache.load(req).catch((err: unknown) => {
        if ((err as Error)?.name !== 'AbortError') this.prefetchFailed.set(key, Date.now());
      });
    }

    if (a) {
      if (this.shown) this.layer.setFrames(a, b, b ? mix : 0);
      if (this.status !== 'ready') this.setStatus('ready');
    } else if (this.status === 'ready') {
      this.setStatus('loading');
    }
    this.publishReadout();
  };

  private publishReadout(): void {
    const store = useStore.getState();
    const sel = store.selection;
    const sample = sel && sel.kind !== 'webcam' ? this.layer.sample(sel.lon, sel.lat) : null;
    const prev = store.readout;
    if (!sample) {
      if (prev) store.setReadout(null);
      return;
    }
    if (!prev || Math.abs(prev.value - sample.value) > 1e-3 || prev.direction !== sample.direction) {
      store.setReadout(sample);
    }
  }

  private startLoop(): void {
    cancelAnimationFrame(this.raf);
    this.lastTick = 0;
    const store = useStore.getState();
    const times = this.plan && this.metas ? this.metas[this.plan.scalar.domain].validTimes : null;
    // Relancée en bout de course, la lecture repart du début.
    if (times && store.time >= times[times.length - 1]) store.setTime(times[0]);
    this.raf = requestAnimationFrame(this.tick);
  }

  /**
   * Demande l'échéance que la lecture attend. Un préchargement a pu échouer ou
   * être annulé : sans cette demande, la lecture attendrait indéfiniment. Si
   * l'échéance reste indisponible, la lecture s'arrête et le dit.
   */
  private awaitFrame(req: FrameRequest): void {
    const key = frameKey(req);
    if (this.awaited === key) return;
    this.awaited = key;
    const gen = this.generation;
    const done = () => {
      if (this.awaited === key) this.awaited = null;
    };
    frameCache.load(req).then(done, (err: unknown) => {
      done();
      if (gen !== this.generation || (err as Error)?.name === 'AbortError') return;
      useStore.getState().setPlaying(false);
      this.setStatus('error', 'Données indisponibles pour cette échéance.');
    });
  }

  private readonly tick = (now: number): void => {
    const store = useStore.getState();
    if (!store.playing) return;
    const dt = this.lastTick ? Math.min(100, now - this.lastTick) : 0;
    this.lastTick = now;
    const { plan, metas } = this;
    if (plan && metas && dt > 0) {
      const times = metas[plan.scalar.domain].validTimes;
      // La lecture s'arrête au dernier pas du modèle, ou à la fin des jours de la version gratuite.
      const end = Math.min(times[times.length - 1], store.timeLimit ?? Infinity);
      const next = Math.min(end, store.time + (dt / 1000) * PLAY_HOURS_PER_SECOND * HOUR);
      const { index, mix } = bracket(times, next);
      const reqA = this.request(index);
      const reqB = mix > 0.002 && index + 1 < times.length ? this.request(index + 1) : null;
      const missing = frameCache.peek(frameKey(reqA)) === null ? reqA : reqB && frameCache.peek(frameKey(reqB)) === null ? reqB : null;
      // Tant que l'échéance suivante n'est pas chargée, on attend sans avancer.
      if (missing) this.awaitFrame(missing);
      else store.setTime(next);
      if (next >= end) store.setPlaying(false);
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
