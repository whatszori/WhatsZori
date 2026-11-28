import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  BarChart3,
  CalendarPlus,
  Check,
  Contact,
  Image as ImageIcon,
  MapPin,
  Mic,
  Paperclip,
  Pencil,
  Reply,
  SendHorizontal,
  Smile,
  X,
} from 'lucide-react';
import { backend, type Chat, type JID } from '../../api';
import { PluginSlot } from '../../plugin-core/slots';
import { useAttach } from '../../stores/attach';
import { canEdit, useMessages } from '../../stores/messages';
import { composerFor, useUI } from '../../stores/ui';
import { IconButton, Menu, Popover, type PopoverAnchor } from '../../ui';
import { SendDialog, type SendKind } from './SendDialogs';
import { toastError } from '../../stores/toasts';
import { VoiceRecorder, canRecord } from './VoiceRecorder';
import { EmojiPicker } from '../emoji/EmojiPicker';
import { encodeMentions, useMentionPicker } from './mentions';
import { hasFormatting, toWhatsApp } from '../../lib/markdown';
import { LivePreview } from './LivePreview';
import './Composer.css';

const MAX_LINES = 8;

// formatting shortcuts: the selection gets wrapped in WhatsApp's markers
const WRAP: { key: string; shift: boolean; mark: string }[] = [
  { key: 'b', shift: false, mark: '*' },
  { key: 'i', shift: false, mark: '_' },
  { key: 'x', shift: true, mark: '~' },
  { key: 'm', shift: true, mark: '```' },
  { key: 'e', shift: false, mark: '`' },
];

