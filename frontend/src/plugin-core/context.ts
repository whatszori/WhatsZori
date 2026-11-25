import * as React from 'react';
import { backend, type PluginInfo } from '../api';
import { toPluginChat, toPluginMessage } from '../features/conversation/plugin-adapters';
import { useAttach } from '../stores/attach';
import { useChats } from '../stores/chats';
import { useConnection } from '../stores/connection';
import { useProfile } from '../stores/profile';
import { useSettings } from '../stores/settings';
import { useToasts } from '../stores/toasts';
import { composerFor, useUI } from '../stores/ui';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  IconButton,
  Input,
  MenuItem,
  Popover,
  Segmented,
  Spinner,
  Toggle,
  Tooltip,
} from '../ui';
import { pluginFetch, toBase64 } from './net';
import { useOverlays } from './overlays';
import { commands, editorTools, formatters, panels, usePluginUI, views } from './registry';
import { checkPluginShortcut, parseShortcut } from './shortcuts';
import { deleteSetting, getSetting, onSettingChange, setSetting } from './settings';
import { register } from './slots';
import {
  API_VERSION,
  type Permission,
  type PluginContext,
  type PluginEvents,
  type PluginTheme,
  type Unregister,
} from './types';

export class PermissionError extends Error {
  constructor(perm: Permission) {
    super(`this needs the "${perm}" permission in the plugin's manifest`);
    this.name = 'PermissionError';
  }
}

// raw backend events that carry message content or presence need the matching permission
const EVENT_PERMISSION: Record<string, Permission> = {
  'msg:batch': 'messages',
  'msg:status': 'messages',
  'msg:edited': 'messages',
  'msg:deleted': 'messages',
  'msg:reaction': 'messages',
  'msg:removed': 'messages',
  'notification:open': 'messages',
  presence: 'presence',
  'chat:typing': 'presence',
};

export function currentTheme(): PluginTheme {
  const root = document.documentElement;
  return {
    scheme: root.dataset.theme === 'dark' ? 'dark' : 'light',
    accent: getComputedStyle(root).getPropertyValue('--wz-accent').trim(),
  };
}

// one observer for every plugin listening to theme changes
const themeListeners = new Set<(t: PluginTheme) => void>();
let themeObserver: MutationObserver | null = null;
let lastTheme = '';
function watchTheme(fn: (t: PluginTheme) => void): Unregister {
  themeListeners.add(fn);
  if (!themeObserver) {
    lastTheme = JSON.stringify(currentTheme());
    let queued = false;
    themeObserver = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const t = currentTheme();
        const s = JSON.stringify(t);
        if (s === lastTheme) return;
        lastTheme = s;
        themeListeners.forEach((l) => l(t));
      });
    });
    themeObserver.observe(document.documentElement, { attributes: true });
    themeObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  }
  return () => {
    themeListeners.delete(fn);
    if (themeListeners.size === 0) {
      themeObserver?.disconnect();
      themeObserver = null;
    }
  };
}

function toRect(at: Element | DOMRect | { x: number; y: number }): DOMRect {
  if (at instanceof Element) return at.getBoundingClientRect();
  if (at instanceof DOMRect) return at;
  return new DOMRect(at.x, at.y, 0, 0);
}

