import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Box,
  Eye,
  FolderOpen,
  Globe,
  KeyRound,
  Puzzle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { backend, type PluginInfo, type PluginSettingField } from '../../../api';
import {
  isRunning,
  onPluginsChanged,
  pluginError,
  startPlugin,
  stopPlugin,
} from '../../../plugin-core/loader';
import { parseValue, setSetting } from '../../../plugin-core/settings';
import { PluginSlot, useSlotEntries } from '../../../plugin-core/slots';
import { useSettings } from '../../../stores/settings';
import { toastError } from '../../../stores/toasts';
import { Button, Dialog, Input, Toggle } from '../../../ui';
import { Group, Page, Row } from './common';
import { accessLevel, andList, LEVEL, READS, RISK, VERB, type Level } from './access';
import './PluginsSection.css';

let version = 0;
const subscribe = (fn: () => void) =>
  onPluginsChanged(() => {
    version++;
    fn();
  });

// short words for the list; the dialog shows the full sentences from Go
const SHORT: Record<string, string> = {
  messages: 'reads messages',
  contacts: 'sees contacts',
  media: 'shows media',
  composer: 'writes in the message box',
  notifications: 'notifications',
  clipboard: 'clipboard',
  files: 'saves files',
  'chats.manage': 'pins, mutes, archives',
  presence: 'sees online and typing',
  network: 'internet',
};

let permissionText: Promise<Record<string, string>> | null = null;
const describe = () => (permissionText ??= backend.plugins.permissionInfo().catch(() => ({})));

