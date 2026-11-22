import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  CheckCheck,
  LogOut,
  MoreVertical,
  Plus,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { backend } from '../../api';
import { PluginSlot } from '../../plugin-core/slots';
import { buildChatList, type ChatFilter } from '../../stores/chat-selectors';
import { useChats } from '../../stores/chats';
import { useUI } from '../../stores/ui';
import {
  IconButton,
  Input,
  Logo,
  Menu,
  Segmented,
  type MenuEntry,
  type PopoverAnchor,
} from '../../ui';
import { ChatList } from './ChatList';
import './ChatListPane.css';

const FILTERS: { value: ChatFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'groups', label: 'Groups' },
];

function markAllRead(): void {
  const { chats, markRead } = useChats.getState();
  for (const c of Object.values(chats)) if (c.unread > 0) void markRead(c.jid);
}

export function ChatListPane({ rail = false }: { rail?: boolean }) {
  const chats = useChats((s) => s.chats);
  const filter = useChats((s) => s.filter);
  const query = useChats((s) => s.query);
  const showArchived = useChats((s) => s.showArchived);
  const { setFilter, setQuery, setShowArchived } = useChats.getState();
  const nonce = useUI((s) => s.searchFocusNonce);
  const view = useUI((s) => s.view);
  const searchRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<PopoverAnchor | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const menuItems: MenuEntry[] = [
    {
      id: 'archived',
      label: 'Archived chats',
      icon: <Archive />,
      onSelect: () => setShowArchived(true),
    },
    { id: 'read', label: 'Mark all as read', icon: <CheckCheck />, onSelect: markAllRead },
    {
      id: 'settings',
      label: 'Settings',
      icon: <Settings />,
      shortcut: 'Ctrl ,',
      onSelect: () => useUI.getState().openSettings(),
    },
    { kind: 'separator', id: 's1' },
    {
      id: 'logout',
      label: 'Log out',
      icon: <LogOut />,
      onSelect: () => void backend.auth.logout(),
    },
  ];

  const list = useMemo(
    () => buildChatList(Object.values(chats), filter, query),
    [chats, filter, query],
  );

  useEffect(() => {
    if (nonce === 0) return;
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [nonce]);

  return (
    <div className="wz-chat-pane">
      <header className="wz-chat-pane__header">
        {showArchived ? (
          <>
            <IconButton
              label="Back to chats"
              icon={<ArrowLeft size={18} />}
              onClick={() => setShowArchived(false)}
            />
            <h1 className="wz-chat-pane__title">Archived</h1>
          </>
        ) : rail ? (
          <h1 className="wz-chat-pane__title wz-chat-pane__title--large">Chats</h1>
        ) : (
          <Logo className="wz-wordmark" height={22} />
        )}
        <div className="wz-chat-pane__actions">
          <PluginSlot name="sidebar.header" />
          {rail ? (
            <>
              <IconButton
                label="Menu"
                icon={<MoreVertical size={18} />}
                aria-haspopup="menu"
                aria-expanded={!!menu}
                onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
              />
              {/* no contact picker yet, so new chat = search, like the official placeholder says */}
              <IconButton
                label="New chat"
                className="wz-chat-pane__new"
                icon={<Plus size={20} />}
                onClick={() => useUI.getState().focusSearch()}
              />
            </>
          ) : (
            <IconButton
              label="Settings"
              hint="Ctrl ,"
              icon={<Settings size={18} />}
              active={view === 'settings'}
              onClick={() => {
                const ui = useUI.getState();
                if (ui.view === 'settings') ui.closeSettings();
                else ui.openSettings();
              }}
            />
          )}
        </div>
        <Menu
          open={!!menu}
          anchor={menu}
          onClose={closeMenu}
          items={menuItems}
          label="Chat list menu"
          placement="bottom-end"
        />
      </header>

      <div className="wz-chat-pane__tools">
        <Input
          ref={searchRef}
          type="search"
          aria-label="Search chats"
          placeholder={rail ? 'Search or start a new chat' : 'Search'}
          icon={<Search size={16} strokeWidth={1.75} />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery('');
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              document.querySelector<HTMLElement>('.wz-chat-item')?.focus();
            }
          }}
          trailing={
            query ? (
              <IconButton
                label="Clear search"
                size="sm"
                icon={<X size={14} />}
                tooltip={false}
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
              />
            ) : rail ? undefined : (
              <kbd className="wz-chat-pane__kbd">Ctrl K</kbd>
            )
          }
        />
        {!showArchived && (
          <Segmented
            label="Filter chats"
            value={filter}
            options={FILTERS}
            onChange={setFilter}
            size="sm"
          />
        )}
      </div>

      <ChatList view={list} showArchived={showArchived} query={query} filter={filter} />

      <PluginSlot name="sidebar.footer" className="wz-chat-pane__footer" />
    </div>
  );
}
