import { backend, type PluginInfo } from '../api';
import { buildContext } from './context';
import { startSandboxed } from './sandbox/host';
import { setSchema } from './settings';
import type { PluginModule, Unregister } from './types';

// Plugins from <config>/plugins, loaded as ES modules from /wz-plugins/<id>/<main> (or into an
// isolated frame when the manifest says "sandbox"). They run with the permissions the user
// allowed, nothing loads until the user turns a plugin on, and nothing at all in safe mode.
// When a plugin's files change (wz-plugin dev), Go says so and the plugin restarts.

interface Running {
  stop: () => void;
}

const running = new Map<string, Running>();
const errors = new Map<string, string>();
const listeners = new Set<() => void>();
let appVersion = '';

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

function stopAll(offs: Unregister[]) {
  offs.splice(0).forEach((off) => {
    try {
      off();
    } catch {
      // one failing cleanup shouldn't keep the rest
    }
  });
}

export async function startPlugin(p: PluginInfo): Promise<void> {
  if (running.has(p.id) || p.error || p.needsApproval) return;
  errors.delete(p.id);
  setSchema(p.id, p.settings ?? []);
  const offs: Unregister[] = [];
  try {
    let stop: void | Unregister;
    if (p.sandbox) {
      stop = await startSandboxed(p, buildContext(p, offs, appVersion), offs);
    } else {
      // modules are cached by URL; a fresh one per start, so a restart after `wz-plugin dev`
      // rebuilt it loads the new code
      const url = backend.plugins.url(p.id, p.main);
      const fresh = url.startsWith('/') ? `${url}?v=${Date.now()}` : url;
      const mod = (await import(/* @vite-ignore */ fresh)) as {
        default?: Partial<PluginModule> | PluginModule['start'];
        start?: PluginModule['start'];
      };
      const start =
        typeof mod.default === 'function' ? mod.default : (mod.default?.start ?? mod.start);
      if (typeof start !== 'function') throw new Error('the module exports no start(ctx)');
      stop = await start(buildContext(p, offs, appVersion));
    }
    running.set(p.id, {
      stop: () => {
        try {
          if (typeof stop === 'function') stop();
        } catch (err) {
          console.error(`[plugin ${p.id}] stop failed`, err);
        }
        stopAll(offs);
      },
    });
  } catch (err) {
    stopAll(offs);
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

// a plugin's files changed: start it again with the new code, if it's meant to run
async function reload(id: string): Promise<void> {
  const list = await backend.plugins.list().catch(() => [] as PluginInfo[]);
  const p = list.find((x) => x.id === id);
  const wasRunning = running.has(id);
  if (wasRunning) {
    running.get(id)?.stop();
    running.delete(id);
  }
  errors.delete(id);
  if (p?.enabled) await startPlugin(p);
  if (wasRunning && p?.enabled && running.has(id)) console.info(`[plugin ${id}] reloaded`);
  changed();
}

// loadPlugins starts every enabled plugin; the returned function stops them all.
export async function loadPlugins(): Promise<() => void> {
  if (await backend.plugins.isSafeMode().catch(() => true)) return () => {};
  appVersion = await backend.system.version().catch(() => '');
  const list = await backend.plugins.list().catch(() => [] as PluginInfo[]);
  await Promise.all(list.filter((p) => p.enabled).map(startPlugin));
  const offReload = backend.on('wz:plugin:changed', ({ id }) => void reload(id));
  return () => {
    offReload();
    [...running.keys()].forEach(stopPlugin);
  };
}
