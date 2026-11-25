import { create } from 'zustand';
import type { DialogOptions, MenuEntryInput } from './types';

// Dialogs and menus plugins open imperatively (ctx.ui.openDialog, confirm, showMenu); PluginHost
// draws them. Closing a plugin closes what it opened.

export interface OpenDialog {
  id: number;
  pluginId: string;
  opts: DialogOptions;
}

export interface OpenMenu {
  pluginId: string;
  at: DOMRect;
  items: MenuEntryInput[];
}

interface OverlayState {
  dialogs: OpenDialog[];
  menu: OpenMenu | null;
  paletteOpen: boolean;
  openDialog(pluginId: string, opts: DialogOptions): () => void;
  closeDialog(id: number): void;
  showMenu(menu: OpenMenu | null): void;
  setPaletteOpen(open: boolean): void;
  closeAllOf(pluginId: string): void;
}

let nextId = 1;

export const useOverlays = create<OverlayState>((set, get) => ({
  dialogs: [],
  menu: null,
  paletteOpen: false,
  openDialog(pluginId, opts) {
    const id = nextId++;
    set((s) => ({ dialogs: [...s.dialogs, { id, pluginId, opts }] }));
    return () => get().closeDialog(id);
  },
  closeDialog: (id) => set((s) => ({ dialogs: s.dialogs.filter((d) => d.id !== id) })),
  showMenu: (menu) => set({ menu }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  closeAllOf: (pluginId) =>
    set((s) => ({
      dialogs: s.dialogs.filter((d) => d.pluginId !== pluginId),
      menu: s.menu?.pluginId === pluginId ? null : s.menu,
    })),
}));
