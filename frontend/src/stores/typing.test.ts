import { afterEach, describe, expect, it, vi } from 'vitest';
import { TYPING_TTL, useChats } from './chats';
import { resampleWave } from '../features/conversation/Media';

afterEach(() => {
  vi.useRealTimers();
  useChats.setState({ typing: {} });
});

const typingIn = (chat: string) => Object.keys(useChats.getState().typing[chat] ?? {});

describe('typing', () => {
  it('expires when WhatsApp never sends "paused"', () => {
    vi.useFakeTimers();
    useChats.getState().setTyping('c', 'alan', 'Alan', true);
    expect(typingIn('c')).toEqual(['alan']);
    vi.advanceTimersByTime(TYPING_TTL - 1000);
    // a fresh "composing" keeps it alive
    useChats.getState().setTyping('c', 'alan', 'Alan', true);
    vi.advanceTimersByTime(TYPING_TTL - 1000);
    expect(typingIn('c')).toEqual(['alan']);
    vi.advanceTimersByTime(2000);
    expect(typingIn('c')).toEqual([]);
  });

  it('stops when the person goes offline', () => {
    useChats.getState().setTyping('c', 'alan', 'Alan', true);
    useChats.getState().setTyping('g', 'alan', 'Alan', true);
    useChats.getState().setPresence('alan', false, null);
    expect(typingIn('c')).toEqual([]);
    expect(typingIn('g')).toEqual([]);
  });
});

describe('voice waveform', () => {
  it('fits 64 amplitudes into fewer bars, keeping peaks', () => {
    const wave = Array.from({ length: 64 }, (_, i) => (i === 33 ? 1 : 0.1));
    const out = resampleWave(wave, 40);
    expect(out).toHaveLength(40);
    expect(Math.max(...out)).toBe(1);
    expect(resampleWave([0.2, 0.4], 40)).toEqual([0.2, 0.4]);
  });
});
