/**
 * Données publiques pour la vitrine, écrites dans `public/data/` à chaque `npm run build` :
 *
 * - `models.json` : chaque modèle (nom, fournisseur, résolution, couverture, échéance, mises à jour) ;
 * - `palettes.json` : chaque palette de données (bornes, graduations, points de couleur, et
 *   une échelle de couleurs prête à l'emploi) ;
 * - `site.json` : le nombre de couches, de modèles, de spots, de plages et de webcams.
 *
 * Tout vient de `src/data/catalog.ts` et de `src/data/palettes.ts`, qui restent la source
 * unique : ce script les charge par Vite, tels que l'appli les lit, et n'y ajoute rien. La
 * vitrine télécharge ces fichiers depuis l'appli en ligne (`<APP_URL>/data/…`). Le résultat
 * ne dépend ni de la date ni de la machine : relancer le script sans rien changer ne change
 * aucun fichier.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = new URL('../public/data/', import.meta.url);

/** Unité SI de chaque palette : celle des données, avant toute conversion à l'affichage. */
const UNITS = { height: 'm', wind: 'm/s', period: 's', rain: 'mm/h', clouds: '%', temp: '°C', current: 'm/s' };
/** Couleurs de l'échelle publiée, réparties de la borne basse à la borne haute. */
const SCALE_STEPS = 64;

const fail = (message) => {
  throw new Error(`[public-data] ${message}`);
};

/** « 0,08° · 9 km » : le pas de la grille en degrés et en kilomètres. */
function resolutionOf(model) {
  const match = /^(\d+(?:,\d+)?)° · (\d+(?:,\d+)?) km$/.exec(model.resolution);
  if (!match) fail(`résolution illisible pour ${model.id} : « ${model.resolution} »`);
  return { degrees: Number(match[1].replace(',', '.')), km: Number(match[2].replace(',', '.')) };
}

/** « 10 j · 3 h » ou « 1 à 5 j · 1 h » : la portée en jours (la plus longue, et la plus courte si elle varie) et le pas de temps en heures. */
function horizonOf(model) {
  const match = /^(?:(\d+) à )?(\d+) j · (\d+) h$/.exec(model.horizon);
  if (!match) fail(`échéance illisible pour ${model.id} : « ${model.horizon} »`);
  return { days: Number(match[2]), ...(match[1] ? { daysMin: Number(match[1]) } : {}), stepHours: Number(match[3]) };
}

const KINDS = { wave: 'Vagues', atmo: 'Atmosphère', ocean: 'Courants' };

function modelsOf(catalog) {
  return catalog.MODELS.map((model) => {
    if (!Number.isInteger(model.updateHours) || model.updateHours <= 0) fail(`mises à jour inconnues pour ${model.id}`);
    const resolution = resolutionOf(model);
    const horizon = horizonOf(model);
    return {
      id: model.id,
      /** `wave` (vagues), `atmo` (vent, pluie, température) ou `ocean` (courants). */
      kind: model.kind,
      kindLabel: KINDS[model.kind] ?? fail(`famille inconnue pour ${model.id}`),
      name: model.label,
      provider: model.provider,
      /** Le modèle affiché par défaut dans sa famille. */
      default: catalog.DEFAULT_MODELS[model.kind] === model.id,
      /** Tel que l'appli l'écrit, en français, puis en nombres pour l'écrire dans une autre langue. */
      resolution: model.resolution,
      resolutionDegrees: resolution.degrees,
      resolutionKm: resolution.km,
      /** `Monde`, ou la zone d'un modèle régional. */
      coverage: model.region ?? 'Monde',
      global: !model.region,
      horizon: model.horizon,
      horizonDays: horizon.days,
      ...(horizon.daysMin ? { horizonDaysMin: horizon.daysMin } : {}),
      stepHours: horizon.stepHours,
      /** Heures entre deux mises à jour. */
      updateHours: model.updateHours,
    };
  });
}

