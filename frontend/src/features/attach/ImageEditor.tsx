import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Brush,
  Check,
  Circle,
  Crop,
  Droplets,
  Minus,
  MoveUpRight,
  Redo2,
  RotateCw,
  Shapes,
  Square,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { Spinner, useLayer } from '../../ui';
import { PluginIcon } from '../../plugin-core/host';
import { editorTools, useRegistry } from '../../plugin-core/registry';
import {
  ASPECTS,
  COLORS,
  EMPTY,
  TEXT_LINE,
  aspectCrop,
  compose,
  constrain,
  contrastOn,
  drawOp,
  drawRotated,
  exportCanvas,
  isEmpty,
  normRect,
  resizeCrop,
  rotateCW,
  strokeWidth,
  textFont,
  textSize,
  type EditState,
  type Handle,
  type Op,
  type Rect,
  type ShapeKind,
  type Tool,
} from './editor-model';

// canvases above this get slow and some GPUs refuse them; bigger photos are scaled down
const MAX_SIDE = 8192;

interface Props {
  url: string;
  name: string;
  mime: string;
  onCancel: () => void;
  onDone: (blob: Blob, name: string) => Promise<void>;
}

type Level = 0 | 1 | 2;
type TextDraft = { x: number; y: number; value: string };

export function ImageEditor({ url, name, mime, onCancel, onDone }: Props) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let gone = false;
    let bmp: ImageBitmap | null = null;
    (async () => {
      const blob = await (await fetch(url)).blob();
      const probe = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const k = Math.min(1, MAX_SIDE / Math.max(probe.width, probe.height));
      if (k < 1) {
        const w = Math.round(probe.width * k);
        const h = Math.round(probe.height * k);
        probe.close();
        bmp = await createImageBitmap(blob, {
          imageOrientation: 'from-image',
          resizeWidth: w,
          resizeHeight: h,
          resizeQuality: 'high',
        });
      } else bmp = probe;
      if (gone) bmp.close();
      else setBitmap(bmp);
    })().catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
      bmp?.close();
    };
  }, [url]);

  useLayer(true, onCancel);

  return createPortal(
    <div className="wz-editor" role="dialog" aria-modal="true" aria-label="Edit photo">
      {bitmap ? (
        <Editor bitmap={bitmap} name={name} mime={mime} onCancel={onCancel} onDone={onDone} />
      ) : (
        <div className="wz-editor__loading">
          {failed ? (
            <>
              <p>This picture can’t be edited.</p>
              <button type="button" className="wz-editor__btn" onClick={onCancel}>
                Close
              </button>
            </>
          ) : (
            <Spinner />
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

function Editor({
  bitmap,
  name,
  mime,
  onCancel,
  onDone,
}: Omit<Props, 'url'> & { bitmap: ImageBitmap }) {
  const [doc, setDoc] = useState<EditState>(EMPTY);
  const [past, setPast] = useState<EditState[]>([]);
  const [future, setFuture] = useState<EditState[]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[2]);
  const [level, setLevel] = useState<Level>(1);
  const [shape, setShape] = useState<ShapeKind>('arrow');
  const [textBg, setTextBg] = useState(false);
  const [blurMode, setBlurMode] = useState<'blur' | 'pixelate'>('blur');
  const [strength, setStrength] = useState(5);
  const [aspect, setAspect] = useState<number | null | 'original'>(null);
  const [live, setLive] = useState<Op | null>(null);
  const [liveCrop, setLiveCrop] = useState<Rect | null>(null);
  const [text, setText] = useState<TextDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState({ w: 0, h: 0 });

  const tools = useRegistry(editorTools);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  // the rotated picture, and the picture with every finished drawing on it
  const base = useMemo(
    () => drawRotated(bitmap, bitmap.width, bitmap.height, doc.rot),
    [bitmap, doc.rot],
  );
  const W = base.width;
  const H = base.height;
  const committed = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    compose(c.getContext('2d')!, base, doc.ops);
    return c;
  }, [base, doc.ops, W, H]);

  const full: Rect = { x: 0, y: 0, w: W, h: H };
  const crop = liveCrop ?? doc.crop ?? full;
  // cropping shows the whole picture with the frame on it; everything else, just the crop
  const view = tool === 'crop' ? full : (doc.crop ?? full);
  const scale = stage.w && stage.h ? Math.min(stage.w / view.w, stage.h / view.h, 4) : 0;
  const aspectValue = aspect === 'original' ? W / H : aspect;

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setStage({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // what's on screen: the finished drawings and the one being drawn
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(committed, 0, 0);
    if (!live) return;
    if (live.t === 'blur') {
      // the real blur runs once on release; while dragging, just the area
      const r = live.rect;
      ctx.save();
      ctx.fillStyle = 'rgb(255 255 255 / 0.18)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([8 / scale, 6 / scale]);
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    } else drawOp(ctx, live, W, H);
  }, [committed, live, W, H, scale]);

  const push = useCallback(
    (next: EditState) => {
      setPast((p) => [...p.slice(-60), doc]);
      setFuture([]);
      setDoc(next);
    },
    [doc],
  );

  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture((f) => [doc, ...f]);
    setDoc(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }, [past, doc]);

  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((p) => [...p, doc]);
    setDoc(future[0]);
    setFuture((f) => f.slice(1));
  }, [future, doc]);

  const commitText = useCallback(() => {
    setText((t) => {
      if (t && t.value.trim()) {
        push({
          ...doc,
          ops: [
            ...doc.ops,
            {
              t: 'text',
              color,
              size: textSize(level, W, H),
              x: t.x,
              y: t.y,
              text: t.value.replace(/\s+$/, ''),
              bg: textBg,
            },
          ],
        });
      }
      return null;
    });
  }, [push, doc, color, level, W, H, textBg]);

  // Esc while typing drops the text, not the whole edit
  useLayer(!!text, () => setText(null));

  const done = useCallback(async () => {
    if (saving) return;
    if (isEmpty(doc, W, H)) {
      onCancel();
      return;
    }
    setSaving(true);
    try {
      const out = exportCanvas(base, doc);
      const png = mime === 'image/png';
      const blob = await new Promise<Blob>((resolve, reject) =>
        out.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("couldn't save the picture"))),
          png ? 'image/png' : 'image/jpeg',
          0.92,
        ),
      );
      const stem = name.replace(/\.[^.]+$/, '') || 'photo';
      await onDone(blob, `${stem}.${png ? 'png' : 'jpg'}`);
    } finally {
      setSaving(false);
    }
  }, [saving, doc, W, H, base, mime, name, onDone, onCancel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (text || (e.target as HTMLElement)?.closest?.('input, textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === 'Enter' && !mod) {
        e.preventDefault();
        void done();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [text, undo, redo, done]);

  // ---- drawing on the picture ----

  const toImage = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height];
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || tool === 'crop' || saving) return;
    if (tool === 'text') {
      e.preventDefault();
      if (text) {
        commitText();
        return;
      }
      const [x, y] = toImage(e);
      setText({ x, y: y - textSize(level, W, H) * 0.6, value: '' });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = toImage(e);
    drag.current = { id: e.pointerId, x, y };
    const width = strokeWidth(level, W, H);
    if (tool === 'pen') setLive({ t: 'pen', color, width, points: [x, y] });
    else if (tool === 'shape')
      setLive({ t: 'shape', shape, color, width, x1: x, y1: y, x2: x, y2: y });
    else if (tool === 'blur')
      setLive({ t: 'blur', mode: blurMode, strength, rect: { x, y, w: 0, h: 0 } });
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId || !live) return;
    const [x, y] = toImage(e);
    if (live.t === 'pen') {
      const p = live.points;
      // skip points closer than a screen pixel
      if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) * scale < 1.5) return;
      setLive({ ...live, points: [...p, x, y] });
    } else if (live.t === 'shape') {
      const next = { ...live, x2: x, y2: y };
      setLive(e.shiftKey ? constrain(next) : next);
    } else if (live.t === 'blur') {
      setLive({ ...live, rect: normRect(drag.current.x, drag.current.y, x, y) });
    }
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    const op = live;
    setLive(null);
    if (!op) return;
    const tiny = 3 / Math.max(scale, 0.0001);
    if (op.t === 'shape' && Math.hypot(op.x2 - op.x1, op.y2 - op.y1) < tiny) return;
    if (op.t === 'blur') {
      const r = clipRect(op.rect, W, H);
      if (r.w < tiny || r.h < tiny) return;
      push({ ...doc, ops: [...doc.ops, { ...op, rect: r }] });
      return;
    }
    push({ ...doc, ops: [...doc.ops, op] });
  };

  // ---- crop ----

  const startCrop = (e: ReactPointerEvent, handle: Handle) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = doc.crop ?? full;
    const sx = e.clientX;
    const sy = e.clientY;
    let last = start;
    const move = (ev: PointerEvent) => {
      last = resizeCrop(
        start,
        handle,
        (ev.clientX - sx) / scale,
        (ev.clientY - sy) / scale,
        aspectValue,
        W,
        H,
      );
      setLiveCrop(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setLiveCrop(null);
      if (last !== start) push({ ...doc, crop: last });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const pickAspect = (a: number | null | 'original') => {
    setAspect(a);
    if (a === null) return;
    const value = a === 'original' ? W / H : a;
    push({ ...doc, crop: aspectCrop(W, H, value) });
  };

  const rotate = () => {
    commitText();
    setLive(null);
    // the frame's ratio turns with the picture
    if (typeof aspect === 'number') {
      const flipped = ASPECTS.find(
        (a) => typeof a.value === 'number' && Math.abs(a.value - 1 / aspect) < 0.01,
      );
      setAspect(flipped ? flipped.value : null);
    }
    push(rotateCW(doc, H));
  };

  const switchTool = (t: Tool) => {
    commitText();
    setTool(t);
  };

  const cursor =
    tool === 'text' ? 'text' : tool === 'crop' ? 'default' : saving ? 'progress' : 'crosshair';

  const sw = view.w * scale;
  const sh = view.h * scale;

  return (
    <>
      <header className="wz-editor__bar">
        <button type="button" className="wz-editor__btn" onClick={onCancel} disabled={saving}>
          <X size={18} /> Cancel
        </button>
        <div className="wz-editor__history">
          <ToolButton label="Undo" hint="Ctrl+Z" onClick={undo} disabled={!past.length}>
            <Undo2 size={18} />
          </ToolButton>
          <ToolButton label="Redo" hint="Ctrl+Y" onClick={redo} disabled={!future.length}>
            <Redo2 size={18} />
          </ToolButton>
        </div>
        <button
          type="button"
          className="wz-editor__btn wz-editor__btn--primary"
          onClick={() => void done()}
          disabled={saving}
        >
          {saving ? <Spinner size={16} /> : <Check size={18} />} Done
        </button>
      </header>

      <div className="wz-editor__stage" ref={stageRef}>
        {scale > 0 && (
          <div
            className="wz-editor__view"
            style={{ width: sw, height: sh, cursor }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <canvas
              ref={canvasRef}
              className="wz-editor__canvas"
              style={{
                width: W * scale,
                height: H * scale,
                left: -view.x * scale,
                top: -view.y * scale,
              }}
            />
            {tool === 'crop' && <CropFrame rect={crop} scale={scale} onHandle={startCrop} />}
            {text && (
              <TextInput
                draft={text}
                left={(text.x - view.x) * scale}
                top={(text.y - view.y) * scale}
                size={textSize(level, W, H) * scale}
                color={color}
                bg={textBg}
                onChange={(value) => setText({ ...text, value })}
                onCommit={commitText}
              />
            )}
          </div>
        )}
      </div>

      <footer className="wz-editor__tools">
        <div className="wz-editor__options">
          {tool === 'crop' && (
            <>
              {ASPECTS.map((a) => (
                <Chip key={a.label} on={aspect === a.value} onClick={() => pickAspect(a.value)}>
                  {a.label}
                </Chip>
              ))}
              <span className="wz-editor__sep" />
              <Chip
                on={false}
                disabled={!doc.crop}
                onClick={() => {
                  setAspect(null);
                  push({ ...doc, crop: null });
                }}
              >
                Reset
              </Chip>
            </>
          )}
          {(tool === 'pen' || tool === 'shape' || tool === 'text') && (
            <>
              {tool === 'shape' && (
                <>
                  <ShapeButton kind="arrow" on={shape} set={setShape} label="Arrow">
                    <MoveUpRight size={17} />
                  </ShapeButton>
                  <ShapeButton kind="rect" on={shape} set={setShape} label="Rectangle">
                    <Square size={16} />
                  </ShapeButton>
                  <ShapeButton kind="ellipse" on={shape} set={setShape} label="Ellipse">
                    <Circle size={16} />
                  </ShapeButton>
                  <ShapeButton kind="line" on={shape} set={setShape} label="Line">
                    <Minus size={17} />
                  </ShapeButton>
                  <span className="wz-editor__sep" />
                </>
              )}
              <div className="wz-editor__colors" role="radiogroup" aria-label="Colour">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={color === c}
                    aria-label={c}
                    className="wz-editor__color"
                    style={{ ['--swatch' as string]: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
              <span className="wz-editor__sep" />
              <div className="wz-editor__sizes" role="radiogroup" aria-label="Size">
                {([0, 1, 2] as Level[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={level === l}
                    aria-label={['Small', 'Medium', 'Large'][l]}
                    className="wz-editor__size"
                    onClick={() => setLevel(l)}
                  >
                    <span style={{ width: 4 + l * 4, height: 4 + l * 4 }} />
                  </button>
                ))}
              </div>
              {tool === 'text' && (
                <>
                  <span className="wz-editor__sep" />
                  <Chip on={textBg} onClick={() => setTextBg(!textBg)}>
                    Background
                  </Chip>
                </>
              )}
            </>
          )}
          {tool === 'blur' && (
            <>
              <Chip on={blurMode === 'blur'} onClick={() => setBlurMode('blur')}>
                Blur
              </Chip>
              <Chip on={blurMode === 'pixelate'} onClick={() => setBlurMode('pixelate')}>
                Pixelate
              </Chip>
              <span className="wz-editor__sep" />
              <label className="wz-editor__slider">
                <span>Strength</span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={strength}
                  onChange={(e) => setStrength(Number(e.target.value))}
                />
              </label>
            </>
          )}
        </div>

        <div className="wz-editor__toolbar" role="toolbar" aria-label="Tools">
          <ToolButton label="Draw" on={tool === 'pen'} onClick={() => switchTool('pen')}>
            <Brush size={19} />
          </ToolButton>
          <ToolButton label="Shapes" on={tool === 'shape'} onClick={() => switchTool('shape')}>
            <Shapes size={19} />
          </ToolButton>
          <ToolButton label="Text" on={tool === 'text'} onClick={() => switchTool('text')}>
            <Type size={19} />
          </ToolButton>
          <ToolButton label="Blur" on={tool === 'blur'} onClick={() => switchTool('blur')}>
            <Droplets size={19} />
          </ToolButton>
          <ToolButton label="Crop" on={tool === 'crop'} onClick={() => switchTool('crop')}>
            <Crop size={19} />
          </ToolButton>
          <span className="wz-editor__sep" />
          <ToolButton label="Rotate" onClick={rotate}>
            <RotateCw size={19} />
          </ToolButton>
          {tools.length > 0 && <span className="wz-editor__sep" />}
          {tools.map((t) => (
            <ToolButton
              key={t.key}
              label={t.value.label}
              onClick={() => {
                commitText();
                push({ ...doc, ops: [...doc.ops, { t: 'filter', tool: t.key }] });
              }}
            >
              <PluginIcon icon={t.value.icon} size={19} />
            </ToolButton>
          ))}
        </div>
      </footer>
    </>
  );
}

function clipRect(r: Rect, W: number, H: number): Rect {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  return { x, y, w: Math.min(W, r.x + r.w) - x, h: Math.min(H, r.y + r.h) - y };
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function CropFrame({
  rect,
  scale,
  onHandle,
}: {
  rect: Rect;
  scale: number;
  onHandle: (e: ReactPointerEvent, h: Handle) => void;
}) {
  return (
    <div
      className="wz-editor__crop"
      style={{
        left: rect.x * scale,
        top: rect.y * scale,
        width: rect.w * scale,
        height: rect.h * scale,
      }}
      onPointerDown={(e) => onHandle(e, 'move')}
    >
      <span className="wz-editor__thirds" />
      {HANDLES.map((h) => (
        <span
          key={h}
          className={`wz-editor__handle wz-editor__handle--${h}`}
          onPointerDown={(e) => onHandle(e, h)}
        />
      ))}
    </div>
  );
}

function TextInput({
  draft,
  left,
  top,
  size,
  color,
  bg,
  onChange,
  onCommit,
}: {
  draft: TextDraft;
  left: number;
  top: number;
  size: number;
  color: string;
  bg: boolean;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // after the pointerdown that opened it, or the textarea loses focus straight away
    const t = window.setTimeout(() => ref.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);
  const pad = size * 0.3;
  return (
    <textarea
      ref={ref}
      className="wz-editor__text"
      value={draft.value}
      rows={Math.max(1, draft.value.split('\n').length)}
      placeholder="Text"
      aria-label="Text on the picture"
      spellCheck={false}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onCommit();
        }
      }}
      style={{
        left: left - pad,
        top: top - pad,
        padding: pad,
        fontSize: size,
        lineHeight: TEXT_LINE,
        font: textFont(size),
        color: bg ? contrastOn(color) : color,
        background: bg ? color : 'transparent',
        borderRadius: size * 0.35,
        textShadow: bg ? 'none' : `0 0 ${size * 0.15}px rgb(0 0 0 / 0.45)`,
      }}
    />
  );
}

function ToolButton({
  label,
  hint,
  on,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  on?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="wz-editor__tool"
      aria-label={label}
      aria-pressed={on}
      title={hint ? `${label} (${hint})` : label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ShapeButton({
  kind,
  on,
  set,
  label,
  children,
}: {
  kind: ShapeKind;
  on: ShapeKind;
  set: (k: ShapeKind) => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <ToolButton label={label} on={on === kind} onClick={() => set(kind)}>
      {children}
    </ToolButton>
  );
}

function Chip({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="wz-editor__chip"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
