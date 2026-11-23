import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FolderOpen,
  MessageSquareText,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { backend, type Message } from '../../api';
import { formatDateTime } from '../../lib/format';
import { useConnection } from '../../stores/connection';
import { useMessages } from '../../stores/messages';
import { toastError, useToasts } from '../../stores/toasts';
import { useUI } from '../../stores/ui';
import { Avatar, Spinner, Tooltip, useLayer } from '../../ui';
import { VideoPlayer } from './VideoPlayer';
import './MediaViewer.css';

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const STEP = 1.25;
// room for the side arrows and some air around the picture
const PAD_X = 136;
const PAD_Y = 32;

interface View {
  scale: number;
  x: number;
  y: number;
}

const FIT: View = { scale: 1, x: 0, y: 0 };

// video notes play inline in their circle, they don't open here
const isViewable = (m: Message) =>
  (m.kind === 'image' || m.kind === 'video') && !!m.media && !m.media.round && !m.contentUnknown;

function fitBox(w: number, h: number, maxW: number, maxH: number) {
  if (!w || !h || maxW <= 0 || maxH <= 0) return null;
  // never upscale past the real size, small photos stay crisp
  const s = Math.min(maxW / w, maxH / h, 1);
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

function useStageSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

export function MediaViewer() {
  const viewer = useUI((s) => s.viewer);
  if (!viewer) return null;
  return <Viewer key={viewer.jid} jid={viewer.jid} pk={viewer.pk} />;
}

function Viewer({ jid, pk }: { jid: string; pk: string }) {
  const all = useMessages((s) => s.byChat[jid]?.items);
  const items = useMemo(() => (all ?? []).filter(isViewable), [all]);
  const index = items.findIndex((m) => m.pk === pk);
  const m = index >= 0 ? items[index] : undefined;
  const close = useCallback(() => useUI.getState().closeViewer(), []);
  const go = useCallback(
    (d: number) => {
      const next = items[index + d];
      if (next) useUI.getState().openViewer(jid, next.pk);
    },
    [items, index, jid],
  );

  useLayer(true, close);

  // the message vanished (purged, chat switched): nothing left to show
  useEffect(() => {
    if (all && !m) close();
  }, [all, m, close]);

  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    root.current?.focus({ preventScroll: true });
    return () => prev?.focus({ preventScroll: true });
  }, []);

  if (!m) return null;
  return (
    <div
      ref={root}
      className="wz-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={m.kind === 'video' ? 'Video' : 'Photo'}
      tabIndex={-1}
    >
      {/* keyed by pk so zoom and loading state start fresh for every item */}
      <Item
        key={m.pk}
        m={m}
        hasPrev={index > 0}
        hasNext={index < items.length - 1}
        position={`${index + 1} / ${items.length}`}
        onNav={go}
        onClose={close}
      />
    </div>
  );
}

async function run(action: () => Promise<unknown>, done?: string) {
  try {
    await action();
    if (done) useToasts.getState().push({ kind: 'info', text: done });
  } catch (err) {
    toastError(err);
  }
}

