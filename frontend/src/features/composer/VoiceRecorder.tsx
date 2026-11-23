import { useEffect, useRef, useState } from 'react';
import { SendHorizontal, Trash2 } from 'lucide-react';
import { formatDuration } from '../../lib/format';
import { IconButton } from '../../ui';

const MAX_SECONDS = 15 * 60;
const SAMPLE_MS = 80;
const LIVE_BARS = 48;
const WAVE_BARS = 64;

export interface Recording {
  blob: Blob;
  // 0..100 per bar, WhatsApp's waveform format
  waveform: number[];
  seconds: number;
}

// Squeeze the level samples into WhatsApp's 64 bars, peak per bucket, scaled to the loudest.
export function toWaveform(levels: number[], bars = WAVE_BARS): number[] {
  if (levels.length === 0) return Array.from({ length: bars }, () => 0);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const from = Math.floor((i * levels.length) / bars);
    const to = Math.max(from + 1, Math.floor(((i + 1) * levels.length) / bars));
    out.push(Math.max(...levels.slice(from, Math.min(to, levels.length))));
  }
  const peak = Math.max(...out, 1e-6);
  return out.map((v) => Math.round((v / peak) * 100));
}

function pickMime(): string {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export const canRecord = (): boolean =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && pickMime() !== '';

// Records from the microphone while mounted. Cancel throws it away, send hands it over.
export function VoiceRecorder({
  onSend,
  onCancel,
  onError,
}: {
  onSend: (r: Recording) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [seconds, setSeconds] = useState(0);
  const [live, setLive] = useState<number[]>([]);
  const rec = useRef<MediaRecorder | null>(null);
  const levels = useRef<number[]>([]);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const sendOnStop = useRef(false);
  const handlers = useRef({ onSend, onCancel, onError });
  useEffect(() => {
    handlers.current = { onSend, onCancel, onError };
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer = 0;
    let cancelled = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        });
      } catch {
        handlers.current.onError('Microphone access was denied');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);

      const r = new MediaRecorder(stream, { mimeType: pickMime(), audioBitsPerSecond: 32000 });
      rec.current = r;
      r.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      r.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop());
        void ctx?.close();
        window.clearInterval(timer);
        if (!sendOnStop.current) return;
        const secs = (Date.now() - started.current) / 1000;
        handlers.current.onSend({
          blob: new Blob(chunks.current, { type: r.mimeType }),
          waveform: toWaveform(levels.current),
          seconds: secs,
        });
      };
      r.start(250);
      started.current = Date.now();
      timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        levels.current.push(rms);
        setLive((cur) => [...cur.slice(-(LIVE_BARS - 1)), rms]);
        const s = (Date.now() - started.current) / 1000;
        setSeconds(Math.floor(s));
        if (s >= MAX_SECONDS) {
          sendOnStop.current = true;
          r.stop();
        }
      }, SAMPLE_MS);
    })();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
      else stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
    };
  }, []);

  const stop = (send: boolean) => {
    sendOnStop.current = send;
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
    if (!send) handlers.current.onCancel();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stop(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        stop(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const peak = Math.max(...live, 0.02);
  return (
    <div className="wz-recorder" role="group" aria-label="Recording a voice message">
      <IconButton
        label="Cancel"
        hint="Esc"
        tooltipPlacement="top"
        icon={<Trash2 size={18} />}
        onClick={() => stop(false)}
      />
      <span className="wz-recorder__dot" aria-hidden="true" />
      <span className="wz-recorder__time" aria-live="off">
        {formatDuration(seconds)}
      </span>
      <span className="wz-recorder__bars" aria-hidden="true">
        {Array.from({ length: LIVE_BARS }, (_, i) => {
          const v = live[i - (LIVE_BARS - live.length)] ?? 0;
          return (
            <span
              key={i}
              className="wz-recorder__bar"
              style={{ height: `${Math.max(8, (v / peak) * 100)}%` }}
            />
          );
        })}
      </span>
      <IconButton
        label="Send voice message"
        hint="Enter"
        tooltipPlacement="top"
        className="wz-composer__send wz-composer__send--ready"
        icon={<SendHorizontal size={18} />}
        onClick={() => stop(true)}
      />
    </div>
  );
}
