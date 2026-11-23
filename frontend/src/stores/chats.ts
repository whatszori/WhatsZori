import { create } from 'zustand';
import { backend, type Chat, type ChatList, type JID } from '../api';
import type { ChatFilter } from './chat-selectors';
import { toastError } from './toasts';
import { useUI } from './ui';

interface ChatsState {
  chats: Record<JID, Chat>;
  loaded: boolean;
  filter: ChatFilter;
  query: string;
  showArchived: boolean;
  // chatJid -> senderJid -> senderName
  typing: Record<JID, Record<JID, string>>;
  lists: ChatList[];
  load(): Promise<void>;
  setFavorite(jid: JID, on: boolean): Promise<void>;
  setInList(id: number, jid: JID, inList: boolean): Promise<void>;
  createList(name: string): Promise<ChatList | null>;
  renameList(id: number, name: string): Promise<void>;
  deleteList(id: number): Promise<void>;
  // open a chat with someone, creating it if we never wrote to them
  openWith(jid: JID): Promise<void>;
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
    lists: [],
    async load() {
      const [list, lists] = await Promise.all([backend.chats.listChats(), backend.chats.lists()]);
      set({ chats: Object.fromEntries(list.map((c) => [c.jid, c])), lists, loaded: true });
    },
    setFavorite: (jid, on) =>
      patch(jid, { favorite: on }, () => backend.chats.setFavorite(jid, on)),
    setInList: (id, jid, inList) => {
      const cur = new Set(get().chats[jid]?.lists ?? []);
      if (inList) cur.add(id);
      else cur.delete(id);
      return patch(jid, { lists: [...cur] }, () => backend.chats.setInList(id, jid, inList));
    },
    async createList(name) {
      try {
        const l = await backend.chats.createList(name);
        set((s) => ({ lists: [...s.lists, l] }));
        return l;
      } catch (err) {
        toastError(err);
        return null;
      }
    },
    async renameList(id, name) {
      try {
        await backend.chats.renameList(id, name);
        const n = name.trim().slice(0, 40);
        set((s) => ({ lists: s.lists.map((l) => (l.id === id ? { ...l, name: n } : l)) }));
      } catch (err) {
        toastError(err);
      }
    },
    async deleteList(id) {
      try {
        await backend.chats.deleteList(id);
        set((s) => ({
          lists: s.lists.filter((l) => l.id !== id),
          filter: s.filter === `list:${id}` ? 'all' : s.filter,
          chats: Object.fromEntries(
            Object.entries(s.chats).map(([k, c]) => [
              k,
              c.lists?.includes(id) ? { ...c, lists: c.lists.filter((x) => x !== id) } : c,
            ]),
          ),
        }));
      } catch (err) {
        toastError(err);
      }
    },
    async openWith(jid) {
      try {
        const chat = get().chats[jid] ?? (await backend.chats.open(jid));
        get().upsert(chat);
        useUI.getState().openChat(jid);
      } catch (err) {
        toastError(err);
      }
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
