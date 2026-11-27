import { Events } from '@wailsio/runtime';
import '../../../bindings/events';
import {
  Auth,
  Chats,
  Contacts,
  Export,
  Marketplace,
  Media,
  Messages,
  Notifications,
  Plugins,
  Privacy,
  Profile,
  Settings,
  Status,
  Stickers,
  System,
  SystemTheme,
  Themes,
  Window,
} from '../../../bindings/github.com/whatszori/WhatsZori/internal/services';
import type * as Go from '../../../bindings/github.com/whatszori/WhatsZori/internal/domain/models';
import type { SystemPalette as GoPalette } from '../../../bindings/github.com/whatszori/WhatsZori/internal/systheme/models';
import type { Backend } from '../backend';
import { withDefaults } from '../defaults';
import type { SystemPalette } from '../events';
import { WZ_EVENTS } from '../events';
import type { MockBackend } from '../mock/MockBackend';
import type {
  Attachment,
  MarketEntry,
  PluginFetchRequest,
  PluginFetchResponse,
  Sticker,
  UserThemePackage,
  PluginInfo,
  StatusGroup,
  ChangeItem,
  ChangeKind,
  ChangePage,
  AppSettings,
  AuthStatus,
  BackendEventName,
  BackendEvents,
  Chat,
  ChatInfo,
  ChatList,
  ConfigFolder,
  ExportOptions,
  GroupEvent,
  SharedKind,
  ConnState,
  Contact,
  EditVersion,
  GhostSettings,
  JID,
  Message,
  MessagePK,
  MessagePage,
  Profile as ProfileDTO,
  Reaction,
  SearchHit,
  UserTheme,
} from '../types';

const SETTINGS_KEY = 'app';

