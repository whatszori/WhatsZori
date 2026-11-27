import { useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, Navigation } from 'lucide-react';
import type { Message } from '../../api';
import { formatTime } from '../../lib/format';
import { useToasts } from '../../stores/toasts';
import './Location.css';

// A pin or a live location. The map is the picture the sender's phone attached; without one we
// draw a quiet map-like background ourselves. Nothing is fetched from a map service: the place
// would leak to it. "Open in maps" goes to the browser only when clicked.

// a live location that hasn't moved for this long is probably over (WhatsApp doesn't say)
const LIVE_STALE_MS = 60 * 60_000;

function useNow(every: number, on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(t);
  }, [every, on]);
  return now;
}

function ago(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

const coord = (n: number) => n.toFixed(5);

// a stable pseudo-random from the coordinates, so the drawn map is the same every time
function seeded(lat: number, lon: number) {
  let s = Math.floor((lat * 1e4 + 1e6) * 31 + (lon * 1e4 + 2e6)) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function DrawnMap({ lat, lon }: { lat: number; lon: number }) {
  const paths = useMemo(() => {
    const r = seeded(lat, lon);
    const roads: string[] = [];
    for (let i = 0; i < 5; i++) {
      const y = 10 + r() * 130;
      roads.push(
        `M -10 ${y} C 80 ${y + (r() - 0.5) * 60}, 200 ${y + (r() - 0.5) * 60}, 300 ${y + (r() - 0.5) * 40}`,
      );
    }
    for (let i = 0; i < 4; i++) {
      const x = 20 + r() * 250;
      roads.push(
        `M ${x} -10 C ${x + (r() - 0.5) * 50} 60, ${x + (r() - 0.5) * 50} 100, ${x + (r() - 0.5) * 40} 170`,
      );
    }
    const blocks = Array.from({ length: 6 }, () => ({
      x: r() * 260,
      y: r() * 140,
      w: 20 + r() * 40,
      h: 14 + r() * 26,
    }));
    const water =
      r() > 0.45
        ? { cx: r() > 0.5 ? 0 : 290, cy: r() * 160, rx: 50 + r() * 50, ry: 30 + r() * 40 }
        : null;
    return { roads, blocks, water };
  }, [lat, lon]);
  return (
    <svg
      className="wz-loc__drawn"
      viewBox="0 0 280 150"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <rect width="280" height="150" className="wz-loc__land" />
      {paths.water && <ellipse {...paths.water} className="wz-loc__water" />}
      {paths.blocks.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx="3" className="wz-loc__block" />
      ))}
      {paths.roads.map((d, i) => (
        <path
          key={i}
          d={d}
          className={i % 3 === 0 ? 'wz-loc__road wz-loc__road--main' : 'wz-loc__road'}
        />
      ))}
    </svg>
  );
}

function Pin({ live, active }: { live: boolean; active: boolean }) {
  return (
    <span
      className={`wz-loc__pin${live ? ' wz-loc__pin--live' : ''}${active ? ' wz-loc__pin--active' : ''}`}
      aria-hidden="true"
    >
      {live && active && <span className="wz-loc__pulse" />}
      <svg viewBox="0 0 32 40" width="32" height="40">
        <path
          d="M16 39s13-12.4 13-23A13 13 0 0 0 3 16c0 10.6 13 23 13 23z"
          className="wz-loc__pin-body"
        />
        <circle cx="16" cy="16" r="5.5" fill="#fff" />
      </svg>
    </span>
  );
}

export function LocationCard({ m }: { m: Message }) {
  const loc = m.location!;
  const live = loc.live;
  const updated = loc.updatedAt || m.timestamp;
  const now = useNow(30_000, live);
  const active = live && now - updated < LIVE_STALE_MS;
  const [thumbBroken, setThumbBroken] = useState(false);

  const title = loc.name || (live ? 'Live location' : 'Location');
  const subtitle = loc.address || `${coord(loc.lat)}, ${coord(loc.lon)}`;
  const osm = `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lon}#map=16/${loc.lat}/${loc.lon}`;
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lon}`;
  const speedKmh = loc.speed ? Math.round(loc.speed * 3.6) : 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${coord(loc.lat)}, ${coord(loc.lon)}`);
      useToasts.getState().push({ kind: 'info', text: 'Coordinates copied' });
    } catch {
      // nothing to do; the coordinates are on screen
    }
  };

  return (
    <div
      className={`wz-loc${live ? ' wz-loc--live' : ''}${live && !active ? ' wz-loc--ended' : ''}`}
    >
      <a
        className="wz-loc__map"
        href={osm}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={`${title}, open the map`}
      >
        {loc.thumb && !thumbBroken ? (
          <img src={loc.thumb} alt="" draggable={false} onError={() => setThumbBroken(true)} />
        ) : (
          <DrawnMap lat={loc.lat} lon={loc.lon} />
        )}
        {!(loc.thumb && !thumbBroken) && <Pin live={live} active={active} />}
        {live && (
          <span className={`wz-loc__badge${active ? '' : ' wz-loc__badge--ended'}`}>
            {active && <span className="wz-loc__dot" aria-hidden="true" />}
            {active ? 'Live' : 'Ended'}
          </span>
        )}
        {(loc.heading ?? 0) > 0 && active && (
          <span
            className="wz-loc__heading"
            style={{ transform: `rotate(${loc.heading}deg)` }}
            aria-hidden="true"
          >
            <Navigation size={14} />
          </span>
        )}
      </a>
      <div className="wz-loc__body">
        <div className="wz-loc__text">
          {loc.url && !live ? (
            <a className="wz-loc__title" href={loc.url} target="_blank" rel="noreferrer noopener">
              {title}
            </a>
          ) : (
            <span className="wz-loc__title">{title}</span>
          )}
          <span className="wz-loc__sub">
            {live
              ? active
                ? `Updated ${ago(now - updated)}${speedKmh > 1 ? ` · ${speedKmh} km/h` : ''}`
                : `Last seen here at ${formatTime(updated)}`
              : subtitle}
          </span>
          {(loc.accuracy ?? 0) > 0 && <span className="wz-loc__acc">Within {loc.accuracy} m</span>}
        </div>
        <div className="wz-loc__actions">
          <a href={osm} target="_blank" rel="noreferrer noopener" className="wz-loc__action">
            <ExternalLink size={13} /> OpenStreetMap
          </a>
          <a href={gmaps} target="_blank" rel="noreferrer noopener" className="wz-loc__action">
            <ExternalLink size={13} /> Google Maps
          </a>
          <button type="button" className="wz-loc__action" onClick={() => void copy()}>
            <Copy size={13} /> Copy
          </button>
        </div>
      </div>
    </div>
  );
}
