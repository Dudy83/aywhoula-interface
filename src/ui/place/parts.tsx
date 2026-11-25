/**
 * Les pièces communes des dialogs d'un lieu : le pictogramme de chaque type, les lignes à pictogramme et
 * leur pastille de statut, les sections, la marée du jour et « Le direct autour ».
 */
import { ArrowUpRight, ChevronRight, MapPin, RadioTower, Video, Waves } from 'lucide-react';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { dayText, hourText } from '../../data/alerts';
import { tideExtremes, type PointForecast, type TideExtreme } from '../../data/forecast';
import {
  buoySelection,
  downstream,
  fromLand,
  durationText,
  filmedPlace,
  hostOf,
  isLive,
  kmText,
  loadBuoyPlaces,
  loadWebcamList,
  nearest,
  travelMinutes,
  useAsync,
  type BuoyPlace,
  type Near,
} from '../../data/nearby';
import { beyondForecast, hourIndex, pickSeries, seaOf, totalOf } from '../../data/sea-state';
import { loadBeaches, loadSpots, type Place } from '../../data/places';
import { DAY, formatAgo, formatDayLong, formatDayMonth, formatHour, HOUR, startOfLocalDay } from '../../lib/time';
import { coordParts, fmt, formatHeight, HEIGHT_UNIT_LABEL } from '../../lib/units';
import { mapApi } from '../../map/api';
import { useStore, type PlaceKind, type Selection } from '../../state/store';
import { areaFor, pathFor } from '../chart';
import { useForecast } from '../useForecast';

export const nextLocalDay = (day: number): number => startOfLocalDay(day + DAY + 3 * HOUR);

/** Le pictogramme d'un type de lieu. */
export function PlaceIcon({ kind, size = 16 }: { kind: PlaceKind; size?: number }) {
  if (kind === 'spot') return <Waves size={size} aria-hidden="true" />;
  if (kind === 'buoy') return <RadioTower size={size} aria-hidden="true" />;
  if (kind === 'webcam') return <Video size={size} aria-hidden="true" />;
  return <MapPin size={size} aria-hidden="true" />;
}

