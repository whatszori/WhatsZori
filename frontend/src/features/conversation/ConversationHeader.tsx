import { useCallback, useState } from 'react';
import { Archive, ArchiveRestore, Bell, BellOff, CheckCheck, MoreVertical, Pin, PinOff } from 'lucide-react';
import type { Chat } from '../../api';
import { formatLastSeen, pluralize } from '../../lib/format';
import { PluginSlot } from '../../plugin-core/slots';
import { useChats } from '../../stores/chats';
import { Avatar, IconButton, Menu, type MenuEntry, type PopoverAnchor } from '../../ui';
import { toPluginChat } from './plugin-adapters';

function statusLine(chat: Chat, typing: string[]): { text: string; accent: boolean } {
  if (typing.length) {
    if (!chat.isGroup) return { text: 'typing…', accent: true };
    const first = typing[0].split(' ')[0];
    return {
      text: typing.length === 1 ? `${first} is typing…` : `${first} and ${typing.length - 1} more are typing…`,
      accent: true,
    };
  }
  if (chat.isGroup) return { text: pluralize(chat.memberCount ?? 0, 'member'), accent: false };
  if (chat.online) return { text: 'online', accent: false };
  return { text: formatLastSeen(chat.lastSeen ?? null), accent: false };
}

export function ConversationHeader({ chat }: { chat: Chat }) {
  const typingMap = useChats((s) => s.typing[chat.jid]);
  const typing = typingMap ? Object.values(typingMap) : [];
  const status = statusLine(chat, typing);
  const [menu, setMenu] = useState<PopoverAnchor | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const chats = useChats.getState();

  const items: MenuEntry[] = [
    {
      id: 'pin',
      label: chat.pinned ? 'Unpin chat' : 'Pin chat',
      icon: chat.pinned ? <PinOff /> : <Pin />,
      onSelect: () => void chats.setPinned(chat.jid, !chat.pinned),
    },
    {
      id: 'archive',
      label: chat.archived ? 'Unarchive' : 'Archive',
      icon: chat.archived ? <ArchiveRestore /> : <Archive />,
      onSelect: () => void chats.setArchived(chat.jid, !chat.archived),
    },
    {
      id: 'read',
      label: 'Mark as read',
      icon: <CheckCheck />,
      disabled: chat.unread === 0,
      onSelect: () => void chats.markRead(chat.jid),
    },
  ];

  return (
    <header className="wz-conv-header">
      <Avatar name={chat.name} size={36} group={chat.isGroup} />
      <div className="wz-conv-header__text">
        <h2 className="wz-conv-header__name">{chat.name}</h2>
        <p
          className={`wz-conv-header__status${status.accent ? ' wz-conv-header__status--accent' : ''}`}
          aria-live="polite"
        >
          {status.text}
        </p>
      </div>
      <div className="wz-conv-header__actions">
        <PluginSlot name="chat.header.actions" props={{ chat: toPluginChat(chat) }} />
        <IconButton
          label={chat.muted ? 'Unmute' : 'Mute'}
          icon={chat.muted ? <BellOff size={18} /> : <Bell size={18} />}
          onClick={() => void chats.setMuted(chat.jid, !chat.muted)}
        />
        <IconButton
          label="More"
          icon={<MoreVertical size={18} />}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
        />
      </div>
      <Menu open={!!menu} anchor={menu} onClose={close} items={items} label="Chat actions" placement="bottom-end" />
    </header>
  );
}
