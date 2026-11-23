import { useState } from 'react';
import { Copy, Forward, Trash2, X } from 'lucide-react';
import type { Chat } from '../../api';
import { copyText } from '../../lib/copy-messages';
import { canForward, useMessages } from '../../stores/messages';
import { useToasts } from '../../stores/toasts';
import { useUI } from '../../stores/ui';
import { Button, Dialog, IconButton, useLayer } from '../../ui';
import './Selection.css';

// Takes the composer's place while messages are selected.
export function SelectionBar({ chat }: { chat: Chat }) {
  const pks = useUI((s) => (s.selection?.jid === chat.jid ? s.selection.pks : []));
  const items = useMessages((s) => s.byChat[chat.jid]?.items);
  const [confirm, setConfirm] = useState(false);
  const clear = () => useUI.getState().clearSelection();
  useLayer(!confirm, clear);

  const picked = (items ?? []).filter((m) => pks.includes(m.pk));
  const forwardable = picked.length > 0 && picked.every(canForward);
  // "for everyone" only when every one of them is ours and still there
  const revocable = picked.length > 0 && picked.every((m) => m.fromMe && !m.deleted);
  const n = picked.length;

  const copy = () => {
    void navigator.clipboard?.writeText(copyText(picked)).then(() => {
      useToasts
        .getState()
        .push({ kind: 'info', text: n === 1 ? 'Copied' : `Copied ${n} messages` });
      clear();
    });
  };

  return (
    <div className="wz-selection-bar" role="toolbar" aria-label="Selected messages">
      <IconButton label="Cancel selection" hint="Esc" icon={<X size={18} />} onClick={clear} />
      <span className="wz-selection-bar__count" aria-live="polite">
        {n} selected
      </span>
      <IconButton
        label="Copy"
        icon={<Copy size={18} />}
        disabled={!picked.some((m) => m.text || m.media)}
        onClick={copy}
      />
      <IconButton
        label="Forward"
        icon={<Forward size={18} />}
        disabled={!forwardable}
        onClick={() => useUI.getState().setForwarding(picked.map((m) => m.pk))}
      />
      <IconButton
        label="Delete"
        icon={<Trash2 size={18} />}
        disabled={n === 0}
        onClick={() => setConfirm(true)}
      />

      <Dialog
        open={confirm}
        title={n === 1 ? 'Delete message?' : `Delete ${n} messages?`}
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant={revocable ? 'secondary' : 'danger'}
              onClick={() => {
                setConfirm(false);
                clear();
                void useMessages.getState().deleteLocal(
                  chat.jid,
                  picked.map((m) => m.pk),
                );
              }}
            >
              Delete for me
            </Button>
            {revocable && (
              <Button
                variant="danger"
                onClick={() => {
                  setConfirm(false);
                  clear();
                  for (const m of picked) void useMessages.getState().revoke(chat.jid, m.pk);
                }}
              >
                Delete for everyone
              </Button>
            )}
          </>
        }
      >
        <p className="wz-dialog-text">
          “Delete for me” removes {n === 1 ? 'it' : 'them'} from this computer only; your phone and
          the other people keep {n === 1 ? 'it' : 'them'}.
          {!revocable && picked.some((m) => m.fromMe) && (
            <> Only your own messages can be deleted for everyone, so select just those for that.</>
          )}
        </p>
      </Dialog>
    </div>
  );
}
