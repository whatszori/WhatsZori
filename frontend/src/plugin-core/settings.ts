import { backend, type PluginSettingField } from '../api';
import type { SettingValue } from './types';

// Plugin settings: stored as strings in Go, typed here by the manifest's settings form. The form
// in Settings → Plugins and the plugin's own ctx.settings go through this module, so a change on
// either side reaches the plugin's onChange.

type Listener = (key: string, value: SettingValue | undefined) => void;

const schemas = new Map<string, PluginSettingField[]>();
const listeners = new Map<string, Set<Listener>>();

export function setSchema(id: string, fields: PluginSettingField[]): void {
  schemas.set(id, fields);
}

export function fieldFor(id: string, key: string): PluginSettingField | undefined {
  return schemas.get(id)?.find((f) => f.key === key);
}

// a stored string as the type its field says
export function parseValue(
  field: PluginSettingField | undefined,
  raw: string | undefined,
): SettingValue | undefined {
  if (raw === undefined) return field?.default as SettingValue | undefined;
  switch (field?.type) {
    case 'toggle':
      return raw === 'true';
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : (field.default as number | undefined);
    }
    default:
      return raw;
  }
}

export function checkValue(field: PluginSettingField | undefined, value: SettingValue): string {
  if (!field) return String(value);
  switch (field.type) {
    case 'toggle':
      if (typeof value !== 'boolean')
        throw new Error(`${field.key} is a toggle: use true or false`);
      return String(value);
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${field.key} must be a number`);
      if (field.min !== undefined && n < field.min)
        throw new Error(`${field.key} is at least ${field.min}`);
      if (field.max !== undefined && n > field.max)
        throw new Error(`${field.key} is at most ${field.max}`);
      return String(n);
    }
    case 'select':
      if (!field.options?.some((o) => o.value === value))
        throw new Error(
          `${field.key} must be one of ${field.options?.map((o) => o.value).join(', ')}`,
        );
      return String(value);
    default:
      return String(value);
  }
}

export async function getSetting(id: string, key: string): Promise<SettingValue | undefined> {
  const all = await backend.plugins.settings(id);
  return parseValue(fieldFor(id, key), all[key]);
}

export async function setSetting(id: string, key: string, value: SettingValue): Promise<void> {
  const field = fieldFor(id, key);
  await backend.plugins.setSetting(id, key, checkValue(field, value));
  emit(id, key, parseValue(field, checkValue(field, value)));
}

export async function deleteSetting(id: string, key: string): Promise<void> {
  await backend.plugins.deleteSetting(id, key);
  emit(id, key, parseValue(fieldFor(id, key), undefined));
}

export function onSettingChange(id: string, fn: Listener): () => void {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

function emit(id: string, key: string, value: SettingValue | undefined) {
  listeners.get(id)?.forEach((fn) => {
    try {
      fn(key, value);
    } catch (err) {
      console.error(`[plugin ${id}] settings listener failed`, err);
    }
  });
}
