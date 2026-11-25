/**
 * Le dialog d'une webcam : l'aperçu qui ouvre l'image chez le diffuseur, le lieu qu'elle filme, et sur
 * ordinateur ce qui est prévu au même endroit, pour comparer avec l'image.
 */
import { ExternalLink, Video } from 'lucide-react';
import { fromLand, fromWords, hostOf, placeSelection, shortDistanceText, useFilmedPlace, type Near } from '../../data/nearby';
import { at } from '../../data/sea-state';
import type { Place } from '../../data/places';
import { fmt, formatHeight, formatWind, HEIGHT_UNIT_LABEL, WIND_UNIT_LABEL } from '../../lib/units';
import { useStore, type Selection } from '../../state/store';
import { atHourLabel, LinkRow, openPlace, PlaceIcon, Section, usePlaceNow } from './parts';

/** Ce qui est prévu là où filme la webcam (ou à la caméra), à l'heure de la carte. */
function ForecastHere({ point, filmed }: { point: { lat: number; lon: number }; filmed: Near<Place> | null }) {
  const now = usePlaceNow(point);
  const units = useStore((s) => s.units);
  if (!now.fc) return null;
  const i = now.index;
  const seaHeight = i < 0 ? null : at(now.sea?.height, i);
  const period = i < 0 ? null : at(now.sea?.period, i);
  const seaFrom = i < 0 ? null : at(now.sea?.direction, i);
  const speed = i < 0 ? null : at(now.wind?.speed, i);
  const windFrom = i < 0 ? null : at(now.wind?.direction, i);
  if (seaHeight == null && speed == null) return null;
  const place = filmed?.item ?? null;
  const facing = place ? fromLand(place.off, seaFrom) : null;
  const offshore = place ? fromLand(place.off, windFrom) : null;
  const where = place?.kind === 'spot' ? 'spot' : 'plage';
  const exposure = facing == null ? '' : place?.kind === 'spot' ? (facing ? 'exposé' : 'abrité') : facing ? 'exposée' : 'abritée';
  return (
    <Section title={`Prévu au même endroit, ${atHourLabel(i >= 0 ? now.fc.times[i] : now.time)}`}>
      <div className="forecast-tiles">
        {seaHeight != null && (
          <div className="forecast-tile">
            <span className="forecast-tile-label">Houle</span>
            <b>
              {formatHeight(seaHeight, units.height)} {HEIGHT_UNIT_LABEL[units.height]}
              {period != null && ` · ${fmt(period)} s`}
            </b>
            <span>{[seaFrom == null ? '' : fromWords(seaFrom), exposure ? `${where} ${exposure}` : ''].filter(Boolean).join(', ')}</span>
          </div>
        )}
        {speed != null && (
          <div className="forecast-tile">
            <span className="forecast-tile-label">Vent</span>
            <b>
              {formatWind(speed, units.wind)} {WIND_UNIT_LABEL[units.wind]}
            </b>
            <span>{[windFrom == null ? '' : fromWords(windFrom), offshore == null ? '' : offshore ? 'de terre' : 'de mer'].filter(Boolean).join(', ')}</span>
          </div>
        )}
      </div>
      <p className="place-note">Pour comparer ce que montre l’image et ce qui est prévu.</p>
    </Section>
  );
}

export function WebcamBody({ selection, wide }: { selection: Selection; wide: boolean }) {
  const url = selection.detail ?? '';
  const host = hostOf(url);
  const filmed = useFilmedPlace(selection);
  return (
    <>
      <div className="cam-preview">
        <Video size={34} aria-hidden="true" className="cam-icon" />
        {url && (
          <a className="cam-open" href={url} target="_blank" rel="noreferrer">
            <ExternalLink size={16} aria-hidden="true" />
            Voir l’image
          </a>
        )}
        <p>Diffusée par {host || 'un site tiers'}, elle s’ouvre chez le diffuseur</p>
      </div>
      {filmed && (
        <Section title="Ce qu’elle filme">
          <div className="info-list">
            <LinkRow
              icon={<PlaceIcon kind={filmed.item.kind} />}
              title={filmed.item.name || (filmed.item.kind === 'spot' ? 'Spot sans nom' : 'Plage sans nom')}
              detail={`${filmed.item.kind === 'spot' ? 'Spot' : 'Plage'} · à ${shortDistanceText(filmed.km)} de la caméra`}
              value="Ouvrir"
              onClick={() => openPlace(placeSelection(filmed.item))}
            />
          </div>
        </Section>
      )}
      {wide && filmed !== undefined && <ForecastHere point={filmed?.item ?? selection} filmed={filmed} />}
    </>
  );
}
