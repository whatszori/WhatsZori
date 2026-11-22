export type JID = string;
// local primary key from our own store; WA message ids aren't unique across chats
export type MessagePK = string;

export type AuthState = 'logged-out' | 'qr' | 'pairing' | 'logging-in' | 'logged-in';

export interface Me {
  jid: JID;
  name: string;
  phone: string;
}

export interface AuthStatus {
  state: AuthState;
  me: Me | null;
}

export interface QRPayload {
  code: string;
  // ms until WA rotates the code
  expiresIn: number;
}

export type ConnState = 'connected' | 'connecting' | 'reconnecting' | 'offline';

export type MessageKind = 'text' | 'image' | 'video' | 'document' | 'voice' | 'sticker';

export interface MessagePreview {
  pk: MessagePK;
  fromMe: boolean;
  senderName: string;
  kind: MessageKind;
  text: string;
  deleted: boolean;
  status?: MessageStatus;
}

export interface Chat {
  jid: JID;
  name: string;
  isGroup: boolean;
  memberCount?: number;
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  unread: number;
  lastMessage: MessagePreview | null;
  lastActivity: number;
  // 1:1 only; null = hidden by their privacy settings
  lastSeen?: number | null;
  online?: boolean;
}

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface MediaInfo {
  width?: number;
  height?: number;
  fileName?: string;
  size?: number;
  mime?: string;
  // seconds, for voice / video
  duration?: number;
  // 0..1 amplitudes, voice only
  waveform?: number[];
  caption?: string;
}

export interface ReplyRef {
  pk: MessagePK;
  senderName: string;
  fromMe: boolean;
  kind: MessageKind;
  text: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface DeletedInfo {
  byJid: JID;
  byName: string;
  at: number;
}

export interface Message {
  pk: MessagePK;
  id: string;
  chatJid: JID;
  senderJid: JID;
  senderName: string;
  fromMe: boolean;
  timestamp: number;
  kind: MessageKind;
  text: string;
  media?: MediaInfo;
  replyTo?: ReplyRef;
  status?: MessageStatus;
  editedAt?: number;
  editCount?: number;
  deleted?: DeletedInfo;
  // revoke arrived before (or without) the original
  contentUnknown?: boolean;
  reactions: Reaction[];
}

export interface EditVersion {
  text: string;
  at: number;
}

export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
}

export interface SearchHit {
  chatJid: JID;
  chatName: string;
  message: Message;
}

export type ReadReceiptMode = 'always' | 'never' | 'on-reply';

export interface GhostSettings {
  hideOnline: boolean;
  hideTyping: boolean;
  readReceipts: ReadReceiptMode;
}

export interface AppSettings {
  appearance: {
    theme: 'light' | 'dark' | 'system';
    accent: string | null;
    useSystemAccent: boolean;
    density: 'comfortable' | 'compact';
    // panels = sidebar + content; rail = icon rail on the left, settings inside the sidebar
    layout?: 'panels' | 'rail';
    fontScale: number;
  };
  history: {
    keepDeleted: boolean;
    keepEditHistory: boolean;
    autoDownloadMedia: boolean;
  };
  plugins: Record<string, boolean>;
  themes: Record<string, boolean>;
  // "themeId/moduleId" -> on/off, only for optional modules the user touched
  themeModules: Record<string, boolean>;
}

export interface BackendEvents {
  'auth:qr': QRPayload;
  'auth:state': AuthStatus;
  'conn:state': { state: ConnState };
  'msg:batch': { messages: Message[] };
  'msg:status': { chatJid: JID; pk: MessagePK; status: MessageStatus };
  'msg:edited': { chatJid: JID; pk: MessagePK; text: string; editedAt: number; editCount: number };
  'msg:deleted': {
    chatJid: JID;
    pk: MessagePK;
    deleted: DeletedInfo;
    // true when "keep deleted messages" is off and the content was dropped
    purged: boolean;
  };
  'msg:reaction': { chatJid: JID; pk: MessagePK; reactions: Reaction[] };
  'chat:update': { chat: Chat };
  presence: { jid: JID; online: boolean; lastSeen: number | null };
  'chat:typing': { chatJid: JID; senderJid: JID; senderName: string; typing: boolean };
}

export type BackendEventName = keyof BackendEvents;
