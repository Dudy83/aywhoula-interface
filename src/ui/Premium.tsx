/**
 * Ce qui signale Premium dans l'appli : l'icône de l'appli (le logo en vert d'eau sur sa tuile sombre) et
 * « Premium », ou « Aywhoula Premium » dans l'offre et la carte d'abonnement. Les jours de Premium de la
 * ligne de temps ont leur propre étiquette (`FoldLabel`, `./timeline/shared.tsx`).
 */
import { BrandMark } from './common';

/** Le badge Premium ; `brand` ajoute « Aywhoula », `more` une précision (« jusqu’à 16 jours »). */
export function PremiumBadge({ brand = false, more, size = 'sm' }: { brand?: boolean; more?: string; size?: 'sm' | 'md' }) {
  return (
    <span className="pbadge" data-size={size}>
      <span className="pbadge-tile" aria-hidden="true">
        <BrandMark />
      </span>
      <span className="pbadge-text">
        {brand && <b>Aywhoula </b>}
        <span className="pbadge-premium">Premium</span>
        {more && <span className="pbadge-more"> · {more}</span>}
      </span>
    </span>
  );
}
