import { Check, ChevronDown, Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { LAYER_BY_ID, MODEL_BY_ID, modelsForLayer, type LayerId } from '../data/catalog';
import { getPalette, paletteGradient } from '../data/palettes';
import { formatQuantity, legendTicks, quantityUnit } from '../lib/quantity';
import { useResolvedTheme } from '../lib/theme';
import { formatHour, formatRun } from '../lib/time';
import type { HeightUnit, TempUnit, WindUnit } from '../lib/units';
import { effectiveModel, useStore, type TimelineProfile } from '../state/store';
import { aboveSheetRow, Popover, radioFocusKeyDown, useWide } from './common';
import { DayStrip } from './DayStrip';
import { ReducedPlace } from './place/PlaceCard';
import { StepSwitch } from './StepSwitch';
import { SHEET_DAYS, Timeline, TimelineViewSwitch } from './Timeline';
import { PROFILE_BY_ID } from './timeline/profiles';
import { ProfilePicker } from './timeline/ProfilePicker';

const monthFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Les types d'affichage dont le modèle n'est pas celui de la couche : la houle en détail suit la famille des
 * vagues, le vent et la météo celle de l'atmosphère. Chacun par la couche de la carte qui le représente le mieux,
 * dont il prend la liste des modèles et le modèle retenu.
 */
const PROFILE_LAYER: Partial<Record<TimelineProfile, LayerId>> = { swell: 'swell', wind: 'wind', weather: 'temp' };

/**
 * Le choix du modèle de la barre : celui de la famille du type affiché (la couche affichée pour « Vagues et
 * vent » et « Marée et courant »). Changer de modèle change celui de cette famille pour la carte aussi.
 */
export function ModelPicker() {
  const layerId = useStore((s) => s.layer);
  const profile = useStore((s) => s.timelineProfile);
  const models = useStore((s) => s.models);
  const timeline = useStore((s) => s.timeline);
  const covered = useStore((s) => s.covered);
  const setModel = useStore((s) => s.setModel);
  const wide = useWide();
  const followed = PROFILE_LAYER[profile];
  const layer = LAYER_BY_ID[followed ?? layerId];
  const current = effectiveModel(layer.id, models);
  const options = modelsForLayer(layer);
  const run = timeline && timeline.modelId === current.id ? formatRun(timeline.ref) : null;
  // La note dit le run que montre la carte ; quand le choix suit un type dont la carte ne montre pas la famille,
  // elle n'a rien à en dire.
  const note = followed
    ? run && `Run affiché : ${run}.`
    : `${run ? `Run affiché : ${run}.` : 'Chargement du dernier run…'}${covered ? '' : ` ${current.label} ne couvre pas la zone visible.`}`;

  return (
    <Popover
      className="model"
      label={`Modèle : ${current.label}. Changer de modèle`}
      side="top"
      align="end"
      // Dans la barre du dialog d'un lieu, sur téléphone : sur toute la largeur de sa ligne, au-dessus d'elle.
      place={wide ? undefined : aboveSheetRow}
      trigger={
        <>
          <span className="model-name">{current.label}</span>
          <span className="model-res">{current.resolution.split(' · ')[1] ?? current.resolution}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <div className="model-list">
          <div className="popover-title">Modèle pour « {followed ? PROFILE_BY_ID[profile].name : layer.label} »</div>
          <ul role="radiogroup" aria-label="Modèle" onKeyDown={radioFocusKeyDown}>
            {options.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={m.id === current.id}
                  tabIndex={m.id === current.id ? 0 : -1}
                  className="model-option"
                  onClick={() => {
                    setModel(m.kind, m.id);
                    close();
                  }}
                >
                  <span className="model-option-check">{m.id === current.id && <Check size={14} aria-hidden="true" />}</span>
                  <span className="model-option-main">
                    <span className="model-option-name">{m.label}</span>
                    <span className="model-option-meta">
                      {m.provider} · {m.resolution} · {m.horizon}
                    </span>
                    {m.region && <span className="model-option-region">Couvre : {m.region}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {note && <p className="popover-note">{note}</p>}
        </div>
      )}
    </Popover>
  );
}

const WIND_CYCLE: WindUnit[] = ['kn', 'kmh', 'ms', 'bft'];
const HEIGHT_CYCLE: HeightUnit[] = ['m', 'ft'];
const TEMP_CYCLE: TempUnit[] = ['c', 'f'];
const next = <T,>(list: T[], v: T): T => list[(list.indexOf(v) + 1) % list.length];

export function Legend() {
  const layerId = useStore((s) => s.layer);
  const units = useStore((s) => s.units);
  const setUnits = useStore((s) => s.setUnits);
  const theme = useResolvedTheme();
  const layer = LAYER_BY_ID[layerId];
  const palette = getPalette(layer.palette, theme === 'dark');
  const gradient = useMemo(() => paletteGradient(palette), [palette]);
  const q = layer.quantity;
  const switchable = q === 'wind' || q === 'height' || q === 'temp' || q === 'current';

  const cycle = () => {
    if (q === 'wind') setUnits({ wind: next(WIND_CYCLE, units.wind) });
    else if (q === 'height') setUnits({ height: next(HEIGHT_CYCLE, units.height) });
    else if (q === 'temp') setUnits({ temp: next(TEMP_CYCLE, units.temp) });
    else if (q === 'current') setUnits({ wind: units.wind === 'kn' ? 'ms' : 'kn' });
  };

  const unit = quantityUnit(q, units);
  return (
    <div className="legend" aria-label={`Légende : ${layer.label}, en ${unit}`}>
      <div className="legend-scale">
        <div className="legend-bar" style={{ background: gradient }} />
        <div className="legend-ticks" aria-hidden="true">
          {legendTicks(q, units, palette.ticks)
            .filter((t) => t.value >= palette.min && t.value <= palette.max)
            .map((t) => (
              <span key={t.label} style={{ left: `${((t.value - palette.min) / (palette.max - palette.min)) * 100}%` }}>
                {t.label}
              </span>
            ))}
        </div>
      </div>
      {switchable ? (
        <button type="button" className="legend-unit" onClick={cycle} title="Changer d’unité">
          {unit}
        </button>
      ) : (
        <span className="legend-unit legend-unit-static">{unit}</span>
      )}
    </div>
  );
}

export function PlayButton() {
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const ready = useStore((s) => s.timeline !== null);
  return (
    <button
      type="button"
      className="play"
      disabled={!ready}
      aria-label={playing ? 'Mettre en pause' : 'Lire l’animation'}
      aria-pressed={playing}
      onClick={() => setPlaying(!playing)}
    >
      {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
    </button>
  );
}

export function Clock() {
  const time = useStore((s) => s.time);
  const timeline = useStore((s) => s.timeline);
  if (!timeline || !time) {
    return (
      <div className="clock" aria-hidden="true">
        <span className="clock-day">Chargement</span>
        <span className="clock-hour">––:––</span>
      </div>
    );
  }
  return (
    <div className="clock" aria-live="off">
      <span className="clock-day">{monthFmt.format(time)}</span>
      <span className="clock-hour">{formatHour(time)}</span>
    </div>
  );
}

function Status() {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const covered = useStore((s) => s.covered);
  const layerId = useStore((s) => s.layer);
  const models = useStore((s) => s.models);
  const readout = useStore((s) => s.readout);
  const selection = useStore((s) => s.selection);
  const units = useStore((s) => s.units);
  const model = effectiveModel(layerId, models);
  const chosen = MODEL_BY_ID[models[model.kind]];

  let message: string | null = null;
  let tone: 'error' | 'info' = 'info';
  if (status === 'error') {
    message = error ?? 'Données indisponibles.';
    tone = 'error';
  } else if (!covered) {
    message = `${model.label} ne couvre pas cette zone${model.region ? ` (${model.region})` : ''}. Choisissez un modèle global.`;
  } else if (chosen && chosen.id !== model.id) {
    message = `${chosen.label} ne fournit pas « ${LAYER_BY_ID[layerId].label} » : affichage ${model.label}.`;
  }
  // Annonce discrète de la valeur au point sélectionné, pour les lecteurs d'écran.
  const q = LAYER_BY_ID[layerId].quantity;
  const spoken =
    selection && readout ? `${LAYER_BY_ID[layerId].label} : ${formatQuantity(q, readout.value, units)} ${quantityUnit(q, units)}` : '';

  return (
    <>
      {message && (
        <p className="dock-status" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
          {message}
        </p>
      )}
      <span className="visually-hidden" role="status">
        {spoken}
      </span>
    </>
  );
}

const CREDITS: { label: string; role: string; href: string }[] = [
  { label: '© OpenStreetMap', role: 'Carte, spots, plages, webcams', href: 'https://www.openstreetmap.org/copyright' },
  { label: 'OpenFreeMap', role: 'Tuiles du fond de carte', href: 'https://openfreemap.org' },
  { label: 'Open-Meteo', role: 'Modèles météo et vagues', href: 'https://open-meteo.com' },
  { label: 'NOAA NDBC', role: 'Bouées, Amérique et Royaume-Uni', href: 'https://www.ndbc.noaa.gov' },
  { label: 'Puertos del Estado', role: 'Bouées, Espagne', href: 'https://portus.puertos.es' },
  { label: 'Marine Institute', role: 'Bouées, Irlande', href: 'https://www.marine.ie' },
  { label: 'CANDHIS', role: 'Bouées, France', href: 'https://candhis.cerema.fr' },
];

/** Sources des données : en ligne sur grand écran, repliées derrière un bouton sur mobile. */
function Credits() {
  return (
    <>
      <p className="credits">
        {CREDITS.map((c) => (
          <a key={c.href} href={c.href} target="_blank" rel="noreferrer" title={c.role}>
            {c.label}
          </a>
        ))}
      </p>
      <Popover className="credits-menu" label="Sources des données" side="top" align="end" trigger="Sources">
        {() => (
          <>
            <p className="popover-title">Sources des données</p>
            <ul className="credits-list">
              {CREDITS.map((c) => (
                <li key={c.href}>
                  <a href={c.href} target="_blank" rel="noreferrer">
                    {c.label}
                  </a>
                  <span>{c.role}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Popover>
    </>
  );
}

/** Sur téléphone, la lecture, l'heure et le modèle : la première ligne de la barre, dans la feuille d'un lieu comme en bas de l'écran. */
function BarHead() {
  return (
    <div className="sheet-bar-row">
      <PlayButton />
      <Clock />
      <ModelPicker />
    </div>
  );
}

/**
 * La barre du bas dans le dialog d'un lieu, sur téléphone : la lecture et l'horloge, le modèle ; la vue
 * (courbes ou tableau), le type d'affichage et le pas ; puis les courbes ou le tableau, deux jours et un
 * bout du troisième à l'écran.
 */
export function SheetBar() {
  return (
    <section className="sheet-bar" aria-label="Prévision du lieu, heure par heure">
      <BarHead />
      <div className="sheet-bar-row sheet-bar-row-view">
        <TimelineViewSwitch />
        <ProfilePicker />
        <StepSwitch className="sheet-step" />
      </div>
      <Timeline visibleDays={SHEET_DAYS} />
    </section>
  );
}

/** Le temps du repli de la ligne d'un lieu dans la barre du téléphone : celui des changements de hauteur (DESIGN.md). */
const FOLD_MS = 240;

/**
 * Une valeur qui disparaît reste rendue le temps de son repli (`ms`), marquée `leaving` ; une valeur qui revient
 * pendant ce temps le reprend.
 */
function useLeaving<T>(value: T | null, ms: number): { shown: T | null; leaving: boolean } {
  const [last, setLast] = useState<T | null>(value);
  useEffect(() => {
    if (value !== null) {
      setLast(value);
      return;
    }
    const timer = window.setTimeout(() => setLast(null), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return value !== null ? { shown: value, leaving: false } : { shown: last, leaving: last !== null };
}

/**
 * La barre du bas du téléphone, une seule surface : la lecture, l'heure et le modèle, puis la frise des jours.
 * La feuille d'un lieu réduite y ajoute en tête la ligne du lieu. Ni tableau ni courbes : ils ne vivent que dans
 * la feuille d'un lieu (`SheetBar`), et la barre ne montre jamais la prévision d'un lieu fermé (`lastSelection`).
 */
function PhoneBar() {
  const reduced = useStore((s) => (s.sheet === 'reduced' ? s.selection : null));
  const { shown, leaving } = useLeaving(reduced, FOLD_MS);
  return (
    <section className="dock-bar" aria-label="Heure de la carte">
      {shown && <ReducedPlace key={shown.id} selection={shown} leaving={leaving} />}
      <BarHead />
      <DayStrip />
    </section>
  );
}

export function Dock() {
  const wide = useWide();
  return (
    <div className="dock-area">
      <Status />
      <div className="dock-top">
        <Legend />
        <Credits />
      </div>
      {wide ? (
        <div className="dock">
          <PlayButton />
          <Clock />
          <TimelineViewSwitch />
          <div className="tl-step">
            <StepSwitch />
            <ProfilePicker />
          </div>
          <ModelPicker />
          <Timeline />
        </div>
      ) : (
        <PhoneBar />
      )}
    </div>
  );
}
