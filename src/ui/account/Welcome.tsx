import { BellPlus, Check } from 'lucide-react';
import { closeOverlay, newAlert, useAccount, type Overlay } from '../../state/account';
import { AnimatedMark } from '../common';
import { Dialog } from './Dialog';
import { Checks, formatDate } from './parts';

/**
 * Écran `bienvenue` : le retour dans l'appli après le paiement. Le droit Premium arrive par
 * un webhook de Stripe, quelques instants après : on patiente, puis on dit ce qui vient de s'ouvrir.
 */
export function WelcomeDialog({ overlay }: { overlay: Extract<Overlay, { kind: 'welcome' }> }) {
  const trialEnd = useAccount((s) => (s.me?.subscription.state === 'trial' ? s.me.subscription.trialEnd : null));

  if (overlay.phase !== 'ready') {
    const late = overlay.phase === 'late';
    return (
      <Dialog label="Confirmation du paiement" onClose={closeOverlay}>
        <div className="round-icon">{late ? <Check size={22} aria-hidden="true" /> : <AnimatedMark size={28} />}</div>
        <h2 className="title-lg welcome-title">{late ? 'Presque prêt' : 'Un instant…'}</h2>
        <p className="lead lead-loose" role="status">
          {late
            ? 'La confirmation de Stripe tarde un peu. Premium s’ouvrira tout seul dans quelques instants ; rechargez la page si rien ne change.'
            : 'Stripe confirme votre abonnement.'}
        </p>
        {late && (
          <button type="button" className="btn btn-primary btn-lg btn-block dialog-action" data-autofocus onClick={closeOverlay}>
            Revenir à la carte
          </button>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog label="Bienvenue dans Premium" onClose={closeOverlay}>
      <div className="round-icon round-icon-full">
        <Check size={22} aria-hidden="true" />
      </div>
      <h2 className="title-lg welcome-title">Bienvenue dans Premium</h2>
      <p className="lead lead-loose">
        {trialEnd ? (
          <>
            Votre essai gratuit court jusqu’au <b>{formatDate(trialEnd)}</b>. Aucun prélèvement avant cette date, et un rappel par email 3 jours
            avant.
          </>
        ) : (
          'Votre abonnement est en place. Le reçu et la facture arrivent par email, envoyés par Stripe.'
        )}
      </p>
      <div className="welcome-checks">
        <Checks
          tight
          items={[
            ['Les 16 jours sont débloqués'],
            ['Tous les modèles, au choix'],
            ['Les alertes sont prêtes'],
            ['Vos favoris vous suivent partout'],
          ]}
        />
      </div>
      <button
        type="button"
        className="btn btn-primary btn-lg btn-block dialog-action"
        data-autofocus
        onClick={() => {
          closeOverlay();
          newAlert();
        }}
      >
        <BellPlus size={18} aria-hidden="true" />
        Créer ma première alerte
      </button>
      <button type="button" className="btn btn-ghost btn-block dialog-second" onClick={closeOverlay}>
        Revenir à la carte
      </button>
    </Dialog>
  );
}
