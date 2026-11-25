import { create } from 'zustand';

// What plugins did with their permissions while the app runs: every permission-checked call
// lands here, so the sidebar can light up like a camera indicator and the user can see who read
// what and where it went. Kept in memory only; it says what happened, not what was in it.

export interface Access {
  pluginId: string;
  // the permission used
  kind: string;
  // a site for network, otherwise a short word
  detail: string;
  at: number;
  // the same access repeated right after itself
  count: number;
}

const MAX = 300;
// repeats closer than this fold into one line
const FOLD_MS = 10_000;

interface ActivityState {
  items: Access[];
  names: Record<string, string>;
  note(pluginId: string, kind: string, detail?: string): void;
  setName(pluginId: string, name: string): void;
  clear(): void;
}

export const useActivity = create<ActivityState>((set) => ({
  items: [],
  names: {},
  note: (pluginId, kind, detail = '') =>
    set((s) => {
      const now = Date.now();
      const i = s.items.findIndex(
        (a) =>
          a.pluginId === pluginId && a.kind === kind && a.detail === detail && now - a.at < FOLD_MS,
      );
      if (i >= 0) {
        const items = [...s.items];
        items[i] = { ...items[i], at: now, count: items[i].count + 1 };
        // the folded line moves to the top
        items.unshift(...items.splice(i, 1));
        return { items };
      }
      return { items: [{ pluginId, kind, detail, at: now, count: 1 }, ...s.items].slice(0, MAX) };
    }),
  setName: (pluginId, name) => set((s) => ({ names: { ...s.names, [pluginId]: name } })),
  clear: () => set({ items: [] }),
}));

// what each permission looks like in the activity list
export const ACCESS_TEXT: Record<string, string> = {
  messages: 'read messages',
  contacts: 'read contacts',
  presence: 'saw who’s online or typing',
  network: 'went online',
  media: 'opened photos',
  composer: 'wrote in the message box',
  'chats.manage': 'changed a chat',
  files: 'saved a file',
  notifications: 'showed a notification',
  clipboard: 'copied to the clipboard',
};

// the ones that light the indicator up
export const SENSITIVE = new Set(['messages', 'contacts', 'presence', 'network']);
