import { useMemo, useRef, type PointerEvent as RPointerEvent, type KeyboardEvent } from 'react';
import { ChatListPane } from '../features/chat-list/ChatListPane';
import { Conversation } from '../features/conversation/Conversation';
import { NoChatSelected } from '../features/conversation/EmptyStates';
import { SettingsView } from '../features/settings/SettingsView';
import { DevPanel } from '../features/dev/DevPanel';
import { isDemo } from '../api';
import { useHotkeys } from '../lib/hotkeys';
import { buildChatList, navigationOrder } from '../stores/chat-selectors';
import { useChats } from '../stores/chats';
import { SIDEBAR_MAX, SIDEBAR_MIN, useUI } from '../stores/ui';
import { ConnectionBanner } from './ConnectionBanner';
import './MainLayout.css';

function Resizer() {
  const width = useUI((s) => s.sidebarWidth);
  const setWidth = useUI((s) => s.setSidebarWidth);
  const start = useRef<{ x: number; w: number } | null>(null);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: width };
    document.body.classList.add('wz-resizing');
  };
  const onPointerMove = (e: RPointerEvent) => {
    if (!start.current) return;
    setWidth(start.current.w + e.clientX - start.current.x);
  };
  const onPointerUp = () => {
    start.current = null;
    document.body.classList.remove('wz-resizing');
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setWidth(width - 16);
    else if (e.key === 'ArrowRight') setWidth(width + 16);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className="wz-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setWidth(340)}
      onKeyDown={onKeyDown}
    />
  );
}

function useGlobalShortcuts() {
  const chats = useChats((s) => s.chats);
  const filter = useChats((s) => s.filter);
  const query = useChats((s) => s.query);
  const showArchived = useChats((s) => s.showArchived);
  const order = useMemo(
    () => navigationOrder(buildChatList(Object.values(chats), filter, query), showArchived),
    [chats, filter, query, showArchived],
  );

  const step = (dir: 1 | -1) => {
    if (order.length === 0) return;
    const { activeChat, openChat } = useUI.getState();
    const i = order.findIndex((c) => c.jid === activeChat);
    const next =
      i < 0 ? (dir === 1 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, i + dir));
    openChat(order[next].jid);
  };

  useHotkeys({
    'ctrl+k': () => useUI.getState().focusSearch(),
    'ctrl+comma': () => {
      const ui = useUI.getState();
      if (ui.view === 'settings') ui.closeSettings();
      else ui.openSettings();
    },
    'alt+arrowup': () => step(-1),
    'alt+arrowdown': () => step(1),
  });
}

export function MainLayout() {
  const width = useUI((s) => s.sidebarWidth);
  const view = useUI((s) => s.view);
  const activeChat = useUI((s) => s.activeChat);
  useGlobalShortcuts();

  return (
    <div className="wz-app" style={{ ['--wz-sidebar-width' as string]: `${width}px` }}>
      <ConnectionBanner />
      <div className="wz-app__body">
        <aside className="wz-sidebar" aria-label="Chats">
          <ChatListPane />
        </aside>
        <Resizer />
        <main className="wz-main">
          {view === 'settings' ? (
            <SettingsView />
          ) : activeChat ? (
            <Conversation key={activeChat} jid={activeChat} />
          ) : (
            <NoChatSelected />
          )}
        </main>
      </div>
      {isDemo && <DevPanel />}
    </div>
  );
}
