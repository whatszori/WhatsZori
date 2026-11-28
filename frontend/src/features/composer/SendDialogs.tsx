import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, LocateFixed, Plus, Search, X } from 'lucide-react';
import { backend, type Contact, type JID } from '../../api';
import { parseCoords } from '../../lib/geo';
import { useMessages } from '../../stores/messages';
import { Avatar, Button, Dialog, Input, Spinner, Toggle } from '../../ui';
import { DrawnMap } from '../conversation/Location';
import './SendDialogs.css';

// Dialogs behind the paperclip menu: share contacts, a place, a poll or an event. Each sends one
// message when its button is pressed and closes.

export type SendKind = 'contact' | 'location' | 'poll' | 'event';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="wz-send__field">
      <span className="wz-send__label">{label}</span>
      {children}
      {hint && <span className="wz-send__hint">{hint}</span>}
    </label>
  );
}

function useSend(jid: JID, onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const go = async (run: () => Promise<unknown>) => {
    setBusy(true);
    const ok = await useMessages.getState().sendRich(jid, run as () => Promise<never>);
    setBusy(false);
    if (ok) onClose();
  };
  return { busy, go };
}

function ContactDialog({ jid, onClose }: { jid: JID; onClose: () => void }) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<JID[]>([]);
  const { busy, go } = useSend(jid, onClose);
  useEffect(() => {
    backend.contacts
      .list()
      .then(setContacts)
      .catch(() => setContacts([]));
  }, []);
  const q = query.trim().toLowerCase();
  const list = useMemo(
    () =>
      (contacts ?? []).filter(
        (c) =>
          c.jid.endsWith('@s.whatsapp.net') &&
          (!q || c.name.toLowerCase().includes(q) || c.phone.replace(/\D/g, '').includes(q)),
      ),
    [contacts, q],
  );
  const toggle = (j: JID) =>
    setPicked((p) => (p.includes(j) ? p.filter((x) => x !== j) : [...p, j]));
  return (
    <Dialog
      open
      title="Share contacts"
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!picked.length || busy}
            onClick={() => void go(() => backend.messages.sendContacts(jid, picked))}
          >
            {picked.length > 1 ? `Send ${picked.length} contacts` : 'Send'}
          </Button>
        </>
      }
    >
      <Input
        autoFocus
        icon={<Search size={16} />}
        placeholder="Search contacts"
        aria-label="Search contacts"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="wz-send__people" aria-label="Contacts">
        {contacts === null && (
          <li className="wz-send__empty">
            <Spinner size={18} />
          </li>
        )}
        {contacts !== null && list.length === 0 && <li className="wz-send__empty">No one found</li>}
        {list.map((c) => {
          const on = picked.includes(c.jid);
          return (
            <li key={c.jid}>
              <button
                type="button"
                className={`wz-send__person${on ? ' wz-send__person--on' : ''}`}
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(c.jid)}
              >
                <Avatar name={c.name} jid={c.jid} size={34} />
                <span className="wz-send__who">
                  <span className="wz-send__name">{c.name}</span>
                  <span className="wz-send__sub">{c.phone}</span>
                </span>
                <span className="wz-check">{on && <Check size={14} strokeWidth={3} />}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

function LocationDialog({ jid, onClose }: { jid: JID; onClose: () => void }) {
  const [where, setWhere] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const coords = parseCoords(where);
  const { busy, go } = useSend(jid, onClose);

  // only when asked: the system's location service, through the browser engine
  const locate = () => {
    if (!navigator.geolocation) {
      setError('This computer can’t tell where it is. Paste coordinates or a map link instead.');
      return;
    }
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setWhere(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`);
        setLocating(false);
      },
      () => {
        setError(
          'Couldn’t get your location (Windows location may be off). Paste coordinates or a map link instead.',
        );
        setLocating(false);
      },
      { timeout: 15000, maximumAge: 60000 },
    );
  };

  return (
    <Dialog
      open
      title="Send a place"
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!coords || busy}
            onClick={() =>
              coords &&
              void go(() => backend.messages.sendLocation(jid, { ...coords, name, address }))
            }
          >
            Send
          </Button>
        </>
      }
    >
      <div className="wz-send__map">
        {coords ? (
          <>
            <DrawnMap lat={coords.lat} lon={coords.lon} />
            <span className="wz-send__pin" aria-hidden="true" />
          </>
        ) : (
          <span className="wz-send__map-empty">The pin shows here</span>
        )}
      </div>
      <Field
        label="Where"
        hint={
          coords
            ? `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`
            : 'Coordinates like 52.5163, 13.3777 or a Google Maps / OpenStreetMap link'
        }
      >
        <Input
          autoFocus
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          placeholder="Paste coordinates or a map link"
          trailing={
            <button
              type="button"
              className="wz-send__locate"
              onClick={locate}
              disabled={locating}
              title="Use my location"
              aria-label="Use my location"
            >
              {locating ? <Spinner size={14} /> : <LocateFixed size={16} />}
            </button>
          }
        />
      </Field>
      {error && (
        <p className="wz-send__error" role="alert">
          {error}
        </p>
      )}
      <Field label="Name (optional)">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Café on the corner"
        />
      </Field>
      <Field label="Address (optional)">
        <Input value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
    </Dialog>
  );
}

function PollDialog({ jid, onClose }: { jid: JID; onClose: () => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multiple, setMultiple] = useState(false);
  const { busy, go } = useSend(jid, onClose);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ok = question.trim() && new Set(filled).size >= 2;
  const set = (i: number, v: string) => {
    setOptions((cur) => {
      const next = cur.map((o, j) => (j === i ? v : o));
      // a new empty row appears once the last one is typed into
      if (i === next.length - 1 && v && next.length < 12) next.push('');
      return next;
    });
  };
  return (
    <Dialog
      open
      title="Create a poll"
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ok || busy}
            onClick={() =>
              void go(() => backend.messages.sendPoll(jid, question, filled, multiple))
            }
          >
            Send
          </Button>
        </>
      }
    >
      <Field label="Question">
        <Input
          autoFocus
          value={question}
          maxLength={255}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask something"
        />
      </Field>
      <div className="wz-send__field">
        <span className="wz-send__label">Options</span>
        <div className="wz-send__options">
          {options.map((o, i) => (
            <Input
              key={i}
              value={o}
              maxLength={100}
              aria-label={`Option ${i + 1}`}
              placeholder={i < 2 ? `Option ${i + 1}` : 'Add an option'}
              icon={i >= 2 && !o ? <Plus size={14} /> : undefined}
              onChange={(e) => set(i, e.target.value)}
              trailing={
                options.length > 2 && o ? (
                  <button
                    type="button"
                    className="wz-send__locate"
                    aria-label={`Remove option ${i + 1}`}
                    onClick={() => setOptions((cur) => cur.filter((_, j) => j !== i))}
                  >
                    <X size={14} />
                  </button>
                ) : undefined
              }
            />
          ))}
        </div>
      </div>
      <div className="wz-send__toggle">
        <Toggle label="Allow more than one answer" checked={multiple} onChange={setMultiple} />
      </div>
    </Dialog>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function EventDialog({ jid, onClose }: { jid: JID; onClose: () => void }) {
  const [now] = useState(() => new Date());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => dateValue(new Date(now.getTime() + 86_400_000)));
  const [from, setFrom] = useState('18:00');
  const [to, setTo] = useState('');
  const [place, setPlace] = useState('');
  const [link, setLink] = useState('');
  const { busy, go } = useSend(jid, onClose);

  const at = (time: string) => {
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    return new Date(y, mo - 1, d, h, mi).getTime();
  };
  const start = date && from ? at(from) : 0;
  // an end before the start is the next day ("22:00 - 02:00")
  let end = to ? at(to) : 0;
  if (end && end <= start) end += 86_400_000;
  const ok = name.trim() && start > 0;

  return (
    <Dialog
      open
      title="Create an event"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!ok || busy}
            onClick={() =>
              void go(() =>
                backend.messages.sendEvent(jid, {
                  name,
                  description,
                  start,
                  end,
                  place,
                  joinLink: link,
                }),
              )
            }
          >
            Send
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input
          autoFocus
          value={name}
          maxLength={255}
          onChange={(e) => setName(e.target.value)}
          placeholder="Birthday dinner"
        />
      </Field>
      <div className="wz-send__row">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="From">
          <Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To (optional)">
          <Input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Field label="Place (optional)">
        <Input value={place} onChange={(e) => setPlace(e.target.value)} />
      </Field>
      <Field label="Call link (optional)">
        <Input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://meet.example.com/…"
        />
      </Field>
      <Field label="Description (optional)">
        <textarea
          className="wz-send__textarea"
          rows={3}
          maxLength={2048}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
    </Dialog>
  );
}

export function SendDialog({
  kind,
  jid,
  onClose,
}: {
  kind: SendKind | null;
  jid: JID;
  onClose: () => void;
}) {
  switch (kind) {
    case 'contact':
      return <ContactDialog jid={jid} onClose={onClose} />;
    case 'location':
      return <LocationDialog jid={jid} onClose={onClose} />;
    case 'poll':
      return <PollDialog jid={jid} onClose={onClose} />;
    case 'event':
      return <EventDialog jid={jid} onClose={onClose} />;
  }
  return null;
}
