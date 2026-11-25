import { CircleAlert, CreditCard } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '../../data/api';
import { openOffer, openPortal, openSignIn, useAccount, type SubscriptionInfo } from '../../state/account';
import { BENEFITS, Checks, formatCard, formatDate, formatFullDate, formatMoney } from './parts';
import { Notice } from './SignIn';
import { PremiumBadge } from '../Premium';

const DAY_MS = 86_400_000;

/** « 23,99 € par an » ou « 2,99 € par mois », d'après ce que Stripe prélève. */
const priceOf = (sub: SubscriptionInfo): string =>
  sub.amount == null ? '' : `${formatMoney(sub.amount, sub.currency)} par ${sub.plan === 'monthly' ? 'mois' : 'an'}`;

/** Bouton qui ouvre le portail client de Stripe : formule, carte, factures, résiliation, reprise. */
function PortalButton({ primary = false, children }: { primary?: boolean; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = () => {
    setBusy(true);
    setError(null);
    openPortal().catch((err: unknown) => {
      setError(errorMessage(err));
      setBusy(false);
    });
  };
  return (
    <>
      <button type="button" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-block card-action`} disabled={busy} onClick={open}>
        {children}
      </button>
      {error && <Notice>{error}</Notice>}
    </>
  );
}

/** Version gratuite : ce que Premium ajoute, et l'essai. Un visiteur peut aussi se connecter. */
function FreeCard({ guest, trial }: { guest: boolean; trial: boolean }) {
  return (
    <div className="card">
      <span className="badge badge-outline">Version gratuite</span>
      <p className="card-title">Passez à Premium</p>
      <div className="card-checks">
        <Checks tight items={BENEFITS.slice(0, 3).map(([title]) => [title])} />
      </div>
      <button type="button" className="btn btn-primary btn-block card-action" onClick={() => openOffer()}>
        {trial ? 'Essayer 7 jours gratuitement' : 'Passer à Premium'}
      </button>
      <p className="hint card-note num">{trial ? 'Puis 2 € par mois en annuel.' : '2 € par mois en annuel.'}</p>
      {guest && (
        <button type="button" className="btn btn-secondary btn-block card-second" onClick={() => openSignIn()}>
          Se connecter
        </button>
      )}
    </div>
  );
}

/**
 * La carte d'abonnement du profil, dans ses cinq états (écran `etats`) : version gratuite,
 * essai, Premium, paiement refusé, résilié. Tout vient de Stripe par le serveur.
 */
export function SubscriptionCard() {
  const me = useAccount((s) => s.me);
  const sub = me?.subscription;
  if (!sub || sub.state === 'free') return <FreeCard guest={!me} trial={!sub?.trialUsed} />;

  if (sub.state === 'trial') {
    const end = sub.trialEnd ? new Date(sub.trialEnd).getTime() : Date.now();
    const left = Math.max(0, Math.ceil((end - Date.now()) / DAY_MS));
    const done = Math.min(1, Math.max(0, 1 - (end - Date.now()) / (sub.trialDays * DAY_MS)));
    return (
      <div className="card">
        <div className="card-head">
          <span className="badge badge-premium">Essai gratuit</span>
          <span className="hint num">{left > 1 ? `${left} jours restants` : left === 1 ? '1 jour restant' : 'Dernier jour'}</span>
        </div>
        <div className="trial-bar" role="img" aria-label={`Essai écoulé à ${Math.round(done * 100)} %`}>
          <span style={{ width: `${Math.round(done * 100)}%` }} />
        </div>
        <p className="card-title num">Puis {priceOf(sub)}</p>
        <p className="hint num">
          Premier prélèvement le {sub.trialEnd ? formatFullDate(sub.trialEnd) : '–'}
          {sub.card ? `, ${formatCard(sub.card)}` : ''}.
        </p>
        <PortalButton>Gérer l’abonnement</PortalButton>
      </div>
    );
  }

  if (sub.state === 'failed') {
    return (
      <div className="card">
        <span className="badge badge-warn">
          <CircleAlert size={15} aria-hidden="true" />
          Paiement refusé
        </span>
        <p className="card-title">Mettez à jour votre carte</p>
        <p className="hint num">
          Le prélèvement{sub.paymentFailedAmount != null ? ` de ${formatMoney(sub.paymentFailedAmount, sub.currency)}` : ''}
          {sub.paymentFailedAt ? ` du ${formatDate(sub.paymentFailedAt)}` : ''} n’est pas passé.
          {sub.activeUntil ? ` Premium reste actif jusqu’au ${formatDate(sub.activeUntil)}, nous réessayons d’ici là.` : ''}
        </p>
        <PortalButton primary>
          <CreditCard size={18} aria-hidden="true" />
          Mettre à jour ma carte
        </PortalButton>
      </div>
    );
  }

  if (sub.state === 'canceled') {
    return (
      <div className="card">
        <span className="badge badge-outline">Résilié</span>
        <p className="card-title num">Premium jusqu’au {sub.periodEnd ? formatFullDate(sub.periodEnd) : '–'}</p>
        <p className="hint">Ensuite, retour à la version gratuite : vos favoris sont gardés, vos alertes passent en pause.</p>
        <PortalButton>Reprendre l’abonnement</PortalButton>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <PremiumBadge brand size="md" />
        <span className="hint">Formule {sub.plan === 'monthly' ? 'mensuelle' : 'annuelle'}</span>
      </div>
      <p className="card-title num">Renouvellement le {sub.periodEnd ? formatFullDate(sub.periodEnd) : '–'}</p>
      <p className="hint num">
        {sub.amount != null ? formatMoney(sub.amount, sub.currency) : ''}
        {sub.amount != null && sub.card ? ' · ' : ''}
        {sub.card ? formatCard(sub.card) : ''}
      </p>
      <PortalButton>Gérer l’abonnement et les factures</PortalButton>
      <p className="hint card-note-left">Changer de formule ou de carte, télécharger une facture ou résilier : sur la page sécurisée de Stripe.</p>
    </div>
  );
}
