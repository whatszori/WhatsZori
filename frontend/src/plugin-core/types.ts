// Plugin-facing contract. Keep this file free of app imports; the SDK (@whatszori/plugin-sdk,
// src/types.ts) mirrors it and has to follow every change.
import type { ComponentType, ReactNode } from 'react';
import type * as ReactNS from 'react';

// the plugin API this build provides; manifests ask for one with "apiVersion"
export const API_VERSION = 2;

export type Permission =
  | 'messages'
  | 'contacts'
  | 'media'
  | 'composer'
  | 'notifications'
  | 'clipboard'
  | 'files'
  | 'chats.manage'
  | 'presence'
  | 'network';

export interface PluginChat {
  jid: string;
  name: string;
  isGroup: boolean;
  muted: boolean;
  pinned: boolean;
  archived: boolean;
  unread: number;
}

export interface PluginMedia {
  mime?: string;
  fileName?: string;
  size?: number;
  width?: number;
  height?: number;
  // seconds (voice, video)
  duration?: number;
  caption?: string;
}

export interface PluginMessage {
  pk: string;
  chatJid: string;
  senderJid: string;
  senderName: string;
  fromMe: boolean;
  timestamp: number;
  // text, image, video, document, voice, sticker, poll
  kind: string;
  text: string;
  editedAt?: number;
  deleted?: { byName: string; at: number };
  replyTo?: { pk: string; senderName: string; text: string };
  forwarded?: boolean;
  media?: PluginMedia;
}

export interface PluginContact {
  jid: string;
  name: string;
  phone: string;
}

export interface PluginMember {
  jid: string;
  name: string;
  admin: boolean;
}

export interface PluginChatInfo {
  jid: string;
  name: string;
  about: string;
  phone?: string;
  members?: PluginMember[];
  createdAt?: number;
}

export interface PluginMe {
  jid: string | null;
  name: string;
  phone: string;
  about: string;
}

export interface PluginSearchHit {
  chatJid: string;
  chatName: string;
  message: PluginMessage;
}

export interface PluginChange {
  chatJid: string;
  chatName: string;
  change: 'deleted' | 'edited';
  at: number;
  message: PluginMessage;
}

export interface PluginTheme {
  scheme: 'light' | 'dark';
  // '#rrggbb'
  accent: string;
}

// a desktop notification in WhatsZori's own toast window
export interface PluginNotification {
  id: string;
  // empty for summaries
  chatJid: string;
  title: string;
  body: string;
  avatarUrl: string;
  isGroup: boolean;
  at: number;
  // reply and "Mark as read" make sense (a message, not a summary)
  hasActions: boolean;
}

export interface NotificationControls {
  open(): void;
  markRead(): void;
  reply(text: string): void;
  dismiss(): void;
}

// a file waiting in the attachment preview
export interface PluginAttachment {
  name: string;
  mime: string;
  size: number;
  // image | video | file
  kind: string;
  // where the preview loads it from
  url: string;
}

export interface SlotProps {
  'sidebar.header': Record<string, never>;
  'sidebar.footer': Record<string, never>;
  'chat.header.actions': { chat: PluginChat };
  // a small mark next to a chat's name in the list
  'chatList.item.badge': { chat: PluginChat };
  // a strip above the messages of the open chat
  'conversation.banner': { chat: PluginChat };
  // a block in the contact / group info panel
  'chatInfo.sections': { chat: PluginChat };
  'message.accessories': { message: PluginMessage };
  'message.contextMenu': { message: PluginMessage; close: () => void };
  // buttons in the photo / video viewer's top bar
  'mediaViewer.actions': { message: PluginMessage };
  'composer.actions': { chatJid: string; insertText: (text: string) => void };
  // buttons on the file shown in the attachment preview
  'attach.preview.actions': {
    file: PluginAttachment;
    replace: (file: Blob, name: string) => Promise<void>;
    remove: () => void;
  };
  'settings.sections': Record<string, never>;
  // replaces the whole notification card; the first plugin that registers wins, and if it
  // crashes the stock card is shown instead
  'notification.card': { notification: PluginNotification; controls: NotificationControls };
  // extra bits inside the stock card, under the text
  'notification.accessories': { notification: PluginNotification };
}

