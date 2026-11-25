/// <reference lib="webworker" />
// The worker a sandboxed plugin runs in. It has no DOM, and before the plugin's code loads every
// way to reach the network (or the app's own Go bindings, which are POSTs to this origin) is
// taken away: fetch, XMLHttpRequest, WebSocket, EventSource, nested workers and the rest. What's
// left is postMessage to the page, which only answers calls the plugin's permissions allow.
import { decode, encode, isHostFn, type FromWorker, type ToWorker } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = scope.postMessage.bind(scope) as (m: FromWorker) => void;
const createURL = URL.createObjectURL.bind(URL);

const BLOCKED = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebSocketStream',
  'EventSource',
  'WebTransport',
  'Worker',
  'SharedWorker',
  'importScripts',
  'caches',
  'indexedDB',
  'BroadcastChannel',
  'RTCPeerConnection',
  'webkitRTCPeerConnection',
  'navigator',
];

function lockDown() {
  for (const name of BLOCKED) {
    let o: object | null = scope;
    while (o) {
      if (Object.prototype.hasOwnProperty.call(o, name)) {
        try {
          Object.defineProperty(o, name, {
            get() {
              throw new Error(`${name} isn't available in a sandboxed plugin; use ctx.net.fetch`);
            },
            configurable: false,
          });
        } catch {
          // a property we can't redefine; delete it instead
          delete (o as Record<string, unknown>)[name];
        }
      }
      o = Object.getPrototypeOf(o);
    }
  }
}

// ---- functions across the boundary ----

let nextFn = 1;
let nextCall = 1;
const fns = new Map<number, { fn: (...a: unknown[]) => unknown; scope: string }>();
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const markerIn = (scopeName: string) => (fn: (...a: unknown[]) => unknown) => {
  const id = nextFn++;
  fns.set(id, { fn, scope: scopeName });
  return { __wfn: id };
};
const marker = markerIn('global');

function hostFn(m: object) {
  if (!isHostFn(m)) return null;
  return (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      const id = nextCall++;
      pending.set(id, { resolve, reject });
      post({ type: 'callHost', id, fn: m.__hfn, args: args.map((a) => encode(a, marker)) });
    });
}

function call(path: string, ...args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextCall++;
    pending.set(id, { resolve, reject });
    post({ type: 'call', id, path, args: args.map((a) => encode(a, marker)) });
  });
}

const fn =
  (path: string) =>
  (...args: unknown[]) =>
    call(path, ...args);

// ---- the ctx a sandboxed plugin gets: the same names, everything async ----

