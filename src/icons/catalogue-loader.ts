import {
  fnv1a32,
  validateIconArtifact,
  validateIconCatalogue,
  validateIconShard,
  MAX_ICON_INDEX_BYTES,
  type IconArtifactProfile
} from './icon-artifact';

export interface IconRecord {
  name: string;
  width: number;
  height: number;
  unicode: string;
  ligatures: Array<string | number>;
  paths: string[];
}

export interface IconCatalogueRecord {
  name: string;
  label: string;
  family: string;
  style: string;
  terms: string[];
  aliases: string[];
  officialAliases: string[];
}

export interface IconCatalogue {
  schemaVersion: number;
  profile: IconArtifactProfile;
  records: IconCatalogueRecord[];
}

interface IconStyle { style: string; sharding: { bucketCount: number }; shards: string[] }
interface IconFamily { family: string; defaultStyle: string; styles: IconStyle[] }
export interface IconIndex {
  profile: IconArtifactProfile;
  default: { family: string; style: string };
  aliases: Record<string, string>;
  families: IconFamily[];
  cataloguePath: string;
}

export interface IconSelection {
  family: string;
  style: string;
}

const indexUrl = new URL('../nodel-icons.json', import.meta.url);
const cache = new Map<string, Promise<unknown>>();
const malformed = new Set<string>();
const MAX_RETRIES = 1;
const MAX_CATALOGUE_BYTES = 16 * 1024 * 1024;
const MAX_SHARD_BYTES = 128 * 1024;

function transient(error: unknown) {
  return error instanceof IconNetworkError;
}

class IconNetworkError extends Error {}

function declaredUrl(path: string, index: URL) {
  if (!/^v2\/[a-z0-9][a-z0-9/-]*\.json$/.test(path) || path.includes('..')) {
    throw new Error('Icon catalogue path is not a declared safe relative path');
  }
  // Artifact paths are rooted at the deployment root, while the stable index
  // itself lives in the deployment's v2 directory.
  const url = new URL(`../${path}`, index);
  if (url.origin !== index.origin || url.protocol !== index.protocol) {
    throw new Error('Icon catalogue path is not same-origin');
  }
  return url;
}

function contentDigestFromUrl(url: URL) {
  const match = url.pathname.match(/\/(?:catalogue-([0-9a-f]{16})|[a-z0-9-]+-\d+-([0-9a-f]{12}))\.json$/);
  return match?.[1] ?? match?.[2] ?? null;
}

async function verifyRawContentDigest(url: URL, body: ArrayBuffer) {
  const expected = contentDigestFromUrl(url);
  if (!expected) return;
  const actual = await sha256Hex(new Uint8Array(body));
  if (!actual.startsWith(expected)) throw new Error('Icon artifact content hash does not match its declared path');
}

export async function sha256Hex(bytes: Uint8Array) {
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource));
    return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  const words = new Uint32Array(64);
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const padded = new Uint8Array((((bytes.length + 9 + 63) >> 6) << 6));
  padded.set(bytes); padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLength >>> 0);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  const constants = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) { const x = words[i - 15]!, y = words[i - 2]!; words[i] = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + words[i - 16]! + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + words[i - 7]! >>> 0; }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) { const s1 = ((e! >>> 6) | (e! << 26)) ^ ((e! >>> 11) | (e! << 21)) ^ ((e! >>> 25) | (e! << 7)); const ch = (e! & f!) ^ (~e! & g!); const t1 = (h! + s1 + ch + constants[i]! + words[i]!) >>> 0; const s0 = ((a! >>> 2) | (a! << 30)) ^ ((a! >>> 13) | (a! << 19)) ^ ((a! >>> 22) | (a! << 10)); const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!); const t2 = (s0 + maj) >>> 0; [h, g, f, e, d, c, b, a] = [g, f, e, (d! + t1) >>> 0, c, b, a, (t1 + t2) >>> 0]; }
    state[0] = (state[0]! + a!) >>> 0; state[1] = (state[1]! + b!) >>> 0; state[2] = (state[2]! + c!) >>> 0; state[3] = (state[3]! + d!) >>> 0; state[4] = (state[4]! + e!) >>> 0; state[5] = (state[5]! + f!) >>> 0; state[6] = (state[6]! + g!) >>> 0; state[7] = (state[7]! + h!) >>> 0;
  }
  return Array.from(state, word => word.toString(16).padStart(8, '0')).join('');
}