export type SlotName = keyof SlotProps;

export type SlotComponent<N extends SlotName> = ComponentType<SlotProps[N]>;

export interface SlotEntry<N extends SlotName = SlotName> {
  pluginId: string;
  component: SlotComponent<N>;
}

export type Unregister = () => void;

export interface Command {
  // unique within the plugin
  id: string;
  title: string;
  // "Ctrl+Shift+K", "Mod+K" (Ctrl, or Cmd on a Mac), "Alt+1"; needs Ctrl, Alt or Mod
  shortcut?: string;
  // extra words the palette matches
  keywords?: string[];
  // hidden from the palette (and the shortcut does nothing) while this says false
  when?: () => boolean;
  run: () => void | Promise<void>;
}

export interface Panel {
  id: string;
  title: string;
  icon?: ReactNode;
  // a button for it in the chat header (default true)
  button?: boolean;
  render: ComponentType<{ chat: PluginChat; close: () => void }>;
}

export interface View {
  id: string;
  title: string;
  icon: ReactNode;
  render: ComponentType<{ close: () => void }>;
}

// return something to draw the message text yourself, or null to leave it to WhatsZori
export type TextFormatter = (text: string, message: PluginMessage) => ReactNode | null | undefined;

export interface EditorTool {
  id: string;
  label: string;
  // an emoji or a small element
  icon?: ReactNode;
  // runs on the whole picture each time it's drawn; keep it synchronous and quick
  apply: (ctx: CanvasRenderingContext2D, size: { width: number; height: number }) => void;
}

