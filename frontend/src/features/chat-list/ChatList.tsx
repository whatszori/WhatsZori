import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Archive, BellOff, Bell, CheckCheck, Pin, PinOff, ArchiveRestore } from 'lucide-react';
import type { Chat, JID } from '../../api';
import type { ChatFilter, ChatListView } from '../../stores/chat-selectors';
import { useChats } from '../../stores/chats';
import { useSettings } from '../../stores/settings';
import { useUI } from '../../stores/ui';
import { Menu, type MenuEntry, type PopoverAnchor } from '../../ui';
import { ChatItem } from './ChatItem';
import './ChatList.css';

type Row =
  | { type: 'header'; key: string; label: string }
  | { type: 'chat'; key: string; chat: Chat }
  | { type: 'archived'; key: string; count: number; unread: number };

interface ChatListProps {
  view: ChatListView;
  showArchived: boolean;
  query: string;
  filter: ChatFilter;
}

function buildRows(view: ChatListView, showArchived: boolean, query: string): Row[] {
  if (showArchived) return view.archived.map((c) => ({ type: 'chat', key: c.jid, chat: c }));
  const rows: Row[] = [];
  if (view.pinned.length) {
    rows.push({ type: 'header', key: 'h-pinned', label: 'Pinned' });
    for (const c of view.pinned) rows.push({ type: 'chat', key: c.jid, chat: c });
    if (view.others.length) rows.push({ type: 'header', key: 'h-all', label: 'Chats' });
  }
  for (const c of view.others) rows.push({ type: 'chat', key: c.jid, chat: c });
  // while searching, archived hits are shown inline instead of hidden behind the entry
  if (query.trim()) {
    if (view.archived.length) {
      rows.push({ type: 'header', key: 'h-arch', label: 'Archived' });
      for (const c of view.archived) rows.push({ type: 'chat', key: c.jid, chat: c });
    }
  } else if (view.archived.length) {
    rows.push({ type: 'archived', key: 'archived', count: view.archived.length, unread: view.archivedUnread });
  }
  return rows;
}

