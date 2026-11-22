import type {
  AppSettings,
  AuthStatus,
  BackendEventName,
  BackendEvents,
  Chat,
  EditVersion,
  GhostSettings,
  JID,
  Message,
  MessagePK,
  MessagePage,
  Reaction,
  SearchHit,
} from './types';

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

export type Unsubscribe = () => void;

export interface Backend {
  auth: AuthService;
  chats: ChatService;
  messages: MessageService;
  privacy: PrivacyService;
  settings: SettingsService;
  on<E extends BackendEventName>(event: E, handler: (payload: BackendEvents[E]) => void): Unsubscribe;
}
