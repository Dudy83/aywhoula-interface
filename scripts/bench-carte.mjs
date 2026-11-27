/**
 * Banc de mesure de la carte (`npm run bench:carte`) : ce que coûte, sur un réseau 4G, d'ouvrir
 * la carte, de passer à une autre couche, puis de changer de jour.
 *
 *   npm run bench:carte -- [--url http://localhost:4173] [--passes 3]
 *
 * L'adresse par défaut est celle de `npm run preview` (la version construite). Chromium est piloté
 * par Playwright : service worker bloqué, cache du navigateur vide, réseau 4G simulé par Chrome
 * (`Network.emulateNetworkConditions` : 20 Mbit/s en réception, 5 Mbit/s en émission, 40 ms de
 * latence). Chaque passe repart d'un navigateur neuf.
 *
 * Cinq étapes :
 *   1. l'ouverture, en Vent (couche et vue de départ) ;
 *   2. le passage à Vagues ;
 *   3. le jour suivant : la même heure, 24 heures plus loin, dans le tableau de la barre du bas ;
 *   4. J+3 : la même heure, trois jours après celle de l'ouverture ;
 *   5. l'ouverture en vue monde, en Vent, dans un navigateur neuf lui aussi.
 *
 * Pour chacune : le temps jusqu'à `data-field-status="ready"` sur la carte (depuis le début du
 * chargement de la page pour une ouverture, depuis le clic sinon), puis le nombre de requêtes de
 * grilles et les octets reçus, en-têtes compris. Une version d'avant cet attribut se mesure aussi :
 * le banc lit alors l'écran de démarrage et la pastille de chargement, qui s'éteint quand le champ
 * est là mais reste allumée au moins 0,6 s (assez juste pour des chargements de plusieurs secondes).
 *
 * Sont comptées les adresses sous `/grilles/`, et celles d'`openmeteo.s3.amazonaws.com` pour mesurer
 * une version qui lit encore les fichiers .om. Les octets sont ceux qui passent sur le réseau (corps
 * compressé et en-têtes), pas la taille qu'annonce `Content-Length` : la réponse à un `HEAD` n'a pas
 * de corps. Le préchargement que l'étape déclenche (l'échéance suivante) est compté avec elle : le
 * banc attend que plus aucune requête de grille ne soit en cours avant de passer à la suite.
 *
 * Le tableau du jour (étapes 3 et 4) n'existe qu'avec la prévision d'un point : le banc clique donc
 * un point en mer entre les étapes 1 et 2, hors mesure, et il lui faut l'API (`/api/meteo`, relayée
 * par `npm run preview` vers le port 8787). Sans elle, ces deux étapes ne sont pas mesurées.
 */
import { chromium } from 'playwright';