// wraps the selection (or puts the caret between a pair of markers), through insertText so
// Ctrl+Z undoes it
function wrapSelection(el: HTMLTextAreaElement, mark: string) {
  const { selectionStart: a, selectionEnd: b, value } = el;
  const picked = value.slice(a, b);
  // trailing spaces stay outside, or the markers wouldn't count
  const core = picked.replace(/\s+$/, '');
  const tail = picked.slice(core.length);
  el.focus();
  if (!document.execCommand('insertText', false, mark + core + mark + tail)) {
    el.setRangeText(mark + core + mark + tail, a, b, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (!core) el.setSelectionRange(a + mark.length, a + mark.length);
  else el.setSelectionRange(a + mark.length, a + mark.length + core.length);
}

// Tells the other side we're typing: composing at most every few seconds while keys are
// pressed, paused after a short idle or when the message goes out. The backend drops all of it
// when "hide typing" is on.
const TYPING_REFRESH = 8_000;
const TYPING_IDLE = 5_000;

function useTypingSignal(jid: JID) {
  const last = useRef(0);
  const idle = useRef<number | undefined>(undefined);

  const stop = useCallback(() => {
    window.clearTimeout(idle.current);
    if (last.current) {
      last.current = 0;
      void backend.chats.setTyping(jid, false).catch(() => {});
    }
  }, [jid]);

  useEffect(() => stop, [stop]);

  const typed = useCallback(() => {
    const now = Date.now();
    if (now - last.current > TYPING_REFRESH) {
      last.current = now;
      void backend.chats.setTyping(jid, true).catch(() => {});
    }
    window.clearTimeout(idle.current);
    idle.current = window.setTimeout(stop, TYPING_IDLE);
  }, [jid, stop]);

  return { typed, stop };
}

export function Composer({ chat }: { chat: Chat }) {
  const jid = chat.jid;
  const state = useUI((s) => composerFor(s, jid));
  const items = useMessages((s) => s.byChat[jid]?.items);
  const ref = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [emoji, setEmoji] = useState<PopoverAnchor | null>(null);
  const [attachMenu, setAttachMenu] = useState<PopoverAnchor | null>(null);
  const [sendKind, setSendKind] = useState<SendKind | null>(null);
  const closeEmoji = useCallback(() => setEmoji(null), []);
  const typing = useTypingSignal(jid);

  const replyMsg = state.replyTo ? items?.find((m) => m.pk === state.replyTo) : undefined;
  const editMsg = state.editing ? items?.find((m) => m.pk === state.editing) : undefined;
  const text = state.draft;
  const canSend = text.trim().length > 0;
  const [recording, setRecording] = useState(false);
  // the mic takes the send button's place while there's nothing to send
  const showMic = !canSend && !state.editing && canRecord();

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
    if (previewRef.current) previewRef.current.scrollTop = el.scrollTop;
  }, [text]);

  const ui = useUI.getState();

  const mentions = useMentionPicker(chat, ({ member, start, end }) => {
    const label = '@' + member.name;
    const next = text.slice(0, start) + label + ' ' + text.slice(end);
    ui.setDraft(jid, next);
    ui.addMention(jid, label, member.jid);
    const caret = start + label.length + 1;
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(caret, caret);
    });
  });

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    if (editMsg) {
      void useMessages.getState().edit(jid, editMsg.pk, toWhatsApp(value));
      ui.cancelComposerMode(jid);
      return;
    }
    typing.stop();
    const replyTo = state.replyTo ?? undefined;
    const picked = state.mentions ?? {};
    const out = encodeMentions(toWhatsApp(value), picked);
    ui.setDraft(jid, '');
    if (replyTo) ui.cancelComposerMode(jid);
    void useMessages
      .getState()
      .send(jid, out.text, replyTo, out.jids)
      .then((ok) => {
        // refused (offline, rate limit): give the text back unless they started a new one
        if (!ok && !composerFor(useUI.getState(), jid).draft) {
          ui.setDraft(jid, value);
          for (const [label, who] of Object.entries(picked)) ui.addMention(jid, label, who);
          if (replyTo) ui.startReply(jid, replyTo);
        }
      });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (mentions.onKeyDown(e)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const w = WRAP.find((x) => x.key === e.key.toLowerCase() && x.shift === e.shiftKey);
      if (w) {
        e.preventDefault();
        wrapSelection(e.currentTarget, w.mark);
        return;
      }
    }
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
      {mentions.view}
      {bar}
      {recording ? (
        <div className="wz-composer__row">
          <VoiceRecorder
            onCancel={() => setRecording(false)}
            onError={(message) => {
              setRecording(false);
              toastError(message);
            }}
            onSend={(r) => {
              setRecording(false);
              void useMessages.getState().sendVoice(jid, r.blob, r.waveform);
            }}
          />
        </div>
      ) : (
        <div className="wz-composer__row">
          <IconButton
            label="Attach photos or files"
            hint="Ctrl+V"
            className="wz-composer__attach"
            icon={<Paperclip size={18} />}
            tooltipPlacement="top"
            aria-haspopup="menu"
            aria-expanded={!!attachMenu}
            onClick={(e) => setAttachMenu(e.currentTarget.getBoundingClientRect())}
          />
          <Menu
            open={!!attachMenu}
            anchor={attachMenu}
            onClose={() => setAttachMenu(null)}
            label="Attach"
            placement="top-start"
            items={[
              {
                id: 'files',
                label: 'Photos & files',
                icon: <ImageIcon size={16} />,
                shortcut: 'Ctrl+V',
                onSelect: () => void useAttach.getState().pick(jid),
              },
              {
                id: 'contact',
                label: 'Contact',
                icon: <Contact size={16} />,
                onSelect: () => setSendKind('contact'),
              },
              {
                id: 'location',
                label: 'Place',
                icon: <MapPin size={16} />,
                onSelect: () => setSendKind('location'),
              },
              {
                id: 'poll',
                label: 'Poll',
                icon: <BarChart3 size={16} />,
                onSelect: () => setSendKind('poll'),
              },
              {
                id: 'event',
                label: 'Event',
                icon: <CalendarPlus size={16} />,
                onSelect: () => setSendKind('event'),
              },
            ]}
          />
          {sendKind && <SendDialog kind={sendKind} jid={jid} onClose={() => setSendKind(null)} />}
          <div
            className={`wz-composer__field${hasFormatting(text) ? ' wz-composer__field--live' : ''}`}
          >
            <textarea
              ref={ref}
              className="wz-composer__input"
              rows={1}
              placeholder={chat.isGroup ? `Message ${chat.name}` : 'Write a message'}
              aria-label="Message"
              value={text}
              onChange={(e) => {
                ui.setDraft(jid, e.target.value);
                mentions.update(e.target.value, e.target.selectionStart);
                if (e.target.value && !state.editing) typing.typed();
                else typing.stop();
              }}
              onKeyDown={onKeyDown}
              onSelect={(e) =>
                mentions.update(e.currentTarget.value, e.currentTarget.selectionStart)
              }
              onBlur={() => mentions.update('', null)}
              onScroll={(e) => {
                if (previewRef.current) previewRef.current.scrollTop = e.currentTarget.scrollTop;
              }}
              spellCheck
            />
            <LivePreview ref={previewRef} text={text} />
          </div>
          <PluginSlot name="composer.actions" props={{ chatJid: jid, insertText: insert }} />
          <IconButton
            label="Emoji"
            className="wz-composer__emoji"
            icon={<Smile size={18} />}
            tooltipPlacement="top"
            aria-haspopup="dialog"
            aria-expanded={!!emoji}
            onClick={(e) => setEmoji(e.currentTarget.getBoundingClientRect())}
          />
          {showMic ? (
            <IconButton
              label="Record a voice message"
              tooltipPlacement="top"
              className="wz-composer__send"
              icon={<Mic size={18} />}
              onClick={() => {
                typing.stop();
                setRecording(true);
              }}
            />
          ) : (
            <IconButton
              label={editMsg ? 'Save edit' : 'Send'}
              hint="Enter"
              tooltipPlacement="top"
              className={`wz-composer__send${canSend ? ' wz-composer__send--ready' : ''}`}
              icon={editMsg ? <Check size={18} /> : <SendHorizontal size={18} />}
              disabled={!canSend}
              onClick={submit}
            />
          )}
        </div>
      )}
      <Popover
        open={!!emoji}
        anchor={emoji}
        onClose={closeEmoji}
        placement="top-end"
        ariaLabel="Emoji"
        className="wz-emoji-popover"
        restoreFocus={false}
      >
        <EmojiPicker jid={jid} onEmoji={insert} onClose={closeEmoji} />
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
