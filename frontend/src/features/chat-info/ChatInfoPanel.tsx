import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Ban,
  Bell,
  BellOff,
  ChevronRight,
  Download,
  Eraser,
  FileText,
  History,
  Image as ImageIcon,
  Link2,
  ListPlus,
  Lock,
  LogOut,
  MessageSquareText,
  Pin,
  PinOff,
  Play,
  Search,
  Star,
  StarOff,
  Trash2,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import {
  backend,
  type Chat,
  type ChatInfo,
  type GroupMember,
  type JID,
  type MediaRef,
  type SharedKind,
} from '../../api';
import { formatDateTime, formatDuration, pluralize } from '../../lib/format';
import { useChats } from '../../stores/chats';
import { useProfile } from '../../stores/profile';
import { toastError, useToasts } from '../../stores/toasts';
import { useUI } from '../../stores/ui';
import { Avatar, Button, Dialog, IconButton, Input, Spinner, Toggle, useLayer } from '../../ui';
import { ListsDialog } from '../chat-list/ListsDialog';
import { ExportDialog } from './ExportDialog';
import { MembershipDialog } from './MembershipDialog';
import { SharedMedia } from './SharedMedia';
import { DisappearingSection } from './Disappearing';
import { toPluginChat } from '../conversation/plugin-adapters';
import { PluginSlot } from '../../plugin-core/slots';
import './ChatInfoPanel.css';

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="wz-info__action" onClick={onClick}>
      <span className="wz-info__action-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="wz-info__action-label">{label}</span>
    </button>
  );
}

function Section({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="wz-info__section">
      {title && <h3 className="wz-info__section-title">{title}</h3>}
      {children}
    </section>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
  danger,
  hint,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      className={`wz-info__row wz-info__row--button${danger ? ' wz-info__row--danger' : ''}`}
      onClick={onClick}
    >
      {icon}
      <span className="wz-info__row-label">
        {label}
        {hint && <span className="wz-info__row-hint">{hint}</span>}
      </span>
    </button>
  );
}

interface Confirm {
  title: string;
  text: string;
  action: string;
  run: () => Promise<void>;
}

function ConfirmDialog({ c, onClose }: { c: Confirm; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      title={c.title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await c.run();
                onClose();
              } catch (err) {
                toastError(err);
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner size={14} /> : c.action}
          </Button>
        </>
      }
    >
      <p className="wz-dialog-text">{c.text}</p>
    </Dialog>
  );
}

function Thumb({ m, onOpen }: { m: MediaRef; onOpen: () => void }) {
  const [ok, setOk] = useState(true);
  const src = backend.media.url(m.pk, true);
  return (
    <button
      type="button"
      className="wz-info__thumb"
      aria-label={m.kind === 'video' ? 'Open video' : 'Open photo'}
      onClick={onOpen}
    >
      {src && ok ? (
        <img src={src} alt="" loading="lazy" draggable={false} onError={() => setOk(false)} />
      ) : m.kind === 'video' ? (
        <Play size={18} />
      ) : (
        <ImageIcon size={18} />
      )}
      {m.kind === 'video' && m.duration != null && (
        <span className="wz-info__thumb-duration">{formatDuration(m.duration)}</span>
      )}
    </button>
  );
}

