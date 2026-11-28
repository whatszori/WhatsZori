import { useCallback, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  CheckCheck,
  Ghost,
  Info,
  MoreVertical,
  Pin,
  PinOff,
  Search,
  Timer,
} from 'lucide-react';
import type { Chat } from '../../api';
import { timerLabel } from '../chat-info/Disappearing';
import { formatLastSeen, pluralize } from '../../lib/format';
import { PluginSlot } from '../../plugin-core/slots';
import { PanelButtons } from '../../plugin-core/host';
import { useChats } from '../../stores/chats';
import { useSettings } from '../../stores/settings';
import { useUI } from '../../stores/ui';
import { Avatar, IconButton, Menu, type MenuEntry, type PopoverAnchor } from '../../ui';
import { toPluginChat } from './plugin-adapters';

function statusLine(chat: Chat, typing: string[]): { text: string; accent: boolean } {
  if (typing.length) {
    if (!chat.isGroup) return { text: 'typing…', accent: true };
    const first = typing[0].split(' ')[0];
    return {
      text:
        typing.length === 1
          ? `${first} is typing…`
          : `${first} and ${typing.length - 1} more are typing…`,
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
  const infoOpen = useUI((s) => s.chatInfoOpen);
  const searchOpen = useUI((s) => s.chatSearchOpen);
  const ghostChats = useSettings((s) => s.ghost.ghostChats);
  const ghosted = ghostChats.includes(chat.jid);
  const [menu, setMenu] = useState<PopoverAnchor | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const chats = useChats.getState();

  const items: MenuEntry[] = [
    {
      id: 'info',
      label: chat.isGroup ? 'Group info' : 'Contact info',
      icon: <Info />,
      onSelect: () => useUI.getState().setChatInfoOpen(true),
    },
    { kind: 'separator', id: 's-info' },
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
    { kind: 'separator', id: 's-ghost' },
    {
      id: 'ghost',
      label: ghosted ? 'Turn off ghost mode here' : 'Ghost mode in this chat',
      icon: <Ghost />,
      onSelect: () =>
        useSettings.getState().setGhost({
          ghostChats: ghosted
            ? ghostChats.filter((j) => j !== chat.jid)
            : [...ghostChats, chat.jid],
        }),
    },
  ];

  return (
    <header className="wz-conv-header">
      <button
        type="button"
        className="wz-conv-header__identity"
        aria-label={`${chat.name}, ${chat.isGroup ? 'group' : 'contact'} info`}
        aria-expanded={infoOpen}
        onClick={() => useUI.getState().setChatInfoOpen(!infoOpen)}
      >
        <Avatar name={chat.name} jid={chat.jid} size={36} group={chat.isGroup} />
        <span className="wz-conv-header__text">
          <span className="wz-conv-header__name">
            {chat.name}
            {!!chat.disappearing && (
              <span
                className="wz-conv-header__ghost"
                title={`Disappearing messages: ${timerLabel(chat.disappearing)}. WhatsZori keeps them.`}
              >
                <Timer size={14} aria-label="Disappearing messages on" />
              </span>
            )}
            {ghosted && (
              <span className="wz-conv-header__ghost" title="Ghost mode in this chat">
                <Ghost size={14} aria-label="Ghost mode" />
              </span>
            )}
          </span>
          <span
            className={`wz-conv-header__status${status.accent ? ' wz-conv-header__status--accent' : ''}`}
            aria-live="polite"
          >
            {status.text}
          </span>
        </span>
      </button>
      <div className="wz-conv-header__actions">
        <PluginSlot name="chat.header.actions" props={{ chat: toPluginChat(chat) }} />
        <PanelButtons chat={chat} />
        <IconButton
          label="Search in chat"
          hint="Ctrl F"
          icon={<Search size={18} />}
          active={searchOpen}
          onClick={() => useUI.getState().setChatSearchOpen(!searchOpen)}
        />
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
      <Menu
        open={!!menu}
        anchor={menu}
        onClose={close}
        items={items}
        label="Chat actions"
        placement="bottom-end"
      />
    </header>
  );
}
