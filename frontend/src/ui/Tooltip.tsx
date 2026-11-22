import { useCallback, useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './Tooltip.css';

interface TooltipProps {
  label: string;
  hint?: string;
  placement?: 'top' | 'bottom';
  children: ReactNode;
}

const DELAY = 450;

export function Tooltip({ label, hint, placement = 'bottom', children }: TooltipProps) {
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setPos(null);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = (immediate: boolean) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => {
        const el = anchor.current?.firstElementChild ?? anchor.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        let above = placement === 'top';
        if (above && r.top < 40) above = false;
        if (!above && r.bottom > window.innerHeight - 40) above = true;
        setPos({ x: r.left + r.width / 2, y: above ? r.top - 6 : r.bottom + 6, above });
      },
      immediate ? 0 : DELAY,
    );
  };

  const onFocus = (e: FocusEvent) => {
    // only keyboard focus shows a tooltip right away
    if ((e.target as HTMLElement).matches(':focus-visible')) show(true);
  };

  return (
    <span
      ref={anchor}
      className="wz-tooltip-anchor"
      onMouseEnter={() => show(false)}
      onMouseLeave={hide}
      onMouseDown={hide}
      onFocus={onFocus}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            className={`wz-tooltip ${pos.above ? 'wz-tooltip--above' : 'wz-tooltip--below'}`}
            style={{ left: pos.x, top: pos.y }}
          >
            {label}
            {hint && <kbd className="wz-tooltip__hint">{hint}</kbd>}
          </div>,
          document.body,
        )}
    </span>
  );
}
