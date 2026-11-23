import * as React from 'react';
import { backend, type PluginInfo } from '../api';
import { toPluginChat, toPluginMessage } from '../features/conversation/plugin-adapters';
import { useChats } from '../stores/chats';
import { useToasts } from '../stores/toasts';
import { composerFor, useUI } from '../stores/ui';
import { Button, IconButton, Input, MenuItem, Toggle } from '../ui';
import { register } from './slots';
import type { PluginContext, PluginModule, Unregister } from './types';

// Plugins from <config>/plugins, loaded as ES modules from /wz-plugins/<id>/<main>. They run in
// the page with the same rights as the app's own code, so nothing loads until the user turns a
// plugin on, and nothing at all in safe mode.

interface Running {
  stop: () => void;
}

const running = new Map<string, Running>();
const errors = new Map<string, string>();
const listeners = new Set<() => void>();

export function pluginError(id: string): string | undefined {
  return errors.get(id);
}

export function isRunning(id: string): boolean {
  return running.has(id);
}

export function onPluginsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  listeners.forEach((fn) => fn());
}

function context(id: string, offs: Unregister[]): PluginContext {
  const track = (off: Unregister): Unregister => {
    offs.push(off);
    return off;
  };
  const tag = `[plugin ${id}]`;
  return {
    pluginId: id,
    React,
    ui: { Button, IconButton, Input, MenuItem, Toggle },
    registerSlot: (name, component) => track(register(name, id, component)),
    onEvent: (event, handler) =>
      track(
        backend.on(event as never, (payload: unknown) => {
          try {
            handler(payload);
          } catch (err) {
            console.error(tag, 'event handler failed', err);
          }
        }),
      ),
    actions: {
      openChat: (jid) => void useChats.getState().openWith(jid),
      insertIntoComposer: (text) => {
        const ui = useUI.getState();
        const jid = ui.activeChat;
        if (!jid) return;
        const draft = composerFor(ui, jid).draft;
        ui.setDraft(jid, draft ? `${draft}${draft.endsWith(' ') ? '' : ' '}${text}` : text);
      },
      toast: (text) => useToasts.getState().push({ kind: 'info', text: String(text) }),
    },
    data: {
      chats: () => Object.values(useChats.getState().chats).map(toPluginChat),
      activeChat: () => useUI.getState().activeChat,
      messages: async (jid, limit = 50) => {
        const page = await backend.messages.getMessages(jid, null, Math.min(limit, 200));
        return page.messages.map(toPluginMessage);
      },
    },
    settings: {
      all: () => backend.plugins.settings(id),
      set: (key, value) => backend.plugins.setSetting(id, key, value),
      delete: (key) => backend.plugins.deleteSetting(id, key),
    },
    storage: {
      get: (key) => backend.plugins.storageGet(id, key),
      set: (key, value) => backend.plugins.storageSet(id, key, value),
      delete: (key) => backend.plugins.storageDelete(id, key),
      keys: () => backend.plugins.storageKeys(id),
    },
    log: {
      info: (...a) => console.info(tag, ...a),
      warn: (...a) => console.warn(tag, ...a),
      error: (...a) => console.error(tag, ...a),
    },
  };
}

export async function startPlugin(p: PluginInfo): Promise<void> {
  if (running.has(p.id)) return;
  errors.delete(p.id);
  const offs: Unregister[] = [];
  try {
    const mod = (await import(/* @vite-ignore */ backend.plugins.url(p.id, p.main))) as {
      default?: Partial<PluginModule> | PluginModule['start'];
      start?: PluginModule['start'];
    };
    const start =
      typeof mod.default === 'function' ? mod.default : (mod.default?.start ?? mod.start);
    if (typeof start !== 'function') throw new Error('the module exports no start(ctx)');
    const stop = await start(context(p.id, offs));
    running.set(p.id, {
      stop: () => {
        try {
          if (typeof stop === 'function') stop();
        } catch (err) {
          console.error(`[plugin ${p.id}] stop failed`, err);
        }
        offs.splice(0).forEach((off) => off());
      },
    });
  } catch (err) {
    offs.splice(0).forEach((off) => off());
    errors.set(p.id, err instanceof Error ? err.message : String(err));
    console.error(`[plugin ${p.id}] failed to start`, err);
  }
  changed();
}

export function stopPlugin(id: string): void {
  running.get(id)?.stop();
  running.delete(id);
  errors.delete(id);
  changed();
}

// loadPlugins starts every enabled plugin; the returned function stops them all.
export async function loadPlugins(): Promise<() => void> {
  if (await backend.plugins.isSafeMode().catch(() => true)) return () => {};
  const list = await backend.plugins.list().catch(() => [] as PluginInfo[]);
  await Promise.all(list.filter((p) => p.enabled && !p.error).map(startPlugin));
  return () => [...running.keys()].forEach(stopPlugin);
}
