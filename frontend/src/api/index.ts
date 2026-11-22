import type { Backend } from './backend';
import { MockBackend, type DevControls } from './mock/MockBackend';

// Swap point for the Wails bindings later; UI code only ever imports `backend`.
const isTest = import.meta.env.MODE === 'test';
const mock = new MockBackend({ latency: isTest ? [0, 0] : [50, 300], persist: !isTest });

export const backend: Backend = mock;
export const devControls: DevControls | null = mock.dev;

export const isDemo =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

export type { Backend } from './backend';
export * from './types';
