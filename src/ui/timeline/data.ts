/**
 * Les données de la ligne de temps : la prévision du point (celle de « Vagues et vent », qui donne aussi les
 * heures), et pour les autres types leur propre demande, faite quand on les choisit (`getDetailSeries`).
 */
import { useMemo } from 'react';
import { getDetailSeries, type DetailProfile, type DetailSeries, type Series } from '../../data/forecast';
import { useAsync, useForecastPoint } from '../../data/nearby';
import { pickSeries, seaOf, totalOf } from '../../data/sea-state';
import { useAccount } from '../../state/account';
import { useStore } from '../../state/store';
import { useForecast } from '../useForecast';

/** Les séries d'un type sur les heures de la prévision du point : une colonne du tableau, un point des courbes. */
function onTimes(times: number[], detail: DetailSeries): Record<string, Series> {
  const index = new Map(detail.times.map((t, k) => [t, k]));
  const out: Record<string, Series> = {};
  for (const [name, series] of Object.entries(detail.values)) {
    out[name] = times.map((t) => {
      const k = index.get(t);
      return k == null ? null : (series[k] ?? null);
    });
  }
  return out;
}

/**
 * Le lieu de la ligne de temps et ses séries, avec le modèle de la carte pour chaque famille : le lieu ouvert,
 * sinon le dernier ouvert ; la prévision d'une webcam est celle du lieu qu'elle filme. `d` : les séries du
 * type choisi, par nom de variable, `null` pour « Vagues et vent » ou tant qu'elles ne sont pas là.
 */
export function useTimelineData() {
  const selection = useStore((s) => s.selection);
  const last = useStore((s) => s.lastSelection);
  const choice = useStore((s) => s.forecastChoice);
  const mapModels = useStore((s) => s.models);
  const profile = useStore((s) => s.timelineProfile);
  const premium = useAccount((s) => s.me?.premium ?? false);
  const known = useAccount((s) => s.status !== 'loading');
  const place = selection ?? last;
  const point = useForecastPoint(place);
  const { data: fc } = useForecast(point);
  // Sans heure à couvrir, pas de relais : le modèle de la carte, jusqu'où il va.
  const picked = useMemo(() => (fc ? pickSeries(fc, choice, mapModels) : null), [fc, choice, mapModels]);
  const wave = picked?.wave ?? null;
  const sea = useMemo(() => seaOf(wave), [wave]);
  const total = useMemo(() => totalOf(wave, sea), [wave, sea]);

  // Le type a sa demande : la houle sur le modèle de vagues de la carte, le vent et la météo sur son modèle
  // d'atmosphère, la marée et le courant sans modèle.
  const detailProfile: DetailProfile | null = profile === 'waves' ? null : profile;
  const model = detailProfile === 'swell' ? (picked?.waveKey ?? null) : detailProfile === 'tide' ? null : (picked?.windKey ?? null);
  const ready = detailProfile != null && fc != null && point != null && known && (detailProfile === 'tide' || model != null);
  const key = ready ? `${detailProfile}|${model}|${premium}|${point.lat.toFixed(3)},${point.lon.toFixed(3)}` : null;
  const detail = useAsync(key, () => getDetailSeries(detailProfile!, point!.lat, point!.lon, model, premium).catch(() => null));
  const d = useMemo(() => (fc && detail ? onTimes(fc.times, detail) : null), [fc, detail]);

  return { place, fc, profile, wave, sea, total, wind: picked?.wind ?? null, d, loading: key != null && detail === undefined };
}

export type TimelineData = ReturnType<typeof useTimelineData>;
