import './slots.css';
import { useSyncExternalStore } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import type { SlotComponent, SlotEntry, SlotName, SlotProps, Unregister } from './types';

type Registry = { [N in SlotName]?: SlotEntry<N>[] };

let registry: Registry = {};
const listeners = new Set<() => void>();
const EMPTY: SlotEntry[] = [];

function notify(): void {
  listeners.forEach((l) => l());
}

export function register<N extends SlotName>(
  name: N,
  pluginId: string,
  component: SlotComponent<N>,
): Unregister {
  const entry: SlotEntry<N> = { pluginId, component };
  // new arrays every time so useSyncExternalStore sees the change
  registry = { ...registry, [name]: [...(registry[name] ?? []), entry] };
  notify();
  return () => {
    const list = registry[name] as SlotEntry<N>[] | undefined;
    registry = { ...registry, [name]: list?.filter((e) => e !== entry) };
    notify();
  };
}

export function getEntries<N extends SlotName>(name: N): SlotEntry<N>[] {
  return (registry[name] as SlotEntry<N>[] | undefined) ?? (EMPTY as SlotEntry<N>[]);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSlotEntries<N extends SlotName>(name: N): SlotEntry<N>[] {
  return useSyncExternalStore(subscribe, () => getEntries(name));
}

type PluginSlotProps<N extends SlotName> = {
  name: N;
  className?: string;
} & (SlotProps[N] extends Record<string, never> ? { props?: undefined } : { props: SlotProps[N] });

export function PluginSlot<N extends SlotName>({ name, props, className }: PluginSlotProps<N>) {
  const entries = useSlotEntries(name);
  if (entries.length === 0) return null;
  const p = (props ?? {}) as SlotProps[N];
  return (
    <div className={['wz-plugin-slot', className].filter(Boolean).join(' ')} data-slot={name}>
      {entries.map((e, i) => {
        const C = e.component as SlotComponent<N>;
        return (
          <ErrorBoundary
            key={`${e.pluginId}:${i}`}
            label={`plugin "${e.pluginId}" in slot ${name}`}
          >
            <C {...p} />
          </ErrorBoundary>
        );
      })}
    </div>
  );
}

export function resetSlots(): void {
  registry = {};
  notify();
}
