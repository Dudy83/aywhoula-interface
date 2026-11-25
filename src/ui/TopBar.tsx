import { Search, Star, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { geocode, searchPlaces, sportsLabel, type GeoHit, type PlaceHit } from '../data/places';
import { fmt } from '../lib/units';
import { mapApi } from '../map/api';
import { useStore, type Selection } from '../state/store';
import { AccountButton } from './account/AccountButton';
import { BrandMark } from './common';

interface Result {
  key: string;
  group: 'Favoris' | 'Spots et plages' | 'Lieux' | 'Spots et plages plus lointains';
  title: string;
  meta: string;
  selection: Selection;
  zoom: number;
}

const fromPlace = ({ place, distance }: PlaceHit): Result => ({
  key: place.id,
  group: 'Spots et plages',
  title: place.name,
  meta: `${place.kind === 'spot' ? sportsLabel(place.sports) || 'Spot' : 'Plage'} · ${
    distance < 10 ? fmt(distance, 1) : fmt(distance)
  } km`,
  selection: {
    kind: place.kind === 'spot' ? 'spot' : 'beach',
    id: place.id,
    name: place.name,
    lon: place.lon,
    lat: place.lat,
    detail: sportsLabel(place.sports) || undefined,
  },
  zoom: 11,
});

const FAR_KM = 1500;

const fromGeo = (g: GeoHit): Result => ({
  key: g.id,
  group: 'Lieux',
  title: g.name,
  meta: g.context,
  selection: { kind: 'point', id: g.id, name: g.name, lon: g.lon, lat: g.lat },
  zoom: 9,
});

const fromFavorite = (f: Selection): Result => ({
  key: `fav:${f.id}`,
  group: 'Favoris',
  title: f.name || 'Point enregistré',
  meta: f.detail || (f.kind === 'beach' ? 'Plage' : f.kind === 'buoy' ? 'Bouée' : f.kind === 'spot' ? 'Spot' : 'Point'),
  selection: f,
  zoom: 10,
});

/** Le champ de recherche, pour qu'un autre composant y amène la saisie (« Changer » dans une alerte). */
let searchInput: HTMLInputElement | null = null;
export const focusSearch = (): void => searchInput?.focus();

export function TopBar() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [places, setPlaces] = useState<PlaceHit[]>([]);
  const [geo, setGeo] = useState<GeoHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const favorites = useStore((s) => s.favorites);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      setPlaces([]);
      setGeo([]);
      setBusy(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setBusy(true);
    searchPlaces(trimmed, mapApi.center())
      .then((hits) => !cancelled && setPlaces(hits))
      // Fichier des spots indisponible : la recherche de villes répond quand même.
      .catch(() => !cancelled && setPlaces([]));
    const timer = window.setTimeout(() => {
      geocode(trimmed, controller.signal)
        .then((hits) => !cancelled && setGeo(hits))
        .catch(() => undefined)
        .finally(() => !cancelled && setBusy(false));
    }, 250);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmed]);

  const results = useMemo<Result[]>(() => {
    if (trimmed.length < 2) return favorites.map(fromFavorite);
    // Une plage homonyme à l'autre bout du monde ne doit pas passer devant la ville cherchée.
    const near = places.filter((h) => h.distance <= FAR_KM).map(fromPlace);
    const far = places
      .filter((h) => h.distance > FAR_KM)
      .map((h) => ({ ...fromPlace(h), group: 'Spots et plages plus lointains' as const }));
    return [...near, ...geo.map(fromGeo), ...far];
  }, [trimmed, favorites, places, geo]);

  useEffect(() => setActive(0), [results]);

  useEffect(() => {
    searchInput = input.current;
    return () => {
      searchInput = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  const choose = (r: Result) => {
    useStore.getState().select(r.selection);
    mapApi.focus(r.selection.lon, r.selection.lat, r.zoom);
    setOpen(false);
    setQuery('');
    input.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (results.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    } else if (e.key === 'Enter' && open && results[active]) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      // Échap vide d'abord la recherche ; le panneau ne se ferme qu'à l'appui suivant.
      if (query || showList) e.preventDefault();
      if (query) setQuery('');
      else input.current?.blur();
      setOpen(false);
    }
  };

  const showList = open && (results.length > 0 || trimmed.length >= 2);
  let lastGroup = '';

  return (
    <div className="topbar" ref={root}>
      <a className="brand" href="/" aria-label="Aywhoula, accueil">
        <BrandMark className="brand-mark" />
        <span className="brand-name">Aywhoula</span>
      </a>
      <div className="search">
        <Search size={16} aria-hidden="true" className="search-icon" />
        <input
          ref={input}
          type="search"
          value={query}
          placeholder="Spot, plage ou ville"
          role="combobox"
          aria-label="Chercher un spot, une plage ou une ville"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query ? (
          <button
            type="button"
            className="search-clear"
            aria-label="Effacer la recherche"
            onClick={() => {
              setQuery('');
              input.current?.focus();
            }}
          >
            <X size={15} />
          </button>
        ) : (
          <kbd className="search-key" aria-hidden="true">
            /
          </kbd>
        )}
      </div>
      <AccountButton />
      {showList && (
        <ul className="results" id={listId} role="listbox" aria-label="Résultats">
          {results.map((r, i) => {
            const header = r.group !== lastGroup;
            lastGroup = r.group;
            return (
              <li key={r.key} role="presentation">
                {header && <div className="results-group">{r.group}</div>}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className="result"
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(r)}
                >
                  <span className="result-title">
                    {r.group === 'Favoris' && <Star size={12} aria-hidden="true" className="result-star" />}
                    {r.title}
                  </span>
                  <span className="result-meta">{r.meta}</span>
                </div>
              </li>
            );
          })}
          {results.length === 0 && (
            <li className="results-empty" role="presentation">
              {busy ? 'Recherche…' : `Rien trouvé pour « ${trimmed} ». Cliquez sur la carte pour une prévision à n’importe quel endroit.`}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
