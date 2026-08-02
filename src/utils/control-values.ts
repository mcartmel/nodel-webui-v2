export type ControlVariant = 'default' | 'primary' | 'success' | 'info' | 'warning' | 'danger' | 'ghost';
export type ControlTone = 'solid' | 'soft' | 'outline';
export type ControlArgType = 'string' | 'number' | 'boolean' | 'json';

export const controlVariants: ControlVariant[] = ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost'];
export const controlTones: ControlTone[] = ['solid', 'soft', 'outline'];
const truthyTokens = ['true', '1', 'on', 'yes', 'active', 'present', 'available', 'signal', 'disabled'] as const;
const falseyTokens = ['', 'false', '0', 'off', 'no', 'inactive', 'absent', 'none'] as const;

interface ControlArgParseSuccess {
  ok: true;
  value: unknown;
}

interface ControlArgParseFailure {
  ok: false;
  error: string;
}

type ControlArgParseResult = ControlArgParseSuccess | ControlArgParseFailure;

export function normalizeFromList<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

export function normalizeVariant(value: string | null): ControlVariant {
  return normalizeFromList(value, controlVariants, 'default');
}

export function normalizeTone(value: string | null): ControlTone {
  return normalizeFromList(value, controlTones, 'solid');
}

export function normalizeBooleanToken(value: string) {
  return value.trim().toLowerCase();
}

export function truthy(value: string) {
  return (truthyTokens as readonly string[]).includes(normalizeBooleanToken(value));
}

export function falsey(value: string) {
  return (falseyTokens as readonly string[]).includes(normalizeBooleanToken(value));
}

export function parseBoolean(value: string) {
  return truthy(value);
}

export function parseTypedArgStrict(value: string, type: ControlArgType): ControlArgParseResult {
  if (type === 'number') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return { ok: false, error: 'Invalid number argument: (empty)' };
    }
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, error: `Invalid number argument: ${trimmed}` };
  }

  if (type === 'boolean') {
    return { ok: true, value: parseBoolean(value) };
  }

  if (type === 'json') {
    try {
      return { ok: true, value: JSON.parse(value) };
    } catch {
      return { ok: false, error: 'Invalid JSON argument' };
    }
  }

  return { ok: true, value };
}

export function syncInheritedAttributes(
  element: HTMLElement,
  state: WeakMap<HTMLElement, Map<string, string>>,
  active: boolean,
  attributes: Record<string, string>
) {
  const inherited = state.get(element) ?? new Map<string, string>();

  for (const [name, value] of Object.entries(attributes)) {
    const previous = inherited.get(name);
    if (!active) {
      if (previous !== undefined && element.getAttribute(name) === previous) {
        element.removeAttribute(name);
      }
      inherited.delete(name);
      continue;
    }

    if (previous !== undefined) {
      if (element.getAttribute(name) === previous) {
        element.setAttribute(name, value);
        inherited.set(name, value);
      } else {
        inherited.delete(name);
      }
    } else if (!element.hasAttribute(name)) {
      element.setAttribute(name, value);
      inherited.set(name, value);
    }
  }

  if (inherited.size > 0) {
    state.set(element, inherited);
  } else {
    state.delete(element);
  }
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
