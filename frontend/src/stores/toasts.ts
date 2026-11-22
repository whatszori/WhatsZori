import { create } from 'zustand';
import type { Toast } from '../api';

export interface ToastItem extends Toast {
  id: number;
}

interface ToastState {
  items: ToastItem[];
  push(toast: Toast): void;
  dismiss(id: number): void;
}

const TTL = { error: 7000, info: 5000 } as const;
const MAX = 3;
let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push(toast) {
    // the same message twice in a row (a retry loop, a double click) shows once
    if (get().items.some((t) => t.text === toast.text)) return;
    const id = nextId++;
    set((s) => ({ items: [...s.items, { ...toast, id }].slice(-MAX) }));
    window.setTimeout(() => get().dismiss(id), TTL[toast.kind]);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

// for catch blocks: whatever was thrown, show something readable
export function toastError(err: unknown, prefix?: string): void {
  const text =
    err instanceof Error ? err.message : typeof err === 'string' ? err : 'Something went wrong';
  useToasts.getState().push({ kind: 'error', text: prefix ? `${prefix}: ${text}` : text });
}
