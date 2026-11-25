// Calcule les secteurs de terre de chaque spot et de chaque plage de public/data/ :
// les directions d'où souffle un vent de terre. Sur 16 directions, un secteur est
// « de terre » si l'on rencontre la terre à moins de 2 km du point dans cette
// direction (polygones de terre simplifiés d'OpenStreetMap, licence ODbL). Pour un
// lieu posé sur le sable, on regarde depuis le bord de l'eau le plus proche.
// Le résultat s'ajoute aux fichiers de lieux : champ « off », masque de 16 bits
// (bit i = secteur centré sur l'azimut i × 22,5°, 0 = nord, 4 = est, 8 = sud,
// 12 = ouest ; 0 = orientation inconnue).
// Les polygones sont téléchargés une fois dans node_modules/.cache/aywhoula-orientation/ :
// supprimer ce dossier pour les reprendre à neuf.
// Usage : npm run data:orientation (après npm run data:spots)
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LAND_URL = 'https://osmdata.openstreetmap.de/download/simplified-land-polygons-complete-3857.zip';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const CACHE_DIR = path.join(ROOT, 'node_modules', '.cache', 'aywhoula-orientation');
const FILES = ['spots.json', 'beaches.json'];

const SECTORS = 16;
/** Le rayon de chaque secteur est échantillonné tous les 250 m, jusqu'à 2 km. */
const STEP_M = 250;
const REACH_M = 2000;

// Web Mercator (EPSG:3857), la projection du fichier de polygones.
const RAD = Math.PI / 180;
const EARTH_R = 6378137;
const HALF_WORLD = Math.PI * EARTH_R;
const mercX = (lon) => EARTH_R * lon * RAD;
const mercY = (lat) => EARTH_R * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));

/** Hauteur des bandes horizontales de l'index d'arêtes, en unités Mercator. */
const BAND_M = 1000;
const BAND_COUNT = Math.ceil((2 * HALF_WORLD) / BAND_M);
const bandOf = (y) => Math.floor((y + HALF_WORLD) / BAND_M);

async function loadLandZip() {
  const file = path.join(CACHE_DIR, path.basename(LAND_URL));
  if (existsSync(file)) {
    console.log('polygones de terre : repris du cache');
    return readFile(file);
  }
  console.log('polygones de terre : téléchargement (environ 25 Mo)…');
  const res = await fetch(LAND_URL, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok) throw new Error(`osmdata ${res.status} : ${LAND_URL}`);
  const zip = Buffer.from(await res.arrayBuffer());
  await mkdir(CACHE_DIR, { recursive: true });
  // Écrit sous un nom provisoire : une écriture interrompue ne laisse pas de cache tronqué.
  await writeFile(`${file}.part`, zip);
  await rename(`${file}.part`, file);
  return zip;
}

/** Extrait d'une archive zip le fichier dont le nom finit par `suffix`. */
function unzipEntry(zip, suffix) {
  // La fin du répertoire central se cherche depuis la fin : un commentaire peut la suivre.
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Archive zip illisible : répertoire central introuvable');
  const count = zip.readUInt16LE(eocd + 10);
  let pos = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) throw new Error('Archive zip illisible : entrée invalide');
    const method = zip.readUInt16LE(pos + 10);
    const size = zip.readUInt32LE(pos + 20);
    const nameLen = zip.readUInt16LE(pos + 28);
    const local = zip.readUInt32LE(pos + 42);
    const name = zip.toString('utf8', pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + zip.readUInt16LE(pos + 30) + zip.readUInt16LE(pos + 32);
    if (!name.endsWith(suffix)) continue;
    // L'en-tête local a ses propres longueurs de nom et de champ supplémentaire.
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + size);
    if (method === 0) return raw;
    if (method === 8) return inflateRawSync(raw);
    throw new Error(`Archive zip : méthode de compression ${method} non gérée`);
  }
  throw new Error(`Archive zip : aucun fichier ${suffix}`);
}

/**
 * Parcourt les arêtes des polygones d'un fichier .shp (type 5) et renvoie le
 * nombre de polygones. Les anneaux d'un shapefile sont fermés : les paires de
 * points consécutifs donnent toutes les arêtes.
 */
