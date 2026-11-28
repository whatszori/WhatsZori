import { describe, expect, it } from 'vitest';
import type { Message } from '../../api/types';
import { buildRows } from './rows';

const base = new Date(2026, 10, 20, 12, 0).getTime();
const m = (pk: string, minutes: number, sender = 'a'): Message => ({
  pk,
  id: pk,
  chatJid: 'c',
  senderJid: sender,
  senderName: sender,
  fromMe: sender === 'me',
  timestamp: base + minutes * 60_000,
  kind: 'text',
  text: pk,
  reactions: [],
});

describe('buildRows', () => {
  it('inserts day separators and groups by sender within 5 minutes', () => {
    const rows = buildRows(
      [m('1', 0), m('2', 2), m('3', 9), m('4', 10, 'me'), m('5', 24 * 60, 'me')],
      base + 3 * 86_400_000,
    );
    expect(rows.map((r) => (r.type === 'day' ? `D:${r.label}` : r.key))).toEqual([
      'D:Friday',
      '1',
      '2',
      '3',
      '4',
      'D:Saturday',
      '5',
    ]);
    const flags = rows
      .filter((r) => r.type === 'msg')
      .map((r) => (r.type === 'msg' ? `${+r.groupStart}${+r.groupEnd}` : ''));
    // 1-2 grouped, 3 alone (gap > 5 min), 4 different sender, 5 next day
    expect(flags).toEqual(['10', '01', '11', '11', '11']);
  });
});

describe('albums', () => {
  const photo = (pk: string, seconds: number, text = '', sender = 'a'): Message => ({
    ...m(pk, 0, sender),
    timestamp: base + seconds * 1000,
    kind: 'image',
    text,
    media: { width: 10, height: 10 },
  });

  it('groups photos sent together, the caption on the last', () => {
    const rows = buildRows([photo('1', 0), photo('2', 20), photo('3', 40, 'look'), photo('4', 50)]);
    const msgs = rows.filter((r) => r.type === 'msg');
    expect(msgs.map((r) => r.key)).toEqual(['3', '4']);
    expect(msgs[0].type === 'msg' && msgs[0].album?.map((x) => x.pk)).toEqual(['1', '2', '3']);
    expect(msgs[1].type === 'msg' && msgs[1].album).toBeUndefined();
  });

  it('keeps apart other senders, long gaps and lone photos', () => {
    const rows = buildRows([photo('1', 0), photo('2', 10, '', 'b'), photo('3', 200, '', 'b')]);
    expect(rows.filter((r) => r.type === 'msg' && r.album).length).toBe(0);
  });
});
