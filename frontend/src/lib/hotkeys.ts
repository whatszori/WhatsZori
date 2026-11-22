import { useEffect, useRef } from 'react';

export interface Hotkey {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export function parseHotkey(combo: string): Hotkey {
  const parts = combo.split('+').map((p) => p.trim().toLowerCase());
  const key = parts[parts.length - 1];
  return {
    key: key === 'comma' ? ',' : key,
    ctrl: parts.includes('ctrl') || parts.includes('mod'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
  };
}

export function matchesHotkey(e: KeyboardEvent, hk: Hotkey): boolean {
  // Cmd on macOS counts as Ctrl so the same bindings work in the WKWebView build
  const ctrl = e.ctrlKey || e.metaKey;
  return (
    e.key.toLowerCase() === hk.key &&
    ctrl === !!hk.ctrl &&
    e.altKey === !!hk.alt &&
    e.shiftKey === !!hk.shift
  );
}

export function useHotkeys(bindings: Record<string, (e: KeyboardEvent) => void>): void {
  const ref = useRef(bindings);
  useEffect(() => {
    ref.current = bindings;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      for (const [combo, fn] of Object.entries(ref.current)) {
        if (matchesHotkey(e, parseHotkey(combo))) {
          e.preventDefault();
          fn(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