function forEachEdge(shp, visit) {
  const view = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  if (view.getInt32(0) !== 9994) throw new Error('Fichier .shp illisible');
  const type = view.getInt32(32, true);
  if (type !== 5) throw new Error(`Fichier .shp : type de forme ${type}, polygones (5) attendus`);
  let polygons = 0;
  let pos = 100;
  while (pos + 8 <= shp.length) {
    // En-tête d'enregistrement en gros-boutiste, longueur en mots de 16 bits ; le contenu est en petit-boutiste.
    const rec = pos + 8;
    pos = rec + view.getInt32(pos + 4) * 2;
    if (view.getInt32(rec, true) !== 5) continue;
    polygons++;
    const numParts = view.getInt32(rec + 36, true);
    const numPoints = view.getInt32(rec + 40, true);
    const parts = rec + 44;
    const points = parts + 4 * numParts;
    for (let p = 0; p < numParts; p++) {
      const from = view.getInt32(parts + 4 * p, true);
      const to = p + 1 < numParts ? view.getInt32(parts + 4 * (p + 1), true) : numPoints;
      let x1 = view.getFloat64(points + 16 * from, true);
      let y1 = view.getFloat64(points + 16 * from + 8, true);
      for (let i = from + 1; i < to; i++) {
        const x2 = view.getFloat64(points + 16 * i, true);
        const y2 = view.getFloat64(points + 16 * i + 8, true);
        visit(x1, y1, x2, y2);
        x1 = x2;
        y1 = y2;
      }
    }
  }
  return polygons;
}

/**
 * Range les arêtes par bandes horizontales et renvoie le test « ce point est-il
 * sur la terre ? ». Les polygones de terre ne se recouvrent pas : la règle
 * pair-impair sur toutes les arêtes suffit (rayon horizontal vers l'est).
 * Seules les bandes de `needed` sont remplies, mais elles le sont en entier :
 * le rayon y croise bien toutes les arêtes jusqu'au bout du monde.
 */
function buildLandTest(shp, needed) {
  const eachBand = (y1, y2, fn) => {
    // Une arête horizontale n'est jamais croisée par un rayon horizontal.
    if (y1 === y2) return;
    const last = Math.min(BAND_COUNT - 1, bandOf(Math.max(y1, y2)));
    for (let b = Math.max(0, bandOf(Math.min(y1, y2))); b <= last; b++) if (needed[b]) fn(b);
  };

  // Deux passes : compter les arêtes de chaque bande, puis les ranger à la suite.
  const start = new Uint32Array(BAND_COUNT + 1);
  const polygons = forEachEdge(shp, (x1, y1, x2, y2) => eachBand(y1, y2, (b) => start[b + 1]++));
  for (let b = 0; b < BAND_COUNT; b++) start[b + 1] += start[b];
  const edges = new Float64Array(start[BAND_COUNT] * 4);
  const cursor = start.slice();
  forEachEdge(shp, (x1, y1, x2, y2) =>
    eachBand(y1, y2, (b) => {
      const k = cursor[b]++ * 4;
      edges[k] = x1;
      edges[k + 1] = y1;
      edges[k + 2] = x2;
      edges[k + 3] = y2;
    }),
  );
  console.log(`polygones de terre : ${polygons} polygones, ${start[BAND_COUNT]} arêtes rangées par bandes de ${BAND_M} m`);

  return (x, y) => {
    // Au-delà de l'antiméridien, le point repasse de l'autre côté de la carte.
    if (x > HALF_WORLD) x -= 2 * HALF_WORLD;
    else if (x < -HALF_WORLD) x += 2 * HALF_WORLD;
    const b = bandOf(y);
    if (!(b >= 0 && b < BAND_COUNT)) return false;
    let land = false;
    for (let k = start[b] * 4, end = start[b + 1] * 4; k < end; k += 4) {
      const y1 = edges[k + 1];
      const y2 = edges[k + 3];
      if ((y1 > y) === (y2 > y)) continue;
      const x1 = edges[k];
      if (x < x1 + ((y - y1) * (edges[k + 2] - x1)) / (y2 - y1)) land = !land;
    }
    return land;
  };
}

/** Portée du rayon en unités Mercator : 1 m au sol y fait 1 / cos(latitude). */
const reach = (lat, meters) => meters / Math.cos(lat * RAD);

const AZIMUTHS = Array.from({ length: SECTORS }, (_, i) => {
  const az = ((i * 360) / SECTORS) * RAD;
  return [Math.sin(az), Math.cos(az)];
});

