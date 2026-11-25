import { useAccount } from '../../state/account';
import { DeleteAccountDialog } from './DeleteAccount';
import { OfferDialog } from './Offer';
import { SentDialog, SignInDialog } from './SignIn';
import { WelcomeDialog } from './Welcome';

/** La fenêtre (ou la feuille) du parcours de compte et de paiement en cours, s'il y en a une. */
export function AccountOverlays() {
  const overlay = useAccount((s) => s.overlay);
  if (!overlay) return null;
  switch (overlay.kind) {
    case 'signin':
      return <SignInDialog key="signin" overlay={overlay} />;
    case 'sent':
      return <SentDialog key="sent" overlay={overlay} />;
    case 'delete':
      return <DeleteAccountDialog key="delete" />;
    case 'offer':
      return <OfferDialog key="offer" overlay={overlay} />;
    case 'welcome':
      // La même fenêtre passe de l'attente à la bienvenue : pas de clé par phase.
      return <WelcomeDialog key="welcome" overlay={overlay} />;
  }
}
