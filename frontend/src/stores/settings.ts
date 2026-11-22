import { create } from 'zustand';
import { backend, type AppSettings, type GhostSettings, type SystemPalette } from '../api';
import { DEFAULT_GHOST, DEFAULT_SETTINGS } from '../api/defaults';

interface SettingsState {
  settings: AppSettings;
  ghost: GhostSettings;
  // OS light/dark and accent; from Go in the desktop app, from the browser otherwise
  system: SystemPalette | null;
  safeMode: boolean;
  loaded: boolean;
  load(): Promise<void>;
  update(fn: (s: AppSettings) => AppSettings): void;
  setGhost(patch: Partial<GhostSettings>): void;
  setSystem(p: SystemPalette): void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useSettings = create<SettingsState>((set, get) => ({
  settings: structuredClone(DEFAULT_SETTINGS),
  ghost: { ...DEFAULT_GHOST },
  system: null,
  safeMode: false,
  loaded: false,
  async load() {
    const [settings, ghost, system, safeMode] = await Promise.all([
      backend.settings.get(),
      backend.privacy.getGhost(),
      backend.systemTheme.get().catch(() => null),
      backend.system.isSafeMode().catch(() => false),
    ]);
    set({ settings, ghost, system, safeMode, loaded: true });
  },
  update(fn) {
    const settings = fn(get().settings);
    set({ settings });
    // sliders and the sidebar resizer fire a lot, coalesce the writes
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void backend.settings.set(get().settings), 250);
  },
  setGhost(patch) {
    const ghost = { ...get().ghost, ...patch };
    set({ ghost });
    void backend.privacy.setGhost(ghost);
  },
  setSystem: (system) => set({ system }),
}));

export interface EffectiveAccent {
  accent: string | null;
  // only set for the system accent; presets and themes bring their own text color
  accentFg: string | null;
}

export function effectiveAccent(s: AppSettings, system: SystemPalette | null): EffectiveAccent {
  if (s.appearance.useSystemAccent && system?.accent) {
    return { accent: system.accent, accentFg: system.accentFg || null };
  }
  // no OS accent to use (or it's off): fall back to whatever the user picked
  return { accent: s.appearance.accent, accentFg: null };
}

export function systemScheme(system: SystemPalette | null): 'dark' | 'light' | null {
  return system && system.scheme !== 'none' ? system.scheme : null;
}
