import { MODEL_BY_ID } from '../data/catalog';
import { formatRun } from '../lib/time';
import { useStore } from '../state/store';

/** Durée du fondu de sortie : la même que la transition de #splash dans index.html. */
const FADE_MS = 360;
/** Au-delà, l'écran s'efface quoi qu'il arrive : on ne reste jamais bloqué derrière lui. */
const MAX_MS = 12_000;

/**
 * Tient l'écran de démarrage posé dans index.html. Il couvre la carte tant qu'elle
 * est vide : on y écrit le run dès qu'il est connu, puis on l'efface quand la carte
 * a ses premières données, ou une erreur à montrer. Renvoie de quoi tout arrêter.
 */
export function watchSplash(): () => void {
  const splash = document.getElementById('splash');
  if (!splash) return () => undefined;
  const status = splash.querySelector('.splash-status');
  let announced: number | null = null;

  const stop = () => {
    unsubscribe();
    window.clearTimeout(timer);
  };
  const hide = () => {
    stop();
    splash.dataset.done = '';
    window.setTimeout(() => splash.remove(), FADE_MS + 60);
  };
  const check = () => {
    const { status: fieldStatus, timeline } = useStore.getState();
    if (fieldStatus !== 'loading') {
      hide();
      return;
    }
    if (status && timeline && timeline.ref !== announced) {
      announced = timeline.ref;
      // Un élément neuf à chaque fois : son animation d'entrée rejoue.
      const line = document.createElement('span');
      line.textContent = `${MODEL_BY_ID[timeline.modelId]?.label ?? 'Modèle'} · run ${formatRun(timeline.ref)}`;
      status.replaceChildren(line);
    }
  };

  const unsubscribe = useStore.subscribe(check);
  const timer = window.setTimeout(hide, MAX_MS);
  check();
  return stop;
}
