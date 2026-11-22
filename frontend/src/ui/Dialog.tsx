import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useLayer } from './layers';
import { IconButton } from './IconButton';
import './Dialog.css';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Dialog({ open, title, onClose, children, footer, width = 420 }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useLayer(open, onClose);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="wz-dialog__scrim"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="wz-dialog"
        style={{ width }}
      >
        <header className="wz-dialog__header">
          <h2 id={titleId} className="wz-dialog__title">
            {title}
          </h2>
          <IconButton label="Close" icon={<X size={18} />} size="sm" onClick={onClose} />
        </header>
        <div className="wz-dialog__body">{children}</div>
        {footer && <footer className="wz-dialog__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
