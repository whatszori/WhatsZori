import { useEffect, useRef, useState } from 'react';
import { RoundVideo } from './RoundVideo';
import { FileText, Image as ImageIcon, Pause, Play } from 'lucide-react';
import { backend, type JID, type MediaInfo, type MessageKind, type MessagePK } from '../../api';
import { formatDuration, formatFileSize } from '../../lib/format';
import { useUI } from '../../stores/ui';

const MAX_W = 300;
const MAX_H = 340;

function fit(w = 4, h = 3): { width: number; height: number } {
  const scale = Math.min(MAX_W / w, MAX_H / h, 1e9);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

const STICKER = 160;

function stickerBox(w = 1, h = 1): { width: number; height: number } {
  const s = Math.min(STICKER / w, STICKER / h);
  return { width: Math.round(w * s), height: Math.round(h * s) };
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

function Visual({
  chatJid,
  pk,
  kind,
  media,
}: {
  chatJid: JID;
  pk: MessagePK;
  kind: MessageKind;
  media: MediaInfo;
}) {
  const { width, height } =
    kind === 'sticker' ? stickerBox(media.width, media.height) : fit(media.width, media.height);
  const url = backend.media.url(pk);
  const thumb = backend.media.url(pk, true);
  const [failed, setFailed] = useState(false);
  const real = url !== '' && !failed;
  const style = {
    width,
    aspectRatio: `${width} / ${height}`,
    // the thumbnail from the message shows until the full picture is there
    backgroundImage: real && kind !== 'sticker' ? `url("${thumb}")` : undefined,
  };

  if (!real) {
    return (
      <div
        className={`wz-media wz-media--${kind}`}
        style={style}
        role="img"
        aria-label={kind === 'video' ? `Video, ${formatDuration(media.duration ?? 0)}` : 'Photo'}
      >
        <Placeholder kind={kind} />
        <span className="wz-media__label">
          {kind === 'video' && media.duration != null ? formatDuration(media.duration) : null}
          {kind === 'image' && media.size ? formatFileSize(media.size) : null}
        </span>
      </div>
    );
  }

  if (kind === 'sticker') {
    // animated Lottie stickers (application/was) can't play here; their PNG preview stands in
    const still = media.mime !== undefined && !media.mime.startsWith('image/');
    return (
      <div className="wz-media wz-media--sticker wz-media--loaded" style={style}>
        <img
          className="wz-media__el"
          src={still ? thumb : url}
          draggable={false}
          alt="Sticker"
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  if (kind === 'video' && media.gif) {
    // GIFs loop silently right in the chat, like everywhere else; a click opens them big
    return (
      <button
        type="button"
        className="wz-media wz-media--video wz-media--loaded wz-media--open wz-media--gif"
        style={style}
        onClick={() => useUI.getState().openViewer(chatJid, pk)}
        aria-label="Open GIF"
      >
        <video
          className="wz-media__el"
          src={url}
          poster={thumb}
          autoPlay
          loop
          muted
          playsInline
          onError={() => setFailed(true)}
        />
        <span className="wz-media__label wz-media__gif-badge">GIF</span>
      </button>
    );
  }

  // photos and videos open the viewer; a video in the bubble is just its poster
  return (
    <button
      type="button"
      className={`wz-media wz-media--${kind} wz-media--loaded wz-media--open`}
      style={style}
      onClick={() => useUI.getState().openViewer(chatJid, pk)}
      aria-label={
        kind === 'video' ? `Play video, ${formatDuration(media.duration ?? 0)}` : 'Open photo'
      }
    >
      {kind === 'video' ? (
        <>
          <span className="wz-media__play">
            <Play size={20} strokeWidth={1.75} />
          </span>
          {media.duration != null && (
            <span className="wz-media__label">{formatDuration(media.duration)}</span>
          )}
        </>
      ) : (
        <img
          className="wz-media__el"
          src={url}
          alt={media.caption || 'Photo'}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </button>
  );
}

// WhatsApp sends 64 amplitudes; that many bars don't fit a bubble, so keep the loudest per bucket
const VOICE_BARS = 40;

export function resampleWave(values: number[], n: number): number[] {
  if (values.length <= n) return values;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * values.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * values.length) / n));
    out.push(Math.max(...values.slice(from, to)));
  }
  return out;
}

function Voice({ pk, media }: { pk: MessagePK; media: MediaInfo }) {
  const url = backend.media.url(pk);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const bars = media.waveform?.length
    ? resampleWave(media.waveform, VOICE_BARS)
    : Array.from({ length: VOICE_BARS }, () => 0.4);

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
  chatJid,
  pk,
  kind,
  media,
}: {
  chatJid: JID;
  pk: MessagePK;
  kind: MessageKind;
  media: MediaInfo;
}) {
  if (kind === 'video' && media.round) return <RoundVideo pk={pk} media={media} />;
  if (kind === 'image' || kind === 'video' || kind === 'sticker')
    return <Visual chatJid={chatJid} pk={pk} kind={kind} media={media} />;
  if (kind === 'document') return <Document pk={pk} media={media} />;
  if (kind === 'voice') return <Voice pk={pk} media={media} />;
  return null;
}
