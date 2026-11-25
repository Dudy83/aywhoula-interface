/**
 * Le dialog d'une bouée : la dernière mesure, « Mesuré contre prévu » sur les 48 dernières heures (en barres
 * ou en courbes), les spots et plages où arrive la houle mesurée, et l'alerte sur la bouée.
 */
import { ChartColumn, ChartSpline, ChevronRight, ExternalLink, Minus, Thermometer, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BUOY_NETWORKS, loadBuoy, loadBuoyHistory, parseBuoyId, type BuoyHistoryPoint, type BuoyObs } from '../../data/buoys';
import { getRecentWaves, WAVE_FORECAST_MODELS, type Series } from '../../data/forecast';
import { durationText, fromWords, isLive, kmText, loadCoastPlaces, placeSelection, swellArrivals, useAsync } from '../../data/nearby';
import { cellColors, paletteGradient } from '../../data/palettes';
import { pickSeries } from '../../data/sea-state';
import { DAY, formatAgo, formatDay, formatDayMonth, formatHour, HOUR, startOfLocalDay } from '../../lib/time';
import { fmt, formatHeight, formatTemp, HEIGHT_UNIT_LABEL, heightValue, TEMP_UNIT_LABEL, type Units } from '../../lib/units';
import { newAlert, openOffer, useAccount, usePremium } from '../../state/account';
import { useStore, type BuoyView, type Selection } from '../../state/store';
import { areaFor, pathFor } from '../chart';
import { HEIGHT, Segmented } from '../common';
import { PremiumBadge } from '../Premium';
import { useForecast } from '../useForecast';
import { LinkRow, openPlace, PlaceIcon, pointAt, Section, useWidth } from './parts';

/** « depuis 06:30 », « depuis le lun. 23 nov. ». */
const since = (time: number): string => (startOfLocalDay(time) === startOfLocalDay(Date.now()) ? `depuis ${formatHour(time)}` : `depuis le ${formatDayMonth(time)}`);

const height = (m: number, units: Units) => `${formatHeight(m, units.height)} ${HEIGHT_UNIT_LABEL[units.height]}`;

/* ------------------------------------------------------------ dernière mesure */

/** L'évolution sur 6 heures : la mesure d'il y a 6 h (à une heure près) comparée à la dernière. */
function trendOf(obs: BuoyObs, history: BuoyHistoryPoint[]): number | null {
  if (obs.waveHeight == null) return null;
  const target = obs.time - 6 * HOUR;
  let best: BuoyHistoryPoint | null = null;
  for (const p of history) {
    if (p.waveHeight == null || Math.abs(p.time - target) > HOUR) continue;
    if (!best || Math.abs(p.time - target) < Math.abs(best.time - target)) best = p;
  }
  return best ? obs.waveHeight - best.waveHeight! : null;
}

