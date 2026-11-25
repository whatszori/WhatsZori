import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { useUI } from '../stores/ui';
import type { Command, EditorTool, Panel, TextFormatter, Unregister, View } from './types';

// What plugins add besides slots: commands, panels, views, text formatters and editor tools.
// Each registry keeps entries in registration order and hands out a new array on every change,
// so React components can read it with useSyncExternalStore.

export interface Entry<T> {
  pluginId: string;
  // "<pluginId>:<id>", unique across plugins
  key: string;
  value: T;
}

export interface Registry<T> {
  add(pluginId: string, id: string, value: T): Unregister;
  list(): readonly Entry<T>[];
  get(key: string): Entry<T> | undefined;
  subscribe(fn: () => void): () => void;
  clear(): void;
}

export function createRegistry<T>(): Registry<T> {
  let items: Entry<T>[] = [];
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((fn) => fn());
  return {
    add(pluginId, id, value) {
      const key = `${pluginId}:${id}`;
      if (items.some((e) => e.key === key)) throw new Error(`"${id}" is already registered`);
      const entry = { pluginId, key, value };
      items = [...items, entry];
      notify();
      return () => {
        if (!items.includes(entry)) return;
        items = items.filter((e) => e !== entry);
        notify();
      };
    },
    list: () => items,
    get: (key) => items.find((e) => e.key === key),
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    clear() {
      items = [];
      notify();
    },
  };
}

export function useRegistry<T>(r: Registry<T>): readonly Entry<T>[] {
  return useSyncExternalStore(r.subscribe, r.list);
}

export const commands = createRegistry<Command>();
export const panels = createRegistry<Panel>();
export const views = createRegistry<View>();
export const formatters = createRegistry<TextFormatter>();
export const editorTools = createRegistry<EditorTool>();

// which plugin panel / view is open, by key
interface PluginUIState {
  panel: string | null;
  view: string | null;
  // per chat: a panel stays open while switching chats, like Info
  setPanel(key: string | null): void;
  setView(key: string | null): void;
}

export const usePluginUI = create<PluginUIState>((set) => ({
  panel: null,
  view: null,
  setPanel: (panel) => set({ panel }),
  setView: (view) => set({ view }),
}));

// panels and views of a plugin that stops close with it
panels.subscribe(() => {
  const { panel, setPanel } = usePluginUI.getState();
  if (panel && !panels.get(panel)) setPanel(null);
});
views.subscribe(() => {
  const { view, setView } = usePluginUI.getState();
  if (view && !views.get(view)) setView(null);
});

// Info and a plugin panel share the spot next to the conversation
useUI.subscribe((s, prev) => {
  if (s.chatInfoOpen && !prev.chatInfoOpen) usePluginUI.getState().setPanel(null);
});
