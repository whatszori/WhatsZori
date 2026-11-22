// Events the Go side emits. Names must match internal/events/events.go (a Go test checks them),
// and the payload shapes are checked against the generated bindings in api/wails/check.ts.

export const WZ_EVENTS = {
  systemThemeChanged: 'wz:systheme:changed',
  themeChanged: 'wz:theme:changed',
} as const;

export type WzEventName = (typeof WZ_EVENTS)[keyof typeof WZ_EVENTS];

export type ColorScheme = 'dark' | 'light' | 'none';

export interface SystemPalette {
  // which provider answered: windows, xdg-portal, gsettings, macos, browser, ...
  source: string;
  scheme: ColorScheme;
  // '#rrggbb', empty when the OS has no accent (or we can't read it)
  accent: string;
  // black or white, whichever reads better on the accent
  accentFg: string;
  // whatever the provider read, as-is, for debugging
  raw: Record<string, string> | null;
}

export interface ThemeFileChanged {
  file: string;
  // empty when the file was deleted
  hash: string;
}

export interface WzEvents {
  'wz:systheme:changed': SystemPalette;
  'wz:theme:changed': ThemeFileChanged;
}