const hex = (n) => n.toString(16).padStart(2, '0');
const css = ([r, g, b, a]) => (a >= 0.999 ? `#${hex(r)}${hex(g)}${hex(b)}` : `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`);

/** L'échelle d'une palette : ses couleurs de la borne basse à la borne haute, et l'encre lisible sur chacune. */
function scaleOf(palettes, id, dark) {
  const palette = palettes.getPalette(id, dark);
  const colors = [];
  const inks = [];
  for (let i = 0; i <= SCALE_STEPS; i++) {
    const value = palette.min + ((palette.max - palette.min) * i) / SCALE_STEPS;
    colors.push(css(palettes.paletteColor(palette, value)));
    inks.push(palettes.cellColors(palette, value).color);
  }
  return { colors, inks };
}

function palettesOf(palettes) {
  const out = {};
  for (const id of palettes.PALETTE_IDS) {
    const palette = palettes.getPalette(id, false);
    const light = scaleOf(palettes, id, false);
    const dark = scaleOf(palettes, id, true);
    const same = JSON.stringify(light) === JSON.stringify(dark);
    out[id] = {
      unit: UNITS[id] ?? fail(`unité inconnue pour la palette ${id}`),
      min: palette.min,
      max: palette.max,
      /** Graduations de la légende. */
      ticks: palette.ticks,
      /** Les points de couleur de la palette : `[valeur, couleur]`, ou `[valeur, couleur, opacité]`. */
      stops: palettes.paletteStops(id, false),
      /**
       * La palette telle que l'appli la dessine (interpolation en OKLab), en `SCALE_STEPS + 1`
       * couleurs réparties de `min` à `max` : la couleur d'une valeur est celle du rang
       * `round((valeur − min) / (max − min) × SCALE_STEPS)`, borné. `inks` : l'encre lisible dessus.
       */
      scale: light.colors,
      inks: light.inks,
      // Seule la palette des nuages change avec le thème.
      ...(same ? {} : { stopsDark: palettes.paletteStops(id, true), scaleDark: dark.colors, inksDark: dark.inks }),
    };
  }
  return out;
}

async function countOf(name) {
  const file = JSON.parse(await readFile(new URL(`${name}.json`, dataDir), 'utf8'));
  if (!Array.isArray(file.rows)) fail(`${name}.json n'a pas de lignes`);
  return file.rows.length;
}

/** Une valeur par ligne pour les objets, les tableaux de valeurs simples sur une seule : lisible, et stable dans git. */
function format(value, indent = '') {
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== 'object' || (Array.isArray(v) && v.every((w) => typeof w !== 'object')))) return JSON.stringify(value);
    return `[\n${value.map((v) => `${indent}  ${format(v, `${indent}  `)}`).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return `{\n${entries.map(([k, v]) => `${indent}  ${JSON.stringify(k)}: ${format(v, `${indent}  `)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** N'écrit que ce qui change : un build ne touche pas un fichier resté le même. */
async function write(name, value) {
  const url = new URL(name, dataDir);
  const next = `${format(value)}\n`;
  const previous = await readFile(url, 'utf8').catch(() => null);
  if (previous !== next) await writeFile(url, next);
  console.log(`[public-data] public/data/${name} ${previous === next ? 'inchangé' : 'écrit'}`);
}

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const catalog = await server.ssrLoadModule('/src/data/catalog.ts');
  const palettes = await server.ssrLoadModule('/src/data/palettes.ts');
  const models = modelsOf(catalog);
  await write('models.json', { source: 'Open-Meteo', models });
  await write('palettes.json', { steps: SCALE_STEPS, palettes: palettesOf(palettes) });
  await write('site.json', {
    layers: catalog.LAYERS.length,
    models: models.length,
    spots: await countOf('spots'),
    beaches: await countOf('beaches'),
    webcams: await countOf('webcams'),
  });
} finally {
  await server.close();
}
