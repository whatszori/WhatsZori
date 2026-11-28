// Events the Go side emits. Names must match internal/events/events.go (a Go test checks them
// both ways), and the payload shapes are checked against the generated bindings in
// api/wails/check.ts.

export const WZ_EVENTS = {
  systemThemeChanged: 'wz:systheme:changed',
  themeChanged: 'wz:theme:changed',
  settingsChanged: 'wz:settings:changed',
  toastShow: 'wz:toast:show',
  toastWithdraw: 'wz:toast:withdraw',
  pluginChanged: 'wz:plugin:changed',
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
  msgRemoved: 'msg:removed',
  chatUpdate: 'chat:update',
  chatRemoved: 'chat:removed',
  avatarChanged: 'avatar:changed',
  chatCleared: 'chat:cleared',
  exportProgress: 'export:progress',
  notificationOpen: 'notification:open',
  presence: 'presence',
  chatTyping: 'chat:typing',
  statusUpdate: 'status:update',
  syncProgress: 'sync:progress',
  toast: 'toast',
  scheduledChanged: 'scheduled:changed',
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

// one notification drawn by WhatsZori itself (the toast window, desktop app on Windows)
export interface InAppToast {
  id: string;
  // empty for summaries ("12 new messages in 3 chats")
  chatJid: string;
  pk: string;
  title: string;
  body: string;
  // /wz-avatar/... or empty (no picture, or previews off)
  avatar: string;
  isGroup: boolean;
  // reply and "Mark as read"
  actions: boolean;
  at: number;
}

export interface WzEvents {
  'wz:systheme:changed': SystemPalette;
  'wz:theme:changed': ThemeFileChanged;
  // a file in a plugin's folder changed
  'wz:plugin:changed': { id: string };
  'wz:settings:changed': { key: string };
  'wz:toast:show': InAppToast;
  'wz:toast:withdraw': { jid: string };
}
