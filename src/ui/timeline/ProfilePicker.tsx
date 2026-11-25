/**
 * Le type d'affichage de la ligne de temps : un déclencheur du style du choix du modèle (le pictogramme, le
 * nom, court sous 900 px, et un chevron), et sa liste « Afficher sur la ligne de temps ». Le choix est gardé
 * sur l'appareil ; le pas, le modèle et la lecture valent pour tous les types.
 */
import { Check, ChevronDown } from 'lucide-react';
import { useStore } from '../../state/store';
import { aboveSheetRow, Popover, radioFocusKeyDown, useWide } from '../common';
import { PROFILE_BY_ID, PROFILES } from './profiles';

export function ProfilePicker() {
  const profile = useStore((s) => s.timelineProfile);
  const setProfile = useStore((s) => s.setTimelineProfile);
  const wide = useWide();
  const current = PROFILE_BY_ID[profile];
  const Icon = current.icon;
  return (
    <Popover
      className="model profile"
      label={`Afficher sur la ligne de temps : ${current.name}. Changer`}
      side="top"
      align="start"
      // Sous 900 px, sur toute la largeur de la ligne du pas, au-dessus d'elle.
      place={wide ? undefined : aboveSheetRow}
      trigger={
        <>
          <Icon size={16} aria-hidden="true" />
          <span className="model-name">{wide ? current.name : current.short}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </>
      }
    >
      {(close) => (
        <div className="model-list">
          <div className="popover-title">Afficher sur la ligne de temps</div>
          <ul role="radiogroup" aria-label="Type d’affichage" onKeyDown={radioFocusKeyDown}>
            {PROFILES.map((p) => {
              const ItemIcon = p.icon;
              const chosen = p.id === profile;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    tabIndex={chosen ? 0 : -1}
                    className="model-option profile-option"
                    onClick={() => {
                      setProfile(p.id);
                      close();
                    }}
                  >
                    <span className="model-option-check">{chosen && <Check size={14} aria-hidden="true" />}</span>
                    <span className="profile-tile" aria-hidden="true">
                      <ItemIcon size={17} />
                    </span>
                    <span className="model-option-main">
                      <span className="model-option-name">{p.name}</span>
                      <span className="model-option-meta">{p.text}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Popover>
  );
}
