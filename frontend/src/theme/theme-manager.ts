export type ThemeMode = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';

export interface AppearanceOptions {
  theme: ThemeMode;
  // preset id, a '#rrggbb' custom color, or null for the theme default
  accent: string | null;
  density: Density;
  fontScale: number;
}

export const ACCENT_PRESETS: { id: string; name: string; light: string; dark: string }[] = [
  { id: 'slate', name: 'Slate blue', light: '#3d6fb4', dark: '#6f9be0' },
  { id: 'teal', name: 'Teal', light: '#2b7a78', dark: '#5fb3ae' },
  { id: 'sage', name: 'Sage', light: '#4f7a4a', dark: '#86b37f' },
  { id: 'plum', name: 'Plum', light: '#7a4f8c', dark: '#b08cc4' },
  { id: 'clay', name: 'Clay', light: '#a35a3c', dark: '#d48f70' },
  { id: 'graphite', name: 'Graphite', light: '#545862', dark: '#9aa0ac' },
];

const darkQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return darkQuery()?.matches ? 'dark' : 'light';
}

export function resolveAccent(accent: string | null, theme: 'light' | 'dark'): string | null {
  if (!accent) return null;
  const preset = ACCENT_PRESETS.find((p) => p.id === accent);
  if (preset) return preset[theme];
  return /^#[0-9a-f]{6}$/i.test(accent) ? accent : null;
}

let current: AppearanceOptions | null = null;
let listening = false;

function apply(): void {
  if (!current) return;
  const root = document.documentElement;
  const theme = resolveTheme(current.theme);
  root.dataset.theme = theme;

  const accent = resolveAccent(current.accent, theme);
  if (accent) root.style.setProperty('--wz-accent', accent);
  else root.style.removeProperty('--wz-accent');

  root.dataset.density = current.density;
  root.style.setProperty('--wz-font-scale', String(current.fontScale));
}

export function applyAppearance(opts: AppearanceOptions): void {
  current = opts;
  apply();
  if (!listening) {
    darkQuery()?.addEventListener('change', apply);
    listening = true;
  }
}
