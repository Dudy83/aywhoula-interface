/**
 * Appels à l'API de l'appli (`/api/...`, même origine : le cookie de session part tout seul).
 * Les erreurs arrivent en JSON, `{ error, message }`, avec une phrase en français à montrer.
 */

export class ApiError extends Error {
  constructor(
    /** Code HTTP ; 0 quand le serveur n'a pas pu être joint. */
    readonly status: number,
    readonly code: string,
    message: string,
    /** Vrai pour un 402 : la demande exige Premium. */
    readonly premium = false,
  ) {
    super(message);
  }
}

interface ErrorBody {
  error?: string;
  message?: string;
  premium?: boolean;
}

export async function api<T>(path: string, init: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; json?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.json === undefined ? 'GET' : 'POST'),
      headers: init.json === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      credentials: 'same-origin',
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'offline', 'Connexion impossible. Vérifiez votre réseau, puis réessayez.');
  }
  const body = (await res.json().catch(() => null)) as (T & ErrorBody) | null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? 'server', body?.message ?? `Erreur ${res.status}`, body?.premium === true);
  }
  return body as T;
}

/** Le message à montrer pour une erreur, d'où qu'elle vienne. */
export function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Une erreur est survenue. Réessayez dans un instant.';
}
