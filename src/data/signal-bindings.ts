import type { NodelActivityLogEntry } from '../api/nodel-types';
import { subscribeNodeActivity } from './node-activity-source';

export interface SignalBinding {
  signal: string;
  path?: string[];
  target: string;
  mode: SignalBindingMode;
}

export type SignalTargetHandlers = Record<string, (value: string) => void>;
export type SignalBindingMode = 'last' | 'any' | 'all';

export interface SignalTargetAggregator {
  evaluate(value: string): boolean;
  format?(value: boolean): string;
}

export type SignalTargetAggregators = Record<string, SignalTargetAggregator>;

export interface SignalBindingController {
  sync(signal: string | null, signals: string | null, defaultTarget: string | undefined, handlers: SignalTargetHandlers, options?: { join?: string | null; aggregators?: SignalTargetAggregators }): void;
  dispose(): void;
}

function formatSignalValue(value: unknown) {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  return JSON.stringify(value, null, 2) ?? String(value);
}

function isMatchingSignal(entry: NodelActivityLogEntry, signal: string) {
  return entry.source === 'local' && entry.type === 'event' && String(entry.alias ?? '') === signal;
}

function unescapeSignalSegment(value: string) {
  return value.replace(/\\\./g, '.');
}

function firstUnescapedDotIndex(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '.') {
      continue;
    }

    let backslashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
      backslashCount += 1;
    }

    if (backslashCount % 2 === 0) {
      return index;
    }
  }

  return -1;
}

function splitOnUnescapedDots(value: string) {
  const parts: string[] = [];
  let remaining = value;

  while (true) {
    const index = firstUnescapedDotIndex(remaining);
    if (index === -1) {
      parts.push(remaining);
      break;
    }

    parts.push(remaining.slice(0, index));
    remaining = remaining.slice(index + 1);
  }

  return parts;
}

function parseSignalExpression(value: string): Pick<SignalBinding, 'signal' | 'path'> | null {
  const trimmed = value.trim();
  const dotIndex = firstUnescapedDotIndex(trimmed);
  const [rawSignal, rawPath] = dotIndex === -1 ? [trimmed, ''] as const : [trimmed.slice(0, dotIndex), trimmed.slice(dotIndex + 1)] as const;
  const signal = unescapeSignalSegment(rawSignal.trim());

  if (!signal) {
    return null;
  }

  if (dotIndex === -1) {
    return { signal };
  }

  const path = splitOnUnescapedDots(rawPath).map((segment) => unescapeSignalSegment(segment.trim()));
  if (path.length === 0 || path.some((segment) => !segment)) {
    return null;
  }

  return { signal, path };
}

function signalBindingIdentity(binding: SignalBinding) {
  return JSON.stringify([binding.signal, binding.path ?? [], binding.target, binding.mode]);
}

function extractSignalValue(value: unknown, path?: string[]) {
  if (!path) {
    return value;
  }

  let current = value;
  for (const segment of path) {
    if (current === undefined || current === null) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index) || String(index) !== segment) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, segment)) {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }

    return undefined;
  }

  return current;
}

export function normalizeSignalName(value: string | null) {
  return value?.trim() ?? '';
}

function parseTarget(value: string): { target: string; mode: SignalBindingMode } {
  const modeMatch = value.match(/^(.+)\((last|any|all)\)$/i);
  if (!modeMatch) {
    return { target: value.trim(), mode: 'last' };
  }

  return {
    target: modeMatch[1].trim(),
    mode: modeMatch[2].toLocaleLowerCase() as SignalBindingMode
  };
}

function parseSignalBindingList(value: string | null, defaultTarget?: string): SignalBinding[] {
  const bindings: SignalBinding[] = [];

  for (const part of (value ?? '').split(/[;,]/)) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex === -1) {
      const expression = parseSignalExpression(trimmed);
      if (defaultTarget && expression) {
        bindings.push({ ...expression, target: defaultTarget, mode: 'last' });
      }
      continue;
    }

    if (separatorIndex === 0 || separatorIndex === trimmed.length - 1) {
      continue;
    }

    const expression = parseSignalExpression(trimmed.slice(0, separatorIndex));
    const { target, mode } = parseTarget(trimmed.slice(separatorIndex + 1).trim());

    if (expression && target) {
      bindings.push({ ...expression, target, mode });
    }
  }

  return bindings;
}

