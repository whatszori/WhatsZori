// Keyboard shortcuts for commands: "Ctrl+Shift+K", "Mod+K" (Cmd on a Mac, Ctrl elsewhere),
// "Alt+1", "Ctrl+Alt+ArrowUp". A plugin shortcut needs Ctrl, Alt or Mod so typing never triggers
// one, and can't take over the app's own.

export interface Shortcut {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  // lower case: "k", "1", "arrowup", "f5", ","
  key: string;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const ALIASES: Record<string, string> = {
  esc: 'escape',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  comma: ',',
  period: '.',
  space: ' ',
  plus: '+',
};

export function parseShortcut(text: string): Shortcut {
  const parts = text
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  // "Ctrl++" ends with an empty part that was the plus key
  if (text.trim().endsWith('++')) parts.push('+');
  const s: Shortcut = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
  for (const raw of parts) {
    const p = raw.toLowerCase();
    if (p === 'ctrl' || p === 'control') s.ctrl = true;
    else if (p === 'alt' || p === 'option') s.alt = true;
    else if (p === 'shift') s.shift = true;
    else if (p === 'cmd' || p === 'meta' || p === 'win') s.meta = true;
    else if (p === 'mod') {
      if (isMac) s.meta = true;
      else s.ctrl = true;
    } else if (s.key) throw new Error(`"${text}" has two keys`);
    else s.key = ALIASES[p] ?? p;
  }
  if (!s.key) throw new Error(`"${text}" has no key`);
  return s;
}

export function checkPluginShortcut(s: Shortcut): void {
  if (!s.ctrl && !s.alt && !s.meta && !/^f\d{1,2}$/.test(s.key)) {
    throw new Error('a shortcut needs Ctrl, Alt or Mod (or an F key)');
  }
  const id = shortcutId(s);
  if (RESERVED.has(id)) throw new Error(`${formatShortcut(s)} belongs to WhatsZori`);
}

export function shortcutId(s: Shortcut): string {
  return [s.ctrl && 'ctrl', s.alt && 'alt', s.shift && 'shift', s.meta && 'meta', s.key]
    .filter(Boolean)
    .join('+');
}

export function matches(s: Shortcut, e: KeyboardEvent): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  // with Shift, "1" arrives as "!"; compare the physical digit instead
  const code = e.code.startsWith('Digit')
    ? e.code.slice(5)
    : e.code.startsWith('Key')
      ? e.code.slice(3).toLowerCase()
      : '';
  return (
    e.ctrlKey === s.ctrl &&
    e.altKey === s.alt &&
    e.shiftKey === s.shift &&
    e.metaKey === s.meta &&
    (key === s.key || code === s.key)
  );
}

export function formatShortcut(s: Shortcut): string {
  const names: string[] = [];
  if (s.ctrl) names.push('Ctrl');
  if (s.meta) names.push(isMac ? '⌘' : 'Win');
  if (s.alt) names.push(isMac ? '⌥' : 'Alt');
  if (s.shift) names.push('Shift');
  const k = s.key;
  names.push(
    k === ' '
      ? 'Space'
      : k.startsWith('arrow')
        ? { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' }[k]!
        : k.length === 1
          ? k.toUpperCase()
          : k[0].toUpperCase() + k.slice(1),
  );
  return names.join(' ');
}

// the app's own shortcuts (MainLayout, Conversation, composer, editor)
const RESERVED = new Set(
  [
    'Ctrl+K',
    'Ctrl+N',
    'Ctrl+,',
    'Ctrl+F',
    'Ctrl+Shift+P',
    'Alt+ArrowUp',
    'Alt+ArrowDown',
    'Ctrl+Z',
    'Ctrl+Y',
    'Ctrl+Shift+Z',
    'Ctrl+V',
    'Ctrl+C',
    'Ctrl+X',
    'Ctrl+A',
    'Ctrl+W',
    'Ctrl+R',
    'F5',
    'Alt+F4',
  ].map((t) => shortcutId(parseShortcut(t))),
);
