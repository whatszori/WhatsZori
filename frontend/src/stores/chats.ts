import { create } from 'zustand';
import { backend, type Chat, type JID } from '../api';
import type { ChatFilter } from './chat-selectors';
import { toastError } from './toasts';

interface ChatsState {
  chats: Record<JID, Chat>;
  loaded: boolean;
  filter: ChatFilter;
  query: string;
  showArchived: boolean;
  // chatJid -> senderJid -> senderName
  typing: Record<JID, Record<JID, string>>;
  load(): Promise<void>;
  upsert(chat: Chat): void;
  remove(jid: JID): void;
  setFilter(filter: ChatFilter): void;
  setQuery(query: string): void;
  setShowArchived(show: boolean): void;
  setTyping(chatJid: JID, senderJid: JID, name: string, typing: boolean): void;
  setPresence(jid: JID, online: boolean, lastSeen: number | null): void;
  setPinned(jid: JID, pinned: boolean): Promise<void>;
  setArchived(jid: JID, archived: boolean): Promise<void>;
  setMuted(jid: JID, muted: boolean): Promise<void>;
  markRead(jid: JID): Promise<void>;
}

// WhatsApp doesn't always send "paused": someone who closes the app or loses signal mid-word
// stays "composing" forever. Phones re-send composing every few seconds while typing, so a state
// that isn't refreshed for this long is stale.
export const TYPING_TTL = 12_000;
const typingTimers = new Map<string, number>();

export const useChats = create<ChatsState>((set, get) => {
  // optimistic toggle, rolled back if the backend says no
  const patch = async (jid: JID, p: Partial<Chat>, call: () => Promise<void>) => {
    const before = get().chats[jid];
    if (!before) return;
    set((s) => ({ chats: { ...s.chats, [jid]: { ...before, ...p } } }));
    try {
      await call();
    } catch (err) {
      toastError(err);
      set((s) => ({ chats: { ...s.chats, [jid]: before } }));
    }
  };

  return {
    chats: {},
    loaded: false,
    filter: 'all',
    query: '',
    showArchived: false,
    typing: {},
    async load() {
      const list = await backend.chats.listChats();
      set({ chats: Object.fromEntries(list.map((c) => [c.jid, c])), loaded: true });
    },
    upsert: (chat) =>
      set((s) => {
        const prev = s.chats[chat.jid];
        // presence comes through its own event, don't let a stale chat snapshot clobber it
        const merged = prev ? { ...chat, online: prev.online, lastSeen: prev.lastSeen } : chat;
        return { chats: { ...s.chats, [chat.jid]: merged } };
      }),
    remove: (jid) =>
      set((s) => {
        const chats = { ...s.chats };
        delete chats[jid];
        return { chats };
      }),
    setFilter: (filter) => set({ filter }),
    setQuery: (query) => set({ query }),
    setShowArchived: (showArchived) => set({ showArchived }),
    setTyping: (chatJid, senderJid, name, typing) => {
      const key = `${chatJid}|${senderJid}`;
      window.clearTimeout(typingTimers.get(key));
      typingTimers.delete(key);
      if (typing) {
        typingTimers.set(
          key,
          window.setTimeout(() => get().setTyping(chatJid, senderJid, name, false), TYPING_TTL),
        );
      }
      set((s) => {
        const cur = { ...(s.typing[chatJid] ?? {}) };
        if (typing) cur[senderJid] = name;
        else delete cur[senderJid];
        return { typing: { ...s.typing, [chatJid]: cur } };
      });
    },
    setPresence: (jid, online, lastSeen) => {
      // gone offline means not typing anymore, in any chat
      if (!online) {
        for (const [chatJid, senders] of Object.entries(get().typing)) {
          if (senders[jid] !== undefined) get().setTyping(chatJid, jid, senders[jid], false);
        }
      }
      set((s) => {
        const chat = s.chats[jid];
        if (!chat) return s;
        return { chats: { ...s.chats, [jid]: { ...chat, online, lastSeen } } };
      });
    },
    setPinned: (jid, pinned) => patch(jid, { pinned }, () => backend.chats.setPinned(jid, pinned)),
    setArchived: (jid, archived) =>
      patch(jid, { archived }, () => backend.chats.setArchived(jid, archived)),
    setMuted: (jid, muted) => patch(jid, { muted }, () => backend.chats.setMuted(jid, muted)),
    markRead: (jid) => patch(jid, { unread: 0 }, () => backend.chats.markRead(jid)),
  };
});

export function typingNames(typing: Record<JID, string> | undefined): string[] {
  return typing ? Object.values(typing) : [];
}
