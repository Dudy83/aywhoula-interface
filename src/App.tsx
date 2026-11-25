import { useEffect, useLayoutEffect } from 'react';
import { useResolvedTheme } from './lib/theme';
import { mapApi } from './map/api';
import { MapView } from './map/MapView';
import { FREE_DAYS } from './data/forecast';
import { DAY, HOUR, startOfLocalDay } from './lib/time';
import { startAccount, useAccount, usePremium } from './state/account';
import { useStore } from './state/store';
import { AccountOverlays } from './ui/account/Overlays';
import { Dock } from './ui/Dock';
import { FieldLoader } from './ui/FieldLoader';
import { LayerRail } from './ui/LayerRail';
import { MapControls } from './ui/MapControls';
import { Panel } from './ui/Panel';
import { watchSplash } from './ui/splash';
import { TopBar } from './ui/TopBar';
import { useWide } from './ui/common';

export function App() {
  const theme = useResolvedTheme();
  const wide = useWide();
  // Ce qui occupe la droite (ordinateur) ou le bas (téléphone) : un panneau du compte, le dialog d'un lieu,
  // ou seulement sa petite carte (un point sur ordinateur, un dialog réduit), qui laisse la barre du bas en entier.
  const place = useStore((s) => (s.selection ? (s.sheet === 'reduced' || (wide && s.selection.kind === 'point') ? 'card' : 'dialog') : null));
  const hasSide = useAccount((s) => s.side !== null);
  const premium = usePremium();

  // Avant les effets des composants enfants : la carte lit les couleurs du thème dans le CSS.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#17191c' : '#eef0f2');
  }, [theme]);

  // L'écran de démarrage d'index.html couvre la carte jusqu'à ses premières données.
  useEffect(watchSplash, []);

  // À l'ouverture, le panneau du dernier lieu ouvert, si l'option est active et que l'adresse ne
  // désigne pas un autre lieu (`?lieu=`, lien d'une notification). Avant `startAccount`, qui retire
  // ce paramètre de l'adresse ; après la création de la carte (effet de MapView, l'enfant).
  useEffect(() => {
    const { reopenLast, lastSelection, selection, select } = useStore.getState();
    if (!reopenLast || !lastSelection || selection) return;
    if (new URLSearchParams(window.location.search).has('lieu')) return;
    select(lastSelection);
    mapApi.show(lastSelection.lon, lastSelection.lat);
  }, []);

  // Le compte : la session en cours, et ce que l'adresse demande d'ouvrir (?compte, ?panneau=profil…).
  useEffect(() => {
    void startAccount();
  }, []);

  // Version gratuite : la carte et la ligne de temps s'arrêtent à la fin du cinquième jour, quel que soit
  // le modèle ; au-delà, c'est Premium. Recalculée chaque heure, pour suivre le changement de jour.
  useEffect(() => {
    const apply = () => {
      let end = startOfLocalDay(Date.now());
      for (let k = 0; k < FREE_DAYS; k++) end = startOfLocalDay(end + DAY + 3 * HOUR);
      useStore.setState({ timeLimit: premium ? null : end - 1 });
      // L'heure affichée repasse par la limite (elle a pu être posée avant que le compte soit connu).
      const store = useStore.getState();
      store.setTime(store.time);
    };
    apply();
    const id = window.setInterval(apply, HOUR);
    return () => window.clearInterval(id);
  }, [premium]);

  // Espace : lecture / pause, hors des champs de saisie et des boutons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== 'Space' || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || el.getAttribute('role') === 'slider') return;
      e.preventDefault();
      const store = useStore.getState();
      if (store.timeline) store.setPlaying(!store.playing);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app" data-panel={hasSide ? 'side' : (place ?? undefined)}>
      <MapView />
      <div className="chrome">
        {/* Avant le reste : les autres surfaces passent par-dessus. */}
        <FieldLoader />
        <TopBar />
        <LayerRail />
        <MapControls />
        <Dock />
        <Panel />
      </div>
      <AccountOverlays />
    </div>
  );
}
