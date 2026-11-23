import type { Backend } from '../api';
import { useAvatars } from './avatars';
import { useChats } from './chats';
import { useConnection } from './connection';
import { useMessages } from './messages';
import { useExports } from './exports';
import { useToasts } from './toasts';
import { useUI } from './ui';

export function bindBackendEvents(be: Backend): () => void {
  const offs = [
    be.on('auth:qr', (qr) => useConnection.getState().setQR(qr)),
    be.on('auth:state', (auth) => useConnection.getState().setAuth(auth)),
    be.on('auth:error', ({ message }) => useConnection.getState().setAuthError(message)),
    be.on('sync:progress', (p) => useConnection.getState().setSync(p)),
    be.on('toast', (t) => useToasts.getState().push(t)),
    be.on('conn:state', ({ state }) => useConnection.getState().setConn(state)),
    be.on('msg:batch', ({ messages }) => {
      useMessages.getState().receive(messages);
      // a message from someone ends their typing in that chat
      const chats = useChats.getState();
      for (const m of messages) {
        const name = chats.typing[m.chatJid]?.[m.senderJid];
        if (!m.fromMe && name !== undefined) chats.setTyping(m.chatJid, m.senderJid, name, false);
      }
      // reading the chat right now counts as read
      const active = useUI.getState().activeChat;
      if (active && messages.some((m) => m.chatJid === active && !m.fromMe) && !document.hidden) {
        void useChats.getState().markRead(active);
      }
    }),
    be.on('msg:status', ({ chatJid, pk, status }) =>
      useMessages.getState().setStatus(chatJid, pk, status),
    ),
    be.on('msg:edited', ({ chatJid, pk, text, editedAt, editCount }) =>
      useMessages.getState().applyEdit(chatJid, pk, text, editedAt, editCount),
    ),
    be.on('msg:deleted', ({ chatJid, pk, deleted, purged }) =>
      useMessages.getState().applyDelete(chatJid, pk, deleted, purged),
    ),
    be.on('msg:reaction', ({ chatJid, pk, reactions }) =>
      useMessages.getState().setReactions(chatJid, pk, reactions),
    ),
    be.on('chat:update', ({ chat }) => useChats.getState().upsert(chat)),
    be.on('chat:cleared', ({ jid }) => {
      useMessages.getState().reset(jid);
      // the open conversation reloads its (now empty) first page
      if (useUI.getState().activeChat === jid) void useMessages.getState().loadInitial(jid);
    }),
    be.on('export:progress', (p) => useExports.getState().update(p)),
    be.on('avatar:changed', ({ jid }) => useAvatars.getState().bump(jid)),
    be.on('chat:removed', ({ jid }) => {
      useChats.getState().remove(jid);
      if (useUI.getState().activeChat === jid) useUI.getState().openChat(null);
    }),
    be.on('presence', ({ jid, online, lastSeen }) =>
      useChats.getState().setPresence(jid, online, lastSeen),
    ),
    be.on('chat:typing', ({ chatJid, senderJid, senderName, typing }) =>
      useChats.getState().setTyping(chatJid, senderJid, senderName, typing),
    ),
  ];
  return () => offs.forEach((off) => off());
}
