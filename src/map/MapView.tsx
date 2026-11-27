import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Feature as GeoFeature, FeatureCollection, Point } from 'geojson';
import { Map as MlMap, Marker, setWorkerUrl, type GeoJSONSource, type MapGeoJSONFeature, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { BUOY_NETWORKS, buoyName, KNOWN_STATIONS, loadBuoyNames, loadBuoys, type BuoyObs } from '../data/buoys';
import { loadBeaches, loadSpots, loadWebcams, sportsLabel, type Place } from '../data/places';
import { useResolvedTheme, type ThemeName } from '../lib/theme';
import { formatHeight, HEIGHT_UNIT_LABEL } from '../lib/units';
import { useStore, type PlaceKind, type Selection } from '../state/store';
import { mapApi } from './api';
import { applyMapTheme, buildStyle, FIELD_BEFORE, MAP_COLORS, MARKERS_BEFORE } from './basemap';
import { FieldController } from './controller';
import { FieldLayer } from './FieldLayer';
import { SelectionRose } from './SelectionRose';

// Le bundler déplace la librairie : on lui indique où trouver son worker.
setWorkerUrl(workerUrl);

type Feature = GeoFeature<Point, Record<string, unknown>>;

const collection = (features: Feature[]): FeatureCollection<Point> => ({
  type: 'FeatureCollection',
  features,
});

const point = (lon: number, lat: number, properties: Record<string, unknown>): Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties,
});

const placeFeature = (p: Place): Feature =>
  point(p.lon, p.lat, { id: p.id, kind: p.kind, name: p.name, detail: p.kind === 'webcam' ? p.url : sportsLabel(p.sports) });

/** Dessine une petite icône dans un canevas et l'enregistre auprès de la carte. */
function addIcon(map: MlMap, name: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const ratio = 3;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * ratio;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(ratio, ratio);
  draw(ctx, size);
  if (map.hasImage(name)) map.removeImage(name);
  map.addImage(name, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
}

const INK = '#0b0d10';

function addIcons(map: MlMap, accent: string) {
  const disc = (fill: string, r: number) => (ctx: CanvasRenderingContext2D, s: number) => {
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
  };
  addIcon(map, 'beach', 10, disc('rgba(255,255,255,0.92)', 2.6));
  addIcon(map, 'spot', 14, disc('#ffffff', 4.4));
  addIcon(map, 'favorite', 18, (ctx, s) => {
    disc(accent, 6)(ctx, s);
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 2, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  });
  addIcon(map, 'buoy', 18, (ctx, s) => {
    const c = s / 2;
    ctx.beginPath();
    ctx.moveTo(c, 2);
    ctx.lineTo(s - 2, c);
    ctx.lineTo(c, s - 2);
    ctx.lineTo(2, c);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
  });
  // Bouée dont la mesure manque : le même losange, évidé.
  addIcon(map, 'buoy-link', 18, (ctx, s) => {
    const c = s / 2;
    ctx.beginPath();
    ctx.moveTo(c, 3);
    ctx.lineTo(s - 3, c);
    ctx.lineTo(c, s - 3);
    ctx.lineTo(3, c);
    ctx.closePath();
    ctx.fillStyle = 'rgba(11, 13, 16, 0.45)';
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4.4;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });
  addIcon(map, 'webcam', 16, (ctx, s) => {
    ctx.beginPath();
    ctx.roundRect(2, 3.5, s - 4, s - 7, 2.5);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  });
}

const MARKER_LAYERS = ['favorites', 'buoys', 'webcams', 'spots', 'beaches'] as const;

function addMarkerLayers(map: MlMap, theme: ThemeName) {
  const c = MAP_COLORS[theme];
  const text = (color: string) => ({
    'text-color': color,
    'text-halo-color': c.halo,
    'text-halo-width': 1.3,
    'text-halo-blur': 0.3,
  });
  for (const id of ['beaches', 'spots', 'webcams', 'buoys', 'favorites']) {
    map.addSource(id, { type: 'geojson', data: collection([]) });
  }
  map.addLayer(
    {
      id: 'beaches',
      type: 'symbol',
      source: 'beaches',
      minzoom: 9,
      layout: {
        'icon-image': 'beach',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.9, 13, 1.5],
        'icon-padding': 3,
        'text-field': ['step', ['zoom'], '', 11, ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.6],
        'text-optional': true,
        'text-max-width': 8,
      },
      paint: text(c.labelMuted),
    },
    MARKERS_BEFORE,
  );
  map.addLayer(
    {
      id: 'spots',
      type: 'symbol',
      source: 'spots',
      minzoom: 5,
      layout: {
        'icon-image': 'spot',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 9, 1],
        'icon-padding': 2,
        'text-field': ['step', ['zoom'], '', 8, ['get', 'name']],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11.5,
        'text-anchor': 'top',
        'text-offset': [0, 0.75],
        'text-optional': true,
        'text-max-width': 8,
      },
      paint: text(c.label),
    },
    MARKERS_BEFORE,
  );
  map.addLayer(
    {
      id: 'webcams',
      type: 'symbol',
      source: 'webcams',
      minzoom: 8,
      layout: { 'icon-image': 'webcam', 'icon-padding': 2 },
    },
    MARKERS_BEFORE,
  );
  map.addLayer({
    id: 'buoys',
    type: 'symbol',
    source: 'buoys',
    minzoom: 2.5,
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 2.5, 0.65, 6, 1],
      'icon-allow-overlap': true,
      // La hauteur mesurée dès le zoom 4 ; le nom des bouées sans mesure en s'approchant.
      'text-field': ['step', ['zoom'], '', 4, ['get', 'label'], 7, ['get', 'labelNear']],
      'text-font': ['Noto Sans Bold'],
      'text-size': 11,
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
      'text-optional': true,
    },
    paint: text(c.label),
  });
  map.addLayer({
    id: 'favorites',
    type: 'symbol',
    source: 'favorites',
    layout: {
      'icon-image': 'favorite',
      'icon-allow-overlap': true,
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 0.85],
      'text-optional': true,
      'text-max-width': 8,
    },
    paint: text(c.label),
  });
}

