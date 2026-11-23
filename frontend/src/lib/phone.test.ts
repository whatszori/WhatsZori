import { describe, expect, it } from 'vitest';
import { phoneDigits } from './phone';

describe('phoneDigits', () => {
  it('matches the Go rule', () => {
    expect(phoneDigits('+7 (912) 345-67-89')).toBe('79123456789');
    expect(phoneDigits('0049 151 2345678')).toBe('491512345678');
    expect(phoneDigits('+44.20.7946.0958')).toBe('442079460958');
    expect(phoneDigits('12345')).toBe('');
    expect(phoneDigits('0151 2345678')).toBe('');
    expect(phoneDigits('Anna')).toBe('');
  });
});
