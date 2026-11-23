import { memo, type MouseEvent } from 'react';
import { BellOff, Pin, Trash2 } from 'lucide-react';
import type { Chat, JID } from '../../api';
import { formatChatTime } from '../../lib/format';
import { Avatar, Badge, type PopoverAnchor } from '../../ui';
import { StatusTicks } from '../conversation/StatusTicks';

interface ChatItemProps {
  chat: Chat;
  index: number;
  avatarSize: number;
  active: boolean;
  typing: Record<JID, string> | undefined;
  onOpen: (jid: JID) => void;
  onMenu: (jid: JID, anchor: PopoverAnchor) => void;
}

function typingText(chat: Chat, typing: Record<JID, string> | undefined): string | null {
  const names = typing ? Object.values(typing) : [];
  if (names.length === 0) return null;
  if (!chat.isGroup) return 'typing…';
  const first = names[0].split(' ')[0];
  return names.length === 1
    ? `${first} is typing…`
    : `${first} and ${names.length - 1} more are typing…`;
}

export const ChatItem = memo(function ChatItem({
  chat,
  index,
  avatarSize,
  active,
  typing,
  onOpen,
  onMenu,
}: ChatItemProps) {
  const last = chat.lastMessage;
  const typingLine = typingText(chat, typing);

  const openMenu = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    // keyboard context-menu key reports 0,0
    const anchor =
      e.clientX === 0 && e.clientY === 0
        ? e.currentTarget.getBoundingClientRect()
        : { x: e.clientX, y: e.clientY };
    onMenu(chat.jid, anchor);
  };

  const prefix =
    last &&
    (last.fromMe
      ? chat.isGroup
        ? 'You'
        : null
      : chat.isGroup
        ? last.senderName.split(' ')[0]
        : null);

  return (
    <button
      type="button"
      data-row={index}
      className={[
        'wz-chat-item',
        active && 'wz-chat-item--active',
        chat.unread > 0 && 'wz-chat-item--unread',
        chat.muted && 'wz-chat-item--muted',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-current={active ? 'true' : undefined}
      onClick={() => onOpen(chat.jid)}
      onContextMenu={openMenu}
    >
      <Avatar
        name={chat.name}
        jid={chat.jid}
        size={avatarSize}
        group={chat.isGroup}
        online={chat.online}
      />
      <span className="wz-chat-item__body">
        <span className="wz-chat-item__top">
          <span className="wz-chat-item__name">{chat.name}</span>
          {chat.muted && (
            <BellOff
              className="wz-chat-item__muted"
              size={13}
              strokeWidth={1.75}
              aria-label="Muted"
            />
          )}
          {last && <span className="wz-chat-item__time">{formatChatTime(chat.lastActivity)}</span>}
        </span>
        <span className="wz-chat-item__bottom">
          {typingLine ? (
            <span className="wz-chat-item__preview wz-chat-item__preview--typing">
              {typingLine}
            </span>
          ) : (
            <span className="wz-chat-item__preview">
              {last?.fromMe && last.status && <StatusTicks status={last.status} />}
              {last?.deleted && (
                <Trash2
                  className="wz-chat-item__deleted"
                  size={13}
                  strokeWidth={1.75}
                  aria-label="Deleted"
                />
              )}
              {prefix && <span className="wz-chat-item__sender">{prefix}: </span>}
              {last?.text ?? ''}
            </span>
          )}
          {chat.unread > 0 ? (
            <Badge count={chat.unread} muted={chat.muted} />
          ) : (
            chat.pinned && (
              <Pin className="wz-chat-item__pin" size={13} strokeWidth={1.75} aria-label="Pinned" />
            )
          )}
        </span>
      </span>
    </button>
  );
});
