/**
 * Le choix de la couche affichée. Sur ordinateur, une colonne à gauche : les couches de chaque groupe du
 * catalogue, l'une sous l'autre. Sur téléphone, un bouton sous la recherche (l'icône de la couche, son nom, un
 * chevron) qui ouvre la feuille « Couche de la carte » : les deux groupes, chacun en grille de trois tuiles.
 * Toucher une tuile change la couche et referme la feuille ; un toucher sur le voile, un glissé vers le bas ou
 * Échap la referment aussi. Les deux gardent la même sémantique : un groupe de boutons radio par groupe du
 * catalogue, parcouru aux flèches.
 */
import {
  ArrowRightLeft,
  ChevronDown,
  Cloud,
  CloudRain,
  Layers,
  Sailboat,
  Thermometer,
  Timer,
  Waves,
  Wind,
  WindArrowDown,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { LAYER_BY_ID, LAYERS, type LayerDef, type LayerId } from '../data/catalog';
import { useStore } from '../state/store';
import { radioKeyDown, useWide } from './common';

const GROUPS: { id: LayerDef['group']; label: string }[] = [
  { id: 'sea', label: 'Mer' },
  { id: 'air', label: 'Air' },
];

/**
 * L'icône de chaque couche, sur le bouton et les tuiles du téléphone. Ici plutôt que dans le catalogue, que les
 * scripts lisent aussi : une couche ajoutée au catalogue sans icône ne passe pas le typecheck.
 */
const LAYER_ICONS: Record<LayerId, LucideIcon> = {
  waves: Waves,
  swell: Layers,
  period: Timer,
  windwave: Sailboat,
  currents: ArrowRightLeft,
  wind: Wind,
  gusts: WindArrowDown,
  rain: CloudRain,
  clouds: Cloud,
  temp: Thermometer,
};

/** Le temps d'apparition et de fermeture de la feuille (DESIGN.md). */
const SHEET_MS = 240;
/** Le glissé vers le bas qui referme la feuille : le seuil de la poignée du dialog d'un lieu. */
const CLOSE_DRAG = 48;

export function LayerRail() {
  return useWide() ? <LayerColumn /> : <LayerPicker />;
}

/** Sur ordinateur : la colonne des couches, à gauche. */
function LayerColumn() {
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

/** Sur téléphone : le bouton de la couche affichée, et sa feuille. */
function LayerPicker() {
  const layer = useStore((s) => s.layer);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const Icon = LAYER_ICONS[layer];
  const label = LAYER_BY_ID[layer].label;
  // La feuille partie, le focus revient au bouton.
  const closed = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="layer-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Couche : ${label}. Changer de couche`}
        onClick={() => setOpen(true)}
      >
        <span className="layer-button-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
        <span className="layer-button-name">{label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && <LayerSheet onClosed={closed} />}
    </>
  );
}

/**
 * La feuille « Couche de la carte », qui monte du bas sur un voile, au-dessus de la barre du bas et de la feuille
 * d'un lieu. À l'ouverture, le focus va sur la tuile de la couche affichée et y reste ; `onClosed` est appelé à la
 * fin du fondu de fermeture.
 */
function LayerSheet({ onClosed }: { onClosed: () => void }) {
  const layer = useStore((s) => s.layer);
  const setLayer = useStore((s) => s.setLayer);
  const sheet = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [closing, setClosing] = useState(false);
  /** Le contenu dépasse l'écran (téléphone à l'horizontale) : il défile, et seule la poignée se glisse. */
  const [scrolls, setScrolls] = useState(false);
  const drag = useRef<{ id: number; y: number; dy: number; moved: boolean } | null>(null);
  /** Une tuile choisie aux flèches : la couche change, la feuille reste ouverte. */
  const byArrow = useRef(false);
  /** Un glissé vient de finir : le clic qui le suit éventuellement n'est pas un choix. */
  const dragged = useRef(false);

  const close = useCallback(() => setClosing(true), []);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClosed, SHEET_MS);
    return () => window.clearTimeout(timer);
  }, [closing, onClosed]);

  // Le focus sur la couche affichée ; Échap referme, avant le dialog d'un lieu qui se fermerait lui aussi. Tab
  // ne sort pas de la feuille : sa seule étape est la tuile choisie (les flèches parcourent les autres).
  useEffect(() => {
    const el = sheet.current!;
    const current = () => el.querySelector<HTMLElement>('[role="radio"][tabindex="0"]');
    current()?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        current()?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [close]);

  useLayoutEffect(() => {
    const el = sheet.current!;
    const measure = () => setScrolls(el.scrollHeight > el.clientHeight + 1);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const choose = (id: LayerId) => {
    if (dragged.current) return;
    if (id !== layer) setLayer(id);
    if (!byArrow.current) close();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    byArrow.current = true;
    try {
      radioKeyDown(e);
    } finally {
      byArrow.current = false;
    }
  };

  // Le glissé vers le bas : la feuille suit le doigt, puis se referme au-delà du seuil, ou revient.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (closing || e.button !== 0) return;
    if (scrolls && !(e.target as HTMLElement).closest('.layer-sheet-head')) return;
    drag.current = { id: e.pointerId, y: e.clientY, dy: 0, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = sheet.current;
    if (!d || !el || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.abs(dy) < 6) return;
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      el.style.transition = 'none';
    }
    d.dy = Math.max(0, dy);
    el.style.transform = `translateY(${d.dy}px)`;
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = sheet.current;
    drag.current = null;
    if (!d || !el || d.id !== e.pointerId || !d.moved) return;
    dragged.current = true;
    window.setTimeout(() => (dragged.current = false), 400);
    el.style.transition = '';
    if (e.type === 'pointerup' && d.dy > CLOSE_DRAG) {
      // Elle part d'où le doigt l'a laissée.
      el.style.transform = `translateY(${d.dy + 24}px)`;
      close();
    } else {
      el.style.transform = '';
    }
  };

  // Posée sur toute l'appli, comme les fenêtres du compte.
  return createPortal(
    <div className="overlay layer-overlay" data-closing={closing || undefined}>
      <div className="overlay-dim" onClick={close} />
      <div
        ref={sheet}
        className="layer-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-scrolls={scrolls || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="layer-sheet-head">
          <div className="layer-sheet-grip" aria-hidden="true" />
          <h2 id={titleId} className="layer-sheet-title">
            Couche de la carte
          </h2>
        </div>
        <div onKeyDown={onKeyDown}>
          {GROUPS.map((group) => (
            <div key={group.id} className="layer-sheet-group">
              <p id={`${titleId}-${group.id}`} className="layer-sheet-label">
                {group.label}
              </p>
              <div className="layer-tiles" role="radiogroup" aria-labelledby={`${titleId}-${group.id}`}>
                {LAYERS.filter((l) => l.group === group.id).map((l) => {
                  const Icon = LAYER_ICONS[l.id];
                  return (
                    <button
                      key={l.id}
                      type="button"
                      role="radio"
                      aria-checked={l.id === layer}
                      tabIndex={l.id === layer ? 0 : -1}
                      className="layer-tile"
                      title={l.hint}
                      onClick={() => choose(l.id)}
                    >
                      <Icon size={20} aria-hidden="true" />
                      <span>{l.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.querySelector('.app') ?? document.body,
  );
}
