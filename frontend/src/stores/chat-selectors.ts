import type { Chat } from '../api/types';

// list:<id> is one of the user's own lists
export type ChatFilter =
  'all' | 'unread' | 'groups' | 'favorites' | 'communities' | 'channels' | `list:${number}`;

export interface ChatListView {
  pinned: Chat[];
  others: Chat[];
  archived: Chat[];
  archivedUnread: number;
}

const byActivity = (a: Chat, b: Chat) => b.lastActivity - a.lastActivity;

function matches(chat: Chat, filter: ChatFilter, query: string): boolean {
  // a community isn't a chat: it's a heading in the communities view
  if (chat.isCommunity) return filter === 'communities' && !query;
  // channels live under their own chip (and turn up when searching)
  if (filter === 'channels') {
    if (!chat.channel) return false;
  } else if (chat.channel && !query) return false;
  if (filter === 'communities' && !chat.community) return false;
  if (filter === 'unread' && chat.unread === 0) return false;
  if (filter === 'groups' && !chat.isGroup) return false;
  if (filter === 'favorites' && !chat.favorite) return false;
  if (filter.startsWith('list:') && !chat.lists?.includes(Number(filter.slice(5)))) return false;
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

// the communities view: each community with its groups, the announcements group first
export function communitySections(chats: Chat[]): { community: Chat; groups: Chat[] }[] {
  const parents = chats.filter((c) => c.isCommunity);
  return parents
    .map((community) => ({
      community,
      groups: chats
        .filter((c) => c.community?.jid === community.jid && !c.archived)
        .sort((a, b) => Number(!!b.isAnnounce) - Number(!!a.isAnnounce) || byActivity(a, b)),
    }))
    .sort((a, b) => (b.groups[0]?.lastActivity ?? 0) - (a.groups[0]?.lastActivity ?? 0));
}
