/** Accès à la carte pour les composants qui n'en sont pas les parents (recherche, boutons, dialog d'un lieu). */
import type { Map as MlMap } from 'maplibre-gl';
import { distanceKm } from '../data/places';

let map: MlMap | null = null;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isWide = () => window.matchMedia('(min-width: 900px)').matches;

/**
 * Zone de la carte que l'interface ne couvre pas, lue sur la page : la barre de recherche et les couches en
 * haut, la petite carte d'un lieu (en haut à droite sur ordinateur), le dialog ou le panneau (à droite sur
 * ordinateur, la feuille du bas sur téléphone), la barre du bas quand elle est là.
 */
function visibleArea(w: number, h: number): { left: number; top: number; right: number; bottom: number } {
  const panel = document.querySelector<HTMLElement>('.chrome > .panel');
  const card = document.querySelector<HTMLElement>('.chrome > .place-card');
  const dock = document.querySelector<HTMLElement>('.dock-area');
  // Une barre cachée (`display: none`) n'a pas de parent de placement.
  const dockTop = dock?.offsetParent ? dock.getBoundingClientRect().top : h;
  if (isWide()) {
    return {
      left: 16,
      top: card ? card.getBoundingClientRect().bottom + 8 : 84,
      right: panel ? panel.getBoundingClientRect().left - 16 : w - 64,
      bottom: Math.min(h - 16, dockTop - 8),
    };
  }
  // La feuille du téléphone : sa hauteur visée (posée par le dialog), pas celle d'une transition en cours.
  const sheetTop = panel ? h - (parseFloat(panel.style.height) || panel.getBoundingClientRect().height) : h;
  return { left: 8, top: 128, right: w - 8, bottom: Math.min(dockTop, sheetTop) - 8 };
}

/** Décalage du centre de la carte vers le milieu de la zone visible. */
function areaOffset(m: MlMap): [number, number] {
  const { clientWidth: w, clientHeight: h } = m.getContainer();
  const a = visibleArea(w, h);
  return [Math.round((a.left + a.right - w) / 2), Math.round((a.top + a.bottom - h) / 2)];
}

/** Décalage qui fait entrer l'intervalle [a, b] dans [lo, hi] ; centré s'il est plus grand. */
function shiftInto(a: number, b: number, lo: number, hi: number): number {
  if (b - a > hi - lo) return (lo + hi - a - b) / 2;
  if (a < lo) return lo - a;
  if (b > hi) return hi - b;
  return 0;
}

/**
 * Après le prochain rendu de l'interface : un lieu choisi ouvre son dialog ou sa petite carte, que la zone
 * visible doit voir.
 */
const afterLayout = (run: () => void): void => {
  requestAnimationFrame(() => requestAnimationFrame(run));
};

