import { Minus, Plus } from 'lucide-react';
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cellColors, type Palette } from '../../data/palettes';

/** Dégradé d'une palette de données entre deux valeurs (en SI) : la couleur dit ce que le curseur retient. */
export function paletteFill(palette: Palette, from: number, to: number): string {
  const stops: string[] = [];
  for (let k = 0; k <= 6; k++) {
    const color = cellColors(palette, from + ((to - from) * k) / 6)?.background;
    if (color) stops.push(color);
  }
  return stops.length > 1 ? `linear-gradient(90deg, ${stops.join(', ')})` : (stops[0] ?? 'var(--ink-2)');
}

interface RangeProps {
  min: number;
  max: number;
  step: number;
  /** Une poignée (un maximum) ou deux (une plage). */
  values: number[];
  onChange: (values: number[]) => void;
  /** Nom de chaque poignée, pour les lecteurs d'écran. */
  labels: string[];
  /** La valeur d'une poignée, en clair et dans l'unité affichée. */
  valueText: (value: number) => string;
  /** Fond de la partie retenue. */
  fill: string;
  /** Graduations sous la piste, à intervalles égaux. */
  ticks: string[];
}

/**
 * Curseur à une ou deux poignées. La partie retenue (de 0 à la poignée, ou entre les deux)
 * est peinte aux couleurs de la donnée. Au clavier : flèches, Page précédente et suivante,
 * Début et Fin.
 */
export function Range({ min, max, step, values, onChange, labels, valueText, fill, ticks }: RangeProps) {
  const track = useRef<HTMLDivElement>(null);
  const dragged = useRef(0);
  const ratio = (v: number) => (v - min) / (max - min);
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));

  /** Pose la poignée `index` à `value`, sans qu'elle croise l'autre. */
  const set = (index: number, value: number) => {
    const next = [...values];
    const lower = index > 0 ? values[index - 1] : min;
    const upper = index < values.length - 1 ? values[index + 1] : max;
    next[index] = Number(Math.min(upper, Math.max(lower, snap(value))).toFixed(4));
    if (next[index] !== values[index]) onChange(next);
  };

  const valueAt = (clientX: number): number => {
    const rect = track.current!.getBoundingClientRect();
    return min + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * (max - min);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const value = valueAt(e.clientX);
    // La poignée la plus proche du doigt ; à égalité, celle qui peut aller de ce côté.
    let index = 0;
    for (let i = 1; i < values.length; i++) {
      const closer = Math.abs(values[i] - value) < Math.abs(values[index] - value);
      if (closer || (values[i] === values[index] && value > values[i])) index = i;
    }
    dragged.current = index;
    e.currentTarget.setPointerCapture(e.pointerId);
    set(index, value);
  };

  const onKeyDown = (index: number) => (e: KeyboardEvent) => {
    const delta = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: step * 10, PageDown: -step * 10 }[e.key];
    if (delta !== undefined) set(index, values[index] + delta);
    else if (e.key === 'Home') set(index, min);
    else if (e.key === 'End') set(index, max);
    else return;
    e.preventDefault();
  };

  const from = values.length > 1 ? ratio(values[0]) : 0;
  const to = ratio(values[values.length - 1]);

  return (
    <div className="range-field">
      <div
        className="range"
        ref={track}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) set(dragged.current, valueAt(e.clientX));
        }}
      >
        <div className="range-track" />
        <div className="range-fill" style={{ left: `${from * 100}%`, width: `${Math.max(0, to - from) * 100}%`, background: fill }} />
        {values.map((value, index) => (
          <button
            key={index}
            type="button"
            role="slider"
            className="range-knob"
            style={{ left: `${ratio(value) * 100}%` }}
            aria-label={labels[index]}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={valueText(value)}
            onKeyDown={onKeyDown(index)}
          />
        ))}
      </div>
      <div className="range-scale num" aria-hidden="true">
        {ticks.map((tick, k) => (
          <span key={k}>{tick}</span>
        ))}
      </div>
    </div>
  );
}

/** Valeur entière réglée par deux boutons, moins et plus. */
export function Stepper({ value, min, max, label, text, onChange }: { value: number; min: number; max: number; label: string; text: string; onChange: (value: number) => void }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="Moins" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus size={15} />
      </button>
      <b className="num" aria-live="polite">
        {text}
      </b>
      <button type="button" aria-label="Plus" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus size={15} />
      </button>
    </div>
  );
}

/** Interrupteur, avec son pictogramme et son libellé sur une ligne de liste. */
export function SwitchRow({ icon, label, checked, onChange, disabled = false }: { icon: ReactNode; label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <label className="row switch-row toggle">
      {icon}
      <span className="row-grow">{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}

const SECTOR_LABELS = ['nord', 'nord-nord-est', 'nord-est', 'est-nord-est', 'est', 'est-sud-est', 'sud-est', 'sud-sud-est', 'sud', 'sud-sud-ouest', 'sud-ouest', 'ouest-sud-ouest', 'ouest', 'ouest-nord-ouest', 'nord-ouest', 'nord-nord-ouest'];

/**
 * Boussole à 16 secteurs : ceux d'où le vent doit venir sont en encre. Avec `onChange`, chaque
 * secteur se coche ; sans, elle montre seulement les secteurs (vent de terre d'un lieu).
 */
export function Compass({ mask, onChange, label, size = 92 }: { mask: number; onChange?: (mask: number) => void; label: string; size?: number }) {
  const r = size / 2 - 2;
  const c = size / 2;
  const sectors = Array.from({ length: 16 }, (_, i) => {
    const a0 = ((i * 22.5 - 11.25 - 90) * Math.PI) / 180;
    const a1 = ((i * 22.5 + 11.25 - 90) * Math.PI) / 180;
    const d = `M${c} ${c} L${(c + r * Math.cos(a0)).toFixed(1)} ${(c + r * Math.sin(a0)).toFixed(1)} A${r} ${r} 0 0 1 ${(c + r * Math.cos(a1)).toFixed(1)} ${(c + r * Math.sin(a1)).toFixed(1)} Z`;
    return { i, d, on: (mask & (1 << i)) !== 0 };
  });
  const mark = (text: string, x: number, y: number) => (
    <text x={x} y={y} className="compass-mark" textAnchor="middle" dominantBaseline="middle">
      {text}
    </text>
  );
  return (
    <svg
      className="compass"
      width={size + 24}
      height={size + 24}
      viewBox={`-12 -12 ${size + 24} ${size + 24}`}
      role={onChange ? 'group' : 'img'}
      aria-label={label}
    >
      {sectors.map(({ i, d, on }) =>
        onChange ? (
          <path
            key={i}
            d={d}
            className="compass-sector"
            data-on={on || undefined}
            role="checkbox"
            aria-checked={on}
            aria-label={`Vent de ${SECTOR_LABELS[i]}`}
            tabIndex={0}
            onClick={() => onChange(mask ^ (1 << i))}
            onKeyDown={(e) => {
              if (e.key !== ' ' && e.key !== 'Enter') return;
              e.preventDefault();
              onChange(mask ^ (1 << i));
            }}
          />
        ) : (
          <path key={i} d={d} className="compass-sector" data-on={on || undefined} />
        ),
      )}
      <circle cx={c} cy={c} r={r * 0.42} className="compass-hub" />
      {mark('N', c, -6)}
      {mark('E', size + 6, c)}
      {mark('S', c, size + 6)}
      {mark('O', -6, c)}
    </svg>
  );
}
