export type ToggleState = 'on' | 'off' | 'partially-on' | 'partially-off';

export interface ToggleStateOptions {
  onValue?: string | null;
  offValue?: string | null;
  partialOnValue?: string | null;
  partialOffValue?: string | null;
}

const onValues = new Set(['on', 'true', '1', 'yes', 'active', 'enabled']);
const offValues = new Set(['off', 'false', '0', 'no', 'inactive', 'disabled']);
const partialOnValues = new Set(['partiallyon', 'partially-on', 'partial-on', 'mixed-on']);
const partialOffValues = new Set(['partiallyoff', 'partially-off', 'partial-off', 'mixed-off']);

function normalized(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function exact(value: unknown, expected?: string | null) {
  return expected !== undefined && expected !== null && String(value) === expected;
}

export function resolveToggleState(value: unknown, options: ToggleStateOptions = {}): ToggleState {
  if (exact(value, options.partialOnValue)) {
    return 'partially-on';
  }

  if (exact(value, options.partialOffValue)) {
    return 'partially-off';
  }

  if (exact(value, options.onValue)) {
    return 'on';
  }

  if (exact(value, options.offValue)) {
    return 'off';
  }

  const next = normalized(value);
  if (partialOnValues.has(next)) {
    return 'partially-on';
  }

  if (partialOffValues.has(next)) {
    return 'partially-off';
  }

  if (onValues.has(next)) {
    return 'on';
  }

  return offValues.has(next) ? 'off' : 'off';
}

export function isToggleOnish(state: ToggleState) {
  return state === 'on' || state === 'partially-on';
}

export function toggleAriaChecked(state: ToggleState) {
  if (state === 'partially-on' || state === 'partially-off') {
    return 'mixed';
  }

  return state === 'on' ? 'true' : 'false';
}