/** En mer ou à terre, et la distance à la côte, une fois la carte posée ; `undefined` tant qu'on la cherche. */
export function useCoast(point: { lon: number; lat: number } | null): { sea: boolean; km: number | null } | null | undefined {
  const key = point ? `${point.lon},${point.lat}` : null;
  const [coast, setCoast] = useState<{ key: string; value: { sea: boolean; km: number | null } | null } | null>(null);
  useEffect(() => {
    if (!point || !key) return;
    return mapApi.whenSettled(() => setCoast({ key, value: mapApi.coastAt(point.lon, point.lat) }));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return coast && coast.key === key ? coast.value : undefined;
}

/**
 * Le titre d'un point et les morceaux de sa ligne : « Point en mer » (ou le nom du lieu trouvé par la
 * recherche), les coordonnées et la distance à la côte. `enabled` à faux : rien n'est cherché sur la carte.
 */
export function usePointHeading(selection: Selection, enabled = true): { title: string; parts: string[] } {
  const coast = useCoast(enabled ? selection : null);
  const title = selection.name || (coast?.sea === true ? 'Point en mer' : coast?.sea === false ? 'Point à terre' : 'Point sur la carte');
  return { title, parts: [...coordParts(selection.lat, selection.lon), ...(coast?.km == null ? [] : [`${kmText(coast.km)} de la côte`])] };
}

/**
 * Une ligne faite de morceaux insécables (« 48,10° N », « 8,7 km de la côte », « vent de terre 24 nd ») :
 * elle ne passe à la ligne qu'aux « · », jamais au milieu d'un morceau.
 */
export function Pieces({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((part, k) => (
        <Fragment key={k}>
          {k > 0 && ' · '}
          <span className="piece">{part}</span>
        </Fragment>
      ))}
    </>
  );
}

/** Un point posé sur un lieu (une bouée, une webcam) : une alerte y suit la prévision à cet endroit. */
export const pointAt = (selection: Selection): Selection => ({
  kind: 'point',
  id: `point:${selection.lat.toFixed(3)},${selection.lon.toFixed(3)}`,
  name: selection.name,
  lat: selection.lat,
  lon: selection.lon,
});

/** Ouvre un lieu, comme un toucher sur la carte, et l'amène à l'écran. */
export function openPlace(selection: Selection): void {
  useStore.getState().select(selection);
  mapApi.focus(selection.lon, selection.lat, 10);
}

/* --------------------------------------------------------------------- lignes */

/** Vert (bon), ambre (à surveiller), violet gris (nuit), gris (neutre). */
export type Status = 'good' | 'watch' | 'night' | 'neutral';
const STATUS_LABEL: Record<Status, string> = { good: 'bon', watch: 'à surveiller', night: 'de nuit', neutral: 'pour information' };

export function StatusDot({ status }: { status: Status }) {
  return <span className="status-dot" data-status={status} role="img" aria-label={STATUS_LABEL[status]} />;
}

/** Une ligne à pictogramme : le pictogramme dans sa tuile, un titre, une précision, la pastille de statut. */
export function InfoRow({ icon, title, detail, status }: { icon: ReactNode; title: string; detail: string; status: Status }) {
  return (
    <div className="info-row">
      <span className="info-tile" aria-hidden="true">
        {icon}
      </span>
      <span className="info-text">
        <b>{title}</b>
        {detail && <span>{detail}</span>}
      </span>
      <StatusDot status={status} />
    </div>
  );
}

/** Une ligne qui ouvre un lieu : son pictogramme, son nom, une précision, une valeur à droite et un chevron. */
export function LinkRow({ icon, title, detail, value, label, onClick }: { icon: ReactNode; title: string; detail: string; value?: string; label?: string; onClick: () => void }) {
  return (
    <button type="button" className="info-row info-link" aria-label={label} onClick={onClick}>
      <span className="info-tile info-tile-sm" aria-hidden="true">
        {icon}
      </span>
      <span className="info-text">
        <b>{title}</b>
        <span>{detail}</span>
      </span>
      {value && <span className="info-value">{value}</span>}
      <ChevronRight size={16} aria-hidden="true" className="info-chevron" />
    </button>
  );
}

/** Une section du dialog : son titre, une précision à droite, son contenu. */
export function Section({ title, hint, action, children, label }: { title: string; hint?: ReactNode; action?: ReactNode; label?: string; children: ReactNode }) {
  return (
    <section className="place-section" aria-label={label ?? title}>
      <div className="section-head">
        <h3>{title}</h3>
        {hint && <span className="section-hint">{hint}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}

/** « 22 h », « demain à 9 h », « jeudi à 9 h » : l'heure de la carte, avec son jour quand ce n'est pas aujourd'hui. */
export function whenText(time: number): { day: string | null; hour: string } {
  const day = dayText(time);
  return { day: day === 'aujourd’hui' ? null : day, hour: hourText(time) };
}

/** « À 22 h au spot », « Demain à 9 h au spot ». */
export function atTitle(time: number, where: string): string {
  const { day, hour } = whenText(time);
  return day ? `${day.charAt(0).toUpperCase()}${day.slice(1)} à ${hour} ${where}` : `À ${hour} ${where}`;
}

/* ------------------------------------------------------------------ prévision */

/**
 * La prévision d'un lieu à l'heure de la carte : les séries du modèle de la carte (un autre modèle s'il
 * ne couvre pas cette heure, comme la rose), et l'indice de cette heure ; -1 au-delà de la prévision.
 */
export function usePlaceNow(point: { lat: number; lon: number } | null) {
  const { data: fc, error } = useForecast(point);
  const mapModels = useStore((s) => s.models);
  const choice = useStore((s) => s.forecastChoice);
  const hour = useStore((s) => Math.round(s.time / HOUR));
  return useMemo(() => {
    const time = (hour || Math.round(Date.now() / HOUR)) * HOUR;
    if (!fc) return { fc: null, error, index: -1, time, wave: null, wind: null, sea: null, total: null, waveKey: null, extremes: [] as TideExtreme[] };
    const at = hourIndex(fc.times, hour);
    const picked = pickSeries(fc, choice, mapModels, at);
    const sea = seaOf(picked.wave);
    return {
      fc,
      error,
      index: beyondForecast(fc.times, hour) ? -1 : at,
      time,
      wave: picked.wave,
      wind: picked.wind,
      sea,
      total: totalOf(picked.wave, sea),
      waveKey: picked.waveKey,
      extremes: fc.seaLevel ? tideExtremes(fc.times, fc.seaLevel) : [],
    };
  }, [fc, error, hour, mapModels, choice]);
}

/** Le spot, la plage ou la webcam d'une sélection, lu dans les fichiers de lieux (orientation, sports, adresse). */
export function usePlace(selection: Selection): Place | null | undefined {
  const { kind, id } = selection;
  return useAsync(kind === 'spot' || kind === 'beach' ? `${kind}|${id}` : null, async () => {
    const list = await (kind === 'spot' ? loadSpots() : loadBeaches()).catch(() => [] as Place[]);
    return list.find((p) => p.id === id) ?? null;
  });
}

/* ---------------------------------------------------------------------- marée */

/** Largeur réelle d'un élément, pour tracer un graphique au pixel. */
export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(160, el.clientWidth));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** « La marée aujourd'hui », « demain », « du jeudi 26 novembre ». */
function tideTitle(time: number): string {
  const day = dayText(time);
  if (day === 'aujourd’hui' || day === 'demain') return `La marée ${day}`;
  return `La marée du ${formatDayLong(time)}`;
}

/**
 * La hauteur d'eau du jour de l'heure de la carte, de 0 h à 24 h : la nuit assombrie, chaque pleine et basse
 * mer marquée, et le curseur à l'heure de la carte.
 */
export function TideDay({ fc, time, extremes }: { fc: PointForecast; time: number; extremes: TideExtreme[] }) {
  const [host, width] = useWidth<HTMLDivElement>(420);
  const clipId = `tide${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const level = fc.seaLevel;
  const day = startOfLocalDay(time);
  const end = nextLocalDay(day);
  const idx = useMemo(() => {
    const out: number[] = [];
    if (!level) return out;
    for (let i = 0; i < fc.times.length; i++) if (fc.times[i] >= day - HOUR && fc.times[i] <= end + HOUR && level[i] != null) out.push(i);
    return out;
  }, [fc.times, level, day, end]);
  if (!level || idx.length < 6) return null;

  const TOP = 18;
  const H = 56;
  const values = idx.map((i) => level[i]!);
  const lo = Math.min(...values);
  const hi = Math.max(...values, lo + 0.2);
  const x = (t: number) => ((t - day) / (end - day)) * width;
  const y = (v: number) => TOP + 6 + (1 - (v - lo) / (hi - lo)) * (H - 12);
  const xs = idx.map((i) => x(fc.times[i]));
  const ys = idx.map((i) => y(level[i]!));
  const marks = extremes.filter((e) => e.time >= day && e.time < end);
  const sun = fc.sun.find((s) => startOfLocalDay(s.rise) === day);
  const inDay = time >= day && time < end;
  // La hauteur à l'heure de la carte, entre les deux heures qui l'encadrent.
  const k = idx.findIndex((i) => fc.times[i] > time);
  const here =
    inDay && k > 0
      ? y(values[k - 1] + ((values[k] - values[k - 1]) * (time - fc.times[idx[k - 1]])) / (fc.times[idx[k]] - fc.times[idx[k - 1]]))
      : null;
  const clampLabel = (v: number) => Math.min(width - 34, Math.max(34, v));

  return (
    <Section title={tideTitle(time)}>
      <div className="tide-day" ref={host}>
        <svg width={width} height={TOP + H + 18} viewBox={`0 0 ${width} ${TOP + H + 18}`} role="img" aria-label={`Marée : ${marks.map((e) => `${e.high ? 'pleine mer' : 'basse mer'} à ${formatHour(e.time)}`).join(', ')}`}>
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={TOP} width={width} height={H} rx={4} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            <rect className="tide-band" x={0} y={TOP} width={width} height={H} />
            {sun && (
              <>
                <rect className="tide-night" x={0} y={TOP} width={Math.max(0, x(sun.rise))} height={H} />
                <rect className="tide-night" x={x(sun.set)} y={TOP} width={Math.max(0, width - x(sun.set))} height={H} />
              </>
            )}
            <path className="ov-area" d={areaFor(xs, ys, TOP + H)} />
            <path className="ov-line ov-line-thin" d={pathFor(xs, ys)} />
          </g>
          {marks.map((e) => (
            <g key={e.time}>
              <circle className="tide-mark" cx={x(e.time)} cy={y(e.level)} r={3} />
              <text className="tide-label" x={clampLabel(x(e.time))} y={e.high ? Math.max(11, y(e.level) - 8) : TOP + H + 13} textAnchor="middle">
                {e.high ? 'PM' : 'BM'} {formatHour(e.time)}
              </text>
            </g>
          ))}
          {inDay && (
            <>
              <line className="ov-cursor" x1={x(time)} x2={x(time)} y1={TOP} y2={TOP + H} />
              {here != null && <circle className="ov-dot" cx={x(time)} cy={here} r={4} />}
            </>
          )}
        </svg>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------- le direct autour */

/** « depuis 06:30 », « depuis hier, 18:30 », « depuis le lun. 23 nov. ». */
function sinceText(time: number): string {
  const day = dayText(time);
  if (day === 'aujourd’hui') return `depuis ${formatHour(time)}`;
  if (Date.now() - time < 2 * DAY && startOfLocalDay(time) === startOfLocalDay(Date.now() - DAY)) return `depuis hier, ${formatHour(time)}`;
  return `depuis le ${formatDayMonth(time)}`;
}

/** La tuile de la bouée la plus proche : sa dernière mesure, ou qu'elle ne publie plus. */
function BuoyTile({ near, place, off }: { near: Near<BuoyPlace>; place: { lon: number; lat: number }; off: number | undefined }) {
  const units = useStore((s) => s.units);
  const { item: buoy, km } = near;
  const obs = buoy.obs;
  const live = obs && isLive(obs) ? obs : null;
  const hUnit = HEIGHT_UNIT_LABEL[units.height];
  // La houle mesurée arrive ici quand la bouée compterait ce lieu parmi ceux où elle arrive : dans la
  // direction où va la houle (à 60° près), et ouvert à elle.
  const arrival =
    live && live.dominantPeriod != null && live.waveDirection != null && downstream(live.waveDirection, buoy, place) && fromLand(off, live.waveDirection) === false
      ? durationText(travelMinutes(km, live.dominantPeriod))
      : null;
  return (
    <button type="button" className="live-tile" onClick={() => openPlace(buoySelection(buoy))}>
      <span className="live-head">
        <RadioTower size={15} aria-hidden="true" />
        <span className="live-name">{buoy.name}</span>
        {live && <span className="live-dot" role="img" aria-label="mesure de moins de 2 heures" />}
      </span>
      {live ? (
        <>
          <span className="live-value">
            {formatHeight(live.waveHeight, units.height)} {hUnit}
            {live.dominantPeriod != null && ` · ${fmt(live.dominantPeriod)} s`}
          </span>
          <span className="live-meta">
            {kmText(km)} · {formatAgo(live.time)}
          </span>
          {arrival && <span className="live-meta">sa houle arrive ici dans {arrival}</span>}
        </>
      ) : (
        <>
          <span className="live-value live-value-sm">Pas de mesure en ce moment</span>
          <span className="live-meta">
            {kmText(km)} · la bouée ne publie plus{obs ? ` ${sinceText(obs.time)}` : ''}
          </span>
        </>
      )}
    </button>
  );
}

/** La tuile de la webcam la plus proche : le lien vers l'image, et ce qu'elle filme. */
function WebcamTile({ near, here }: { near: Near<Place>; here: Selection }) {
  const { item: cam, km } = near;
  const filmed = useAsync(`${cam.id}`, () => filmedPlace(cam.lon, cam.lat));
  const thisOne = here.kind === 'beach' ? 'cette plage' : 'ce spot';
  const meta =
    filmed === undefined
      ? kmText(km)
      : filmed == null
        ? `${kmText(km)} · ${hostOf(cam.url) || 'site du diffuseur'}`
        : filmed.item.id === here.id
          ? `filme ${thisOne}`
          : `${kmText(km)} · filme ${filmed.item.name || 'un autre lieu'}, pas ${thisOne}`;
  return (
    <div className="live-tile">
      <span className="live-head">
        <Video size={15} aria-hidden="true" />
        <span className="live-name">{cam.name}</span>
      </span>
      {cam.url && (
        <a className="live-link" href={cam.url} target="_blank" rel="noreferrer">
          Voir l’image <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      )}
      <span className="live-meta">{meta}</span>
    </div>
  );
}

/**
 * « Le direct autour » : la bouée la plus proche à moins de 60 km et la webcam la plus proche à moins de
 * 30 km. Une tuile sans candidat n'apparaît pas, la section sans aucune tuile non plus.
 */
export function LiveAround({ selection, off }: { selection: Selection; off: number | undefined }) {
  const key = `${selection.lon},${selection.lat}`;
  const buoy = useAsync(key, async () => nearest(await loadBuoyPlaces(), selection.lon, selection.lat, 60, 1)[0] ?? null);
  const cam = useAsync(key, async () => nearest(await loadWebcamList(), selection.lon, selection.lat, 30, 1)[0] ?? null);
  if (!buoy && !cam) return null;
  return (
    <Section title="Le direct autour">
      <div className="live-tiles">
        {buoy && <BuoyTile near={buoy} place={selection} off={off} />}
        {cam && <WebcamTile near={cam} here={selection} />}
      </div>
    </Section>
  );
}

/* ----------------------------------------------------------------- résumés */

/** Le texte de l'heure d'un lieu, pour une étiquette : « à 22 h », « demain à 9 h ». */
export function atHourLabel(time: number): string {
  const { day, hour } = whenText(time);
  return day ? `${day} à ${hour}` : `à ${hour}`;
}
