import { useEffect, useState } from 'react';
import { useStore } from '../state/store';

export type ThemeName = 'light' | 'dark';

const query = '(prefers-color-scheme: dark)';

/** Thème effectif : le choix de l'utilisateur, ou celui du système en mode automatique. */
export function useResolvedTheme(): ThemeName {
  const choice = useStore((s) => s.theme);
  const [system, setSystem] = useState<ThemeName>(() => (window.matchMedia(query).matches ? 'dark' : 'light'));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return choice === 'auto' ? system : choice;
}

export function useMediaQuery(q: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [q]);
  return matches;
}
