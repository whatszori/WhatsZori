import { describe, expect, it } from 'vitest';
import {
  formatChatTime,
  formatDateTime,
  formatDay,
  formatDuration,
  formatFileSize,
  formatLastSeen,
  formatPairingCode,
  formatPhone,
  formatTime,
  initials,
  isSameDay,
  isValidPhone,
  nameHue,
} from './format';

const now = new Date(2026, 10, 22, 15, 30).getTime();
const at = (d: number, h = 10, m = 0) => new Date(2026, 10, d, h, m).getTime();

describe('initials', () => {
  it('takes first and last word', () => {
    expect(initials('Anna Petrova')).toBe('AP');
    expect(initials('Mark van der Berg')).toBe('MB');
  });
  it('handles single words and cyrillic', () => {
    expect(initials('alex')).toBe('AL');
    expect(initials('Дмитрий Соколов')).toBe('ДС');
  });
  it('uses one glyph for CJK names', () => {
    expect(initials('山田太郎')).toBe('山');
  });
  it('ignores punctuation and emoji', () => {
    expect(initials('🎉 Party — 2024')).toBe('P2');
    expect(initials('  ')).toBe('');
  });
});

describe('nameHue', () => {
  it('is stable for a name', () => {
    expect(nameHue('Anna')).toBe(nameHue('Anna'));
    expect(typeof nameHue('Bob')).toBe('number');
  });
});

describe('time formatting', () => {
  it('formats time with leading zeros', () => {
    expect(formatTime(new Date(2026, 0, 1, 7, 5).getTime())).toBe('07:05');
  });
  it('formats chat list times by age', () => {
    expect(formatChatTime(at(22, 9, 4), now)).toBe('09:04');
    expect(formatChatTime(at(21), now)).toBe('Yesterday');
    expect(formatChatTime(at(18), now)).toBe('Wed');
    expect(formatChatTime(at(2), now)).toBe('02.11.26');
  });
  it('formats day separators', () => {
    expect(formatDay(at(22), now)).toBe('Today');
    expect(formatDay(at(21), now)).toBe('Yesterday');
    expect(formatDay(at(17), now)).toBe('Tuesday');
    expect(formatDay(at(3), now)).toBe('3 November');
    expect(formatDay(new Date(2025, 2, 3).getTime(), now)).toBe('3 March 2025');
  });
  it('compares days', () => {
    expect(isSameDay(at(22, 0, 1), at(22, 23, 59))).toBe(true);
    expect(isSameDay(at(21, 23, 59), at(22, 0, 1))).toBe(false);
  });
  it('formats last seen', () => {
    expect(formatLastSeen(null, now)).toBe('last seen recently');
    expect(formatLastSeen(now - 10_000, now)).toBe('last seen just now');
    expect(formatLastSeen(now - 5 * 60_000, now)).toBe('last seen 5 minutes ago');
    expect(formatLastSeen(at(22, 9, 0), now)).toBe('last seen today at 09:00');
    expect(formatLastSeen(at(21, 20, 15), now)).toBe('last seen yesterday at 20:15');
  });
});

describe('sizes and durations', () => {
  it('formats file sizes', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2 MB');
    expect(formatFileSize(250 * 1024 * 1024)).toBe('250 MB');
  });
  it('formats durations', () => {
    expect(formatDuration(7)).toBe('0:07');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});

describe('phone', () => {
  it('formats common numbers', () => {
    expect(formatPhone('+1 (415) 555-0132')).toBe('+1 415 555 0132');
    expect(formatPhone('79161234567')).toBe('+7 916 123-45-67');
    expect(formatPhone('491701234567')).toBe('+49 170 123 456 7');
  });
  it('validates length', () => {
    expect(isValidPhone('+49 170 1234567')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
  });
  it('groups pairing codes', () => {
    expect(formatPairingCode('abcd1234')).toBe('ABCD-1234');
  });
});

describe('formatDateTime ahead', () => {
  it('says tomorrow and weekdays for the coming days', () => {
    const now = new Date(2026, 10, 28, 12, 0).getTime();
    expect(formatDateTime(new Date(2026, 10, 29, 9, 0).getTime(), now)).toBe('Tomorrow, 09:00');
    expect(formatDateTime(new Date(2026, 10, 28, 20, 0).getTime(), now)).toBe('Today, 20:00');
    expect(formatDateTime(new Date(2026, 11, 1, 9, 0).getTime(), now)).toBe('Tuesday, 09:00');
  });
});
