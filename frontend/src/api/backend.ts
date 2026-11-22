import type {
  AppSettings,
  AuthStatus,
  ConfigFolder,
  UserTheme,
  BackendEventName,
  BackendEvents,
  Chat,
  ChatInfo,
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
  startQRLogin(): Promise<void>;
  pairWithPhone(phone: string): Promise<string>;
  logout(): Promise<void>;
}

export interface ChatService {
  listChats(): Promise<Chat[]>;
  markRead(jid: JID): Promise<void>;
  setPinned(jid: JID, pinned: boolean): Promise<void>;
  setArchived(jid: JID, archived: boolean): Promise<void>;
  setMuted(jid: JID, muted: boolean): Promise<void>;
  getInfo(jid: JID): Promise<ChatInfo>;
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
  // 'mock' in a plain browser, 'wails' inside the desktop app (Go for system bits, mock for WA)
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
  settings: SettingsService;
  on<E extends BackendEventName>(
    event: E,
    handler: (payload: BackendEvents[E]) => void,
  ): Unsubscribe;
}
