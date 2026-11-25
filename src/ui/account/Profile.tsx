import { ChevronRight, LogOut, Plus, Star, Trash2, User, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { errorMessage } from '../../data/api';
import { HEIGHT_UNIT_LABEL, TEMP_UNIT_LABEL, WIND_UNIT_LABEL } from '../../lib/units';
import { mapApi } from '../../map/api';
import { alertChips, MAX_ALERTS } from '../../data/alerts';
import { closeSide, editAlert, newAlert, openAlerts, openDeleteAccount, openSignIn, signOut, useAccount } from '../../state/account';
import { useStore, type PlaceKind, type Selection } from '../../state/store';
import { AlertSwitch } from '../alerts/AlertsPanel';
import { OpeningControl, openingLabel, THEME_LABEL, ThemeControl, UnitRows } from '../settings';
import { Notice } from './SignIn';
import { SubscriptionCard } from './SubscriptionCard';

const createdFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

const KIND_LABEL: Record<PlaceKind, string> = { point: 'Point', spot: 'Spot', beach: 'Plage', buoy: 'Bouée', webcam: 'Webcam' };

/** « 48,0410° N · 4,7301° O » : assez précis pour retrouver le lieu signalé. */
const preciseCoord = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(4).replace('.', ',')}° ${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lon).toFixed(4).replace('.', ',')}° ${lon >= 0 ? 'E' : 'O'}`;

/** « Signaler une erreur » : un email à l'équipe, avec le lieu ouvert (type, nom, coordonnées) et la version de l'appli. */
function reportHref(place: Selection | null): string {
  const lines = ['Bonjour,', '', '', '—'];
  if (place) lines.push(`Lieu ouvert : ${KIND_LABEL[place.kind]}${place.name ? ` « ${place.name} »` : ''}, ${preciseCoord(place.lat, place.lon)}`);
  lines.push(`Version de l’appli : ${__APP_VERSION__}`);
  return `mailto:contact@aywhoula.com?subject=${encodeURIComponent('Signalement')}&body=${encodeURIComponent(lines.join('\n'))}`;
}

/** Ligne de préférence : son réglage se déplie dessous. */
function PreferenceRow({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="row-group" data-open={open}>
      <button type="button" className="row" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="row-grow">{label}</span>
        <span className="row-value">{value}</span>
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="row-body" id={id}>
          {children}
        </div>
      )}
    </div>
  );
}

function FavoriteList({ favorites }: { favorites: Selection[] }) {
  if (favorites.length === 0) return <p className="hint">Aucun favori pour le moment. L’étoile du panneau d’un point l’ajoute ici.</p>;
  const open = (f: Selection) => {
    useStore.getState().select(f);
    mapApi.focus(f.lon, f.lat, 10);
  };
  return (
    <ul className="favorite-list">
      {favorites.map((f) => (
        <li key={f.id}>
          <button type="button" className="favorite-open" onClick={() => open(f)}>
            <span className="favorite-name">{f.name || 'Point enregistré'}</span>
            <span className="hint">{f.kind === 'spot' && f.detail ? f.detail : KIND_LABEL[f.kind]}</span>
          </button>
          <button
            type="button"
            className="icon-button"
            aria-pressed="true"
            aria-label={`Retirer ${f.name || 'ce point'} des favoris`}
            title="Retirer des favoris"
            onClick={() => useStore.getState().toggleFavorite(f)}
          >
            <Star size={16} fill="currentColor" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Le profil, à la place du panneau d'un point (feuille sur téléphone) : le compte, les
 * préférences, la déconnexion et la suppression. Un visiteur y voit la version gratuite.
 */
export function ProfilePanel() {
  const me = useAccount((s) => s.me);
  const alerts = useAccount((s) => s.alerts);
  const favorites = useStore((s) => s.favorites);
  const units = useStore((s) => s.units);
  const theme = useStore((s) => s.theme);
  const reopenLast = useStore((s) => s.reopenLast);
  const selection = useStore((s) => s.selection);
  const [error, setError] = useState<string | null>(null);

  const logout = () => {
    setError(null);
    signOut().catch((err: unknown) => setError(errorMessage(err)));
  };

  return (
    <aside className="panel panel-side" data-expanded="true" aria-label="Profil">
      <div className="panel-handle" aria-hidden="true" />
      <header className="panel-header profile-header">
        {me ? (
          <span className="avatar avatar-xl" aria-hidden="true">
            {me.email[0].toUpperCase()}
          </span>
        ) : (
          <span className="avatar avatar-xl" data-guest aria-hidden="true">
            <User size={22} />
          </span>
        )}
        <div className="panel-heading">
          <h2>{me ? me.email : 'Version gratuite'}</h2>
          {me ? (
            <p>Compte créé le {createdFmt.format(new Date(me.createdAt))}</p>
          ) : (
            <p>
              <button type="button" className="text-link" onClick={() => openSignIn()}>
                Se connecter
              </button>{' '}
              pour garder vos favoris
            </p>
          )}
        </div>
        <button type="button" className="icon-button" aria-label="Fermer" title="Fermer (Échap)" onClick={closeSide}>
          <X size={18} />
        </button>
      </header>
      <div className="panel-body">
        <SubscriptionCard />

        {/* Les alertes font partie de Premium : la section n'existe que pour un abonné. */}
        {me?.premium && (
          <>
            <h3 className="section-label">Mes alertes</h3>
            <div className="rows">
              {(alerts ?? []).map((alert) => (
                <div className="row" key={alert.id}>
                  <button type="button" className="row-grow row-open" onClick={() => editAlert(alert)}>
                    <b>{alert.place.name}</b>
                    <span className="hint num">{alertChips(alert, units).slice(0, 2).join(' · ')}</span>
                  </button>
                  <AlertSwitch alert={alert} onError={setError} />
                </div>
              ))}
              {(alerts?.length ?? 0) > 0 && (
                <button type="button" className="row row-quiet" onClick={openAlerts}>
                  <span className="row-grow">Toutes mes alertes</span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              )}
              <button type="button" className="row row-quiet" disabled={(alerts?.length ?? 0) >= MAX_ALERTS} onClick={() => newAlert()}>
                <span className="row-grow">Nouvelle alerte</span>
                <Plus size={18} aria-hidden="true" />
              </button>
            </div>
          </>
        )}

        <h3 className="section-label">{me ? 'Préférences, synchronisées sur vos appareils' : 'Préférences'}</h3>
        <div className="rows">
          <PreferenceRow label="Favoris" value={favorites.length === 0 ? 'Aucun' : `${favorites.length} spot${favorites.length > 1 ? 's' : ''}`}>
            <FavoriteList favorites={favorites} />
          </PreferenceRow>
          <PreferenceRow label="Unités" value={`${WIND_UNIT_LABEL[units.wind]} · ${HEIGHT_UNIT_LABEL[units.height]} · ${TEMP_UNIT_LABEL[units.temp]}`}>
            <div className="row-settings">
              <UnitRows />
            </div>
          </PreferenceRow>
          <PreferenceRow label="Thème" value={THEME_LABEL[theme]}>
            <ThemeControl />
          </PreferenceRow>
          <PreferenceRow label="À l’ouverture" value={openingLabel(reopenLast)}>
            <OpeningControl />
          </PreferenceRow>
        </div>

        {me && (
          <>
            <h3 className="section-label">Compte</h3>
            <div className="rows">
              <button type="button" className="row" onClick={logout}>
                <LogOut size={15} aria-hidden="true" />
                <span className="row-grow">Se déconnecter</span>
              </button>
              <button type="button" className="row row-danger" onClick={openDeleteAccount}>
                <Trash2 size={15} aria-hidden="true" />
                <span className="row-grow">Supprimer mon compte</span>
              </button>
            </div>
          </>
        )}
        {error && <Notice>{error}</Notice>}

        <p className="hint profile-links">
          <a href="/api/site/aide" target="_blank" rel="noreferrer">
            Aide et contact
          </a>{' '}
          ·{' '}
          <a href={reportHref(selection)}>Signaler une erreur</a> ·{' '}
          <a href="/api/site/conditions" target="_blank" rel="noreferrer">
            Conditions
          </a>{' '}
          ·{' '}
          <a href="/api/site/confidentialite" target="_blank" rel="noreferrer">
            Confidentialité
          </a>
        </p>
      </div>
    </aside>
  );
}
