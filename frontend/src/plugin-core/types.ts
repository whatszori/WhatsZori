// Plugin-facing contract. Keep this file free of app imports, it moves to plugin-sdk later.
import type { ComponentType } from 'react';

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

export interface SlotProps {
  'sidebar.header': Record<string, never>;
  'sidebar.footer': Record<string, never>;
  'chat.header.actions': { chat: PluginChat };
  'message.accessories': { message: PluginMessage };
  'message.contextMenu': { message: PluginMessage; close: () => void };
  'composer.actions': { chatJid: string; insertText: (text: string) => void };
  'settings.sections': Record<string, never>;
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
  registerSlot<N extends SlotName>(name: N, component: SlotComponent<N>): Unregister;
  // raw backend events; payload shapes are documented in the SDK, not typed here yet
  onEvent(event: string, handler: (payload: unknown) => void): Unregister;
  actions: {
    openChat(jid: string): void;
    insertIntoComposer(text: string): void;
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
  start(ctx: PluginContext): void | Unregister;
}