function Measure({ obs, history, units }: { obs: BuoyObs; history: BuoyHistoryPoint[]; units: Units }) {
  const trend = trendOf(obs, history);
  const pills: [string, ReactNode, string][] = [];
  if (trend != null) {
    const steady = Math.abs(trend) < 0.05;
    pills.push([
      'trend',
      steady ? <Minus size={15} aria-hidden="true" /> : trend < 0 ? <TrendingDown size={15} aria-hidden="true" /> : <TrendingUp size={15} aria-hidden="true" />,
      steady ? 'Stable sur 6 h' : `${trend < 0 ? 'En baisse' : 'En hausse'} : ${height(Math.abs(trend), units)} en 6 h`,
    ]);
  }
  if (obs.maxWaveHeight != null) pills.push(['max', null, `Plus haute vague ${height(obs.maxWaveHeight, units)}`]);
  if (obs.waterTemperature != null) pills.push(['water', <Thermometer size={15} aria-hidden="true" />, `Eau ${formatTemp(obs.waterTemperature, units.temp)} ${TEMP_UNIT_LABEL[units.temp]}`]);
  return (
    <section className="measure-card" aria-label="Dernière mesure">
      <p className="measure-when">
        Mesuré {formatAgo(obs.time)}
        {isLive(obs) && <span className="live-dot" role="img" aria-label="mesure de moins de 2 heures" />}
      </p>
      <p className="measure-main">
        <span className="measure-value">{height(obs.waveHeight ?? NaN, units)}</span>
        <span className="measure-sub">{[obs.dominantPeriod == null ? '' : `${fmt(obs.dominantPeriod)} s`, obs.waveDirection == null ? '' : fromWords(obs.waveDirection)].filter(Boolean).join(' · ')}</span>
      </p>
      {pills.length > 0 && (
        <div className="measure-pills">
          {pills.map(([key, icon, text]) => (
            <span key={key} className="measure-pill">
              {icon}
              {text}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------- mesuré contre prévu */

interface Compared {
  /** Le milieu de chaque heure des 48 dernières (ms), de la plus ancienne à la plus récente. */
  hours: number[];
  /** La moyenne des relevés de chaque heure (m), ou `null`. */
  measured: (number | null)[];
  /** La prévision à chaque heure (m), ou `null`. */
  forecast: (number | null)[];
}

const WINDOW_HOURS = 48;

/** Les 48 dernières heures : la moyenne des relevés de chaque heure, et la prévision à la même heure. */
function compare(history: BuoyHistoryPoint[], times: number[] | null, values: Series | null, now: number): Compared {
  const last = Math.floor(now / HOUR) * HOUR;
  const hours = Array.from({ length: WINDOW_HOURS }, (_, k) => last - (WINDOW_HOURS - 1 - k) * HOUR);
  const sums = hours.map(() => ({ sum: 0, count: 0 }));
  for (const p of history) {
    if (p.waveHeight == null) continue;
    const k = Math.round((p.time - hours[0]) / HOUR);
    if (k < 0 || k >= WINDOW_HOURS) continue;
    sums[k].sum += p.waveHeight;
    sums[k].count++;
  }
  const byTime = new Map<number, number>();
  if (times && values) times.forEach((t, i) => values[i] != null && byTime.set(t, values[i]!));
  return {
    hours,
    measured: sums.map((s) => (s.count ? s.sum / s.count : null)),
    forecast: hours.map((t) => byTime.get(t) ?? null),
  };
}

/** Les minuits locaux qui tombent dans la fenêtre. */
function midnights(t0: number, t1: number): number[] {
  const out: number[] = [];
  for (let t = startOfLocalDay(startOfLocalDay(t0) + DAY + 3 * HOUR); t < t1; t = startOfLocalDay(t + DAY + 3 * HOUR)) out.push(t);
  return out;
}

function CompareChart({ data, history, view, units }: { data: Compared; history: BuoyHistoryPoint[]; view: BuoyView; units: Units }) {
  const [host, width] = useWidth<HTMLDivElement>(420);
  const H = 116;
  const t0 = data.hours[0] - HOUR / 2;
  const t1 = data.hours[data.hours.length - 1] + HOUR / 2;
  const raw = history.filter((p) => p.waveHeight != null && p.time >= t0 && p.time <= t1);
  const all = [...data.measured, ...data.forecast, ...(view === 'curves' ? raw.map((p) => p.waveHeight) : [])].filter((v): v is number => v != null);
  const max = Math.max(1, ...all.map((m) => heightValue(m, units.height)));
  const step = max <= 5 ? 1 : max <= 10 ? 2 : 5;
  const top = Math.ceil((max * 1.08) / step) * step;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * width;
  const y = (m: number) => H - (heightValue(m, units.height) / top) * (H - 4);
  const barW = width / data.hours.length;
  const fcIdx = data.forecast.map((v, k) => (v == null ? -1 : k)).filter((k) => k >= 0);
  const fcPath = pathFor(
    data.hours.map((t) => x(t)),
    data.forecast.map((v) => (v == null ? null : y(v))),
  );
  const lastFc = fcIdx.length ? fcIdx[fcIdx.length - 1] : -1;
  const grid: number[] = [];
  for (let v = step; v <= top; v += step) grid.push(v);
  const days = midnights(t0, t1);
  const edges = [t0, ...days, t1];

  // Les courbes : un relevé muet plus de trois pas de mesure coupe le trait.
  const steps = raw.slice(1).map((p, i) => p.time - raw[i].time).sort((a, b) => a - b);
  const maxGap = steps.length ? 3 * steps[steps.length >> 1] : HOUR;
  const runs: BuoyHistoryPoint[][] = [];
  for (const p of raw) {
    const run = runs[runs.length - 1];
    if (run && p.time - run[run.length - 1].time <= maxGap) run.push(p);
    else runs.push([p]);
  }

  return (
    <div className="compare-chart" ref={host}>
      <svg width={width} height={H + 20} viewBox={`0 0 ${width} ${H + 20}`} role="img" aria-label={`Hauteur des vagues mesurée par la bouée et prévue, sur ${WINDOW_HOURS} heures`}>
        {grid.map((v) => (
          <line key={v} className="ov-grid" x1={0} x2={width} y1={H - (v / top) * (H - 4)} y2={H - (v / top) * (H - 4)} />
        ))}
        {days.map((t) => (
          <line key={t} className="compare-midnight" x1={x(t)} x2={x(t)} y1={0} y2={H} />
        ))}
        {view === 'bars'
          ? data.hours.map((t, k) => {
              const v = data.measured[k];
              if (v == null) return null;
              return <rect key={t} x={x(t) - barW / 2 + 0.75} y={y(v)} width={Math.max(1, barW - 1.5)} height={H - y(v)} rx={1} fill={cellColors(HEIGHT, v)?.background} />;
            })
          : runs.map((run) => {
              const xs = run.map((p) => x(p.time));
              const ys = run.map((p) => y(p.waveHeight!));
              return (
                <g key={run[0].time}>
                  <path className="ov-area" d={areaFor(xs, ys, H)} />
                  <path className="ov-line" d={pathFor(xs, ys)} />
                </g>
              );
            })}
        <line className="ov-base" x1={0} x2={width} y1={H} y2={H} />
        {/* L'échelle par-dessus les barres, lisible sur leurs couleurs. */}
        {grid.map((v) => (
          <text key={v} className="compare-scale" x={2} y={H - (v / top) * (H - 4) - 3}>
            {fmt(v)} {HEIGHT_UNIT_LABEL[units.height]}
          </text>
        ))}
        <path className="compare-forecast" d={fcPath} />
        {lastFc >= 0 && <circle className="compare-forecast-dot" cx={x(data.hours[lastFc])} cy={y(data.forecast[lastFc]!)} r={4} />}
        {edges.slice(0, -1).map((start, k) => {
          const end = edges[k + 1];
          if (x(end) - x(start) < 44) return null;
          return (
            <text key={start} className="compare-day" x={(x(start) + x(end)) / 2} y={H + 15} textAnchor="middle">
              {formatDay(start + HOUR)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/** « 0,4 m de plus que la mesure », « autant que la mesure ». */
function gapText(diff: number, units: Units): string {
  if (Math.abs(diff) < 0.05) return 'autant que la mesure';
  return `${height(Math.abs(diff), units)} de ${diff > 0 ? 'plus' : 'moins'} que la mesure`;
}

function CompareSection({ selection, obs, history }: { selection: Selection; obs: BuoyObs | null; history: BuoyHistoryPoint[] }) {
  const { data: fc } = useForecast(selection);
  const mapModels = useStore((s) => s.models);
  const choice = useStore((s) => s.forecastChoice);
  const units = useStore((s) => s.units);
  const view = useStore((s) => s.buoyView);
  const setView = useStore((s) => s.setBuoyView);
  const premium = usePremium();
  const known = useAccount((s) => s.status !== 'loading');
  // Le modèle de la carte, sans relais : celui de la barre du bas.
  const picked = useMemo(() => (fc ? pickSeries(fc, choice, mapModels) : null), [fc, choice, mapModels]);
  const waveKey = picked?.waveKey ?? null;
  const model = WAVE_FORECAST_MODELS.find((m) => m.key === waveKey)?.label ?? 'le modèle';
  // Ce que ce modèle prévoyait sur les deux derniers jours : une demande à part, la prévision du point
  // commençant à minuit (temps universel). Sans elle, la prévision du point, sur les heures qu'elle couvre.
  const recent = useAsync(waveKey && known ? `${waveKey}|${premium}|${selection.lat},${selection.lon}` : null, () =>
    getRecentWaves(selection.lat, selection.lon, waveKey!, premium).catch(() => null),
  );
  const series = useMemo(() => (recent?.times.length ? recent : fc && picked?.wave ? { times: fc.times, height: picked.wave.height } : null), [recent, fc, picked]);
  const [now] = useState(() => Date.now());
  const data = useMemo(() => compare(history, series?.times ?? null, series?.height ?? null, now), [history, series, now]);
  const measuredHours = data.measured.filter((v) => v != null).length;

  // En ce moment : la prévision à l'heure de la dernière mesure, comparée à elle.
  let current: { value: number; diff: number } | null = null;
  if (obs?.waveHeight != null && series) {
    let best = -1;
    series.times.forEach((t, i) => {
      if (series.height[i] != null && Math.abs(t - obs.time) <= HOUR && (best < 0 || Math.abs(t - obs.time) < Math.abs(series.times[best] - obs.time))) best = i;
    });
    if (best >= 0) current = { value: series.height[best]!, diff: series.height[best]! - obs.waveHeight };
  }
  // Sur les heures où l'on a les deux : l'écart moyen de la prévision. « Sur 48 h » dès que la bouée a
  // mesuré sur les 48 heures ; sinon, le nombre d'heures comparées.
  const pairs = data.hours.map((_, k) => (data.measured[k] != null && data.forecast[k] != null ? data.forecast[k]! - data.measured[k]! : null)).filter((v): v is number => v != null);
  const bias = pairs.length >= 3 ? pairs.reduce((a, b) => a + b, 0) / pairs.length : null;
  const span = measuredHours >= WINDOW_HOURS - 1 && pairs.length >= WINDOW_HOURS - 1 ? WINDOW_HOURS : pairs.length;
  if (measuredHours < 2 && !current) return null;

  return (
    <Section
      title="Mesuré contre prévu"
      action={
        measuredHours >= 2 ? (
          <Segmented<BuoyView>
            label="Affichage des mesures"
            value={view}
            onChange={setView}
            iconOnly
            options={[
              { value: 'bars', label: 'Barres', icon: <ChartColumn size={15} aria-hidden="true" /> },
              { value: 'curves', label: 'Courbes', icon: <ChartSpline size={15} aria-hidden="true" /> },
            ]}
          />
        ) : undefined
      }
    >
      {measuredHours >= 2 && (
        <>
          <CompareChart data={data} history={history} view={view} units={units} />
          <p className="compare-legend">
            <span>
              {view === 'bars' ? <span className="compare-key-bars" style={{ background: paletteGradient(HEIGHT, 6) }} /> : <span className="compare-key-line" />}
              Mesuré par la bouée
            </span>
            {picked?.wave && (
              <span>
                <span className="compare-key-forecast" />
                Prévu par {model}
              </span>
            )}
            <span className="compare-span">{measuredHours >= WINDOW_HOURS - 1 ? `${WINDOW_HOURS} h` : `${measuredHours} h`}</span>
          </p>
        </>
      )}
      {(current || bias != null) && (
        <p className="compare-note">
          {current && (
            <>
              En ce moment, {model} prévoit <b>{height(current.value, units)}</b> : {gapText(current.diff, units)}.{' '}
            </>
          )}
          {bias != null &&
            (Math.abs(bias) < 0.05
              ? `Sur ${span} h, il prévoit en moyenne autant que la mesure.`
              : `Sur ${span} h, il ${bias > 0 ? 'surestime' : 'sous-estime'} la houle de ${height(Math.abs(bias), units)} en moyenne.`)}
        </p>
      )}
    </Section>
  );
}

/* --------------------------------------------------- la houle arrive à la côte */

function Arrivals({ buoy, obs }: { buoy: Selection; obs: BuoyObs }) {
  const from = obs.waveDirection!;
  const period = obs.dominantPeriod!;
  const list = useAsync(`${buoy.id}|${from}|${period}`, async () => swellArrivals(await loadCoastPlaces(), buoy, from, period));
  if (!list || list.length === 0) return null;
  return (
    <Section title="Cette houle arrive à la côte">
      <div className="info-list">
        {list.map(({ place, km, minutes }) => {
          const kind = place.kind === 'spot' ? 'Spot' : 'Plage';
          return (
            <LinkRow
              key={place.id}
              icon={<PlaceIcon kind={place.kind} />}
              title={place.name || `${kind} sans nom`}
              detail={`${kind} · de face · ${kmText(km, true)}`}
              value={durationText(minutes)}
              label={`${place.name || `${kind} sans nom`}, ${kind.toLowerCase()} à ${kmText(km, true)} : la houle y arrive dans ${durationText(minutes)}`}
              onClick={() => openPlace(placeSelection(place))}
            />
          );
        })}
      </div>
      <p className="place-note">Houle de {fmt(period)} s mesurée ici : temps de trajet jusqu’aux spots et plages qui lui font face.</p>
    </Section>
  );
}

/* --------------------------------------------------------------------- alerte */

function BuoyAlert({ selection }: { selection: Selection }) {
  const premium = usePremium();
  const units = useStore((s) => s.units);
  return (
    <button type="button" className="buoy-alert" onClick={() => (premium ? newAlert(pointAt(selection)) : openOffer())}>
      <span className="info-text">
        <b>Alerte sur cette bouée</b>
        <span>préviens-moi quand elle passe {height(2.5, units)} à 10 s</span>
      </span>
      {premium ? <ChevronRight size={16} aria-hidden="true" className="info-chevron" /> : <PremiumBadge />}
    </button>
  );
}

/* --------------------------------------------------------------------- bouée */

export function BuoyBody({ selection }: { selection: Selection }) {
  const id = selection.id;
  const { source, station } = parseBuoyId(id);
  const network = BUOY_NETWORKS[source];
  const units = useStore((s) => s.units);
  const [obs, setObs] = useState<BuoyObs | null | undefined>(undefined);
  const [history, setHistory] = useState<BuoyHistoryPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    setObs(undefined);
    setHistory([]);
    loadBuoy(id).then(
      (b) => !cancelled && setObs(b),
      () => !cancelled && setObs(null),
    );
    loadBuoyHistory(id).then(
      (h) => !cancelled && setHistory(h),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (obs === undefined) {
    return (
      <div className="skeleton" aria-busy="true" aria-label="Chargement des mesures">
        <div className="skeleton-block" />
        <div className="skeleton-chart" />
      </div>
    );
  }

  const lastSeen = history.length ? history[history.length - 1].time : null;
  return (
    <>
      {obs ? (
        <Measure obs={obs} history={history} units={units} />
      ) : (
        <section className="measure-card" aria-label="Dernière mesure">
          <p className="measure-main">
            <span className="measure-value measure-value-sm">Pas de mesure en ce moment</span>
          </p>
          <p className="measure-when">La bouée ne publie plus{lastSeen ? ` ${since(lastSeen)}` : ''}.</p>
          <a className="place-out" href={network.url(station)} target="_blank" rel="noreferrer">
            {network.linkLabel(station)} <ExternalLink size={14} aria-hidden="true" />
          </a>
        </section>
      )}
      <CompareSection selection={selection} obs={obs} history={history} />
      {obs && isLive(obs) && obs.waveDirection != null && obs.dominantPeriod != null && <Arrivals buoy={selection} obs={obs} />}
      <BuoyAlert selection={selection} />
    </>
  );
}
