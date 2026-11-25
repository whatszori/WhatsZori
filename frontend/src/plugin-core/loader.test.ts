import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginInfo } from '../api';

// a real ES module, served as a data: URL instead of /wz-plugins/
const MODULE = `
export default {
  async start(ctx) {
    ctx.registerSlot('sidebar.footer', () => ctx.React.createElement('p', null, 'hi from ' + ctx.pluginId));
    ctx.commands.register({ id: 'hello', title: 'Say hello', shortcut: 'Ctrl+Alt+H', run() {} });
    await ctx.storage.set('started', 'yes');
    globalThis.__perms = ctx.permissions;
    return () => { globalThis.__stopped = (globalThis.__stopped ?? 0) + 1; };
  },
};`;
const BROKEN = `export default { start() { throw new Error('kaput'); } };`;
// asks for data it wasn't allowed
const NOSY = `export default { async start(ctx) { await ctx.data.contacts(); } };`;

const info = (id: string, p: Partial<PluginInfo> = {}): PluginInfo => ({
  id,
  name: id,
  version: '1.0.0',
  description: '',
  author: '',
  main: 'index.js',
  apiVersion: 2,
  sandbox: false,
  permissions: [],
  network: [],
  settings: [],
  signature: { state: 'unsigned' },
  enabled: true,
  needsApproval: false,
  newPermissions: [],
  newNetwork: [],
  keyChanged: false,
  ...p,
});

const store = new Map<string, string>();
let plugins: PluginInfo[] = [];
let safe = false;
const handlers = new Map<string, (p: unknown) => void>();

vi.mock('../api', () => ({
  backend: {
    on: (name: string, fn: (p: unknown) => void) => {
      handlers.set(name, fn);
      return () => handlers.delete(name);
    },
    system: { version: async () => '0.2.0' },
    contacts: { list: async () => [] },
    plugins: {
      isSafeMode: async () => safe,
      list: async () => plugins,
      url: (id: string) =>
        'data:text/javascript,' +
        encodeURIComponent(id === 'bad' ? BROKEN : id === 'nosy' ? NOSY : MODULE),
      storageSet: async (id: string, k: string, v: string) => void store.set(`${id}:${k}`, v),
    },
  },
}));

const { loadPlugins, isRunning, pluginError, stopPlugin } = await import('./loader');
const { getEntries, resetSlots } = await import('./slots');
const { commands } = await import('./registry');

describe('plugin loader', () => {
  beforeEach(() => {
    resetSlots();
    store.clear();
    safe = false;
    plugins = [
      info('good', { permissions: ['messages'] }),
      info('bad'),
      info('off', { enabled: false }),
      info('waiting', { needsApproval: true }),
      info('nosy'),
    ];
  });

  it('starts enabled plugins, isolates a broken one, and stops cleanly', async () => {
    const stopAll = await loadPlugins();
    expect(isRunning('good')).toBe(true);
    expect(isRunning('off')).toBe(false);
    expect(isRunning('bad')).toBe(false);
    expect(pluginError('bad')).toBe('kaput');
    expect(getEntries('sidebar.footer').map((e) => e.pluginId)).toEqual(['good']);
    expect(store.get('good:started')).toBe('yes');
    expect(commands.get('good:hello')?.value.title).toBe('Say hello');
    expect((globalThis as { __perms?: string[] }).__perms).toEqual(['messages']);

    stopPlugin('good');
    expect(getEntries('sidebar.footer')).toHaveLength(0);
    expect(commands.get('good:hello')).toBeUndefined();
    expect((globalThis as { __stopped?: number }).__stopped).toBe(1);
    stopAll();
  });

  it("doesn't start a plugin waiting for the user's OK, or hand out what wasn't allowed", async () => {
    const stopAll = await loadPlugins();
    expect(isRunning('waiting')).toBe(false);
    expect(isRunning('nosy')).toBe(false);
    expect(pluginError('nosy')).toMatch(/"contacts" permission/);
    stopAll();
  });

  it('restarts a running plugin when its files change', async () => {
    const stopAll = await loadPlugins();
    const before = (globalThis as { __stopped?: number }).__stopped ?? 0;
    handlers.get('wz:plugin:changed')?.({ id: 'good' });
    await vi.waitFor(() =>
      expect((globalThis as { __stopped?: number }).__stopped).toBe(before + 1),
    );
    await vi.waitFor(() => expect(isRunning('good')).toBe(true));
    stopAll();
  });

  it('loads nothing in safe mode', async () => {
    safe = true;
    await loadPlugins();
    expect(isRunning('good')).toBe(false);
    expect(getEntries('sidebar.footer')).toHaveLength(0);
  });
});
