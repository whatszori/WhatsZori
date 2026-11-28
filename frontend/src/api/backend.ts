import type {
  Attachment,
  MessageReceipts,
  MarketEntry,
  PluginFetchRequest,
  PluginFetchResponse,
  Sticker,
  UserThemePackage,
  PluginInfo,
  StatusGroup,
  ChangeKind,
  ChangePage,
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
  // 0 (off), 86400, 604800 or 7776000 seconds, for everyone in the chat
  setDisappearing(jid: JID, seconds: number): Promise<void>;
  removeMember(group: JID, member: JID): Promise<void>;
  groupEvents(jid: JID): Promise<GroupEvent[]>;
  lists(): Promise<ChatList[]>;
  createList(name: string): Promise<ChatList>;
  renameList(id: number, name: string): Promise<void>;
  deleteList(id: number): Promise<void>;
  setInList(id: number, jid: JID, inList: boolean): Promise<void>;
  // the chat open in the window (null for none), so it doesn't get desktop notifications
  setActive(jid: JID | null): Promise<void>;
}

export interface NotificationService {
  // false when the OS has nowhere to show them (Linux without a notification daemon, a browser)
  available(): Promise<boolean>;
  test(): Promise<void>;
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
  // who a message of ours reached and who read it
  receipts(pk: MessagePK): Promise<MessageReceipts>;
  // the "Deleted & edited" feed, latest first; before = the last item of the previous page
  changes(
    kind: ChangeKind,
    before: { at: number; pk: MessagePK } | null,
    limit: number,
  ): Promise<ChangePage>;
  // mentions: JIDs of group members; the text has "@<number>" for each
  sendText(jid: JID, text: string, replyToPk?: MessagePK, mentions?: JID[]): Promise<Message>;
  edit(pk: MessagePK, text: string): Promise<void>;
  revoke(pk: MessagePK): Promise<void>;
  // copies to up to 5 chats, oldest first; resolves to how many were sent
  forward(pks: MessagePK[], jids: JID[]): Promise<number>;
  // "Delete for me": only on this computer
  deleteLocal(jid: JID, pks: MessagePK[]): Promise<void>;
  react(pk: MessagePK, emoji: string): Promise<Reaction[]>;
  // our vote on a poll, by option name; [] takes it back
  vote(pk: MessagePK, options: string[]): Promise<void>;
  // tap a reply button or pick a list row (by id) of a business message; the answer is sent
  answer(pk: MessagePK, id: string): Promise<Message>;
  // an incoming voice or video note started playing ("played" receipt, ghost settings permitting)
  played(pk: MessagePK): Promise<void>;
  // jid limits it to one chat
  search(query: string, jid?: JID): Promise<SearchHit[]>;
  // the system file picker (several files); [] when cancelled
  pickAttachments(): Promise<Attachment[]>;
  // a pasted or dropped file, or a photo saved from the editor
  uploadAttachment(file: Blob, name: string): Promise<Attachment>;
  // where the preview loads a waiting attachment from
  attachmentUrl(token: string): string;
  // asFile: a photo goes as a document, uncompressed
  sendAttachment(jid: JID, token: string, caption: string, asFile: boolean): Promise<Message>;
  // removed from the preview before sending
  dropAttachment(token: string): Promise<void>;
  // a voice note recorded in the page (WebM/Opus); waveform is 0..100 per bar
  sendVoice(jid: JID, recording: Blob, waveform: number[]): Promise<Message>;
  // a chat's photos and videos, documents, or messages with links, newest first
  listShared(
    jid: JID,
    kind: SharedKind,
    beforePk: MessagePK | null,
    limit: number,
  ): Promise<MessagePage>;
}

