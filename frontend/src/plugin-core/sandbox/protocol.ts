// Messages between the page and a sandboxed plugin's worker. Functions can't cross postMessage,
// so each side replaces them with numbered markers and the other side turns markers back into
// functions that send a message. Callbacks made while rendering belong to that render ("scope")
// and are dropped when the next render of the same surface replaces them.

// a function that lives in the worker
export interface WorkerFn {
  __wfn: number;
}
// a function that lives in the page
export interface HostFn {
  __hfn: number;
}

export type ToWorker =
  | {
      type: 'load';
      code: string;
      pluginId: string;
      permissions: string[];
      apiVersion: number;
      appVersion: string;
    }
  | { type: 'result'; id: number; ok: boolean; value?: unknown; error?: string }
  // run a worker function (an event handler, a command, a render)
  | { type: 'invoke'; id: number; fn: number; args: unknown[]; scope?: string }
  | { type: 'dispose'; scope: string };

export type FromWorker =
  | { type: 'started' }
  | { type: 'failed'; error: string }
  // call ctx.<path>(...args) in the page
  | { type: 'call'; id: number; path: string; args: unknown[] }
  // run a page function the worker got (a slot's close(), an unregister)
  | { type: 'callHost'; id: number; fn: number; args: unknown[] }
  | { type: 'invokeResult'; id: number; ok: boolean; value?: unknown; error?: string }
  // something changed; draw every surface again
  | { type: 'invalidate' }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; args: unknown[] };

export const isWorkerFn = (v: unknown): v is WorkerFn =>
  typeof v === 'object' && v !== null && typeof (v as WorkerFn).__wfn === 'number';

export const isHostFn = (v: unknown): v is HostFn =>
  typeof v === 'object' && v !== null && typeof (v as HostFn).__hfn === 'number';

// deep copy where functions become markers (and values postMessage can't take are dropped)
export function encode(
  v: unknown,
  fnToMarker: (f: (...a: unknown[]) => unknown) => object,
  depth = 0,
): unknown {
  if (depth > 40) return undefined;
  if (typeof v === 'function') return fnToMarker(v as (...a: unknown[]) => unknown);
  if (v === null || typeof v !== 'object') return typeof v === 'symbol' ? undefined : v;
  if (v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v) || v instanceof Date)
    return v;
  if (Array.isArray(v)) return v.map((x) => encode(x, fnToMarker, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = encode(x, fnToMarker, depth + 1);
  return out;
}

// deep copy where markers become functions
export function decode(
  v: unknown,
  markerToFn: (m: object) => ((...a: unknown[]) => unknown) | null,
  depth = 0,
): unknown {
  if (depth > 40 || v === null || typeof v !== 'object') return v;
  const f = markerToFn(v);
  if (f) return f;
  if (v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v) || v instanceof Date)
    return v;
  if (Array.isArray(v)) return v.map((x) => decode(x, markerToFn, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = decode(x, markerToFn, depth + 1);
  return out;
}

// The declarative UI a sandboxed plugin returns from render functions.
export type UINode =
  | string
  | null
  | undefined
  | false
  | { t: 'text'; text: string; muted?: boolean; bold?: boolean; size?: 'sm' | 'md' | 'lg' }
  | { t: 'heading'; text: string }
  | { t: 'stack'; gap?: number; children: UINode[] }
  | {
      t: 'row';
      gap?: number;
      wrap?: boolean;
      align?: 'start' | 'center' | 'end' | 'between';
      children: UINode[];
    }
  | {
      t: 'button';
      label: string;
      onClick?: () => void;
      variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
      disabled?: boolean;
      icon?: string;
    }
  | { t: 'iconButton'; label: string; icon: string; onClick?: () => void; active?: boolean }
  | { t: 'menuItem'; label: string; icon?: string; onClick?: () => void; danger?: boolean }
  | {
      t: 'input';
      value?: string;
      placeholder?: string;
      label?: string;
      onChange?: (v: string) => void;
      onSubmit?: (v: string) => void;
    }
  | {
      t: 'textarea';
      value?: string;
      placeholder?: string;
      rows?: number;
      onChange?: (v: string) => void;
    }
  | {
      t: 'toggle';
      label: string;
      description?: string;
      checked: boolean;
      onChange?: (v: boolean) => void;
    }
  | {
      t: 'select';
      value: string;
      options: { value: string; label: string }[];
      onChange?: (v: string) => void;
    }
  | { t: 'badge'; text: string }
  | { t: 'image'; src: string; alt?: string; width?: number; height?: number; radius?: number }
  | {
      t: 'list';
      items: {
        key: string;
        title: string;
        subtitle?: string;
        right?: string;
        onClick?: () => void;
      }[];
    }
  | { t: 'code'; text: string }
  | { t: 'link'; text: string; href: string }
  | { t: 'progress'; value: number }
  | { t: 'spinner' }
  | { t: 'divider' };
