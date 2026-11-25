import { LocateFixed, MapPin, Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { mapApi } from '../map/api';
import { useStore } from '../state/store';
import { Popover } from './common';
import { ThemeRow, UnitRows } from './settings';

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="toggle">
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={onChange} />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}

function MarkersMenu() {
  const show = useStore((s) => s.show);
  const toggle = useStore((s) => s.toggleShow);
  return (
    <Popover label="Repères affichés sur la carte" title="Repères" side="left" align="start" trigger={<MapPin size={18} />}>
      {() => (
        <div className="menu">
          <div className="popover-title">Repères sur la carte</div>
          <Toggle label="Spots et plages" hint="OpenStreetMap, visibles en zoomant" checked={show.places} onChange={() => toggle('places')} />
          <Toggle label="Bouées houlographiques" hint="Mesures en temps réel : NOAA, France, Espagne, Irlande" checked={show.buoys} onChange={() => toggle('buoys')} />
          <Toggle label="Webcams" hint="Liens vers les caméras du littoral" checked={show.webcams} onChange={() => toggle('webcams')} />
        </div>
      )}
    </Popover>
  );
}

function SettingsMenu() {
  const animate = useStore((s) => s.animate);
  const setAnimate = useStore((s) => s.setAnimate);
  const reopenLast = useStore((s) => s.reopenLast);
  const setReopenLast = useStore((s) => s.setReopenLast);
  return (
    <Popover label="Réglages : unités, thème, animation, ouverture" title="Réglages" side="left" align="start" trigger={<SlidersHorizontal size={18} />}>
      {() => (
        <div className="menu">
          <div className="popover-title">Réglages</div>
          <UnitRows />
          <ThemeRow />
          <Toggle label="Particules animées" hint="Sens du vent et de la houle" checked={animate} onChange={() => setAnimate(!animate)} />
          <Toggle label="Rouvrir le dernier point" hint="À l’ouverture de l’appli" checked={reopenLast} onChange={() => setReopenLast(!reopenLast)} />
        </div>
      )}
    </Popover>
  );
}

export function MapControls() {
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const locate = () => {
    setLocating(true);
    setNotice(null);
    mapApi
      .locate()
      .catch((err: Error) => {
        setNotice(err.message);
        window.setTimeout(() => setNotice(null), 6000);
      })
      .finally(() => setLocating(false));
  };

  return (
    <div className="controls">
      <div className="control-group">
        <button type="button" className="control" aria-label="Zoomer" title="Zoomer" onClick={() => mapApi.zoomBy(1)}>
          <Plus size={18} />
        </button>
        <button type="button" className="control" aria-label="Dézoomer" title="Dézoomer" onClick={() => mapApi.zoomBy(-1)}>
          <Minus size={18} />
        </button>
      </div>
      <div className="control-group">
        <button
          type="button"
          className="control"
          aria-label="Centrer sur ma position"
          title="Ma position"
          aria-busy={locating}
          disabled={locating}
          onClick={locate}
        >
          <LocateFixed size={18} />
        </button>
        <MarkersMenu />
        <SettingsMenu />
      </div>
      {notice && (
        <p className="controls-notice" role="alert">
          {notice}
        </p>
      )}
    </div>
  );
}
