import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Ce qui s'ouvre par-dessus l'appli dans le parcours de compte : une fenêtre au milieu de
 * l'écran sur ordinateur, une feuille qui monte du bas sur téléphone, à la hauteur de son
 * contenu. Le focus y reste enfermé ; Échap, la croix ou un clic à côté la referment.
 */
export function Dialog({ label, wide = false, className, onClose, children }: { label: string; wide?: boolean; className?: string; onClose: () => void; children: ReactNode }) {
  const node = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const dialog = node.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Avant le panneau, qui se fermerait lui aussi.
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus();
    };
  }, []);

  // Posée sur toute l'appli, d'où qu'elle soit ouverte (un panneau peut en ouvrir une).
  return createPortal(
    <div className="overlay">
      <div className="overlay-dim" onClick={onClose} />
      <div className={className ? `dialog ${className}` : 'dialog'} data-wide={wide || undefined} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={node}>
        <div className="dialog-grip" aria-hidden="true" />
        <button type="button" className="icon-button dialog-close" aria-label="Fermer" title="Fermer (Échap)" onClick={onClose}>
          <X size={18} />
        </button>
        {children}
      </div>
    </div>,
    document.querySelector('.app') ?? document.body,
  );
}
