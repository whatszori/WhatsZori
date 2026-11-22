import { useState } from 'react';
import { ChevronDown, FlaskConical } from 'lucide-react';
import { devControls, type ConnState } from '../../api';
import { useConnection } from '../../stores/connection';
import { IconButton, Segmented, Toggle } from '../../ui';
import './DevPanel.css';

// Only rendered with ?demo=1.
export function DevPanel() {
  const [open, setOpen] = useState(false);
  const [demo, setDemo] = useState(() => devControls?.isDemo() ?? false);
  const conn = useConnection((s) => s.conn);
  if (!devControls) return null;

  if (!open)
    return (
      <div className="wz-dev wz-dev--closed">
        <IconButton label="Demo controls" icon={<FlaskConical size={18} />} onClick={() => setOpen(true)} tooltipPlacement="top" />
      </div>
    );

  return (
    <div className="wz-dev" role="region" aria-label="Demo controls">
      <header className="wz-dev__header">
        <span>Demo controls</span>
        <IconButton label="Collapse" size="sm" icon={<ChevronDown size={16} />} onClick={() => setOpen(false)} tooltip={false} />
      </header>
      <Toggle
        label="Live events"
        description="Random messages, edits, deletes, typing."
        checked={demo}
        onChange={(on) => {
          devControls!.setDemo(on);
          setDemo(on);
        }}
      />
      <div className="wz-dev__row">
        <span>Connection</span>
        <Segmented<ConnState>
          label="Connection state"
          size="sm"
          value={conn}
          onChange={(s) => devControls!.setConnState(s)}
          options={[
            { value: 'connected', label: 'On' },
            { value: 'reconnecting', label: 'Retry' },
            { value: 'offline', label: 'Off' },
          ]}
        />
      </div>
    </div>
  );
}
