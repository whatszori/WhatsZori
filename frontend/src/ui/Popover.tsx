import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLayer } from './layers';
import './Popover.css';

export type PopoverAnchor = { x: number; y: number } | DOMRect;

interface PopoverProps {
  open: boolean;
  anchor: PopoverAnchor | null;
  onClose: () => void;
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
  className?: string;
  role?: string;
  ariaLabel?: string;
  restoreFocus?: boolean;
  children: ReactNode;
}

const MARGIN = 8;

function isRect(a: PopoverAnchor): a is DOMRect {
  return 'width' in a;
}

export function Popover({
  open,
  anchor,
  onClose,
  placement = 'bottom-start',
  className,
  role = 'dialog',
  ariaLabel,
  restoreFocus = true,
  children,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayer(open, onClose);

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) {
      setPos(null);
      return;
    }
    const el = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const a = isRect(anchor)
      ? anchor
      : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    const wantTop = placement.startsWith('top');
    const alignEnd = placement.endsWith('end');

    let left = alignEnd ? a.right - el.width : a.left;
    let top = wantTop ? a.top - el.height - 4 : a.bottom + 4;
    // flip vertically if it doesn't fit, then clamp
    if (!wantTop && top + el.height > vh - MARGIN) top = a.top - el.height - 4;
    if (wantTop && top < MARGIN) top = a.bottom + 4;
    left = Math.max(MARGIN, Math.min(left, vw - el.width - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - el.height - MARGIN));
    setPos({ left, top });
  }, [open, anchor, placement]);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onBlur = () => onClose();
    // defer so the click that opened us doesn't immediately close us
    const t = window.setTimeout(() => {
      document.addEventListener('pointerdown', onDown, true);
      window.addEventListener('blur', onBlur);
      window.addEventListener('resize', onBlur);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
      if (restoreFocus && prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [open, onClose, restoreFocus]);

  if (!open || !anchor) return null;
  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={ariaLabel}
      className={['wz-popover', className].filter(Boolean).join(' ')}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}
