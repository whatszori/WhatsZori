// Plugin-facing contract. Keep this file free of app imports, it moves to plugin-sdk later.
import type { ComponentType } from 'react';
import type * as ReactNS from 'react';

export interface PluginChat {
  jid: string;
  name: string;
  isGroup: boolean;
  muted: boolean;
}

export interface PluginMessage {
  pk: string;
  chatJid: string;
  senderJid: string;
  senderName: string;
  fromMe: boolean;
  timestamp: number;
  kind: string;
  text: string;
  editedAt?: number;
  deleted?: { byName: string; at: number };
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

export interface SlotProps {
  'sidebar.header': Record<string, never>;
  'sidebar.footer': Record<string, never>;
  'chat.header.actions': { chat: PluginChat };
  'message.accessories': { message: PluginMessage };
  'message.contextMenu': { message: PluginMessage; close: () => void };
  'composer.actions': { chatJid: string; insertText: (text: string) => void };
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

export interface PluginContext {
  readonly pluginId: string;
  // the app's own React: use it (not a bundled copy) so hooks work inside slots
  React: typeof ReactNS;
  // a few stock components, so plugin UI looks like the rest of the app
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- props are documented in the SDK
  ui: Record<'Button' | 'IconButton' | 'Input' | 'MenuItem' | 'Toggle', ComponentType<any>>;
  registerSlot<N extends SlotName>(name: N, component: SlotComponent<N>): Unregister;
  // raw backend events; payload shapes are documented in the SDK, not typed here yet
  onEvent(event: string, handler: (payload: unknown) => void): Unregister;
  actions: {
    openChat(jid: string): void;
    // adds text to the open chat's message box; the user still presses send
    insertIntoComposer(text: string): void;
    toast(text: string): void;
  };
  // read-only: plugins can look, but sending is always the user's click
  data: {
    chats(): PluginChat[];
    activeChat(): string | null;
    messages(jid: string, limit?: number): Promise<PluginMessage[]>;
  };
  // small strings, shown in the plugin's settings block
  settings: {
    all(): Promise<Record<string, string>>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
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
