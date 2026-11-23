import { describe, expect, it } from 'vitest';
import { loadEmoji, searchEmoji, withTone } from './emoji-data';

describe('emoji data', () => {
  it('groups, searches and applies skin tones', async () => {
    const groups = await loadEmoji();
    expect(groups.map((g) => g.key)).toEqual([
      'smileys',
      'people',
      'nature',
      'food',
      'travel',
      'activities',
      'objects',
      'symbols',
      'flags',
    ]);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBeGreaterThan(1500);
    const wave = searchEmoji(groups, 'waving hand')[0];
    expect(wave.emoji).toBe('👋');
    expect(withTone(wave, 3)).toBe('👋🏽');
    expect(withTone(wave, 0)).toBe('👋');
    // tags count too
    expect(searchEmoji(groups, 'pizza').map((e) => e.emoji)).toContain('🍕');
    expect(searchEmoji(groups, '')).toEqual([]);
  });
});
