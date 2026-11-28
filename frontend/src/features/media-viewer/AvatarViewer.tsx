import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, X } from 'lucide-react';
import { backend } from '../../api';
import { toastError, useToasts } from '../../stores/toasts';
import { useUI } from '../../stores/ui';
import { Avatar, Spinner, Tooltip, useLayer } from '../../ui';
import './MediaViewer.css';
import './AvatarViewer.css';

// Someone's (or a group's) profile picture, full size, over everything; with save and copy.
export function AvatarViewer() {
  const target = useUI((s) => s.avatarViewer);
  const close = () => useUI.getState().setAvatarViewer(null);
  useLayer(!!target, close);
  if (!target) return null;
  return createPortal(<View jid={target.jid} name={target.name} onClose={close} />, document.body);
}

function View({ jid, name, onClose }: { jid: string; name: string; onClose: () => void }) {
  const url = backend.media.avatarUrl(jid, true);
  const [state, setState] = useState<'loading' | 'ok' | 'none'>(url ? 'loading' : 'none');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const desktop = backend.media.canAttach;

  const save = async () => {
    try {
      const path = await backend.media.saveAvatar(jid, name);
      if (path) useToasts.getState().push({ kind: 'info', text: 'Profile picture saved' });
    } catch (err) {
      toastError(err, 'Not saved');
    }
  };
  const copy = async () => {
    try {
      await backend.media.copyAvatar(jid);
      useToasts.getState().push({ kind: 'info', text: 'Profile picture copied' });
    } catch (err) {
      toastError(err, 'Not copied');
    }
  };

  return (
    <div
      ref={ref}
      className="wz-viewer wz-avatar-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`${name}, profile picture`}
      tabIndex={-1}
    >
      <header className="wz-viewer__bar">
        <div className="wz-viewer__who">
          <Avatar name={name} jid={jid} size={36} />
          <div className="wz-viewer__who-text">
            <span className="wz-viewer__name">{name}</span>
            <span className="wz-viewer__time">Profile picture</span>
          </div>
        </div>
        <div className="wz-viewer__actions">
          {state === 'ok' && (
            <>
              <Btn
                label={desktop ? 'Save' : 'Saving works in the desktop app'}
                onClick={() => void save()}
                disabled={!desktop}
              >
                <Download size={18} />
              </Btn>
              <Btn
                label={desktop ? 'Copy' : 'Copying works in the desktop app'}
                onClick={() => void copy()}
                disabled={!desktop}
              >
                <Copy size={18} />
              </Btn>
              <span className="wz-viewer__sep" aria-hidden="true" />
            </>
          )}
          <Btn label="Close" hint="Esc" onClick={onClose}>
            <X size={20} />
          </Btn>
        </div>
      </header>
      <div
        className="wz-avatar-viewer__stage"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        {state !== 'none' && (
          <img
            src={url}
            alt={`${name}, profile picture`}
            className={`wz-avatar-viewer__img${state === 'ok' ? ' is-ready' : ''}`}
            draggable={false}
            onLoad={() => setState('ok')}
            onError={() => setState('none')}
          />
        )}
        {state === 'loading' && <Spinner size={24} />}
        {state === 'none' && (
          <div className="wz-avatar-viewer__none">
            <Avatar name={name} jid={undefined} size={160} />
            <p>No profile picture, or it’s only visible to their contacts.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Btn({
  label,
  hint,
  onClick,
  disabled,
  children,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} hint={hint}>
      <button
        type="button"
        className="wz-viewer__btn"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </button>
    </Tooltip>
  );
}
