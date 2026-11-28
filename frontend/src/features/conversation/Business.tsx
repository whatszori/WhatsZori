import { useState } from 'react';
import {
  Copy,
  CornerUpLeft,
  ExternalLink,
  List,
  Phone,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import type { BizButton, BizCard, Message } from '../../api';
import { useMessages } from '../../stores/messages';
import { useToasts } from '../../stores/toasts';
import { Dialog } from '../../ui';
import './Business.css';

// Messages from business accounts: a header above the text, a footer below it, and buttons.
// Reply buttons and list rows send the answer the business expects (with the button's id); links
// open in the browser; flows the app can't run (payments, forms) say to use the phone.

export function BusinessHeader({ m }: { m: Message }) {
  const b = m.business!;
  if (!b.header && !b.subtitle && !(b.thumb && !m.media)) return null;
  return (
    <div className="wz-biz__head">
      {b.thumb && !m.media && (
        <img className="wz-biz__thumb" src={b.thumb} alt="" draggable={false} />
      )}
      {b.header && (
        <span className="wz-biz__title" dir="auto">
          {b.header}
        </span>
      )}
      {b.subtitle && (
        <span className="wz-biz__subtitle" dir="auto">
          {b.subtitle}
        </span>
      )}
    </div>
  );
}

const ICONS: Record<string, LucideIcon> = {
  reply: CornerUpLeft,
  url: ExternalLink,
  call: Phone,
  copy: Copy,
  list: List,
};

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    useToasts.getState().push({ kind: 'info', text: `${what} copied` });
  } catch {
    // nothing to do
  }
}

function Buttons({ m, buttons, onList }: { m: Message; buttons: BizButton[]; onList: () => void }) {
  const [busy, setBusy] = useState(false);
  if (buttons.length === 0) return null;

  const tap = async (b: BizButton) => {
    switch (b.kind) {
      case 'reply':
        if (busy || !b.id) return;
        setBusy(true);
        await useMessages.getState().answer(m.chatJid, m.pk, b.id);
        setBusy(false);
        return;
      case 'call':
        if (b.phone) await copy(b.phone, 'Number');
        return;
      case 'copy':
        if (b.code) await copy(b.code, 'Code');
        return;
      case 'list':
        onList();
    }
  };

  return (
    <div className="wz-biz__buttons">
      {buttons.map((b, i) => {
        const Icon = ICONS[b.kind] ?? Smartphone;
        if (b.kind === 'url' && b.url) {
          return (
            <a
              key={i}
              className="wz-biz__button"
              href={b.url}
              target="_blank"
              rel="noreferrer noopener"
              title={b.url}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{b.text}</span>
            </a>
          );
        }
        const other = !ICONS[b.kind];
        return (
          <button
            key={i}
            type="button"
            className="wz-biz__button"
            disabled={other || (b.kind === 'reply' && (busy || !b.id))}
            title={
              other
                ? 'Open this on your phone'
                : b.kind === 'call'
                  ? `Copy ${b.phone}`
                  : b.kind === 'copy'
                    ? 'Copy the code'
                    : undefined
            }
            onClick={() => void tap(b)}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{b.text}</span>
          </button>
        );
      })}
    </div>
  );
}

function Cards({ m, cards }: { m: Message; cards: BizCard[] }) {
  return (
    <div className="wz-biz__cards">
      {cards.map((c, i) => (
        <div key={i} className="wz-biz__card">
          {c.thumb && <img className="wz-biz__thumb" src={c.thumb} alt="" draggable={false} />}
          {c.header && <span className="wz-biz__title">{c.header}</span>}
          {c.body && <p className="wz-biz__card-body">{c.body}</p>}
          {c.footer && <span className="wz-biz__footer">{c.footer}</span>}
          <Buttons m={m} buttons={c.buttons.filter((b) => b.kind !== 'reply')} onList={() => {}} />
        </div>
      ))}
    </div>
  );
}

export function BusinessFooter({ m }: { m: Message }) {
  const b = m.business!;
  const [listOpen, setListOpen] = useState(false);
  const list = b.list;

  const pick = async (id: string) => {
    setListOpen(false);
    await useMessages.getState().answer(m.chatJid, m.pk, id);
  };

  return (
    <>
      {b.footer && (
        <span className="wz-biz__footer" dir="auto">
          {b.footer}
        </span>
      )}
      {b.cards && b.cards.length > 0 && <Cards m={m} cards={b.cards} />}
      <Buttons m={m} buttons={b.buttons} onList={() => setListOpen(true)} />
      {/* room for the time, which sits in the corner */}
      {(b.buttons.length > 0 || b.footer) && (
        <span className="wz-bubble__poll-meta" aria-hidden="true" />
      )}
      {list && (
        <Dialog
          open={listOpen}
          title={list.title || list.button}
          onClose={() => setListOpen(false)}
        >
          <div className="wz-biz-list">
            {list.sections.map((s, i) => (
              <section key={i} className="wz-biz-list__section">
                {s.title && <h3 className="wz-biz-list__heading">{s.title}</h3>}
                {s.rows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="wz-biz-list__row"
                    onClick={() => void pick(r.id)}
                  >
                    <span className="wz-biz-list__title">{r.title}</span>
                    {r.description && <span className="wz-biz-list__desc">{r.description}</span>}
                  </button>
                ))}
              </section>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
