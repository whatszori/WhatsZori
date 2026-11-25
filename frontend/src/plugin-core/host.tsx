import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Puzzle, X } from 'lucide-react';
import type { Chat } from '../api';
import { toPluginChat } from '../features/conversation/plugin-adapters';
import { useUI } from '../stores/ui';
import { toastError } from '../stores/toasts';
import { Dialog, IconButton, Menu, Tooltip, useLayer } from '../ui';
import { closePluginView, openPluginView } from './context';
import { ErrorBoundary } from './ErrorBoundary';
import { useOverlays } from './overlays';
import { commands, panels, useRegistry, usePluginUI, views, type Entry } from './registry';
import { formatShortcut, matches, parseShortcut, type Shortcut } from './shortcuts';
import type { Command } from './types';
import './host.css';

// Everything plugins put on screen outside of slots: their dialogs and menus, the command
// palette (Ctrl+Shift+P) with app and plugin commands, plugin shortcuts, side panels and views.

const PALETTE = parseShortcut('Mod+Shift+P');

function shortcutOf(c: Command): Shortcut | null {
  try {
    return c.shortcut ? parseShortcut(c.shortcut) : null;
  } catch {
    return null;
  }
}

async function runCommand(e: Entry<Command>) {
  try {
    await e.value.run();
  } catch (err) {
    toastError(err, e.value.title);
  }
}

// a plugin's icon may be an emoji string or an element
export function PluginIcon({ icon, size = 18 }: { icon?: ReactNode; size?: number }) {
  if (icon == null || icon === '') return <Puzzle size={size} />;
  if (typeof icon === 'string')
    return (
      <span className="wz-plugin-icon" style={{ fontSize: size - 2 }} aria-hidden="true">
        {icon}
      </span>
    );
  return <>{icon}</>;
}