function normalizePalette(p: GoPalette | null): SystemPalette {
  return {
    source: p?.source ?? 'none',
    scheme: p?.scheme === 'dark' || p?.scheme === 'light' ? p.scheme : 'none',
    accent: p?.accent ?? '',
    accentFg: p?.accentFg ?? '',
    raw: Object.fromEntries(
      Object.entries(p?.raw ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'),
    ),
  };
}

// Go's DTOs are the same JSON as our types (check.ts compares the keys at compile time); the
// generator just spells string unions as enums, which TS won't assign to literal unions.
const as = <T>(v: unknown): T => v as T;

const message = (m: Go.Message): Message => as<Message>({ ...m, reactions: m.reactions ?? [] });

const chatInfo = (i: Go.ChatInfo): ChatInfo =>
  as<ChatInfo>({ ...i, members: i.members ?? undefined, recentMedia: i.recentMedia ?? [] });

// Everything comes from Go now. The mock is only used once, to take over the settings a browser
// session left in localStorage on the very first desktop start.
export class WailsBackend implements Backend {
  readonly kind = 'wails' as const;

  constructor(private readonly mock: MockBackend) {}

  auth = {
    getState: async (): Promise<AuthStatus> => as<AuthStatus>(await Auth.GetState()),
    getConnState: async (): Promise<ConnState> => as<ConnState>(await Auth.GetConnState()),
    startQRLogin: () => Auth.StartQRLogin(),
    pairWithPhone: (phone: string) => Auth.PairWithPhone(phone),
    logout: (wipe = false) => Auth.Logout(wipe),
  };

  chats = {
    listChats: async (): Promise<Chat[]> => as<Chat[]>((await Chats.ListChats()) ?? []),
    markRead: (jid: JID) => Chats.MarkRead(jid),
    setPinned: (jid: JID, pinned: boolean) => Chats.SetPinned(jid, pinned),
    setArchived: (jid: JID, archived: boolean) => Chats.SetArchived(jid, archived),
    setMuted: (jid: JID, muted: boolean) => Chats.SetMuted(jid, muted),
    getInfo: async (jid: JID): Promise<ChatInfo> => chatInfo(await Chats.GetInfo(jid)),
    setTyping: (jid: JID, typing: boolean) => Chats.SetTyping(jid, typing),
    open: async (jid: JID): Promise<Chat> => as<Chat>(await Chats.Open(jid)),
    setFavorite: (jid: JID, on: boolean) => Chats.SetFavorite(jid, on),
    clear: (jid: JID) => Chats.Clear(jid),
    delete: (jid: JID) => Chats.Delete(jid),
    setBlocked: (jid: JID, blocked: boolean) => Chats.SetBlocked(jid, blocked),
    leave: (jid: JID) => Chats.Leave(jid),
    removeMember: (group: JID, member: JID) => Chats.RemoveMember(group, member),
    groupEvents: async (jid: JID): Promise<GroupEvent[]> =>
      as<GroupEvent[]>((await Chats.GroupEvents(jid)) ?? []),
    lists: async (): Promise<ChatList[]> => (await Chats.Lists()) ?? [],
    createList: (name: string): Promise<ChatList> => Chats.CreateList(name),
    renameList: (id: number, name: string) => Chats.RenameList(id, name),
    deleteList: (id: number) => Chats.DeleteList(id),
    setInList: (id: number, jid: JID, inList: boolean) => Chats.SetInList(id, jid, inList),
    setActive: (jid: JID | null) => Chats.SetActive(jid ?? ''),
  };

  notifications = {
    available: () => Notifications.Available(),
    test: () => Notifications.Test(),
  };

  export = {
    run: async (opts: ExportOptions): Promise<string | null> =>
      (await Export.Run(as<Go.ExportOptions>(opts))) || null,
    cancel: () => Export.Cancel(),
    open: (folder: string) => Export.Open(folder),
  };

  messages = {
    getMessages: async (
      jid: JID,
      beforePk: MessagePK | null,
      limit: number,
    ): Promise<MessagePage> => {
      const page = await Messages.GetMessages(jid, beforePk ?? '', limit);
      return { messages: (page.messages ?? []).map(message), hasMore: page.hasMore };
    },
    getEditHistory: async (pk: MessagePK): Promise<EditVersion[]> =>
      (await Messages.GetEditHistory(pk)) ?? [],
    sendText: async (
      jid: JID,
      text: string,
      replyToPk?: MessagePK,
      mentions?: JID[],
    ): Promise<Message> =>
      message(await Messages.SendText(jid, text, replyToPk ?? '', mentions ?? [])),
    edit: (pk: MessagePK, text: string) => Messages.Edit(pk, text),
    revoke: (pk: MessagePK) => Messages.Revoke(pk),
    forward: (pks: MessagePK[], jids: JID[]): Promise<number> => Messages.Forward(pks, jids),
    vote: (pk: MessagePK, options: string[]) => Messages.Vote(pk, options),
    played: (pk: MessagePK) => Messages.Played(pk),
    changes: async (
      kind: ChangeKind,
      before: { at: number; pk: MessagePK } | null,
      limit: number,
    ): Promise<ChangePage> => {
      const page = await Messages.Changes(kind, before?.at ?? 0, before?.pk ?? '', limit);
      return {
        hasMore: page.hasMore,
        items: (page.items ?? []).map((it) => ({
          ...it,
          change: it.change as ChangeItem['change'],
          message: message(it.message),
        })),
      };
    },
    deleteLocal: (jid: JID, pks: MessagePK[]) => Messages.DeleteLocal(jid, pks),
    react: async (pk: MessagePK, emoji: string): Promise<Reaction[]> =>
      (await Messages.React(pk, emoji)) ?? [],
    search: async (query: string, jid?: JID): Promise<SearchHit[]> =>
      ((await Messages.Search(query, jid ?? '')) ?? []).map((h) => ({
        ...h,
        message: message(h.message),
      })),
    listShared: async (
      jid: JID,
      kind: SharedKind,
      beforePk: MessagePK | null,
      limit: number,
    ): Promise<MessagePage> => {
      const page = await Messages.ListShared(jid, kind, beforePk ?? '', limit);
      return { messages: (page.messages ?? []).map(message), hasMore: page.hasMore };
    },
    sendVoice: async (jid: JID, recording: Blob, waveform: number[]): Promise<Message> => {
      // bindings carry JSON, so the bytes go as base64
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
        r.onerror = () => reject(r.error);
        r.readAsDataURL(recording);
      });
      return message(await Messages.SendVoice(jid, b64, waveform));
    },
    pickAttachments: async (): Promise<Attachment[]> =>
      ((await Messages.PickAttachments()) ?? []) as Attachment[],
    // a plain POST to the asset server: the bytes don't go through a JSON binding as base64
    uploadAttachment: async (file: Blob, name: string): Promise<Attachment> => {
      const res = await fetch(`/wz-upload/?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        body: file,
      });
      if (!res.ok) throw new Error((await res.text()).trim() || `upload failed (${res.status})`);
      return (await res.json()) as Attachment;
    },
    attachmentUrl: (token: string): string => `/wz-upload/${encodeURIComponent(token)}`,
    sendAttachment: async (
      jid: JID,
      token: string,
      caption: string,
      asFile: boolean,
    ): Promise<Message> => message(await Messages.SendAttachment(jid, token, caption, asFile)),
    dropAttachment: (token: string): Promise<void> => Messages.DropAttachment(token),
  };

  profile = {
    get: async (): Promise<ProfileDTO> => Profile.Get(),
    setName: (name: string) => Profile.SetName(name),
    setAbout: (about: string) => Profile.SetAbout(about),
  };

  privacy = {
    getGhost: async (): Promise<GhostSettings> => as<GhostSettings>(await Privacy.GetGhost()),
    setGhost: (g: GhostSettings) => Privacy.SetGhost(as<Go.GhostSettings>(g)),
  };

  contacts = {
    list: async (): Promise<Contact[]> => (await Contacts.List()) ?? [],
    lookup: (phone: string): Promise<Contact> => Contacts.Lookup(phone),
  };

  stickers = {
    mine: async (): Promise<Sticker[]> => (await Stickers.Mine()) ?? [],
    recent: async (): Promise<Sticker[]> => (await Stickers.Recent()) ?? [],
    add: async (picture: Blob): Promise<Sticker> => {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
        r.onerror = () => reject(r.error);
        r.readAsDataURL(picture);
      });
      return Stickers.Add(b64);
    },
    remove: (id: string) => Stickers.Remove(id),
    send: async (jid: JID, id: string): Promise<Message> => message(await Stickers.Send(jid, id)),
  };

  plugins = {
    list: async (): Promise<PluginInfo[]> => as<PluginInfo[]>((await Plugins.List()) ?? []),
    setEnabled: (id: string, on: boolean) => Plugins.SetEnabled(id, on),
    isSafeMode: () => Plugins.IsSafeMode(),
    url: (id: string, file: string) =>
      `/wz-plugins/${encodeURIComponent(id)}/${file.split('/').map(encodeURIComponent).join('/')}`,
    settings: async (id: string): Promise<Record<string, string>> =>
      ((await Plugins.Settings(id)) ?? {}) as Record<string, string>,
    setSetting: (id: string, key: string, value: string) => Plugins.SetSetting(id, key, value),
    deleteSetting: (id: string, key: string) => Plugins.DeleteSetting(id, key),
    storageGet: async (id: string, key: string): Promise<string | null> =>
      (await Plugins.StorageGet(id, key)) ?? null,
    storageSet: (id: string, key: string, value: string) => Plugins.StorageSet(id, key, value),
    storageDelete: (id: string, key: string) => Plugins.StorageDelete(id, key),
    storageKeys: async (id: string): Promise<string[]> => (await Plugins.StorageKeys(id)) ?? [],
    permissionInfo: async (): Promise<Record<string, string>> =>
      ((await Plugins.PermissionInfo()) ?? {}) as Record<string, string>,
    approve: (id: string) => Plugins.Approve(id),
    revoke: (id: string) => Plugins.Revoke(id),
    fetch: async (id: string, req: PluginFetchRequest): Promise<PluginFetchResponse> =>
      as<PluginFetchResponse>(await Plugins.Fetch(id, as<Go.PluginFetchRequest>(req))),
    notify: (id: string, title: string, body: string) => Plugins.Notify(id, title, body),
    saveFile: async (id: string, token: string, name: string): Promise<string | null> =>
      (await Plugins.SaveFile(id, token, name)) || null,
  };

  marketplace = {
    list: async (refresh = false): Promise<MarketEntry[]> =>
      as<MarketEntry[]>((await Marketplace.List(refresh)) ?? []).map((e) => ({
        ...e,
        item: {
          ...e.item,
          tags: e.item.tags ?? [],
          screenshots: e.item.screenshots ?? [],
          permissions: e.item.permissions ?? [],
          network: e.item.network ?? [],
          files: e.item.files ?? [],
        },
      })),
    install: (kind: string, id: string) => Marketplace.Install(kind, id),
    uninstall: (kind: string, id: string) => Marketplace.Uninstall(kind, id),
  };

  status = {
    list: async (all: boolean): Promise<StatusGroup[]> =>
      ((await Status.List(all)) ?? []).map((g) => ({
        ...g,
        items: (g.items ?? []).map((it) => ({ ...it, message: message(it.message) })),
      })),
    view: (pk: MessagePK, ghost: boolean): Promise<boolean> => Status.View(pk, ghost),
  };

  media = {
    url: (pk: MessagePK, thumb = false) =>
      `/wz-media/${encodeURIComponent(pk)}${thumb ? '?thumb=1' : ''}`,
    avatarUrl: (jid: JID, full = false) =>
      `/wz-avatar/${encodeURIComponent(jid)}${full ? '?full=1' : ''}`,
    canAttach: true,
    saveAs: async (pk: MessagePK): Promise<string | null> => (await Media.SaveAs(pk)) || null,
    copy: (pk: MessagePK) => Media.Copy(pk),
    reveal: (pk: MessagePK) => Media.Reveal(pk),
  };

  settings = {
    get: async (): Promise<AppSettings> => {
      const stored = await Settings.Get(SETTINGS_KEY);
      // first launch in the desktop app: nothing in Go yet, so take over what the mock had
      if (stored == null) return this.mock.settings.get();
      return withDefaults(stored);
    },
    set: (s: AppSettings): Promise<void> => Settings.Set(SETTINGS_KEY, s),
  };

  system = {
    version: () => System.Version(),
    platform: () => System.Platform(),
    isSafeMode: () => System.IsSafeMode(),
    bootOK: () => System.BootOK(),
    openExternal: (url: string) => System.OpenExternal(url),
    openConfigFolder: (kind: ConfigFolder) => System.OpenConfigFolder(kind),
  };

  systemTheme = {
    get: async (): Promise<SystemPalette> => normalizePalette(await SystemTheme.Get()),
  };

  userThemes = {
    list: async (): Promise<UserTheme[]> => (await Themes.List()) ?? [],
    href: (file: string, hash: string) => this.mock.userThemes.href(file, hash),
    packages: async (): Promise<UserThemePackage[]> =>
      ((await Themes.Packages()) ?? []).map((p) => ({
        error: p.error,
        css: (p.css ?? {}) as Record<string, string>,
        manifest: {
          ...p.manifest,
          layout: (p.manifest.layout || undefined) as 'panels' | 'rail' | undefined,
          modules: (p.manifest.modules ?? []).map((m) => ({
            ...m,
            default: m.default ?? undefined,
          })),
        },
      })),
    pickWallpaper: async (): Promise<string | null> => (await Themes.PickWallpaper()) || null,
    wallpaperUrl: (rel: string) => this.mock.userThemes.wallpaperUrl(rel),
  };

  window = {
    setTheme: (dark: boolean, background: string) => Window.SetTheme(dark, background),
    setUnread: (count: number) => Window.SetUnread(count),
  };

  on<E extends BackendEventName>(event: E, handler: (payload: BackendEvents[E]) => void) {
    return Events.On(event, (e) => {
      let data: unknown = e.data;
      if (event === WZ_EVENTS.systemThemeChanged) data = normalizePalette(e.data as GoPalette);
      else if (event === 'msg:batch')
        data = { messages: ((e.data as Go.MsgBatchEvent).messages ?? []).map(message) };
      else if (event === 'msg:reaction') {
        const r = e.data as Go.MsgReactionEvent;
        data = { ...r, reactions: r.reactions ?? [] };
      }
      handler(data as BackendEvents[E]);
    });
  }
}
