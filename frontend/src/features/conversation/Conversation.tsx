import { useEffect } from 'react';
import type { JID } from '../../api';
import { useChats } from '../../stores/chats';
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
        <MessageList chat={chat} />
        <Composer chat={chat} />
      </section>
      {infoOpen && <ChatInfoPanel chat={chat} />}
    </div>
  );
}