const FOUR_G = { offline: false, latency: 40, downloadThroughput: (20 * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 };
const VIEWPORT = { width: 1440, height: 900 };
/** Sans requête de grille en cours pendant ce temps, l'étape est finie (préchargement compris). */
const QUIET_MS = 700;
const STEP_TIMEOUT_MS = 90_000;
/** La vue monde : le globe entier dans la fenêtre, au zoom le plus bas de la carte. */
const WORLD_VIEW = { lng: 0, lat: 20, zoom: 1.6 };

function readArgs(argv) {
  const args = { url: 'http://localhost:4173', passes: 1 };
  for (let i = 0; i < argv.length; i++) {
    // `--url=<adresse>` : l'adresse peut porter ses propres signes « = ».
    const eq = argv[i].indexOf('=');
    const name = eq < 0 ? argv[i] : argv[i].slice(0, eq);
    const inline = eq < 0 ? undefined : argv[i].slice(eq + 1);
    const value = () => inline ?? argv[++i];
    if (name === '--url') args.url = value();
    else if (name === '--passes') args.passes = Math.max(1, Number.parseInt(value(), 10) || 1);
    else throw new Error(`Option inconnue : ${argv[i]} (options : --url <adresse>, --passes <nombre>)`);
  }
  return args;
}

const isGrid = (url) => {
  try {
    const { hostname, pathname } = new URL(url);
    return hostname === 'openmeteo.s3.amazonaws.com' || pathname.startsWith('/grilles/');
  } catch {
    return false;
  }
};

/** Posé dans la page avant son code : note chaque changement de `data-field-status` et l'heure du dernier clic. */
function instrument() {
  const bench = { marks: [], input: 0 };
  window.__bench = bench;
  const read = () => {
    const map = document.querySelector('[data-field-status]');
    if (map) return map.getAttribute('data-field-status');
    // Une version d'avant l'attribut : l'écran de démarrage s'efface quand la carte a ses premières données,
    // puis la pastille de chargement s'allume 150 ms après le début d'un chargement et s'éteint quand le
    // champ est là, au plus tôt 600 ms après s'être allumée.
    const splash = document.getElementById('splash');
    const loader = document.querySelector('.field-loader');
    if (!splash && !loader) return null;
    if (splash && !splash.hasAttribute('data-done')) return 'loading';
    return loader?.getAttribute('data-on') === 'true' ? 'loading' : 'ready';
  };
  const record = () => {
    const status = read();
    if (status && bench.marks.at(-1)?.status !== status) bench.marks.push({ t: performance.now(), status });
  };
  // `document` et non `<html>` : ce script passe avant que la page ait un élément racine.
  new MutationObserver(record).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-field-status', 'data-done', 'data-on'] });
  addEventListener('pointerdown', () => (bench.input = performance.now()), true);
}

/** Posé dans la page avant son code : une vue de carte déjà enregistrée, comme si le visiteur l'avait laissée là. */
function presetView(view) {
  localStorage.setItem('aywhoula', JSON.stringify({ state: { view }, version: 3 }));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Un navigateur neuf sur la carte : cache vide, 4G simulée, requêtes de grilles comptées. `view` pose une
 * vue enregistrée avant l'ouverture ; sans elle, la vue de départ de l'appli.
 */
async function openSession(browser, view) {
  const context = await browser.newContext({ viewport: VIEWPORT, locale: 'fr-FR', serviceWorkers: 'block' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.emulateNetworkConditions', FOUR_G);
  await page.addInitScript(instrument);
  if (view) await page.addInitScript(presetView, view);

  /** Les requêtes de grilles, dans l'ordre où elles partent. */
  const grid = [];
  const pending = new Set();
  let lastActivity = Date.now();
  page.on('request', (request) => {
    if (!isGrid(request.url())) return;
    grid.push({ request, bytes: 0, failed: false });
    pending.add(request);
    lastActivity = Date.now();
  });
  const settle = (request, failed) => {
    const entry = grid.find((g) => g.request === request);
    if (!entry) return;
    pending.delete(request);
    lastActivity = Date.now();
    entry.failed = failed;
    if (failed) return;
    return request
      .sizes()
      .then((s) => (entry.bytes = s.responseBodySize + s.responseHeadersSize))
      .catch(() => undefined);
  };
  const sizing = [];
  page.on('requestfinished', (request) => sizing.push(settle(request, false)));
  page.on('requestfailed', (request) => sizing.push(settle(request, true)));

  const quiet = async () => {
    const limit = Date.now() + STEP_TIMEOUT_MS;
    while (pending.size > 0 || Date.now() - lastActivity < QUIET_MS) {
      if (Date.now() > limit) throw new Error('Des requêtes de grilles sont restées sans réponse.');
      await sleep(50);
    }
    await Promise.all(sizing);
  };

  /**
   * Le temps jusqu'au premier `ready` qui suit `since` (heure de la page), après un passage par `loading`.
   * Sans passage par `loading` dans la seconde qui suit, l'échéance était déjà en mémoire : 0 ms.
   */
  const readyAfter = async (since, needsLoading) => {
    const handle = await page.waitForFunction(
      ([from, loadingFirst]) => {
        // Un objet, jamais un nombre : `waitForFunction` n'aboutit que sur une valeur vraie, et 0 ms n'en est pas une.
        const marks = window.__bench.marks.filter((m) => m.t >= from);
        const start = loadingFirst ? marks.findIndex((m) => m.status === 'loading') : 0;
        if (start < 0) return performance.now() - from > 1000 ? { ms: 0 } : null;
        const ready = marks.slice(start).find((m) => m.status === 'ready');
        if (ready) return { ms: ready.t - from };
        const error = marks.slice(start).find((m) => m.status === 'error');
        return error ? { failed: true } : null;
      },
      [since, needsLoading],
      { timeout: STEP_TIMEOUT_MS, polling: 20 },
    );
    const result = await handle.jsonValue();
    if (result.failed) throw new Error('La carte a répondu « Données indisponibles ».');
    return result.ms;
  };

  const steps = [];
  /** Clôt une étape : attend la fin de son préchargement, puis compte ce qui est parti depuis `from`. */
  const close = async (name, ms, from) => {
    await quiet();
    const mine = grid.slice(from);
    const done = mine.filter((g) => !g.failed);
    steps.push({ name, ms, requests: mine.length, cancelled: mine.length - done.length, bytes: done.reduce((sum, g) => sum + g.bytes, 0) });
  };

  /** Ouvre l'appli et mesure jusqu'à la première carte prête. */
  const open = async (url, name) => {
    await page.goto(url, { waitUntil: 'commit' });
    await page.waitForSelector('.map', { state: 'attached', timeout: 60_000 });
    await close(name, await readyAfter(0, false), 0);
    return (await page.locator('[data-field-status]').count()) > 0;
  };

  /** Mesure un geste : du clic à la carte prête. */
  const act = async (name, click) => {
    const from = grid.length;
    await click();
    const input = await page.evaluate(() => window.__bench.input);
    await close(name, await readyAfter(input, true), from);
  };

  return { context, page, steps, quiet, open, act };
}

const skipped = (name) => ({ name, ms: null, requests: 0, cancelled: 0, bytes: 0 });

async function pass(browser, url) {
  const session = await openSession(browser);
  const { page, steps } = session;
  let precise;
  try {
    // 1. L'ouverture : couche et vue de départ, cache vide.
    precise = await session.open(url, 'Ouverture en Vent');

    // Hors mesure : un point en mer, au milieu de la carte, pour que la barre du bas ait son tableau.
    const map = page.locator('.map');
    const box = await map.boundingBox();
    await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
    const hasForecast = await page
      .waitForSelector('.hourcol[aria-current="time"]', { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    await session.quiet();

    // 2. Le passage à Vagues.
    await session.act('Passage à Vagues', () => page.getByRole('radio', { name: 'Vagues', exact: true }).click());

    // 3 et 4. Le jour suivant, puis J+3 : dans le tableau, la colonne située 24 heures après celle de l'heure de
    // la carte, puis 48 heures après celle-là (une colonne par pas : 24 heures font 8 colonnes au pas de 3 heures).
    for (const [name, hours] of [['Jour suivant', 24], ['J+3', 48]]) {
      const next = hasForecast
        ? await page.evaluate((ahead) => {
            const cols = [...document.querySelectorAll('.hourcol')];
            const now = cols.findIndex((c) => c.getAttribute('aria-current') === 'time');
            const label = document.querySelector('.band-scroll')?.getAttribute('aria-label') ?? '';
            const step = Number(/toutes les (\d+) heures/.exec(label)?.[1] ?? 1);
            const target = now + Math.round(ahead / step);
            return now >= 0 && target < cols.length ? target : -1;
          }, hours)
        : -1;
      if (next < 0) {
        if (hasForecast) throw new Error(`Le tableau de la barre du bas n’a pas de colonne ${hours} heures plus loin.`);
        steps.push(skipped(name));
        continue;
      }
      await session.act(name, () => page.locator('.hourcol').nth(next).click());
    }
  } finally {
    await session.context.close();
  }

  // 5. L'ouverture en vue monde : un autre navigateur neuf, où la vue enregistrée est celle du globe entier.
  const world = await openSession(browser, WORLD_VIEW);
  try {
    await world.open(url, 'Ouverture en vue monde');
  } finally {
    await world.context.close();
  }
  return { steps: [...steps, ...world.steps], precise };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const fmtMs = (ms) => (ms == null ? 'non mesuré' : `${Math.round(ms).toLocaleString('fr-FR')} ms`);
const fmtBytes = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Mo` : `${Math.round(bytes / 1e3).toLocaleString('fr-FR')} Ko`);

function table(steps) {
  const head = ['Étape', 'Affichage', 'Requêtes de grilles', 'Octets de grilles'];
  const rows = steps.map((s) => [s.name, fmtMs(s.ms), s.cancelled ? `${s.requests} (${s.cancelled} annulées)` : String(s.requests), fmtBytes(s.bytes)]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => `| ${cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join(' | ')} |`;
  return [line(head), `|${widths.map((w, i) => (i === 0 ? `${'-'.repeat(w + 1)} ` : ` ${'-'.repeat(w)}:`)).join('|')}|`, ...rows.map(line)].join('\n');
}

const args = readArgs(process.argv.slice(2));
const browser = await chromium.launch();
try {
  console.log(`Banc de la carte : ${args.url}`);
  console.log(`Chromium ${browser.version()}, ${VIEWPORT.width} × ${VIEWPORT.height}, 4G simulée (20 Mbit/s en réception, 5 Mbit/s en émission, 40 ms), cache du navigateur vide.\n`);
  const passes = [];
  let precise = true;
  for (let n = 1; n <= args.passes; n++) {
    const result = await pass(browser, args.url);
    passes.push(result.steps);
    precise &&= result.precise;
    if (args.passes > 1) console.log(`Passe ${n}\n${table(result.steps)}\n`);
  }
  const summary = passes[0].map((step, i) => {
    const all = passes.map((p) => p[i]);
    const measured = all.filter((s) => s.ms != null);
    return {
      name: step.name,
      ms: measured.length ? median(measured.map((s) => s.ms)) : null,
      requests: Math.round(median(all.map((s) => s.requests))),
      cancelled: Math.round(median(all.map((s) => s.cancelled))),
      bytes: median(all.map((s) => s.bytes)),
    };
  });
  if (args.passes > 1) console.log(`Médiane des ${args.passes} passes`);
  console.log(table(summary));
  if (!precise) {
    console.log('\nCette version de l’appli n’a pas data-field-status : les temps sont lus sur l’écran de démarrage et sur la pastille de chargement, à 0,75 s près après l’ouverture.');
  }
  if (summary.some((s) => s.ms == null)) {
    console.log('\nLe jour suivant et J+3 n’ont pas été mesurés : la prévision du point ne s’est pas chargée (l’API tourne-t-elle sur le port 8787 ?).');
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