export function PluginsSection() {
  const pluginSettings = useSlotEntries('settings.sections');
  const safeMode = useSettings((s) => s.safeMode);
  const [list, setList] = useState<PluginInfo[] | null>(null);
  const [asking, setAsking] = useState<{ p: PluginInfo; turnOn: boolean } | null>(null);
  // re-render when a plugin starts, stops or fails, and after files changed
  useSyncExternalStore(subscribe, () => version);

  const load = useCallback(() => {
    backend.plugins
      .list()
      .then(setList)
      .catch((err) => toastError(err));
  }, []);
  useEffect(load, [load]);
  useEffect(() => onPluginsChanged(load), [load]);

  const turnOn = async (p: PluginInfo) => {
    await backend.plugins.setEnabled(p.id, true);
    const fresh = (await backend.plugins.list()).find((x) => x.id === p.id);
    if (!safeMode && fresh) await startPlugin(fresh);
  };

  const toggle = async (p: PluginInfo, on: boolean) => {
    try {
      if (on && p.needsApproval) {
        setAsking({ p, turnOn: true });
        return;
      }
      if (on) await turnOn(p);
      else {
        await backend.plugins.setEnabled(p.id, false);
        stopPlugin(p.id);
      }
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const approve = async (p: PluginInfo, andTurnOn: boolean) => {
    try {
      await backend.plugins.approve(p.id);
      if (andTurnOn || p.enabled) await turnOn(p);
      setAsking(null);
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const revoke = async (p: PluginInfo) => {
    try {
      stopPlugin(p.id);
      await backend.plugins.revoke(p.id);
      load();
    } catch (err) {
      toastError(err);
    }
  };

  const withSettings = (list ?? []).filter((p) => p.settings.length > 0 && !p.error);
  const desktop = backend.kind === 'wails';
  return (
    <Page
      title="Plugins"
      lead="Plugins add buttons, panels, commands and settings to the app. Put a plugin’s folder into the plugins folder, then turn it on here. A plugin only gets what it asks for and you allow."
    >
      {safeMode && (
        <p className="wz-note">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>Safe mode is on, so no plugin runs. Restart normally to load them again.</span>
        </p>
      )}
      <Group title="Installed">
        {list && list.length === 0 && (
          <p className="wz-settings-hint">
            {desktop
              ? 'No plugins yet. Each plugin is a folder with a manifest.json and its script.'
              : 'Plugins load from the config folder in the desktop app.'}
          </p>
        )}
        <div className="wz-ext-list">
          {(list ?? []).map((p) => (
            <PluginRow
              key={p.id}
              p={p}
              safeMode={safeMode}
              onToggle={(on) => void toggle(p, on)}
              onRevoke={() => void revoke(p)}
              onReview={() => setAsking({ p, turnOn: false })}
            />
          ))}
        </div>
      </Group>
      <div className="wz-settings-actions">
        <Button
          icon={<FolderOpen size={16} />}
          disabled={!desktop}
          title={desktop ? undefined : 'Available in the desktop app'}
          onClick={() => void backend.system.openConfigFolder('plugins')}
        >
          Open plugins folder
        </Button>
        <Button icon={<RefreshCw size={16} />} onClick={load}>
          Look again
        </Button>
      </div>
      {(withSettings.length > 0 || pluginSettings.length > 0) && (
        <Group title="Plugin settings">
          {withSettings.map((p) => (
            <SettingsForm key={p.id} p={p} />
          ))}
          {pluginSettings.length > 0 && (
            <div className="wz-plugin-settings">
              <PluginSlot name="settings.sections" />
            </div>
          )}
        </Group>
      )}
      {asking && (
        <ApprovalDialog
          p={asking.p}
          turnOn={asking.turnOn}
          onCancel={() => setAsking(null)}
          onAllow={() => void approve(asking.p, asking.turnOn)}
        />
      )}
    </Page>
  );
}

function SignatureChip({ p }: { p: PluginInfo }) {
  const s = p.signature;
  if (s.state === 'signed' && s.publisher)
    return (
      <span
        className="wz-plugin-chip wz-plugin-chip--good"
        title={`Signed by ${s.publisher} (key ${s.key})`}
      >
        <BadgeCheck size={12} /> {s.publisher}
      </span>
    );
  if (s.state === 'signed')
    return (
      <span className="wz-plugin-chip" title={`Signed with key ${s.key}`}>
        <KeyRound size={12} /> Signed · {s.key?.slice(0, 9)}
      </span>
    );
  if (s.state === 'invalid')
    return (
      <span className="wz-plugin-chip wz-plugin-chip--bad" title={s.reason}>
        <ShieldAlert size={12} /> Signature broken
      </span>
    );
  return <span className="wz-plugin-chip">Unsigned</span>;
}

function PluginRow({
  p,
  safeMode,
  onToggle,
  onReview,
  onRevoke,
}: {
  p: PluginInfo;
  safeMode: boolean;
  onToggle: (on: boolean) => void;
  onReview: () => void;
  onRevoke: () => void;
}) {
  const failed = p.error || pluginError(p.id);
  const [iconBroken, setIconBroken] = useState(false);
  const icon = p.icon && !iconBroken ? backend.plugins.url(p.id, p.icon) : '';
  const asks = [
    ...p.permissions.filter((x) => x !== 'network').map((x) => SHORT[x] ?? x),
    ...(p.network.length ? [`internet: ${p.network.join(', ')}`] : []),
  ];
  return (
    <div className="wz-ext-item wz-plugin-row">
      <span className="wz-ext-item__icon" aria-hidden="true">
        {failed ? (
          <AlertTriangle size={18} strokeWidth={1.75} />
        ) : icon ? (
          <img src={icon} alt="" onError={() => setIconBroken(true)} />
        ) : (
          <Puzzle size={18} strokeWidth={1.75} />
        )}
      </span>
      <div className="wz-plugin-row__main">
        <Toggle
          label={p.name}
          description={[p.description, p.version && `v${p.version}`, p.author && `by ${p.author}`]
            .filter(Boolean)
            .join(' · ')}
          checked={p.enabled}
          disabled={!!p.error && !p.enabled}
          onChange={onToggle}
        />
        <div className="wz-plugin-row__chips">
          <SignatureChip p={p} />
          {p.sandbox && (
            <span
              className="wz-plugin-chip wz-plugin-chip--good"
              title="Runs isolated, without access to the page"
            >
              <Box size={12} /> Sandboxed
            </span>
          )}
          {p.apiVersion < 2 && (
            <span
              className="wz-plugin-chip"
              title="Made for the first plugin API: reads messages and writes in the message box without asking"
            >
              API 1
            </span>
          )}
          {asks.length > 0 && <span className="wz-plugin-row__asks">Can: {asks.join(' · ')}</span>}
          {p.apiVersion >= 2 && !p.needsApproval && !p.error && (
            <button
              type="button"
              className="wz-plugin-row__revoke"
              title="Turn it off and forget what you allowed; turning it on asks again"
              onClick={onRevoke}
            >
              Revoke
            </button>
          )}
        </div>
        {failed && <p className="wz-plugin-row__error">Can’t load: {failed}</p>}
        {!failed && p.enabled && p.needsApproval && (
          <p className="wz-plugin-row__warn">
            <ShieldAlert size={14} aria-hidden="true" />
            {p.keyChanged
              ? 'This version is signed by someone else. It stays off until you look.'
              : 'This version asks for more. It stays off until you allow it.'}
            <Button size="sm" onClick={onReview}>
              Review
            </Button>
          </p>
        )}
        {!failed && p.enabled && !p.needsApproval && !safeMode && !isRunning(p.id) && (
          <p className="wz-plugin-row__meta">starting…</p>
        )}
      </div>
    </div>
  );
}

const HOLD_MS = 1100;

// For high access a click isn't enough: Allow has to be held down (or Space / Enter held) for
// about a second, so it can't be clicked through on the way somewhere else.
function HoldButton({
  disabled,
  label,
  onDone,
  children,
}: {
  disabled: boolean;
  label: string;
  onDone: () => void;
  children?: ReactNode;
}) {
  const [progress, setProgress] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const start = () => {
    if (disabled || timer.current) return;
    let began = 0;
    timer.current = window.setInterval(() => {
      const now = performance.now();
      began ||= now;
      const p = Math.min(1, (now - began) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        stop();
        onDone();
      }
    }, 16);
  };
  const stop = () => {
    window.clearInterval(timer.current);
    timer.current = undefined;
    setProgress(0);
  };
  useEffect(() => () => window.clearInterval(timer.current), []);
  return (
    <Button
      variant="danger"
      disabled={disabled}
      className="wz-approve__hold"
      style={{ ['--hold' as string]: progress }}
      title={disabled ? 'Read the list first' : 'Press and hold'}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && stop()}
      onBlur={stop}
    >
      <span className="wz-approve__hold-fill" aria-hidden="true" />
      <span className="wz-approve__hold-text">
        {label}
        {children}
      </span>
    </Button>
  );
}

// Allow waits until the end of the list has been on screen with the window in front, a moment
// longer for every risky permission. Nobody has to tick boxes, but clicking through without
// looking takes longer than reading.
function useReadGate(asks: number, risky: number) {
  const end = useRef<HTMLDivElement>(null);
  const need = asks === 0 ? 0 : Math.min(4000, 1200 + risky * 900);
  const [left, setLeft] = useState(need);
  const seen = useRef(false);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) seen.current = true;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (need === 0) return;
    let last = performance.now();
    const t = window.setInterval(() => {
      const now = performance.now();
      // only time spent looking counts
      if (seen.current && document.hasFocus() && document.visibilityState === 'visible')
        setLeft((l) => Math.max(0, l - (now - last)));
      last = now;
    }, 100);
    return () => window.clearInterval(t);
  }, [need]);
  return { end, left };
}

