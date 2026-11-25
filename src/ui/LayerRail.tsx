import { LAYERS, type LayerDef } from '../data/catalog';
import { useStore } from '../state/store';
import { radioKeyDown } from './common';

const GROUPS: { id: LayerDef['group']; label: string }[] = [
  { id: 'sea', label: 'Mer' },
  { id: 'air', label: 'Air' },
];

/** Choix de la couche affichée : liste verticale sur grand écran, ruban défilant sur mobile. */
export function LayerRail() {
  const layer = useStore((s) => s.layer);
  const setLayer = useStore((s) => s.setLayer);
  return (
    <nav className="layers" aria-label="Couche affichée" onKeyDown={radioKeyDown}>
      {GROUPS.map((group) => (
        <div className="layers-group" key={group.id} role="radiogroup" aria-label={group.label}>
          <span className="layers-label" aria-hidden="true">
            {group.label}
          </span>
          {LAYERS.filter((l) => l.group === group.id).map((l) => (
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={l.id === layer}
              tabIndex={l.id === layer ? 0 : -1}
              className="layer"
              title={l.hint}
              onClick={() => setLayer(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
