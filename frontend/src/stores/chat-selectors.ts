import type { Chat } from '../api/types';

export type ChatFilter = 'all' | 'unread' | 'groups';

export interface ChatListView {
  pinned: Chat[];
  others: Chat[];
  archived: Chat[];
  archivedUnread: number;
}

const byActivity = (a: Chat, b: Chat) => b.lastActivity - a.lastActivity;

function matches(chat: Chat, filter: ChatFilter, query: string): boolean {
  if (filter === 'unread' && chat.unread === 0) return false;
  if (filter === 'groups' && !chat.isGroup) return false;
  if (!query) return true;
  const q = query.toLocaleLowerCase();
  return (
    chat.name.toLocaleLowerCase().includes(q) ||
    (chat.lastMessage?.text.toLocaleLowerCase().includes(q) ?? false)
  );
}

export function buildChatList(chats: Chat[], filter: ChatFilter, query: string): ChatListView {
  const q = query.trim();
  const visible = chats.filter((c) => matches(c, filter, q));
  const archived = visible.filter((c) => c.archived).sort(byActivity);
  const active = visible.filter((c) => !c.archived);
  // pins only get their own section in the plain view; when searching, everything is one list
  const pinned = q ? [] : active.filter((c) => c.pinned).sort(byActivity);
  const others = active.filter((c) => q || !c.pinned).sort(byActivity);
  return {
    pinned,
    others,
    archived,
    archivedUnread: chats.filter((c) => c.archived && c.unread > 0 && !c.muted).length,
  };
}

// flat order the keyboard (Alt+Up/Down) walks through
export function navigationOrder(view: ChatListView, showArchived: boolean): Chat[] {
  return showArchived ? view.archived : [...view.pinned, ...view.others];
}