export const mapApi = {
  attach(m: MlMap): void {
    map = m;
  },
  detach(m: MlMap): void {
    if (map === m) map = null;
  },
  center(): { lon: number; lat: number } {
    const c = map?.getCenter();
    return { lon: c?.lng ?? 0, lat: c?.lat ?? 0 };
  },
  zoomBy(delta: number): void {
    if (!map) return;
    map.easeTo({ zoom: map.getZoom() + delta, duration: reducedMotion() ? 0 : 220 });
  },
  /** Amène un lieu au milieu de la zone visible, en zoomant au besoin. */
  focus(lon: number, lat: number, minZoom: number): void {
    afterLayout(() => {
      if (!map) return;
      const options = { center: [lon, lat] as [number, number], zoom: Math.max(map.getZoom(), minZoom), offset: areaOffset(map) };
      if (reducedMotion()) map.jumpTo(options);
      else map.flyTo({ ...options, speed: 1.8, essential: true });
    });
  },
  /** À l'ouverture de l'appli : amène un lieu dans la zone visible, sans animation ni changer le zoom. */
  show(lon: number, lat: number): void {
    afterLayout(() => {
      if (!map) return;
      const p = map.project([lon, lat]);
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      const a = visibleArea(w, h);
      if (p.x >= a.left && p.x <= a.right && p.y >= a.top && p.y <= a.bottom) return;
      map.easeTo({ center: [lon, lat], offset: areaOffset(map), duration: 0 });
    });
  },
  /** Recentre seulement si le point est caché par l'interface. */
  reveal(lon: number, lat: number): void {
    afterLayout(() => {
      if (!map) return;
      const p = map.project([lon, lat]);
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      const a = visibleArea(w, h);
      if (p.x >= a.left && p.x <= a.right && p.y >= a.top && p.y <= a.bottom) return;
      map.easeTo({ center: [lon, lat], offset: areaOffset(map), duration: reducedMotion() ? 0 : 350 });
    });
  },
  /**
   * Décale la carte du plus petit écart qui montre toute la rose de sélection. `box` est le
   * rectangle de la rose (point, flèches et étiquettes) en pixels, relatif au point.
   */
  revealRose(lon: number, lat: number, box: { left: number; top: number; right: number; bottom: number }): void {
    if (!map) return;
    const m = map;
    const run = () => {
      const p = m.project([lon, lat]);
      const { clientWidth: w, clientHeight: h } = m.getContainer();
      const area = visibleArea(w, h);
      const dx = shiftInto(p.x + box.left, p.x + box.right, area.left, area.right);
      const dy = shiftInto(p.y + box.top, p.y + box.bottom, area.top, area.bottom);
      if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) m.panBy([-dx, -dy], { duration: reducedMotion() ? 0 : 240 });
    };
    // Le recentrage de reveal() peut être en cours : on part de la position où il s'arrête.
    if (m.isMoving()) m.once('moveend', run);
    else run();
  },
  /**
   * Appelle `run` quand la carte est posée (sans mouvement en cours) et chargée : `loaded()` n'est vrai
   * qu'une fois les tuiles de la vue demandées puis reçues (`areTilesLoaded()`, lui, l'est déjà juste après
   * le style, avant qu'aucune tuile ne soit demandée). Pas de lancement forcé : tant que la carte n'est pas
   * prête, on attend. Renvoie de quoi y renoncer.
   */
  whenSettled(run: () => void): () => void {
    let done = false;
    let timer = 0;
    const check = () => {
      if (done) return;
      if (!map || map.isMoving() || !map.loaded()) {
        timer = window.setTimeout(check, 200);
        return;
      }
      done = true;
      run();
    };
    timer = window.setTimeout(check, 0);
    return () => {
      done = true;
      clearTimeout(timer);
    };
  },
  /**
   * Le point est-il en mer, et à quelle distance est la côte ? Lu sur le fond de carte affiché : l'océan de
   * ses tuiles (couche `ocean`), dont on mesure le bord le plus proche. Les bords qu'ajoute le découpage en
   * tuiles (droits, le long d'une limite de tuile) ne sont pas la côte. `km` vaut `null` quand la côte n'est
   * pas dans la carte visible, ou plus loin que son bord. `null` quand la carte ne montre pas le point.
   */
  coastAt(lon: number, lat: number): { sea: boolean; km: number | null } | null {
    // Une carte dont les tuiles du fond ne sont pas là ne montre aucun océan : elle ne dit jamais « à terre ».
    if (!map || !map.getLayer('ocean') || !map.getSource('osm') || !map.isSourceLoaded('osm')) return null;
    const m = map;
    const { clientWidth: w, clientHeight: h } = m.getContainer();
    const p = m.project([lon, lat]);
    if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) return null;
    const sea = m.queryRenderedFeatures([p.x, p.y], { layers: ['ocean'] }).length > 0;
    // Distances en km dans un plan local autour du point : assez juste sur quelques centaines de km.
    const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
    const ky = 110.57;
    const toMerc = ([x, y]: number[]) => [(x + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + (y * Math.PI) / 360)) / Math.PI) / 2];
    const tiles = 2 ** Math.min(14, Math.floor(m.getZoom()));
    // Un bord de découpage : droit (même x ou même y, au millionième de tuile près) et près d'une limite de tuile.
    const nearLine = (v: number) => Math.abs(v * tiles - Math.round(v * tiles)) < 0.06;
    const clipped = (a: number[], b: number[]) => (Math.abs(a[0] - b[0]) < 1e-9 && nearLine(a[0])) || (Math.abs(a[1] - b[1]) < 1e-9 && nearLine(a[1]));
    let best = Infinity;
    for (const f of m.queryRenderedFeatures({ layers: ['ocean'] })) {
      const g = f.geometry;
      const polygons = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const ring of polygons.flat()) {
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1];
          const b = ring[i];
          if (clipped(toMerc(a), toMerc(b))) continue;
          // Distance du point (l'origine) au segment [a, b].
          const ax = (a[0] - lon) * kx;
          const ay = (a[1] - lat) * ky;
          const dx = (b[0] - a[0]) * kx;
          const dy = (b[1] - a[1]) * ky;
          const t = dx || dy ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
          best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
        }
      }
    }
    // Plus loin que le bord de la carte visible, la côte peut être ailleurs, hors de ses tuiles.
    const corners = [m.unproject([p.x, 0]), m.unproject([p.x, h]), m.unproject([0, p.y]), m.unproject([w, p.y])];
    const edge = Math.min(...corners.map((c) => distanceKm(lon, lat, c.lng, c.lat)));
    return { sea, km: best <= edge ? best : null };
  },
  locate(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('La géolocalisation n’est pas disponible sur cet appareil.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          mapApi.focus(pos.coords.longitude, pos.coords.latitude, 8);
          resolve();
        },
        (err) =>
          reject(
            new Error(
              err.code === err.PERMISSION_DENIED
                ? 'Localisation refusée. Autorisez-la dans les réglages du navigateur.'
                : 'Position introuvable pour le moment.',
            ),
          ),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
      );
    });
  },
};
