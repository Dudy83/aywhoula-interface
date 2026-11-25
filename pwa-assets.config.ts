import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

/** Le fond du logo : le carré de public/favicon.svg. */
const LOGO_BACKGROUND = '#0f1113';

/**
 * Icônes de l'app installée, tirées de public/favicon.svg.
 *
 * Elles se génèrent à la main avec `npm run pwa:icons` et sont enregistrées
 * dans public/ : rien n'est produit pendant le build.
 */
export default defineConfig({
  images: ['public/favicon.svg'],
  preset: {
    ...minimal2023Preset,
    // Pas de favicon.ico : la page utilise favicon.svg.
    transparent: { sizes: [64, 192, 512] },
    // Fond plein jusqu'aux bords, de la couleur du carré du logo. Le système
    // découpe l'icône (cercle, carré arrondi) : la vague reste dans la zone
    // sûre, le cercle central de 80 % du côté.
    maskable: {
      sizes: [512],
      padding: 0.2,
      resizeOptions: { fit: 'contain', background: LOGO_BACKGROUND },
    },
    // iOS arrondit lui-même les coins et n'accepte pas la transparence.
    apple: {
      sizes: [180],
      padding: 0.1,
      resizeOptions: { fit: 'contain', background: LOGO_BACKGROUND },
    },
  },
});
