import type { AppSettings, GhostSettings } from './types';

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: {
    theme: 'system',
    accent: null,
    useSystemAccent: false,
    density: 'comfortable',
    layout: 'panels',
    fontScale: 1,
  },
  tray: { closeToTray: true },
  notifications: { enabled: true, preview: true, sound: true, style: 'auto' },
  history: { keepDeleted: true, keepEditHistory: true, autoDownloadMedia: true },
  plugins: { 'message-timestamps': true, 'translate-button': false, 'quick-reply-templates': true },
  themes: {},
  themeModules: {},
  userTheme: null,
  ui: { sidebarWidth: 340 },
};

export const DEFAULT_GHOST: GhostSettings = {
  hideOnline: false,
  hideTyping: false,
  readReceipts: 'always',
};

type Stored = Partial<{ [K in keyof AppSettings]: Partial<AppSettings[K]> | AppSettings[K] }>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Stored settings can be from an older build (missing keys) or hand-edited, so fill in defaults
// one level deep instead of trusting the shape.
export function withDefaults(stored: unknown): AppSettings {
  const out = structuredClone(DEFAULT_SETTINGS);
  if (!isObject(stored)) return out;
  const s = stored as Stored;
  for (const key of Object.keys(out) as (keyof AppSettings)[]) {
    const value = s[key];
    if (value === undefined) continue;
    const base = out[key];
    if (isObject(base) && isObject(value)) {
      Object.assign(base, value);
    } else if (!isObject(base) && !isObject(value)) {
      (out as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}
