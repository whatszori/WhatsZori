import type { ReactNode } from 'react';
import './PlaceholderPanel.css';

// Sidebar panels for things whatsmeow-side support doesn't exist for yet (calls, status).
export function PlaceholderPanel({
  title,
  icon,
  text,
}: {
  title: string;
  icon: ReactNode;
  text: string;
}) {
  return (
    <div className="wz-placeholder-panel">
      <header className="wz-placeholder-panel__header">
        <h1 className="wz-placeholder-panel__title">{title}</h1>
      </header>
      <div className="wz-placeholder-panel__body">
        <span className="wz-placeholder-panel__icon" aria-hidden="true">
          {icon}
        </span>
        <p className="wz-empty-text">{text}</p>
      </div>
    </div>
  );
}
