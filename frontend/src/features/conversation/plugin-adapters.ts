import type { Chat, Message } from '../../api';
import type { PluginChat, PluginMessage } from '../../plugin-core/types';

// Plugins get a narrow, stable shape instead of our internal DTOs.
export function toPluginMessage(m: Message): PluginMessage {
  const media = m.media;
  return {
    pk: m.pk,
    chatJid: m.chatJid,
    senderJid: m.senderJid,
    senderName: m.senderName,
    fromMe: m.fromMe,
    timestamp: m.timestamp,
    kind: m.kind,
    text: m.text,
    editedAt: m.editedAt,
    deleted: m.deleted && { byName: m.deleted.byName, at: m.deleted.at },
    replyTo: m.replyTo && {
      pk: m.replyTo.pk,
      senderName: m.replyTo.senderName,
      text: m.replyTo.text,
    },
    forwarded: m.forwarded ? true : undefined,
    media: media && {
      mime: media.mime,
      fileName: media.fileName,
      size: media.size,
      width: media.width,
      height: media.height,
      duration: media.duration,
      caption: media.caption,
    },
  };
}

export function toPluginChat(c: Chat): PluginChat {
  return {
    jid: c.jid,
    name: c.name,
    isGroup: c.isGroup,
    muted: c.muted,
    pinned: c.pinned,
    archived: c.archived,
    unread: c.unread,
  };
}
