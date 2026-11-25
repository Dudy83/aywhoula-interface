import { User } from 'lucide-react';
import { toggleProfile, useAccount } from '../../state/account';

/**
 * Bouton du compte, à droite de la recherche : une personne pour un visiteur, l'initiale de
 * l'email une fois connecté, un anneau d'accent quand le profil est ouvert.
 */
export function AccountButton() {
  const me = useAccount((s) => s.me);
  const open = useAccount((s) => s.side?.kind === 'profile');
  const label = me ? 'Mon profil' : 'Compte';
  return (
    <button type="button" className="avatar" data-guest={me ? undefined : true} aria-pressed={open} aria-label={label} title={label} onClick={toggleProfile}>
      {me ? me.email[0].toUpperCase() : <User size={15} aria-hidden="true" />}
    </button>
  );
}
