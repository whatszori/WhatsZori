// Events the Go side emits. Names must match internal/events/events.go (a Go test checks them
// both ways), and the payload shapes are checked against the generated bindings in
// api/wails/check.ts.

export const WZ_EVENTS = {
  systemThemeChanged: 'wz:systheme:changed',
  themeChanged: 'wz:theme:changed',
} as const;

export type WzEventName = (typeof WZ_EVENTS)[keyof typeof WZ_EVENTS];

// WhatsApp events; payloads are BackendEvents in types.ts
export const WA_EVENTS = {
  authQR: 'auth:qr',
  authState: 'auth:state',
  authError: 'auth:error',
  connState: 'conn:state',
  msgBatch: 'msg:batch',
  msgStatus: 'msg:status',
  msgEdited: 'msg:edited',
  msgDeleted: 'msg:deleted',
  msgReaction: 'msg:reaction',
  chatUpdate: 'chat:update',
  chatRemoved: 'chat:removed',
  presence: 'presence',
  chatTyping: 'chat:typing',
  syncProgress: 'sync:progress',
  toast: 'toast',
} as const;

export type WaEventName = (typeof WA_EVENTS)[keyof typeof WA_EVENTS];

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
