import { create } from 'zustand';
import type { JID, MessagePK } from '../api';
import { DEFAULT_SETTINGS } from '../api/defaults';
import { useSettings } from './settings';

export type View = 'chats' | 'settings';
// what the rail layout's sidebar shows besides chats and settings
export type RailPanel = 'chats' | 'calls' | 'status';
export type SettingsSection =
  | 'profile'
  | 'appearance'
  | 'privacy'
  | 'history'
  | 'plugins'
  | 'themes'
  | 'marketplace'
  | 'about'
  | (string & {});

export interface ComposerState {
  draft: string;
  replyTo: MessagePK | null;
  editing: MessagePK | null;
  // draft text from before editing started, restored on cancel
  stashed: string;
}

export const SIDEBAR_MIN = 260;
export const SIDEBAR_MAX = 480;

export const clampSidebar = (w: number) =>
  Number.isFinite(w) ? Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w))) : 340;

const EMPTY_COMPOSER: ComposerState = { draft: '', replyTo: null, editing: null, stashed: '' };

interface UIState {
  view: View;
  settingsSection: SettingsSection;
  // rail layout: open straight into the section instead of the section list
  settingsDirect: boolean;
  // contact / group info panel next to the conversation
  chatInfoOpen: boolean;
  activeChat: JID | null;
  railPanel: RailPanel;
  sidebarWidth: number;
  // message to scroll to and flash; `nonce` lets the same pk be re-triggered
  focusMessage: { jid: JID; pk: MessagePK; nonce: number } | null;
  composer: Record<JID, ComposerState>;
  infoMessage: { jid: JID; pk: MessagePK } | null;
  searchFocusNonce: number;
  openChat(jid: JID | null): void;
  setRailPanel(panel: RailPanel): void;
  openSettings(section?: SettingsSection, direct?: boolean): void;
  setChatInfoOpen(open: boolean): void;
  closeSettings(): void;
  setSettingsSection(section: SettingsSection): void;
  setSidebarWidth(w: number): void;
  jumpTo(jid: JID, pk: MessagePK): void;
  setInfoMessage(v: { jid: JID; pk: MessagePK } | null): void;
  focusSearch(): void;
  setDraft(jid: JID, draft: string): void;
  startReply(jid: JID, pk: MessagePK): void;
  startEdit(jid: JID, pk: MessagePK, text: string): void;
  cancelComposerMode(jid: JID): void;
}

export const useUI = create<UIState>((set, get) => {
  const patchComposer = (jid: JID, p: Partial<ComposerState>) =>
    set((s) => ({
      composer: { ...s.composer, [jid]: { ...(s.composer[jid] ?? EMPTY_COMPOSER), ...p } },
    }));

  return {
    view: 'chats',
    settingsSection: 'appearance',
    settingsDirect: false,
    chatInfoOpen: false,
    activeChat: null,
    railPanel: 'chats',
    sidebarWidth: DEFAULT_SETTINGS.ui.sidebarWidth,
    focusMessage: null,
    composer: {},
    infoMessage: null,
    searchFocusNonce: 0,
    openChat: (jid) =>
      set((s) => ({
        activeChat: jid,
        view: 'chats',
        chatInfoOpen: s.activeChat === jid ? s.chatInfoOpen : false,
      })),
    setRailPanel: (railPanel) => set({ railPanel, view: 'chats' }),
    openSettings: (section, direct = false) =>
      set((s) => ({
        view: 'settings',
        settingsSection: section ?? s.settingsSection,
        settingsDirect: direct,
      })),
    setChatInfoOpen: (chatInfoOpen) => set({ chatInfoOpen }),
    closeSettings: () => set({ view: 'chats' }),
    setSettingsSection: (settingsSection) => set({ settingsSection }),
    setSidebarWidth(w) {
      const width = clampSidebar(w);
      if (width === get().sidebarWidth) return;
      set({ sidebarWidth: width });
      // persisted with the rest of the settings (Go in the desktop app, localStorage in a browser)
      useSettings.getState().update((s) => ({ ...s, ui: { ...s.ui, sidebarWidth: width } }));
    },
    jumpTo: (jid, pk) =>
      set((s) => ({ focusMessage: { jid, pk, nonce: (s.focusMessage?.nonce ?? 0) + 1 } })),
    setInfoMessage: (infoMessage) => set({ infoMessage }),
    focusSearch: () => set((s) => ({ view: 'chats', searchFocusNonce: s.searchFocusNonce + 1 })),
    setDraft: (jid, draft) => patchComposer(jid, { draft }),
    startReply: (jid, pk) => {
      const c = get().composer[jid] ?? EMPTY_COMPOSER;
      // replying while editing drops the edit and brings back the draft
      patchComposer(jid, {
        replyTo: pk,
        editing: null,
        draft: c.editing ? c.stashed : c.draft,
      });
    },
    startEdit: (jid, pk, text) => {
      const c = get().composer[jid] ?? EMPTY_COMPOSER;
      patchComposer(jid, {
        editing: pk,
        replyTo: null,
        stashed: c.editing ? c.stashed : c.draft,
        draft: text,
      });
    },
    cancelComposerMode: (jid) => {
      const c = get().composer[jid] ?? EMPTY_COMPOSER;
      patchComposer(jid, {
        replyTo: null,
        editing: null,
        draft: c.editing ? c.stashed : c.draft,
        stashed: '',
      });
    },
  };
});

export function composerFor(state: { composer: Record<JID, ComposerState> }, jid: JID) {
  return state.composer[jid] ?? EMPTY_COMPOSER;
}
