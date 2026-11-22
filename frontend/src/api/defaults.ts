import type { AppSettings, GhostSettings } from './types';

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: {
    theme: 'system',
    accent: null,
    useSystemAccent: false,
    density: 'comfortable',
    fontScale: 1,
  },
  history: { keepDeleted: true, keepEditHistory: true, autoDownloadMedia: false },
  plugins: { 'message-timestamps': true, 'translate-button': false, 'quick-reply-templates': true },
  themes: {},
  themeModules: {},
};

export const DEFAULT_GHOST: GhostSettings = {
  hideOnline: false,
  hideTyping: false,
  readReceipts: 'always',
};
