import {
  createElement,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from 'react';
import { backend, type PluginInfo } from '../../api';
import type { PluginContext, PluginResponse, Unregister } from '../types';
import {
  decode,
  encode,
  isWorkerFn,
  type FromWorker,
  type ToWorker,
  type UINode,
} from './protocol';
import { SandboxTree } from './render';
import SandboxWorker from './worker.ts?worker&inline';

// Runs a plugin whose manifest says "sandbox": true. Its code goes into a worker that has no DOM
// and no network (see worker.ts); every ctx call comes here as a message and goes through the same
// permission-checked ctx in-page plugins get. Its UI is data (UINode trees) that render.tsx draws
// with the app's components, so it can't add scripts, styles or pictures from the internet.

// what a sandboxed plugin may call; anything else is refused
const CALLS = new Set([
  'ui.openDialog',
  'ui.confirm',
  'registerSlot',
  'onEvent',
  'events.onMessage',
  'events.onEdited',
  'events.onDeleted',
  'events.onChatOpened',
  'events.onTyping',
  'events.onPresence',
  'events.onThemeChanged',
  'commands.register',
  'commands.run',
  'panels.register',
  'panels.open',
  'panels.close',
  'views.register',
  'views.open',
  'views.close',
  'actions.openChat',
  'actions.jumpTo',
  'actions.toast',
  'actions.openSettings',
  'actions.insertIntoComposer',
  'composer.get',
  'composer.set',
  'composer.insert',
  'composer.reply',
  'composer.addAttachment',
  'chats.pin',
  'chats.mute',
  'chats.archive',
  'data.chats',
  'data.activeChat',
  'data.messages',
  'data.messagePage',
  'data.search',
  'data.editHistory',
  'data.changes',
  'data.contacts',
  'data.chatInfo',
  'data.me',
  'data.mediaUrl',
  'data.avatarUrl',
  'app.theme',
  'app.layout',
  'notify',
  'clipboard.writeText',
  'clipboard.writeImage',
  'files.saveAs',
  'net.fetch',
  'settings.all',
  'settings.get',
  'settings.set',
  'settings.delete',
  'settings.onChange',
  'storage.get',
  'storage.set',
  'storage.delete',
  'storage.keys',
]);

const START_TIMEOUT = 15_000;
let nextSurface = 1;

export async function startSandboxed(
  info: PluginInfo,
  ctx: PluginContext,
  offs: Unregister[],
): Promise<void> {
  const tag = `[plugin ${info.id}]`;
  const url = backend.plugins.url(info.id, info.main);
  const code = await (await fetch(url.startsWith('/') ? `${url}?v=${Date.now()}` : url)).text();
  // inline: the worker starts from a blob: URL, so it inherits the page's Content-Security-Policy
  // and can't import() code from the internet either
  const worker = new SandboxWorker({ name: `plugin ${info.id}` });
  offs.push(() => worker.terminate());
  const send = (m: ToWorker) => worker.postMessage(m);

  // page functions the worker holds, by number, grouped by the surface that made them
  let nextFn = 1;
  const hostFns = new Map<number, { fn: (...a: unknown[]) => unknown; scope: string }>();
  const markerIn = (scope: string) => (fn: (...a: unknown[]) => unknown) => {
    const id = nextFn++;
    hostFns.set(id, { fn, scope });
    return { __hfn: id };
  };
  const dropScope = (scope: string) => {
    for (const [id, x] of hostFns) if (x.scope === scope) hostFns.delete(id);
  };

  let nextInvoke = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const invoke = (fn: number, args: unknown[], scope?: string, hostScope = 'global') =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextInvoke++;
      pending.set(id, { resolve, reject });
      send({
        type: 'invoke',
        id,
        fn,
        args: args.map((a) => encode(a, markerIn(hostScope))),
        scope,
      });
    });
  const workerFn = (m: object) =>
    isWorkerFn(m) ? (...args: unknown[]) => invoke(m.__wfn, args) : null;

  // "draw again": every surface of this plugin asks for a new tree
  let version = 0;
  const subs = new Set<() => void>();
  const invalidate = () => {
    version++;
    subs.forEach((s) => s());
  };

  // a worker render function as a React component
  const surface = (fnId: number, label: string): ComponentType<Record<string, unknown>> =>
    function SandboxSurface(props) {
      const v = useSyncExternalStore(
        (cb) => {
          subs.add(cb);
          return () => subs.delete(cb);
        },
        () => version,
      );
      const scope = useMemo(() => `${info.id}#${nextSurface++}`, []);
      const [tree, setTree] = useState<UINode>(null);
      // functions in props (close, insertText) change identity on every render; the data decides
      const key = JSON.stringify(props, (_k, x) => (typeof x === 'function' ? undefined : x));
      useEffect(() => {
        let gone = false;
        dropScope(scope);
        invoke(fnId, [props], scope, scope)
          .then((t) => !gone && setTree(decode(t, workerFn) as UINode))
          .catch((err) => console.error(tag, label, 'failed to render', err));
        return () => {
          gone = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- key stands for props
      }, [key, v, scope]);
      useEffect(
        () => () => {
          dropScope(scope);
          send({ type: 'dispose', scope });
        },
        [scope],
      );
      return createElement(SandboxTree, { node: tree, info });
    };

  const asSurface = (f: unknown, label: string) => {
    if (typeof f !== 'object' || !isWorkerFn(f)) throw new Error(`${label} must be a function`);
    return surface(f.__wfn, label);
  };

  // ctx.<path>(...args), with render functions turned into components first
  const run = async (path: string, rawArgs: unknown[]): Promise<unknown> => {
    if (!CALLS.has(path)) throw new Error(`${path} isn't available to sandboxed plugins`);
    let args: unknown[];
    switch (path) {
      case 'registerSlot':
        args = [rawArgs[0], asSurface(rawArgs[1], `slot ${String(rawArgs[0])}`)];
        break;
      case 'panels.register':
      case 'views.register': {
        const o = rawArgs[0] as Record<string, unknown>;
        args = [
          {
            ...(decode(o, workerFn) as object),
            icon: o.icon == null ? undefined : String(o.icon),
            render: asSurface(o.render, path),
          },
        ];
        break;
      }
      case 'ui.openDialog': {
        const o = rawArgs[0] as Record<string, unknown>;
        args = [
          {
            title: String(o.title ?? ''),
            width: typeof o.width === 'number' ? o.width : undefined,
            render: asSurface(o.render, 'dialog'),
            footer: o.footer ? asSurface(o.footer, 'dialog footer') : undefined,
          },
        ];
        break;
      }
      case 'commands.register': {
        // when() would cross into the worker on every key typed in the palette; not for sandboxes
        const o = { ...(decode(rawArgs[0], workerFn) as Record<string, unknown>) };
        delete o.when;
        args = [o];
        break;
      }
      default:
        args = decode(rawArgs, workerFn) as unknown[];
    }
    const parts = path.split('.');
    let owner: Record<string, unknown> = ctx as unknown as Record<string, unknown>;
    for (const p of parts.slice(0, -1)) owner = owner[p] as Record<string, unknown>;
    const f = owner[parts[parts.length - 1]] as (...a: unknown[]) => unknown;
    const out = await f.apply(owner, args);
    if (path === 'net.fetch') {
      const r = out as PluginResponse;
      const headers: Record<string, string> = {};
      r.headers.forEach((v, k) => (headers[k] = v));
      return {
        status: r.status,
        statusText: r.statusText,
        url: r.url,
        headers,
        body: await r.arrayBuffer(),
      };
    }
    return out;
  };

  const started = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('it took too long to start')), START_TIMEOUT);
    worker.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error(e.message || 'the sandbox failed to load'));
    };
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      switch (m.type) {
        case 'started':
          clearTimeout(timer);
          resolve();
          break;
        case 'failed':
          clearTimeout(timer);
          reject(new Error(m.error));
          break;
        case 'call':
          run(m.path, m.args).then(
            (value) =>
              send({
                type: 'result',
                id: m.id,
                ok: true,
                value: encode(value, markerIn('global')),
              }),
            (err) =>
              send({
                type: 'result',
                id: m.id,
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              }),
          );
          break;
        case 'callHost': {
          const h = hostFns.get(m.fn);
          Promise.resolve()
            .then(() => {
              if (!h) throw new Error('that function is gone');
              return h.fn(...(decode(m.args, workerFn) as unknown[]));
            })
            .then(
              (value) =>
                send({
                  type: 'result',
                  id: m.id,
                  ok: true,
                  value: encode(value, markerIn('global')),
                }),
              (err) =>
                send({
                  type: 'result',
                  id: m.id,
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                }),
            );
          break;
        }
        case 'invokeResult': {
          const p = pending.get(m.id);
          pending.delete(m.id);
          if (m.ok) p?.resolve(m.value);
          else p?.reject(new Error(m.error));
          break;
        }
        case 'invalidate':
          invalidate();
          break;
        case 'log':
          console[m.level](tag, ...m.args);
          break;
      }
    };
  });
  offs.push(() => {
    pending.forEach((p) => p.reject(new Error('the plugin stopped')));
    pending.clear();
    hostFns.clear();
    subs.clear();
  });

  send({
    type: 'load',
    code,
    pluginId: info.id,
    permissions: [...ctx.permissions],
    apiVersion: ctx.apiVersion,
    appVersion: ctx.app.version,
  });
  await started;
}