export function parseSignalBindings(signal: string | null, signals?: string | null, defaultTarget?: string, join?: string | null): SignalBinding[] {
  const bindings = [
    ...parseSignalBindingList(join ?? null, defaultTarget),
    ...parseSignalBindingList(signal, defaultTarget),
    ...parseSignalBindingList(signals ?? null, defaultTarget)
  ];

  const seen = new Set<string>();
  return bindings.filter((binding) => {
    const key = signalBindingIdentity(binding);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function signalBindingKey(bindings: SignalBinding[]) {
  return bindings.map((binding) => signalBindingIdentity(binding)).join(';');
}

export function subscribeSignalBindings(element: HTMLElement, bindings: SignalBinding[], handlers: SignalTargetHandlers, aggregators: SignalTargetAggregators = {}) {
  const aggregateGroups = new Map<string, { bindings: string[]; values: Map<string, boolean>; mode: SignalBindingMode; target: string }>();
  for (const binding of bindings) {
    if (binding.mode === 'last' || !aggregators[binding.target]) {
      continue;
    }
    const key = `${binding.target}:${binding.mode}`;
    const group = aggregateGroups.get(key) ?? { bindings: [], values: new Map<string, boolean>(), mode: binding.mode, target: binding.target };
    const identity = signalBindingIdentity(binding);
    if (!group.bindings.includes(identity)) {
      group.bindings.push(identity);
    }
    aggregateGroups.set(key, group);
  }

  return subscribeNodeActivity(element, (state) => {
    const entries = state.batch?.items.map((item) => item.entry) ?? [];

    for (const entry of entries) {
      for (const binding of bindings) {
        if (isMatchingSignal(entry, binding.signal)) {
          const value = formatSignalValue(extractSignalValue(entry.arg, binding.path));
          const aggregator = aggregators[binding.target];
          if (binding.mode === 'last' || !aggregator) {
            handlers[binding.target]?.(value);
            continue;
          }

          const group = aggregateGroups.get(`${binding.target}:${binding.mode}`);
          if (!group) {
            continue;
          }
          group.values.set(signalBindingIdentity(binding), aggregator.evaluate(value));
          const values = group.bindings.map((identity) => group.values.get(identity) ?? false);
          const next = binding.mode === 'any'
            ? values.some(Boolean)
            : values.every(Boolean);
          handlers[binding.target]?.(aggregator.format?.(next) ?? String(next));
        }
      }
    }
  });
}

export function createSignalBindingController(element: HTMLElement): SignalBindingController {
  let bindingsKey = '';
  let subscription: { dispose(): void } | null = null;

  return {
    sync(signal: string | null, signals: string | null, defaultTarget: string | undefined, handlers: SignalTargetHandlers, options: { join?: string | null; aggregators?: SignalTargetAggregators } = {}) {
      const supportedTargets = new Set(Object.keys(handlers));
      const bindings = parseSignalBindings(signal, signals, defaultTarget, options.join).filter((binding) => supportedTargets.has(binding.target));
      const nextKey = signalBindingKey(bindings);

      if (nextKey === bindingsKey) {
        return;
      }

      subscription?.dispose();
      subscription = null;
      bindingsKey = nextKey;

      if (bindings.length > 0) {
        subscription = subscribeSignalBindings(element, bindings, handlers, options.aggregators);
      }
    },
    dispose() {
      subscription?.dispose();
      subscription = null;
      bindingsKey = '';
    }
  };
}

interface VisibilityBindingState {
  key: string;
  subscription: { dispose(): void } | null;
}

const visibilityTarget = 'visibility';
const visibilityBindings = new WeakMap<HTMLElement, VisibilityBindingState>();

function visibilityState(value: string) {
  const normalized = value.trim().toLocaleLowerCase();

  if (normalized === 'visible' || normalized === 'true' || normalized === '1') {
    return true;
  }

  if (normalized === 'hidden' || normalized === 'false' || normalized === '0') {
    return false;
  }

  return null;
}

function getVisibilityBindings(element: HTMLElement) {
  return [
    ...parseSignalBindings(element.getAttribute('visibility'), null, visibilityTarget),
    ...parseSignalBindings(element.getAttribute('signal'), element.getAttribute('signals'))
  ].filter((binding) => binding.target === visibilityTarget);
}

function syncVisibilityBinding(element: HTMLElement) {
  const bindings = getVisibilityBindings(element);
  const key = signalBindingKey(bindings);
  const existing = visibilityBindings.get(element);

  if (existing?.key === key) {
    return;
  }

  existing?.subscription?.dispose();

  if (bindings.length === 0) {
    visibilityBindings.delete(element);
    return;
  }

  const subscription = subscribeSignalBindings(element, bindings, {
    visibility: (value) => {
      const visible = visibilityState(value);
      if (visible !== null) {
        element.hidden = !visible;
      }
    }
  });

  visibilityBindings.set(element, { key, subscription });
}

function disposeVisibilityBinding(element: HTMLElement) {
  const existing = visibilityBindings.get(element);
  existing?.subscription?.dispose();
  visibilityBindings.delete(element);
}

function walkElements(node: Node, callback: (element: HTMLElement) => void) {
  if (node instanceof HTMLElement) {
    callback(node);
    for (const element of node.querySelectorAll<HTMLElement>('[visibility],[signal],[signals]')) {
      callback(element);
    }
  }
}

export function bootstrapSignalVisibilityBindings(root: ParentNode = document.body) {
  for (const element of root.querySelectorAll<HTMLElement>('[visibility],[signal],[signals]')) {
    syncVisibilityBinding(element);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
        syncVisibilityBinding(mutation.target);
      }

      for (const node of mutation.addedNodes) {
        walkElements(node, syncVisibilityBinding);
      }

      for (const node of mutation.removedNodes) {
        walkElements(node, disposeVisibilityBinding);
      }
    }
  });

  observer.observe(root, {
    attributeFilter: ['visibility', 'signal', 'signals'],
    attributes: true,
    childList: true,
    subtree: true
  });

  return {
    dispose() {
      observer.disconnect();
      for (const element of root.querySelectorAll<HTMLElement>('[visibility],[signal],[signals]')) {
        disposeVisibilityBinding(element);
      }
    }
  };
}