/**
 * Le point d'où l'on regarde : le lieu lui-même s'il est en mer, sinon le bord de l'eau le
 * plus proche. Le point d'une plage est en général sur le sable, et le trait de côte
 * simplifié passe souvent un peu au large : vus du sable, presque tous les rayons
 * commenceraient sur la terre, et le vent qui longe la côte passerait pour un vent de terre.
 * On cherche donc la mer autour du lieu, de 250 m en 250 m, on part dans la direction
 * moyenne où elle se trouve, et on avance encore d'un pas pour être franchement dans l'eau.
 * Renvoie `null` s'il n'y a pas de mer à moins de 2 km (lac, lieu dans les terres).
 */
function seaOrigin(isLand, x, y, lat) {
  if (!isLand(x, y)) return [x, y];
  for (let d = STEP_M; d <= REACH_M; d += STEP_M) {
    const r = reach(lat, d);
    let east = 0;
    let north = 0;
    let first = null;
    for (const azimuth of AZIMUTHS) {
      if (isLand(x + r * azimuth[0], y + r * azimuth[1])) continue;
      first ??= azimuth;
      east += azimuth[0];
      north += azimuth[1];
    }
    if (!first) continue;
    // La direction moyenne de la mer ; si elle s'annule (mer des deux côtés d'une flèche de sable), la première trouvée.
    const norm = Math.hypot(east, north);
    const toSea = norm > 0.2 ? [east / norm, north / norm] : first;
    const further = r + reach(lat, STEP_M);
    for (const [dir, dist] of [[toSea, further], [toSea, r], [first, further], [first, r]]) {
      if (!isLand(x + dist * dir[0], y + dist * dir[1])) return [x + dist * dir[0], y + dist * dir[1]];
    }
  }
  return null;
}

/** Masque des secteurs de terre d'un lieu, vus du bord de l'eau ; 0 s'il n'apprend rien. */
function offMask(isLand, lon, lat) {
  const origin = seaOrigin(isLand, mercX(lon), mercY(lat), lat);
  if (!origin) return 0;
  const [x, y] = origin;
  let mask = 0;
  for (let i = 0; i < SECTORS; i++) {
    const [east, north] = AZIMUTHS[i];
    for (let d = STEP_M; d <= REACH_M; d += STEP_M) {
      const r = reach(lat, d);
      if (isLand(x + r * east, y + r * north)) {
        mask |= 1 << i;
        break;
      }
    }
  }
  // Aucune terre (point au large) ou de la terre partout (lac, estuaire encaissé) : orientation inconnue.
  return mask === (1 << SECTORS) - 1 ? 0 : mask;
}

const started = Date.now();

const places = [];
for (const name of FILES) {
  const file = path.join(DATA_DIR, name);
  const doc = JSON.parse(await readFile(file, 'utf8'));
  places.push({ name, file, doc, lon: doc.fields.indexOf('lon'), lat: doc.fields.indexOf('lat') });
}

// Bandes où tombent les points échantillonnés (avec 1 m de marge) : les seules à indexer.
// Le bord de l'eau peut être à 2 km du lieu, plus un pas ; les rayons en partent sur 2 km.
const needed = new Uint8Array(BAND_COUNT);
for (const { doc, lat } of places) {
  for (const row of doc.rows) {
    const y = mercY(row[lat]);
    const r = reach(row[lat], 2 * REACH_M + STEP_M) + 1;
    const last = Math.min(BAND_COUNT - 1, bandOf(y + r));
    for (let b = Math.max(0, bandOf(y - r)); b <= last; b++) needed[b] = 1;
  }
}

const isLand = buildLandTest(unzipEntry(await loadLandZip(), '.shp'), needed);

for (const { name, file, doc, lon, lat } of places) {
  // Relancé sur un fichier qui a déjà le champ, le script remplace la valeur.
  let off = doc.fields.indexOf('off');
  if (off < 0) off = doc.fields.push('off') - 1;
  let known = 0;
  for (const row of doc.rows) {
    row[off] = offMask(isLand, row[lon], row[lat]);
    if (row[off]) known++;
  }
  await writeFile(file, JSON.stringify(doc));
  console.log(`${name}: ${doc.rows.length} lieux, ${known} avec une orientation`);
}

console.log(`terminé en ${((Date.now() - started) / 1000).toFixed(1)} s`);
