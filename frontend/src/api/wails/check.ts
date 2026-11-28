// Compile-time check that the hand-written types in api/types.ts and api/events.ts still match
// what the binding generator produced from the Go structs. Nothing here runs.
import type * as Generated from '../../../bindings/events';
import type * as Go from '../../../bindings/github.com/whatszori/WhatsZori/internal/domain/models';
import type { SystemPalette as GoPalette } from '../../../bindings/github.com/whatszori/WhatsZori/internal/systheme/models';
import type {
  Changed as GoThemeChanged,
  Info as GoThemeInfo,
  Manifest as GoThemeManifest,
  Package as GoThemePackage,
} from '../../../bindings/github.com/whatszori/WhatsZori/internal/themes/models';
import type { MarketEntry as GoMarketEntry } from '../../../bindings/github.com/whatszori/WhatsZori/internal/services/models';
import type { Item as GoMarketItem } from '../../../bindings/github.com/whatszori/WhatsZori/internal/market/models';
import type { Item as GoAttachment } from '../../../bindings/github.com/whatszori/WhatsZori/internal/uploads/models';
import type { InAppToast, SystemPalette, ThemeFileChanged, WaEventName } from '../events';
import { WA_EVENTS, WZ_EVENTS } from '../events';
import type * as T from '../types';

type Assert<X extends true> = X;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Keys<X> = keyof X & string;
type SameKeys<A, B> = Same<Keys<A>, Keys<B>>;
type Payload<E extends keyof T.BackendEvents> = T.BackendEvents[E];

// every generated event name, as a union of string literals
type GeneratedNames = (typeof Generated)[keyof typeof Generated];

