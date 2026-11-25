/**
 * Fond de carte : tuiles vectorielles OpenStreetMap servies par OpenFreeMap
 * (schéma OpenMapTiles), avec un style volontairement dépouillé pour laisser la
 * place au champ météo. La terre n'est pas dessinée : c'est le fond de la page
 * qui en tient lieu (voir FieldLayer).
 */
import type { ExpressionSpecification, LayerSpecification, Map as MlMap, StyleSpecification } from 'maplibre-gl';

export type ThemeName = 'light' | 'dark';

interface MapColors {
  land: string;
  ocean: string;
  inlandWater: string;
  coast: string;
  border: string;
  regionBorder: string;
  road: string;
  label: string;
  labelMuted: string;
  halo: string;
}

export const MAP_COLORS: Record<ThemeName, MapColors> = {
  dark: {
    land: '#17191c',
    ocean: '#0c1014',
    inlandWater: 'rgba(10, 14, 18, 0.5)',
    coast: 'rgba(255, 255, 255, 0.3)',
    border: 'rgba(255, 255, 255, 0.26)',
    regionBorder: 'rgba(255, 255, 255, 0.1)',
    road: 'rgba(255, 255, 255, 0.14)',
    label: '#eef1f4',
    labelMuted: '#b3bbc4',
    halo: 'rgba(8, 10, 12, 0.78)',
  },
  light: {
    land: '#eef0f2',
    ocean: '#d3dce4',
    inlandWater: 'rgba(176, 196, 212, 0.65)',
    coast: 'rgba(18, 26, 36, 0.5)',
    border: 'rgba(18, 26, 36, 0.4)',
    regionBorder: 'rgba(18, 26, 36, 0.16)',
    road: 'rgba(18, 26, 36, 0.18)',
    label: '#12161b',
    labelMuted: '#414a54',
    halo: 'rgba(255, 255, 255, 0.88)',
  },
};

const POLYGON: ExpressionSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const LINE: ExpressionSpecification = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const NAME: ExpressionSpecification = ['coalesce', ['get', 'name:fr'], ['get', 'name:latin'], ['get', 'name']];
const REGULAR = ['Noto Sans Regular'];
const BOLD = ['Noto Sans Bold'];
const ITALIC = ['Noto Sans Italic'];

/** Identifiant de la couche au-dessus de laquelle s'insère le champ météo. */
export const FIELD_BEFORE = 'water-inland';
/** Les repères (spots, bouées…) se placent sous les noms de lieux. */
export const MARKERS_BEFORE = 'place-village';

