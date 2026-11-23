import { create } from 'zustand';
import type { ExportProgress, JID } from '../api';

interface ExportState {
  // the running (or last) export per chat
  byChat: Record<JID, ExportProgress>;
  update(p: ExportProgress): void;
}

export const useExports = create<ExportState>((set) => ({
  byChat: {},
  update: (p) => set((s) => ({ byChat: { ...s.byChat, [p.jid]: p } })),
}));