function setMarkerTheme(map: MlMap, theme: ThemeName) {
  const c = MAP_COLORS[theme];
  for (const id of MARKER_LAYERS) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, 'text-halo-color', c.halo);
    map.setPaintProperty(id, 'text-color', id === 'beaches' ? c.labelMuted : c.label);
  }
}

function buoyFeatures(buoys: BuoyObs[], names: Map<string, string>, unit: 'm' | 'ft'): Feature[] {
  const measured = buoys.map((b) => {
    const label = `${formatHeight(b.waveHeight, unit)} ${HEIGHT_UNIT_LABEL[unit]}`;
    return point(b.lon, b.lat, {
      id: b.id,
      kind: 'buoy',
      name: buoyName(b, names),
      detail: `${BUOY_NETWORKS[b.source].label} · ${b.station}`,
      icon: 'buoy',
      label,
      labelNear: label,
    });
  });
  // Bouées connues d'avance dont la mesure manque (pas encore lue, ou en panne) :
  // pas de hauteur à afficher, seulement leur nom de près.
  const seen = new Set(buoys.map((b) => b.id));
  const silent = KNOWN_STATIONS.filter((s) => !seen.has(s.id)).map((s) =>
    point(s.lon, s.lat, {
      id: s.id,
      kind: 'buoy',
      name: s.name,
      detail: `${BUOY_NETWORKS[s.source].label} · ${s.station}`,
      icon: 'buoy-link',
      label: '',
      labelNear: s.name,
    }),
  );
  return [...measured, ...silent];
}

function selectionFromFeature(f: MapGeoJSONFeature): Selection {
  const [lon, lat] = (f.geometry as Point).coordinates;
  const p = f.properties as Record<string, string>;
  return { kind: p.kind as PlaceKind, id: p.id, name: p.name, lon, lat, detail: p.detail || undefined };
}

/** Ce que les lieux et les bouées attendent au plus, une fois le fond de carte dessiné, si le champ tarde. */
const PLACES_WAIT_MS = 3000;

/**
 * Lance `start` quand la première carte est là (l'état du champ passe à « prêt »), ou après `PLACES_WAIT_MS`
 * au plus : ce qui se charge là ne dispute plus le réseau aux grilles de l'ouverture, sans jamais en être
 * privé si le champ tarde ou échoue. Renvoie de quoi annuler l'attente.
 */
function afterFirstField(start: () => void): () => void {
  if (useStore.getState().status === 'ready') {
    start();
    return () => undefined;
  }
  const cancel = () => {
    unsubscribe();
    window.clearTimeout(timer);
  };
  const go = () => {
    cancel();
    start();
  };
  const unsubscribe = useStore.subscribe((s) => {
    if (s.status === 'ready') go();
  });
  const timer = window.setTimeout(go, PLACES_WAIT_MS);
  return cancel;
}

