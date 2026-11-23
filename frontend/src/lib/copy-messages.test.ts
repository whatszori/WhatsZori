import { describe, expect, it } from 'vitest';
import type { Message } from '../api';
import { copyText } from './copy-messages';

const msg = (p: Partial<Message>): Message => ({
  pk: '1',
  id: 'x',
  chatJid: 'a@s.whatsapp.net',
  senderJid: 'a@s.whatsapp.net',
  senderName: 'Anna',
  fromMe: false,
  timestamp: new Date(2026, 11, 31, 23, 59).getTime(),
  kind: 'text',
  text: '',
  reactions: [],
  ...p,
});

describe('copyText', () => {
  it('copies one message as its plain text', () => {
    expect(copyText([msg({ text: 'hello' })])).toBe('hello');
  });
  it('copies several in time order with stamps and names', () => {
    const later = msg({
      pk: '2',
      fromMe: true,
      text: 'second',
      timestamp: msg({}).timestamp + 60_000,
    });
    const photo = msg({
      kind: 'image',
      text: 'sunset',
      media: { mime: 'image/jpeg' } as Message['media'],
    });
    expect(copyText([later, photo])).toBe(
      '[31.12.2026, 23:59] Anna: <photo> sunset\n[01.01.2027, 00:00] You: second',
    );
  });
});
