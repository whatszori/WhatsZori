import { useCallback, useEffect, useRef, useState } from 'react';
import { Toasts } from '../../bindings/github.com/whatszori/WhatsZori/internal/app';
import { backend, type InAppToast } from '../api';
import { useAppearance } from '../app/useAppearance';
import { useSettings } from '../stores/settings';
import { useUserThemes } from '../themes/user-themes';
import { ToastCard, type CardControls } from './ToastCard';
import './toast.css';

const LIFETIME = 7000;
const MAX = 4;

interface Item {
  toast: InAppToast;
  until: number;
}

// The page inside the toast window: a stack of cards in the bottom-right corner. The window is
// sized to the stack, so nothing outside the cards catches clicks.
export function ToastApp() {
  const [items, setItems] = useState<Item[]>([]);
  const [paused, setPaused] = useState(false);
  const [typing, setTyping] = useState(false);
  const stack = useRef<HTMLDivElement>(null);
  useAppearance();

  const add = useCallback((t: InAppToast) => {
    setItems((cur) => {
      // one card per chat: a newer message replaces it, like the phone does
      const rest = t.chatJid ? cur.filter((i) => i.toast.chatJid !== t.chatJid) : cur;
      return [...rest, { toast: t, until: Date.now() + LIFETIME }].slice(-MAX);
    });
  }, []);

  const remove = useCallback((id: string) => {
    setItems((cur) => cur.filter((i) => i.toast.id !== id));
  }, []);

  useEffect(() => {
    void useSettings.getState().load();
    void useUserThemes.getState().load();
    const offs = [
      backend.on('wz:toast:show', add),
      backend.on('wz:toast:withdraw', ({ jid }) =>
        setItems((cur) => cur.filter((i) => i.toast.chatJid !== jid)),
      ),
      // the main window saved settings: follow its theme
      backend.on('wz:settings:changed', () => void useSettings.getState().load()),
      backend.on('wz:systheme:changed', (p) => useSettings.getState().setSystem(p)),
      backend.on('wz:theme:changed', (c) => useUserThemes.getState().fileChanged(c)),
    ];
    void Toasts.Ready().then((list) => (list ?? []).forEach(add));
    return () => offs.forEach((off) => off());
  }, [add]);

  // expire cards, except while the pointer is over the stack or a reply is being typed
  useEffect(() => {
    if (paused || typing || items.length === 0) return;
    const t = window.setInterval(() => {
      const now = Date.now();
      setItems((cur) => (cur.some((i) => i.until <= now) ? cur.filter((i) => i.until > now) : cur));
    }, 250);
    return () => window.clearInterval(t);
  }, [paused, typing, items.length]);

  // when the pointer leaves, give every card a few more seconds instead of vanishing at once
  const extend = () =>
    setItems((cur) => cur.map((i) => ({ ...i, until: Math.max(i.until, Date.now() + 2500) })));

  useEffect(() => {
    const el = stack.current;
    if (!el) return;
    if (items.length === 0) {
      void Toasts.Resize(0);
      return;
    }
    const send = () => void Toasts.Resize(Math.ceil(el.getBoundingClientRect().height));
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);

  const controlsFor = (t: InAppToast): CardControls => {
    const act = (action: string, text = '') =>
      void Toasts.Act(t.chatJid, t.pk, action, text).catch(() => {});
    const done = () => {
      remove(t.id);
      if (typing) {
        setTyping(false);
        void Toasts.Deactivate();
      }
    };
    return {
      open: () => {
        act('open');
        done();
      },
      markRead: () => {
        act('read');
        done();
      },
      reply: (text) => {
        act('reply', text);
        done();
      },
      dismiss: done,
      startTyping: () => {
        setTyping(true);
        void Toasts.Activate();
      },
      stopTyping: () => {
        setTyping(false);
        extend();
        void Toasts.Deactivate();
      },
    };
  };

  return (
    <div
      ref={stack}
      className="wz-ntf-stack"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => {
        setPaused(false);
        extend();
      }}
    >
      {items.map((i) => (
        <ToastCard key={i.toast.id} toast={i.toast} controls={controlsFor(i.toast)} />
      ))}
    </div>
  );
}
