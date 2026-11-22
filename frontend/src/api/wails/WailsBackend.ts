import { Events } from '@wailsio/runtime';
import '../../../bindings/events';
import {
  Settings,
  System,
  SystemTheme,
  Themes,
  Window,
} from '../../../bindings/github.com/whatszori/WhatsZori/internal/services';
import type { SystemPalette as GoPalette } from '../../../bindings/github.com/whatszori/WhatsZori/internal/systheme/models';
import type { Backend } from '../backend';
import { withDefaults } from '../defaults';
import type { SystemPalette, WzEventName } from '../events';
import { WZ_EVENTS } from '../events';
import type { MockBackend } from '../mock/MockBackend';
import type {
  AppSettings,
  BackendEventName,
  BackendEvents,
  ConfigFolder,
  UserTheme,
} from '../types';

const SETTINGS_KEY = 'app';
const wzNames = new Set<string>(Object.values(WZ_EVENTS));
const isWzEvent = (name: string): name is WzEventName => wzNames.has(name);

function normalizePalette(p: GoPalette | null): SystemPalette {
  return {
    source: p?.source ?? 'none',
    scheme: p?.scheme === 'dark' || p?.scheme === 'light' ? p.scheme : 'none',
    accent: p?.accent ?? '',
    accentFg: p?.accentFg ?? '',
    raw: Object.fromEntries(
      Object.entries(p?.raw ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'),
    ),
  };
}

// Hybrid backend: Go answers for what exists on the Go side (system, settings, system theme,
// user themes); WhatsApp itself (auth, chats, messages, profile, privacy) is still the mock.
// When whatsmeow lands, those services move over one at a time without touching the UI.
export class WailsBackend implements Backend {
  readonly kind = 'wails' as const;

  constructor(private readonly mock: MockBackend) {}

  get auth() {
    return this.mock.auth;
  }
  get chats() {
    return this.mock.chats;
  }
  get messages() {
    return this.mock.messages;
  }
  get profile() {
    return this.mock.profile;
  }
  get privacy() {
    return this.mock.privacy;
  }

  settings = {
    get: async (): Promise<AppSettings> => {
      const stored = await Settings.Get(SETTINGS_KEY);
      // first launch in the desktop app: nothing in Go yet, so take over what the mock had
      if (stored == null) return this.mock.settings.get();
      return withDefaults(stored);
    },
    set: async (s: AppSettings): Promise<void> => {
      await Settings.Set(SETTINGS_KEY, s);
      // the mock reads history settings (keep deleted, edit history) for its own behaviour
      await this.mock.settings.set(s);
    },
  };

  system = {
    version: () => System.Version(),
    platform: () => System.Platform(),
    isSafeMode: () => System.IsSafeMode(),
    bootOK: () => System.BootOK(),
    openExternal: (url: string) => System.OpenExternal(url),
    openConfigFolder: (kind: ConfigFolder) => System.OpenConfigFolder(kind),
  };

  systemTheme = {
    get: async (): Promise<SystemPalette> => normalizePalette(await SystemTheme.Get()),
  };

  userThemes = {
    list: async (): Promise<UserTheme[]> => (await Themes.List()) ?? [],
    href: (file: string, hash: string) => this.mock.userThemes.href(file, hash),
  };

  window = {
    setTheme: (dark: boolean, background: string) => Window.SetTheme(dark, background),
  };

  on<E extends BackendEventName>(event: E, handler: (payload: BackendEvents[E]) => void) {
    if (!isWzEvent(event)) return this.mock.on(event, handler);
    return Events.On(event, (e) => {
      const data =
        event === WZ_EVENTS.systemThemeChanged ? normalizePalette(e.data as GoPalette) : e.data;
      handler(data as BackendEvents[E]);
    });
  }
}
