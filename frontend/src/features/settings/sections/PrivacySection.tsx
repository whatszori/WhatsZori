import { Ghost, Info, X } from 'lucide-react';
import type { ReadReceiptMode } from '../../../api';
import { useChats } from '../../../stores/chats';
import { useSettings } from '../../../stores/settings';
import { IconButton, Segmented, Toggle } from '../../../ui';
import { Group, Page, Row } from './common';

const RECEIPT_HELP: Record<ReadReceiptMode, string> = {
  always: 'Blue ticks are sent as soon as you open a chat.',
  never: 'Nobody sees when you read their messages. You still see theirs.',
  'on-reply': 'Messages are marked read only when you reply to that chat.',
};

export function PrivacySection() {
  const ghost = useSettings((s) => s.ghost);
  const setGhost = useSettings((s) => s.setGhost);
  const chats = useChats((s) => s.chats);

  return (
    <Page title="Privacy" lead="Ghost mode controls what others can see about your activity.">
      <Group title="Ghost mode">
        <Toggle
          label="Hide online status"
          description="Don't send presence updates, so you never appear online."
          checked={ghost.hideOnline}
          onChange={(hideOnline) => setGhost({ hideOnline })}
        />
        <Toggle
          label="Hide typing"
          description="Don't show “typing…” to others while you write."
          checked={ghost.hideTyping}
          onChange={(hideTyping) => setGhost({ hideTyping })}
        />
        <Row label="Read receipts" description={RECEIPT_HELP[ghost.readReceipts]}>
          <Segmented
            label="Read receipts"
            value={ghost.readReceipts}
            onChange={(readReceipts) => setGhost({ readReceipts })}
            options={[
              { value: 'always', label: 'Always' },
              { value: 'never', label: 'Never' },
              { value: 'on-reply', label: 'On reply' },
            ]}
          />
        </Row>
        <Toggle
          label="Hide voice note plays"
          description="Don’t send the blue microphone when you listen to a voice or video note."
          checked={ghost.hidePlayed}
          onChange={(hidePlayed) => setGhost({ hidePlayed })}
        />
      </Group>
      <Group title="Statuses">
        <Toggle
          label="Ghost mode for statuses"
          description="View statuses without appearing in the viewer list. When off, WhatsZori asks each time you open someone’s status."
          checked={ghost.statusGhost}
          onChange={(statusGhost) => setGhost({ statusGhost })}
        />
      </Group>
      <Group title="Ghost chats">
        <p className="wz-settings-hint">
          Chats in full ghost mode never get read or played receipts or “typing…”, whatever the
          settings above say. Turn it on from a chat’s menu.
        </p>
        {ghost.ghostChats.length === 0 ? (
          <p className="wz-settings-hint">No ghost chats.</p>
        ) : (
          <ul className="wz-ghost-chats">
            {ghost.ghostChats.map((jid) => (
              <li key={jid}>
                <Ghost size={16} aria-hidden="true" />
                <span>{chats[jid]?.name ?? jid.split('@')[0]}</span>
                <IconButton
                  label="Remove"
                  size="sm"
                  icon={<X size={14} />}
                  onClick={() =>
                    setGhost({ ghostChats: ghost.ghostChats.filter((j) => j !== jid) })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Group>
      <p className="wz-note">
        <Info size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>
          Delivery receipts (the grey double tick) can’t be hidden. Your phone and WhatsApp’s
          servers send them on their own, so people can always tell a message reached you.
        </span>
      </p>
    </Page>
  );
}