export function ChatList({ view, showArchived, query, filter }: ChatListProps) {
  const activeChat = useUI((s) => s.activeChat);
  const openChat = useUI((s) => s.openChat);
  const typing = useChats((s) => s.typing);
  const density = useSettings((s) => s.settings.appearance.density);
  const fontScale = useSettings((s) => s.settings.appearance.fontScale);
  const loaded = useChats((s) => s.loaded);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ jid: JID; anchor: PopoverAnchor } | null>(null);

  const rows = useMemo(() => buildRows(view, showArchived, query), [view, showArchived, query]);
  const itemH = Math.round((density === 'compact' ? 56 : 68) * Math.max(1, fontScale));

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].type === 'header' ? 28 : rows[i].type === 'archived' ? 52 : itemH),
    getItemKey: (i) => rows[i].key,
    overscan: 8,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [itemH, virtualizer]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [showArchived, filter]);

  // keep the active chat in view when it changes via keyboard shortcuts
  useEffect(() => {
    if (!activeChat) return;
    const i = rows.findIndex((r) => r.type === 'chat' && r.chat.jid === activeChat);
    if (i >= 0) virtualizer.scrollToIndex(i, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on selection change
  }, [activeChat]);

  const focusRow = useCallback(
    (i: number) => {
      virtualizer.scrollToIndex(i, { align: 'auto' });
      requestAnimationFrame(() =>
        scrollRef.current?.querySelector<HTMLElement>(`[data-row="${i}"]`)?.focus(),
      );
    },
    [virtualizer],
  );

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
    if (!el) return;
    const i = Number(el.dataset.row);
    const focusable = (j: number) => rows[j] && rows[j].type !== 'header';
    let j = i;
    if (e.key === 'ArrowDown') do j++; while (j < rows.length && !focusable(j));
    else if (e.key === 'ArrowUp') do j--; while (j >= 0 && !focusable(j));
    else if (e.key === 'Home') j = rows.findIndex((_, k) => focusable(k));
    else if (e.key === 'End') for (j = rows.length - 1; j > 0 && !focusable(j); j--);
    else return;
    e.preventDefault();
    if (j >= 0 && j < rows.length) focusRow(j);
    else if (e.key === 'ArrowUp') document.querySelector<HTMLInputElement>('.wz-chat-pane__tools input')?.focus();
  };

  const menuChat = menu ? useChats.getState().chats[menu.jid] : undefined;
  const menuItems: MenuEntry[] = menuChat
    ? [
        {
          id: 'pin',
          label: menuChat.pinned ? 'Unpin' : 'Pin',
          icon: menuChat.pinned ? <PinOff /> : <Pin />,
          onSelect: () => void useChats.getState().setPinned(menuChat.jid, !menuChat.pinned),
        },
        {
          id: 'archive',
          label: menuChat.archived ? 'Unarchive' : 'Archive',
          icon: menuChat.archived ? <ArchiveRestore /> : <Archive />,
          onSelect: () => void useChats.getState().setArchived(menuChat.jid, !menuChat.archived),
        },
        {
          id: 'mute',
          label: menuChat.muted ? 'Unmute' : 'Mute',
          icon: menuChat.muted ? <Bell /> : <BellOff />,
          onSelect: () => void useChats.getState().setMuted(menuChat.jid, !menuChat.muted),
        },
        { kind: 'separator', id: 's1' },
        {
          id: 'read',
          label: 'Mark as read',
          icon: <CheckCheck />,
          disabled: menuChat.unread === 0,
          onSelect: () => void useChats.getState().markRead(menuChat.jid),
        },
      ]
    : [];

  const closeMenu = useCallback(() => setMenu(null), []);

  if (loaded && rows.length === 0) {
    return (
      <div className="wz-chat-list wz-chat-list--empty">
        <p className="wz-empty-text">
          {query.trim()
            ? `No chats match “${query.trim()}”`
            : showArchived
              ? 'No archived chats'
              : filter === 'unread'
                ? 'You’re all caught up'
                : 'No chats here yet'}
        </p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="wz-chat-list" onKeyDown={onKeyDown}>
      <div role="list" aria-label={showArchived ? 'Archived chats' : 'Chats'} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index];
          const style = {
            position: 'absolute' as const,
            top: 0,
            left: 0,
            right: 0,
            height: vi.size,
            transform: `translateY(${vi.start}px)`,
          };
          if (row.type === 'header')
            return (
              <div key={vi.key} style={style} className="wz-chat-list__header" role="presentation">
                {row.label}
              </div>
            );
          if (row.type === 'archived')
            return (
              <div key={vi.key} style={style} role="listitem">
                <button
                  type="button"
                  data-row={vi.index}
                  className="wz-chat-list__archived"
                  onClick={() => useChats.getState().setShowArchived(true)}
                >
                  <span className="wz-chat-list__archived-icon">
                    <Archive size={18} strokeWidth={1.75} />
                  </span>
                  <span className="wz-chat-list__archived-label">Archived</span>
                  <span className="wz-chat-list__archived-count">
                    {row.unread > 0 ? `${row.unread} unread` : row.count}
                  </span>
                </button>
              </div>
            );
          return (
            <div key={vi.key} style={style} role="listitem">
              <ChatItem
                chat={row.chat}
                index={vi.index}
                avatarSize={density === 'compact' ? 38 : 46}
                active={row.chat.jid === activeChat}
                typing={typing[row.chat.jid]}
                onOpen={openChat}
                onMenu={(jid, anchor) => setMenu({ jid, anchor })}
              />
            </div>
          );
        })}
      </div>
      <Menu open={!!menu} anchor={menu?.anchor ?? null} onClose={closeMenu} items={menuItems} label="Chat actions" />
    </div>
  );
}
