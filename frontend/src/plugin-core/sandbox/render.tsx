import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PluginInfo } from '../../api';
import { toastError } from '../../stores/toasts';
import { Button, IconButton, MenuItem, Spinner, Toggle } from '../../ui';
import { PluginIcon } from '../host';
import type { UINode } from './protocol';
import './sandbox.css';

// Draws the UI a sandboxed plugin describes. Nothing here lets the plugin reach the network on
// its own: pictures only from data:/blob: or the app's own media (with the media permission), and
// links only to the sites in its manifest, opened in the browser.

type Fn = (...a: unknown[]) => Promise<unknown>;

function fire(f: unknown, ...args: unknown[]) {
  if (typeof f !== 'function') return;
  (f as Fn)(...args).catch((err) => toastError(err));
}

export function hostAllowed(href: string, network: string[]): boolean {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return network.some((p) => {
    const h = p.replace(/:\d+$/, '');
    return h === host || (h.startsWith('*.') && host.endsWith(h.slice(1)));
  });
}

export function imageAllowed(src: string, info: PluginInfo): boolean {
  if (/^data:image\/(png|jpeg|gif|webp|svg\+xml);/i.test(src) || src.startsWith('blob:'))
    return true;
  return (
    info.permissions.includes('media') &&
    /^\/wz-(media|avatar)\/[^/?#]+(\?(thumb|full)=1)?$/.test(src)
  );
}

function Field({
  value,
  onChange,
  onSubmit,
  multiline,
  ...rest
}: {
  value?: string;
  placeholder?: string;
  rows?: number;
  label?: string;
  multiline?: boolean;
  onChange?: unknown;
  onSubmit?: unknown;
}) {
  // typed text stays local; the plugin hears about it, and its value wins only when it changes
  const [text, setText] = useState(value ?? '');
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value ?? '');
    }
  }, [value]);
  const common = {
    className: 'wz-sbx__field',
    value: text,
    placeholder: rest.placeholder,
    'aria-label': rest.label ?? rest.placeholder,
    onChange: (e: { target: { value: string } }) => {
      setText(e.target.value);
      fire(onChange, e.target.value);
    },
  };
  return multiline ? (
    <textarea {...common} rows={rest.rows ?? 3} />
  ) : (
    <input
      {...common}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onSubmit) {
          e.preventDefault();
          fire(onSubmit, text);
        }
      }}
    />
  );
}

export function SandboxTree({ node, info }: { node: UINode; info: PluginInfo }): ReactNode {
  return <Node node={node} info={info} />;
}

function Node({ node, info }: { node: UINode; info: PluginInfo }): ReactNode {
  if (node == null || node === false) return null;
  if (typeof node === 'string') return node;
  if (typeof node !== 'object' || !('t' in node)) return null;
  const kids = (list: UINode[] | undefined) =>
    (Array.isArray(list) ? list : []).map((c, i) => <Node key={i} node={c} info={info} />);
  switch (node.t) {
    case 'text':
      return (
        <p
          className={`wz-sbx__text wz-sbx__text--${node.size ?? 'md'}${node.muted ? ' wz-sbx__text--muted' : ''}`}
          style={node.bold ? { fontWeight: 600 } : undefined}
        >
          {String(node.text ?? '')}
        </p>
      );
    case 'heading':
      return <h3 className="wz-sbx__heading">{String(node.text ?? '')}</h3>;
    case 'stack':
      return (
        <div className="wz-sbx__stack" style={{ gap: node.gap ?? 8 }}>
          {kids(node.children)}
        </div>
      );
    case 'row': {
      const justify = {
        start: 'flex-start',
        center: 'center',
        end: 'flex-end',
        between: 'space-between',
      }[node.align ?? 'start'];
      return (
        <div
          className="wz-sbx__row"
          style={{
            gap: node.gap ?? 8,
            flexWrap: node.wrap ? 'wrap' : undefined,
            justifyContent: justify,
          }}
        >
          {kids(node.children)}
        </div>
      );
    }
    case 'button':
      return (
        <Button
          variant={node.variant ?? 'secondary'}
          size="sm"
          disabled={node.disabled}
          icon={node.icon ? <PluginIcon icon={String(node.icon)} size={16} /> : undefined}
          onClick={() => fire(node.onClick)}
        >
          {String(node.label ?? '')}
        </Button>
      );
    case 'iconButton':
      return (
        <IconButton
          label={String(node.label ?? '')}
          active={node.active}
          icon={<PluginIcon icon={String(node.icon ?? '')} />}
          onClick={() => fire(node.onClick)}
        />
      );
    case 'menuItem':
      return (
        <MenuItem
          label={String(node.label ?? '')}
          danger={node.danger}
          icon={node.icon ? <PluginIcon icon={String(node.icon)} size={16} /> : undefined}
          onSelect={() => fire(node.onClick)}
        />
      );
    case 'input':
      return (
        <Field
          value={node.value}
          placeholder={node.placeholder}
          label={node.label}
          onChange={node.onChange}
          onSubmit={node.onSubmit}
        />
      );
    case 'textarea':
      return (
        <Field
          multiline
          value={node.value}
          placeholder={node.placeholder}
          rows={node.rows}
          onChange={node.onChange}
        />
      );
    case 'toggle':
      return (
        <Toggle
          label={String(node.label ?? '')}
          description={node.description}
          checked={!!node.checked}
          onChange={(v: boolean) => fire(node.onChange, v)}
        />
      );
    case 'select':
      return (
        <select
          className="wz-sbx__field"
          value={node.value}
          onChange={(e) => fire(node.onChange, e.target.value)}
        >
          {(node.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'badge':
      return <span className="wz-sbx__badge">{String(node.text ?? '')}</span>;
    case 'image': {
      const src = String(node.src ?? '');
      if (!imageAllowed(src, info)) return null;
      const style: CSSProperties = {
        width: node.width,
        height: node.height,
        borderRadius: node.radius,
      };
      return (
        <img
          className="wz-sbx__image"
          src={src}
          alt={node.alt ?? ''}
          style={style}
          draggable={false}
        />
      );
    }
    case 'list':
      return (
        <div className="wz-sbx__list" role="list">
          {(node.items ?? []).map((it) => {
            const inner = (
              <>
                <span className="wz-sbx__list-text">
                  <span className="wz-sbx__list-title">{String(it.title ?? '')}</span>
                  {it.subtitle && <span className="wz-sbx__list-sub">{String(it.subtitle)}</span>}
                </span>
                {it.right && <span className="wz-sbx__list-right">{String(it.right)}</span>}
              </>
            );
            return it.onClick ? (
              <button
                key={it.key}
                type="button"
                role="listitem"
                className="wz-sbx__list-item"
                onClick={() => fire(it.onClick)}
              >
                {inner}
              </button>
            ) : (
              <div key={it.key} role="listitem" className="wz-sbx__list-item">
                {inner}
              </div>
            );
          })}
        </div>
      );
    case 'code':
      return <pre className="wz-sbx__code">{String(node.text ?? '')}</pre>;
    case 'link':
      return hostAllowed(String(node.href), info.network) ? (
        <a href={String(node.href)} target="_blank" rel="noreferrer noopener">
          {String(node.text ?? node.href)}
        </a>
      ) : (
        <span>{String(node.text ?? '')}</span>
      );
    case 'progress':
      return (
        <progress
          className="wz-sbx__progress"
          value={Math.max(0, Math.min(1, Number(node.value) || 0))}
          max={1}
        />
      );
    case 'spinner':
      return <Spinner size={16} />;
    case 'divider':
      return <hr className="wz-sbx__divider" />;
    default:
      return null;
  }
}
