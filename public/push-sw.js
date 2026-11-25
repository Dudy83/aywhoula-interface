/*
 * Notifications des alertes. Ce fichier est chargé par le service worker que
 * vite-plugin-pwa génère au build (`importScripts` dans vite.config.ts) : il n'y
 * ajoute que la réception des notifications, sans toucher aux règles de cache.
 *
 * Le serveur envoie { title, body, url, tag } (server/src/push/sender.ts). Le tag porte le
 * créneau et le type d'envoi (annonce, confirmation, « finalement non »).
 */

/** Le lien d'une notification, ramené à une adresse de l'appli : jamais ailleurs. */
function appUrl(url) {
  try {
    const target = new URL(url || '/', self.location.origin);
    return target.origin === self.location.origin ? target.href : self.location.origin + '/';
  } catch {
    return self.location.origin + '/';
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Aywhoula', {
      body: data.body || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      // Le même envoi reçu deux fois remplace le premier au lieu de s'empiler.
      tag: data.tag,
      // Avec un tag, un remplacement est silencieux par défaut : `renotify` le fait sonner. Il
      // n'est permis qu'avec un tag (sans lui, `showNotification` lève une erreur).
      renotify: Boolean(data.tag),
      data: { url: appUrl(data.url) },
    }),
  );
});

// Au clic : une fenêtre de l'appli déjà ouverte est réutilisée et menée au lien, sinon une fenêtre s'ouvre.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = appUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          await client.focus();
          await client.navigate(url);
          return;
        } catch {
          // Fenêtre que ce service worker ne contrôle pas : on en ouvre une autre.
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
