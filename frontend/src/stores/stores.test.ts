import { beforeEach, describe, expect, it } from 'vitest';
import type { Chat, Message } from '../api/types';
import { buildChatList, navigationOrder } from './chat-selectors';
import { canEdit, mergeByPk, useMessages } from './messages';
import { composerFor, useUI } from './ui';
import { useChats } from './chats';

const chat = (p: Partial<Chat> & { jid: string }): Chat => ({
  name: p.jid,
  isGroup: false,
  pinned: false,
  archived: false,
  muted: false,
  unread: 0,
  lastMessage: null,
  lastActivity: 0,
  ...p,
});

const msg = (pk: string, ts: number, p: Partial<Message> = {}): Message => ({
  pk,
  id: pk,
  chatJid: 'a',
  senderJid: 'a',
  senderName: 'A',
  fromMe: false,
  timestamp: ts,
  kind: 'text',
  text: `m${pk}`,
  reactions: [],
  ...p,
});

describe('buildChatList', () => {
  const chats = [
    chat({ jid: 'a', name: 'Anna', pinned: true, lastActivity: 1 }),
    chat({ jid: 'b', name: 'Bob', lastActivity: 5, unread: 2 }),
    chat({ jid: 'c', name: 'Crew', isGroup: true, lastActivity: 3 }),
    chat({ jid: 'd', name: 'Dmitry', archived: true, unread: 1, lastActivity: 9 }),
    chat({ jid: 'e', name: 'Eve', archived: true, muted: true, unread: 4, lastActivity: 8 }),
  ];

  it('splits pinned, others and archived, newest first', () => {
    const v = buildChatList(chats, 'all', '');
    expect(v.pinned.map((c) => c.jid)).toEqual(['a']);
    expect(v.others.map((c) => c.jid)).toEqual(['b', 'c']);
    expect(v.archived.map((c) => c.jid)).toEqual(['d', 'e']);
    // muted archived chats don't count toward the archive badge
    expect(v.archivedUnread).toBe(1);
  });

  it('filters unread and groups', () => {
    expect(buildChatList(chats, 'unread', '').others.map((c) => c.jid)).toEqual(['b']);
    expect(buildChatList(chats, 'groups', '').others.map((c) => c.jid)).toEqual(['c']);
  });

  it('flattens pins into results when searching', () => {
    const v = buildChatList(chats, 'all', 'an');
    expect(v.pinned).toEqual([]);
    expect(v.others.map((c) => c.jid)).toEqual(['a']);
  });

  it('gives a keyboard order', () => {
    const v = buildChatList(chats, 'all', '');
    expect(navigationOrder(v, false).map((c) => c.jid)).toEqual(['a', 'b', 'c']);
    expect(navigationOrder(v, true).map((c) => c.jid)).toEqual(['d', 'e']);
  });
});

describe('messages store', () => {
  beforeEach(() => useMessages.setState({ byChat: {} }));

  it('merges by pk and keeps chronological order', () => {
    const merged = mergeByPk([msg('1', 10), msg('3', 30)], [msg('2', 20), msg('3', 30, { text: 'x' })]);
    expect(merged.map((m) => m.pk)).toEqual(['1', '2', '3']);
    expect(merged[2].text).toBe('x');
  });

  it('loads the newest page, then older pages', async () => {
    await useChats.getState().load();
    const anna = Object.values(useChats.getState().chats).find((c) => c.name === 'Anna Petrova')!;
    await useMessages.getState().loadInitial(anna.jid);
    const first = useMessages.getState().byChat[anna.jid];
    expect(first.items.length).toBe(50);
    expect(first.hasMore).toBe(true);
    await useMessages.getState().loadOlder(anna.jid);
    const second = useMessages.getState().byChat[anna.jid];
    expect(second.items.length).toBe(100);
    expect(second.items[50].pk).toBe(first.items[0].pk);
  });

  it('keeps content on delete unless purged', () => {
    useMessages.setState({
      byChat: { a: { items: [msg('1', 1), msg('2', 2)], hasMore: false, loading: false, loaded: true } },
    });
    const d = { byJid: 'a', byName: 'A', at: 5 };
    useMessages.getState().applyDelete('a', '1', d, false);
    useMessages.getState().applyDelete('a', '2', d, true);
    const [m1, m2] = useMessages.getState().byChat.a.items;
    expect(m1.text).toBe('m1');
    expect(m1.deleted).toEqual(d);
    expect(m2.text).toBe('');
    expect(m2.contentUnknown).toBe(true);
  });

  it('only lets you edit recent own text messages', () => {
    const now = 100 * 60_000;
    expect(canEdit(msg('1', now - 60_000, { fromMe: true }), now)).toBe(true);
    expect(canEdit(msg('1', now - 20 * 60_000, { fromMe: true }), now)).toBe(false);
    expect(canEdit(msg('1', now, { fromMe: false }), now)).toBe(false);
    expect(canEdit(msg('1', now, { fromMe: true, deleted: { byJid: '', byName: '', at: 0 } }), now)).toBe(false);
  });
});

describe('composer state', () => {
  beforeEach(() => useUI.setState({ composer: {} }));

  it('stashes the draft while editing and restores it on cancel', () => {
    const ui = useUI.getState();
    ui.setDraft('a', 'half-written');
    ui.startEdit('a', '9', 'old text');
    expect(composerFor(useUI.getState(), 'a')).toMatchObject({ draft: 'old text', editing: '9' });
    useUI.getState().cancelComposerMode('a');
    expect(composerFor(useUI.getState(), 'a')).toMatchObject({ draft: 'half-written', editing: null });
  });

  it('keeps drafts per chat and clears edit when replying', () => {
    const ui = useUI.getState();
    ui.setDraft('a', 'for a');
    ui.setDraft('b', 'for b');
    ui.startEdit('a', '1', 'edit');
    useUI.getState().startReply('a', '2');
    expect(composerFor(useUI.getState(), 'a')).toMatchObject({ draft: 'for a', replyTo: '2', editing: null });
    expect(composerFor(useUI.getState(), 'b').draft).toBe('for b');
  });
});
