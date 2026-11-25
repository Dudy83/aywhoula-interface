/**
 * Le dialog d'un spot ou d'une plage : les conditions à l'heure de la carte (houle, vent, marée, eau pour une
 * plage, nuit), la marée du jour et le direct autour ; sur ordinateur seulement, les spots ou les plages
 * autour ; pour un spot, sa fiche.
 */
import { ArrowUpRight, Droplets, Moon, Thermometer, Waves, Wind } from 'lucide-react';
import type { ReactNode } from 'react';
import { fromLand, fromWords, goodConditions, kmText, nearest, placeSelection, useAsync } from '../../data/nearby';
import { at } from '../../data/sea-state';
import { loadBeaches, loadSpots, normalize, type Place } from '../../data/places';
import { formatHour, startOfLocalDay } from '../../lib/time';
import { fmt, formatHeight, formatWind, HEIGHT_UNIT_LABEL, TEMP_UNIT_LABEL, tempValue, windValue, WIND_UNIT_LABEL, type Units } from '../../lib/units';
import { useStore, type Selection } from '../../state/store';
import { atTitle, InfoRow, LinkRow, LiveAround, nextLocalDay, openPlace, Section, TideDay, usePlace, usePlaceNow, type Status } from './parts';

/** Les sports d'un spot : ceux du fichier, sinon ceux de son libellé (« Surf · Kitesurf »). */
export function sportsOf(place: Place | null | undefined, selection: Selection): string[] {
  if (place?.sports) return place.sports.split(',').filter(Boolean);
  const words: Record<string, string> = { surf: 'surf', kitesurf: 'kite', windsurf: 'windsurf' };
  return (selection.detail ?? '')
    .toLowerCase()
    .split(' · ')
    .map((w) => words[w])
    .filter(Boolean);
}

const SPORT_NOUN: Record<string, string> = { surf: 'surf', kite: 'kitesurf', windsurf: 'windsurf' };

/** « Spot de surf », « Spot de surf et de kitesurf ». */
export function spotKindLabel(sports: string[]): string {
  const nouns = sports.map((s) => `de ${SPORT_NOUN[s] ?? s}`);
  if (nouns.length === 0) return 'Spot';
  return `Spot ${nouns.length === 1 ? nouns[0] : `${nouns.slice(0, -1).join(', ')} et ${nouns[nouns.length - 1]}`}`;
}

/** Le sport dont un spot suit les règles : le surf s'il y est pratiqué, sinon le premier. */
const mainSport = (sports: string[]): string => (sports.length === 0 || sports.includes('surf') ? 'surf' : sports[0]);

/** Une ligne des conditions ; `short` sert au résumé de la petite carte. */
export interface ConditionLine {
  title: string;
  detail: string;
  status: Status;
  short?: string;
}

type Now = ReturnType<typeof usePlaceNow>;

/**
 * La houle : « de face » quand le secteur d'où elle vient est côté mer, « de biais » sinon ; verte de face
 * et ambre de biais pour le surf, grise pour un spot sans surf ou d'orientation inconnue.
 */
export function swellLine(now: Now, off: number | undefined, units: Units, surf: boolean): ConditionLine | null {
  const i = now.index;
  const height = i < 0 ? null : at(now.sea?.height, i);
  if (height == null) return null;
  const period = at(now.sea?.period, i);
  const from = at(now.sea?.direction, i);
  const land = fromLand(off, from);
  const title = land == null ? 'Houle' : land ? 'Houle de biais' : 'Houle de face';
  const value = `${formatHeight(height, units.height)} ${HEIGHT_UNIT_LABEL[units.height]}`;
  return {
    title,
    detail: [value, period == null ? '' : `${fmt(period)} s`, from == null ? '' : fromWords(from)].filter(Boolean).join(' · '),
    status: !surf || land == null ? 'neutral' : land ? 'watch' : 'good',
    short: `${title} ${value}`,
  };
}

/**
 * Le vent : « de terre » quand le secteur d'où il vient est côté terre, « de mer » sinon. Pour le surf, vert
 * de terre et ambre de mer ; pour le kitesurf et le windsurf, vert de 12 à 25 nœuds quand il ne vient pas de
 * la terre, ambre sinon.
 */
export function windLine(now: Now, off: number | undefined, units: Units, surf: boolean): ConditionLine | null {
  const i = now.index;
  const speed = i < 0 ? null : at(now.wind?.speed, i);
  if (speed == null) return null;
  const gust = at(now.wind?.gust, i);
  const from = at(now.wind?.direction, i);
  const land = fromLand(off, from);
  const title = land == null ? 'Vent' : land ? 'Vent de terre' : 'Vent de mer';
  const unit = WIND_UNIT_LABEL[units.wind];
  const knots = windValue(speed, 'kn');
  return {
    title,
    detail: `${formatWind(speed, units.wind)} ${unit}${gust == null ? '' : `, rafales ${formatWind(gust, units.wind)}`}${from == null ? '' : ` · ${fromWords(from)}`}`,
    status: surf ? (land == null ? 'neutral' : land ? 'good' : 'watch') : land === false && knots >= 12 && knots <= 25 ? 'good' : 'watch',
    short: `${title.charAt(0).toLowerCase()}${title.slice(1)} ${formatWind(speed, units.wind)} ${unit}`,
  };
}

