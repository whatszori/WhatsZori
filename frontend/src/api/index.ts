import type { Backend } from './backend';
import { MockBackend, type DevControls } from './mock/MockBackend';
import { chooseBackend, hasWailsRuntime } from './wails/detect';

// UI code only ever imports `backend`. Inside the desktop app it's the Wails backend (all Go),
// in a plain browser (npm run dev) or with ?backend=mock it's the pure mock.
const isTest = import.meta.env.MODE === 'test';
const mock = new MockBackend({ latency: isTest ? [0, 0] : [50, 300], persist: !isTest });

const search = typeof location !== 'undefined' ? location.search : '';
const choice = isTest
  ? 'mock'
  : chooseBackend(search, typeof window !== 'undefined' && hasWailsRuntime());

// loaded lazily so the browser build never evaluates @wailsio/runtime (it warns on load)
export const backend: Backend =
  choice === 'wails' ? new (await import('./wails/WailsBackend')).WailsBackend(mock) : mock;

// the fake scan and demo simulator only make sense when the mock is the backend
export const devControls: DevControls | null = backend.kind === 'mock' ? mock.dev : null;

export const isDemo =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

export type { Backend } from './backend';
export * from './types';
export * from './events';
