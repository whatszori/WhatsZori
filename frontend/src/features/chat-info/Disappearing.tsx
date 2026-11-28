import { useState } from 'react';
import { Timer } from 'lucide-react';
import { backend, type Chat } from '../../api';
import { toastError } from '../../stores/toasts';
import { Segmented } from '../../ui';

// The chat's disappearing messages timer. It's WhatsApp's setting for everyone in the chat;
// WhatsZori itself keeps every message.

export const TIMERS = [
  { value: '0', label: 'Off' },
  { value: '86400', label: '24 hours' },
  { value: '604800', label: '7 days' },
  { value: '7776000', label: '90 days' },
] as const;

export function timerLabel(seconds?: number): string {
  return (
    TIMERS.find((t) => Number(t.value) === seconds)?.label ??
    `${Math.round((seconds ?? 0) / 3600)} h`
  );
}

export function DisappearingSection({ chat }: { chat: Chat }) {
  const [busy, setBusy] = useState(false);
  const value = String(chat.disappearing ?? 0);
  const set = async (v: string) => {
    if (v === value || busy) return;
    setBusy(true);
    try {
      await backend.chats.setDisappearing(chat.jid, Number(v));
    } catch (err) {
      toastError(err, 'Couldn’t change disappearing messages');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="wz-info__section wz-disappearing">
      <h3 className="wz-info__section-title">
        <Timer size={14} aria-hidden="true" /> Disappearing messages
      </h3>
      <Segmented
        label="Disappearing messages"
        size="sm"
        value={value}
        options={TIMERS.map((t) => ({ value: t.value, label: t.label }))}
        onChange={(v) => void set(v)}
      />
      <p className="wz-disappearing__note">
        {chat.disappearing
          ? `New messages disappear from everyone’s phones after ${timerLabel(chat.disappearing).toLowerCase()}. WhatsZori keeps its own copy here.`
          : 'When on, new messages disappear from everyone’s phones after the time you pick. WhatsZori still keeps its own copy here.'}
      </p>
    </section>
  );
}
