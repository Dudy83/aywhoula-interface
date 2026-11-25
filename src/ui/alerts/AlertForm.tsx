import { Bell, Mail, MapPin, Share, SquarePlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KNOT,
  landSectors,
  LEAD_DAYS,
  PART_LABEL,
  PARTS,
  previewAlert,
  sectorsPhrase,
  shortName,
  slotText,
  SWELL_SCALE_MAX,
  swellRange,
  WIND_SCALE_MAX_KN,
  windText,
  type AlertSettings,
  type LeadDays,
  type Part,
  type PreviewSlot,
  type WindMode,
} from '../../data/alerts';
import { errorMessage } from '../../data/api';
import { enablePush, pushGranted } from '../../data/push';
import { fmt, formatHeight, formatWind, HEIGHT_UNIT_LABEL, WIND_UNIT_LABEL } from '../../lib/units';
import { closeSide, reconcile, removeAlert, saveAlert, type Side } from '../../state/account';
import { useStore } from '../../state/store';
import { Dialog } from '../account/Dialog';
import { Notice } from '../account/SignIn';
import { HEIGHT, Segmented, WIND } from '../common';
import { focusSearch } from '../TopBar';
import { Compass, paletteFill, Range, Stepper, SwitchRow } from './controls';

const LEAD_LABEL: Record<LeadDays, string> = { 1: 'La veille', 2: '2 jours', 3: '3 jours', 5: '5 jours' };
const NBSP = ' ';

/** Les réglages tels que le formulaire les tient : curseurs en mètres et en nœuds. */
interface Draft {
  swellMin: number;
  /** Au maximum du curseur (4 m) : pas de limite haute. */
  swellMax: number;
  periodMin: number;
  /** En nœuds. Au maximum du curseur (40 nd) : pas de limite. */
  windKn: number;
  windMode: WindMode;
  /** Secteurs choisis sur la boussole. */
  sectors: number;
  parts: Part[];
  leadDays: LeadDays;
  push: boolean;
  email: boolean;
}

function initialDraft(alert: Extract<Side, { kind: 'alert' }>['alert']): Draft {
  if (!alert) {
    return { swellMin: 1.2, swellMax: 2.5, periodMin: 10, windKn: 15, windMode: 'any', sectors: 0, parts: ['morning', 'evening'], leadDays: 3, push: pushGranted(), email: true };
  }
  return {
    swellMin: alert.swellMin,
    swellMax: alert.swellMax ?? SWELL_SCALE_MAX,
    periodMin: alert.periodMin,
    windKn: alert.windMax == null ? WIND_SCALE_MAX_KN : Math.round(alert.windMax / KNOT),
    windMode: alert.windMode,
    sectors: alert.windMode === 'sectors' ? alert.sectors : 0,
    parts: alert.parts,
    leadDays: alert.leadDays,
    push: alert.channels.push,
    email: alert.channels.email,
  };
}

/** Écran `installer` : sur iPhone, les notifications web n'arrivent qu'à l'appli installée sur l'écran d'accueil. */
function InstallSheet({ onClose, onEmail }: { onClose: () => void; onEmail: () => void }) {
  return (
    <Dialog label="Les alertes sur iPhone" onClose={onClose}>
      <div className="install-head">
        <img className="install-icon" src="/pwa-192x192.png" width={52} height={52} alt="" />
        <div>
          <p className="hint">Une seule fois</p>
          <h2 className="title-lg">Les alertes sur iPhone</h2>
        </div>
      </div>
      <p className="lead install-lead">Sur iPhone, les notifications arrivent à Aywhoula installé sur l’écran d’accueil. Dans Safari :</p>
      <ol className="install-steps">
        <li>
          <span>
            Touchez <Share size={15} aria-hidden="true" />
            <b>Partager</b>, en bas de l’écran
          </span>
        </li>
        <li>
          <span>
            Choisissez <SquarePlus size={15} aria-hidden="true" />
            <b>Sur l’écran d’accueil</b>
          </span>
        </li>
        <li>
          <span>
            Ouvrez Aywhoula depuis son icône, puis <b>autorisez les notifications</b>
          </span>
        </li>
      </ol>
      <button type="button" className="btn btn-primary btn-lg btn-block dialog-action" data-autofocus onClick={onClose}>
        J’ai compris
      </button>
      <button type="button" className="btn btn-ghost btn-block dialog-second" onClick={onEmail}>
        <Mail size={15} aria-hidden="true" />
        Recevoir par email en attendant
      </button>
    </Dialog>
  );
}