export function buildContext(
  info: PluginInfo,
  offs: Unregister[],
  appVersion: string,
): PluginContext {
  const id = info.id;
  const tag = `[plugin ${id}]`;
  const perms = new Set(info.permissions as Permission[]);
  const track = (off: Unregister): Unregister => {
    offs.push(off);
    return off;
  };
  const need = (perm: Permission) => {
    if (!perms.has(perm)) throw new PermissionError(perm);
  };
  const needAsync = async (perm: Permission) => need(perm);
  const safe =
    <A extends unknown[]>(what: string, fn: (...a: A) => void) =>
    (...a: A) => {
      try {
        fn(...a);
      } catch (err) {
        console.error(tag, what, 'failed', err);
      }
    };
  const userClicked = () => {
    const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (ua && !ua.isActive)
      throw new Error('this only works right after the user clicks something');
  };
  const activeComposer = () => {
    need('composer');
    const ui = useUI.getState();
    return ui.activeChat
      ? { ui, jid: ui.activeChat, draft: composerFor(ui, ui.activeChat).draft }
      : null;
  };

  const events: PluginEvents = {
    onMessage(fn, opts) {
      need('messages');
      const since = Date.now() - 2 * 60_000;
      const seen = new Set<string>();
      const handler = safe('onMessage', fn);
      return track(
        backend.on('msg:batch', ({ messages }) => {
          for (const m of messages) {
            if (seen.has(m.pk) || (!opts?.history && m.timestamp < since)) continue;
            seen.add(m.pk);
            if (seen.size > 5000) seen.clear();
            handler(toPluginMessage(m));
          }
        }),
      );
    },
    onEdited(fn) {
      need('messages');
      const h = safe('onEdited', fn);
      return track(
        backend.on('msg:edited', (e) =>
          h({ chatJid: e.chatJid, pk: e.pk, text: e.text, editedAt: e.editedAt }),
        ),
      );
    },
    onDeleted(fn) {
      need('messages');
      const h = safe('onDeleted', fn);
      return track(
        backend.on('msg:deleted', (e) =>
          h({ chatJid: e.chatJid, pk: e.pk, byName: e.deleted.byName, at: e.deleted.at }),
        ),
      );
    },
    onChatOpened(fn) {
      const h = safe('onChatOpened', fn);
      return track(
        useUI.subscribe((s, prev) => s.activeChat !== prev.activeChat && h(s.activeChat)),
      );
    },
    onTyping(fn) {
      need('presence');
      const h = safe('onTyping', fn);
      return track(backend.on('chat:typing', (e) => h({ ...e })));
    },
    onPresence(fn) {
      need('presence');
      const h = safe('onPresence', fn);
      return track(backend.on('presence', (e) => h({ ...e })));
    },
    onThemeChanged(fn) {
      return track(watchTheme(safe('onThemeChanged', fn)));
    },
  };

  const ctx: PluginContext = {
    pluginId: id,
    apiVersion: API_VERSION,
    permissions: [...perms],
    React,
    ui: {
      Button,
      IconButton,
      Input,
      MenuItem,
      Toggle,
      Avatar,
      Badge,
      Spinner,
      Segmented,
      Tooltip,
      Dialog,
      Popover,
      addStyles(css) {
        const el = document.createElement('style');
        el.dataset.plugin = id;
        el.textContent = String(css);
        document.head.appendChild(el);
        return track(() => el.remove());
      },
      openDialog(opts) {
        const close = track(useOverlays.getState().openDialog(id, opts));
        return { close };
      },
      confirm(opts) {
        return new Promise<boolean>((resolve) => {
          let answered = false;
          const answer = (v: boolean, close: () => void) => {
            if (!answered) resolve(v);
            answered = true;
            close();
          };
          const h = React.createElement;
          const close = useOverlays.getState().openDialog(id, {
            title: opts.title,
            width: 400,
            render: () => h('p', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, opts.message),
            footer: ({ close }) =>
              h(
                React.Fragment,
                null,
                h(Button, { variant: 'ghost', onClick: () => answer(false, close) }, 'Cancel'),
                h(
                  Button,
                  {
                    variant: opts.danger ? 'danger' : 'primary',
                    autoFocus: true,
                    onClick: () => answer(true, close),
                  },
                  opts.confirmLabel ?? 'OK',
                ),
              ),
          });
          // closed with Esc or the X: that's a no
          const dialogId = useOverlays.getState().dialogs.at(-1)?.id;
          const off = useOverlays.subscribe((s) => {
            if (!s.dialogs.some((d) => d.id === dialogId)) {
              if (!answered) resolve(false);
              answered = true;
              off();
            }
          });
          track(close);
        });
      },
      showMenu(at, items) {
        useOverlays.getState().showMenu({ pluginId: id, at: toRect(at), items });
      },
    },
    registerSlot: (name, component) => track(register(name, id, component)),
    onEvent(event, handler) {
      const perm = EVENT_PERMISSION[event];
      if (perm) need(perm);
      const h = safe(`event ${event}`, handler);
      return track(backend.on(event as never, (payload: unknown) => h(payload)));
    },
    events,
    commands: {
      register(cmd) {
        if (!cmd?.id || !cmd.title || typeof cmd.run !== 'function')
          throw new Error('a command needs id, title and run');
        if (cmd.shortcut) checkPluginShortcut(parseShortcut(cmd.shortcut));
        return track(commands.add(id, cmd.id, cmd));
      },
      async run(cmdId) {
        const e = commands.get(cmdId.includes(':') ? cmdId : `${id}:${cmdId}`);
        if (!e) throw new Error(`no command "${cmdId}"`);
        await e.value.run();
      },
    },
    panels: {
      register(panel) {
        if (!panel?.id || typeof panel.render !== 'function')
          throw new Error('a panel needs id and render');
        return track(panels.add(id, panel.id, panel));
      },
      open(panelId) {
        const key = `${id}:${panelId}`;
        if (!panels.get(key)) throw new Error(`no panel "${panelId}"`);
        useUI.getState().setChatInfoOpen(false);
        usePluginUI.getState().setPanel(key);
      },
      close() {
        if (usePluginUI.getState().panel?.startsWith(`${id}:`))
          usePluginUI.getState().setPanel(null);
      },
    },
    views: {
      register(view) {
        if (!view?.id || typeof view.render !== 'function')
          throw new Error('a view needs id and render');
        return track(views.add(id, view.id, view));
      },
      open(viewId) {
        const key = `${id}:${viewId}`;
        if (!views.get(key)) throw new Error(`no view "${viewId}"`);
        openPluginView(key);
      },
      close() {
        if (usePluginUI.getState().view?.startsWith(`${id}:`)) closePluginView();
      },
    },
    messages: {
      registerFormatter: (fn) => track(formatters.add(id, `f${offs.length}`, fn)),
    },
    editor: {
      registerTool(tool) {
        if (!tool?.id || typeof tool.apply !== 'function')
          throw new Error('a tool needs id and apply');
        return track(editorTools.add(id, tool.id, tool));
      },
    },
    actions: {
      openChat: (jid) => void useChats.getState().openWith(jid),
      jumpTo(jid, pk) {
        useUI.getState().openChat(jid);
        useUI.getState().jumpTo(jid, pk);
      },
      toast: (text) => useToasts.getState().push({ kind: 'info', text: String(text) }),
      openSettings: () => useUI.getState().openSettings('plugins'),
      insertIntoComposer(text) {
        const c = activeComposer();
        if (!c) return;
        c.ui.setDraft(
          c.jid,
          c.draft ? `${c.draft}${c.draft.endsWith(' ') ? '' : ' '}${text}` : String(text),
        );
      },
    },
    composer: {
      get() {
        const c = activeComposer();
        return c && { chatJid: c.jid, text: c.draft };
      },
      set(text) {
        const c = activeComposer();
        if (c) c.ui.setDraft(c.jid, String(text));
      },
      insert(text) {
        ctx.actions.insertIntoComposer(text);
      },
      reply(pk) {
        const c = activeComposer();
        if (c) c.ui.startReply(c.jid, pk);
      },
      async addAttachment(file, name) {
        const c = activeComposer();
        if (!c) throw new Error('no chat is open');
        const fileName = name ?? (file instanceof File ? file.name : 'file');
        const f =
          file instanceof File && !name ? file : new File([file], fileName, { type: file.type });
        await useAttach.getState().addFiles(c.jid, [f]);
      },
    },
    chats: {
      async pin(jid, on) {
        need('chats.manage');
        userClicked();
        await backend.chats.setPinned(jid, on);
      },
      async mute(jid, on) {
        need('chats.manage');
        userClicked();
        await backend.chats.setMuted(jid, on);
      },
      async archive(jid, on) {
        need('chats.manage');
        userClicked();
        await backend.chats.setArchived(jid, on);
      },
    },
    data: {
      chats: () => Object.values(useChats.getState().chats).map(toPluginChat),
      activeChat: () => useUI.getState().activeChat,
      async messages(jid, opts) {
        const o = typeof opts === 'number' ? { limit: opts } : (opts ?? {});
        return (await ctx.data.messagePage(jid, o)).messages;
      },
      async messagePage(jid, opts = {}) {
        await needAsync('messages');
        const page = await backend.messages.getMessages(
          jid,
          opts.before ?? null,
          Math.max(1, Math.min(opts.limit ?? 50, 200)),
        );
        return { messages: page.messages.map(toPluginMessage), hasMore: page.hasMore };
      },
      async search(query, opts) {
        await needAsync('messages');
        const hits = await backend.messages.search(query, opts?.jid);
        return hits.map((h) => ({
          chatJid: h.chatJid,
          chatName: h.chatName,
          message: toPluginMessage(h.message),
        }));
      },
      async editHistory(pk) {
        await needAsync('messages');
        return (await backend.messages.getEditHistory(pk)).map((v) => ({ text: v.text, at: v.at }));
      },
      async changes(opts = {}) {
        await needAsync('messages');
        const page = await backend.messages.changes(
          opts.kind ?? '',
          opts.before ?? null,
          Math.max(1, Math.min(opts.limit ?? 50, 200)),
        );
        return {
          items: page.items.map((c) => ({
            chatJid: c.chatJid,
            chatName: c.chatName,
            change: c.change,
            at: c.at,
            message: toPluginMessage(c.message),
          })),
          hasMore: page.hasMore,
        };
      },
      async contacts() {
        await needAsync('contacts');
        return (await backend.contacts.list()).map((c) => ({
          jid: c.jid,
          name: c.name,
          phone: c.phone,
        }));
      },
      async chatInfo(jid) {
        await needAsync('contacts');
        const i = await backend.chats.getInfo(jid);
        return {
          jid: i.jid,
          name: i.name,
          about: i.about,
          phone: i.phone,
          createdAt: i.createdAt,
          members: i.members?.map((m) => ({ jid: m.jid, name: m.name, admin: m.isAdmin })),
        };
      },
      me() {
        need('contacts');
        const p = useProfile.getState().profile;
        return {
          jid: useConnection.getState().auth.me?.jid ?? null,
          name: p.name,
          phone: p.phone,
          about: p.about,
        };
      },
      mediaUrl(pk, thumb) {
        need('media');
        return backend.media.url(pk, thumb);
      },
      avatarUrl(jid, full) {
        need('media');
        return backend.media.avatarUrl(jid, full);
      },
    },
    app: {
      version: appVersion,
      theme: currentTheme,
      layout: () =>
        useSettings.getState().settings.appearance.layout === 'rail' ? 'rail' : 'classic',
    },
    async notify(title, body) {
      need('notifications');
      await backend.plugins.notify(id, String(title), String(body));
    },
    clipboard: {
      async writeText(text) {
        need('clipboard');
        await navigator.clipboard.writeText(String(text));
      },
      async writeImage(png) {
        need('clipboard');
        await navigator.clipboard.write([new ClipboardItem({ [png.type || 'image/png']: png })]);
      },
    },
    files: {
      async saveAs(file, name) {
        need('files');
        const up = await backend.messages.uploadAttachment(file, name);
        return backend.plugins.saveFile(id, up.token, name);
      },
    },
    net: {
      async fetch(url, init) {
        need('network');
        return pluginFetch(id, url, init);
      },
    },
    settings: {
      all: () => backend.plugins.settings(id),
      get: (key) => getSetting(id, key) as never,
      set: (key, value) => setSetting(id, key, value),
      delete: (key) => deleteSetting(id, key),
      onChange: (fn) => track(onSettingChange(id, safe('settings.onChange', fn))),
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
  track(() => useOverlays.getState().closeAllOf(id));
  return ctx;
}

export function openPluginView(key: string): void {
  usePluginUI.getState().setView(key);
  useUI.setState({ view: 'plugin' });
}

export function closePluginView(): void {
  usePluginUI.getState().setView(null);
  if (useUI.getState().view === 'plugin') useUI.setState({ view: 'chats' });
}

export { toBase64 };