function MediaSection({
  jid,
  info,
  onOpenShared,
}: {
  jid: JID;
  info: ChatInfo;
  onOpenShared: (kind: SharedKind) => void;
}) {
  const total = info.mediaCount + info.docCount + info.linkCount;
  const open = async (pk: string) => {
    // the viewer walks the same media as the gallery, not just what's loaded in the chat
    try {
      const page = await backend.messages.listShared(jid, 'media', null, 120);
      useUI.getState().openViewer(jid, pk, page.messages);
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <Section>
      <button
        type="button"
        className="wz-info__row wz-info__row--button"
        onClick={() => onOpenShared('media')}
      >
        <ImageIcon size={18} aria-hidden="true" />
        <span className="wz-info__row-label">Media, links and docs</span>
        <span className="wz-info__row-value">{total}</span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      {info.recentMedia.length > 0 && (
        <div className="wz-info__media">
          {info.recentMedia.map((m) => (
            <Thumb key={m.pk} m={m} onOpen={() => void open(m.pk)} />
          ))}
        </div>
      )}
      <div className="wz-info__counts">
        <button type="button" onClick={() => onOpenShared('media')}>
          <ImageIcon size={14} aria-hidden="true" />{' '}
          {pluralize(info.mediaCount, 'photo/video', 'photos/videos')}
        </button>
        <button type="button" onClick={() => onOpenShared('docs')}>
          <FileText size={14} aria-hidden="true" /> {pluralize(info.docCount, 'doc')}
        </button>
        <button type="button" onClick={() => onOpenShared('links')}>
          <Link2 size={14} aria-hidden="true" /> {pluralize(info.linkCount, 'link')}
        </button>
      </div>
    </Section>
  );
}

function Members({
  group,
  members,
  onRemove,
}: {
  group: Chat | undefined;
  members: GroupMember[];
  onRemove: (m: GroupMember) => void;
}) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const profileName = useProfile((s) => s.profile.name);
  const meAdmin = members.some((m) => m.isMe && m.isAdmin);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? members.filter((m) => `${m.name} ${m.phone}`.toLowerCase().includes(q)) : members;
  }, [members, query]);

  return (
    <Section
      title={
        <span className="wz-info__section-title-row">
          {pluralize(members.length, 'member')}
          <IconButton
            label="Search members"
            size="sm"
            icon={<Search size={15} />}
            active={searching}
            onClick={() => {
              setSearching((v) => !v);
              setQuery('');
            }}
          />
        </span>
      }
    >
      {searching && (
        <div className="wz-info__member-search">
          <Input
            type="search"
            aria-label={`Search members of ${group?.name ?? 'the group'}`}
            placeholder="Search members"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      <ul className="wz-info__members">
        {shown.map((m) => {
          const body = (
            <>
              <Avatar name={m.isMe ? profileName || 'You' : m.name} jid={m.jid} size={40} />
              <span className="wz-info__member-text">
                <span className="wz-info__member-name">{m.isMe ? 'You' : m.name}</span>
                {!m.isMe && <span className="wz-info__member-phone">{m.phone}</span>}
              </span>
              {m.isAdmin && <span className="wz-info__admin">Group admin</span>}
            </>
          );
          return (
            <li key={m.jid} className="wz-info__member-row">
              {m.isMe ? (
                <div className="wz-info__member wz-info__member--static">{body}</div>
              ) : (
                <button
                  type="button"
                  className="wz-info__member"
                  title={`About ${m.name}`}
                  onClick={() => useUI.getState().openInfo(m.jid)}
                >
                  {body}
                </button>
              )}
              {meAdmin && !m.isMe && (
                <IconButton
                  label={`Remove ${m.name} from the group`}
                  size="sm"
                  className="wz-info__member-remove"
                  icon={<UserMinus size={15} />}
                  onClick={() => onRemove(m)}
                />
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="wz-empty-text">No members match “{query}”</li>}
      </ul>
    </Section>
  );
}

type Dialogs =
  | { kind: 'confirm'; c: Confirm }
  | { kind: 'export' }
  | { kind: 'members' }
  | { kind: 'lists' }
  | null;

// keyed by whose info it is, so switching person starts on the overview again
export function ChatInfoPanel({ chat }: { chat: Chat }) {
  const infoJid = useUI((s) => s.infoJid);
  return <Panel key={infoJid ?? chat.jid} chat={chat} infoJid={infoJid} />;
}

function Panel({ chat, infoJid }: { chat: Chat; infoJid: JID | null }) {
  const jid = infoJid ?? chat.jid;
  const target = useChats((s) => s.chats[jid]);
  const [info, setInfo] = useState<ChatInfo | null>(null);
  const [shared, setShared] = useState<SharedKind | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [reload, setReload] = useState(0);
  const isGroup = target?.isGroup ?? jid.endsWith('@g.us');
  const nested = infoJid !== null && infoJid !== chat.jid;
  const chats = useChats.getState();
  const desktop = backend.kind === 'wails';

  // Esc steps back: shared media -> info -> the group you came from -> closed
  const back = () => {
    if (shared) setShared(null);
    else if (nested) useUI.getState().openInfo(null);
    else useUI.getState().setChatInfoOpen(false);
  };
  useLayer(dialog === null, back);

  const lastPk = target?.lastMessage?.pk;
  const lastDeleted = target?.lastMessage?.deleted;
  useEffect(() => {
    let alive = true;
    backend.chats
      .getInfo(jid)
      .then((i) => alive && setInfo(i))
      .catch((err) => {
        toastError(err);
        if (alive) setInfo(null);
      });
    return () => {
      alive = false;
    };
  }, [jid, lastPk, lastDeleted, reload]);

  const ready = info?.jid === jid ? info : null;
  const name = target?.name ?? ready?.name ?? '';
  const confirm = (c: Confirm) => setDialog({ kind: 'confirm', c });
  const done = (text: string) => useToasts.getState().push({ kind: 'info', text });

  const actions: ReactNode[] = [];
  if (target) {
    actions.push(
      <ActionRow
        key="fav"
        icon={target.favorite ? <StarOff size={18} /> : <Star size={18} />}
        label={target.favorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={() => void chats.setFavorite(jid, !target.favorite)}
      />,
      <ActionRow
        key="lists"
        icon={<ListPlus size={18} />}
        label="Add to list…"
        onClick={() => setDialog({ kind: 'lists' })}
      />,
    );
    if (isGroup)
      actions.push(
        <ActionRow
          key="log"
          icon={<Users size={18} />}
          label="Membership changes"
          onClick={() => setDialog({ kind: 'members' })}
        />,
      );
    if (desktop)
      actions.push(
        <ActionRow
          key="export"
          icon={<Download size={18} />}
          label="Export chat…"
          onClick={() => setDialog({ kind: 'export' })}
        />,
      );
    actions.push(
      <ActionRow
        key="clear"
        icon={<Eraser size={18} />}
        label="Clear chat"
        hint="On this computer only"
        danger
        onClick={() =>
          confirm({
            title: `Clear chat with ${name}?`,
            text: 'Every message in this chat is removed from WhatsZori on this computer, including kept deleted messages and edit history. Your phone and the other people keep theirs.',
            action: 'Clear chat',
            run: async () => {
              await backend.chats.clear(jid);
              done('Chat cleared');
            },
          })
        }
      />,
    );
  }
  if (!isGroup && ready && !target?.channel)
    actions.push(
      <ActionRow
        key="block"
        icon={<Ban size={18} />}
        label={ready.blocked ? `Unblock ${name}` : `Block ${name}`}
        danger={!ready.blocked}
        onClick={() =>
          ready.blocked
            ? void backend.chats
                .setBlocked(jid, false)
                .then(() => {
                  done(`${name} is unblocked`);
                  setReload((n) => n + 1);
                })
                .catch(toastError)
            : confirm({
                title: `Block ${name}?`,
                text: 'Blocked contacts can’t call you or send you messages, and won’t see your last seen, online status or profile photo changes. This applies to your whole account.',
                action: 'Block',
                run: async () => {
                  await backend.chats.setBlocked(jid, true);
                  done(`${name} is blocked`);
                  setReload((n) => n + 1);
                },
              })
        }
      />,
    );
  if (isGroup && target)
    actions.push(
      <ActionRow
        key="leave"
        icon={<LogOut size={18} />}
        label="Leave group"
        danger
        onClick={() =>
          confirm({
            title: `Leave “${name}”?`,
            text: 'You won’t get new messages from this group. The chat and its history stay here, like on the phone.',
            action: 'Leave group',
            run: async () => {
              await backend.chats.leave(jid);
              done(`You left ${name}`);
              setReload((n) => n + 1);
            },
          })
        }
      />,
    );
  if (!isGroup && target)
    actions.push(
      <ActionRow
        key="delete"
        icon={<Trash2 size={18} />}
        label="Delete chat"
        hint="On all your devices"
        danger
        onClick={() =>
          confirm({
            title: `Delete chat with ${name}?`,
            text: 'The chat is deleted on your phone and every linked device, and removed from WhatsZori with all kept messages. This can’t be undone.',
            action: 'Delete chat',
            run: async () => {
              await backend.chats.delete(jid);
              useUI.getState().setChatInfoOpen(false);
              done('Chat deleted');
            },
          })
        }
      />,
    );

  return (
    <aside className="wz-info" aria-label={isGroup ? 'Group info' : 'Contact info'}>
      <header className="wz-info__header">
        {shared || nested ? (
          <IconButton label="Back" hint="Esc" icon={<ArrowLeft size={18} />} onClick={back} />
        ) : (
          <IconButton label="Close" hint="Esc" icon={<X size={18} />} onClick={back} />
        )}
        <h2 className="wz-info__title">
          {shared
            ? 'Media, links and docs'
            : target?.channel
              ? 'Channel info'
              : isGroup
                ? 'Group info'
                : 'Contact info'}
        </h2>
        {nested && !shared && (
          <IconButton
            label="Close"
            icon={<X size={18} />}
            className="wz-info__header-close"
            onClick={() => useUI.getState().setChatInfoOpen(false)}
          />
        )}
      </header>

      <div className="wz-info__scroll">
        {shared ? (
          <SharedMedia jid={jid} initial={shared} />
        ) : (
          <>
            <div className="wz-info__hero">
              <button
                type="button"
                className="wz-avatar-open"
                aria-label="Show the profile picture"
                onClick={() => useUI.getState().setAvatarViewer({ jid, name: name || jid })}
              >
                <Avatar name={name || ' '} jid={jid} size={112} group={isGroup} />
              </button>
              <h3 className="wz-info__name wz-selectable">{name}</h3>
              <p className="wz-info__sub wz-selectable">
                {isGroup
                  ? `Group · ${pluralize(ready?.members?.length ?? target?.memberCount ?? 0, 'member')}`
                  : target?.channel
                    ? `Channel · ${target.channel.followers.toLocaleString('en')} followers`
                    : (ready?.phone ?? ' ')}
              </p>
              <div className="wz-info__actions">
                {nested && !isGroup && (
                  <QuickAction
                    icon={<MessageSquareText size={20} />}
                    label="Message"
                    onClick={() => void chats.openWith(jid)}
                  />
                )}
                {target && (
                  <>
                    <QuickAction
                      icon={target.muted ? <Bell size={20} /> : <BellOff size={20} />}
                      label={target.muted ? 'Unmute' : 'Mute'}
                      onClick={() => void chats.setMuted(jid, !target.muted)}
                    />
                    <QuickAction
                      icon={target.pinned ? <PinOff size={20} /> : <Pin size={20} />}
                      label={target.pinned ? 'Unpin' : 'Pin'}
                      onClick={() => void chats.setPinned(jid, !target.pinned)}
                    />
                    <QuickAction
                      icon={target.archived ? <ArchiveRestore size={20} /> : <Archive size={20} />}
                      label={target.archived ? 'Unarchive' : 'Archive'}
                      onClick={() => void chats.setArchived(jid, !target.archived)}
                    />
                  </>
                )}
              </div>
            </div>

            {!ready ? (
              <div className="wz-info__loading">
                <Spinner size={18} />
              </div>
            ) : (
              <>
                <Section title={isGroup ? 'Description' : 'About'}>
                  <p
                    className={`wz-info__about wz-selectable${ready.about ? '' : ' wz-info__about--empty'}`}
                  >
                    {ready.about || (isGroup ? 'No group description' : 'Nothing here')}
                  </p>
                </Section>

                {!ready.noChat && <MediaSection jid={jid} info={ready} onOpenShared={setShared} />}

                <PluginSlot
                  name="chatInfo.sections"
                  className="wz-info__plugins"
                  props={{ chat: toPluginChat(chat) }}
                />

                {!ready.noChat && (
                  <Section title="Kept by WhatsZori">
                    <div className="wz-info__row wz-info__row--static">
                      <Trash2 size={18} aria-hidden="true" />
                      <span className="wz-info__row-label">Deleted messages kept</span>
                      <span className="wz-info__row-value">{ready.deletedKept}</span>
                    </div>
                    <div className="wz-info__row wz-info__row--static">
                      <History size={18} aria-hidden="true" />
                      <span className="wz-info__row-label">Edited messages with history</span>
                      <span className="wz-info__row-value">{ready.edited}</span>
                    </div>
                    <div className="wz-info__row wz-info__row--static wz-info__row--note">
                      <Lock size={18} aria-hidden="true" />
                      <span className="wz-info__row-label">
                        Messages are end-to-end encrypted. This copy, including deleted and edited
                        messages, is stored only on this computer.
                      </span>
                    </div>
                  </Section>
                )}

                {target && !ready.noChat && !target.channel && (
                  <DisappearingSection chat={target} />
                )}

                {target && (
                  <Section>
                    <div className="wz-info__toggle">
                      <Toggle
                        label="Mute notifications"
                        checked={target.muted}
                        onChange={(on) => void chats.setMuted(jid, on)}
                      />
                    </div>
                  </Section>
                )}

                {ready.members && (
                  <Members
                    group={target}
                    members={ready.members}
                    onRemove={(m) =>
                      confirm({
                        title: `Remove ${m.name}?`,
                        text: `${m.name} will be removed from “${name}”. They can only come back if an admin adds them or they use an invite link.`,
                        action: 'Remove',
                        run: async () => {
                          await backend.chats.removeMember(jid, m.jid);
                          done(`${m.name} was removed`);
                          setReload((n) => n + 1);
                        },
                      })
                    }
                  />
                )}

                {actions.length > 0 && <Section>{actions}</Section>}

                {isGroup && ready.createdAt && (
                  <p className="wz-info__footer">
                    Created{ready.createdBy ? ` by ${ready.createdBy}` : ''},{' '}
                    {formatDateTime(ready.createdAt)}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>

      {dialog?.kind === 'confirm' && <ConfirmDialog c={dialog.c} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'export' && (
        <ExportDialog jid={jid} name={name} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'members' && <MembershipDialog jid={jid} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'lists' && <ListsDialog jid={jid} onClose={() => setDialog(null)} />}
    </aside>
  );
}
