// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { register, resetSlots } from '../plugin-core/slots';
import { ToastCard, type CardControls } from './ToastCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toast = {
  id: 't1',
  chatJid: 'a@s.whatsapp.net',
  pk: '1',
  title: 'Alan (2 new)',
  body: 'hello',
  avatar: '',
  isGroup: false,
  actions: true,
  at: 0,
};

const controls = (): CardControls => ({
  open: vi.fn(),
  markRead: vi.fn(),
  reply: vi.fn(),
  dismiss: vi.fn(),
  startTyping: vi.fn(),
  stopTyping: vi.fn(),
});

function render(c: CardControls) {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  act(() => root.render(<ToastCard toast={toast} controls={c} />));
  return { el, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  resetSlots();
  document.body.innerHTML = '';
});

describe('toast card', () => {
  it('stock card: open, mark read, reply', () => {
    const c = controls();
    const { el, unmount } = render(c);
    expect(el.textContent).toContain('Alan (2 new)');
    act(() => el.querySelector<HTMLButtonElement>('.wz-ntf__main')!.click());
    expect(c.open).toHaveBeenCalled();
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.wz-ntf__action')][1].click());
    expect(c.markRead).toHaveBeenCalled();
    act(() => el.querySelector<HTMLButtonElement>('.wz-ntf__action')!.click());
    expect(c.startTyping).toHaveBeenCalled();
    expect(el.querySelector('.wz-ntf__input')).not.toBeNull();
    unmount();
  });

  it('a plugin card replaces the stock one and gets the controls', () => {
    register('notification.card', 'fancy', ({ notification, controls }) => (
      <button className="fancy" onClick={controls.open}>
        {notification.title}!
      </button>
    ));
    const c = controls();
    const { el, unmount } = render(c);
    expect(el.querySelector('.wz-ntf')).toBeNull();
    act(() => el.querySelector<HTMLButtonElement>('.fancy')!.click());
    expect(c.open).toHaveBeenCalled();
    unmount();
  });

  it('a crashing plugin card falls back to the stock card', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    register('notification.card', 'broken', () => {
      throw new Error('boom');
    });
    const { el, unmount } = render(controls());
    expect(el.querySelector('.wz-ntf')).not.toBeNull();
    unmount();
  });

  it('accessories render inside the stock card', () => {
    register('notification.accessories', 'badge', ({ notification }) => (
      <span className="badge">{notification.chatJid}</span>
    ));
    const { el, unmount } = render(controls());
    expect(el.querySelector('.wz-ntf .badge')?.textContent).toBe('a@s.whatsapp.net');
    unmount();
  });
});
