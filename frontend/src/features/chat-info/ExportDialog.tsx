import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import {
  backend,
  type ExportFormat,
  type ExportMedia,
  type ExportOptions,
  type JID,
} from '../../api';
import { useExports } from '../../stores/exports';
import { toastError, useToasts } from '../../stores/toasts';
import { Button, Dialog, Segmented, Spinner } from '../../ui';
import './ExportDialog.css';

const MEDIA: { value: ExportMedia; label: string }[] = [
  { value: 'photo', label: 'Photos' },
  { value: 'video', label: 'Videos' },
  { value: 'voice', label: 'Voice messages' },
  { value: 'round', label: 'Video messages' },
  { value: 'sticker', label: 'Stickers' },
  { value: 'gif', label: 'GIFs' },
  { value: 'file', label: 'Files' },
];

const LIMITS: { value: string; label: string }[] = [
  { value: '0', label: 'No limit' },
  { value: '5', label: '5 MB' },
  { value: '16', label: '16 MB' },
  { value: '64', label: '64 MB' },
  { value: '100', label: '100 MB' },
];

const FORMATS: { value: ExportFormat; label: string; note: string }[] = [
  { value: 'html', label: 'HTML', note: 'A page that looks like WhatsZori. Opens in any browser.' },
  {
    value: 'json',
    label: 'JSON',
    note: 'Everything, for scripts and other apps: edits, deletes, reactions.',
  },
  {
    value: 'txt',
    label: 'Text',
    note: 'The same plain format as WhatsApp’s own export, so tools that read those read this too.',
  },
];

// <input type="date"> speaks local YYYY-MM-DD
function dayStart(v: string): number {
  return v ? new Date(`${v}T00:00:00`).getTime() : 0;
}
function dayEnd(v: string): number {
  return v ? new Date(`${v}T23:59:59.999`).getTime() : 0;
}

export function ExportDialog({
  jid,
  name,
  onClose,
}: {
  jid: JID;
  name: string;
  onClose: () => void;
}) {
  const [media, setMedia] = useState<Set<ExportMedia>>(
    new Set(['photo', 'video', 'voice', 'round', 'sticker', 'gif', 'file']),
  );
  const [limit, setLimit] = useState('16');
  const [format, setFormat] = useState<ExportFormat>('html');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const progress = useExports((s) => s.byChat[jid]);
  const badRange = !!from && !!to && from > to;

  const toggle = (m: ExportMedia, on: boolean) =>
    setMedia((cur) => {
      const next = new Set(cur);
      if (on) next.add(m);
      else next.delete(m);
      return next;
    });

  const run = async () => {
    const opts: ExportOptions = {
      jid,
      media: [...media],
      maxBytes: Number(limit) * 1024 * 1024,
      format,
      from: dayStart(from),
      to: dayEnd(to),
    };
    setRunning(true);
    try {
      const folder = await backend.export.run(opts);
      if (folder) {
        setResult(folder);
        useToasts.getState().push({ kind: 'info', text: 'Export finished' });
      }
    } catch (err) {
      toastError(err);
    } finally {
      setRunning(false);
    }
  };

  const phase = running ? progress?.phase : undefined;
  const status =
    phase === 'media'
      ? `Copying media ${progress!.done} of ${progress!.total}…`
      : phase === 'writing'
        ? 'Writing the file…'
        : phase === 'collecting'
          ? 'Reading messages…'
          : running
            ? 'Choose a folder…'
            : null;

  return (
    <Dialog
      open
      title={`Export “${name}”`}
      onClose={() => {
        if (running) void backend.export.cancel();
        onClose();
      }}
      width={460}
      footer={
        result ? (
          <>
            <Button
              icon={<FolderOpen size={16} />}
              onClick={() => void backend.export.open(result).catch(toastError)}
            >
              Open folder
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : running ? (
          <Button onClick={() => void backend.export.cancel()}>Cancel export</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void run()} disabled={badRange}>
              Export…
            </Button>
          </>
        )
      }
    >
      {result ? (
        <p className="wz-dialog-text">
          Saved to <span className="wz-export__path wz-selectable">{result}</span>
        </p>
      ) : (
        <fieldset className="wz-export" disabled={running}>
          <div className="wz-export__group">
            <span className="wz-export__label">Include</span>
            <p className="wz-export__hint">
              All text messages are always included, kept deleted messages and edit history too.
            </p>
            <div className="wz-export__checks">
              {MEDIA.map((m) => (
                <label key={m.value} className="wz-export__check">
                  <input
                    type="checkbox"
                    checked={media.has(m.value)}
                    onChange={(e) => toggle(m.value, e.target.checked)}
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </div>

          <div className="wz-export__group">
            <label className="wz-export__label" htmlFor="wz-export-limit">
              Size limit per file
            </label>
            <select
              id="wz-export-limit"
              className="wz-export__select"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            >
              {LIMITS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <div className="wz-export__group">
            <span className="wz-export__label">Dates</span>
            <div className="wz-export__dates">
              <label>
                From
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>
            <p className="wz-export__hint">
              {badRange ? '“From” is after “To”.' : 'Leave empty for the whole chat.'}
            </p>
          </div>

          <div className="wz-export__group">
            <span className="wz-export__label">Format</span>
            <Segmented
              label="Format"
              value={format}
              options={FORMATS}
              onChange={setFormat}
              size="sm"
            />
            <p className="wz-export__hint">{FORMATS.find((f) => f.value === format)?.note}</p>
          </div>
          <p className="wz-export__hint">
            Media that isn’t on this computer yet is downloaded first, so a big chat can take a
            while.
          </p>
        </fieldset>
      )}
      {status && (
        <p className="wz-export__status" role="status">
          <Spinner size={14} /> {status}
        </p>
      )}
    </Dialog>
  );
}
