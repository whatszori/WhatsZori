import { describe, expect, it } from 'vitest';
import { highlight } from './highlight';

const marks = (t: string, q: string) =>
  highlight(t, q)
    .filter((p) => p.hit)
    .map((p) => p.text);

describe('highlight', () => {
  it('prefix matches at word starts, any case and script', () => {
    expect(marks('Lunch at noon, then lunchtime', 'lun')).toEqual(['Lun', 'lun']);
    expect(marks('Привет, как ДЕЛА', 'дел')).toEqual(['ДЕЛ']);
    expect(marks('salad', 'lad')).toEqual([]);
  });
  it('keeps all the text and is safe with regex characters', () => {
    const parts = highlight('a (b) c', '(b');
    expect(parts.map((p) => p.text).join('')).toBe('a (b) c');
    expect(marks('price $5', '$5')).toEqual(['5']);
  });
});
