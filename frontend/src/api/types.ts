import type { WzEvents } from './events';

export type JID = string;
// local primary key from our own store; WA message ids aren't unique across chats
export type MessagePK = string;

export type AuthState = 'logged-out' | 'qr' | 'pairing' | 'logging-in' | 'logged-in';

export interface Me {
  jid: JID;
  name: string;
  phone: string;
}

// what other people see about you; separate from Me, which is just the account identity
export interface Profile {
  name: string;
  about: string;
  phone: string;
}

export interface GroupMember {
  jid: JID;
  name: string;
  phone: string;
  isMe: boolean;
  isAdmin: boolean;
}

export interface MediaRef {
  pk: MessagePK;
  kind: MessageKind;
  width?: number;
  height?: number;
  duration?: number;
}

export interface ChatInfo {
  jid: JID;
  // 1:1: the contact's "about" line; group: the description (empty = none)
  about: string;
  phone?: string;
  members?: GroupMember[];
  createdAt?: number;
  createdBy?: string;
  mediaCount: number;
  docCount: number;
  linkCount: number;
  recentMedia: MediaRef[];
  // what anti-delete and edit history have kept locally for this chat
  deletedKept: number;
  edited: number;
  // 1:1: we blocked them
  blocked?: boolean;
  // a contact opened from a group, with no chat of our own yet
  noChat?: boolean;
  name: string;
}

// a custom chat list (local to WhatsZori)
export interface ChatList {
  id: number;
  name: string;
  position: number;
}

export type GroupEventKind = 'add' | 'remove' | 'leave' | 'join' | 'promote' | 'demote' | 'create';

export interface GroupEvent {
  at: number;
  kind: GroupEventKind;
  actorJid: JID;
  actorName: string;
  targetJid: JID;
  targetName: string;
}

export type ExportMedia = 'photo' | 'video' | 'voice' | 'round' | 'sticker' | 'gif' | 'file';
export type ExportFormat = 'html' | 'json' | 'txt';

export interface ExportOptions {
  jid: JID;
  media: ExportMedia[];
  // per file, 0 = no limit
  maxBytes: number;
  format: ExportFormat;
  // ms, 0 = open-ended
  from: number;
  to: number;
}

export interface ExportProgress {
  jid: JID;
  done: number;
  total: number;
  phase: 'collecting' | 'media' | 'writing' | 'done' | 'failed' | 'cancelled';
}

export type SharedKind = 'media' | 'docs' | 'links';

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

export type MessageKind = 'text' | 'image' | 'video' | 'document' | 'voice' | 'sticker' | 'poll';

export interface PollOption {
  name: string;
  votes: number;
  mine: boolean;
  // display names, "You" for us
  voters: string[];
}

export interface PollInfo {
  name: string;
  options: PollOption[];
  // how many one person may pick; 0 = any number
  selectable: number;
  totalVoters: number;
}

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
  // only in WhatsZori, not synced with the phone
  favorite?: boolean;
  lists?: number[];
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
  // video note ("кружок"): a circle that plays inline
  round?: boolean;
  // a GIF: plays muted on a loop
  gif?: boolean;
  // nothing to download: WhatsApp only gave the phone the keys (view once, mostly)
  unavailable?: boolean;
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
  // forwarding score: 0/absent not forwarded, 5+ "forwarded many times"
  forwarded?: number;
  poll?: PollInfo;
  // "view once" media; WhatsZori keeps it anyway
  viewOnce?: boolean;
  reactions: Reaction[];
}

export type ChangeKind = '' | 'deleted' | 'edited';

// one entry of the "Deleted & edited" feed
export interface ChangeItem {
  chatJid: JID;
  chatName: string;
  message: Message;
  change: 'deleted' | 'edited';
  at: number;
}

export interface ChangePage {
  items: ChangeItem[];
  hasMore: boolean;
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
  // don't send "played" when listening to a voice note
  hidePlayed: boolean;
  // view statuses without telling the poster; when off, WhatsZori asks each time
  statusGhost: boolean;
  // chats in full ghost mode: no read or played receipts, no typing
  ghostChats: JID[];
}

// a plugin folder in <config>/plugins
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  // the module to load, relative to the plugin folder
  main: string;
  enabled: boolean;
  // why it can't load (bad manifest, missing file)
  error?: string;
}

export interface StatusItem {
  message: Message;
  // opened in WhatsZori
  seen: boolean;
  // the colour behind a text status
  background?: string;
}

// one person's status updates
export interface StatusGroup {
  jid: JID;
  name: string;
  mine: boolean;
  items: StatusItem[];
  unseen: number;
  lastTs: number;
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
  tray: {
    // closing the window keeps WhatsZori running in the tray (desktop app)
    closeToTray: boolean;
  };
  notifications: {
    enabled: boolean;
    // who wrote and what; off = just "New message"
    preview: boolean;
    sound: boolean;
    // auto = WhatsZori's own on Windows, the system's elsewhere
    style: 'auto' | 'system' | 'whatszori';
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
  // file name of the enabled CSS theme from the user's themes folder
  userTheme: string | null;
  ui: {
    sidebarWidth: number;
  };
}

// a single-file CSS theme from <config>/themes, as listed by the Go side
export interface UserTheme {
  file: string;
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  hash: string;
}

export type ConfigFolder = 'root' | 'themes' | 'plugins' | 'media';

export interface Contact {
  jid: JID;
  name: string;
  phone: string;
}

export interface SyncProgress {
  // 0..100
  progress: number;
  done: boolean;
}

export interface Toast {
  kind: 'error' | 'info';
  text: string;
}

export interface BackendEvents extends WzEvents {
  'auth:qr': QRPayload;
  // the login attempt ended (code expired, linking failed); back to logged-out
  'auth:error': { message: string };
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
  // deleted on this computer only
  'msg:removed': { chatJid: JID; pks: MessagePK[] };
  'chat:update': { chat: Chat };
  // a LID chat that turned out to be the same person as a phone-number chat and was merged into it
  'chat:removed': { jid: JID };
  // a profile picture or group photo changed; reload it
  'avatar:changed': { jid: JID };
  // every message of the chat was removed locally
  'chat:cleared': { jid: JID };
  'export:progress': ExportProgress;
  // a desktop notification was clicked; reply = "Reply" on a desktop without a reply field
  'notification:open': { chatJid: JID; pk: MessagePK; reply: boolean };
  presence: { jid: JID; online: boolean; lastSeen: number | null };
  'chat:typing': { chatJid: JID; senderJid: JID; senderName: string; typing: boolean };
  // a status arrived, changed or was deleted
  'status:update': { jid: JID };
  'sync:progress': SyncProgress;
  toast: Toast;
}

export type BackendEventName = keyof BackendEvents;
