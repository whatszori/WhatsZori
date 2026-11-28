import { useState } from 'react';
import { CalendarClock, Copy, MapPin, MessageCircle, Video } from 'lucide-react';
import type { ContactCard as Card, Message } from '../../api';
import { formatTime, initials, nameHue } from '../../lib/format';
import { useChats } from '../../stores/chats';
import { useToasts } from '../../stores/toasts';
import './Cards.css';

// Shared contacts (vCards) and events, as cards in the bubble.

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    useToasts.getState().push({ kind: 'info', text: `${what} copied` });
  } catch {
    // it's on screen anyway
  }
}

function OneContact({ c }: { c: Card }) {
  const wa = c.phones.find((p) => p.jid);
  const hue = nameHue(c.name);
  return (
    <div className="wz-vcard">
      <div className="wz-vcard__head">
        <span
          className="wz-vcard__avatar"
          style={{ background: `hsl(${hue} 45% 52%)` }}
          aria-hidden="true"
        >
          {initials(c.name)}
        </span>
        <div className="wz-vcard__who">
          <span className="wz-vcard__name">{c.name || 'Contact'}</span>
          {c.org && <span className="wz-vcard__org">{c.org}</span>}
        </div>
      </div>
      {(c.phones.length > 0 || c.emails.length > 0) && (
        <ul className="wz-vcard__lines">
          {c.phones.map((p, i) => (
            <li key={`p${i}`}>
              <button
                type="button"
                className="wz-vcard__line"
                onClick={() => void copy(p.number, 'Number')}
                title="Copy the number"
              >
                <span className="wz-selectable">{p.number}</span>
                {p.label && <span className="wz-vcard__label">{p.label}</span>}
                <Copy size={12} className="wz-vcard__copy" />
              </button>
            </li>
          ))}
          {c.emails.map((e, i) => (
            <li key={`e${i}`}>
              <a className="wz-vcard__line" href={`mailto:${e}`}>
                <span>{e}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="wz-vcard__actions">
        {wa ? (
          <button
            type="button"
            className="wz-loc__action"
            onClick={() => void useChats.getState().openWith(wa.jid!)}
          >
            <MessageCircle size={13} /> Message
          </button>
        ) : (
          <span className="wz-vcard__note">Not on WhatsApp</span>
        )}
      </div>
    </div>
  );
}

export function ContactCards({ m }: { m: Message }) {
  const list = m.contacts!;
  return (
    <div className="wz-vcards">
      {list.length > 1 && <span className="wz-vcards__count">{list.length} contacts</span>}
      {list.map((c, i) => (
        <OneContact key={i} c={c} />
      ))}
    </div>
  );
}

const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short' });
const DAY_LONG = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

function sameDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function EventCard({ m }: { m: Message }) {
  const ev = m.event!;
  const start = ev.start || m.timestamp;
  const d = new Date(start);
  const [now] = useState(() => Date.now());
  const past = (ev.end || start) < now;
  let when = `${DAY_LONG.format(d)}, ${formatTime(start)}`;
  if (ev.end) {
    when += sameDay(start, ev.end)
      ? ` – ${formatTime(ev.end)}`
      : ` – ${DAY_LONG.format(new Date(ev.end))}, ${formatTime(ev.end)}`;
  }
  const mapUrl =
    ev.lat || ev.lon
      ? `https://www.openstreetmap.org/?mlat=${ev.lat}&mlon=${ev.lon}#map=16/${ev.lat}/${ev.lon}`
      : '';

  return (
    <div
      className={`wz-event${ev.canceled ? ' wz-event--canceled' : ''}${past ? ' wz-event--past' : ''}`}
    >
      <div className="wz-event__head">
        <span className="wz-event__date" aria-hidden="true">
          <span className="wz-event__month">{MONTH.format(d)}</span>
          <span className="wz-event__day">{d.getDate()}</span>
        </span>
        <div className="wz-event__who">
          <span className="wz-event__tag">
            {ev.canceled ? 'Canceled' : ev.call ? 'Scheduled call' : 'Event'}
          </span>
          <span className="wz-event__name">{ev.name || 'Event'}</span>
        </div>
      </div>
      <ul className="wz-event__lines">
        <li>
          <CalendarClock size={14} />
          <span>{when}</span>
        </li>
        {ev.place && (
          <li>
            <MapPin size={14} />
            {mapUrl ? (
              <a href={mapUrl} target="_blank" rel="noreferrer noopener">
                {ev.place}
              </a>
            ) : (
              <span>{ev.place}</span>
            )}
          </li>
        )}
        {ev.joinLink && (
          <li>
            <Video size={14} />
            <a href={ev.joinLink} target="_blank" rel="noreferrer noopener">
              {ev.call ? 'Join the call' : 'Join link'}
            </a>
          </li>
        )}
      </ul>
      {ev.description && (
        <p className="wz-event__desc wz-selectable" dir="auto">
          {ev.description}
        </p>
      )}
    </div>
  );
}
