import { useEffect, useState } from 'react';
import { backend, type EditVersion, type Message } from '../../api';
import { formatDateTime } from '../../lib/format';
import { Popover, Spinner, type PopoverAnchor } from '../../ui';
import './EditHistoryPopover.css';

interface Props {
  target: { m: Message; anchor: PopoverAnchor } | null;
  onClose: () => void;
}

export function EditHistoryPopover({ target, onClose }: Props) {
  const pk = target?.m.pk;
  const editedAt = target?.m.editedAt;
  const key = `${pk}:${editedAt}`;
  const [loaded, setLoaded] = useState<{ key: string; versions: EditVersion[] } | null>(null);
  // stale result from another message counts as still loading
  const versions = loaded?.key === key ? loaded.versions : null;

  useEffect(() => {
    if (!pk) return;
    let alive = true;
    void backend.messages.getEditHistory(pk).then((v) => alive && setLoaded({ key, versions: v }));
    return () => {
      alive = false;
    };
  }, [pk, key]);

  return (
    <Popover
      open={!!target}
      anchor={target?.anchor ?? null}
      onClose={onClose}
      placement="top-end"
      ariaLabel="Edit history"
      className="wz-history"
    >
      <div className="wz-history__header">Edit history</div>
      {versions === null ? (
        <div className="wz-history__loading">
          <Spinner size={14} />
        </div>
      ) : versions.length === 0 ? (
        <p className="wz-history__empty">No earlier versions were saved for this message.</p>
      ) : (
        <ol className="wz-history__list">
          {versions.map((v, i) => {
            const current = i === versions.length - 1;
            return (
              <li key={i} className={`wz-history__item${current ? ' wz-history__item--current' : ''}`}>
                <div className="wz-history__meta">
                  <span>{i === 0 ? 'Original' : current ? 'Current' : `Edit ${i}`}</span>
                  <time dateTime={new Date(v.at).toISOString()}>{formatDateTime(v.at)}</time>
                </div>
                <p className="wz-history__text wz-selectable">{v.text}</p>
              </li>
            );
          })}
        </ol>
      )}
    </Popover>
  );
}
