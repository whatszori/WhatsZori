// Coordinates out of whatever people paste: "52.52, 13.405", a Google Maps or OpenStreetMap
// link, a geo: URI. Returns null when there's nothing that looks like a place on Earth.

const NUM = String.raw`(-?\d{1,3}(?:[.,]\d+)?)`;

const PATTERNS: RegExp[] = [
  // openstreetmap.org/?mlat=..&mlon=..
  new RegExp(String.raw`mlat=(-?\d+(?:\.\d+)?)&(?:amp;)?mlon=(-?\d+(?:\.\d+)?)`),
  // google.com/maps/@lat,lon,15z and /place/.../@lat,lon
  new RegExp(String.raw`@(-?\d+\.\d+),(-?\d+\.\d+)`),
  // ?q=lat,lon / query= / ll= / destination=
  new RegExp(
    String.raw`[?&](?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)`,
    'i',
  ),
  // #map=zoom/lat/lon
  new RegExp(String.raw`#map=\d+/(-?\d+(?:\.\d+)?)/(-?\d+(?:\.\d+)?)`),
  // geo:lat,lon
  new RegExp(String.raw`geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)`, 'i'),
];

const num = (s: string) => Number(s.replace(',', '.'));
const valid = (lat: number, lon: number) =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

export function parseCoords(input: string): { lat: number; lon: number } | null {
  const s = input.trim();
  if (!s) return null;
  for (const re of PATTERNS) {
    const m = s.match(re);
    if (m && valid(num(m[1]), num(m[2]))) return { lat: num(m[1]), lon: num(m[2]) };
  }
  // a bare pair: "52.52, 13.405", "52,52 13,405", "52.52 13.405"
  const pair = s.match(new RegExp(String.raw`^${NUM}\s*[;,\s]\s*${NUM}$`));
  if (pair && valid(num(pair[1]), num(pair[2]))) return { lat: num(pair[1]), lon: num(pair[2]) };
  return null;
}
