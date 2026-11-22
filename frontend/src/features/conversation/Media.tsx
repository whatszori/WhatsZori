import { useEffect, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Pause, Play } from 'lucide-react';
import { backend, type MediaInfo, type MessageKind, type MessagePK } from '../../api';
import { formatDuration, formatFileSize } from '../../lib/format';

const MAX_W = 300;
const MAX_H = 340;

function fit(w = 4, h = 3): { width: number; height: number } {
  const scale = Math.min(MAX_W / w, MAX_H / h, 1e9);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

function Placeholder({ kind }: { kind: MessageKind }) {
  return kind === 'video' ? (
    <span className="wz-media__play">
      <Play size={20} strokeWidth={1.75} />
    </span>
  ) : (
    <ImageIcon className="wz-media__icon" size={28} strokeWidth={1.5} />
  );
}

function Visual({ pk, kind, media }: { pk: MessagePK; kind: MessageKind; media: MediaInfo }) {
  const { width, height } = fit(media.width, media.height);
  const url = backend.media.url(pk);
  const [failed, setFailed] = useState(false);
  const real = url && !failed;
  return (
    <div
      className={`wz-media wz-media--${kind}${real ? ' wz-media--loaded' : ''}`}
      style={{
        width,
        aspectRatio: `${width} / ${height}`,
        // the thumbnail from the message shows until the full file is there
        backgroundImage:
          real && kind !== 'sticker' ? `url("${backend.media.url(pk, true)}")` : undefined,
      }}
      role={real ? undefined : 'img'}
      aria-label={
        real
          ? undefined
          : kind === 'video'
            ? `Video, ${formatDuration(media.duration ?? 0)}`
            : 'Photo'
      }
    >
      {real && kind === 'video' ? (
        <video
          className="wz-media__el"
          src={url}
          controls
          preload="none"
          poster={backend.media.url(pk, true)}
          onError={() => setFailed(true)}
        />
      ) : real ? (
        <img
          className="wz-media__el"
          src={url}
          alt={media.caption || (kind === 'sticker' ? 'Sticker' : 'Photo')}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <Placeholder kind={kind} />
      )}
      {!real && (
        <span className="wz-media__label">
          {kind === 'video' && media.duration != null ? formatDuration(media.duration) : null}
          {kind === 'image' && media.size ? formatFileSize(media.size) : null}
        </span>
      )}
    </div>
  );
}

function Voice({ pk, media }: { pk: MessagePK; media: MediaInfo }) {
  const url = backend.media.url(pk);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const bars = media.waveform?.length ? media.waveform : Array.from({ length: 32 }, () => 0.4);

  useEffect(() => {
    const el = audio.current;
    return () => el?.pause();
  }, []);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };

  return (
    <div className="wz-media wz-media--voice">
      <button
        type="button"
        className="wz-media__voice-play"
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        onClick={toggle}
        disabled={!url}
      >
        {playing ? <Pause size={16} strokeWidth={2} /> : <Play size={16} strokeWidth={2} />}
      </button>
      <span className="wz-media__wave" aria-hidden="true">
        {bars.map((v, i) => (
          <span
            key={i}
            className={`wz-media__bar${i / bars.length < progress ? ' wz-media__bar--played' : ''}`}
            style={{ height: `${Math.max(12, v * 100)}%` }}
          />
        ))}
      </span>
      <span className="wz-media__duration">{formatDuration(media.duration ?? 0)}</span>
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
          }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            if (el.duration > 0) setProgress(el.currentTime / el.duration);
          }}
        />
      )}
    </div>
  );
}

function Document({ pk, media }: { pk: MessagePK; media: MediaInfo }) {
  const url = backend.media.url(pk);
  const ext = media.fileName?.split('.').pop()?.toUpperCase();
  const body = (
    <>
      <span className="wz-media__doc-icon">
        <FileText size={20} strokeWidth={1.75} />
      </span>
      <span className="wz-media__doc-text">
        <span className="wz-media__doc-name">{media.fileName ?? 'Document'}</span>
        <span className="wz-media__doc-meta">
          {[media.size != null && formatFileSize(media.size), ext].filter(Boolean).join(' · ')}
        </span>
      </span>
    </>
  );
  return url ? (
    <a
      className="wz-media wz-media--document wz-media--link"
      href={url}
      download={media.fileName ?? true}
      title="Save file"
    >
      {body}
    </a>
  ) : (
    <div className="wz-media wz-media--document">{body}</div>
  );
}

export function MediaBlock({
  pk,
  kind,
  media,
}: {
  pk: MessagePK;
  kind: MessageKind;
  media: MediaInfo;
}) {
  if (kind === 'image' || kind === 'video' || kind === 'sticker')
    return <Visual pk={pk} kind={kind} media={media} />;
  if (kind === 'document') return <Document pk={pk} media={media} />;
  if (kind === 'voice') return <Voice pk={pk} media={media} />;
  return null;
}
