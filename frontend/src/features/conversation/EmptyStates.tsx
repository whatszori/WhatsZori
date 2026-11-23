import { Logo } from '../../ui';
import './EmptyStates.css';

const SHORTCUTS: [string, string][] = [
  ['Ctrl K', 'Search chats and messages'],
  ['Ctrl N', 'New chat'],
  ['Ctrl F', 'Search in the open chat'],
  ['Alt ↑ / ↓', 'Previous / next chat'],
  ['Ctrl ,', 'Settings'],
  ['Esc', 'Close menus, cancel reply'],
];

export function NoChatSelected() {
  return (
    <div className="wz-empty">
      <Logo height={40} className="wz-empty__wordmark" />
      <p className="wz-empty__hint">Pick a chat on the left to start.</p>
      <dl className="wz-empty__shortcuts">
        {SHORTCUTS.map(([k, label]) => (
          <div key={k} className="wz-empty__shortcut">
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function EmptyChat() {
  return (
    <div className="wz-empty wz-empty--chat">
      <p className="wz-empty__hint">No messages here yet.</p>
      <p className="wz-empty__sub">Say hello, it will show up here.</p>
    </div>
  );
}
