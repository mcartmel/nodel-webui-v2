export type ControlVariant = 'default' | 'primary' | 'success' | 'info' | 'warning' | 'danger' | 'ghost';
export type ControlTone = 'solid' | 'soft' | 'outline';
export type ControlArgType = 'string' | 'number' | 'boolean' | 'json';

export const controlVariants: ControlVariant[] = ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost'];
export const controlTones: ControlTone[] = ['solid', 'soft', 'outline'];

export function normalizeFromList<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

export function normalizeVariant(value: string | null): ControlVariant {
  return normalizeFromList(value, controlVariants, 'default');
}

export function normalizeTone(value: string | null): ControlTone {
  return normalizeFromList(value, controlTones, 'solid');
}

export function truthy(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes' || normalized === 'active' || normalized === 'present' || normalized === 'available' || normalized === 'signal' || normalized === 'disabled';
}

export function falsey(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized === '' || normalized === 'false' || normalized === '0' || normalized === 'off' || normalized === 'no' || normalized === 'inactive' || normalized === 'absent' || normalized === 'none';
}

export function parseBoolean(value: string) {
  return truthy(value);
}

export function parseTypedArg(value: string, type: ControlArgType): unknown {
  if (type === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }

  if (type === 'boolean') {
    return parseBoolean(value);
  }

  if (type === 'json') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

export function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function formatBindingFailures(failures: ReadonlyArray<{ action: string; error?: string }>, fallback = 'Failed to call action') {
  if (failures.length === 1) {
    return failures[0].error ?? fallback;
  }
  return failures.map((failure) => `${failure.action}: ${failure.error}`).join('; ');
}

export function formatPlainNumber(value: number, precision: number | null = null) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  if (precision !== null) {
    return value.toFixed(Math.max(0, Math.min(10, precision)));
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toFixed(2)));
}