function layers(c: MapColors): LayerSpecification[] {
  const place = (
    id: string,
    filter: ExpressionSpecification,
    minzoom: number,
    size: ExpressionSpecification | number,
    font: string[],
    color: string,
    extra: Record<string, unknown> = {},
  ): LayerSpecification => ({
    id,
    type: 'symbol',
    source: 'osm',
    'source-layer': 'place',
    minzoom,
    filter,
    layout: {
      'text-field': NAME,
      'text-font': font,
      'text-size': size,
      'text-max-width': 8,
      'text-padding': 6,
      ...extra,
    },
    paint: { 'text-color': color, 'text-halo-color': c.halo, 'text-halo-width': 1.3, 'text-halo-blur': 0.4 },
  });

  const road = (id: string, classes: string[], minzoom: number, width: ExpressionSpecification): LayerSpecification => ({
    id,
    type: 'line',
    source: 'osm',
    'source-layer': 'transportation',
    minzoom,
    filter: ['all', LINE, ['match', ['get', 'class'], classes, true, false], ['!=', ['get', 'brunnel'], 'tunnel']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.road, 'line-width': width },
  });

  return [
    {
      id: 'ocean',
      type: 'fill',
      source: 'osm',
      'source-layer': 'water',
      filter: ['all', POLYGON, ['==', ['get', 'class'], 'ocean']],
      paint: { 'fill-color': c.ocean },
    },
    {
      id: FIELD_BEFORE,
      type: 'fill',
      source: 'osm',
      'source-layer': 'water',
      minzoom: 4,
      filter: ['all', POLYGON, ['!=', ['get', 'class'], 'ocean'], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'fill-color': c.inlandWater },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'osm',
      'source-layer': 'waterway',
      minzoom: 9,
      filter: ['all', LINE, ['match', ['get', 'class'], ['river', 'canal'], true, false]],
      paint: { 'line-color': c.inlandWater, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 14, 2.4] },
    },
    {
      id: 'coast',
      type: 'line',
      source: 'osm',
      'source-layer': 'water',
      filter: ['all', POLYGON, ['==', ['get', 'class'], 'ocean']],
      paint: { 'line-color': c.coast, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 8, 0.9, 13, 1.2] },
    },
    road('road-street', ['minor', 'service'], 12.5, ['interpolate', ['linear'], ['zoom'], 12.5, 0.4, 15, 1.6]),
    road('road-minor', ['secondary', 'tertiary'], 10, ['interpolate', ['linear'], ['zoom'], 10, 0.5, 15, 2.2]),
    road('road-major', ['motorway', 'trunk', 'primary'], 7, ['interpolate', ['linear'], ['zoom'], 7, 0.5, 15, 3]),
    {
      id: 'boundary-region',
      type: 'line',
      source: 'osm',
      'source-layer': 'boundary',
      minzoom: 5,
      filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': c.regionBorder, 'line-width': 0.8, 'line-dasharray': [3, 2] },
    },
    {
      id: 'boundary-country',
      type: 'line',
      source: 'osm',
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': c.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 8, 1.2] },
    },
    {
      id: 'water-name',
      type: 'symbol',
      source: 'osm',
      'source-layer': 'water_name',
      filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
      layout: {
        'text-field': NAME,
        'text-font': ITALIC,
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 11, 8, 14],
        'text-letter-spacing': 0.08,
        'text-max-width': 6,
      },
      paint: { 'text-color': c.labelMuted, 'text-halo-color': c.halo, 'text-halo-width': 1.2, 'text-opacity': 0.85 },
    },
    place(MARKERS_BEFORE, ['==', ['get', 'class'], 'village'], 10.5, ['interpolate', ['linear'], ['zoom'], 10, 11, 14, 13], REGULAR, c.labelMuted),
    place('place-town', ['==', ['get', 'class'], 'town'], 7.5, ['interpolate', ['linear'], ['zoom'], 7, 11, 13, 15], REGULAR, c.label),
    place(
      'place-city',
      ['==', ['get', 'class'], 'city'],
      3.5,
      ['interpolate', ['linear'], ['zoom'], 3, 11, 8, 14, 13, 18],
      BOLD,
      c.label,
      { 'symbol-sort-key': ['get', 'rank'] },
    ),
    place(
      'place-country',
      ['==', ['get', 'class'], 'country'],
      1,
      ['interpolate', ['linear'], ['zoom'], 1, 10, 6, 15],
      BOLD,
      c.label,
      { 'text-transform': 'uppercase', 'text-letter-spacing': 0.1, 'symbol-sort-key': ['get', 'rank'] },
    ),
  ] as LayerSpecification[];
}

export function buildStyle(theme: ThemeName): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      osm: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
        attribution: '© OpenStreetMap · OpenFreeMap',
      },
    },
    layers: layers(MAP_COLORS[theme]),
  };
}

/** Change les couleurs du fond sans recharger le style (les couches ajoutées restent en place). */
export function applyMapTheme(map: MlMap, theme: ThemeName): void {
  for (const layer of layers(MAP_COLORS[theme])) {
    if (!map.getLayer(layer.id) || !('paint' in layer) || !layer.paint) continue;
    for (const [prop, value] of Object.entries(layer.paint)) {
      if (prop.endsWith('-color')) map.setPaintProperty(layer.id, prop as 'fill-color', value as string);
    }
  }
}
