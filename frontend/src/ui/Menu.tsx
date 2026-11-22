import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Popover, type PopoverAnchor } from './Popover';
import './Menu.css';

export type MenuEntry =
  | {
      kind?: 'item';
      id: string;
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { kind: 'separator'; id: string }
  | { kind: 'custom'; id: string; node: ReactNode };

interface MenuProps {
  open: boolean;
  anchor: PopoverAnchor | null;
  onClose: () => void;
  items: MenuEntry[];
  label: string;
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
  header?: ReactNode;
  children?: ReactNode;
}

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';

export function Menu({
  open,
  anchor,
  onClose,
  items,
  label,
  placement,
  header,
  children,
}: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      ref.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    const list = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    if (list.length === 0) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Tab') {
      e.preventDefault();
      onClose();
      return;
    }
    if (next >= 0) {
      e.preventDefault();
      list[next].focus();
    }
  };

  return (
    <Popover
      open={open}
      anchor={anchor}
      onClose={onClose}
      placement={placement}
      role="presentation"
      className="wz-menu-popover"
    >
      <div ref={ref} role="menu" aria-label={label} className="wz-menu" onKeyDown={onKeyDown}>
        {header}
        {items.map((item) => {
          if (item.kind === 'separator')
            return <div key={item.id} role="separator" className="wz-menu__separator" />;
          if (item.kind === 'custom') return <div key={item.id}>{item.node}</div>;
          return (
            <MenuItem
              key={item.id}
              label={item.label}
              icon={item.icon}
              shortcut={item.shortcut}
              danger={item.danger}
              disabled={item.disabled}
              onSelect={() => {
                onClose();
                item.onSelect();
              }}
            />
          );
        })}
        {children}
      </div>
    </Popover>
  );
}

interface MenuItemProps {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function MenuItem({ label, icon, shortcut, danger, disabled, onSelect }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      className={`wz-menu__item${danger ? ' wz-menu__item--danger' : ''}`}
      onClick={onSelect}
    >
      <span className="wz-menu__icon">{icon}</span>
      <span className="wz-menu__label">{label}</span>
      {shortcut && <kbd className="wz-menu__shortcut">{shortcut}</kbd>}
    </button>
  );
}
