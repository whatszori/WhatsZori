import { useState } from 'react';
import { Check } from 'lucide-react';
import { backend, type Message } from '../../api';
import { pluralize } from '../../lib/format';
import { toastError } from '../../stores/toasts';
import { Dialog } from '../../ui';

// A poll in a bubble: the question, options with live counts, and our own vote.
export function Poll({ m }: { m: Message }) {
  const poll = m.poll!;
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const single = poll.selectable === 1;
  const mine = poll.options.filter((o) => o.mine).map((o) => o.name);
  const top = Math.max(1, ...poll.options.map((o) => o.votes));

  const pick = async (name: string) => {
    let next: string[];
    if (single) next = mine.includes(name) ? [] : [name];
    else next = mine.includes(name) ? mine.filter((n) => n !== name) : [...mine, name];
    if (!single && poll.selectable > 0 && next.length > poll.selectable) {
      toastError(new Error(`Pick at most ${poll.selectable}`));
      return;
    }
    setBusy(true);
    try {
      await backend.messages.vote(m.pk, next);
    } catch (err) {
      toastError(err, 'Vote not sent');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wz-poll">
      <p className="wz-poll__name" dir="auto">
        {poll.name}
      </p>
      <p className="wz-poll__hint">
        {single
          ? 'Select one'
          : poll.selectable > 1
            ? `Select up to ${poll.selectable}`
            : 'Select one or more'}
      </p>
      <ul className="wz-poll__options">
        {poll.options.map((o) => (
          <li key={o.name}>
            <button
              type="button"
              className={`wz-poll__option${o.mine ? ' wz-poll__option--mine' : ''}`}
              disabled={busy || !!m.deleted}
              aria-pressed={o.mine}
              onClick={() => void pick(o.name)}
            >
              <span
                className={`wz-poll__check${single ? ' wz-poll__check--radio' : ''}`}
                aria-hidden="true"
              >
                {o.mine && <Check size={12} strokeWidth={3} />}
              </span>
              <span className="wz-poll__label">
                <span className="wz-poll__row">
                  <span className="wz-poll__option-name" dir="auto">
                    {o.name}
                  </span>
                  <span className="wz-poll__votes">{o.votes}</span>
                </span>
                <span className="wz-poll__bar" aria-hidden="true">
                  <span style={{ width: `${(o.votes / top) * 100}%` }} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="wz-poll__details"
        disabled={poll.totalVoters === 0}
        onClick={() => setDetails(true)}
      >
        {poll.totalVoters ? `View votes · ${pluralize(poll.totalVoters, 'voter')}` : 'No votes yet'}
      </button>

      <Dialog open={details} title="Poll details" onClose={() => setDetails(false)}>
        <p className="wz-poll__name" dir="auto">
          {poll.name}
        </p>
        {poll.options.map((o) => (
          <section key={o.name} className="wz-poll__detail">
            <h3>
              <span dir="auto">{o.name}</span>
              <span>{pluralize(o.votes, 'vote')}</span>
            </h3>
            {o.voters.length > 0 && (
              <ul>
                {o.voters.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </Dialog>
    </div>
  );
}
