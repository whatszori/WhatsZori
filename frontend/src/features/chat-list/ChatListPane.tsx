import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  CheckCheck,
  CircleDashed,
  History,
  LogOut,
  MoreVertical,
  Plus,
  Search,
  Settings,
  SquarePen,
  X,
  PanelLeftOpen,
} from 'lucide-react';
import { backend } from '../../api';
import { PluginSlot } from '../../plugin-core/slots';
import { ViewButtons } from '../../plugin-core/host';
import { ActivityIndicator } from '../../plugin-core/ActivityIndicator';
import { buildChatList, type ChatFilter } from '../../stores/chat-selectors';
import { SectionTabs, useSectionTabs } from './SectionTabs';
import { useChats } from '../../stores/chats';
import { useUI } from '../../stores/ui';
import { IconButton, Input, Logo, Menu, type MenuEntry, type PopoverAnchor } from '../../ui';
import { NewChatDialog } from '../new-chat/NewChatDialog';
import { MessageHits } from '../search/MessageHits';
import { ChatList } from './ChatList';
import { FilterChips } from './FilterChips';
import './ChatListPane.css';

function markAllRead(): void {
  const { chats, markRead } = useChats.getState();
  for (const c of Object.values(chats)) if (c.unread > 0) void markRead(c.jid);
}

export function ChatListPane({ rail = false }: { rail?: boolean }) {
  const chats = useChats((s) => s.chats);
  const chipFilter = useChats((s) => s.filter);
  const tabs = useSectionTabs();
  const picked = useChats((s) => s.section);
  // a tab that went away (hidden, or nothing in it anymore) falls back to chats
  const section = tabs.includes(picked) ? picked : 'chats';
  const filter: ChatFilter = section === 'chats' ? chipFilter : section;
  const query = useChats((s) => s.query);
  const showArchived = useChats((s) => s.showArchived);
  const { setQuery, setShowArchived } = useChats.getState();
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
      id: 'changes',
      label: 'Deleted & edited',
      icon: <History />,
      onSelect: () => useUI.getState().openChanges(),
    },
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

  const searching = !showArchived && query.trim().length >= 2;

  useEffect(() => {
    if (nonce === 0) return;
    // a frame later: coming back from another view mounts the chat too, and its message box
    // takes the focus in the same commit
    const id = requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [nonce]);

  return (
    <div className={`wz-chat-pane${searching ? ' wz-chat-pane--searching' : ''}`}>
      <header className="wz-chat-pane__header">
        <IconButton
          label="Show the full chat list"
          className="wz-chat-pane__expand"
          icon={<PanelLeftOpen size={20} />}
          onClick={() => useUI.getState().setSidebarCompact(false)}
        />
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
          <h1 className="wz-chat-pane__title wz-chat-pane__title--large">
            {section === 'channels'
              ? 'Channels'
              : section === 'communities'
                ? 'Communities'
                : 'Chats'}
          </h1>
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
              <IconButton
                label="New chat"
                hint="Ctrl N"
                className="wz-chat-pane__new"
                icon={<Plus size={20} />}
                onClick={() => useUI.getState().setNewChatOpen(true)}
              />
            </>
          ) : (
            <>
              <IconButton
                label="Status"
                icon={<CircleDashed size={18} />}
                active={view === 'status'}
                onClick={() => {
                  const ui = useUI.getState();
                  if (ui.view === 'status') ui.closeStatus();
                  else ui.openStatus();
                }}
              />
              <ActivityIndicator />
              <ViewButtons />
              <IconButton
                label="Deleted & edited"
                icon={<History size={18} />}
                active={view === 'changes'}
                onClick={() => {
                  const ui = useUI.getState();
                  if (ui.view === 'changes') ui.closeChanges();
                  else ui.openChanges();
                }}
              />
              <IconButton
                label="New chat"
                hint="Ctrl N"
                icon={<SquarePen size={18} />}
                onClick={() => useUI.getState().setNewChatOpen(true)}
              />
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
            </>
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

      {!showArchived && <SectionTabs tabs={tabs} />}
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
        {!showArchived && section === 'chats' && <FilterChips />}
      </div>

      <ChatList view={list} showArchived={showArchived} query={query} filter={filter} />
      {searching && <MessageHits query={query} />}

      <NewChatDialog />
      <PluginSlot name="sidebar.footer" className="wz-chat-pane__footer" />
    </div>
  );
}
