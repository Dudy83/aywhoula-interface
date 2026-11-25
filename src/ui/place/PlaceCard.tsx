/**
 * Les petites cartes d'un lieu, et les boutons d'en-tête qu'elles partagent avec le dialog. Sur ordinateur,
 * celle d'un point de la carte (il n'a pas de dialog : sa rose dit déjà la houle, les vagues et le vent) et
 * celle d'un dialog réduit, en haut à droite, à gauche des boutons de carte ; sur téléphone, celle du dialog
 * réduit, au-dessus de la légende de la carte (`Dock`).
 */
import { BellPlus, ChevronUp, PanelRightOpen, Star, X } from 'lucide-react';
import { loadBuoy } from '../../data/buoys';
import { hostOf, isLive, placeSelection, useAsync, useFilmedPlace } from '../../data/nearby';
import { formatAgo } from '../../lib/time';
import { fmt, formatCoord, formatHeight, HEIGHT_UNIT_LABEL } from '../../lib/units';
import { newAlert, toggleFavorite } from '../../state/account';
import { isFavorite, useStore, type Selection } from '../../state/store';
import { PlaceIcon, Pieces, pointAt, usePointHeading } from './parts';
import { useSpotSummary } from './SpotBody';

/**
 * La cloche : « Nouvelle alerte » sur ce lieu (en version gratuite, elle ouvre l'offre). Une bouée porte
 * l'alerte de la prévision à son emplacement ; une webcam, celle du lieu qu'elle filme, sinon de la caméra.
 */
export function AlertButton({ selection }: { selection: Selection }) {
  const filmed = useFilmedPlace(selection.kind === 'webcam' ? selection : null);
  const target =
    selection.kind === 'buoy' ? pointAt(selection) : selection.kind === 'webcam' ? (filmed ? placeSelection(filmed.item) : pointAt(selection)) : selection;
  return (
    <button type="button" className="icon-button" aria-label="Créer une alerte ici" title="Créer une alerte ici" onClick={() => newAlert(target)}>
      <BellPlus size={18} />
    </button>
  );
}

/** L'étoile : ajoute ou retire le lieu des favoris (en version gratuite, le 4e favori ouvre l'offre). */
export function FavoriteButton({ selection }: { selection: Selection }) {
  const favorite = useStore((s) => isFavorite(s.favorites, selection.id));
  return (
    <button
      type="button"
      className="icon-button"
      aria-pressed={favorite}
      aria-label={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      title={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
      onClick={() => toggleFavorite({ ...selection, name: selection.name || formatCoord(selection.lat, selection.lon) })}
    >
      <Star size={18} fill={favorite ? 'currentColor' : 'none'} />
    </button>
  );
}

/** La croix : ferme et retire la sélection, comme Échap. */
export function CloseButton({ label = 'Fermer' }: { label?: string }) {
  return (
    <button type="button" className="icon-button" aria-label={label} title={`${label} (Échap)`} onClick={() => useStore.getState().select(null)}>
      <X size={18} />
    </button>
  );
}

/** La petite carte d'un point, sur ordinateur : son titre, ses coordonnées et la distance à la côte, trois boutons. */
export function PointCard({ selection }: { selection: Selection }) {
  const { title, parts } = usePointHeading(selection);
  return (
    <aside className="place-card" aria-label={title}>
      <span className="place-card-icon" aria-hidden="true">
        <PlaceIcon kind="point" size={18} />
      </span>
      <div className="place-card-text">
        <b>{title}</b>
        <span>
          <Pieces parts={parts} />
        </span>
      </div>
      <div className="place-card-actions">
        <AlertButton selection={selection} />
        <FavoriteButton selection={selection} />
        <CloseButton label="Retirer le point" />
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------- dialog réduit */

/** La ligne de résumé d'un spot ou d'une plage : « Houle de face 1,5 m · vent de terre 14 nd ». */
function SpotSummary({ selection }: { selection: Selection }) {
  const summary = useSpotSummary(selection);
  return <span>{summary.length ? <Pieces parts={summary} /> : 'Prévision en cours de chargement'}</span>;
}

/** La dernière mesure d'une bouée : « 1,8 m · 8 s · il y a 27 min ». */
function BuoySummary({ selection }: { selection: Selection }) {
  const units = useStore((s) => s.units);
  const obs = useAsync(`buoy|${selection.id}`, () => loadBuoy(selection.id).catch(() => null));
  if (obs === undefined) return <span>Dernière mesure en cours de chargement</span>;
  if (!obs || !isLive(obs)) return <span>Pas de mesure en ce moment</span>;
  const parts = [`${formatHeight(obs.waveHeight, units.height)} ${HEIGHT_UNIT_LABEL[units.height]}`, obs.dominantPeriod == null ? '' : `${fmt(obs.dominantPeriod)} s`, formatAgo(obs.time)];
  return (
    <span>
      <Pieces parts={parts.filter(Boolean)} />
    </span>
  );
}

/**
 * Le dialog réduit : le pictogramme, le nom, une ligne de résumé, de quoi rouvrir et la croix. Le lieu
 * reste sélectionné sur la carte ; toucher la carte (ou le lieu sur la carte) rouvre le dialog.
 */
export function ReducedCard({ selection, wide }: { selection: Selection; wide: boolean }) {
  const reopen = () => useStore.getState().setSheet('open');
  const url = selection.kind === 'webcam' ? selection.detail : undefined;
  const point = usePointHeading(selection, selection.kind === 'point');
  const name = selection.kind === 'point' ? point.title : selection.name || 'Lieu sans nom';
  return (
    <aside className="place-card" data-reduced aria-label={`${name}, dialog réduit`}>
      {/* Le toucher sur la carte rouvre le dialog ; au clavier, le bouton « Rouvrir ». */}
      <div className="place-card-main" onClick={reopen}>
        <span className="place-card-icon" aria-hidden="true">
          <PlaceIcon kind={selection.kind} size={18} />
        </span>
        <div className="place-card-text">
          <b>{name}</b>
          {selection.kind === 'spot' || selection.kind === 'beach' ? (
            <SpotSummary selection={selection} />
          ) : selection.kind === 'buoy' ? (
            <BuoySummary selection={selection} />
          ) : selection.kind === 'webcam' ? (
            url ? (
              <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={`Ouvrir l’image chez ${hostOf(url) || 'le diffuseur'}`}>
                Voir l’image
              </a>
            ) : (
              <span>Lien de l’image indisponible</span>
            )
          ) : (
            <span>
              <Pieces parts={point.parts} />
            </span>
          )}
        </div>
      </div>
      <div className="place-card-actions">
        <button type="button" className="icon-button" aria-label="Rouvrir le dialog" title="Rouvrir" onClick={reopen}>
          {wide ? <PanelRightOpen size={18} /> : <ChevronUp size={18} />}
        </button>
        <CloseButton />
      </div>
    </aside>
  );
}
