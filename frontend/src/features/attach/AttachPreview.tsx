import { useEffect, useRef } from 'react';
import { FileText, Film, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { JID } from '../../api';
import { formatFileSize, pluralize } from '../../lib/format';
import { useAttach, type DraftItem } from '../../stores/attach';
import { useChats } from '../../stores/chats';
import { toastError } from '../../stores/toasts';
import { Button, Dialog, IconButton, Spinner } from '../../ui';
import { ImageEditor } from './ImageEditor';
import { PluginSlot } from '../../plugin-core/slots';
import './Attach.css';

// pictures the editor can open; GIFs would lose their animation
const EDITABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'];

function titleFor(items: DraftItem[], asFiles: boolean): string {
  const n = items.length;
  const photos = !asFiles && items.every((it) => it.kind === 'image');
  if (photos) return n === 1 ? 'Send photo' : `Send ${n} photos`;
  return n === 1 ? 'Send file' : `Send ${pluralize(n, 'file')}`;
}

export function AttachPreview({ jid }: { jid: JID }) {
  const open = useAttach((s) => s.open && s.jid === jid && s.items.length > 0);
  const items = useAttach((s) => s.items);
  const asFiles = useAttach((s) => s.asFiles);
  const editing = useAttach((s) => s.editing);
  const chatName = useChats((s) => s.chats[jid]?.name ?? '');
  const st = useAttach.getState();
  const editItem = editing ? items.find((it) => it.token === editing) : undefined;

  return (
    <>
      <Dialog
        open={open}
        title={titleFor(items, asFiles)}
        onClose={() => useAttach.getState().close()}
        width={520}
        footer={open && <Footer chatName={chatName} />}
      >
        {open && <Body />}
      </Dialog>
      {open && editItem && (
        <ImageEditor
          key={editItem.token}
          url={editItem.url}
          name={editItem.name}
          mime={editItem.mime}
          onCancel={() => st.edit(null)}
          onDone={async (blob, name) => {
            try {
              await st.replace(editItem.token, blob, name);
            } catch (err) {
              toastError(err, "Couldn't save the edit");
            }
          }}
        />
      )}
    </>
  );
}

function Body() {
  const items = useAttach((s) => s.items);
  const current = useAttach((s) => Math.min(s.current, s.items.length - 1));
  const busy = useAttach((s) => !!s.progress);
  const jid = useAttach((s) => s.jid);
  const st = useAttach.getState();
  const item = items[current];
  const caption = useRef<HTMLInputElement>(null);

  useEffect(() => {
    caption.current?.focus({ preventScroll: true });
  }, [item?.token]);

  if (!item) return null;
  const editable = item.kind === 'image' && EDITABLE.includes(item.mime);

  return (
    <div className="wz-attach">
      <div className={`wz-attach__stage wz-attach__stage--${item.kind}`}>
        {item.kind === 'image' ? (
          <img
            src={item.url}
            alt={item.name}
            draggable={false}
            onDoubleClick={() => editable && !busy && st.edit(item.token)}
          />
        ) : item.kind === 'video' ? (
          <video src={item.url} controls preload="metadata" />
        ) : (
          <FileCard item={item} />
        )}
        <div className="wz-attach__actions">
          {!busy && (
            <PluginSlot
              name="attach.preview.actions"
              props={{
                file: {
                  name: item.name,
                  mime: item.mime,
                  size: item.size,
                  kind: item.kind,
                  url: item.url,
                },
                replace: (blob, name) => st.replace(item.token, blob, name),
                remove: () => st.remove(item.token),
              }}
            />
          )}
          {editable && (
            <IconButton
              label="Edit"
              size="sm"
              className="wz-attach__action"
              icon={<Pencil size={16} />}
              disabled={busy}
              onClick={() => st.edit(item.token)}
            />
          )}
          <IconButton
            label="Remove"
            size="sm"
            className="wz-attach__action"
            icon={<Trash2 size={16} />}
            disabled={busy}
            onClick={() => st.remove(item.token)}
          />
        </div>
      </div>

      <div
        className="wz-attach__strip"
        role="listbox"
        aria-label="Files"
        aria-orientation="horizontal"
      >
        {items.map((it, i) => (
          <div
            key={it.token}
            role="option"
            aria-selected={i === current}
            tabIndex={i === current ? 0 : -1}
            className="wz-attach__thumb"
            title={it.name}
            onClick={() => st.select(i)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') st.select(i + 1);
              else if (e.key === 'ArrowLeft') st.select(i - 1);
              else if (e.key === 'Delete' && !busy) st.remove(it.token);
            }}
          >
            {it.kind === 'image' ? (
              <img src={it.url} alt="" draggable={false} loading="lazy" />
            ) : it.kind === 'video' ? (
              <Film size={20} />
            ) : (
              <FileText size={20} />
            )}
            {items.length > 1 && !busy && (
              <button
                type="button"
                className="wz-attach__thumb-x"
                aria-label={`Remove ${it.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  st.remove(it.token);
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        {jid && !busy && (
          <button
            type="button"
            className="wz-attach__thumb wz-attach__add"
            aria-label="Add more"
            title="Add more (or paste with Ctrl+V)"
            onClick={() => void st.pick(jid)}
          >
            <Plus size={20} />
          </button>
        )}
      </div>

      <input
        ref={caption}
        className="wz-attach__caption"
        placeholder={items.length > 1 ? 'Caption for this one' : 'Add a caption'}
        aria-label="Caption"
        value={item.caption}
        maxLength={1024}
        disabled={busy}
        onChange={(e) => st.setCaption(item.token, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void st.send();
          } else if (e.key.toLowerCase() === 'e' && e.altKey && editable) {
            e.preventDefault();
            st.edit(item.token);
          }
        }}
      />
    </div>
  );
}

function FileCard({ item }: { item: DraftItem }) {
  const ext = item.name.includes('.') ? item.name.split('.').pop()!.slice(0, 5).toUpperCase() : '';
  return (
    <div className="wz-attach__file">
      <span className="wz-attach__file-icon">
        <FileText size={28} />
        {ext && <span>{ext}</span>}
      </span>
      <span className="wz-attach__file-text">
        <span className="wz-attach__file-name">{item.name}</span>
        <span className="wz-attach__file-size">{formatFileSize(item.size)}</span>
      </span>
    </div>
  );
}

function Footer({ chatName }: { chatName: string }) {
  const items = useAttach((s) => s.items);
  const asFiles = useAttach((s) => s.asFiles);
  const progress = useAttach((s) => s.progress);
  const st = useAttach.getState();
  const hasPhotos = items.some((it) => it.kind === 'image' && it.mime !== 'image/gif');

  return (
    <div className="wz-attach__footer">
      {hasPhotos ? (
        <label className="wz-attach__asfile" title="Full quality, with the file name">
          <input
            type="checkbox"
            checked={asFiles}
            disabled={!!progress}
            onChange={(e) => st.setAsFiles(e.target.checked)}
          />
          {items.length > 1 ? 'Send as files' : 'Send as a file'}
        </label>
      ) : (
        <span />
      )}
      <div className="wz-attach__buttons">
        <Button variant="ghost" onClick={() => st.close()}>
          {progress ? 'Hide' : 'Cancel'}
        </Button>
        <Button
          variant="primary"
          disabled={!!progress}
          title={chatName ? `Send to ${chatName}` : undefined}
          onClick={() => void st.send()}
        >
          {progress ? (
            <>
              <Spinner size={14} label="Sending" />
              {progress.total > 1 ? `Sending ${progress.done + 1} of ${progress.total}` : 'Sending'}
            </>
          ) : (
            'Send'
          )}
        </Button>
      </div>
    </div>
  );
}
