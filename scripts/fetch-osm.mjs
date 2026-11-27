// Télécharge les spots (surf, kite, windsurf) et les webcams côtières depuis
// OpenStreetMap (serveur Postpass de Geofabrik) et les écrit dans public/data/.
// Les objets de scripts/spots-exclus.json, étiquetés comme des spots mais qui sont des
// commerces (écoles, boutiques, loueurs, campings), sont retirés. Les nouveaux noms qui
// ressemblent à un commerce sont affichés, sans être retirés, pour compléter cette liste.
// Usage : npm run data:spots
// Le masque terre/mer se lit dans le service des grilles de l'appli : le processus local par défaut
// (`npm --prefix server run dev:grids`), ou l'appli en ligne avec GRIDS_URL=<son adresse>.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ENDPOINT = 'https://postpass.geofabrik.de/api/interpreter';
/** Où se lisent les grilles (`/grilles/…`), sans barre finale. */
const GRIDS_URL = (process.env.GRIDS_URL ?? 'http://localhost:8789').replace(/\/+$/, '');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, '..', 'public', 'data');
const EXCLUDED_FILE = path.join(HERE, 'spots-exclus.json');

/** Les identifiants OSM à retirer des spots : type (N, W ou R) puis numéro, comme dans spots.json. */
async function loadExcluded() {
  const ids = JSON.parse(await readFile(EXCLUDED_FILE, 'utf8'));
  const bad = Array.isArray(ids) ? ids.filter((id) => typeof id !== 'string' || !/^[NWR]\d+$/.test(id)) : null;
  if (!bad || bad.length > 0) throw new Error(`scripts/spots-exclus.json doit être une liste d'identifiants OSM (N123, W123, R123)${bad ? ` : ${JSON.stringify(bad)}` : ''}`);
  return new Set(ids);
}

/** Les spots du fichier en place, avant qu'il soit remplacé : identifiant -> nom. Vide s'il n'y en a pas encore. */
async function loadPrevious() {
  try {
    const file = JSON.parse(await readFile(path.join(OUT_DIR, 'spots.json'), 'utf8'));
    return new Map(file.rows.map((row) => [row[0], row[1]]));
  } catch {
    return new Map();
  }
}

