import { describe, expect, it } from 'vitest';
import type { PluginInfo } from '../api';
import { decode, encode, isHostFn, isWorkerFn } from './sandbox/protocol';
import { hostAllowed, imageAllowed } from './sandbox/render';
import { checkValue, parseValue } from './settings';
import { checkPluginShortcut, formatShortcut, matches, parseShortcut } from './shortcuts';

const key = (k: string, mods: Partial<KeyboardEvent> = {}, code = '') =>
  ({
    key: k,
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  }) as KeyboardEvent;

describe('shortcuts', () => {
  it('parses and matches', () => {
    const s = parseShortcut('Ctrl+Shift+K');
    expect(matches(s, key('K', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matches(s, key('k', { ctrlKey: true }))).toBe(false);
    // Shift+1 arrives as "!"
    expect(
      matches(parseShortcut('Ctrl+Shift+1'), key('!', { ctrlKey: true, shiftKey: true }, 'Digit1')),
    ).toBe(true);
    expect(formatShortcut(parseShortcut('alt+up'))).toBe('Alt ↑');
  });

  it("keeps plugins off plain keys and the app's own shortcuts", () => {
    expect(() => checkPluginShortcut(parseShortcut('K'))).toThrow(/Ctrl, Alt or Mod/);
    expect(() => checkPluginShortcut(parseShortcut('Ctrl+K'))).toThrow(/belongs to WhatsZori/);
    expect(() => checkPluginShortcut(parseShortcut('Ctrl+Alt+K'))).not.toThrow();
    expect(() => checkPluginShortcut(parseShortcut('F7'))).not.toThrow();
    expect(() => parseShortcut('Ctrl+')).toThrow();
  });
});

describe('manifest settings', () => {
  const n = { key: 'n', type: 'number', label: 'N', min: 1, max: 10, default: 3 };
  const t = { key: 't', type: 'toggle', label: 'T', default: true };
  const s = { key: 's', type: 'select', label: 'S', options: [{ value: 'a', label: 'A' }] };
  it('types stored strings and falls back to defaults', () => {
    expect(parseValue(n, undefined)).toBe(3);
    expect(parseValue(n, '7')).toBe(7);
    expect(parseValue(t, 'false')).toBe(false);
    expect(parseValue(t, undefined)).toBe(true);
  });
  it('refuses values the form would never produce', () => {
    expect(() => checkValue(n, 11)).toThrow(/at most 10/);
    expect(() => checkValue(t, 'yes')).toThrow(/toggle/);
    expect(() => checkValue(s, 'b')).toThrow(/one of a/);
    expect(checkValue(s, 'a')).toBe('a');
  });
});

describe('sandbox messages', () => {
  it('turns functions into markers and back', () => {
    const fns: ((...a: unknown[]) => unknown)[] = [];
    const wire = encode({ a: 1, on: () => 42, list: [() => 1], blob: new Blob(['x']) }, (f) => {
      fns.push(f);
      return { __wfn: fns.length - 1 };
    }) as Record<string, unknown>;
    expect(isWorkerFn(wire.on)).toBe(true);
    expect(wire.blob).toBeInstanceOf(Blob);
    const back = decode(wire, (m) => (isWorkerFn(m) ? () => fns[m.__wfn]() : null)) as {
      on: () => number;
    };
    expect(back.on()).toBe(42);
    expect(isHostFn({ __hfn: 1 })).toBe(true);
  });
});

describe('sandbox UI limits', () => {
  const p = {
    network: ['api.example.com', '*.cdn.org'],
    permissions: ['media'],
  } as unknown as PluginInfo;
  it('links only to listed sites, over https', () => {
    expect(hostAllowed('https://api.example.com/x', p.network)).toBe(true);
    expect(hostAllowed('https://a.cdn.org', p.network)).toBe(true);
    expect(hostAllowed('http://api.example.com', p.network)).toBe(false);
    expect(hostAllowed('https://evil.com', p.network)).toBe(false);
  });
  it('pictures only from the plugin itself or the app', () => {
    expect(imageAllowed('data:image/png;base64,AAAA', p)).toBe(true);
    expect(imageAllowed('/wz-media/12?thumb=1', p)).toBe(true);
    expect(imageAllowed('https://evil.com/pixel.png?leak=1', p)).toBe(false);
    expect(imageAllowed('/wz-media/12', { ...p, permissions: [] })).toBe(false);
    expect(imageAllowed('/wails/runtime', p)).toBe(false);
  });
});