export interface PluginService {
  list(): Promise<PluginInfo[]>;
  setEnabled(id: string, on: boolean): Promise<void>;
  isSafeMode(): Promise<boolean>;
  // where the plugin's module is served from
  url(id: string, file: string): string;
  settings(id: string): Promise<Record<string, string>>;
  setSetting(id: string, key: string, value: string): Promise<void>;
  deleteSetting(id: string, key: string): Promise<void>;
  storageGet(id: string, key: string): Promise<string | null>;
  storageSet(id: string, key: string, value: string): Promise<void>;
  storageDelete(id: string, key: string): Promise<void>;
  storageKeys(id: string): Promise<string[]>;
  // what each permission means, for the approval dialog
  permissionInfo(): Promise<Record<string, string>>;
  // allow what the plugin asks for right now (permissions, sites, signing key)
  approve(id: string): Promise<void>;
  // turn off and forget what the user allowed; turning it on asks again
  revoke(id: string): Promise<void>;
  // the plugin's network requests, only to the sites it lists and the user allowed
  fetch(id: string, req: PluginFetchRequest): Promise<PluginFetchResponse>;
  notify(id: string, title: string, body: string): Promise<void>;
  // native save dialog for a file uploaded to /wz-upload/; the path, or null when cancelled
  saveFile(id: string, token: string, name: string): Promise<string | null>;
}

export interface MarketplaceService {
  // from GitHub; cached for a few minutes unless refresh
  list(refresh?: boolean): Promise<MarketEntry[]>;
  // installs or updates; a plugin stays off until the user turns it on
  install(kind: string, id: string): Promise<void>;
  // a plugin is also turned off and its permissions forgotten
  uninstall(kind: string, id: string): Promise<void>;
}

export interface StickerService {
  // the user's own, newest first
  mine(): Promise<Sticker[]>;
  // seen in chats lately, one per picture
  recent(): Promise<Sticker[]>;
  // a picture made into a sticker in the page (see make-sticker.ts)
  add(picture: Blob): Promise<Sticker>;
  remove(id: string): Promise<void>;
  send(jid: JID, id: string): Promise<Message>;
}

export interface StatusService {
  // the last day of statuses, or everything kept
  list(all: boolean): Promise<StatusGroup[]>;
  // the user opened one; ghost = don't tell the poster. Resolves to whether a receipt went out
  view(pk: MessagePK, ghost: boolean): Promise<boolean>;
}

export interface ContactService {
  list(): Promise<Contact[]>;
  // the account behind a phone number; rejects when it isn't on WhatsApp
  lookup(phone: string): Promise<Contact>;
}

export interface MediaService {
  // where to load a message's attachment from; empty when there's nothing to load (mock)
  url(pk: MessagePK, thumb?: boolean): string;
  // profile picture or group photo; empty when there's none to load (mock). full = big version
  avatarUrl(jid: JID, full?: boolean): string;
  // attachments can be saved and copied (desktop app only)
  canAttach: boolean;
  // native save dialog; resolves to the chosen path, or null when cancelled
  saveAs(pk: MessagePK): Promise<string | null>;
  // the file onto the system clipboard (pictures also as a picture)
  copy(pk: MessagePK): Promise<void>;
  // a full-size profile picture: save dialog (the path, or null) and clipboard
  saveAvatar(jid: JID, name: string): Promise<string | null>;
  copyAvatar(jid: JID): Promise<void>;
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
  // unread chats, for the tray icon and the taskbar badge
  setUnread(count: number): Promise<void>;
}

export interface UserThemeService {
  list(): Promise<UserTheme[]>;
  // URL to load the file from; the hash busts the webview cache after an edit
  href(file: string, hash: string): string;
  // theme folders with a manifest.json
  packages(): Promise<UserThemePackage[]>;
  // asks for an image, copies it into the themes folder; null when cancelled
  pickWallpaper(): Promise<string | null>;
  wallpaperUrl(rel: string): string;
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
  status: StatusService;
  plugins: PluginService;
  marketplace: MarketplaceService;
  stickers: StickerService;
  media: MediaService;
  export: ExportService;
  notifications: NotificationService;
  settings: SettingsService;
  on<E extends BackendEventName>(
    event: E,
    handler: (payload: BackendEvents[E]) => void,
  ): Unsubscribe;
}
