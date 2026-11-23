import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginInfo } from '../api';

// a real ES module, served as a data: URL instead of /wz-plugins/
const MODULE = `
export default {
  async start(ctx) {
    ctx.registerSlot('sidebar.footer', () => ctx.React.createElement('p', null, 'hi from ' + ctx.pluginId));
    await ctx.storage.set('started', 'yes');
    return () => { globalThis.__stopped = (globalThis.__stopped ?? 0) + 1; };
  },
};`;
const BROKEN = `export default { start() { throw new Error('kaput'); } };`;

const store = new Map<string, string>();
const plugins: PluginInfo[] = [
  {
    id: 'good',
    name: 'Good',
    version: '1',
    description: '',
    author: '',
    main: 'index.js',
    enabled: true,
  },
  {
    id: 'bad',
    name: 'Bad',
    version: '1',
    description: '',
    author: '',
    main: 'index.js',
    enabled: true,
  },
  {
    id: 'off',
    name: 'Off',
    version: '1',
    description: '',
    author: '',
    main: 'index.js',
    enabled: false,
  },
];
let safe = false;

vi.mock('../api', () => ({
  backend: {
    on: () => () => {},
    plugins: {
      isSafeMode: async () => safe,
      list: async () => plugins,
      url: (id: string) =>
        'data:text/javascript,' + encodeURIComponent(id === 'bad' ? BROKEN : MODULE),
      storageSet: async (id: string, k: string, v: string) => void store.set(`${id}:${k}`, v),
    },
  },
}));

const { loadPlugins, isRunning, pluginError, stopPlugin } = await import('./loader');
const { getEntries, resetSlots } = await import('./slots');

describe('plugin loader', () => {
  beforeEach(() => {
    resetSlots();
    store.clear();
    safe = false;
  });

  it('starts enabled plugins, isolates a broken one, and stops cleanly', async () => {
    const stopAll = await loadPlugins();
    expect(isRunning('good')).toBe(true);
    expect(isRunning('off')).toBe(false);
    expect(isRunning('bad')).toBe(false);
    expect(pluginError('bad')).toBe('kaput');
    expect(getEntries('sidebar.footer').map((e) => e.pluginId)).toEqual(['good']);
    expect(store.get('good:started')).toBe('yes');

    stopPlugin('good');
    expect(getEntries('sidebar.footer')).toHaveLength(0);
    expect((globalThis as { __stopped?: number }).__stopped).toBe(1);
    stopAll();
  });

  it('loads nothing in safe mode', async () => {
    safe = true;
    await loadPlugins();
    expect(isRunning('good')).toBe(false);
    expect(getEntries('sidebar.footer')).toHaveLength(0);
  });
});
