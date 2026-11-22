import { describe, expect, it } from 'vitest';
import { matchesHotkey, parseHotkey } from './hotkeys';

const ev = (key: string, mods: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent('keydown', { key, ...mods });

describe('hotkeys', () => {
  it('parses combos', () => {
    expect(parseHotkey('Ctrl+K')).toEqual({ key: 'k', ctrl: true, alt: false, shift: false });
    expect(parseHotkey('Ctrl+Comma').key).toBe(',');
    expect(parseHotkey('Alt+ArrowUp')).toMatchObject({ key: 'arrowup', alt: true });
  });
  it('matches exact modifiers', () => {
    const hk = parseHotkey('Ctrl+K');
    expect(matchesHotkey(ev('k', { ctrlKey: true }), hk)).toBe(true);
    expect(matchesHotkey(ev('K', { metaKey: true }), hk)).toBe(true);
    expect(matchesHotkey(ev('k'), hk)).toBe(false);
    expect(matchesHotkey(ev('k', { ctrlKey: true, shiftKey: true }), hk)).toBe(false);
  });
});
