import { CalendarDays, CalendarRange, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../data/api';
import { closeOverlay, startCheckout, useAccount, type Overlay, type Plan } from '../../state/account';
import { radioKeyDown } from '../common';
import { PremiumBadge } from '../Premium';
import { Dialog } from './Dialog';
import { BENEFITS, Checks, PRICE_LABEL } from './parts';
import { Notice } from './SignIn';

const PLANS: { plan: Plan; name: string; detail: string; price: string; tag?: string; icon: LucideIcon }[] = [
  { plan: 'yearly', name: 'Annuel', detail: PRICE_LABEL.yearly, price: '2 €', tag: '−33 %', icon: CalendarRange },
  { plan: 'monthly', name: 'Mensuel', detail: 'Sans engagement', price: '2,99 €', icon: CalendarDays },
];

/**
 * Écran `premium` : l'offre, ouverte par chaque verrou. Annuel présélectionné. Le bouton
 * mène à la connexion si besoin, puis à la page de paiement de Stripe.
 */
export function OfferDialog({ overlay }: { overlay: Extract<Overlay, { kind: 'offer' }> }) {
  const [plan, setPlan] = useState<Plan>(overlay.plan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // L'essai gratuit ne sert qu'une fois par personne : qui l'a déjà eu s'abonne directement.
  // Quand le serveur ne sait pas (`null`), l'offre le propose encore : la page de Stripe fait foi.
  const trial = useAccount((s) => s.me?.subscription.trialUsed !== true);

  const start = (chosen: Plan) => {
    setBusy(true);
    setError(null);
    // Connecté : la page part chez Stripe. Sinon : la connexion s'ouvre à la place de l'offre.
    startCheckout(chosen).catch((err: unknown) => {
      setError(errorMessage(err));
      setBusy(false);
    });
  };

  // Retour d'un lien de connexion demandé depuis l'offre : le paiement s'ouvre tout de suite.
  useEffect(() => {
    if (overlay.start) start(overlay.plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Dialog label="Premium" wide className="dialog-offer" onClose={closeOverlay}>
      <PremiumBadge brand size="md" />
      <h2 className="title-lg offer-title">
        Toute la houle, <span className="accent">sans limite</span>
      </h2>
      <p className="lead">{trial ? '7 jours gratuits, puis résiliable à tout moment.' : 'Résiliable à tout moment.'}</p>
      {overlay.notice && <Notice>{overlay.notice}</Notice>}
      <div className="offer-benefits">
        <Checks items={BENEFITS} />
      </div>
      <div className="plans" role="radiogroup" aria-label="Formule" onKeyDown={radioKeyDown}>
        {PLANS.map((p) => (
          <button
            key={p.plan}
            type="button"
            role="radio"
            aria-checked={p.plan === plan}
            tabIndex={p.plan === plan ? 0 : -1}
            className="plan"
            onClick={() => setPlan(p.plan)}
          >
            <span className="plan-icon" aria-hidden="true">
              <p.icon size={20} strokeWidth={1.8} />
            </span>
            <span className="plan-name">
              <b>{p.name}</b>
              <span className="hint num">{p.detail}</span>
            </span>
            <span className="plan-price num">
              <b>{p.price}</b>
              <span className="hint">par mois</span>
            </span>
            {p.tag && <span className="badge badge-premium plan-tag">{p.tag}</span>}
          </button>
        ))}
      </div>
      {error && <Notice>{error}</Notice>}
      <button type="button" className="btn btn-primary btn-lg btn-block offer-action" disabled={busy} data-autofocus onClick={() => start(plan)}>
        {trial ? 'Commencer l’essai gratuit' : 'S’abonner'}
      </button>
      <p className="hint dialog-center num">
        {trial ? `Gratuit pendant 7 jours, puis ${PRICE_LABEL[plan]}. Rappel par email 3 jours avant la fin. ` : `${PRICE_LABEL[plan]}. `}
        Résiliable en deux clics depuis votre profil.
      </p>
    </Dialog>
  );
}
