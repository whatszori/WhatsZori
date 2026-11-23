import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { formatDuration } from '../../lib/format';
import { Spinner } from '../../ui';
import './VideoPlayer.css';

const SPEEDS = [1, 1.5, 2, 0.5];
const HIDE_AFTER = 2500;
const SEEK_STEP = 5;
// remembered for the session, like any player
let lastVolume = 1;
let lastMuted = false;

function clock(t: number): string {
  return formatDuration(Math.max(0, Math.floor(t)));
}

export function VideoPlayer({
  src,
  poster,
  onSize,
  onError,
}: {
  src: string;
  poster?: string;
  onSize?: (w: number, h: number) => void;
  onError?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [waiting, setWaiting] = useState(true);
  const [ended, setEnded] = useState(false);
  const [volume, setVolume] = useState(lastVolume);
  const [muted, setMuted] = useState(lastMuted);
  const [speed, setSpeed] = useState(1);
  const [full, setFull] = useState(false);
  const [idle, setIdle] = useState(false);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [scrub, setScrub] = useState(false);
  const idleTimer = useRef<number | undefined>(undefined);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused || v.ended) void v.play().catch(() => {});
    else v.pause();
  }, []);

  const seekBy = useCallback((d: number) => {
    const v = video.current;
    if (v && Number.isFinite(v.duration))
      v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + d));
  }, []);

  const toggleMute = useCallback(() => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.volume === 0) v.volume = 0.5;
  }, []);

  const toggleFull = useCallback(() => {
    // Wails turns element fullscreen into real window fullscreen
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen().catch(() => {});
  }, []);

  const cycleSpeed = () => {
    const v = video.current;
    if (!v) return;
    v.playbackRate = SPEEDS[(SPEEDS.indexOf(v.playbackRate) + 1) % SPEEDS.length] ?? 1;
  };

  // controls fade out while playing and the mouse rests, and come back on any movement
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), HIDE_AFTER);
  }, []);
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  useEffect(() => {
    const v = video.current;
    if (v) {
      v.volume = lastVolume;
      v.muted = lastMuted;
    }
    const onFull = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', onFull);
    return () => document.removeEventListener('fullscreenchange', onFull);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'k') toggle();
      else if (k === 'j') seekBy(-SEEK_STEP);
      else if (k === 'l') seekBy(SEEK_STEP);
      else if (k === 'm') toggleMute();
      else if (k === 'f') toggleFull();
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const v = video.current;
        if (!v) return;
        v.muted = false;
        v.volume = Math.min(1, Math.max(0, v.volume + (e.key === 'ArrowUp' ? 0.1 : -0.1)));
      } else return;
      e.preventDefault();
      e.stopPropagation();
      wake();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, seekBy, toggleMute, toggleFull, wake]);

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return { x: f * r.width, t: f * (duration || 0) };
  };

  const onTrackDown = (e: ReactPointerEvent) => {
    if (!duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrub(true);
    const { t } = timeAt(e.clientX);
    video.current!.currentTime = t;
    setTime(t);
  };
  const onTrackMove = (e: ReactPointerEvent) => {
    if (!duration) return;
    const h = timeAt(e.clientX);
    setHover(h);
    if (scrub) {
      video.current!.currentTime = h.t;
      setTime(h.t);
    }
  };

  const progress = duration ? time / duration : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const hideControls = playing && idle && !scrub;

  return (
    <div
      ref={root}
      className={`wz-player${hideControls ? ' wz-player--idle' : ''}${full ? ' wz-player--full' : ''}`}
      onPointerMove={wake}
      onPointerLeave={() => playing && setIdle(true)}
    >
      <video
        ref={video}
        className="wz-player__video"
        src={src}
        poster={poster}
        autoPlay
        playsInline
        preload="auto"
        onClick={toggle}
        onDoubleClick={toggleFull}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDuration(v.duration);
          onSize?.(v.videoWidth, v.videoHeight);
        }}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => !scrub && setTime(e.currentTarget.currentTime)}
        onProgress={(e) => {
          const v = e.currentTarget;
          if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
        }}
        onPlay={() => {
          setPlaying(true);
          setEnded(false);
          wake();
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setEnded(true);
          setIdle(false);
        }}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onPlaying={() => setWaiting(false)}
        onVolumeChange={(e) => {
          const v = e.currentTarget;
          setVolume(v.volume);
          setMuted(v.muted);
          lastVolume = v.volume;
          lastMuted = v.muted;
        }}
        onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
        onError={onError}
      />

      {waiting && !ended && (
        <span className="wz-player__spinner" aria-label="Loading">
          <Spinner size={26} />
        </span>
      )}
      {!playing && !waiting && (
        <button
          type="button"
          className="wz-player__big"
          aria-label={ended ? 'Replay' : 'Play'}
          onClick={toggle}
        >
          {ended ? <RotateCcw size={28} /> : <Play size={30} fill="currentColor" />}
        </button>
      )}

      <div className="wz-player__controls" onClick={(e) => e.stopPropagation()}>
        <div
          ref={track}
          className={`wz-player__track${scrub ? ' wz-player__track--active' : ''}`}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration || 0)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(time)} of ${clock(duration)}`}
          onPointerDown={onTrackDown}
          onPointerMove={onTrackMove}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setScrub(false);
          }}
          onPointerLeave={() => setHover(null)}
        >
          <div className="wz-player__rail">
            <div
              className="wz-player__buffered"
              style={{ width: `${duration ? Math.min(100, (buffered / duration) * 100) : 0}%` }}
            />
            <div className="wz-player__played" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="wz-player__knob" style={{ left: `${progress * 100}%` }} />
          {hover && (
            <span className="wz-player__hover" style={{ left: hover.x }}>
              {clock(hover.t)}
            </span>
          )}
        </div>

        <div className="wz-player__row">
          <button
            type="button"
            className="wz-player__btn"
            aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            onClick={toggle}
          >
            {playing ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" />
            )}
          </button>
          <div className="wz-player__volume">
            <button
              type="button"
              className="wz-player__btn"
              aria-label={muted ? 'Unmute (M)' : 'Mute (M)'}
              title={muted ? 'Unmute (M)' : 'Mute (M)'}
              onClick={toggleMute}
            >
              <VolumeIcon size={18} />
            </button>
            <input
              className="wz-player__slider"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              aria-label="Volume"
              style={{ ['--wz-fill' as string]: `${(muted ? 0 : volume) * 100}%` }}
              onChange={(e) => {
                const v = video.current!;
                v.volume = Number(e.target.value);
                v.muted = v.volume === 0;
              }}
            />
          </div>
          <span className="wz-player__time">
            {clock(time)} <span className="wz-player__time-total">/ {clock(duration)}</span>
          </span>
          <span className="wz-player__spacer" />
          <button
            type="button"
            className="wz-player__btn wz-player__speed"
            aria-label={`Playback speed ${speed}×`}
            title="Playback speed"
            onClick={cycleSpeed}
          >
            {speed}×
          </button>
          <button
            type="button"
            className="wz-player__btn"
            aria-label={full ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
            title={full ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
            onClick={toggleFull}
          >
            {full ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
