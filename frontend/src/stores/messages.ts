import { create } from 'zustand';
import {
  backend,
  type DeletedInfo,
  type JID,
  type Message,
  type MessagePK,
  type MessageStatus,
  type Reaction,
} from '../api';
import { toastError } from './toasts';

export const PAGE_SIZE = 50;

export interface ChatMessages {
  items: Message[];
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
}

interface MessagesState {
  byChat: Record<JID, ChatMessages>;
  loadInitial(jid: JID): Promise<void>;
  loadOlder(jid: JID): Promise<void>;
  // load pages until pk is in memory; for jumping to a quoted message
  ensureLoaded(jid: JID, pk: MessagePK): Promise<boolean>;
  receive(messages: Message[]): void;
  // forget a chat's loaded messages (it was cleared)
  reset(jid: JID): void;
  setStatus(jid: JID, pk: MessagePK, status: MessageStatus): void;
  applyEdit(jid: JID, pk: MessagePK, text: string, editedAt: number, editCount: number): void;
  applyDelete(jid: JID, pk: MessagePK, deleted: DeletedInfo, purged: boolean): void;
  setReactions(jid: JID, pk: MessagePK, reactions: Reaction[]): void;
  // resolve to false when the backend refused (offline, rate limit); the error is already a toast
  send(jid: JID, text: string, replyToPk?: MessagePK): Promise<boolean>;
  attach(jid: JID): Promise<void>;
  sendVoice(jid: JID, recording: Blob, waveform: number[]): Promise<void>;
  edit(jid: JID, pk: MessagePK, text: string): Promise<void>;
  revoke(jid: JID, pk: MessagePK): Promise<void>;
  deleteLocal(jid: JID, pks: MessagePK[]): Promise<void>;
  // drop messages that were deleted on this computer
  remove(jid: JID, pks: MessagePK[]): void;
  react(jid: JID, pk: MessagePK, emoji: string): Promise<void>;
}

const EMPTY: ChatMessages = { items: [], hasMore: true, loading: false, loaded: false };

