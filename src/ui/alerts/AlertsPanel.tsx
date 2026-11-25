import { Check, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { alertChips, alertSummary, MAX_ALERTS, slotText, type Alert } from '../../data/alerts';
import { errorMessage } from '../../data/api';
import { closeSide, editAlert, loadAlerts, newAlert, setAlertPaused, useAccount } from '../../state/account';
import { useStore } from '../../state/store';
import { Notice } from '../account/SignIn';

/** Interrupteur d'une alerte : allumée, ou en pause. */
export function AlertSwitch({ alert, onError }: { alert: Alert; onError: (message: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className="toggle alert-switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={`Alerte ${alert.place.name}`}
        checked={!alert.paused}
        disabled={busy}
        onChange={(e) => {
          setBusy(true);
          onError(null);
          setAlertPaused(alert.id, !e.target.checked)
            .catch((err: unknown) => onError(errorMessage(err)))
            .finally(() => setBusy(false));
        }}
      />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}

function AlertCard({ alert, onError }: { alert: Alert; onError: (message: string | null) => void }) {
  const units = useStore((s) => s.units);
  return (
    <li className="card alert-card">
      <div className="alert-card-head">
        {/* Le nom ouvre l'alerte dans le formulaire ; l'interrupteur la met en pause sans l'ouvrir. */}
        <button type="button" className="alert-card-name" onClick={() => editAlert(alert)}>
          {alert.place.name}
        </button>
        <AlertSwitch alert={alert} onError={onError} />
      </div>
      <div className="tags">
        {alertChips(alert, units).map((chip) => (
          <span key={chip} className="tag num">
            {chip}
          </span>
        ))}
      </div>
      <p className="hint alert-card-summary">{alertSummary(alert)}</p>
      {alert.paused ? (
        <p className="alert-card-state">En pause.</p>
      ) : alert.next ? (
        <p className="alert-card-next">
          <Check size={15} aria-hidden="true" />
          <b>Prochain créneau : {slotText(alert.next.start, alert.next.end)}</b>
        </p>
      ) : (
        <p className="alert-card-state num">{alert.leadDays === 1 ? 'Rien d’ici demain.' : `Rien dans les ${alert.leadDays} prochains jours.`}</p>
      )}
    </li>
  );
}

/** Écran `alertes` : « Mes alertes », à la place du panneau d'un point. */
export function AlertsPanel() {
  const alerts = useAccount((s) => s.alerts);
  const [error, setError] = useState<string | null>(null);

  // Le prochain créneau de chaque alerte bouge avec la prévision : on relit à l'ouverture.
  useEffect(() => {
    void loadAlerts();
  }, []);

  const full = (alerts?.length ?? 0) >= MAX_ALERTS;

  return (
    <aside className="panel panel-side" data-expanded="true" aria-label="Mes alertes">
      <div className="panel-handle" aria-hidden="true" />
      <header className="panel-header">
        <div className="panel-heading">
          <h2>Mes alertes</h2>
          <p>Une notification quand vos conditions sont réunies</p>
        </div>
        <button type="button" className="icon-button" aria-label="Fermer" title="Fermer (Échap)" onClick={closeSide}>
          <X size={18} />
        </button>
      </header>
      <div className="panel-body alerts-list">
        <button type="button" className="btn btn-secondary btn-block" disabled={full} onClick={() => newAlert()}>
          <Plus size={18} aria-hidden="true" />
          Nouvelle alerte
        </button>
        {full && <p className="hint">{MAX_ALERTS} alertes au plus : supprimez-en une pour en créer une autre.</p>}
        {error && <Notice>{error}</Notice>}
        {alerts === null ? (
          <div className="skeleton" aria-busy="true" aria-label="Chargement des alertes">
            <div className="skeleton-block" />
            <div className="skeleton-block" />
          </div>
        ) : alerts.length === 0 ? (
          <p className="alerts-empty">
            Aucune alerte pour le moment. Choisissez un spot, réglez la houle et le vent qui vous vont : vous serez prévenu quand ils sont annoncés.
          </p>
        ) : (
          <ul className="alert-cards">
            {alerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} onError={setError} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
