import { describe, expect, it } from 'vitest';
import { encodeMentions } from './mentions';

describe('encodeMentions', () => {
  it('turns the names shown into "@<number>" and lists who', () => {
    const out = encodeMentions('@Anna Petrova and @Anna, look', {
      '@Anna': '88001@lid',
      '@Anna Petrova': '15550100001@s.whatsapp.net',
      '@Bob': '15550100002@s.whatsapp.net',
    });
    expect(out.text).toBe('@15550100001 and @88001, look');
    expect(out.jids.sort()).toEqual(['15550100001@s.whatsapp.net', '88001@lid']);
  });

  it('leaves text alone when nobody was picked', () => {
    expect(encodeMentions('mail me @ home', {})).toEqual({ text: 'mail me @ home', jids: [] });
  });
});
