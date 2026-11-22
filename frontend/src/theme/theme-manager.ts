export type ThemeMode = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';
export type Layout = 'panels' | 'rail';

export interface AppearanceOptions {
  theme: ThemeMode;
  // preset id, a '#rrggbb' custom color, or null for the theme default
  accent: string | null;
  // text color on the accent; null keeps the theme's --wz-accent-fg
  accentFg?: string | null;
  // what the OS says, when we know better than prefers-color-scheme (the Go side in Wails)
  systemScheme?: 'light' | 'dark' | null;
  density: Density;
  layout: Layout;
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

export function resolveTheme(
  mode: ThemeMode,
  systemScheme?: 'light' | 'dark' | null,
): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  if (systemScheme) return systemScheme;
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
  const theme = resolveTheme(current.theme, current.systemScheme);
  root.dataset.theme = theme;

  const accent = resolveAccent(current.accent, theme);
  if (accent) root.style.setProperty('--wz-accent', accent);
  else root.style.removeProperty('--wz-accent');
  if (accent && current.accentFg) root.style.setProperty('--wz-accent-fg', current.accentFg);
  else root.style.removeProperty('--wz-accent-fg');

  root.dataset.density = current.density;
  root.dataset.layout = current.layout;
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

// "rgb(18, 18, 20)" -> "#121214"; null for anything with transparency or that doesn't parse
export function cssColorToHex(color: string): string | null {
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(
    color.trim(),
  );
  if (!m) return /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim().toLowerCase() : null;
  if (m[4] !== undefined) {
    const a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (a < 1) return null;
  }
  return (
    '#' +
    [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')
  );
}

// What the native window should look like now: dark or light chrome, and the page background so
// resize gaps and the next startup match.
export function nativeTheme(doc = document): { dark: boolean; background: string } {
  const dark = doc.documentElement.dataset.theme === 'dark';
  const bg = doc.body ? cssColorToHex(getComputedStyle(doc.body).backgroundColor) : null;
  return { dark, background: bg ?? '' };
}
