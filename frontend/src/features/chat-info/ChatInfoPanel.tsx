import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  FileText,
  History,
  Image as ImageIcon,
  Link2,
  Lock,
  Pin,
  PinOff,
  Play,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { backend, type Chat, type ChatInfo, type GroupMember } from '../../api';
import { formatDateTime, formatDuration, pluralize } from '../../lib/format';
import { useChats } from '../../stores/chats';
import { useProfile } from '../../stores/profile';
import { useUI } from '../../stores/ui';
import { Avatar, IconButton, Input, Spinner, Toggle, useLayer } from '../../ui';
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

function MediaGrid({ chat, info }: { chat: Chat; info: ChatInfo }) {
  const total = info.mediaCount + info.docCount + info.linkCount;
  return (
    <Section>
      <div className="wz-info__row wz-info__row--static">
        <ImageIcon size={18} aria-hidden="true" />
        <span className="wz-info__row-label">Media, links and docs</span>
        <span className="wz-info__row-value">{total}</span>
      </div>
      {info.recentMedia.length > 0 && (
        <div className="wz-info__media">
          {info.recentMedia.map((m) => (
            <button
              key={m.pk}
              type="button"
              className="wz-info__thumb"
              aria-label={`${m.kind === 'video' ? 'Video' : 'Photo'}, show in chat`}
              onClick={() => useUI.getState().jumpTo(chat.jid, m.pk)}
            >
              {m.kind === 'video' ? <Play size={18} /> : <ImageIcon size={18} />}
              {m.kind === 'video' && m.duration != null && (
                <span className="wz-info__thumb-duration">{formatDuration(m.duration)}</span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="wz-info__counts">
        <span>
          <ImageIcon size={14} aria-hidden="true" />{' '}
          {pluralize(info.mediaCount, 'photo/video', 'photos/videos')}
        </span>
        <span>
          <FileText size={14} aria-hidden="true" /> {pluralize(info.docCount, 'doc')}
        </span>
        <span>
          <Link2 size={14} aria-hidden="true" /> {pluralize(info.linkCount, 'link')}
        </span>
      </div>
    </Section>
  );
}

function Members({ chat, members }: { chat: Chat; members: GroupMember[] }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const chats = useChats((s) => s.chats);
  const profileName = useProfile((s) => s.profile.name);
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
            aria-label={`Search members of ${chat.name}`}
            placeholder="Search members"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      <ul className="wz-info__members">
        {shown.map((m) => {
          const direct = !m.isMe ? chats[m.jid] : undefined;
          const body = (
            <>
              <Avatar name={m.isMe ? profileName || 'You' : m.name} size={40} />
              <span className="wz-info__member-text">
                <span className="wz-info__member-name">{m.isMe ? 'You' : m.name}</span>
                {!m.isMe && <span className="wz-info__member-phone">{m.phone}</span>}
              </span>
              {m.isAdmin && <span className="wz-info__admin">Group admin</span>}
            </>
          );
          return (
            <li key={m.jid}>
              {direct ? (
                <button
                  type="button"
                  className="wz-info__member"
                  title={`Open chat with ${m.name}`}
                  onClick={() => useUI.getState().openChat(direct.jid)}
                >
                  {body}
                </button>
              ) : (
                <div className="wz-info__member wz-info__member--static">{body}</div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="wz-empty-text">No members match “{query}”</li>}
      </ul>
    </Section>
  );
}

export function ChatInfoPanel({ chat }: { chat: Chat }) {
  const [info, setInfo] = useState<ChatInfo | null>(null);
  const close = () => useUI.getState().setChatInfoOpen(false);
  const chats = useChats.getState();
  useLayer(true, close);

  // refetch when the chat changes, e.g. a new message lands or something gets deleted
  const lastPk = chat.lastMessage?.pk;
  const lastDeleted = chat.lastMessage?.deleted;
  useEffect(() => {
    let alive = true;
    void backend.chats.getInfo(chat.jid).then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, [chat.jid, lastPk, lastDeleted]);

  const ready = info?.jid === chat.jid ? info : null;

  return (
    <aside className="wz-info" aria-label={chat.isGroup ? 'Group info' : 'Contact info'}>
      <header className="wz-info__header">
        <IconButton label="Close" hint="Esc" icon={<X size={18} />} onClick={close} />
        <h2 className="wz-info__title">{chat.isGroup ? 'Group info' : 'Contact info'}</h2>
      </header>

      <div className="wz-info__scroll">
        <div className="wz-info__hero">
          <Avatar name={chat.name} size={112} group={chat.isGroup} />
          <h3 className="wz-info__name wz-selectable">{chat.name}</h3>
          <p className="wz-info__sub wz-selectable">
            {chat.isGroup
              ? `Group · ${pluralize(ready?.members?.length ?? chat.memberCount ?? 0, 'member')}`
              : (ready?.phone ?? ' ')}
          </p>
          <div className="wz-info__actions">
            <QuickAction
              icon={chat.muted ? <Bell size={20} /> : <BellOff size={20} />}
              label={chat.muted ? 'Unmute' : 'Mute'}
              onClick={() => void chats.setMuted(chat.jid, !chat.muted)}
            />
            <QuickAction
              icon={chat.pinned ? <PinOff size={20} /> : <Pin size={20} />}
              label={chat.pinned ? 'Unpin' : 'Pin'}
              onClick={() => void chats.setPinned(chat.jid, !chat.pinned)}
            />
            <QuickAction
              icon={chat.archived ? <ArchiveRestore size={20} /> : <Archive size={20} />}
              label={chat.archived ? 'Unarchive' : 'Archive'}
              onClick={() => void chats.setArchived(chat.jid, !chat.archived)}
            />
          </div>
        </div>

        {!ready ? (
          <div className="wz-info__loading">
            <Spinner size={18} />
          </div>
        ) : (
          <>
            <Section title={chat.isGroup ? 'Description' : 'About'}>
              <p
                className={`wz-info__about wz-selectable${ready.about ? '' : ' wz-info__about--empty'}`}
              >
                {ready.about || 'No group description'}
              </p>
            </Section>

            <MediaGrid chat={chat} info={ready} />

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

            <Section>
              <div className="wz-info__toggle">
                <Toggle
                  label="Mute notifications"
                  checked={chat.muted}
                  onChange={(on) => void chats.setMuted(chat.jid, on)}
                />
              </div>
            </Section>

            {ready.members && <Members chat={chat} members={ready.members} />}

            {chat.isGroup && ready.createdAt && (
              <p className="wz-info__footer">
                Created{ready.createdBy ? ` by ${ready.createdBy}` : ''},{' '}
                {formatDateTime(ready.createdAt)}
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
