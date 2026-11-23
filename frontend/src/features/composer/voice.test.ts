import { describe, expect, it } from 'vitest';
import { toWaveform } from './VoiceRecorder';

describe('voice waveform', () => {
  it('64 bars scaled to the loudest, peaks kept', () => {
    const levels = Array.from({ length: 300 }, (_, i) => (i === 150 ? 0.5 : 0.05));
    const w = toWaveform(levels);
    expect(w).toHaveLength(64);
    expect(Math.max(...w)).toBe(100);
    expect(Math.min(...w)).toBe(10);
  });
  it('silence and short recordings', () => {
    expect(toWaveform([])).toEqual(Array.from({ length: 64 }, () => 0));
    expect(toWaveform([0.2, 0.4])).toHaveLength(64);
  });
});
