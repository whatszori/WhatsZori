import { useEffect } from 'react';
import { Paperclip } from 'lucide-react';
import type { JID } from '../../api';
import { AttachPreview } from '../attach/AttachPreview';
import { usePasteAndDrop } from '../attach/usePasteAndDrop';
import { useChats } from '../../stores/chats';
import { ChatSearch } from '../search/ChatSearch';
import { ForwardDialog } from '../selection/ForwardDialog';
import { SelectionBar } from '../selection/SelectionBar';
import { useUI } from '../../stores/ui';
import { ChatInfoPanel } from '../chat-info/ChatInfoPanel';
import { Composer } from '../composer/Composer';
import { ConversationHeader } from './ConversationHeader';
import { MessageList } from './MessageList';
import './Bubble.css';
import './Conversation.css';

export function Conversation({ jid }: { jid: JID }) {
  const chat = useChats((s) => s.chats[jid]);
  const unread = chat?.unread ?? 0;
  const infoOpen = useUI((s) => s.chatInfoOpen);
  const searchOpen = useUI((s) => s.chatSearchOpen);
  const selecting = useUI((s) => s.selection?.jid === jid);
  const dragging = usePasteAndDrop(jid);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        useUI.getState().setChatSearchOpen(true);
        // already open: Ctrl+F again just refocuses the box
        document.querySelector<HTMLInputElement>('.wz-chat-search input')?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // always tell the backend on open, it also uses this as "the chat the user is looking at"
  useEffect(() => {
    void useChats.getState().markRead(jid);
  }, [jid]);

  useEffect(() => {
    if (unread > 0) void useChats.getState().markRead(jid);
  }, [jid, unread]);

  if (!chat) return null;
  return (
    <div className="wz-conversation-wrap">
      <section className="wz-conversation" aria-label={chat.name}>
        <ConversationHeader chat={chat} />
        {searchOpen && (
          <ChatSearch
            key={jid}
            jid={jid}
            onClose={() => useUI.getState().setChatSearchOpen(false)}
          />
        )}
        <MessageList chat={chat} />
        {selecting ? <SelectionBar chat={chat} /> : <Composer chat={chat} />}
        {dragging && (
          <div className="wz-drop-hint" aria-hidden="true">
            <Paperclip size={28} />
            <span>Drop to send to {chat.name}</span>
          </div>
        )}
      </section>
      {infoOpen && <ChatInfoPanel chat={chat} />}
      <ForwardDialog />
      <AttachPreview jid={jid} />
    </div>
  );
}
