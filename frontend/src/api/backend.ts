import type {
  AppSettings,
  AuthStatus,
  ConfigFolder,
  ConnState,
  Contact,
  UserTheme,
  BackendEventName,
  BackendEvents,
  Chat,
  ChatInfo,
  ChatList,
  ExportOptions,
  GroupEvent,
  SharedKind,
  Profile,
  EditVersion,
  GhostSettings,
  JID,
  Message,
  MessagePK,
  MessagePage,
  Reaction,
  SearchHit,
} from './types';
import type { SystemPalette } from './events';

// Mirrors the planned Wails services one-to-one, so the Wails bindings can implement it directly.
export interface AuthService {
  getState(): Promise<AuthStatus>;
  // conn:state events sent before the UI subscribed are lost, so it asks once on start
  getConnState(): Promise<ConnState>;
  startQRLogin(): Promise<void>;
  pairWithPhone(phone: string): Promise<string>;
  // wipe also deletes local history and downloaded media
  logout(wipe?: boolean): Promise<void>;
}

export interface ChatService {
  listChats(): Promise<Chat[]>;
  markRead(jid: JID): Promise<void>;
  setPinned(jid: JID, pinned: boolean): Promise<void>;
  setArchived(jid: JID, archived: boolean): Promise<void>;
  setMuted(jid: JID, muted: boolean): Promise<void>;
  getInfo(jid: JID): Promise<ChatInfo>;
  // composing / paused; the backend drops it when typing is hidden
  setTyping(jid: JID, typing: boolean): Promise<void>;
  // makes sure a chat exists (e.g. a group member we never wrote to) and returns it
  open(jid: JID): Promise<Chat>;
  setFavorite(jid: JID, on: boolean): Promise<void>;
  // removes the messages on this computer only
  clear(jid: JID): Promise<void>;
  // deletes the chat on all your devices
  delete(jid: JID): Promise<void>;
  setBlocked(jid: JID, blocked: boolean): Promise<void>;
  leave(jid: JID): Promise<void>;
  removeMember(group: JID, member: JID): Promise<void>;
  groupEvents(jid: JID): Promise<GroupEvent[]>;
  lists(): Promise<ChatList[]>;
  createList(name: string): Promise<ChatList>;
  renameList(id: number, name: string): Promise<void>;
  deleteList(id: number): Promise<void>;
  setInList(id: number, jid: JID, inList: boolean): Promise<void>;
}

export interface ExportService {
  // asks for a folder, writes the export there, resolves to the folder (null when cancelled)
  run(opts: ExportOptions): Promise<string | null>;
  cancel(): Promise<void>;
  open(folder: string): Promise<void>;
}

export interface ProfileService {
  get(): Promise<Profile>;
  setName(name: string): Promise<void>;
  setAbout(about: string): Promise<void>;
}

export interface MessageService {
  getMessages(jid: JID, beforePk: MessagePK | null, limit: number): Promise<MessagePage>;
  getEditHistory(pk: MessagePK): Promise<EditVersion[]>;
  sendText(jid: JID, text: string, replyToPk?: MessagePK): Promise<Message>;
  edit(pk: MessagePK, text: string): Promise<void>;
  revoke(pk: MessagePK): Promise<void>;
  react(pk: MessagePK, emoji: string): Promise<Reaction[]>;
  search(query: string): Promise<SearchHit[]>;
  // opens the system file picker and sends the choice; null when cancelled
  attachFile(jid: JID): Promise<Message | null>;
  // a chat's photos and videos, documents, or messages with links, newest first
  listShared(
    jid: JID,
    kind: SharedKind,
    beforePk: MessagePK | null,
    limit: number,
  ): Promise<MessagePage>;
}

export interface ContactService {
  list(): Promise<Contact[]>;
}

export interface MediaService {
  // where to load a message's attachment from; empty when there's nothing to load (mock)
  url(pk: MessagePK, thumb?: boolean): string;
  // profile picture or group photo; empty when there's none to load (mock). full = big version
  avatarUrl(jid: JID, full?: boolean): string;
  // attachments can be sent, saved and copied (desktop app only)
  canAttach: boolean;
  // native save dialog; resolves to the chosen path, or null when cancelled
  saveAs(pk: MessagePK): Promise<string | null>;
  // the file onto the system clipboard (pictures also as a picture)
  copy(pk: MessagePK): Promise<void>;
  // file manager with the file selected
  reveal(pk: MessagePK): Promise<void>;
}

export interface PrivacyService {
  getGhost(): Promise<GhostSettings>;
  setGhost(ghost: GhostSettings): Promise<void>;
}

export interface SettingsService {
  get(): Promise<AppSettings>;
  set(settings: AppSettings): Promise<void>;
}

export interface SystemService {
  version(): Promise<string>;
  // 'browser' outside the desktop app, otherwise the Go GOOS (windows, linux, darwin)
  platform(): Promise<string>;
  isSafeMode(): Promise<boolean>;
  // tells the Go side this start went fine, so the next one isn't in safe mode
  bootOK(): Promise<void>;
  openExternal(url: string): Promise<void>;
  openConfigFolder(kind: ConfigFolder): Promise<void>;
}

export interface SystemThemeService {
  get(): Promise<SystemPalette>;
}

export interface WindowService {
  // match the native title bar and window background to the page (no-op in a browser)
  setTheme(dark: boolean, background: string): Promise<void>;
}

export interface UserThemeService {
  list(): Promise<UserTheme[]>;
  // URL to load the file from; the hash busts the webview cache after an edit
  href(file: string, hash: string): string;
}

export type Unsubscribe = () => void;

export interface Backend {
  // 'mock' in a plain browser, 'wails' inside the desktop app (everything from Go)
  readonly kind: 'mock' | 'wails';
  system: SystemService;
  systemTheme: SystemThemeService;
  userThemes: UserThemeService;
  window: WindowService;
  auth: AuthService;
  chats: ChatService;
  messages: MessageService;
  profile: ProfileService;
  privacy: PrivacyService;
  contacts: ContactService;
  media: MediaService;
  export: ExportService;
  settings: SettingsService;
  on<E extends BackendEventName>(
    event: E,
    handler: (payload: BackendEvents[E]) => void,
  ): Unsubscribe;
}
