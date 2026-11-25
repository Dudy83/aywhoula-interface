/**
 * Le client de Better-Auth : c'est par lui que l'appli demande un code, se connecte (par le code ou par
 * Google) et se déconnecte. Il parle à `/api/auth`, sur l'origine de l'appli comme tous ses appels, et ne
 * garde rien : l'état du compte reste celui de `/api/me` (`account.ts`).
 */
import { createAuthClient } from 'better-auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';
import { ApiError } from '../data/api';

export const authClient = createAuthClient({ baseURL: window.location.origin, plugins: [emailOTPClient()] });

/** Ce que rend un appel du client : la réponse, ou l'erreur de Better-Auth (`code` pour celles qu'il nomme). */
interface AuthResult<T> {
  data: T | null;
  error: { status: number; code?: string; message?: string } | null;
}

const FALLBACK = 'Une erreur est survenue. Réessayez dans un instant.';

/**
 * Attend un appel du client et rend sa réponse, ou lève une `ApiError` qui porte la phrase à montrer.
 * Better-Auth répond en anglais, avec un code : `phrases` donne la phrase de l'appli pour un code, sinon
 * pour un statut HTTP, sinon sous `default`. Les refus qu'écrit le serveur d'Aywhoula (`own` : plafonds
 * d'envoi, email qui ne part pas) portent déjà la leur.
 */
export async function authCall<T>(call: Promise<AuthResult<T>>, phrases: Record<string, string> = {}, own: string[] = []): Promise<T> {
  let result: AuthResult<T>;
  try {
    result = await call;
  } catch {
    throw new ApiError(0, 'offline', 'Connexion impossible. Vérifiez votre réseau, puis réessayez.');
  }
  const { data, error } = result;
  if (!error) return data as T;
  const code = error.code ?? 'server';
  const message = (own.includes(code) && error.message) || phrases[code] || phrases[error.status] || phrases.default || FALLBACK;
  throw new ApiError(error.status, code, message);
}
