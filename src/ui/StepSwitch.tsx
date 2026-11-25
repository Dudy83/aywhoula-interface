/**
 * Le pas de temps, un seul réglage pour le détail du jour du panneau et pour la ligne de temps : une
 * colonne du tableau, ou un point des courbes, toutes les 1, 3, 5 ou 12 heures.
 */
import { useStore, type DayStep } from '../state/store';
import { Segmented } from './common';

const OPTIONS: { value: DayStep; label: string; title: string }[] = [
  { value: '1h', label: '1 h', title: 'Toutes les heures' },
  { value: '3h', label: '3 h', title: 'Toutes les 3 heures' },
  { value: '5h', label: '5 h', title: 'Toutes les 5 heures' },
  { value: '12h', label: '12 h', title: 'Toutes les 12 heures' },
];

export function StepSwitch({ className }: { className?: string }) {
  const dayStep = useStore((s) => s.dayStep);
  const setDayStep = useStore((s) => s.setDayStep);
  const control = <Segmented<DayStep> label="Pas de temps" value={dayStep} onChange={setDayStep} options={OPTIONS} />;
  return className ? <div className={className}>{control}</div> : control;
}
