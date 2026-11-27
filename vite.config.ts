import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json';

// Les fichiers texte du NDBC (bouées NOAA) et les pages publiques de CANDHIS
// (bouées françaises) n'envoient pas d'en-têtes CORS : on les relaie en
// dev/preview. En production, voir vercel.json et public/_redirects.
const proxy = {
  // L'API (comptes, prévisions d'un point) partage l'origine de l'appli. En local,
  // elle tourne à part : `npm --prefix server run dev`.
  '/api': {
    target: 'http://localhost:8787',
  },
  // Les grilles de la carte, préparées par le processus `grids` du serveur :
  // `npm --prefix server run dev:grids`.
  '/grilles': {
    target: 'http://localhost:8789',
  },
  '/proxy/ndbc': {
    target: 'https://www.ndbc.noaa.gov',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/proxy\/ndbc/, ''),
  },
  // Seules les pages publiques sont relayées. La chaîne de requête doit arriver
  // telle quelle : le site ne reconnaît que l'adresse exacte de chaque bouée.
  '/proxy/candhis': {
    target: 'https://candhis.cerema.fr',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/proxy\/candhis/, '/_public_'),
  },
};

// App installable. Le service worker ne garde que la coque de l'app et les
// fichiers de lieux : toute donnée en direct passe par le réseau, sans lui.
const pwa = VitePWA({
  // La nouvelle version s'installe en arrière-plan et prend la main dès qu'elle est prête
  // (skipWaiting et clientsClaim plus bas) : un simple rechargement l'affiche.
  // registerSW.js ne fait qu'enregistrer sw.js : ni message, ni rechargement forcé d'une page ouverte.
  registerType: 'autoUpdate',
  injectRegister: 'script',
  manifest: {
    lang: 'fr',
    name: 'Aywhoula',
    short_name: 'Aywhoula',
    // Le même texte que la meta description d'index.html.
    description: 'Prévisions de vagues et de vent pour le surf et les sports nautiques : carte animée, spots, bouées, webcams.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // --map-land du thème sombre, celui par défaut.
    theme_color: '#17191c',
    background_color: '#17191c',
    categories: ['weather', 'sports'],
    // Générées par `npm run pwa:icons` (voir pwa-assets.config.ts).
    icons: [
      { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  // Les icônes du manifeste sont déjà prises par le motif « png » ci-dessous.
  includeManifestIcons: false,
  workbox: {
    // La coque : page, scripts (dont le worker de MapLibre en .mjs), styles,
    // polices, icônes. Le plugin y ajoute lui-même manifest.webmanifest : le
    // lister ici le mettrait deux fois.
    globPatterns: ['**/*.{html,js,mjs,css,woff2,svg,png}'],
    // Le script de l'appli (1,6 Mo) approche la limite par défaut de 2 Mio : au-delà,
    // il serait écarté sans bruit et l'app ne démarrerait pas hors ligne.
    maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
    // Une nouvelle version prend la main dès son installation, sans attendre la
    // fermeture de toutes les fenêtres de l'app. Une page restée ouverte garde son
    // code ; les morceaux qu'elle chargerait encore viennent du réseau, où le
    // serveur garde les fichiers de la version précédente.
    skipWaiting: true,
    clientsClaim: true,
    // Réception des notifications d'alerte : public/push-sw.js, chargé par le service worker généré.
    importScripts: ['push-sw.js'],
    navigateFallback: '/index.html',
    // Les relais des bouées, l'API et les grilles ne sont pas des pages de l'app : le retour de Google
    // (/api/auth/callback/google) et le lien de pause d'une alerte doivent arriver au serveur.
    navigateFallbackDenylist: [/^\/proxy\//, /^\/api\//, /^\/grilles\//],
    // Une seule route : les fichiers de spots, plages et webcams. Ne jamais en
    // ajouter pour les grilles (/grilles/… : le cache HTTP du navigateur garde déjà
    // leurs blocs, qui ne changent jamais), les relais /proxy/…, les API de
    // prévision ou les bouées : ce sont des données en direct.
    runtimeCaching: [
      {
        urlPattern: ({ sameOrigin, url }) => sameOrigin && /^\/data\/[^/]+\.json$/.test(url.pathname),
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'lieux', cacheableResponse: { statuses: [200] } },
      },
    ],
  },
});

export default defineConfig({
  plugins: [react(), pwa],
  // La version de l'appli, que « Signaler une erreur » met dans l'email.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { proxy },
  preview: { proxy },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
