import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Check, Paperclip, Pencil, Reply, SendHorizontal, Smile, X } from 'lucide-react';
import type { Chat } from '../../api';
import { PluginSlot } from '../../plugin-core/slots';
import { canEdit, useMessages } from '../../stores/messages';
import { composerFor, useUI } from '../../stores/ui';
import { IconButton, Popover, type PopoverAnchor } from '../../ui';
import './Composer.css';

const MAX_LINES = 8;
const EMOJI = [
  '😀',
  '😂',
  '🙂',
  '😉',
  '😍',
  '🤔',
  '😅',
  '😢',
  '😮',
  '😴',
  '👍',
  '👎',
  '👏',
  '🙏',
  '💪',
  '🎉',
  '❤️',
  '🔥',
  '✅',
  '👀',
  '☕',
  '🍕',
  '🌧️',
  '🚀',
];

export function Composer({ chat }: { chat: Chat }) {
  const jid = chat.jid;
  const state = useUI((s) => composerFor(s, jid));
  const items = useMessages((s) => s.byChat[jid]?.items);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [emoji, setEmoji] = useState<PopoverAnchor | null>(null);
  const closeEmoji = useCallback(() => setEmoji(null), []);

  const replyMsg = state.replyTo ? items?.find((m) => m.pk === state.replyTo) : undefined;
  const editMsg = state.editing ? items?.find((m) => m.pk === state.editing) : undefined;
  const text = state.draft;
  const canSend = text.trim().length > 0;

  // focus when a chat opens
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [jid]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const max = lh * MAX_LINES + 16;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [text]);

  const ui = useUI.getState();

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    if (editMsg) {
      void useMessages.getState().edit(jid, editMsg.pk, value);
      ui.cancelComposerMode(jid);
      return;
    }
    void useMessages.getState().send(jid, value, state.replyTo ?? undefined);
    ui.setDraft(jid, '');
    if (state.replyTo) ui.cancelComposerMode(jid);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && (state.replyTo || state.editing)) {
      e.preventDefault();
      ui.cancelComposerMode(jid);
    } else if (e.key === 'ArrowUp' && !text && !state.editing && !e.altKey) {
      const last = [...(items ?? [])]
        .reverse()
        .find((m) => m.fromMe && !m.deleted && m.kind === 'text');
      if (last && canEdit(last)) {
        e.preventDefault();
        ui.startEdit(jid, last.pk, last.text);
      }
    }
  };

  const insert = (value: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    ui.setDraft(jid, text.slice(0, start) + value + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + value.length, start + value.length);
    });
  };

  const bar = editMsg ? (
    <ComposerBar
      icon={<Pencil size={16} />}
      title="Editing message"
      text={editMsg.text}
      onCancel={() => ui.cancelComposerMode(jid)}
    />
  ) : replyMsg ? (
    <ComposerBar
      icon={<Reply size={16} />}
      title={`Replying to ${replyMsg.fromMe ? 'yourself' : replyMsg.senderName}`}
      text={replyMsg.text || replyMsg.kind}
      onCancel={() => ui.cancelComposerMode(jid)}
    />
  ) : null;

  return (
    <div className="wz-composer">
      {bar}
      <div className="wz-composer__row">
        <IconButton
          label="Attach file"
          icon={<Paperclip size={18} />}
          tooltipPlacement="top"
          onClick={() => undefined}
        />
        <textarea
          ref={ref}
          className="wz-composer__input"
          rows={1}
          placeholder={chat.isGroup ? `Message ${chat.name}` : 'Write a message'}
          aria-label="Message"
          value={text}
          onChange={(e) => ui.setDraft(jid, e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck
        />
        <PluginSlot name="composer.actions" props={{ chatJid: jid, insertText: insert }} />
        <IconButton
          label="Emoji"
          icon={<Smile size={18} />}
          tooltipPlacement="top"
          aria-haspopup="dialog"
          aria-expanded={!!emoji}
          onClick={(e) => setEmoji(e.currentTarget.getBoundingClientRect())}
        />
        <IconButton
          label={editMsg ? 'Save edit' : 'Send'}
          hint="Enter"
          tooltipPlacement="top"
          className={`wz-composer__send${canSend ? ' wz-composer__send--ready' : ''}`}
          icon={editMsg ? <Check size={18} /> : <SendHorizontal size={18} />}
          disabled={!canSend}
          onClick={submit}
        />
      </div>
      <Popover
        open={!!emoji}
        anchor={emoji}
        onClose={closeEmoji}
        placement="top-end"
        ariaLabel="Emoji"
        className="wz-emoji-popover"
        restoreFocus={false}
      >
        <div className="wz-emoji-grid">
          {EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              className="wz-emoji-grid__item"
              aria-label={e}
              onClick={() => {
                insert(e);
                closeEmoji();
              }}
            >
              {e}
            </button>
          ))}
        </div>
        <p className="wz-emoji-popover__note">Full emoji picker coming later</p>
      </Popover>
    </div>
  );
}

function ComposerBar({
  icon,
  title,
  text,
  onCancel,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  onCancel: () => void;
}) {
  return (
    <div className="wz-composer__bar">
      <span className="wz-composer__bar-icon">{icon}</span>
      <div className="wz-composer__bar-text">
        <span className="wz-composer__bar-title">{title}</span>
        <span className="wz-composer__bar-preview">{text}</span>
      </div>
      <IconButton
        label="Cancel"
        hint="Esc"
        size="sm"
        icon={<X size={16} />}
        onClick={onCancel}
        tooltipPlacement="top"
      />
    </div>
  );
}
