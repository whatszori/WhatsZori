import { describe, expect, it } from 'vitest';
import { parseCoords } from './geo';

describe('parseCoords', () => {
  it.each([
    ['52.52, 13.405', 52.52, 13.405],
    ['52.52 13.405', 52.52, 13.405],
    ['-33.8568, 151.2153', -33.8568, 151.2153],
    ['https://www.google.com/maps/@48.8584,2.2945,17z', 48.8584, 2.2945],
    ['https://maps.google.com/?q=40.6892,-74.0445', 40.6892, -74.0445],
    [
      'https://www.openstreetmap.org/?mlat=59.9386&mlon=30.3141#map=16/59.9386/30.3141',
      59.9386,
      30.3141,
    ],
    ['https://www.openstreetmap.org/#map=15/55.7558/37.6173', 55.7558, 37.6173],
    ['geo:35.6586,139.7454', 35.6586, 139.7454],
  ])('reads %s', (input, lat, lon) => {
    expect(parseCoords(input)).toEqual({ lat, lon });
  });

  it.each(['', 'hello', '120, 10', '10, 200', 'Berlin'])('refuses %s', (input) => {
    expect(parseCoords(input)).toBeNull();
  });
});