export function PluginHost() {
  const dialogs = useOverlays((s) => s.dialogs);
  const menu = useOverlays((s) => s.menu);
  const paletteOpen = useOverlays((s) => s.paletteOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if (matches(PALETTE, e)) {
        e.preventDefault();
        useOverlays.getState().setPaletteOpen(!useOverlays.getState().paletteOpen);
        return;
      }
      for (const c of commands.list()) {
        // the app's own commands have their own handlers; only plugin shortcuts run here
        if (c.pluginId === 'app') continue;
        const s = shortcutOf(c.value);
        if (s && matches(s, e) && c.value.when?.() !== false) {
          e.preventDefault();
          void runCommand(c);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {dialogs.map((d) => {
        const Body = d.opts.render;
        const Footer = d.opts.footer;
        const close = () => useOverlays.getState().closeDialog(d.id);
        return (
          <Dialog
            key={d.id}
            open
            title={d.opts.title}
            width={d.opts.width}
            onClose={close}
            footer={
              Footer && (
                <ErrorBoundary label={`plugin "${d.pluginId}" dialog footer`}>
                  <Footer close={close} />
                </ErrorBoundary>
              )
            }
          >
            <ErrorBoundary
              label={`plugin "${d.pluginId}" dialog`}
              fallback={<p>This plugin’s dialog crashed.</p>}
            >
              <Body close={close} />
            </ErrorBoundary>
          </Dialog>
        );
      })}
      <Menu
        open={!!menu}
        anchor={menu?.at ?? null}
        label="Plugin menu"
        onClose={() => useOverlays.getState().showMenu(null)}
        items={(menu?.items ?? []).map((it, i) => ({
          id: String(i),
          label: it.label,
          icon: typeof it.icon === 'string' ? <PluginIcon icon={it.icon} size={16} /> : it.icon,
          danger: it.danger,
          disabled: it.disabled,
          onSelect: () => {
            useOverlays.getState().showMenu(null);
            try {
              it.onSelect();
            } catch (err) {
              toastError(err);
            }
          },
        }))}
      />
      {paletteOpen && <Palette onClose={() => useOverlays.getState().setPaletteOpen(false)} />}
    </>
  );
}

function words(s: string) {
  return s.toLowerCase();
}

function Palette({ onClose }: { onClose: () => void }) {
  const all = useRegistry(commands);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useLayer(true, onClose);

  const items = useMemo(() => {
    const q = words(query).split(/\s+/).filter(Boolean);
    return all.filter((c) => {
      if (c.value.when?.() === false) return false;
      const hay = words(
        [c.value.title, ...(c.value.keywords ?? []), c.pluginId === 'app' ? '' : c.pluginId].join(
          ' ',
        ),
      );
      return q.every((w) => hay.includes(w));
    });
  }, [all, query]);
  const current = Math.min(sel, Math.max(0, items.length - 1));

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const run = (e: Entry<Command> | undefined) => {
    if (!e) return;
    onClose();
    // after the palette is gone, so a command that opens a dialog gets the focus
    setTimeout(() => void runCommand(e), 0);
  };

  return (
    <div
      className="wz-palette__scrim"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="wz-palette" role="dialog" aria-modal="true" aria-label="Commands">
        <div className="wz-palette__search">
          <ChevronRight size={18} aria-hidden="true" />
          <input
            autoFocus
            value={query}
            placeholder="Type a command"
            aria-label="Command"
            aria-controls="wz-palette-list"
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((current + 1) % Math.max(1, items.length));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((current - 1 + items.length) % Math.max(1, items.length));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(items[current]);
              }
            }}
          />
        </div>
        <div className="wz-palette__list" id="wz-palette-list" role="listbox" ref={listRef}>
          {items.length === 0 && <p className="wz-palette__empty">No commands match.</p>}
          {items.map((c, i) => {
            const s = shortcutOf(c.value);
            return (
              <div
                key={c.key}
                role="option"
                aria-selected={i === current}
                className="wz-palette__item"
                onPointerMove={() => i !== current && setSel(i)}
                onClick={() => run(c)}
              >
                <span className="wz-palette__title">{c.value.title}</span>
                {c.pluginId !== 'app' && <span className="wz-palette__source">{c.pluginId}</span>}
                {s && <kbd className="wz-palette__kbd">{formatShortcut(s)}</kbd>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---- panels next to the conversation ----

export function PanelButtons({ chat }: { chat: Chat }) {
  const list = useRegistry(panels);
  const open = usePluginUI((s) => s.panel);
  return (
    <>
      {list
        .filter((p) => p.value.button !== false)
        .map((p) => (
          <IconButton
            key={p.key}
            label={p.value.title}
            icon={<PluginIcon icon={p.value.icon} />}
            active={open === p.key}
            onClick={() => {
              if (open === p.key) usePluginUI.getState().setPanel(null);
              else {
                useUI.getState().setChatInfoOpen(false);
                usePluginUI.getState().setPanel(p.key);
              }
            }}
            data-chat={chat.jid}
          />
        ))}
    </>
  );
}

export function PluginPanel({ chat }: { chat: Chat }) {
  const key = usePluginUI((s) => s.panel);
  useRegistry(panels);
  const entry = key ? panels.get(key) : undefined;
  const close = () => usePluginUI.getState().setPanel(null);
  useLayer(!!entry, close);
  if (!entry) return null;
  const Body = entry.value.render;
  return (
    <aside className="wz-info wz-plugin-panel" aria-label={entry.value.title}>
      <header className="wz-info__header">
        <IconButton label="Close" hint="Esc" icon={<X size={18} />} onClick={close} />
        <h2 className="wz-info__title">{entry.value.title}</h2>
      </header>
      <div className="wz-info__scroll wz-plugin-panel__body">
        <ErrorBoundary
          key={key}
          label={`plugin "${entry.pluginId}" panel`}
          fallback={<p>This panel crashed.</p>}
        >
          <Body chat={toPluginChat(chat)} close={close} />
        </ErrorBoundary>
      </div>
    </aside>
  );
}

// ---- whole-screen views ----

export function usePluginViews() {
  return useRegistry(views);
}

export function toggleView(key: string) {
  if (useUI.getState().view === 'plugin' && usePluginUI.getState().view === key) closePluginView();
  else openPluginView(key);
}

export function ViewButtons() {
  const list = usePluginViews();
  const view = useUI((s) => s.view);
  const open = usePluginUI((s) => s.view);
  return (
    <>
      {list.map((v) => (
        <IconButton
          key={v.key}
          label={v.value.title}
          icon={<PluginIcon icon={v.value.icon} />}
          active={view === 'plugin' && open === v.key}
          onClick={() => toggleView(v.key)}
        />
      ))}
    </>
  );
}

export function RailViewButtons() {
  const list = usePluginViews();
  const view = useUI((s) => s.view);
  const open = usePluginUI((s) => s.view);
  return (
    <>
      {list.map((v) => {
        const active = view === 'plugin' && open === v.key;
        return (
          <Tooltip key={v.key} label={v.value.title}>
            <button
              type="button"
              aria-label={v.value.title}
              aria-current={active ? 'page' : undefined}
              className={`wz-rail__item${active ? ' wz-rail__item--active' : ''}`}
              onClick={() => toggleView(v.key)}
            >
              <PluginIcon icon={v.value.icon} size={20} />
            </button>
          </Tooltip>
        );
      })}
    </>
  );
}

export function PluginViewHost() {
  const key = usePluginUI((s) => s.view);
  useRegistry(views);
  const entry = key ? views.get(key) : undefined;
  useEffect(() => {
    // the plugin stopped while its view was open
    if (!entry) closePluginView();
  }, [entry]);
  if (!entry) return null;
  const Body = entry.value.render;
  return (
    <section className="wz-plugin-view" aria-label={entry.value.title}>
      <header className="wz-plugin-view__header">
        <span className="wz-plugin-view__icon" aria-hidden="true">
          <PluginIcon icon={entry.value.icon} size={20} />
        </span>
        <h1 className="wz-plugin-view__title">{entry.value.title}</h1>
        <IconButton label="Close" icon={<X size={18} />} onClick={closePluginView} />
      </header>
      <div className="wz-plugin-view__body">
        <ErrorBoundary
          key={key}
          label={`plugin "${entry.pluginId}" view`}
          fallback={<p>This screen crashed.</p>}
        >
          <Body close={closePluginView} />
        </ErrorBoundary>
      </div>
    </section>
  );
}