function ApprovalDialog({
  p,
  turnOn,
  onCancel,
  onAllow,
}: {
  p: PluginInfo;
  turnOn: boolean;
  onCancel: () => void;
  onAllow: () => void;
}) {
  const [text, setText] = useState<Record<string, string>>({});
  useEffect(() => {
    void describe().then(setText);
  }, []);
  const perms = p.permissions
    .filter((x) => x !== 'network')
    .sort((a, b) => (RISK[b] ?? 1) - (RISK[a] ?? 1));
  const risky = p.permissions.filter((x) => RISK[x] === 2);
  const isNew = (x: string) => p.enabled && p.newPermissions.includes(x);
  const reads = p.permissions.filter((x) => READS[x]);
  const leaks = reads.length > 0 && p.network.length > 0;
  const s = p.signature;
  const { end, left } = useReadGate(p.permissions.length, risky.length);
  const verbs = risky.map((x) => VERB[x]).filter(Boolean);
  const allowLabel = verbs.length
    ? `Allow: ${verbs.join(', ')}`
    : turnOn
      ? 'Allow and turn on'
      : 'Allow';
  // reading plus a way out, or most of the sensitive list: that's high
  const level: Level = accessLevel(p.permissions, p.network);
  return (
    <Dialog
      open
      title={`Allow ${p.name}?`}
      width={480}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" autoFocus onClick={onCancel}>
            Cancel
          </Button>
          {level === 'high' ? (
            <HoldButton
              disabled={left > 0}
              label={`Hold to allow: ${verbs.join(', ')}`}
              onDone={onAllow}
            >
              {left > 0 && <span className="wz-approve__wait"> ({Math.ceil(left / 1000)})</span>}
            </HoldButton>
          ) : (
            <Button
              variant="primary"
              disabled={left > 0}
              title={left > 0 ? 'Read the list first' : undefined}
              onClick={onAllow}
            >
              {allowLabel}
              {left > 0 && <span className="wz-approve__wait"> ({Math.ceil(left / 1000)})</span>}
            </Button>
          )}
        </>
      }
    >
      <div className="wz-approve">
        <div className={`wz-approve__level wz-approve__level--${level}`}>
          <strong>{LEVEL[level].title}</strong>
          <span>{LEVEL[level].text}</span>
        </div>
        {perms.length === 0 && p.network.length === 0 ? (
          <p>It doesn’t ask for anything beyond adding buttons and panels to the app.</p>
        ) : (
          <p>It will be able to:</p>
        )}
        {perms.length > 0 && (
          <ul className="wz-approve__list">
            {perms.map((x) => (
              <li key={x} className={RISK[x] === 2 ? 'wz-approve__risky' : undefined}>
                {RISK[x] === 2 ? (
                  <Eye size={16} aria-label="Sensitive" />
                ) : (
                  <ShieldCheck size={16} aria-hidden="true" />
                )}
                <span>
                  {text[x] ?? x}
                  {isNew(x) && <span className="wz-plugin-chip wz-plugin-chip--new">new</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {p.network.length > 0 && (
          <>
            <p>Connect to these sites, and only these:</p>
            <ul className="wz-approve__list wz-approve__sites">
              {p.network.map((d) => (
                <li key={d} className="wz-approve__risky">
                  <Globe size={16} aria-hidden="true" />
                  <code>{d}</code>
                  {p.enabled && p.newNetwork.includes(d) && (
                    <span className="wz-plugin-chip wz-plugin-chip--new">new</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {leaks && (
          <p className="wz-approve__together">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>
              Together, this means it can send {andList(reads.map((x) => READS[x]))} to{' '}
              {p.network.length === 1 ? p.network[0] : `${p.network.length} sites`}.
            </span>
          </p>
        )}
        <div
          className={`wz-approve__sig${s.state === 'signed' && !p.keyChanged ? '' : ' wz-approve__sig--warn'}`}
        >
          {p.keyChanged ? (
            <>
              <ShieldAlert size={16} aria-hidden="true" />
              <span>
                Signed with a different key than the version you allowed before ({s.key}). If you
                didn’t expect a new publisher, don’t allow it.
              </span>
            </>
          ) : s.state === 'signed' ? (
            <>
              <KeyRound size={16} aria-hidden="true" />
              <span>
                {s.publisher ? `Signed by ${s.publisher}` : 'Signed'} with key <code>{s.key}</code>.
                A later version signed with another key will have to be allowed again.
              </span>
            </>
          ) : (
            <>
              <ShieldAlert size={16} aria-hidden="true" />
              <span>
                Not signed, so there’s no telling who made it. Only allow plugins you trust.
              </span>
            </>
          )}
        </div>
        {p.sandbox ? (
          <p className="wz-approve__note">
            It runs isolated from the app’s page: it can only do what’s listed above.
          </p>
        ) : (
          <p className="wz-approve__note">
            It runs inside the app’s page. WhatsZori checks what it calls, but a plugin written to
            misbehave could get around that, so this list is a promise more than a wall.
          </p>
        )}
        {/* the end of the list: Allow starts counting once this has been on screen */}
        <div ref={end} aria-hidden="true" />
      </div>
    </Dialog>
  );
}

function SettingsForm({ p }: { p: PluginInfo }) {
  const [values, setValues] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    backend.plugins
      .settings(p.id)
      .then(setValues)
      .catch(() => setValues({}));
  }, [p.id]);
  if (!values) return null;
  const save = async (f: PluginSettingField, v: string | number | boolean) => {
    try {
      await setSetting(p.id, f.key, v);
      setValues((cur) => ({ ...cur, [f.key]: String(v) }));
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <div className="wz-plugin-form">
      <h4 className="wz-plugin-form__title">{p.name}</h4>
      {p.settings.map((f) => (
        <SettingField
          key={`${f.key}:${values[f.key] ?? ''}`}
          f={f}
          value={parseValue(f, values[f.key])}
          onSave={(v) => void save(f, v)}
        />
      ))}
    </div>
  );
}

function SettingField({
  f,
  value,
  onSave,
}: {
  f: PluginSettingField;
  value: string | number | boolean | undefined;
  onSave: (v: string | number | boolean) => void;
}) {
  // keyed by the saved value (see SettingsForm), so a new value starts a fresh draft
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  const commit = () => {
    if (draft === (value === undefined ? '' : String(value))) return;
    onSave(f.type === 'number' ? Number(draft) : draft);
  };
  switch (f.type) {
    case 'toggle':
      return (
        <Toggle
          label={f.label}
          description={f.description}
          checked={value === true}
          onChange={onSave}
        />
      );
    case 'select':
      return (
        <Row label={f.label} description={f.description}>
          <select
            className="wz-plugin-form__select"
            value={String(value ?? '')}
            onChange={(e) => onSave(e.target.value)}
          >
            {value === undefined && <option value="">Choose…</option>}
            {(f.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>
      );
    case 'textarea':
      return (
        <Row label={f.label} description={f.description} stack>
          <textarea
            className="wz-plugin-form__textarea"
            rows={4}
            value={draft}
            placeholder={f.placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
          />
        </Row>
      );
    default:
      return (
        <Row label={f.label} description={f.description} stack>
          <Input
            type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
            value={draft}
            min={f.min}
            max={f.max}
            placeholder={f.placeholder}
            autoComplete="off"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </Row>
      );
  }
}
