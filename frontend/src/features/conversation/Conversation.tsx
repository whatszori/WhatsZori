import { useEffect } from 'react';
import type { JID } from '../../api';
import { useChats } from '../../stores/chats';
import { Composer } from '../composer/Composer';
import { ConversationHeader } from './ConversationHeader';
import { MessageList } from './MessageList';
import './Bubble.css';
import './Conversation.css';

export function Conversation({ jid }: { jid: JID }) {
  const chat = useChats((s) => s.chats[jid]);
  const unread = chat?.unread ?? 0;

  useEffect(() => {
    if (unread > 0) void useChats.getState().markRead(jid);
  }, [jid, unread]);

  if (!chat) return null;
  return (
    <section className="wz-conversation" aria-label={chat.name}>
      <ConversationHeader chat={chat} />
      <MessageList chat={chat} />
      <Composer chat={chat} />
    </section>
  );
}
