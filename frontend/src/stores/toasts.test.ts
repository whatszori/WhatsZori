import { afterEach, describe, expect, it, vi } from 'vitest';
import { toastError, useToasts } from './toasts';
import { useConnection } from './connection';

afterEach(() => {
  useToasts.setState({ items: [] });
  vi.useRealTimers();
});

describe('toasts', () => {
  it('shows an error once and drops it after a while', () => {
    vi.useFakeTimers();
    toastError(new Error('Slow down'), 'Not sent');
    toastError(new Error('Slow down'), 'Not sent');
    expect(useToasts.getState().items.map((t) => t.text)).toEqual(['Not sent: Slow down']);
    vi.advanceTimersByTime(10_000);
    expect(useToasts.getState().items).toEqual([]);
  });

  it('keeps at most three', () => {
    for (const t of ['a', 'b', 'c', 'd']) useToasts.getState().push({ kind: 'info', text: t });
    expect(useToasts.getState().items.map((t) => t.text)).toEqual(['b', 'c', 'd']);
  });
});

describe('connection', () => {
  it('clears the QR on an auth error and the error on a new QR', () => {
    const c = useConnection.getState();
    c.setQR({ code: '2@x', expiresIn: 20_000 });
    c.setAuthError('The login code expired');
    expect(useConnection.getState().qr).toBeNull();
    c.setQR({ code: '2@y', expiresIn: 20_000 });
    expect(useConnection.getState().authError).toBeNull();
  });

  it('hides sync progress when done', () => {
    useConnection.getState().setSync({ progress: 40, done: false });
    expect(useConnection.getState().sync?.progress).toBe(40);
    useConnection.getState().setSync({ progress: 100, done: true });
    expect(useConnection.getState().sync).toBeNull();
  });
});