async function fetchJson(url: URL, maxBytes: number) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      let response: Response;
      try {
        response = await fetch(url.href, { credentials: 'same-origin' });
      } catch (error) {
        throw new IconNetworkError(error instanceof Error ? error.message : String(error));
      }
      if (!response.ok) {
        if (response.status >= 500 || response.status === 408 || response.status === 429) throw new IconNetworkError(`Icon catalogue request failed: ${response.status}`);
        throw new Error(`Icon catalogue request failed: ${response.status}`);
      }
      const contentLength = response.headers.get('content-length');
      if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
        throw new Error('Icon catalogue response exceeds its byte limit');
      }
      let body: ArrayBuffer;
      try {
        if (!response.body) {
          body = await response.arrayBuffer();
        } else {
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = []; let total = 0;
          try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maxBytes) { await reader.cancel(); throw new Error('Icon catalogue response exceeds its byte limit'); } chunks.push(value); } } finally { reader.releaseLock(); }
          const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } body = bytes.buffer;
        }
      } catch (error) {
        throw new IconNetworkError(error instanceof Error ? error.message : String(error));
      }
      if (body.byteLength > maxBytes) throw new Error('Icon catalogue response exceeds its byte limit');
      await verifyRawContentDigest(url, body);
      return JSON.parse(new TextDecoder().decode(body)) as unknown;
    } catch (error) {
      lastError = error;
      if (!transient(error) || attempt === MAX_RETRIES) throw error;
    }
  }
  throw lastError;
}

function cached<T>(url: URL, maxBytes: number, validate: (value: unknown) => T) {
  const key = url.href;
  if (malformed.has(key)) return cache.get(key)! as Promise<T>;
  const existing = cache.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const request = fetchJson(url, maxBytes).then(value => validate(value));
  cache.set(key, request);
  request.catch(error => {
    if (transient(error)) cache.delete(key);
    else malformed.add(key);
  });
  return request;
}

function indexValue(value: unknown) {
  validateIconArtifact(value);
  return value as unknown as IconIndex;
}

export function loadIconIndex() {
  return cached(indexUrl, MAX_ICON_INDEX_BYTES, indexValue);
}

export function loadIconCatalogue() {
  return loadIconIndex().then(index => {
    const url = declaredUrl(index.cataloguePath, indexUrl);
      return cached<IconCatalogue>(url, MAX_CATALOGUE_BYTES, value => {
        validateIconCatalogue(value, index.profile, index as unknown as Record<string, unknown>);
        return value as unknown as IconCatalogue;
      });
  });
}

function findStyle(index: IconIndex, family: string, style: string) {
  const familyEntry = index.families.find(item => item.family === family);
  const styleEntry = familyEntry?.styles.find(item => item.style === style);
  return styleEntry;
}

function selectionFromIndex(index: IconIndex, family?: string, style?: string): IconSelection | null {
  const effectiveFamily = family ?? index.default.family;
  const familyEntry = index.families.find(item => item.family === effectiveFamily);
  const effectiveStyle = style ?? familyEntry?.defaultStyle;
  if (!effectiveStyle || !findStyle(index, effectiveFamily, effectiveStyle)) return null;
  return { family: effectiveFamily, style: effectiveStyle };
}

export async function resolveIconSelection(family?: string, style?: string): Promise<IconSelection | null> {
  return selectionFromIndex(await loadIconIndex(), family, style);
}

export async function loadIconRecord(name: string, family?: string, style?: string): Promise<IconRecord | null> {
  const index = await loadIconIndex();
  const selection = selectionFromIndex(index, family, style);
  if (!selection) return null;
  const canonical = index.aliases[name] ?? name;
  const styleEntry = findStyle(index, selection.family, selection.style);
  if (!styleEntry) return null;
  const bucket = fnv1a32(canonical) & (styleEntry.sharding.bucketCount - 1);
  const path = styleEntry.shards[bucket];
  if (!path) return null;
  const url = declaredUrl(path, indexUrl);
  const shard = await cached<Record<string, unknown>>(url, MAX_SHARD_BYTES, value => {
    validateIconShard(value, { profile: index.profile, family: selection.family, style: selection.style, bucket });
    return value;
  });
  return (shard.records as IconRecord[]).find(record => record.name === canonical) ?? null;
}

export function resetIconCatalogueCache() {
  cache.clear();
  malformed.clear();
}

export function iconCatalogueIndexUrl() {
  return indexUrl.href;
}

export function resolveIconArtifactUrl(path: string) {
  return declaredUrl(path, indexUrl).href;
}
