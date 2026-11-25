import { backend } from '../api';
import type { FetchInit, PluginResponse } from './types';

// ctx.net.fetch: the request goes to Go as JSON with a base64 body, Go checks the address against
// the sites the user allowed and makes it, and the answer comes back the same way. Shaped like
// the browser's fetch so plugin code reads the same.

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function bodyBytes(body: FetchInit['body']): Promise<{ bytes: Uint8Array; type?: string }> {
  if (body == null) return { bytes: new Uint8Array() };
  if (typeof body === 'string')
    return { bytes: new TextEncoder().encode(body), type: 'text/plain;charset=UTF-8' };
  if (body instanceof URLSearchParams)
    return {
      bytes: new TextEncoder().encode(body.toString()),
      type: 'application/x-www-form-urlencoded;charset=UTF-8',
    };
  if (body instanceof Blob)
    return { bytes: new Uint8Array(await body.arrayBuffer()), type: body.type || undefined };
  if (body instanceof ArrayBuffer) return { bytes: new Uint8Array(body) };
  if (body instanceof Uint8Array) return { bytes: body };
  throw new Error('body must be a string, Blob, ArrayBuffer, Uint8Array or URLSearchParams');
}

export async function pluginFetch(
  id: string,
  input: string | URL,
  init: FetchInit = {},
): Promise<PluginResponse> {
  const headers: Record<string, string> = {};
  new Headers(init.headers as HeadersInit | undefined).forEach((v, k) => (headers[k] = v));
  const { bytes, type } = await bodyBytes(init.body);
  if (type && !headers['content-type']) headers['content-type'] = type;
  const res = await backend.plugins.fetch(id, {
    url: String(input),
    method: (init.method ?? 'GET').toUpperCase(),
    headers,
    body: toBase64(bytes),
    timeoutMs: init.timeout ?? 0,
  });
  const data = fromBase64(res.body);
  const resHeaders = new Headers(res.headers ?? {});
  const text = () => new TextDecoder().decode(data);
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    statusText: res.statusText,
    url: res.url,
    headers: resHeaders,
    text: async () => text(),
    json: async <T>() => JSON.parse(text()) as T,
    arrayBuffer: async () => data.slice().buffer,
    blob: async () => new Blob([data], { type: resHeaders.get('content-type') ?? '' }),
  };
}

export { toBase64 };
