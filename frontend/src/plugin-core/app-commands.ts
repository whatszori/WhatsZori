import { useAttach } from '../stores/attach';
import { useChats } from '../stores/chats';
import { useSettings } from '../stores/settings';
import { useUI } from '../stores/ui';
import { commands } from './registry';
import type { Command, Unregister } from './types';

// The app's own actions in the command palette, next to the ones plugins add. Their shortcuts
// are shown here but handled where they always were (MainLayout, Conversation).

const chatOpen = () => !!useUI.getState().activeChat;

const APP: Command[] = [
  {
    id: 'new-chat',
    title: 'New chat',
    shortcut: 'Ctrl+N',
    run: () => useUI.getState().setNewChatOpen(true),
  },
  {
    id: 'search',
    title: 'Search chats and messages',
    shortcut: 'Ctrl+K',
    run: () => useUI.getState().focusSearch(),
  },
  {
    id: 'search-chat',
    title: 'Search in this chat',
    shortcut: 'Ctrl+F',
    when: chatOpen,
    run: () => useUI.getState().setChatSearchOpen(true),
  },
  {
    id: 'attach',
    title: 'Attach photos or files',
    keywords: ['send', 'upload', 'picture'],
    when: chatOpen,
    run: () => void useAttach.getState().pick(useUI.getState().activeChat!),
  },
  {
    id: 'chat-info',
    title: 'Show contact or group info',
    when: chatOpen,
    run: () => useUI.getState().setChatInfoOpen(true),
  },
  {
    id: 'settings',
    title: 'Open settings',
    shortcut: 'Ctrl+,',
    run: () => useUI.getState().openSettings(),
  },
  {
    id: 'plugins',
    title: 'Plugins',
    keywords: ['settings', 'extensions'],
    run: () => useUI.getState().openSettings('plugins'),
  },
  {
    id: 'themes',
    title: 'Themes',
    keywords: ['settings', 'appearance', 'colours'],
    run: () => useUI.getState().openSettings('themes'),
  },
  {
    id: 'changes',
    title: 'Deleted & edited messages',
    keywords: ['history'],
    run: () => useUI.getState().openChanges(),
  },
  {
    id: 'status',
    title: 'Status',
    keywords: ['stories'],
    run: () => useUI.getState().openStatus(),
  },
  {
    id: 'archived',
    title: 'Archived chats',
    run: () => {
      useUI.getState().setRailPanel('chats');
      useChats.getState().setShowArchived(true);
    },
  },
  ...(['light', 'dark', 'system'] as const).map((theme) => ({
    id: `theme-${theme}`,
    title: theme === 'system' ? 'Theme: follow the system' : `Theme: ${theme}`,
    keywords: ['appearance', 'mode'],
    run: () =>
      useSettings.getState().update((s) => ({ ...s, appearance: { ...s.appearance, theme } })),
  })),
];

export function registerAppCommands(): Unregister {
  const offs = APP.map((c) => commands.add('app', c.id, c));
  return () => offs.forEach((off) => off());
}
