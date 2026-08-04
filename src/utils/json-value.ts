export const MAX_JSON_DEPTH = 64;
export const MAX_JSON_COLLECTION_ITEMS = 10_000;
export const MAX_JSON_TOTAL_ITEMS = 10_000;

export type JsonValueBoundsIssue =
  | 'depth'
  | 'value'
  | 'number'
  | 'cyclic'
  | 'prototype'
  | 'array-items'
  | 'object-properties'
  | 'total-items';

export interface JsonValueBoundsFailure {
  issue: JsonValueBoundsIssue;
  path: string;
}

/**
 * Checks JSON-shaped values without invoking accessors or assigning untrusted keys.
 * Parsed JSON with __proto__ or constructor keys remains valid data, not object state.
 */
export function validateJsonValueBounds(value: unknown): JsonValueBoundsFailure | null {
  let totalItems = 0;
  const seen = new WeakSet<object>();

  const visit = (current: unknown, path: string, depth: number): JsonValueBoundsFailure | null => {
    if (depth > MAX_JSON_DEPTH) return { issue: 'depth', path };
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return null;
    if (typeof current === 'number') return Number.isFinite(current) ? null : { issue: 'number', path };
    if (typeof current !== 'object') return { issue: 'value', path };
    if (seen.has(current)) return { issue: 'cyclic', path };

    const isArray = Array.isArray(current);
    const prototype = Object.getPrototypeOf(current);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      return { issue: 'prototype', path };
    }
    seen.add(current);

    if (isArray) {
      if (current.length > MAX_JSON_COLLECTION_ITEMS) return { issue: 'array-items', path };
      totalItems += current.length;
      if (totalItems > MAX_JSON_TOTAL_ITEMS) return { issue: 'total-items', path };
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || !('value' in descriptor)) return { issue: 'value', path: `${path}[${index}]` };
        const failure = visit(descriptor.value, `${path}[${index}]`, depth + 1);
        if (failure) return failure;
      }
      if (Object.keys(current).length !== current.length) return { issue: 'value', path };
    } else {
      const keys = Object.keys(current);
      if (keys.length > MAX_JSON_COLLECTION_ITEMS) return { issue: 'object-properties', path };
      totalItems += keys.length;
      if (totalItems > MAX_JSON_TOTAL_ITEMS) return { issue: 'total-items', path };
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !('value' in descriptor)) return { issue: 'value', path: `${path}.${key}` };
        const failure = visit(descriptor.value, `${path}.${key}`, depth + 1);
        if (failure) return failure;
      }
    }

    seen.delete(current);
    return null;
  };

  return visit(value, '$', 0);
}

export function assertJsonValueBounds(value: unknown) {
  if (validateJsonValueBounds(value)) {
    throw new Error('JSON payload is invalid or exceeds safe bounds.');
  }
}