export interface MenuEntryInput {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface DialogOptions {
  title: string;
  width?: number;
  render: ComponentType<{ close: () => void }>;
  footer?: ComponentType<{ close: () => void }>;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

export interface FetchInit {
  method?: string;
  headers?: Record<string, string> | [string, string][] | Headers;
  body?: string | Blob | ArrayBuffer | Uint8Array | URLSearchParams | null;
  // milliseconds; default 30 s, at most 2 min
  timeout?: number;
}

export interface PluginResponse {
  ok: boolean;
  status: number;
  statusText: string;
  // after redirects
  url: string;
  headers: Headers;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
}

export type SettingValue = string | number | boolean;

export interface PluginEvents {
  // a message arrived or was sent (history from the phone isn't included unless asked)
  onMessage(fn: (m: PluginMessage) => void, opts?: { history?: boolean }): Unregister;
  onEdited(
    fn: (e: { chatJid: string; pk: string; text: string; editedAt: number }) => void,
  ): Unregister;
  onDeleted(
    fn: (e: { chatJid: string; pk: string; byName: string; at: number }) => void,
  ): Unregister;
  onChatOpened(fn: (jid: string | null) => void): Unregister;
  onTyping(
    fn: (e: { chatJid: string; senderJid: string; senderName: string; typing: boolean }) => void,
  ): Unregister;
  onPresence(
    fn: (e: { jid: string; online: boolean; lastSeen: number | null }) => void,
  ): Unregister;
  onThemeChanged(fn: (t: PluginTheme) => void): Unregister;
}

export interface PluginContext {
  readonly pluginId: string;
  // the API this WhatsZori provides (2)
  readonly apiVersion: number;
  // what the user allowed this plugin
  readonly permissions: readonly Permission[];
  // the app's own React: use it (not a bundled copy) so hooks work inside slots
  React: typeof ReactNS;
  ui: {
    // stock components, so plugin UI looks like the rest of the app; props are in the SDK
    /* eslint-disable @typescript-eslint/no-explicit-any */
    Button: ComponentType<any>;
    IconButton: ComponentType<any>;
    Input: ComponentType<any>;
    MenuItem: ComponentType<any>;
    Toggle: ComponentType<any>;
    Avatar: ComponentType<any>;
    Badge: ComponentType<any>;
    Spinner: ComponentType<any>;
    Segmented: ComponentType<any>;
    Tooltip: ComponentType<any>;
    Dialog: ComponentType<any>;
    Popover: ComponentType<any>;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    // a <style> that goes away with the plugin
    addStyles(css: string): Unregister;
    openDialog(opts: DialogOptions): { close: () => void };
    confirm(opts: ConfirmOptions): Promise<boolean>;
    // a menu at an element, a rectangle or a point
    showMenu(at: Element | DOMRect | { x: number; y: number }, items: MenuEntryInput[]): void;
  };
  registerSlot<N extends SlotName>(name: N, component: SlotComponent<N>): Unregister;
  // raw backend events (see the SDK for names and payloads); message and presence events need
  // the matching permission
  onEvent(event: string, handler: (payload: unknown) => void): Unregister;
  events: PluginEvents;
  commands: {
    register(cmd: Command): Unregister;
    run(id: string): Promise<void>;
  };
  panels: {
    register(panel: Panel): Unregister;
    open(id: string): void;
    close(): void;
  };
  views: {
    register(view: View): Unregister;
    open(id: string): void;
    close(): void;
  };
  messages: {
    registerFormatter(fn: TextFormatter): Unregister;
  };
  editor: {
    registerTool(tool: EditorTool): Unregister;
  };
  actions: {
    openChat(jid: string): void;
    // scroll to a message and flash it
    jumpTo(jid: string, pk: string): void;
    toast(text: string): void;
    openSettings(): void;
    // adds text to the open chat's message box; the user still presses send (needs composer)
    insertIntoComposer(text: string): void;
  };
  // the open chat's message box (needs composer)
  composer: {
    get(): { chatJid: string; text: string } | null;
    set(text: string): void;
    insert(text: string): void;
    reply(pk: string): void;
    // opens the attachment preview; the user still presses Send
    addAttachment(file: Blob, name?: string): Promise<void>;
  };
  // things your phone sees too; only right after the user clicks (needs chats.manage)
  chats: {
    pin(jid: string, on: boolean): Promise<void>;
    mute(jid: string, on: boolean): Promise<void>;
    archive(jid: string, on: boolean): Promise<void>;
  };
  // read-only: plugins can look, but sending is always the user's click
  data: {
    chats(): PluginChat[];
    activeChat(): string | null;
    // messages, contacts and media need their permissions
    messages(
      jid: string,
      opts?: number | { before?: string; limit?: number },
    ): Promise<PluginMessage[]>;
    messagePage(
      jid: string,
      opts?: { before?: string; limit?: number },
    ): Promise<{ messages: PluginMessage[]; hasMore: boolean }>;
    search(query: string, opts?: { jid?: string }): Promise<PluginSearchHit[]>;
    editHistory(pk: string): Promise<{ text: string; at: number }[]>;
    changes(opts?: {
      kind?: 'deleted' | 'edited';
      before?: { at: number; pk: string };
      limit?: number;
    }): Promise<{ items: PluginChange[]; hasMore: boolean }>;
    contacts(): Promise<PluginContact[]>;
    chatInfo(jid: string): Promise<PluginChatInfo>;
    me(): PluginMe;
    mediaUrl(pk: string, thumb?: boolean): string;
    avatarUrl(jid: string, full?: boolean): string;
  };
  app: {
    readonly version: string;
    theme(): PluginTheme;
    layout(): 'classic' | 'rail';
  };
  notify(title: string, body: string): Promise<void>;
  clipboard: {
    writeText(text: string): Promise<void>;
    writeImage(png: Blob): Promise<void>;
  };
  files: {
    // the save dialog; the chosen path, or null when cancelled
    saveAs(file: Blob, name: string): Promise<string | null>;
  };
  net: {
    // only to the sites in the manifest's "network", which the user allowed
    fetch(url: string | URL, init?: FetchInit): Promise<PluginResponse>;
  };
  // the manifest's settings form (typed, with defaults) plus free keys of your own
  settings: {
    all(): Promise<Record<string, string>>;
    get<T extends SettingValue = SettingValue>(key: string): Promise<T | undefined>;
    set(key: string, value: SettingValue): Promise<void>;
    delete(key: string): Promise<void>;
    onChange(fn: (key: string, value: SettingValue | undefined) => void): Unregister;
  };
  // the plugin's own key-value store, up to 1 MB per value
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
  };
  log: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
}

export interface PluginModule {
  manifest: PluginManifest;
  start(ctx: PluginContext): void | Unregister | Promise<void | Unregister>;
}