async function sql(query, timeoutMs = 240_000) {
  const url = `${ENDPOINT}?${new URLSearchParams({ 'options[geojson]': 'false', data: query })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Postpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).result;
}

const POINT = `ST_X(ST_PointOnSurface(geom)) AS lon, ST_Y(ST_PointOnSurface(geom)) AS lat`;
const round = (n) => Math.round(n * 1e5) / 1e5;

/** Sports recherchés : valeur OSM exacte -> identifiant interne. */
const SPORTS = {
  surfing: 'surf',
  kitesurfing: 'kite',
  windsurfing: 'windsurf',
  'surfing;kitesurfing': 'surf,kite',
  'kitesurfing;surfing': 'surf,kite',
  'surfing;windsurfing': 'surf,windsurf',
  'windsurfing;surfing': 'surf,windsurf',
  'kitesurfing;windsurfing': 'kite,windsurf',
  'windsurfing;kitesurfing': 'kite,windsurf',
  'surfing;kitesurfing;windsurfing': 'surf,kite,windsurf',
  'surfing;windsurfing;kitesurfing': 'surf,kite,windsurf',
};

/** Clés OSM qui signalent un commerce, une école ou un club plutôt qu'un spot. */
const NOT_A_SPOT_KEYS = ['shop', 'amenity', 'office', 'club', 'craft', 'tourism', 'building', 'landuse', 'healthcare'];
const NOT_A_SPOT_LEISURE = new Set(['sports_centre', 'sports_hall', 'fitness_centre', 'water_park', 'swimming_pool', 'resort', 'marina']);

function isSpot(tags) {
  if (NOT_A_SPOT_KEYS.some((k) => k in tags)) return false;
  if (NOT_A_SPOT_LEISURE.has(tags.leisure)) return false;
  return true;
}

const LATIN = /\p{Script=Latin}/u;
/** Pour un nom sans aucune lettre latine : les noms de repli d'OSM, dans l'ordre. */
const LATIN_NAMES = ['name:en', 'name:ja-Latn', 'name:ja_rm', 'name:zh-Latn'];

/**
 * Le nom d'un spot : son nom français, sinon son nom local. Un nom sans aucune lettre latine
 * (« 玉石 ») prend le premier nom de repli qui existe ; sinon il reste tel quel.
 */
function spotName(tags) {
  const name = (tags['name:fr'] || tags.name || '').trim();
  if (!name || LATIN.test(name)) return name;
  for (const key of LATIN_NAMES) {
    const other = (tags[key] || '').trim();
    if (other && LATIN.test(other)) return other;
  }
  return name;
}

/** Mots qui font penser à un commerce plutôt qu'à un spot. Rien n'est retiré d'après eux : le script signale. */
const SHOP_WORDS = ['école', 'school', 'surf shop', 'rental', 'lessons', 'camp', 'camping', 'club', 'center', 'centre', 'snowkite'];
/** Sans accents ni majuscules : « Ecole » vaut « école ». */
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const SHOP_FOLDED = SHOP_WORDS.map(fold);
// En n'importe quel endroit du nom : « Surfschool » et « Surfcamp » comptent aussi.
const looksLikeShop = (name) => SHOP_FOLDED.some((word) => fold(name).includes(word));

/** Même lieu : même nom, dans la même maille d'environ 300 m. */
const cell = (v) => Math.round(v / 0.003);
const placeKey = (name, lon, lat) => `${name.toLowerCase()}|${cell(lon)}|${cell(lat)}`;

const OSM_TYPES = { N: 'node', W: 'way', R: 'relation' };
const describe = (s) => `  ${s[0].padEnd(13)} ${s[1]}  (${s[3]}, ${s[2]})  https://www.openstreetmap.org/${OSM_TYPES[s[0][0]]}/${s[0].slice(1)}`;

async function fetchSpots(nearSea, excluded, previous) {
  const byKey = new Map();
  for (const [osmValue, kinds] of Object.entries(SPORTS)) {
    const rows = await sql(
      `SELECT osm_type, osm_id, tags, ${POINT}
       FROM postpass_pointpolygon WHERE tags @> '${JSON.stringify({ sport: osmValue })}'`,
    );
    let kept = 0;
    for (const r of rows) {
      if (!Number.isFinite(r.lon) || !Number.isFinite(r.lat)) continue;
      const tags = r.tags || {};
      const name = spotName(tags);
      // Sans nom, un spot n'est ni cherchable ni identifiable : on ne le garde pas.
      if (!name || !isSpot(tags)) continue;
      // Le surf en rivière ou en piscine à vagues n'a pas de prévision de houle.
      // « kinds » est une liste séparée par des virgules : « windsurf » ne doit pas compter pour du surf.
      if (kinds.split(',').includes('surf') && !nearSea(r.lon, r.lat)) continue;
      const key = `${r.osm_type}${r.osm_id}`;
      if (!byKey.has(key)) byKey.set(key, [key, name, round(r.lon), round(r.lat), kinds]);
      kept++;
    }
    console.log(`sport=${osmValue}: ${rows.length} objets, ${kept} spots gardés`);
  }
  const all = [...byKey.values()];

  // Les commerces de la liste s'en vont, avec leurs doublons (le même commerce en nœud et en polygone).
  const excludedPlaces = new Set(all.filter((s) => excluded.has(s[0])).map((s) => placeKey(s[1], s[2], s[3])));
  const spots = dedupe(all.filter((s) => !excluded.has(s[0]) && !excludedPlaces.has(placeKey(s[1], s[2], s[3]))));
  const found = all.filter((s) => excluded.has(s[0])).length;
  console.log(`commerces retirés (scripts/spots-exclus.json) : ${found} sur ${excluded.size}${found < excluded.size ? ' ; les autres ne figurent plus parmi les spots lus dans OSM' : ''}`);

  // Ce qui est nouveau, par son identifiant ou par son nom, et ressemble à un commerce : à vérifier à la main.
  const suspects = spots.filter((s) => previous.get(s[0]) !== s[1] && looksLikeShop(s[1]));
  if (suspects.length > 0) {
    console.log(`\nNouveaux noms qui ressemblent à un commerce (${suspects.length}). Ils sont gardés : ajoutez à scripts/spots-exclus.json ceux qui en sont.`);
    for (const s of suspects) console.log(describe(s));
    console.log('');
  }
  return spots;
}

/** Fusionne les doublons (même nom à moins de ~300 m, souvent un nœud + un polygone). */
function dedupe(spots) {
  const seen = new Map();
  const out = [];
  for (const s of spots) {
    const k = placeKey(s[1], s[2], s[3]);
    const prev = seen.get(k);
    if (prev) {
      prev[4] = [...new Set([...prev[4].split(','), ...s[4].split(',')])].join(',');
      continue;
    }
    seen.set(k, s);
    out.push(s);
  }
  return out;
}

/** Plages nommées en bord de mer : autant de points de prévision cherchables. */
async function fetchBeaches(nearSea, spots) {
  const rows = await sql(
    `SELECT osm_type, osm_id, tags->>'name' AS name, tags->>'name:fr' AS name_fr, ${POINT}
     FROM postpass_pointpolygon WHERE tags @> '{"natural":"beach"}' AND tags ? 'name'`,
  );
  console.log(`plages nommées (monde): ${rows.length}`);
  const taken = new Set(spots.map((s) => placeKey(s[1], s[2], s[3])));
  const out = [];
  for (const r of rows) {
    if (!Number.isFinite(r.lon) || !Number.isFinite(r.lat)) continue;
    const name = (r.name_fr || r.name || '').trim();
    if (!name || name.length > 60 || !nearSea(r.lon, r.lat)) continue;
    const k = placeKey(name, r.lon, r.lat);
    if (taken.has(k)) continue;
    taken.add(k);
    out.push([`${r.osm_type}${r.osm_id}`, name, round(r.lon), round(r.lat)]);
  }
  return out;
}

/**
 * Masque terre/mer tiré du modèle de vagues MFWAM (grille 1/12°) : une cellule
 * est « en mer » si le modèle y donne une hauteur de vagues.
 *
 * Il se lit dans les blocs que prépare le service des grilles de l'appli (`/grilles/…`,
 * voir `server/src/grids/`), au niveau 0 : la grille native. Dans un bloc, le code 65535
 * veut dire « pas de donnée ».
 */
async function loadSeaMask() {
  // La grille de `meteofrance_wave` (`DOMAINS` de src/data/catalog.ts) et le côté d'un bloc.
  const nx = 4320;
  const ny = 2041;
  const lonMin = -180 + 1 / 24;
  const latMin = -80 + 1 / 24;
  const BLOCK = 256;
  const base = `${GRIDS_URL}/grilles/meteofrance_wave`;

  let meta;
  try {
    const res = await fetch(`${base}/latest.json`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`réponse ${res.status}`);
    meta = await res.json();
  } catch (err) {
    throw new Error(
      `Le service des grilles ne répond pas à ${GRIDS_URL} (${err.message}). Lancer « npm --prefix server run dev:grids », ou donner l'adresse de l'appli en ligne : GRIDS_URL=https://…`,
    );
  }
  const p = (n) => String(n).padStart(2, '0');
  const ref = new Date(meta.reference_time);
  const valid = new Date(meta.valid_times[0].replace(/Z$/, ':00Z'));
  const run = `${ref.getUTCFullYear()}/${p(ref.getUTCMonth() + 1)}/${p(ref.getUTCDate())}/${p(ref.getUTCHours())}${p(ref.getUTCMinutes())}Z`;
  const file = `${valid.getUTCFullYear()}-${p(valid.getUTCMonth() + 1)}-${p(valid.getUTCDate())}T${p(valid.getUTCHours())}${p(valid.getUTCMinutes())}`;

  /** 1 là où le modèle donne une hauteur de vagues. */
  const sea = new Uint8Array(nx * ny);
  const blocks = [];
  for (let by = 0; by * BLOCK < ny; by++) for (let bx = 0; bx * BLOCK < nx; bx++) blocks.push({ by, bx });
  let next = 0;
  const worker = async () => {
    while (next < blocks.length) {
      const { by, bx } = blocks[next++];
      // Le serveur prépare un bloc du niveau 0 à sa première demande : la première fois, c'est plus long.
      const res = await fetch(`${base}/${run}/${file}/wave_height/0/${by}-${bx}.bin`, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`Bloc ${by}-${bx} du masque terre/mer indisponible (${res.status})`);
      const view = new DataView(await res.arrayBuffer());
      const w = Math.min(BLOCK, nx - bx * BLOCK);
      const h = Math.min(BLOCK, ny - by * BLOCK);
      // « AWG1 », la largeur et la hauteur, puis w × h codes de 16 bits, chaque ligne en différences.
      if (view.byteLength !== 16 + w * h * 2 || view.getUint32(0) !== 0x41574731 || view.getUint16(4, true) !== w || view.getUint16(6, true) !== h) {
        throw new Error(`Bloc ${by}-${bx} du masque terre/mer illisible`);
      }
      let at = 16;
      for (let r = 0; r < h; r++) {
        let code = 0;
        const row = (by * BLOCK + r) * nx + bx * BLOCK;
        for (let c = 0; c < w; c++) {
          code = (code + view.getUint16(at, true)) & 0xffff;
          at += 2;
          if (code !== 65535) sea[row + c] = 1;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  /** Vrai si une cellule de mer se trouve à ±1 cellule (≈ 10 km) du point. */
  return (lon, lat) => {
    const cx = Math.round((lon - lonMin) * 12);
    const cy = Math.round((lat - latMin) * 12);
    for (let dy = -1; dy <= 1; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= ny) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const x = (((cx + dx) % nx) + nx) % nx;
        if (sea[y * nx + x] === 1) return true;
      }
    }
    return false;
  };
}

/** Une adresse qui s'ouvre dans le navigateur, en http: ou https:, rien d'autre (ni javascript:, ni data:). */
function isWebUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

async function fetchWebcams(nearSea) {
  const rows = await sql(
    `SELECT osm_type, osm_id, tags->>'name' AS name, tags->>'contact:webcam' AS url, ${POINT}
     FROM postpass_pointpolygon WHERE tags ? 'contact:webcam'`,
  );
  console.log(`webcams (monde): ${rows.length}`);
  const out = [];
  for (const r of rows) {
    const url = (r.url || '').split(';')[0].trim();
    // L'adresse devient un lien dans l'appli : seulement en http: ou https:.
    if (!isWebUrl(url) || !Number.isFinite(r.lon) || !Number.isFinite(r.lat)) continue;
    if (!nearSea(r.lon, r.lat)) continue;
    out.push([`${r.osm_type}${r.osm_id}`, (r.name || '').trim(), round(r.lon), round(r.lat), url]);
  }
  return out;
}

await mkdir(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
// La liste et le fichier en place se lisent d'abord : une liste mal écrite arrête tout avant le premier appel.
const excluded = await loadExcluded();
const previous = await loadPrevious();

const nearSea = await loadSeaMask();

const spots = await fetchSpots(nearSea, excluded, previous);
await writeFile(
  path.join(OUT_DIR, 'spots.json'),
  JSON.stringify({ source: 'OpenStreetMap (ODbL)', updated: stamp, fields: ['id', 'name', 'lon', 'lat', 'kinds'], rows: spots }),
);
console.log(`spots.json: ${spots.length} spots${previous.size > 0 ? ` (${previous.size} avant)` : ''}`);

try {
  const beaches = await fetchBeaches(nearSea, spots);
  await writeFile(
    path.join(OUT_DIR, 'beaches.json'),
    JSON.stringify({ source: 'OpenStreetMap (ODbL)', updated: stamp, fields: ['id', 'name', 'lon', 'lat'], rows: beaches }),
  );
  console.log(`beaches.json: ${beaches.length} plages`);
} catch (err) {
  console.error('Plages non récupérées :', err.message);
  process.exitCode = 1;
}

try {
  const cams = await fetchWebcams(nearSea);
  await writeFile(
    path.join(OUT_DIR, 'webcams.json'),
    JSON.stringify({ source: 'OpenStreetMap (ODbL)', updated: stamp, fields: ['id', 'name', 'lon', 'lat', 'url'], rows: cams }),
  );
  console.log(`webcams.json: ${cams.length} webcams`);
} catch (err) {
  console.error('Webcams non récupérées :', err.message);
  process.exitCode = 1;
}
