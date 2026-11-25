import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import { formatTime } from '../lib/format';
import { useUI } from '../stores/ui';
import { Button, IconButton, Popover, Tooltip, type PopoverAnchor } from '../ui';
import { ACCESS_TEXT, SENSITIVE, useActivity, type Access } from './activity';
import './activity.css';

// Like a camera light: shows up once a plugin has used a permission, and glows for a few
// seconds after one reads messages, contacts or presence, or goes online. Click for the list.

const GLOW_MS = 8000;

function useGlow(): { live: boolean; any: boolean; last: Access | undefined } {
  const items = useActivity((s) => s.items);
  const last = items.find((a) => SENSITIVE.has(a.kind));
  const [now, setNow] = useState(() => Date.now());
  const live = !!last && now - last.at < GLOW_MS;
  useEffect(() => {
    if (!last) return;
    // one tick when the glow should end
    const t = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, last.at + GLOW_MS - Date.now()) + 50,
    );
    return () => window.clearTimeout(t);
  }, [last]);
  return { live, any: items.length > 0, last };
}

function label(last: Access | undefined, names: Record<string, string>) {
  if (!last) return 'Plugin activity';
  const who = names[last.pluginId] ?? last.pluginId;
  return `${who} ${ACCESS_TEXT[last.kind] ?? last.kind}${last.detail && last.kind === 'network' ? ` (${last.detail})` : ''}`;
}

export function ActivityIndicator({ rail = false }: { rail?: boolean }) {
  const { live, any, last } = useGlow();
  const names = useActivity((s) => s.names);
  const [anchor, setAnchor] = useState<PopoverAnchor | null>(null);
  if (!any) return null;
  const text = live ? label(last, names) : 'Plugin activity';
  const icon = (
    <span className={`wz-activity${live ? ' wz-activity--live' : ''}`}>
      <Eye size={rail ? 20 : 18} />
      {live && <span className="wz-activity__dot" aria-hidden="true" />}
    </span>
  );
  return (
    <>
      {rail ? (
        <Tooltip label={text}>
          <button
            type="button"
            aria-label={text}
            className="wz-rail__item"
            onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
          >
            {icon}
          </button>
        </Tooltip>
      ) : (
        <IconButton
          label={text}
          icon={icon}
          onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
        />
      )}
      <Popover
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        placement={rail ? 'top-start' : 'bottom-end'}
        ariaLabel="Plugin activity"
        className="wz-activity-pop"
      >
        <ActivityList onClose={() => setAnchor(null)} />
      </Popover>
    </>
  );
}

function ActivityList({ onClose }: { onClose: () => void }) {
  const items = useActivity((s) => s.items);
  const names = useActivity((s) => s.names);
  return (
    <div className="wz-activity-list">
      <header className="wz-activity-list__head">
        <strong>What plugins did</strong>
        <span>Since WhatsZori started. Only what happened, not what was in it.</span>
      </header>
      <ul>
        {items.slice(0, 60).map((a) => (
          <li
            key={`${a.pluginId}:${a.kind}:${a.detail}:${a.at}`}
            className={SENSITIVE.has(a.kind) ? 'is-sensitive' : ''}
          >
            <span className="wz-activity-list__who">{names[a.pluginId] ?? a.pluginId}</span>
            <span className="wz-activity-list__what">
              {ACCESS_TEXT[a.kind] ?? a.kind}
              {a.kind === 'network' && a.detail && <code> {a.detail}</code>}
              {a.count > 1 && <span className="wz-activity-list__count"> ×{a.count}</span>}
            </span>
            <time className="wz-activity-list__at">{formatTime(a.at)}</time>
          </li>
        ))}
      </ul>
      <footer className="wz-activity-list__foot">
        <Button size="sm" variant="ghost" onClick={() => useActivity.getState().clear()}>
          Clear
        </Button>
        <Button
          size="sm"
          onClick={() => {
            onClose();
            useUI.getState().openSettings('plugins');
          }}
        >
          Plugin settings
        </Button>
      </footer>
    </div>
  );
}