export type Checks = [
  Assert<SameKeys<SystemPalette, GoPalette>>,
  Assert<SameKeys<ThemeFileChanged, GoThemeChanged>>,
  Assert<SameKeys<T.UserTheme, GoThemeInfo>>,
  Assert<Same<(typeof WZ_EVENTS)['systemThemeChanged'], typeof Generated.WzSysthemeChanged>>,
  Assert<Same<(typeof WZ_EVENTS)['themeChanged'], typeof Generated.WzThemeChanged>>,

  // DTOs
  Assert<SameKeys<T.Message, Go.Message>>,
  Assert<SameKeys<T.Attachment, GoAttachment>>,
  Assert<SameKeys<T.MarketEntry, GoMarketEntry>>,
  Assert<SameKeys<T.MarketItem, GoMarketItem>>,
  Assert<SameKeys<T.MediaInfo, Go.MediaInfo>>,
  Assert<SameKeys<T.ReplyRef, Go.ReplyRef>>,
  Assert<SameKeys<T.Reaction, Go.Reaction>>,
  Assert<SameKeys<T.Mention, Go.Mention>>,
  Assert<SameKeys<T.MessageReceipts, Go.MessageReceipts>>,
  Assert<SameKeys<T.ReceiptPerson, Go.ReceiptPerson>>,
  Assert<SameKeys<T.LocationInfo, Go.LocationInfo>>,
  Assert<SameKeys<T.ContactCard, Go.ContactCard>>,
  Assert<SameKeys<T.ContactPhone, Go.ContactPhone>>,
  Assert<SameKeys<T.EventInfo, Go.EventInfo>>,
  Assert<SameKeys<T.BusinessInfo, Go.BusinessInfo>>,
  Assert<SameKeys<T.BizButton, Go.BizButton>>,
  Assert<SameKeys<T.BizList, Go.BizList>>,
  Assert<SameKeys<T.BizSection, Go.BizSection>>,
  Assert<SameKeys<T.BizRow, Go.BizRow>>,
  Assert<SameKeys<T.BizCard, Go.BizCard>>,
  Assert<SameKeys<T.DeletedInfo, Go.DeletedInfo>>,
  Assert<SameKeys<T.Chat, Go.Chat>>,
  Assert<SameKeys<T.MessagePreview, Go.MessagePreview>>,
  Assert<SameKeys<T.ChatInfo, Go.ChatInfo>>,
  Assert<SameKeys<T.GroupMember, Go.GroupMember>>,
  Assert<SameKeys<T.MediaRef, Go.MediaRef>>,
  Assert<SameKeys<T.EditVersion, Go.EditVersion>>,
  Assert<SameKeys<T.MessagePage, Go.MessagePage>>,
  Assert<SameKeys<T.SearchHit, Go.SearchHit>>,
  Assert<SameKeys<T.PollInfo, Go.PollInfo>>,
  Assert<SameKeys<T.StatusItem, Go.StatusItem>>,
  Assert<SameKeys<T.PluginInfo, Go.PluginInfo>>,
  Assert<SameKeys<T.Sticker, Go.Sticker>>,
  Assert<SameKeys<T.UserThemePackage, GoThemePackage>>,
  Assert<SameKeys<T.UserThemePackage['manifest'], GoThemeManifest>>,
  Assert<SameKeys<T.StatusGroup, Go.StatusGroup>>,
  Assert<SameKeys<T.ChangeItem, Go.ChangeItem>>,
  Assert<SameKeys<T.ChangePage, Go.ChangePage>>,
  Assert<SameKeys<T.PollOption, Go.PollOption>>,
  Assert<SameKeys<T.GhostSettings, Go.GhostSettings>>,
  Assert<SameKeys<T.Profile, Go.Profile>>,
  Assert<SameKeys<T.Me, Go.Me>>,
  Assert<SameKeys<T.AuthStatus, Go.AuthStatus>>,
  Assert<SameKeys<T.QRPayload, Go.QRPayload>>,
  Assert<SameKeys<T.Contact, Go.Contact>>,
  Assert<SameKeys<InAppToast, Go.InAppToast>>,
  Assert<SameKeys<T.ChatList, Go.ChatList>>,
  Assert<SameKeys<T.GroupEvent, Go.GroupEvent>>,
  Assert<SameKeys<T.ExportOptions, Go.ExportOptions>>,
  Assert<SameKeys<T.ExportProgress, Go.ExportProgressEvent>>,
  Assert<Same<`${Go.MessageKind}`, T.MessageKind | ''>>,
  Assert<Same<`${Go.MessageStatus}`, T.MessageStatus | ''>>,
  Assert<Same<`${Go.ConnState}`, T.ConnState | ''>>,
  Assert<Same<`${Go.AuthState}`, T.AuthState | ''>>,
  Assert<Same<`${Go.ReadReceiptMode}`, T.ReadReceiptMode | ''>>,

  // event payloads
  Assert<SameKeys<Payload<'auth:error'>, Go.AuthErrorEvent>>,
  Assert<SameKeys<Payload<'conn:state'>, Go.ConnStateEvent>>,
  Assert<SameKeys<Payload<'msg:batch'>, Go.MsgBatchEvent>>,
  Assert<SameKeys<Payload<'msg:status'>, Go.MsgStatusEvent>>,
  Assert<SameKeys<Payload<'msg:edited'>, Go.MsgEditedEvent>>,
  Assert<SameKeys<Payload<'msg:deleted'>, Go.MsgDeletedEvent>>,
  Assert<SameKeys<Payload<'msg:reaction'>, Go.MsgReactionEvent>>,
  Assert<SameKeys<Payload<'msg:removed'>, Go.MsgRemovedEvent>>,
  Assert<SameKeys<Payload<'chat:update'>, Go.ChatUpdateEvent>>,
  Assert<SameKeys<Payload<'chat:removed'>, Go.ChatRemovedEvent>>,
  Assert<SameKeys<Payload<'avatar:changed'>, Go.AvatarChangedEvent>>,
  Assert<SameKeys<Payload<'chat:cleared'>, Go.ChatRemovedEvent>>,
  Assert<SameKeys<Payload<'export:progress'>, Go.ExportProgressEvent>>,
  Assert<SameKeys<Payload<'notification:open'>, Go.NotificationOpenEvent>>,
  Assert<SameKeys<Payload<'presence'>, Go.PresenceEvent>>,
  Assert<SameKeys<Payload<'status:update'>, Go.StatusUpdateEvent>>,
  Assert<SameKeys<Payload<'chat:typing'>, Go.TypingEvent>>,
  Assert<SameKeys<Payload<'sync:progress'>, Go.SyncProgressEvent>>,
  Assert<SameKeys<Payload<'toast'>, Go.ToastEvent>>,

  // names: the WA event list, BackendEvents and what Go registered all agree
  Assert<Same<WaEventName | (typeof WZ_EVENTS)[keyof typeof WZ_EVENTS], GeneratedNames>>,
  Assert<Same<WaEventName | keyof import('../events').WzEvents, keyof T.BackendEvents>>,
  Assert<Same<(typeof WA_EVENTS)['msgBatch'], 'msg:batch'>>,
];
