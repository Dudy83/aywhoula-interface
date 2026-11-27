/**
 * Ce qui s'ouvre à droite (ordinateur) ou en feuille (téléphone) : le profil, « Mes alertes », le formulaire
 * d'une alerte, sinon le lieu ouvert. Sur ordinateur, un point de la carte n'a qu'une petite carte (sa rose
 * dit déjà la houle, les vagues et le vent), comme un dialog réduit ; les autres lieux ont leur dialog sur
 * toute la hauteur. Sur téléphone, le dialog réduit est la ligne du lieu en tête de la barre du bas (`Dock`).
 */
import { useEffect } from 'react';
import { closeSide, useAccount } from '../state/account';
import { useStore } from '../state/store';
import { ProfilePanel } from './account/Profile';
import { AlertFormPanel } from './alerts/AlertForm';
import { AlertsPanel } from './alerts/AlertsPanel';
import { useWide } from './common';
import { PointCard, ReducedCard } from './place/PlaceCard';
import { PlaceDialog } from './place/PlaceDialog';

export function Panel() {
  const selection = useStore((s) => s.selection);
  const reduced = useStore((s) => s.sheet === 'reduced');
  const side = useAccount((s) => s.side);
  const wide = useWide();

  useEffect(() => {
    if (!selection && !side) return;
    // Profil ou alertes ouverts : Échap les referme eux, pas le lieu qui attend dessous. Sinon, Échap
    // ferme le dialog (ou la petite carte) et retire la sélection.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (side) closeSide();
      else useStore.getState().select(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selection, side]);

  // Le profil, « Mes alertes » et « Nouvelle alerte » prennent la place du dialog d'un lieu : même taille, même position.
  if (side?.kind === 'profile') return <ProfilePanel />;
  if (side?.kind === 'alerts') return <AlertsPanel />;
  // Une alerte ouverte dans le formulaire garde ses réglages quand le lieu change : la clé ne suit que l'alerte.
  if (side?.kind === 'alert') return <AlertFormPanel key={side.alert?.id ?? 'nouvelle'} side={side} />;
  if (!selection) return null;
  if (wide && selection.kind === 'point') return <PointCard key={selection.id} selection={selection} />;
  if (reduced) return wide ? <ReducedCard key={selection.id} selection={selection} /> : null;
  return <PlaceDialog key={selection.id} selection={selection} wide={wide} />;
}
