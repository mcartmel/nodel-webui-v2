export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function hasOwn(value: unknown, key: string): boolean {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

export function setOwn(target: Record<string, unknown>, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}
