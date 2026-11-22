import { describe, expect, it } from 'vitest';
import { linkify } from './linkify';

describe('linkify', () => {
  it('splits text around urls', () => {
    expect(linkify('see https://example.com/a?b=1 now')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', value: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { type: 'text', value: ' now' },
    ]);
  });
  it('drops trailing punctuation and handles www', () => {
    expect(linkify('go to www.example.org.')).toEqual([
      { type: 'text', value: 'go to ' },
      { type: 'link', value: 'www.example.org', href: 'https://www.example.org' },
      { type: 'text', value: '.' },
    ]);
  });
  it('returns plain text untouched', () => {
    expect(linkify('no links here')).toEqual([{ type: 'text', value: 'no links here' }]);
  });
});
