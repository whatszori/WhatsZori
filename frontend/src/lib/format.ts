const AVATAR_HUES = [210, 190, 160, 130, 40, 20, 340, 280, 250];

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function nameHue(name: string): number {
  return AVATAR_HUES[hashString(name) % AVATAR_HUES.length];
}

export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  const first = Array.from(words[0]);
  // CJK names usually have no spaces, one glyph reads better than two
  if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(first[0])) return first[0];
  if (words.length === 1) return first.slice(0, 2).join('').toUpperCase();
  return (first[0] + Array.from(words[words.length - 1])[0]).toUpperCase();
}

export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DAY = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function daysAgo(ts: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
}

// chat list: 14:05 / Yesterday / Mon / 12.03.24
export function formatChatTime(ts: number, now = Date.now()): string {
  const ago = daysAgo(ts, now);
  if (ago <= 0) return formatTime(ts);
  if (ago === 1) return 'Yesterday';
  if (ago < 7) return WEEKDAYS[new Date(ts).getDay()];
  const d = new Date(ts);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

// day separators: Today / Yesterday / Monday / 3 March / 3 March 2023
export function formatDay(ts: number, now = Date.now()): string {
  const ago = daysAgo(ts, now);
  if (ago <= 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  const d = new Date(ts);
  if (ago < 7) return WEEKDAYS_LONG[d.getDay()];
  const base = `${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export function formatDateTime(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const ago = daysAgo(ts, now);
  const time = formatTime(ts);
  if (ago === 0) return `Today, ${time}`;
  if (ago === 1) return `Yesterday, ${time}`;
  // the future (scheduled messages, events)
  if (ago === -1) return `Tomorrow, ${time}`;
  if (ago < -1 && ago > -7) return `${WEEKDAYS_LONG[d.getDay()]}, ${time}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}, ${time}`;
}

export function formatLastSeen(ts: number | null, now = Date.now()): string {
  if (ts === null) return 'last seen recently';
  const diff = now - ts;
  if (diff < 60_000) return 'last seen just now';
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return `last seen ${m} minute${m === 1 ? '' : 's'} ago`;
  }
  const ago = daysAgo(ts, now);
  if (ago === 0) return `last seen today at ${formatTime(ts)}`;
  if (ago === 1) return `last seen yesterday at ${formatTime(ts)}`;
  return `last seen ${formatDateTime(ts, now)}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function normalizePhone(input: string): string {
  return input.replace(/[^\d]/g, '');
}

// Loose international grouping; good enough for display without pulling in libphonenumber.
export function formatPhone(input: string): string {
  const d = normalizePhone(input);
  if (!d) return '';
  if (d.length <= 3) return `+${d}`;
  if (d.startsWith('1') && d.length === 11)
    return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (d.startsWith('7') && d.length === 11)
    return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  const cc = d.length > 10 ? d.slice(0, d.length - 10) : d.slice(0, 2);
  const rest = d.slice(cc.length);
  const groups = rest.match(/.{1,3}/g) ?? [];
  return `+${cc} ${groups.join(' ')}`.trim();
}

export function isValidPhone(input: string): boolean {
  const d = normalizePhone(input);
  return d.length >= 8 && d.length <= 15;
}

export function formatPairingCode(code: string): string {
  const c = code.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
