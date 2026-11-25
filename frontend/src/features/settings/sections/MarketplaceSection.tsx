import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Box,
  Check,
  Download,
  ExternalLink,
  Globe,
  KeyRound,
  Palette,
  Puzzle,
  RefreshCw,
  Search,
  ShieldCheck,
  Eye,
} from 'lucide-react';
import { backend, type MarketEntry } from '../../../api';
import { toastError, useToasts } from '../../../stores/toasts';
import { useUI } from '../../../stores/ui';
import { useUserThemes } from '../../../themes/user-themes';
import { Button, Dialog, IconButton, Input, Segmented, Spinner } from '../../../ui';
import { accessLevel, LEVEL, RISK } from './access';
import { Page } from './common';
import './MarketplaceSection.css';

type Kind = 'plugin' | 'theme';

const formatSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1 << 20
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / (1 << 20)).toFixed(1)} MB`;

let permissionText: Promise<Record<string, string>> | null = null;
const describe = () => (permissionText ??= backend.plugins.permissionInfo().catch(() => ({})));

export function MarketplaceSection() {
  const [entries, setEntries] = useState<MarketEntry[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<Kind>('plugin');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<MarketEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback((refresh = false) => {
    setLoading(true);
    setError('');
    backend.marketplace
      .list(refresh)
      .then((list) => {
        setEntries(list);
        // keep the open details in step with the fresh list
        setOpen((cur) =>
          cur
            ? (list.find((e) => e.item.id === cur.item.id && e.item.kind === cur.item.kind) ?? null)
            : null,
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);
  // after mount, not inside the effect: load() sets state right away
  useEffect(() => {
    const t = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? [])
      .filter((e) => e.item.kind === kind)
      .filter(
        (e) =>
          !q ||
          [e.item.name, e.item.description, e.item.author, ...e.item.tags]
            .join(' ')
            .toLowerCase()
            .includes(q),
      );
  }, [entries, kind, query]);
  const updates = (entries ?? []).filter((e) => e.update).length;

  const install = async (e: MarketEntry) => {
    const key = `${e.item.kind}:${e.item.id}`;
    setBusy(key);
    try {
      await backend.marketplace.install(e.item.kind, e.item.id);
      if (e.item.kind === 'theme') void useUserThemes.getState().load();
      useToasts.getState().push({
        kind: 'info',
        text:
          e.item.kind === 'plugin'
            ? `${e.item.name} ${e.installed ? 'updated' : 'installed'}. Turn it on in Settings → Plugins.`
            : `${e.item.name} ${e.installed ? 'updated' : 'installed'}. Pick it in Settings → Themes.`,
      });
      load();
    } catch (err) {
      toastError(err, `${e.item.name} not installed`);
    } finally {
      setBusy(null);
    }
  };

  const uninstall = async (e: MarketEntry) => {
    setBusy(`${e.item.kind}:${e.item.id}`);
    try {
      await backend.marketplace.uninstall(e.item.kind, e.item.id);
      if (e.item.kind === 'theme') void useUserThemes.getState().load();
      load();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page
      title="Marketplace"
      lead="Plugins and themes from other people, checked before they’re listed. Every file is verified when it’s downloaded, and plugins are signed. The list comes from GitHub (whatszori/marketplace) when you open this page."
    >
      <div className="wz-market__bar">
        <Segmented
          label="What to show"
          value={kind}
          onChange={(v) => setKind(v as Kind)}
          options={[
            { value: 'plugin', label: 'Plugins' },
            { value: 'theme', label: 'Themes' },
          ]}
        />
        <Input
          icon={<Search size={16} />}
          placeholder="Search"
          aria-label="Search the marketplace"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <IconButton
          label="Load the list again"
          icon={loading ? <Spinner size={16} /> : <RefreshCw size={16} />}
          disabled={loading}
          onClick={() => load(true)}
        />
      </div>
      {updates > 0 && (
        <p className="wz-market__updates">
          {updates === 1 ? 'An update is ready.' : `${updates} updates are ready.`}
        </p>
      )}

      {error ? (
        <div className="wz-market__state">
          <p>{error}</p>
          <Button onClick={() => load(true)}>Try again</Button>
        </div>
      ) : !entries ? (
        <div className="wz-market__state">
          <Spinner size={20} />
        </div>
      ) : shown.length === 0 ? (
        <div className="wz-market__state">
          <p>
            {query ? 'Nothing matches.' : kind === 'plugin' ? 'No plugins yet.' : 'No themes yet.'}
          </p>
        </div>
      ) : (
        <div className="wz-market__grid">
          {shown.map((e) => (
            <Card
              key={`${e.item.kind}:${e.item.id}`}
              e={e}
              busy={busy === `${e.item.kind}:${e.item.id}`}
              onOpen={() => setOpen(e)}
              onInstall={() => void install(e)}
            />
          ))}
        </div>
      )}

      <p className="wz-market__submit">
        Made something? Send it to the marketplace with a pull request:{' '}
        <a
          href="https://github.com/whatszori/marketplace"
          target="_blank"
          rel="noreferrer noopener"
        >
          github.com/whatszori/marketplace
        </a>
      </p>

      {open && (
        <Details
          e={open}
          busy={busy === `${open.item.kind}:${open.item.id}`}
          onClose={() => setOpen(null)}
          onInstall={() => void install(open)}
          onUninstall={() => void uninstall(open)}
        />
      )}
    </Page>
  );
}

function ItemIcon({ e, size = 40 }: { e: MarketEntry; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="wz-market__icon" style={{ width: size, height: size }} aria-hidden="true">
      {e.item.icon && !broken ? (
        <img src={e.item.icon} alt="" onError={() => setBroken(true)} />
      ) : e.item.kind === 'theme' ? (
        <Palette size={size / 2} />
      ) : (
        <Puzzle size={size / 2} />
      )}
    </span>
  );
}

function Chips({ e }: { e: MarketEntry }) {
  const level = accessLevel(e.item.permissions, e.item.network);
  return (
    <div className="wz-market__chips">
      {e.item.kind === 'plugin' && (
        <span className={`wz-plugin-chip wz-market__level wz-market__level--${level}`}>
          {LEVEL[level].short}
        </span>
      )}
      {e.item.sandbox && (
        <span className="wz-plugin-chip wz-plugin-chip--good">
          <Box size={12} /> Sandboxed
        </span>
      )}
      {e.publisher ? (
        <span className="wz-plugin-chip wz-plugin-chip--good" title={`Signed by ${e.publisher}`}>
          <BadgeCheck size={12} /> {e.publisher}
        </span>
      ) : e.item.key ? (
        <span className="wz-plugin-chip" title={`Signed with key ${e.item.key}`}>
          <KeyRound size={12} /> Signed
        </span>
      ) : null}
    </div>
  );
}

function Action({
  e,
  busy,
  onInstall,
  onOpen,
}: {
  e: MarketEntry;
  busy: boolean;
  onInstall: () => void;
  onOpen: () => void;
}) {
  if (busy)
    return (
      <Button size="sm" disabled icon={<Spinner size={14} />}>
        Installing
      </Button>
    );
  if (e.update)
    return (
      <Button size="sm" variant="primary" icon={<Download size={14} />} onClick={onInstall}>
        Update to {e.item.version}
      </Button>
    );
  if (e.installed)
    return (
      <Button size="sm" variant="ghost" icon={<Check size={14} />} onClick={onOpen}>
        Installed
      </Button>
    );
  return (
    <Button size="sm" variant="primary" icon={<Download size={14} />} onClick={onInstall}>
      Install
    </Button>
  );
}

function Card({
  e,
  busy,
  onOpen,
  onInstall,
}: {
  e: MarketEntry;
  busy: boolean;
  onOpen: () => void;
  onInstall: () => void;
}) {
  return (
    <article className="wz-market__card">
      <button type="button" className="wz-market__card-main" onClick={onOpen}>
        <ItemIcon e={e} />
        <span className="wz-market__card-text">
          <span className="wz-market__name">{e.item.name}</span>
          <span className="wz-market__by">
            {e.item.author || 'Unknown'} · v{e.item.version}
          </span>
          <span className="wz-market__desc">{e.item.description}</span>
        </span>
      </button>
      <div className="wz-market__card-foot">
        <Chips e={e} />
        <Action e={e} busy={busy} onInstall={onInstall} onOpen={onOpen} />
      </div>
    </article>
  );
}

function Details({
  e,
  busy,
  onClose,
  onInstall,
  onUninstall,
}: {
  e: MarketEntry;
  busy: boolean;
  onClose: () => void;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const [text, setText] = useState<Record<string, string>>({});
  useEffect(() => {
    void describe().then(setText);
  }, []);
  const it = e.item;
  const level = accessLevel(it.permissions, it.network);
  const size = it.files.reduce((n, f) => n + f.size, 0);
  const perms = it.permissions
    .filter((x) => x !== 'network')
    .sort((a, b) => (RISK[b] ?? 1) - (RISK[a] ?? 1));
  return (
    <Dialog
      open
      title={it.name}
      width={560}
      onClose={onClose}
      footer={
        <div className="wz-market__dfoot">
          {e.installed && !busy ? (
            <Button variant="ghost" onClick={onUninstall}>
              Uninstall
            </Button>
          ) : (
            <span />
          )}
          <div className="wz-market__dfoot-right">
            {e.installed && it.kind === 'plugin' && (
              <Button
                onClick={() => {
                  onClose();
                  useUI.getState().openSettings('plugins');
                }}
              >
                Open in Plugins
              </Button>
            )}
            {e.installed && it.kind === 'theme' && (
              <Button
                onClick={() => {
                  onClose();
                  useUI.getState().openSettings('themes');
                }}
              >
                Open in Themes
              </Button>
            )}
            {(!e.installed || e.update) && (
              <Action e={e} busy={busy} onInstall={onInstall} onOpen={onClose} />
            )}
          </div>
        </div>
      }
    >
      <div className="wz-market__details">
        <div className="wz-market__dhead">
          <ItemIcon e={e} size={56} />
          <div>
            <p className="wz-market__by">
              {it.author || 'Unknown'} · v{it.version}
              {e.installed && e.installed !== it.version && ` (installed ${e.installed})`}
              {size > 0 && ` · ${formatSize(size)}`}
            </p>
            <Chips e={e} />
          </div>
        </div>
        <p className="wz-market__dtext">{it.description}</p>
        {it.screenshots.length > 0 && (
          <div className="wz-market__shots">
            {it.screenshots.map((s) => (
              <img key={s} src={s} alt="" loading="lazy" />
            ))}
          </div>
        )}
        {it.kind === 'plugin' && (
          <section className="wz-market__perms">
            <h3>{LEVEL[level].title}</h3>
            {perms.length === 0 && it.network.length === 0 ? (
              <p>It doesn’t ask for anything beyond adding buttons and panels.</p>
            ) : (
              <ul className="wz-approve__list">
                {perms.map((x) => (
                  <li key={x} className={RISK[x] === 2 ? 'wz-approve__risky' : undefined}>
                    {RISK[x] === 2 ? (
                      <Eye size={16} aria-hidden="true" />
                    ) : (
                      <ShieldCheck size={16} aria-hidden="true" />
                    )}
                    <span>{text[x] ?? x}</span>
                  </li>
                ))}
                {it.network.map((d) => (
                  <li key={d} className="wz-approve__risky">
                    <Globe size={16} aria-hidden="true" />
                    <code>{d}</code>
                  </li>
                ))}
              </ul>
            )}
            <p className="wz-market__note">You’ll be asked to allow this when you turn it on.</p>
          </section>
        )}
        <dl className="wz-market__facts">
          {it.key && (
            <>
              <dt>Signing key</dt>
              <dd>
                <code>{it.key}</code>
                {e.publisher && ` (${e.publisher})`}
              </dd>
            </>
          )}
          {it.minAppVersion && (
            <>
              <dt>Needs</dt>
              <dd>WhatsZori {it.minAppVersion} or newer</dd>
            </>
          )}
          {it.updated && (
            <>
              <dt>Updated</dt>
              <dd>{new Date(it.updated).toLocaleDateString()}</dd>
            </>
          )}
          {it.tags.length > 0 && (
            <>
              <dt>Tags</dt>
              <dd>{it.tags.join(', ')}</dd>
            </>
          )}
        </dl>
        {(it.repo || it.homepage) && (
          <div className="wz-market__links">
            {it.repo && (
              <a href={it.repo} target="_blank" rel="noreferrer noopener">
                <ExternalLink size={14} /> Source code
              </a>
            )}
            {it.homepage && (
              <a href={it.homepage} target="_blank" rel="noreferrer noopener">
                <ExternalLink size={14} /> Homepage
              </a>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
