import { Check } from 'lucide-react';
import { FREE_DAYS, PREMIUM_DAYS } from '../../data/forecast';
import type { Plan } from '../../state/account';

/** Les quatre avantages de Premium, tels que l'offre les présente. */
export const BENEFITS: [string, string][] = [
  [`Jusqu’à ${PREMIUM_DAYS} jours de prévision`, `au lieu de ${FREE_DAYS} en version gratuite`],
  ['Tous les modèles, au choix', 'MFWAM, ECMWF, GFS, ICON, AROME'],
  ['Des alertes sur vos spots', 'une notification quand houle et vent sont réunis'],
  ['Favoris illimités', 'retrouvés sur tous vos appareils'],
];

/** Les prix affichés de Premium, TTC. Ceux qui sont prélevés viennent de Stripe. Le nombre reste collé à sa devise. */
export const PRICE_LABEL: Record<Plan, string> = { yearly: '23,99 € par an', monthly: '2,99 € par mois' };

/** Liste à coches. Les coches sont en encre : l'accent reste à ce qui est choisi. */
export function Checks({ items, tight = false }: { items: [string, string?][]; tight?: boolean }) {
  return (
    <ul className="checks" data-tight={tight || undefined}>
      {items.map(([title, detail]) => (
        <li key={title}>
          <Check size={18} aria-hidden="true" />
          <div>
            <b>{title}</b>
            {detail && <div className="hint">{detail}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const dayMonthYear = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** « 27 novembre » */
export const formatDate = (iso: string): string => dayMonth.format(new Date(iso));
/** « 27 novembre 2026 » */
export const formatFullDate = (iso: string): string => dayMonthYear.format(new Date(iso));

/** « 19,99 € », à partir d'un montant en centimes. */
export function formatMoney(cents: number, currency: string | null): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: (currency ?? 'eur').toUpperCase() }).format(cents / 100);
}

const CARD_BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  cartes_bancaires: 'CB',
  diners: 'Diners Club',
  discover: 'Discover',
  jcb: 'JCB',
  unionpay: 'UnionPay',
};

/** « carte Visa •••• 4242 » */
export const formatCard = (card: { brand: string; last4: string }): string => `carte ${CARD_BRANDS[card.brand] ?? 'bancaire'} •••• ${card.last4}`;
