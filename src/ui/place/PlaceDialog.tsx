/**
 * Le dialog d'un lieu. Sur ordinateur, celui d'un spot, d'une plage, d'une bouée ou d'une webcam, sur toute
 * la hauteur de la colonne de droite ; la barre du bas montre déjà la prévision heure par heure. Sur
 * téléphone, une feuille à trois hauteurs (réduite en petite carte, ouverte, agrandie) : un point de la
 * carte y porte la barre du bas ; un lieu référencé s'ouvre sur son seul contenu, la barre vient après.
 */
import { ChevronDown, PanelRightClose } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { BUOY_NETWORKS, parseBuoyId } from '../../data/buoys';
import { coordParts } from '../../lib/units';
import { useStore, type PlaceKind, type Selection, type Sheet } from '../../state/store';
import { SheetBar } from '../Dock';
import { BuoyBody } from './BuoyBody';
import { Pieces, PlaceIcon, usePlace, usePointHeading } from './parts';
import { AlertButton, CloseButton, FavoriteButton } from './PlaceCard';
import { SpotBody, spotKindLabel, sportsOf } from './SpotBody';
import { WebcamBody } from './WebcamBody';

const UNNAMED: Record<PlaceKind, string> = { point: 'Point sur la carte', spot: 'Spot sans nom', beach: 'Plage sans nom', buoy: 'Bouée', webcam: 'Webcam' };

/** Le titre et les morceaux de la ligne d'un lieu : son type et ses coordonnées (le réseau pour une bouée). */
function useHeading(selection: Selection): { title: string; parts: string[] } {
  const place = usePlace(selection);
  const point = usePointHeading(selection, selection.kind === 'point');
  if (selection.kind === 'point') return point;
  const coords = coordParts(selection.lat, selection.lon);
  const title = selection.name || UNNAMED[selection.kind];
  if (selection.kind === 'spot') return { title, parts: [spotKindLabel(sportsOf(place, selection)), ...coords] };
  if (selection.kind === 'beach') return { title, parts: ['Plage', ...coords] };
  if (selection.kind === 'buoy') return { title, parts: ['Bouée houlographique', BUOY_NETWORKS[parseBuoyId(selection.id).source].label] };
  return { title, parts: ['Webcam', ...coords] };
}

/** La hauteur de la feuille du téléphone : celle de son contenu (58dvh au plus), ou le plein écran. */
const sheetHeight = (sheet: Sheet, open: number | null): string =>
  sheet === 'expanded' ? 'calc(100dvh - 58px - var(--safe-top))' : open != null ? `${open}px` : '58dvh';

export function PlaceDialog({ selection, wide }: { selection: Selection; wide: boolean }) {
  const sheet = useStore((s) => s.sheet);
  const setSheet = useStore((s) => s.setSheet);
  const { title, parts } = useHeading(selection);
  const panel = useRef<HTMLElement>(null);
  const grip = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  const lead = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [openHeight, setOpenHeight] = useState<number | null>(null);
  const drag = useRef<{ id: number; y: number; h: number; moved: boolean; grip: boolean } | null>(null);
  /** Un toucher sur la poignée, déjà traité au relâchement : le clic qui le suit éventuellement ne compte pas. */
  const tapped = useRef(false);

  // Ouverte, la feuille prend la hauteur du contenu du lieu (pour un point, de la barre), 58dvh au plus : la
  // barre d'un lieu référencé ne se voit qu'en faisant défiler ou en agrandissant la feuille.
  useLayoutEffect(() => {
    if (wide) return;
    const measure = () => {
      if (!grip.current || !header.current || !lead.current || !body.current) return;
      const pad = parseFloat(getComputedStyle(body.current).paddingBottom) || 0;
      const content = grip.current.offsetHeight + header.current.offsetHeight + lead.current.offsetHeight + pad;
      setOpenHeight(Math.min(Math.round(window.innerHeight * 0.58), Math.ceil(content)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(lead.current!);
    ro.observe(header.current!);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [wide]);

  // La poignée et le glissé : vers le haut, la feuille s'agrandit ; vers le bas, elle revient à mi-hauteur,
  // puis se réduit en petite carte.
  const toggle = () => setSheet(sheet === 'expanded' ? 'open' : 'expanded');
  // La poignée garde le pointeur dès l'appui : le glissé continue même hors d'elle. Le clic qui suit se
  // perd alors sur la poignée : un toucher sans glissé est traité au relâchement.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (wide || !panel.current || target.closest('button:not(.panel-grip), a')) return;
    drag.current = { id: e.pointerId, y: e.clientY, h: panel.current.offsetHeight, moved: false, grip: !!target.closest('.panel-grip') };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = panel.current;
    if (!d || !el || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    el.style.transition = 'none';
    el.style.height = `${Math.max(96, Math.min(window.innerHeight - 58, d.h - dy))}px`;
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = panel.current;
    drag.current = null;
    if (!d || !el || d.id !== e.pointerId) return;
    el.style.transition = '';
    if (!d.moved) {
      if (d.grip && e.type === 'pointerup') {
        tapped.current = true;
        window.setTimeout(() => (tapped.current = false), 400);
        toggle();
      }
      return;
    }
    const dy = e.clientY - d.y;
    const next: Sheet = sheet === 'expanded' ? (dy > 240 ? 'reduced' : dy > 48 ? 'open' : 'expanded') : dy < -48 ? 'expanded' : dy > 48 ? 'reduced' : 'open';
    el.style.height = sheetHeight(next === 'reduced' ? sheet : next, openHeight);
    setSheet(next);
  };

  const isPoint = selection.kind === 'point';
  const content = isPoint ? (
    <SheetBar />
  ) : selection.kind === 'buoy' ? (
    <BuoyBody selection={selection} />
  ) : selection.kind === 'webcam' ? (
    <WebcamBody selection={selection} wide={wide} />
  ) : (
    <SpotBody selection={selection} wide={wide} />
  );

  return (
    <aside
      ref={panel}
      className="panel place-dialog"
      data-sheet={wide ? undefined : sheet}
      data-kind={selection.kind}
      style={wide ? undefined : { height: sheetHeight(sheet, openHeight) }}
      aria-label={title}
    >
      <div className="sheet-handle" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <button
          ref={grip}
          type="button"
          className="panel-grip"
          aria-label={sheet === 'expanded' ? 'Ramener le dialog à mi-hauteur' : 'Agrandir le dialog'}
          aria-expanded={sheet === 'expanded'}
          // Au clavier ; un toucher est déjà passé par le relâchement.
          onClick={() => !tapped.current && toggle()}
        >
          <span className="panel-grip-bar" aria-hidden="true" />
        </button>
        <header ref={header} className="panel-header place-header">
          <div className="panel-heading">
            <h2>{title}</h2>
            <p className="place-line">
              <PlaceIcon kind={selection.kind} size={14} />
              <span>
                <Pieces parts={parts} />
              </span>
            </p>
          </div>
          <div className="place-actions">
            <AlertButton selection={selection} />
            <FavoriteButton selection={selection} />
            <button type="button" className="icon-button" aria-label="Réduire le dialog" title="Réduire" onClick={() => setSheet('reduced')}>
              {wide ? <PanelRightClose size={18} /> : <ChevronDown size={18} />}
            </button>
            <CloseButton />
          </div>
        </header>
      </div>
      <div ref={body} className="panel-body">
        <div ref={lead} className="place-lead">
          {content}
        </div>
        {!wide && !isPoint && <SheetBar />}
      </div>
    </aside>
  );
}
