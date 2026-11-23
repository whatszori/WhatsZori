import { describe, expect, it } from 'vitest';
import type { Chat } from '../api';
import { buildChatList } from './chat-selectors';

const chat = (jid: string, extra: Partial<Chat> = {}): Chat => ({
  jid,
  name: jid,
  isGroup: false,
  pinned: false,
  archived: false,
  muted: false,
  unread: 0,
  lastMessage: null,
  lastActivity: 1,
  ...extra,
});

describe('chat filters', () => {
  const chats = [
    chat('a', { favorite: true }),
    chat('b', { lists: [1, 2] }),
    chat('c', { lists: [2], isGroup: true }),
    chat('d'),
  ];
  const jids = (f: Parameters<typeof buildChatList>[1]) =>
    buildChatList(chats, f, '')
      .others.map((c) => c.jid)
      .sort();

  it('favorites', () => expect(jids('favorites')).toEqual(['a']));
  it('a list', () => {
    expect(jids('list:1')).toEqual(['b']);
    expect(jids('list:2')).toEqual(['b', 'c']);
    expect(jids('list:9')).toEqual([]);
  });
  it('the old ones still work', () => {
    expect(jids('groups')).toEqual(['c']);
    expect(jids('all')).toEqual(['a', 'b', 'c', 'd']);
  });
});