const accentColor = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5fe3c0';

/** Convertit une couleur CSS quelconque en couleur que le canevas sait peindre. */
function canvasColor(css: string): string {
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.fillStyle = '#5fe3c0';
  probe.fillStyle = css;
  return probe.fillStyle;
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const controllerRef = useRef<FieldController | null>(null);
  /** Le premier chargement du style est terminé : les couches de l'app existent. */
  const readyRef = useRef(false);
  const theme = useResolvedTheme();
  // L'état du champ affiché, recopié sur la carte : le banc de mesure (scripts/bench-carte.mjs) le lit.
  const status = useStore((st) => st.status);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  // Élément de l'épingle de sélection : MapLibre le place, React y rend la rose (SelectionRose).
  const [pinEl] = useState(() => {
    const el = document.createElement('div');
    el.className = 'pin';
    return el;
  });

  useEffect(() => {
    const el = container.current!;
    const initial = useStore.getState().view;
    const map = new MlMap({
      container: el,
      style: buildStyle(themeRef.current),
      center: [initial.lng, initial.lat],
      zoom: initial.zoom,
      minZoom: 1.6,
      maxZoom: 15,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      fadeDuration: 150,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    mapRef.current = map;
    mapApi.attach(map);
    if (import.meta.env.DEV) (window as unknown as { __map: MlMap }).__map = map;

    const field = new FieldLayer();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const applyAnimate = () => field.setAnimate(useStore.getState().animate && !reduced.matches);
    applyAnimate();
    reduced.addEventListener('change', applyAnimate);

    // Le contrôleur part dès que la carte est montée, avec la vue de départ : il demande le run, puis les
    // blocs de grille, pendant que le fond de carte se charge, au lieu d'attendre l'événement `load`. Il ne
    // touche pas à WebGL, et ne remet ses échéances à la couche qu'une fois le fond dessiné (`markShown`).
    const controller = new FieldController(map, field, themeRef.current === 'dark');
    controllerRef.current = controller;

    // Épingle de la sélection : MapLibre la place sur le point, son contenu est rendu par SelectionRose.
    const pin = new Marker({ element: pinEl, anchor: 'center' });

    const renderPin = () => {
      const sel = useStore.getState().selection;
      if (!sel) {
        pin.remove();
        return;
      }
      pin.setLngLat([sel.lon, sel.lat]).addTo(map);
    };

    let buoys: BuoyObs[] = [];
    let buoyNames = new Map<string, string>();
    const source = (id: string) => map.getSource(id) as GeoJSONSource | undefined;
    const renderBuoys = () => source('buoys')?.setData(collection(buoyFeatures(buoys, buoyNames, useStore.getState().units.height)));
    const renderFavorites = () =>
      source('favorites')?.setData(
        collection(
          useStore
            .getState()
            .favorites.map((f) => point(f.lon, f.lat, { id: f.id, kind: f.kind, name: f.name, detail: f.detail ?? '' })),
        ),
      );
    const renderVisibility = () => {
      const { show } = useStore.getState();
      const set = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      set('spots', show.places);
      set('beaches', show.places);
      set('buoys', show.buoys);
      set('webcams', show.webcams);
    };

    let disposed = false;
    let cancelPlaces: () => void = () => undefined;

    const fillPlaces = () => {
      const fill = (id: string) => (list: Place[]) => {
        if (!disposed) source(id)?.setData(collection(list.map(placeFeature)));
      };
      void loadSpots().then(fill('spots')).catch(() => undefined);
      void loadBeaches().then(fill('beaches')).catch(() => undefined);
      void loadWebcams().then(fill('webcams')).catch(() => undefined);
    };

    /** Pose la couche du champ juste au-dessus de l'océan, si elle n'y est pas déjà. */
    const addField = () => {
      if (!map.getLayer(field.id)) map.addLayer(field, map.getLayer(FIELD_BEFORE) ? FIELD_BEFORE : undefined);
    };

    map.on('load', () => {
      if (disposed) return;
      addIcons(map, canvasColor(accentColor()));
      addField();
      addMarkerLayers(map, themeRef.current);
      renderFavorites();
      renderVisibility();
      readyRef.current = true;
      // Les bouées connues d'avance sont placées tout de suite, évidées ; leur mesure suit.
      renderBuoys();
      // Le fond de carte est dessiné : le champ déjà lu s'affiche, et l'écran de démarrage peut s'effacer.
      controller.markShown();

      // Plages, spots, webcams et bouées partent après la première carte : leurs fichiers ne disputent
      // plus le réseau aux grilles de l'ouverture.
      cancelPlaces = afterFirstField(() => {
        if (disposed) return;
        fillPlaces();
        // Chaque réseau de bouées s'affiche dès qu'il répond ; les noms du NDBC suivent.
        void loadBuoys((list) => {
          buoys = list;
          if (!disposed) renderBuoys();
        });
        void loadBuoyNames().then((n) => {
          buoyNames = n;
          if (!disposed) renderBuoys();
        });
      });
    });

    // La couche du champ se pose dès que le style est lu, sans attendre que le fond soit dessiné (`load`) :
    // ses programmes sont prêts quand le champ arrive. Après une perte du contexte WebGL (onglet resté en
    // arrière-plan sur mobile), MapLibre reconstruit le style sans les couches personnalisées : on remet
    // le champ, et ce que montrent les marqueurs.
    map.on('style.load', () => {
      if (disposed || map.getLayer(field.id)) return;
      addField();
      if (!readyRef.current) return;
      fillPlaces();
      renderBuoys();
      renderFavorites();
      renderVisibility();
    });

    const hitLayers = () => MARKER_LAYERS.filter((id) => map.getLayer(id));
    const featureAt = (e: MapMouseEvent) => {
      const { x, y } = e.point;
      const hits = map.queryRenderedFeatures(
        [
          [x - 7, y - 7],
          [x + 7, y + 7],
        ],
        { layers: [...hitLayers()] },
      );
      return hits[0];
    };

    map.on('click', (e) => {
      const hit = featureAt(e);
      const store = useStore.getState();
      if (hit) {
        const sel = selectionFromFeature(hit);
        store.select(sel);
        mapApi.reveal(sel.lon, sel.lat);
        return;
      }
      const { lng, lat } = e.lngLat.wrap();
      store.select({ kind: 'point', id: `point:${lat.toFixed(3)},${lng.toFixed(3)}`, name: '', lon: lng, lat });
      mapApi.reveal(lng, lat);
    });

    let hoverFrame = 0;
    map.on('mousemove', (e) => {
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => {
        map.getCanvas().style.cursor = featureAt(e) ? 'pointer' : '';
      });
    });

    let viewTimer = 0;
    map.on('moveend', () => {
      clearTimeout(viewTimer);
      viewTimer = window.setTimeout(() => {
        const c = map.getCenter().wrap();
        useStore.getState().setView({ lng: c.lng, lat: c.lat, zoom: map.getZoom() });
      }, 400);
    });

    const unsubscribe = useStore.subscribe((s, p) => {
      if (s.selection !== p.selection) renderPin();
      if (s.units.height !== p.units.height) renderBuoys();
      if (s.favorites !== p.favorites) renderFavorites();
      if (s.show !== p.show) renderVisibility();
      if (s.animate !== p.animate) applyAnimate();
    });
    renderPin();

    const resize = new ResizeObserver(() => map.resize());
    resize.observe(el);

    return () => {
      disposed = true;
      unsubscribe();
      resize.disconnect();
      reduced.removeEventListener('change', applyAnimate);
      clearTimeout(viewTimer);
      cancelAnimationFrame(hoverFrame);
      cancelPlaces();
      controller.destroy();
      controllerRef.current = null;
      readyRef.current = false;
      mapApi.detach(map);
      pin.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      applyMapTheme(map, theme);
      setMarkerTheme(map, theme);
      addIcons(map, canvasColor(accentColor()));
      controllerRef.current?.setDark(theme === 'dark');
    };
    // isStyleLoaded() redevient faux à chaque chargement de tuiles : on ne s'y fie pas.
    if (readyRef.current) apply();
    else map.once('load', apply);
  }, [theme]);

  // MapLibre impose sa propre position au conteneur : l'hôte porte la mise en page.
  return (
    <div className="map-host">
      <div ref={container} className="map" role="application" aria-label="Carte des prévisions" data-field-status={status} />
      {createPortal(<SelectionRose />, pinEl)}
    </div>
  );
}