function Item({
  m,
  hasPrev,
  hasNext,
  position,
  onNav,
  onClose,
}: {
  m: Message;
  hasPrev: boolean;
  hasNext: boolean;
  position: string;
  onNav: (d: number) => void;
  onClose: () => void;
}) {
  const isVideo = m.kind === 'video';
  const myJid = useConnection((st) => st.auth.me?.jid);
  const myName = useConnection((st) => st.auth.me?.name);
  const url = backend.media.url(m.pk);
  const thumb = backend.media.url(m.pk, true);
  const { ref: stageRef, size } = useStageSize();
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [thumbOk, setThumbOk] = useState(true);
  const [view, setView] = useState<View>(FIT);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  const box = fitBox(
    natural?.w ?? m.media?.width ?? 0,
    natural?.h ?? m.media?.height ?? 0,
    size.w - PAD_X,
    size.h - PAD_Y,
  );

  const zoomTo = useCallback((scale: number, cx = 0, cy = 0) => {
    setView((v) => {
      const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
      if (s === MIN_ZOOM) return FIT;
      // keep the point under the cursor where it is
      const k = s / v.scale;
      return { scale: s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }, []);

  const copy = useCallback(
    () => run(() => backend.media.copy(m.pk), 'Copied to the clipboard'),
    [m.pk],
  );
  const save = useCallback(
    () =>
      run(async () => {
        const path = await backend.media.saveAs(m.pk);
        if (path) {
          const name = path.split(/[\\/]/).pop();
          useToasts.getState().push({ kind: 'info', text: `Saved as ${name}` });
        }
      }),
    [m.pk],
  );
  const reveal = useCallback(() => run(() => backend.media.reveal(m.pk)), [m.pk]);
  const jump = useCallback(() => {
    onClose();
    useUI.getState().jumpTo(m.chatJid, m.pk);
  }, [m.chatJid, m.pk, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inVideo = (e.target as HTMLElement | null)?.tagName === 'VIDEO';
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      } else if (ctrl && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
        e.preventDefault();
        void copy();
      } else if (!ctrl && !inVideo && e.key === 'ArrowLeft') {
        e.preventDefault();
        onNav(-1);
      } else if (!ctrl && !inVideo && e.key === 'ArrowRight') {
        e.preventDefault();
        onNav(1);
      } else if (!isVideo && (e.key === '+' || e.key === '=')) {
        zoomTo(view.scale * STEP);
      } else if (!isVideo && e.key === '-') {
        zoomTo(view.scale / STEP);
      } else if (!isVideo && e.key === '0') {
        setView(FIT);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copy, save, onNav, isVideo, zoomTo, view.scale]);

  const center = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { cx: e.clientX - (r.left + r.width / 2), cy: e.clientY - (r.top + r.height / 2) };
  };

  const onWheel = (e: ReactWheelEvent) => {
    if (isVideo) return;
    const { cx, cy } = center(e);
    zoomTo(view.scale * (e.deltaY < 0 ? STEP : 1 / STEP), cx, cy);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (isVideo || view.scale === 1 || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (drag.current?.id === e.pointerId) {
      // a drag shouldn't also count as a click on the backdrop
      if (drag.current.moved) e.stopPropagation();
      setTimeout(() => (drag.current = null));
    }
  };

  const zoomed = view.scale > 1;
  const showThumb = !loaded && thumbOk && !isVideo;

  return (
    <>
      <header className="wz-viewer__bar">
        <div className="wz-viewer__who">
          <Avatar
            name={m.fromMe ? myName || 'You' : m.senderName}
            jid={m.fromMe ? myJid : m.senderJid}
            size={36}
          />
          <div className="wz-viewer__who-text">
            <span className="wz-viewer__name">{m.fromMe ? 'You' : m.senderName}</span>
            <span className="wz-viewer__time">{formatDateTime(m.timestamp)}</span>
          </div>
        </div>
        <div className="wz-viewer__actions">
          {!isVideo && (
            <>
              <Action
                label="Zoom out"
                hint="−"
                onClick={() => zoomTo(view.scale / STEP)}
                disabled={!zoomed}
              >
                <ZoomOut size={18} />
              </Action>
              <button
                type="button"
                className="wz-viewer__zoom"
                onClick={() => setView(FIT)}
                title="Fit to window (0)"
              >
                {Math.round(view.scale * 100)}%
              </button>
              <Action
                label="Zoom in"
                hint="+"
                onClick={() => zoomTo(view.scale * STEP)}
                disabled={view.scale >= MAX_ZOOM}
              >
                <ZoomIn size={18} />
              </Action>
              <span className="wz-viewer__sep" aria-hidden="true" />
            </>
          )}
          <Action label={isVideo ? 'Copy video' : 'Copy'} hint="Ctrl+C" onClick={copy}>
            <Copy size={18} />
          </Action>
          <Action label="Save as…" hint="Ctrl+S" onClick={save}>
            <Download size={18} />
          </Action>
          <Action label="Show in folder" onClick={reveal}>
            <FolderOpen size={18} />
          </Action>
          <Action label="Go to message" onClick={jump}>
            <MessageSquareText size={18} />
          </Action>
          <span className="wz-viewer__sep" aria-hidden="true" />
          <Action label="Close" hint="Esc" onClick={onClose}>
            <X size={20} />
          </Action>
        </div>
      </header>

      <div
        ref={stageRef}
        className={`wz-viewer__stage${zoomed ? ' wz-viewer__stage--zoomed' : ''}`}
        onWheel={onWheel}
        onClick={(e) => {
          if (e.target === e.currentTarget && !drag.current?.moved) onClose();
        }}
      >
        {box && (
          <div
            className="wz-viewer__media"
            style={{
              width: box.width,
              height: box.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={(e) => {
              if (isVideo) return;
              const { cx, cy } = center(e);
              if (zoomed) setView(FIT);
              else zoomTo(2.5, cx, cy);
            }}
          >
            {showThumb && (
              <img
                className="wz-viewer__thumb"
                src={thumb}
                alt=""
                onError={() => setThumbOk(false)}
              />
            )}
            {isVideo ? (
              <VideoPlayer
                src={url}
                poster={thumbOk ? thumb : undefined}
                onSize={(w, h) => {
                  setNatural({ w, h });
                  setLoaded(true);
                }}
                onError={() => setFailed(true)}
              />
            ) : (
              !failed && (
                <img
                  className={`wz-viewer__el${loaded ? ' wz-viewer__el--in' : ''}`}
                  src={url}
                  alt={m.media?.caption || 'Photo'}
                  draggable={false}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
                    setLoaded(true);
                  }}
                  onError={() => setFailed(true)}
                />
              )
            )}
          </div>
        )}
        {/* the size isn't known until the file loads when WhatsApp didn't send it */}
        {!box && !isVideo && !failed && (
          <img
            className="wz-viewer__probe"
            src={url}
            alt=""
            onLoad={(e) =>
              setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            onError={() => setFailed(true)}
          />
        )}
        {!loaded && !failed && !isVideo && (
          <span className="wz-viewer__spinner" aria-label="Loading">
            <Spinner size={24} />
          </span>
        )}
        {failed && (
          <p className="wz-viewer__note">
            {thumbOk && !isVideo
              ? 'Only the preview is left: the full file is no longer on WhatsApp’s servers.'
              : 'This file couldn’t be loaded.'}
          </p>
        )}

        {hasPrev && (
          <button
            type="button"
            className="wz-viewer__nav wz-viewer__nav--prev"
            aria-label="Previous"
            onClick={() => onNav(-1)}
          >
            <ChevronLeft size={26} />
          </button>
        )}
        {hasNext && (
          <button
            type="button"
            className="wz-viewer__nav wz-viewer__nav--next"
            aria-label="Next"
            onClick={() => onNav(1)}
          >
            <ChevronRight size={26} />
          </button>
        )}
      </div>

      <footer className="wz-viewer__foot">
        {m.text && (
          <p className="wz-viewer__caption wz-selectable" dir="auto">
            {m.text}
          </p>
        )}
        <span className="wz-viewer__count">{position}</span>
      </footer>
    </>
  );
}

function Action({
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
