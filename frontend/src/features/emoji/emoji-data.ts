// The emoji set, loaded on first use so it stays out of the main bundle.

export interface EmojiItem {
  emoji: string;
  label: string;
  // label words and tags, lower case, for search
  terms: string;
  // tone 1..5 -> variant
  skins?: Record<number, string>;
}

export interface EmojiGroup {
  key: string;
  label: string;
  icon: string;
  items: EmojiItem[];
}

// newer emoji show as empty boxes on Windows 11 and older Linux font packs
const MAX_VERSION = 15;

const GROUPS: Record<number, { key: string; label: string; icon: string }> = {
  0: { key: 'smileys', label: 'Smileys & emotion', icon: '😀' },
  1: { key: 'people', label: 'People & body', icon: '👋' },
  3: { key: 'nature', label: 'Animals & nature', icon: '🐻' },
  4: { key: 'food', label: 'Food & drink', icon: '🍔' },
  5: { key: 'travel', label: 'Travel & places', icon: '✈️' },
  6: { key: 'activities', label: 'Activities', icon: '⚽' },
  7: { key: 'objects', label: 'Objects', icon: '💡' },
  8: { key: 'symbols', label: 'Symbols', icon: '❤️' },
  9: { key: 'flags', label: 'Flags', icon: '🏳️' },
};

interface Raw {
  emoji: string;
  label: string;
  tags?: string[];
  group?: number;
  order?: number;
  version: number;
  skins?: { emoji: string; tone?: number | number[]; version: number }[];
}

let cached: Promise<EmojiGroup[]> | null = null;

export function loadEmoji(): Promise<EmojiGroup[]> {
  cached ??= import('emojibase-data/en/data.json').then((mod) => {
    const data = (mod as unknown as { default: Raw[] }).default;
    const groups = new Map<number, EmojiItem[]>();
    for (const e of [...data].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      if (e.group === undefined || !GROUPS[e.group] || e.version > MAX_VERSION) continue;
      const item: EmojiItem = {
        emoji: e.emoji,
        label: e.label,
        terms: [e.label, ...(e.tags ?? [])].join(' ').toLowerCase(),
      };
      for (const s of e.skins ?? []) {
        // single-tone variants only; mixed ones (two people) would need a second picker
        if (typeof s.tone === 'number' && s.version <= MAX_VERSION) {
          item.skins ??= {};
          item.skins[s.tone] = s.emoji;
        }
      }
      groups.set(e.group, [...(groups.get(e.group) ?? []), item]);
    }
    return Object.entries(GROUPS)
      .map(([g, meta]) => ({ ...meta, items: groups.get(Number(g)) ?? [] }))
      .filter((g) => g.items.length > 0);
  });
  return cached;
}

export function withTone(item: EmojiItem, tone: number): string {
  return (tone && item.skins?.[tone]) || item.emoji;
}

export function searchEmoji(groups: EmojiGroup[], query: string, limit = 120): EmojiItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: EmojiItem[] = [];
  for (const g of groups) {
    for (const it of g.items) {
      if (words.every((w) => it.terms.includes(w))) {
        out.push(it);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

// recently used, per viewer; browser storage can be missing (private mode), so everything is guarded
const RECENT_KEY = 'wz.emoji.recent';
const TONE_KEY = 'wz.emoji.tone';

export function recentEmoji(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 24) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(e: string): void {
  try {
    const next = [e, ...recentEmoji().filter((x) => x !== e)].slice(0, 24);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // not worth bothering the user
  }
}

export function savedTone(): number {
  try {
    const n = Number(localStorage.getItem(TONE_KEY) ?? 0);
    return n >= 0 && n <= 5 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveTone(t: number): void {
  try {
    localStorage.setItem(TONE_KEY, String(t));
  } catch {
    // ignore
  }
}
