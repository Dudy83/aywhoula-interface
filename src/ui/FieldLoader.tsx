import { useEffect, useRef, useState } from 'react';
import { LAYER_BY_ID } from '../data/catalog';
import { useStore } from '../state/store';
import { AnimatedMark } from './common';

/** Une attente plus courte ne montre rien : la plupart des pas de la ligne de temps sont déjà en mémoire. */
const SHOW_AFTER_MS = 150;
/** Une fois montrée, la pastille reste au moins ce temps : pas d'éclair sur un chargement bref. */
const SHOW_AT_LEAST_MS = 600;

/**
 * Vrai quand `active` dure depuis un moment, et encore un instant après : un
 * témoin de chargement qui ne clignote ni à l'apparition ni à la disparition.
 */
function useSteady(active: boolean): boolean {
  const [shown, setShown] = useState(false);
  const since = useRef(0);
  useEffect(() => {
    if (active === shown) return;
    const wait = active ? SHOW_AFTER_MS : Math.max(0, since.current + SHOW_AT_LEAST_MS - performance.now());
    const timer = window.setTimeout(() => {
      if (active) since.current = performance.now();
      setShown(active);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [active, shown]);
  return shown;
}

/**
 * Témoin de chargement des données de la carte : la marque animée et le nom de la
 * couche attendue, au milieu de la carte. Il remplace l'écran de démarrage une fois
 * l'app ouverte : changement de couche, de modèle, échéance pas encore lue.
 */
export function FieldLoader() {
  const loading = useStore((s) => s.status === 'loading');
  const layer = useStore((s) => LAYER_BY_ID[s.layer].label);
  const shown = useSteady(loading);
  return (
    <div className="field-loader" data-on={shown} role="status">
      <AnimatedMark size={28} />
      {/* Vide quand elle est cachée : un lecteur d'écran n'annonce que le chargement en cours. */}
      {shown && (
        <span>
          Chargement <span className="field-loader-what">· {layer}</span>
        </span>
      )}
    </div>
  );
}
