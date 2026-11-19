import { useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark' | 'contrast';
export const themeOptions: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Same as device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'contrast', label: 'High contrast' },
];
const KEY = 'sensibilia.researcher.theme';
const contrastQuery = '(prefers-contrast: more)';
const darkQuery = '(prefers-color-scheme: dark)';

export function storedTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    if (themeOptions.some((o) => o.value === value)) return value as ThemePreference;
  } catch {
    /* Storage can be blocked; the device setting applies. */
  }
  return 'system';
}

function resolve(preference: ThemePreference): 'light' | 'dark' | 'contrast' {
  if (preference !== 'system') return preference;
  if (matchMedia(contrastQuery).matches) return 'contrast';
  return matchMedia(darkQuery).matches ? 'dark' : 'light';
}

/** Applied to the document root so every token follows; previews pin themselves to light in CSS. */
export function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.theme = resolve(preference);
}

/** Researcher screens only: the assessor tablet app never receives a theme. */
export function useResearcherTheme() {
  const [preference, setPreference] = useState<ThemePreference>(storedTheme);
  useEffect(() => {
    applyTheme(preference);
    if (preference !== 'system') return;
    const queries = [matchMedia(contrastQuery), matchMedia(darkQuery)];
    const update = () => applyTheme('system');
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, [preference]);
  useEffect(() => () => void delete document.documentElement.dataset.theme, []);
  return [
    preference,
    (next: ThemePreference) => {
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* The choice still applies for this visit. */
      }
      setPreference(next);
    },
  ] as const;
}
