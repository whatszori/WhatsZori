import { FileText, Image as ImageIcon, Play } from 'lucide-react';
import type { MediaInfo, MessageKind } from '../../api';
import { formatDuration, formatFileSize } from '../../lib/format';

const MAX_W = 300;
const MAX_H = 340;

function fit(w = 4, h = 3): { width: number; height: number } {
  const scale = Math.min(MAX_W / w, MAX_H / h, 1e9);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export function MediaBlock({ kind, media }: { kind: MessageKind; media: MediaInfo }) {
  if (kind === 'image' || kind === 'video' || kind === 'sticker') {
    const { width, height } = fit(media.width, media.height);
    return (
      <div
        className={`wz-media wz-media--${kind}`}
        style={{ width, aspectRatio: `${width} / ${height}` }}
        role="img"
        aria-label={kind === 'video' ? `Video, ${formatDuration(media.duration ?? 0)}` : 'Photo'}
      >
        {kind === 'video' ? (
          <span className="wz-media__play">
            <Play size={20} strokeWidth={1.75} />
          </span>
        ) : (
          <ImageIcon className="wz-media__icon" size={28} strokeWidth={1.5} />
        )}
        <span className="wz-media__label">
          {kind === 'video' && media.duration != null ? formatDuration(media.duration) : null}
          {kind === 'image' && media.size ? formatFileSize(media.size) : null}
        </span>
      </div>
    );
  }

  if (kind === 'document') {
    const ext = media.fileName?.split('.').pop()?.toUpperCase();
    return (
      <div className="wz-media wz-media--document">
        <span className="wz-media__doc-icon">
          <FileText size={20} strokeWidth={1.75} />
        </span>
        <span className="wz-media__doc-text">
          <span className="wz-media__doc-name">{media.fileName ?? 'Document'}</span>
          <span className="wz-media__doc-meta">
            {[media.size != null && formatFileSize(media.size), ext].filter(Boolean).join(' · ')}
          </span>
        </span>
      </div>
    );
  }

  if (kind === 'voice') {
    const bars = media.waveform ?? Array.from({ length: 32 }, () => 0.4);
    return (
      <div className="wz-media wz-media--voice">
        <button type="button" className="wz-media__voice-play" aria-label="Play voice message">
          <Play size={16} strokeWidth={2} />
        </button>
        <span className="wz-media__wave" aria-hidden="true">
          {bars.map((v, i) => (
            <span key={i} className="wz-media__bar" style={{ height: `${Math.max(12, v * 100)}%` }} />
          ))}
        </span>
        <span className="wz-media__duration">{formatDuration(media.duration ?? 0)}</span>
      </div>
    );
  }
  return null;
}
