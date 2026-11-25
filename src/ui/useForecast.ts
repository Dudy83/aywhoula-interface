import { useEffect, useState } from 'react';
import { getForecast, type PointForecast } from '../data/forecast';
import { reconcile, useAccount } from '../state/account';

/**
 * Prévision ponctuelle d'un point, pour le panneau comme pour la rose de sélection.
 * Les deux passent par le même cache de `getForecast` : un seul appel par point.
 * Elle se redemande quand le compte passe à Premium (16 jours, tous les modèles) ou le quitte.
 * Si le relais refuse la demande (402 : Premium s'est arrêté sans que l'appli le sache), l'état
 * du compte est redemandé, puis la prévision est refaite avec le droit qu'il a vraiment.
 */
export function useForecast(point: { lat: number; lon: number } | null) {
  const lat = point?.lat;
  const lon = point?.lon;
  const premium = useAccount((s) => s.me?.premium ?? false);
  // Tant que le compte n'est pas connu, on attend : la demande de la version gratuite serait à refaire.
  const known = useAccount((s) => s.status !== 'loading');
  const [state, setState] = useState<{ data: PointForecast | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    setState({ data: null, error: null });
    if (lat == null || lon == null || !known) return;
    let cancelled = false;
    getForecast(lat, lon, premium)
      .catch(async (err: unknown) => {
        if (!(await reconcile(err))) throw err;
        return getForecast(lat, lon, useAccount.getState().me?.premium ?? false);
      })
      .then(
        (data) => !cancelled && setState({ data, error: null }),
        (err: Error) => !cancelled && setState({ data: null, error: err.message }),
      );
    return () => {
      cancelled = true;
    };
  }, [lat, lon, premium, known]);
  return state;
}
