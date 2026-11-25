import { useEffect, useRef, useState, type ReactNode } from 'react';
import type React from 'react';
import { cellColors, getPalette, type Palette } from '../data/palettes';
import { isWide } from '../map/api';

/** L'écran fait-il au moins 900 px de large (la bascule grand écran de `styles.css`) ? Suit les changements. */
export function useWide(): boolean {
  const [wide, setWide] = useState(isWide);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const update = () => setWide(mq.matches);
    mq.addEventListener('change', update);
    update();
    return () => mq.removeEventListener('change', update);
  }, []);
  return wide;
}

/** Palettes des pastilles de valeur (tableaux du panneau, relevés des bouées, rose de sélection). */
export const HEIGHT = getPalette('height', true);
export const PERIOD = getPalette('period', true);
export const WIND = getPalette('wind', true);
export const TEMP = getPalette('temp', true);
export const RAIN = getPalette('rain', true);
export const CURRENT = getPalette('current', true);

/**
 * Flèche de direction. `from` est la direction de provenance (convention météo) :
 * la flèche pointe là où vont le vent ou les vagues.
 */
export function Arrow({ from, size = 14 }: { from: number | null | undefined; size?: number }) {
  if (from == null || !Number.isFinite(from)) return <span className="arrow-none">–</span>;
  return (
    <svg
      className="arrow"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ transform: `rotate(${from + 180}deg)` }}
      aria-hidden="true"
    >
      <path d="M8 1.5 12.6 13 8 10.4 3.4 13Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Valeur sur fond de palette, avec sous le chiffre la flèche de sa direction quand `from` est donné.
 * Sert aux tableaux du panneau, aux relevés d'une bouée (`Panel.tsx`) et à la rose de sélection.
 */
export function Chip({ value, text, palette, from }: { value: number | null; text: string; palette: Palette; from?: number | null }) {
  const colors = cellColors(palette, value);
  const arrow = from != null && Number.isFinite(from);
  return (
    <span className="chip" style={colors ?? undefined} data-empty={colors ? undefined : true} data-dir={arrow || undefined}>
      {text}
      {arrow && <Arrow from={from} size={11} />}
    </span>
  );
}

/** Le logo d'Aywhoula : le point au-dessus de la houle (barre du haut, badge Premium). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="19.5" cy="8.5" r="3" fill="currentColor" />
      <path d="M2.5 18.5c3 0 3-3.4 6-3.4s3 3.4 6 3.4 3-3.4 6-3.4c2 0 2.9 1.2 3.9 2.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * La marque animée : la houle défile sous le point, qui monte et descend avec elle.
 * C'est le même dessin que l'écran de démarrage d'index.html : ils se modifient
 * ensemble. Le trait est une fenêtre (un tiret) sur une vague plus longue, qui
 * glisse d'une période pendant que le tiret recule d'autant. L'animation est
 * écrite dans index.html, où l'écran de démarrage en a besoin avant l'app.
 */
export function AnimatedMark({ size }: { size: number }) {
  return (
    <svg className="logo-anim" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <circle className="logo-anim-dot" cx="19.5" cy="8.5" r="3" fill="currentColor" />
      <path
        className="logo-anim-wave"
        d="M-21.5 18.5c3 0 3-3.4 6-3.4s3 3.4 6 3.4 3-3.4 6-3.4 3 3.4 6 3.4 3-3.4 6-3.4 3 3.4 6 3.4 3-3.4 6-3.4 3 3.4 6 3.4"
        pathLength={400}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="183 1000"
        strokeDashoffset={-200}
      />
    </svg>
  );
}

/**
 * Bouton qui ouvre un panneau flottant ; se ferme au clic extérieur et à Échap. `place` : la position du
 * panneau, calculée à l'ouverture d'après son hôte, quand il doit sortir d'un conteneur qui défile (la
 * feuille du téléphone) ; sinon, il se place à côté du bouton (`side`, `align`).
 */
export function Popover({
  label,
  title,
  className = '',
  align = 'end',
  side = 'bottom',
  place,
  trigger,
  children,
}: {
  label: string;
  title?: string;
  className?: string;
  align?: 'start' | 'end';
  side?: 'top' | 'bottom' | 'left';
  place?: (host: HTMLElement) => React.CSSProperties;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className={`popover-host ${className}`} ref={root}>
      <button
        ref={button}
        type="button"
        className="popover-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div className="popover" data-align={align} data-side={side} role="dialog" aria-label={label} style={place && root.current ? place(root.current) : undefined}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/**
 * La place d'un panneau ouvert depuis une ligne de la barre du dialog, sur téléphone : sur toute la largeur de
 * la ligne (16 px de marge), au-dessus d'elle. La feuille fait défiler son contenu et rognerait le panneau : il
 * est placé par rapport à l'écran. Hors de cette barre, la place habituelle (`side`, `align`).
 */
export function aboveSheetRow(host: HTMLElement): React.CSSProperties {
  const row = host.closest('.sheet-bar-row') as HTMLElement | null;
  if (!row) return {};
  const r = row.getBoundingClientRect();
  return { position: 'fixed', top: 'auto', right: 'auto', left: r.left, bottom: window.innerHeight - r.top + 10, width: r.width, maxWidth: 'none' };
}

function radioStep(e: React.KeyboardEvent<HTMLElement>, select: boolean): void {
  const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!delta) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)')];
  const at = radios.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  const next = radios[(at + delta + radios.length) % radios.length];
  next.focus();
  if (select) next.click();
}

/** Navigation aux flèches dans un groupe de boutons radio (à poser sur le conteneur du groupe) : la flèche choisit l'option. */
export function radioKeyDown(e: React.KeyboardEvent<HTMLElement>): void {
  radioStep(e, true);
}

/** Variante pour un groupe dont le choix referme un menu : la flèche déplace le focus, Entrée ou Espace valide. */
export function radioFocusKeyDown(e: React.KeyboardEvent<HTMLElement>): void {
  radioStep(e, false);
}

/** Choix exclusif parmi quelques options courtes. */
/**
 * `iconOnly` : chaque bouton ne montre que son icône ; son libellé reste son nom pour les
 * lecteurs d'écran et s'affiche au survol.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  iconOnly = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  iconOnly?: boolean;
}) {
  return (
    <div className={iconOnly ? 'segmented segmented-icons' : 'segmented'} role="radiogroup" aria-label={label} onKeyDown={radioKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={iconOnly ? o.label : undefined}
          tabIndex={o.value === value ? 0 : -1}
          title={iconOnly ? (o.title ?? o.label) : o.title}
          className="segment"
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {!iconOnly && o.label}
        </button>
      ))}
    </div>
  );
}
