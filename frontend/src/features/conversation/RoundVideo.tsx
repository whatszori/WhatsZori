import { useEffect, useRef, useState } from 'react';
import { Pause, Play, VolumeX } from 'lucide-react';
import { backend, type MediaInfo, type MessagePK } from '../../api';
import { formatDuration } from '../../lib/format';
import './RoundVideo.css';

const SIZE = 240;
const RING = 3;

// only one video note talks at a time; starting another one sends the previous back to preview
let current: HTMLVideoElement | null = null;
const SILENCE = 'wz-silence';

type Mode = 'preview' | 'playing' | 'paused';

// A video note ("кружок"): loops silently while it's on screen, like on the phone. A click plays it
// from the start with sound and a progress ring, another click pauses.
export function RoundVideo({ pk, media }: { pk: MessagePK; media: MediaInfo }) {
  const url = backend.media.url(pk);
  const thumb = backend.media.url(pk, true);
  const box = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<Mode>('preview');
  const [progress, setProgress] = useState(0);
  const [left, setLeft] = useState(media.duration ?? 0);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const usable = url !== '' && !failed;

  // the silent preview only runs while the circle is on screen
  useEffect(() => {
    const el = box.current;
    if (!el || !url) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [url]);

  useEffect(() => {
    const v = video.current;
    if (!v || mode !== 'preview') return;
    v.muted = true;
    v.loop = true;
    if (visible) void v.play().catch(() => {});
    else v.pause();
  }, [visible, mode]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const silence = () => {
      v.muted = true;
      v.currentTime = 0;
      setMode('preview');
      setProgress(0);
      setLeft(media.duration ?? 0);
    };
    v.addEventListener(SILENCE, silence);
    return () => {
      v.removeEventListener(SILENCE, silence);
      if (current === v) current = null;
    };
  }, [media.duration]);

  const click = () => {
    const v = video.current;
    if (!v || !usable) return;
    if (mode === 'playing') {
      v.pause();
      setMode('paused');
      return;
    }
    if (current && current !== v) current.dispatchEvent(new Event(SILENCE));
    current = v;
    if (mode === 'preview') v.currentTime = 0;
    v.loop = false;
    v.muted = false;
    setMode('playing');
    void backend.messages.played(pk).catch(() => {});
    void v.play().catch(() => setMode('paused'));
  };

  const r = SIZE / 2 - RING / 2;
  const circ = 2 * Math.PI * r;

  return (
    <button
      ref={box}
      type="button"
      className={`wz-round wz-round--${mode}`}
      style={{ width: SIZE, height: SIZE, backgroundImage: url ? `url("${thumb}")` : undefined }}
      onClick={click}
      aria-label={
        mode === 'playing'
          ? 'Pause video message'
          : `Play video message, ${formatDuration(media.duration ?? 0)}`
      }
    >
      {usable && (
        <video
          ref={video}
          className="wz-round__video"
          src={url}
          muted
          playsInline
          preload="metadata"
          onTimeUpdate={(e) => {
            if (mode === 'preview') return;
            const v = e.currentTarget;
            if (v.duration > 0) {
              setProgress(v.currentTime / v.duration);
              setLeft(v.duration - v.currentTime);
            }
          }}
          onEnded={(e) => e.currentTarget.dispatchEvent(new Event(SILENCE))}
          onError={() => setFailed(true)}
        />
      )}
      {mode !== 'preview' && (
        <svg className="wz-round__ring" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <circle className="wz-round__ring-bg" cx={SIZE / 2} cy={SIZE / 2} r={r} />
          <circle
            className="wz-round__ring-fg"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={r}
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - progress)}
          />
        </svg>
      )}
      {(mode === 'paused' || !usable) && (
        <span className="wz-round__center" aria-hidden="true">
          <Play size={22} fill="currentColor" />
        </span>
      )}
      <span className="wz-round__badge">
        {mode === 'preview' && usable && <VolumeX size={12} />}
        {mode === 'playing' && <Pause size={11} fill="currentColor" />}
        {formatDuration(Math.max(0, Math.round(left)))}
      </span>
    </button>
  );
}
