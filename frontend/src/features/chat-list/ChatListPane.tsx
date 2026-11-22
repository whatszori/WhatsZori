import { useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Search, Settings, X } from 'lucide-react';
import { PluginSlot } from '../../plugin-core/slots';
import { buildChatList, type ChatFilter } from '../../stores/chat-selectors';
import { useChats } from '../../stores/chats';
import { useUI } from '../../stores/ui';
import { IconButton, Input, Segmented } from '../../ui';
import { ChatList } from './ChatList';
import './ChatListPane.css';

const FILTERS: { value: ChatFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'groups', label: 'Groups' },
];

export function ChatListPane() {
  const chats = useChats((s) => s.chats);
  const filter = useChats((s) => s.filter);
  const query = useChats((s) => s.query);
  const showArchived = useChats((s) => s.showArchived);
  const { setFilter, setQuery, setShowArchived } = useChats.getState();
  const nonce = useUI((s) => s.searchFocusNonce);
  const view = useUI((s) => s.view);
  const searchRef = useRef<HTMLInputElement>(null);

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
        ) : (
          <span className="wz-wordmark">WhatsZori</span>
        )}
        <div className="wz-chat-pane__actions">
          <PluginSlot name="sidebar.header" />
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
        </div>
      </header>

      <div className="wz-chat-pane__tools">
        <Input
          ref={searchRef}
          type="search"
          aria-label="Search chats"
          placeholder="Search"
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
            ) : (
              <kbd className="wz-chat-pane__kbd">Ctrl K</kbd>
            )
          }
        />
        {!showArchived && (
          <Segmented label="Filter chats" value={filter} options={FILTERS} onChange={setFilter} size="sm" />
        )}
      </div>

      <ChatList view={list} showArchived={showArchived} query={query} filter={filter} />

      <PluginSlot name="sidebar.footer" className="wz-chat-pane__footer" />
    </div>
  );
}
