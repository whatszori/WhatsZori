import type { ReactNode } from 'react';

export function Page({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="wz-settings-page__title">{title}</h2>
      {lead && <p className="wz-settings-page__lead">{lead}</p>}
      {children}
    </section>
  );
}

export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="wz-settings-group">
      {title && <h3 className="wz-settings-group__title">{title}</h3>}
      <div className="wz-settings-group__body">{children}</div>
    </div>
  );
}

export function Row({
  label,
  description,
  children,
  stack,
  id,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  stack?: boolean;
  id?: string;
}) {
  return (
    <div className={`wz-setting-row${stack ? ' wz-setting-row--stack' : ''}`}>
      <div>
        <div className="wz-setting-row__label" id={id}>
          {label}
        </div>
        {description && <p className="wz-setting-row__desc">{description}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}
