import { create } from 'zustand';
import type { JID, Message, MessagePK } from '../api';
import { DEFAULT_SETTINGS } from '../api/defaults';
import { useSettings } from './settings';

// plugin: a plugin's own screen (plugin-core/registry.ts says which)
export type View = 'chats' | 'settings' | 'changes' | 'status' | 'plugin';
// what the rail layout's sidebar shows besides chats and settings
export type RailPanel = 'chats' | 'calls' | 'status';
export type SettingsSection =
  | 'profile'
  | 'appearance'
  | 'notifications'
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
  // people mentioned in the draft: the "@Name" text shown -> their JID
  mentions: Record<string, JID>;
}

export const SIDEBAR_MIN = 260;
export const SIDEBAR_MAX = 480;

export const clampSidebar = (w: number) =>
  Number.isFinite(w) ? Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w))) : 340;

const EMPTY_COMPOSER: ComposerState = {
  draft: '',
  replyTo: null,
  editing: null,
  stashed: '',
  mentions: {},
};

interface UIState {
  view: View;
  settingsSection: SettingsSection;
  // rail layout: open straight into the section instead of the section list
  settingsDirect: boolean;
  // contact / group info panel next to the conversation
  chatInfoOpen: boolean;
  // whose info it shows; null = the open chat. A group member clicked in a group, for example
  infoJid: JID | null;
  activeChat: JID | null;
  railPanel: RailPanel;
  sidebarWidth: number;
  // message to scroll to and flash; `nonce` lets the same pk be re-triggered
  focusMessage: { jid: JID; pk: MessagePK; nonce: number } | null;
  composer: Record<JID, ComposerState>;
  infoMessage: { jid: JID; pk: MessagePK } | null;
  // full-window media viewer
  // items: what ←/→ walk through; default is what's loaded in the chat
  viewer: { jid: JID; pk: MessagePK; items?: Message[] } | null;
  // a profile picture, full size
  avatarViewer: { jid: JID; name: string } | null;
  setAvatarViewer(v: { jid: JID; name: string } | null): void;
  searchFocusNonce: number;
  // words to mark in the bubbles of one chat while its Ctrl+F bar is open
  searchHighlight: { jid: JID; query: string } | null;
  chatSearchOpen: boolean;
  newChatOpen: boolean;
  // multi-select in one chat; the composer turns into the selection bar
  selection: { jid: JID; pks: MessagePK[] } | null;
  // messages waiting for the chat picker
  forwarding: MessagePK[] | null;
  toggleSelected(jid: JID, pk: MessagePK): void;
  clearSelection(): void;
  setForwarding(pks: MessagePK[] | null): void;
  setNewChatOpen(open: boolean): void;
  setSearchHighlight(v: { jid: JID; query: string } | null): void;
  setChatSearchOpen(open: boolean): void;
  openChat(jid: JID | null): void;
  setRailPanel(panel: RailPanel): void;
  openSettings(section?: SettingsSection, direct?: boolean): void;
  setChatInfoOpen(open: boolean): void;
  openInfo(jid: JID | null): void;
  closeSettings(): void;
  // the "Deleted & edited" screen in the main area
  openChanges(): void;
  closeChanges(): void;
  openStatus(): void;
  closeStatus(): void;
  setSettingsSection(section: SettingsSection): void;
  setSidebarWidth(w: number): void;
  jumpTo(jid: JID, pk: MessagePK): void;
  setInfoMessage(v: { jid: JID; pk: MessagePK } | null): void;
  openViewer(jid: JID, pk: MessagePK, items?: Message[]): void;
  closeViewer(): void;
  focusSearch(): void;
  setDraft(jid: JID, draft: string): void;
  addMention(jid: JID, label: string, who: JID): void;
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
    infoJid: null,
    activeChat: null,
    railPanel: 'chats',
    sidebarWidth: DEFAULT_SETTINGS.ui.sidebarWidth,
    focusMessage: null,
    composer: {},
    infoMessage: null,
    viewer: null,
    avatarViewer: null,
    searchFocusNonce: 0,
    searchHighlight: null,
    chatSearchOpen: false,
    newChatOpen: false,
    selection: null,
    forwarding: null,
    toggleSelected: (jid, pk) =>
      set((s) => {
        const cur = s.selection?.jid === jid ? s.selection.pks : [];
        const pks = cur.includes(pk) ? cur.filter((p) => p !== pk) : [...cur, pk];
        return { selection: pks.length ? { jid, pks } : null };
      }),
    clearSelection: () => set({ selection: null }),
    setForwarding: (forwarding) => set({ forwarding }),
    setNewChatOpen: (newChatOpen) =>
      set(newChatOpen ? { newChatOpen, view: 'chats', railPanel: 'chats' } : { newChatOpen }),
    setSearchHighlight: (searchHighlight) => set({ searchHighlight }),
    setChatSearchOpen: (chatSearchOpen) => set({ chatSearchOpen }),
    openChat: (jid) =>
      set((s) => ({
        activeChat: jid,
        chatSearchOpen: s.activeChat === jid ? s.chatSearchOpen : false,
        selection: s.activeChat === jid ? s.selection : null,
        view: 'chats',
        chatInfoOpen: s.activeChat === jid ? s.chatInfoOpen : false,
        infoJid: s.activeChat === jid ? s.infoJid : null,
      })),
    setRailPanel: (railPanel) => set({ railPanel, view: 'chats' }),
    openSettings: (section, direct = false) =>
      set((s) => ({
        view: 'settings',
        settingsSection: section ?? s.settingsSection,
        settingsDirect: direct,
      })),
    setChatInfoOpen: (chatInfoOpen) => set({ chatInfoOpen, infoJid: null }),
    openInfo: (infoJid) => set({ chatInfoOpen: true, infoJid }),
    closeSettings: () => set({ view: 'chats' }),
    openChanges: () => set({ view: 'changes' }),
    closeChanges: () => set({ view: 'chats' }),
    openStatus: () => set({ view: 'status', railPanel: 'chats' }),
    closeStatus: () => set({ view: 'chats' }),
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
    openViewer: (jid, pk, items) =>
      set((s) => ({
        viewer: { jid, pk, items: items ?? (s.viewer?.jid === jid ? s.viewer.items : undefined) },
      })),
    closeViewer: () => set({ viewer: null }),
    setAvatarViewer: (avatarViewer) => set({ avatarViewer }),
    focusSearch: () => set((s) => ({ view: 'chats', searchFocusNonce: s.searchFocusNonce + 1 })),
    setDraft: (jid, draft) => {
      // forget mentions whose "@Name" is gone from the text
      const c = get().composer[jid] ?? EMPTY_COMPOSER;
      const mentions = Object.fromEntries(
        Object.entries(c.mentions ?? {}).filter(([label]) => draft.includes(label)),
      );
      patchComposer(jid, { draft, mentions });
    },
    addMention: (jid, label, who) => {
      const c = get().composer[jid] ?? EMPTY_COMPOSER;
      patchComposer(jid, { mentions: { ...(c.mentions ?? {}), [label]: who } });
    },
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
