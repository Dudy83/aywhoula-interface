import type { HeightUnit, TempUnit, WindUnit } from '../lib/units';
import { useStore, type ThemeChoice } from '../state/store';
import { Segmented } from './common';

/** Les trois unités, une ligne chacune. Sert au menu des réglages et au profil. */
export function UnitRows() {
  const units = useStore((s) => s.units);
  const setUnits = useStore((s) => s.setUnits);
  return (
    <>
      <div className="menu-row">
        <span className="menu-label">Vent</span>
        <Segmented<WindUnit>
          label="Unité de vent"
          value={units.wind}
          onChange={(wind) => setUnits({ wind })}
          options={[
            { value: 'kn', label: 'nd', title: 'Nœuds' },
            { value: 'kmh', label: 'km/h' },
            { value: 'ms', label: 'm/s' },
            { value: 'bft', label: 'Bft', title: 'Beaufort' },
          ]}
        />
      </div>
      <div className="menu-row">
        <span className="menu-label">Hauteur</span>
        <Segmented<HeightUnit>
          label="Unité de hauteur"
          value={units.height}
          onChange={(height) => setUnits({ height })}
          options={[
            { value: 'm', label: 'm' },
            { value: 'ft', label: 'ft', title: 'Pieds' },
          ]}
        />
      </div>
      <div className="menu-row">
        <span className="menu-label">Température</span>
        <Segmented<TempUnit>
          label="Unité de température"
          value={units.temp}
          onChange={(temp) => setUnits({ temp })}
          options={[
            { value: 'c', label: '°C' },
            { value: 'f', label: '°F' },
          ]}
        />
      </div>
    </>
  );
}

export const THEME_LABEL: Record<ThemeChoice, string> = { auto: 'Auto', light: 'Clair', dark: 'Sombre' };

/** Le choix du thème, sans son libellé : le profil le pose sous une ligne qui le porte déjà. */
export function ThemeControl() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  return (
    <Segmented<ThemeChoice>
      label="Thème"
      value={theme}
      onChange={setTheme}
      options={[
        { value: 'auto', label: THEME_LABEL.auto, title: 'Suit le réglage de l’appareil' },
        { value: 'light', label: THEME_LABEL.light },
        { value: 'dark', label: THEME_LABEL.dark },
      ]}
    />
  );
}

/** Le choix du thème, sur une ligne du menu des réglages. */
export function ThemeRow() {
  return (
    <div className="menu-row">
      <span className="menu-label">Thème</span>
      <ThemeControl />
    </div>
  );
}

type Opening = 'last' | 'map';

/** Ce qui s'affiche à l'ouverture de l'appli : le panneau du dernier point ouvert, ou la carte seule. */
export const openingLabel = (reopenLast: boolean): string => (reopenLast ? 'Dernier point' : 'Carte seule');

/** Le choix de l'ouverture, sans son libellé : le profil le pose sous une ligne qui le porte déjà. */
export function OpeningControl() {
  const reopenLast = useStore((s) => s.reopenLast);
  const setReopenLast = useStore((s) => s.setReopenLast);
  return (
    <Segmented<Opening>
      label="À l’ouverture de l’appli"
      value={reopenLast ? 'last' : 'map'}
      onChange={(v) => setReopenLast(v === 'last')}
      options={[
        { value: 'last', label: openingLabel(true), title: 'Rouvre le panneau du dernier point ouvert' },
        { value: 'map', label: openingLabel(false), title: 'La carte, sans panneau ouvert' },
      ]}
    />
  );
}