type Preview = { status: 'idle' | 'loading' | 'error'; slots: PreviewSlot[] | null; error?: string };

/**
 * Écran `alerte` : « Nouvelle alerte », et le même formulaire pour en modifier une. Il prend la
 * place du panneau d'un point ; « Enregistrer l'alerte » reste au pied du panneau.
 */
export function AlertFormPanel({ side }: { side: Extract<Side, { kind: 'alert' }> }) {
  const units = useStore((s) => s.units);
  const { place, alert } = side;
  const [draft, setDraft] = useState<Draft>(() => initialDraft(alert));
  const set = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }));
  /** Secteurs de terre du lieu : `null` tant qu'on ne sait pas, 0 si son orientation est inconnue. */
  const [land, setLand] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview>({ status: 'idle', slots: null });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [install, setInstall] = useState(false);
  /** L'abonnement de l'appareil est en cours : la première fois, le navigateur peut y mettre plusieurs secondes. */
  const [pushBusy, setPushBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const touchedMode = useRef(alert !== null);

  // « De terre » n'est proposé que pour un spot ou une plage dont l'orientation est connue.
  useEffect(() => {
    let cancelled = false;
    setLand(null);
    if (!place) return;
    void landSectors(place).then((mask) => {
      if (cancelled) return;
      // Alerte déjà réglée sur le vent de terre d'un lieu qu'on ne retrouve plus : ses secteurs enregistrés.
      const known = mask || (alert?.windMode === 'offshore' && alert.place.id === place.id ? alert.sectors : 0);
      setLand(known);
      setDraft((d) => {
        // Nouvelle alerte : vent de terre par défaut quand le lieu s'y prête. Sinon, on ne le garde pas là où il n'existe pas.
        if (known && !touchedMode.current) return { ...d, windMode: 'offshore' };
        if (!known && d.windMode === 'offshore') return { ...d, windMode: 'any' };
        return d;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [place?.id, place?.lat, place?.lon, alert]); // eslint-disable-line react-hooks/exhaustive-deps

  const settings = useMemo<AlertSettings | null>(() => {
    if (!place) return null;
    return {
      place,
      swellMin: draft.swellMin,
      swellMax: draft.swellMax >= SWELL_SCALE_MAX ? null : draft.swellMax,
      periodMin: draft.periodMin,
      windMax: draft.windKn >= WIND_SCALE_MAX_KN ? null : draft.windKn * KNOT,
      windMode: draft.windMode,
      sectors: draft.windMode === 'offshore' ? (land ?? 0) : draft.windMode === 'sectors' ? draft.sectors : 0,
      parts: PARTS.filter((p) => draft.parts.includes(p)),
      leadDays: draft.leadDays,
      channels: { push: draft.push, email: draft.email },
    };
  }, [place, draft, land]);

  // Vent de terre ou secteurs choisis : il faut au moins un secteur.
  const noSector = settings !== null && settings.windMode !== 'any' && settings.sectors === 0;
  /** Ce qui manque pour enregistrer, en une phrase ; `null` quand tout y est (ou que l'orientation du lieu se charge). */
  const missing = !settings
    ? 'Choisissez un spot : « Changer » ouvre la recherche, et un clic sur la carte fait aussi l’affaire.'
    : settings.parts.length === 0
      ? 'Cochez au moins un créneau.'
      : noSector && land !== null
        ? 'Choisissez au moins une direction sur la boussole.'
        : !settings.channels.push && !settings.channels.email
          ? 'Choisissez au moins un canal : notification ou email.'
          : null;
  const ready = settings !== null && missing === null && !noSector;

  // L'aperçu : recalculé 500 ms après le dernier changement. Les canaux n'y changent rien.
  const previewKey = ready ? JSON.stringify({ ...settings, channels: null, leadDays: null }) : null;
  useEffect(() => {
    if (!previewKey || !settings) {
      setPreview({ status: 'idle', slots: null });
      return;
    }
    const controller = new AbortController();
    setPreview((p) => ({ status: 'loading', slots: p.slots }));
    const timer = window.setTimeout(() => {
      previewAlert(settings, controller.signal).then(
        (slots) => setPreview({ status: 'idle', slots }),
        (err: Error) => {
          if (err.name === 'AbortError') return;
          setPreview({ status: 'error', slots: null, error: errorMessage(err) });
          // Premium s'est arrêté sans que l'appli le sache : le compte est redemandé, et le formulaire se referme.
          void reconcile(err);
        },
      );
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [previewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Le canal Notification : à la première activation, la permission puis l'abonnement de l'appareil. */
  const togglePush = (on: boolean) => {
    setNotice(null);
    if (!on) {
      set({ push: false });
      return;
    }
    setPushBusy(true);
    enablePush()
      .then(
        (outcome) => {
          if (outcome === 'enabled') set({ push: true });
          else if (outcome === 'install') setInstall(true);
          else if (outcome === 'denied') setNotice('Les notifications sont bloquées pour ce site. Autorisez-les dans les réglages du navigateur, ou gardez l’email.');
          else setNotice('Ce navigateur ne reçoit pas les notifications ici. L’email reste disponible.');
        },
        (err: unknown) => setNotice(errorMessage(err)),
      )
      .finally(() => setPushBusy(false));
  };

  const save = () => {
    if (!ready || !settings || busy) return;
    setBusy(true);
    setNotice(null);
    // Permission déjà donnée : on s'assure que cet appareil est bien abonné, sans rien redemander.
    if (settings.channels.push && pushGranted()) void enablePush().catch(() => undefined);
    saveAlert(settings, alert?.id ?? null).catch((err: unknown) => {
      setNotice(errorMessage(err));
      setBusy(false);
    });
  };

  const remove = () => {
    if (!alert) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    removeAlert(alert.id).catch((err: unknown) => {
      setNotice(errorMessage(err));
      setBusy(false);
    });
  };

  const hUnit = HEIGHT_UNIT_LABEL[units.height];
  const wUnit = WIND_UNIT_LABEL[units.wind];
  const swellLabel = swellRange(draft.swellMin, draft.swellMax >= SWELL_SCALE_MAX ? null : draft.swellMax, units);
  const windLabel = draft.windKn >= WIND_SCALE_MAX_KN ? 'Sans limite' : windText(draft.windKn * KNOT, units);
  const modes: { value: WindMode; label: string }[] = [
    { value: 'any', label: 'Peu importe' },
    ...(land ? [{ value: 'offshore' as const, label: 'De terre' }] : []),
    { value: 'sectors', label: 'Choisir' },
  ];
  const first = preview.slots?.[0];
  const windWords = (slot: PreviewSlot) =>
    slot.wind == null ? '' : draft.windMode === 'offshore' ? `, vent de terre ${windText(slot.wind, units)}` : `, vent ${windText(slot.wind, units)}`;

  return (
    <aside className="panel panel-side" data-expanded="true" aria-label={alert ? 'Modifier l’alerte' : 'Nouvelle alerte'}>
      <div className="panel-handle" aria-hidden="true" />
      <header className="panel-header">
        <div className="panel-heading">
          <h2>{alert ? 'Modifier l’alerte' : 'Nouvelle alerte'}</h2>
          <p>Prévenu dès que ces conditions sont annoncées</p>
        </div>
        <button type="button" className="icon-button" aria-label="Fermer" title="Fermer (Échap)" onClick={closeSide}>
          <X size={18} />
        </button>
      </header>

      <div className="panel-body alert-form">
        <div className="field">
          <span className="field-label">Spot</span>
          <button type="button" className="input spot-field" onClick={focusSearch}>
            <MapPin size={15} aria-hidden="true" />
            <span className="spot-name">{place ? place.name : 'Choisissez un spot'}</span>
            <span className="hint">Changer</span>
          </button>
        </div>

        <div className="form-block">
          <div className="form-row">
            <b>Hauteur de houle</b>
            <span className="num form-value">{swellLabel}</span>
          </div>
          <Range
            min={0}
            max={SWELL_SCALE_MAX}
            step={0.1}
            values={[draft.swellMin, draft.swellMax]}
            onChange={([swellMin, swellMax]) => set({ swellMin, swellMax })}
            labels={['Hauteur de houle minimum', 'Hauteur de houle maximum']}
            valueText={(v) => `${formatHeight(v, units.height)} ${hUnit}`}
            fill={paletteFill(HEIGHT, draft.swellMin, draft.swellMax)}
            ticks={[0, 1, 2, 3, 4].map((m, k) => `${units.height === 'ft' ? formatHeight(m, 'ft').replace(/,0$/, '') : m}${k === 4 ? `${NBSP}${hUnit}` : ''}`)}
          />
        </div>

        <div className="form-row form-block">
          <b>Période minimum</b>
          <Stepper value={draft.periodMin} min={6} max={20} label="Période minimum" text={`${draft.periodMin}${NBSP}s`} onChange={(periodMin) => set({ periodMin })} />
        </div>

        <div className="form-block">
          <div className="form-row">
            <b>Vent maximum</b>
            <span className="num form-value">{windLabel}</span>
          </div>
          <Range
            min={0}
            max={WIND_SCALE_MAX_KN}
            step={1}
            values={[draft.windKn]}
            onChange={([windKn]) => set({ windKn })}
            labels={['Vent maximum']}
            valueText={(v) => (v >= WIND_SCALE_MAX_KN ? 'Sans limite' : `${formatWind(v * KNOT, units.wind)} ${wUnit}`)}
            fill={paletteFill(WIND, 0, draft.windKn * KNOT)}
            ticks={[0, 10, 20, 30, 40].map((kn, k) => `${formatWind(kn * KNOT, units.wind)}${k === 4 ? `${NBSP}${wUnit}` : ''}`)}
          />
        </div>

        <div className="form-block wind-direction">
          <div className="wind-direction-text">
            <b>Direction du vent</b>
            <Segmented<WindMode>
              label="Direction du vent"
              value={draft.windMode}
              onChange={(windMode) => {
                touchedMode.current = true;
                set({ windMode });
              }}
              options={modes}
            />
            <p className="hint">
              {draft.windMode === 'any'
                ? 'Le vent peut venir de partout.'
                : draft.windMode === 'offshore'
                  ? `Vent de terre à ${place ? shortName(place.name) : 'ce spot'} : ${sectorsPhrase(land ?? 0)}.`
                  : draft.sectors
                    ? `Vent ${sectorsPhrase(draft.sectors)}.`
                    : 'Touchez la boussole : les secteurs d’où le vent doit venir.'}
            </p>
          </div>
          {draft.windMode === 'offshore' && <Compass mask={land ?? 0} label={`Secteurs de terre : ${sectorsPhrase(land ?? 0)}`} />}
          {draft.windMode === 'sectors' && <Compass mask={draft.sectors} onChange={(sectors) => set({ sectors })} label="Directions d’où le vent doit venir" />}
        </div>

        <div className="form-block">
          <b>Créneaux</b>
          <div className="pills" role="group" aria-label="Créneaux">
            {PARTS.map((part) => {
              const on = draft.parts.includes(part);
              return (
                <button key={part} type="button" className="pill" aria-pressed={on} onClick={() => set({ parts: on ? draft.parts.filter((p) => p !== part) : [...draft.parts, part] })}>
                  {PART_LABEL[part]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="form-row form-block">
          <b>Prévenir</b>
          <Segmented<`${LeadDays}`>
            label="Prévenir"
            value={`${draft.leadDays}`}
            onChange={(v) => set({ leadDays: Number(v) as LeadDays })}
            options={LEAD_DAYS.map((d) => ({ value: `${d}` as `${LeadDays}`, label: LEAD_LABEL[d] }))}
          />
        </div>

        <div className="rows form-block">
          <SwitchRow
            icon={<Bell size={15} aria-hidden="true" />}
            label={pushBusy ? 'Notification · activation…' : 'Notification'}
            checked={draft.push || pushBusy}
            disabled={pushBusy}
            onChange={togglePush}
          />
          <SwitchRow icon={<Mail size={15} aria-hidden="true" />} label="Email" checked={draft.email} onChange={(email) => set({ email })} />
        </div>
        {notice && <Notice>{notice}</Notice>}

        <p className="alert-preview" aria-live="polite" data-loading={preview.status === 'loading' || undefined}>
          {missing ? (
            missing
          ) : preview.status === 'error' ? (
            preview.error
          ) : !preview.slots ? (
            'Recherche dans la prévision…'
          ) : first ? (
            <>
              Avec ces réglages, une alerte serait partie cette semaine : <b>{slotText(first.start, first.end, ' ')}</b>
              {first.swell != null && `, ${formatHeight(first.swell, units.height)}${NBSP}${hUnit}`}
              {first.period != null && `, ${fmt(first.period)}${NBSP}s`}
              {windWords(first)}.
            </>
          ) : (
            'Rien ces prochains jours.'
          )}
        </p>

        {alert && (
          <button type="button" className="btn btn-ghost btn-block alert-delete" disabled={busy} onClick={remove}>
            {confirmDelete ? 'Confirmer la suppression' : 'Supprimer l’alerte'}
          </button>
        )}
      </div>

      <footer className="panel-foot">
        <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!ready || busy} onClick={save}>
          Enregistrer l’alerte
        </button>
      </footer>

      {install && (
        <InstallSheet
          onClose={() => setInstall(false)}
          onEmail={() => {
            // « Recevoir par email en attendant » allume le canal Email.
            set({ email: true });
            setInstall(false);
          }}
        />
      )}
    </aside>
  );
}