export const useMessages = create<MessagesState>((set, get) => {
  const updateChat = (jid: JID, fn: (c: ChatMessages) => ChatMessages) =>
    set((s) => ({ byChat: { ...s.byChat, [jid]: fn(s.byChat[jid] ?? EMPTY) } }));

  const updateMessage = (jid: JID, pk: MessagePK, fn: (m: Message) => Message) =>
    updateChat(jid, (c) => {
      const i = c.items.findIndex((m) => m.pk === pk);
      if (i < 0) return c;
      const items = c.items.slice();
      items[i] = fn(items[i]);
      return { ...c, items };
    });

  return {
    byChat: {},

    async loadInitial(jid) {
      const cur = get().byChat[jid];
      if (cur?.loaded || cur?.loading) return;
      updateChat(jid, (c) => ({ ...c, loading: true }));
      const page = await backend.messages.getMessages(jid, null, PAGE_SIZE);
      updateChat(jid, (c) => ({
        // anything that arrived via events while we were loading stays
        items: mergeByPk(page.messages, c.items),
        hasMore: page.hasMore,
        loading: false,
        loaded: true,
      }));
    },

    async loadOlder(jid) {
      const cur = get().byChat[jid];
      if (!cur || cur.loading || !cur.hasMore || cur.items.length === 0) return;
      updateChat(jid, (c) => ({ ...c, loading: true }));
      const page = await backend.messages.getMessages(jid, cur.items[0].pk, PAGE_SIZE);
      updateChat(jid, (c) => ({
        ...c,
        items: mergeByPk(page.messages, c.items),
        hasMore: page.hasMore,
        loading: false,
      }));
    },

    async ensureLoaded(jid, pk) {
      for (let i = 0; i < 40; i++) {
        const c = get().byChat[jid];
        if (c?.items.some((m) => m.pk === pk)) return true;
        if (!c || !c.hasMore) return false;
        await get().loadOlder(jid);
      }
      return false;
    },

    reset: (jid) =>
      set((s) => {
        const byChat = { ...s.byChat };
        delete byChat[jid];
        return { byChat };
      }),

    receive(messages) {
      const byJid = new Map<JID, Message[]>();
      for (const m of messages) byJid.set(m.chatJid, [...(byJid.get(m.chatJid) ?? []), m]);
      for (const [jid, list] of byJid) {
        if (!get().byChat[jid]?.loaded) continue;
        updateChat(jid, (c) => ({ ...c, items: mergeByPk(c.items, list) }));
      }
    },

    setStatus: (jid, pk, status) => updateMessage(jid, pk, (m) => ({ ...m, status })),

    applyEdit: (jid, pk, text, editedAt, editCount) =>
      updateMessage(jid, pk, (m) => ({ ...m, text, editedAt, editCount })),

    applyDelete: (jid, pk, deleted, purged) =>
      updateMessage(jid, pk, (m) =>
        purged
          ? { ...m, deleted, text: '', media: undefined, contentUnknown: true }
          : { ...m, deleted },
      ),

    setReactions: (jid, pk, reactions) => updateMessage(jid, pk, (m) => ({ ...m, reactions })),

    async send(jid, text, replyToPk) {
      try {
        const m = await backend.messages.sendText(jid, text, replyToPk);
        updateChat(jid, (c) => ({ ...c, items: mergeByPk(c.items, [m]) }));
        return true;
      } catch (err) {
        toastError(err, 'Not sent');
        return false;
      }
    },

    async sendVoice(jid, recording, waveform) {
      try {
        const m = await backend.messages.sendVoice(jid, recording, waveform);
        updateChat(jid, (c) => ({ ...c, items: mergeByPk(c.items, [m]) }));
      } catch (err) {
        toastError(err, 'Voice message not sent');
      }
    },

    async attach(jid) {
      try {
        const m = await backend.messages.attachFile(jid);
        if (m) updateChat(jid, (c) => ({ ...c, items: mergeByPk(c.items, [m]) }));
      } catch (err) {
        toastError(err, 'Not sent');
      }
    },

    async edit(jid, pk, text) {
      const prev = get().byChat[jid]?.items.find((m) => m.pk === pk);
      if (!prev || prev.text === text) return;
      await backend.messages.edit(pk, text).catch((err) => toastError(err, 'Not edited'));
    },

    async deleteLocal(jid, pks) {
      try {
        await backend.messages.deleteLocal(jid, pks);
        get().remove(jid, pks);
      } catch (err) {
        toastError(err, 'Not deleted');
      }
    },

    remove(jid, pks) {
      const gone = new Set(pks);
      updateChat(jid, (c) => ({ ...c, items: c.items.filter((m) => !gone.has(m.pk)) }));
    },

    async revoke(_jid, pk) {
      await backend.messages.revoke(pk).catch((err) => toastError(err, 'Not deleted'));
    },

    async react(jid, pk, emoji) {
      try {
        const reactions = await backend.messages.react(pk, emoji);
        get().setReactions(jid, pk, reactions);
      } catch (err) {
        toastError(err, 'Reaction not sent');
      }
    },
  };
});

// pks are numeric strings from our local store, so they sort chronologically;
// timestamp first in case clocks and pks ever disagree
export function mergeByPk(a: Message[], b: Message[]): Message[] {
  if (b.length === 0) return a;
  const map = new Map<MessagePK, Message>();
  for (const m of a) map.set(m.pk, m);
  for (const m of b) map.set(m.pk, { ...map.get(m.pk), ...m });
  return [...map.values()].sort((x, y) => x.timestamp - y.timestamp || Number(x.pk) - Number(y.pk));
}

// what WhatsApp lets you forward: not deleted, and not something we only have a placeholder for
export function canForward(m: Message): boolean {
  return !m.deleted && !m.contentUnknown && !m.viewOnce && m.kind !== 'poll';
}

export function canEdit(m: Message, now = Date.now()): boolean {
  // WA only allows edits for 15 minutes
  return m.fromMe && !m.deleted && m.kind === 'text' && now - m.timestamp < 15 * 60_000;
}
