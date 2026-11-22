import { useEffect, useRef } from 'react';

// Stack of open overlays (menus, popovers, dialogs) so Esc only closes the topmost one.
type Closer = () => void;
const stack: { id: number; close: Closer }[] = [];
let nextId = 1;
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  // capture phase so the topmost layer wins over composer / list handlers
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || stack.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      stack[stack.length - 1].close();
    },
    true,
  );
}

export function hasOpenLayer(): boolean {
  return stack.length > 0;
}

export function useLayer(open: boolean, close: Closer): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    install();
    const id = nextId++;
    stack.push({ id, close: () => closeRef.current() });
    return () => {
      const i = stack.findIndex((l) => l.id === id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open]);
}