/** La marée : montante ou descendante, et la prochaine pleine ou basse mer du jour, sinon la dernière passée. */
function tideLine(now: Now): ConditionLine | null {
  if (!now.fc?.seaLevel || now.extremes.length === 0) return null;
  const t = now.time;
  const next = now.extremes.find((e) => e.time > t);
  const last = [...now.extremes].reverse().find((e) => e.time <= t);
  const rising = next ? next.high : last ? !last.high : null;
  if (rising == null) return null;
  const today = next && next.time < nextLocalDay(startOfLocalDay(t)) ? next : null;
  const name = (high: boolean) => (high ? 'pleine mer' : 'basse mer');
  return {
    title: rising ? 'Marée montante' : 'Marée descendante',
    detail: today ? `${name(today.high)} à ${formatHour(today.time)}` : last ? `${name(last.high)} passée à ${formatHour(last.time)}` : '',
    status: 'neutral',
  };
}

/** La combinaison selon l'eau : 22 °C et plus sans, puis 3/2, 4/3, 5/4 et chaussons, 6/5 avec gants et cagoule. */
function wetsuit(celsius: number): string {
  if (celsius >= 22) return 'sans combinaison';
  if (celsius >= 18) return 'combinaison 3/2';
  if (celsius >= 15) return 'combinaison 4/3';
  if (celsius >= 12) return 'combinaison 5/4 et chaussons';
  return 'combinaison 6/5, gants et cagoule';
}

const temp = (c: number, units: Units) => `${fmt(tempValue(c, units.temp), 1)} ${TEMP_UNIT_LABEL[units.temp]}`;

function waterLine(now: Now, units: Units): ConditionLine | null {
  const water = now.index < 0 ? null : at(now.fc?.seaTemperature, now.index);
  if (water == null) return null;
  const air = at(now.wind?.temperature, now.index);
  return { title: `Eau ${temp(water, units)}`, detail: [wetsuit(water), air == null ? '' : `air ${temp(air, units)}`].filter(Boolean).join(' · '), status: 'neutral' };
}

/** « De nuit », seulement entre le coucher et le lever du soleil. */
function nightLine(now: Now): ConditionLine | null {
  const sun = now.fc?.sun ?? [];
  const t = now.time;
  const k = sun.findIndex((s) => startOfLocalDay(s.rise) === startOfLocalDay(t));
  if (k < 0) return null;
  let set: number | null = null;
  let rise: number | null = null;
  if (t >= sun[k].set) {
    set = sun[k].set;
    rise = sun[k + 1]?.rise ?? null;
  } else if (t < sun[k].rise) {
    set = sun[k - 1]?.set ?? null;
    rise = sun[k].rise;
  } else return null;
  return { title: 'De nuit', detail: [set == null ? '' : `coucher ${formatHour(set)}`, rise == null ? '' : `lever ${formatHour(rise)}`].filter(Boolean).join(', '), status: 'night' };
}

/**
 * Ce que la petite carte résume d'un spot ou d'une plage, en morceaux : « Houle de face 1,5 m », « vent de
 * terre 14 nd ». Vide tant que la prévision n'est pas là.
 */
export function useSpotSummary(selection: Selection): string[] {
  const place = usePlace(selection);
  const now = usePlaceNow(selection);
  const units = useStore((s) => s.units);
  const surf = mainSport(sportsOf(place, selection)) === 'surf';
  return [swellLine(now, place?.off, units, surf)?.short, windLine(now, place?.off, units, surf)?.short].filter((p): p is string => !!p);
}

function SpotsAround({ selection }: { selection: Selection }) {
  const list = useAsync(`spots|${selection.id}`, async () =>
    nearest(await loadSpots().catch(() => [] as Place[]), selection.lon, selection.lat, 60, 3, (p) => p.id !== selection.id),
  );
  if (!list || list.length === 0) return null;
  return (
    <Section title="Spots autour">
      <div className="info-list">
        {list.map(({ item, km }) => (
          <LinkRow
            key={item.id}
            icon={<Waves size={16} />}
            title={item.name || 'Spot sans nom'}
            detail={spotKindLabel(sportsOf(item, placeSelection(item)))}
            value={kmText(km)}
            label={`${item.name || 'Spot sans nom'}, ${spotKindLabel(sportsOf(item, placeSelection(item))).toLowerCase()}, à ${kmText(km)}`}
            onClick={() => openPlace(placeSelection(item))}
          />
        ))}
      </div>
    </Section>
  );
}

/**
 * Les plages à moins de 2 km, une par nom (OpenStreetMap a souvent deux entrées pour une même plage) : la
 * plus proche de chaque nom, trois au plus ; une plage sans nom compte pour elle-même. Puis le spot de surf
 * le plus proche, à moins de 30 km : le fichier des spots est trop maigre pour en dire plus au-delà.
 */
