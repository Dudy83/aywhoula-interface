/**
 * Une adresse qui s'ouvre dans le navigateur, en `http:` ou `https:`, rien d'autre (ni `javascript:`, ni
 * `data:`) : ce qu'on accepte pour un lien venu des données ou d'un favori (l'image d'une webcam). Le serveur
 * applique la même règle aux favoris (`isWebUrl` de `server/src/routes/me.ts`).
 */
export function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