function buildContext(load: Extract<ToWorker, { type: 'load' }>) {
  const log =
    (level: 'info' | 'warn' | 'error') =>
    (...args: unknown[]) =>
      post({
        type: 'log',
        level,
        args: args.map((a) => (typeof a === 'object' ? JSON.parse(JSON.stringify(a ?? null)) : a)),
      });
  return {
    pluginId: load.pluginId,
    apiVersion: load.apiVersion,
    permissions: load.permissions,
    sandboxed: true,
    // draw every surface again (after your state changed)
    invalidate: () => post({ type: 'invalidate' }),
    ui: {
      openDialog: fn('ui.openDialog'),
      confirm: fn('ui.confirm'),
    },
    registerSlot: fn('registerSlot'),
    onEvent: fn('onEvent'),
    events: Object.fromEntries(
      [
        'onMessage',
        'onEdited',
        'onDeleted',
        'onChatOpened',
        'onTyping',
        'onPresence',
        'onThemeChanged',
      ].map((n) => [n, fn(`events.${n}`)]),
    ),
    commands: { register: fn('commands.register'), run: fn('commands.run') },
    panels: { register: fn('panels.register'), open: fn('panels.open'), close: fn('panels.close') },
    views: { register: fn('views.register'), open: fn('views.open'), close: fn('views.close') },
    actions: {
      openChat: fn('actions.openChat'),
      jumpTo: fn('actions.jumpTo'),
      toast: fn('actions.toast'),
      openSettings: fn('actions.openSettings'),
      insertIntoComposer: fn('actions.insertIntoComposer'),
    },
    composer: {
      get: fn('composer.get'),
      set: fn('composer.set'),
      insert: fn('composer.insert'),
      reply: fn('composer.reply'),
      addAttachment: fn('composer.addAttachment'),
    },
    chats: { pin: fn('chats.pin'), mute: fn('chats.mute'), archive: fn('chats.archive') },
    data: Object.fromEntries(
      [
        'chats',
        'activeChat',
        'messages',
        'messagePage',
        'search',
        'editHistory',
        'changes',
        'contacts',
        'chatInfo',
        'me',
        'mediaUrl',
        'avatarUrl',
      ].map((n) => [n, fn(`data.${n}`)]),
    ),
    app: { version: load.appVersion, theme: fn('app.theme'), layout: fn('app.layout') },
    notify: fn('notify'),
    clipboard: { writeText: fn('clipboard.writeText'), writeImage: fn('clipboard.writeImage') },
    files: { saveAs: fn('files.saveAs') },
    net: {
      fetch: async (url: string, init?: unknown) =>
        wrapResponse(await call('net.fetch', String(url), init)),
    },
    settings: {
      all: fn('settings.all'),
      get: fn('settings.get'),
      set: fn('settings.set'),
      delete: fn('settings.delete'),
      onChange: fn('settings.onChange'),
    },
    storage: {
      get: fn('storage.get'),
      set: fn('storage.set'),
      delete: fn('storage.delete'),
      keys: fn('storage.keys'),
    },
    log: { info: log('info'), warn: log('warn'), error: log('error') },
  };
}

// the page sends the response as plain data; give it fetch's methods back
function wrapResponse(r: unknown) {
  const res = r as {
    body: ArrayBuffer;
    status: number;
    statusText: string;
    url: string;
    headers: Record<string, string>;
  };
  const bytes = new Uint8Array(res.body);
  const text = () => new TextDecoder().decode(bytes);
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    statusText: res.statusText,
    url: res.url,
    headers: new Headers(res.headers),
    text: async () => text(),
    json: async () => JSON.parse(text()),
    arrayBuffer: async () => bytes.slice().buffer,
    blob: async () => new Blob([bytes], { type: res.headers['content-type'] ?? '' }),
  };
}

scope.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'load': {
      try {
        lockDown();
        const url = createURL(new Blob([m.code], { type: 'text/javascript' }));
        const mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
        const def = mod.default as { start?: unknown } | ((...a: unknown[]) => unknown) | undefined;
        const start = typeof def === 'function' ? def : (def?.start ?? mod.start);
        if (typeof start !== 'function') throw new Error('the module exports no start(ctx)');
        await (start as (ctx: unknown) => unknown)(buildContext(m));
        post({ type: 'started' });
      } catch (err) {
        post({ type: 'failed', error: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
    case 'result': {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (!p) break;
      if (m.ok) p.resolve(decode(m.value, hostFn));
      else p.reject(new Error(m.error));
      break;
    }
    case 'invoke': {
      const f = fns.get(m.fn);
      if (!f) {
        post({ type: 'invokeResult', id: m.id, ok: false, error: 'gone' });
        break;
      }
      // callbacks returned from a render belong to that render and replace the previous one's
      const sc = m.scope ?? 'global';
      try {
        const out = await f.fn(...(decode(m.args, hostFn) as unknown[]));
        if (m.scope) for (const [id, x] of fns) if (x.scope === m.scope) fns.delete(id);
        post({ type: 'invokeResult', id: m.id, ok: true, value: encode(out, markerIn(sc)) });
      } catch (err) {
        post({
          type: 'invokeResult',
          id: m.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }
    case 'dispose':
      for (const [id, x] of fns) if (x.scope === m.scope) fns.delete(id);
      break;
  }
};
