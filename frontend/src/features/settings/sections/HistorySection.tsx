import { Info } from 'lucide-react';
import type { AppSettings } from '../../../api';
import { useSettings } from '../../../stores/settings';
import { Toggle } from '../../../ui';
import { Group, Page } from './common';

type History = AppSettings['history'];

export function HistorySection() {
  const h = useSettings((s) => s.settings.history);
  const update = useSettings((s) => s.update);
  const set = (patch: Partial<History>) =>
    update((s) => ({ ...s, history: { ...s.history, ...patch } }));

  return (
    <Page title="Anti-delete & history" lead="Keep a local copy of what people delete or change.">
      <Group>
        <Toggle
          label="Keep deleted messages"
          description="Messages deleted by the sender stay visible here, marked as deleted."
          checked={h.keepDeleted}
          onChange={(keepDeleted) => set({ keepDeleted })}
        />
        <Toggle
          label="Keep edit history"
          description="Save every version of an edited message. Click “edited” to see them."
          checked={h.keepEditHistory}
          onChange={(keepEditHistory) => set({ keepEditHistory })}
        />
        <Toggle
          label="Download media automatically"
          description="So photos and files survive if the sender deletes them. Uses more disk space."
          checked={h.autoDownloadMedia}
          onChange={(autoDownloadMedia) => set({ autoDownloadMedia })}
        />
      </Group>
      <p className="wz-note">
        <Info size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>
          Everything is stored only on this computer. A message that was deleted before this device
          received it can’t be recovered.
        </span>
      </p>
    </Page>
  );
}