function BeachesAround({ selection }: { selection: Selection }) {
  const around = useAsync(`beaches|${selection.id}`, async () => {
    const [beaches, spots] = await Promise.all([loadBeaches().catch(() => [] as Place[]), loadSpots().catch(() => [] as Place[])]);
    // Le nom de cette plage est déjà pris : une autre entrée du même nom ne s'affiche pas à côté d'elle.
    const seen = new Set(selection.name ? [normalize(selection.name)] : []);
    const distinct = nearest(beaches, selection.lon, selection.lat, 2, Infinity, (p) => p.id !== selection.id).filter(({ item }) => {
      if (!item.name) return true;
      if (seen.has(item.norm)) return false;
      seen.add(item.norm);
      return true;
    });
    return {
      beaches: distinct.slice(0, 3),
      surf: nearest(spots, selection.lon, selection.lat, 30, 1, (p) => (p.sports ?? '').split(',').includes('surf'))[0] ?? null,
    };
  });
  if (!around || (around.beaches.length === 0 && !around.surf)) return null;
  return (
    <Section title="Autour de la plage">
      {around.beaches.length > 0 && (
        <div className="place-pills">
          {around.beaches.map(({ item, km }) => (
            <button key={item.id} type="button" className="place-pill" onClick={() => openPlace(placeSelection(item))}>
              {item.name || 'Plage sans nom'} · {kmText(km)}
            </button>
          ))}
        </div>
      )}
      {around.surf && (
        <p className="place-note">
          Spot de surf le plus proche : {around.surf.item.name || 'un spot sans nom'}, à {kmText(around.surf.km)}.
        </p>
      )}
    </Section>
  );
}

function SpotSheet({ selection, off }: { selection: Selection; off: number | undefined }) {
  const good = goodConditions(off);
  return (
    <Section title="La fiche du spot">
      {good && (
        <p className="place-text">
          <b>Bonnes conditions</b> : {good}.
        </p>
      )}
      <a className="place-out" href={`/api/site/spot/${encodeURIComponent(selection.id)}`} target="_blank" rel="noreferrer">
        Lire la fiche sur aywhoula.com <ArrowUpRight size={15} aria-hidden="true" />
      </a>
    </Section>
  );
}

export function SpotBody({ selection, wide }: { selection: Selection; wide: boolean }) {
  const place = usePlace(selection);
  const now = usePlaceNow(selection);
  const units = useStore((s) => s.units);
  const isSpot = selection.kind === 'spot';

  if (now.error) {
    return (
      <div className="panel-message" role="alert">
        <p>Impossible de charger la prévision de ce lieu.</p>
        <p className="panel-message-detail">{now.error}</p>
      </div>
    );
  }
  if (!now.fc || place === undefined) return <PlaceSkeleton />;

  const off = place?.off;
  const sport = mainSport(sportsOf(place, selection));
  const surf = sport === 'surf';
  const lines: [ConditionLine | null, ReactNode][] = [
    [swellLine(now, off, units, surf), <Waves key="s" size={18} />],
    [windLine(now, off, units, surf), <Wind key="w" size={18} />],
    [tideLine(now), <Droplets key="t" size={18} />],
    [isSpot ? null : waterLine(now, units), <Thermometer key="e" size={18} />],
    [nightLine(now), <Moon key="n" size={18} />],
  ];
  const shown = lines.filter((l): l is [ConditionLine, ReactNode] => l[0] != null);
  const conditions = (
    <Section
      title={atTitle(now.index >= 0 ? now.fc.times[now.index] : now.time, isSpot ? 'au spot' : 'à la plage')}
      hint={isSpot ? `pour le ${SPORT_NOUN[sport] ?? sport}` : 'suit la ligne de temps'}
      label="Conditions à l’heure de la carte"
    >
      {shown.length > 0 ? (
        <div className="info-list">
          {shown.map(([line, icon]) => (
            <InfoRow key={line.title} icon={icon} title={line.title} detail={line.detail} status={line.status} />
          ))}
        </div>
      ) : (
        <p className="place-note">Pas de prévision à cette heure pour ce lieu.</p>
      )}
    </Section>
  );
  const tide = <TideDay fc={now.fc} time={now.time} extremes={now.extremes} />;
  const live = <LiveAround selection={selection} off={off} />;

  return isSpot ? (
    <>
      {conditions}
      {live}
      {tide}
      {wide && <SpotsAround selection={selection} />}
      <SpotSheet selection={selection} off={off} />
    </>
  ) : (
    <>
      {conditions}
      {tide}
      {live}
      {wide && <BeachesAround selection={selection} />}
    </>
  );
}

export function PlaceSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Chargement">
      <div className="skeleton-line" style={{ width: '40%' }} />
      <div className="skeleton-row" />
      <div className="skeleton-row" />
      <div className="skeleton-row" />
      <div className="skeleton-chart" />
    </div>
  );
}
