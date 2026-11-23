import { useState } from 'react';
import {
  Copy,
  Download,
  Expand,
  History,
  ImageDown,
  Info,
  Pencil,
  Reply,
  Trash2,
} from 'lucide-react';
import { backend, type Chat, type Message } from '../../api';
import { PluginSlot } from '../../plugin-core/slots';
import { canEdit, useMessages } from '../../stores/messages';
import { toastError, useToasts } from '../../stores/toasts';
import { useUI } from '../../stores/ui';
import { Button, Dialog, Menu, type MenuEntry, type PopoverAnchor } from '../../ui';
import { toPluginMessage } from '../conversation/plugin-adapters';
import { MessageInfoDialog } from './MessageInfoDialog';
import './MessageMenu.css';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

interface Props {
  chat: Chat;
  target: { m: Message; anchor: PopoverAnchor } | null;
  onClose: () => void;
  onShowHistory: (m: Message, anchor: PopoverAnchor) => void;
}

function bubbleRect(pk: string): DOMRect | null {
  return document.querySelector(`[data-pk="${pk}"] .wz-bubble`)?.getBoundingClientRect() ?? null;
}

export function MessageMenu({ chat, target, onClose, onShowHistory }: Props) {
  const [confirmDelete, setConfirmDelete] = useState<Message | null>(null);
  const [info, setInfo] = useState<Message | null>(null);
  const m = target?.m;

  const focusComposer = () =>
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>('.wz-composer__input')?.focus(),
    );

  const items: MenuEntry[] = [];
  if (m && !m.contentUnknown) {
    items.push({
      id: 'reply',
      label: 'Reply',
      icon: <Reply />,
      onSelect: () => {
        useUI.getState().startReply(chat.jid, m.pk);
        focusComposer();
      },
    });
    // file actions only exist in the desktop app, where the media are real files
    if (m.media && backend.media.canAttach) {
      const visual = m.kind === 'image' || m.kind === 'video';
      if (visual)
        items.push({
          id: 'open',
          label: m.kind === 'video' ? 'Play' : 'Open',
          icon: <Expand />,
          onSelect: () => useUI.getState().openViewer(chat.jid, m.pk),
        });
      items.push(
        {
          id: 'copy-media',
          label:
            m.kind === 'image' ? 'Copy image' : m.kind === 'video' ? 'Copy video' : 'Copy file',
          icon: <ImageDown />,
          onSelect: () =>
            void backend.media
              .copy(m.pk)
              .then(() =>
                useToasts.getState().push({ kind: 'info', text: 'Copied to the clipboard' }),
              )
              .catch((err) => toastError(err)),
        },
        {
          id: 'save',
          label: 'Save as…',
          icon: <Download />,
          onSelect: () =>
            void backend.media
              .saveAs(m.pk)
              .then((path) => {
                if (path)
                  useToasts
                    .getState()
                    .push({ kind: 'info', text: `Saved as ${path.split(/[\\/]/).pop()}` });
              })
              .catch((err) => toastError(err)),
        },
      );
    }
    if (m.text)
      items.push({
        id: 'copy',
        label: 'Copy text',
        icon: <Copy />,
        onSelect: () => void navigator.clipboard?.writeText(m.text),
      });
    if (canEdit(m))
      items.push({
        id: 'edit',
        label: 'Edit',
        icon: <Pencil />,
        onSelect: () => {
          useUI.getState().startEdit(chat.jid, m.pk, m.text);
          focusComposer();
        },
      });
    if (m.editedAt)
      items.push({
        id: 'history',
        label: 'Show edit history',
        icon: <History />,
        onSelect: () => {
          const r = bubbleRect(m.pk);
          if (r) onShowHistory(m, r);
        },
      });
  }
  if (m) {
    items.push({ id: 'info', label: 'Info', icon: <Info />, onSelect: () => setInfo(m) });
    if (m.fromMe && !m.deleted)
      items.push(
        { kind: 'separator', id: 's-del' },
        {
          id: 'delete',
          label: 'Delete for everyone',
          icon: <Trash2 />,
          danger: true,
          onSelect: () => setConfirmDelete(m),
        },
      );
  }

  const reactionRow =
    m && !m.contentUnknown && !m.deleted ? (
      <div className="wz-quick-reactions" role="group" aria-label="React">
        {QUICK_REACTIONS.map((emoji) => {
          const mine = m.reactions.some((r) => r.mine && r.emoji === emoji);
          return (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-label={`React with ${emoji}`}
              aria-pressed={mine}
              className={`wz-quick-reactions__item${mine ? ' wz-quick-reactions__item--mine' : ''}`}
              onClick={() => {
                onClose();
                void useMessages.getState().react(chat.jid, m.pk, emoji);
              }}
            >
              {emoji}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <>
      <Menu
        open={!!target}
        anchor={target?.anchor ?? null}
        onClose={onClose}
        items={items}
        label="Message actions"
        header={reactionRow}
      >
        {m && (
          <PluginSlot
            name="message.contextMenu"
            props={{ message: toPluginMessage(m), close: onClose }}
          />
        )}
      </Menu>

      <Dialog
        open={!!confirmDelete}
        title="Delete for everyone?"
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                const d = confirmDelete;
                setConfirmDelete(null);
                if (d) void useMessages.getState().revoke(chat.jid, d.pk);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="wz-dialog-text">
          The message will be removed for everyone in this chat. People using clients that keep
          deleted messages may still see it.
        </p>
      </Dialog>

      <MessageInfoDialog message={info} onClose={() => setInfo(null)} />
    </>
  );
}
