import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline, plainText, toWhatsApp } from './markdown';

describe('parseInline', () => {
  it('reads bold, italic, strike and code', () => {
    expect(parseInline('a *b* _c_ ~d~ `e`')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'b', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'i', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 's', c: [{ t: 'text', v: 'd' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'e' },
    ]);
  });

  it('nests', () => {
    expect(parseInline('*_x_*')).toEqual([{ t: 'b', c: [{ t: 'i', c: [{ t: 'text', v: 'x' }] }] }]);
  });

  it('leaves things that only look like markers', () => {
    for (const s of [
      'snake_case_name',
      '2*3*4',
      'a * b * c',
      '*not closed',
      'https://example.com/a_b_c',
      '**',
      '*a\nb*',
    ]) {
      expect(plainText(s)).toBe(s);
    }
  });

  it('allows punctuation around markers', () => {
    expect(plainText('(*yes*), "_ok_"!')).toBe('(yes), "ok"!');
  });

  it('keeps formatting out of code', () => {
    expect(parseInline('```*a* _b_```')).toEqual([{ t: 'code', v: '*a* _b_' }]);
  });
});

describe('parseBlocks', () => {
  it('reads quotes, lists and code blocks', () => {
    const b = parseBlocks(
      'hi\n> quoted\n> more\n- one\n- two\n3. three\n```\nx = 1\ny = 2\n```\nbye',
    );
    expect(b.map((x) => x.t)).toEqual(['p', 'quote', 'ul', 'ol', 'pre', 'p']);
    expect(b[3]).toMatchObject({ t: 'ol', start: 3 });
    expect(b[4]).toEqual({ t: 'pre', v: 'x = 1\ny = 2' });
  });

  it('keeps plain text as one paragraph', () => {
    expect(parseBlocks('a\n\nb')).toEqual([{ t: 'p', c: [{ t: 'text', v: 'a\n\nb' }] }]);
  });
});

describe('toWhatsApp', () => {
  it('turns Markdown habits into WhatsApp formatting', () => {
    expect(toWhatsApp('**bold** ~~gone~~ __it__')).toBe('*bold* ~gone~ _it_');
  });
  it('leaves code and snake case alone', () => {
    expect(toWhatsApp('`**x**` a__b__c')).toBe('`**x**` a__b__c');
  });
});
