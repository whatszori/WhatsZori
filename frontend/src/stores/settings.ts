import { create } from 'zustand';
import { backend, type AppSettings, type GhostSettings } from '../api';
import { DEFAULT_GHOST, DEFAULT_SETTINGS } from '../api/defaults';

interface SettingsState {
  settings: AppSettings;
  ghost: GhostSettings;
  loaded: boolean;
  load(): Promise<void>;
  update(fn: (s: AppSettings) => AppSettings): void;
  setGhost(patch: Partial<GhostSettings>): void;
}

// What the Go side will report from the OS later; mocked as a calm blue for now.
export const MOCK_SYSTEM_ACCENT = '#4a6fa5';

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export const useSettings = create<SettingsState>((set, get) => ({
  settings: structuredClone(DEFAULT_SETTINGS),
  ghost: { ...DEFAULT_GHOST },
  loaded: false,
  async load() {
    const [settings, ghost] = await Promise.all([backend.settings.get(), backend.privacy.getGhost()]);
    set({ settings, ghost, loaded: true });
  },
  update(fn) {
    const settings = fn(get().settings);
    set({ settings });
    // sliders fire a lot, coalesce the writes
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void backend.settings.set(get().settings), 250);
  },
  setGhost(patch) {
    const ghost = { ...get().ghost, ...patch };
    set({ ghost });
    void backend.privacy.setGhost(ghost);
  },
}));

export function effectiveAccent(s: AppSettings): string | null {
  return s.appearance.useSystemAccent ? MOCK_SYSTEM_ACCENT : s.appearance.accent;
}
