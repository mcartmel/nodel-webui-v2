import type { NodelActivityLogEntry } from '../api/nodel-types';
import { getControlRuntime } from './control-runtime';
import { asciiToken } from '../utils/text-normalization';
import { trimPointReference } from '../utils/edge-whitespace';
import { hasOwn, isRecord } from '../utils/records';

export interface SignalBinding {
  signal: string;
  path?: string[];
  target: string;
  mode: SignalBindingMode;
}

export interface SignalTargetContext {
  aggregated: boolean;
  binding: SignalBinding;
}

export type SignalTargetHandler = (value: string, rawValue?: unknown, context?: SignalTargetContext) => void;
export type SignalTargetHandlers = Record<string, SignalTargetHandler>;
export type SignalBindingMode = 'last' | 'any' | 'all';

export interface SignalBindingSourceState {
  loading: boolean;
  connected: boolean;
  error: string;
}

export interface SignalTargetAggregator {
  evaluate(value: string, rawValue?: unknown): boolean;
  format?(value: boolean): string;
}

export type SignalTargetAggregators = Record<string, SignalTargetAggregator>;

export interface SignalBindingController {
  sync(signal: string | null, signals: string | null, defaultTarget: string | undefined, handlers: SignalTargetHandlers, options?: { join?: string | null; optionsSignal?: string | null; aggregators?: SignalTargetAggregators; onSourceState?: (state: SignalBindingSourceState) => void }): void;
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
  const trimmed = trimPointReference(value);
  const dotIndex = firstUnescapedDotIndex(trimmed);
  const [rawSignal, rawPath] = dotIndex === -1 ? [trimmed, ''] as const : [trimmed.slice(0, dotIndex), trimmed.slice(dotIndex + 1)] as const;
  const signal = unescapeSignalSegment(trimPointReference(rawSignal));

  if (!signal) {
    return null;
  }

  if (dotIndex === -1) {
    return { signal };
  }

  const path = splitOnUnescapedDots(rawPath).map((segment) => unescapeSignalSegment(trimPointReference(segment)));
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

    if (isRecord(current) && hasOwn(current, segment)) {
      current = current[segment];
      continue;
    }

    return undefined;
  }

  return current;
}

export function normalizeSignalName(value: string | null) {
  return value === null ? '' : trimPointReference(value);
}

function parseTarget(value: string): { target: string; mode: SignalBindingMode } {
  const modeMatch = value.match(/^(.+)\((last|any|all)\)$/i);
  if (!modeMatch) {
    return { target: value.trim(), mode: 'last' };
  }

  return {
    target: modeMatch[1].trim(),
    mode: asciiToken(modeMatch[2]) as SignalBindingMode
  };
}

function parseSignalBindingList(value: string | null, defaultTarget?: string): SignalBinding[] {
  const bindings: SignalBinding[] = [];

  for (const part of (value ?? '').split(/[;,]/)) {
    const trimmed = trimPointReference(part);
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

export function parseSignalBindings(signal: string | null, signals?: string | null, defaultTarget?: string, join?: string | null, optionsSignal?: string | null): SignalBinding[] {
  const bindings = [
    ...parseSignalBindingList(join ?? null, defaultTarget),
    ...parseSignalBindingList(optionsSignal ?? null, 'options'),
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

export function subscribeSignalBindings(element: HTMLElement, bindings: SignalBinding[], handlers: SignalTargetHandlers, aggregators: SignalTargetAggregators = {}, onSourceState?: (state: SignalBindingSourceState) => void) {
  const aggregateGroups = new Map<string, { binding: SignalBinding; bindings: string[]; values: Map<string, boolean>; mode: SignalBindingMode; target: string }>();
  for (const binding of bindings) {
    if (binding.mode === 'last' || !aggregators[binding.target]) {
      continue;
    }
    const key = `${binding.target}:${binding.mode}`;
    const group = aggregateGroups.get(key) ?? { binding, bindings: [], values: new Map<string, boolean>(), mode: binding.mode, target: binding.target };
    const identity = signalBindingIdentity(binding);
    if (!group.bindings.includes(identity)) {
      group.bindings.push(identity);
    }
    aggregateGroups.set(key, group);
  }

  return getControlRuntime().subscribeSignals(element, (state) => {
    onSourceState?.({ loading: state.loading, connected: state.connected, error: state.error });
    const entries = state.entries;

    for (const entry of entries) {
      const updatedAggregateGroups = new Set<string>();
      for (const binding of bindings) {
        if (isMatchingSignal(entry, binding.signal)) {
          const rawValue = extractSignalValue(entry.arg, binding.path);
          const value = formatSignalValue(rawValue);
          const aggregator = aggregators[binding.target];
          if (binding.mode === 'last' || !aggregator) {
            handlers[binding.target]?.(value, rawValue, { aggregated: false, binding });
            continue;
          }

          const group = aggregateGroups.get(`${binding.target}:${binding.mode}`);
          if (!group) {
            continue;
          }
          group.values.set(signalBindingIdentity(binding), aggregator.evaluate(value, rawValue));
          updatedAggregateGroups.add(`${binding.target}:${binding.mode}`);
        }
      }

      for (const groupKey of updatedAggregateGroups) {
        const group = aggregateGroups.get(groupKey);
        const aggregator = group ? aggregators[group.target] : null;
        if (!group || !aggregator) {
          continue;
        }
        const values = group.bindings.map((identity) => group.values.get(identity) ?? false);
        const next = group.mode === 'any'
          ? values.some(Boolean)
          : values.every(Boolean);
        handlers[group.target]?.(aggregator.format?.(next) ?? String(next), next, { aggregated: true, binding: group.binding });
      }
    }
  });
}

export function createSignalBindingController(element: HTMLElement): SignalBindingController {
  let bindingsKey = '';
  let subscription: { dispose(): void } | null = null;

  return {
    sync(signal: string | null, signals: string | null, defaultTarget: string | undefined, handlers: SignalTargetHandlers, options: { join?: string | null; optionsSignal?: string | null; aggregators?: SignalTargetAggregators; onSourceState?: (state: SignalBindingSourceState) => void } = {}) {
      const supportedTargets = new Set(Object.keys(handlers));
      const bindings = parseSignalBindings(signal, signals, defaultTarget, options.join, options.optionsSignal).filter((binding) => supportedTargets.has(binding.target) && !(binding.target === 'options' && binding.mode !== 'last'));
      const nextKey = signalBindingKey(bindings);

      if (nextKey === bindingsKey) {
        return;
      }

      subscription?.dispose();
      subscription = null;
      bindingsKey = nextKey;

      if (bindings.length > 0) {
        subscription = subscribeSignalBindings(element, bindings, handlers, options.aggregators, options.onSourceState);
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
  authoredHidden: boolean;
  key: string;
  subscription: { dispose(): void } | null;
}

interface VisibilityPredicate {
  exact: boolean;
  values: Set<string>;
}

const visibilityTarget = 'visibility';
const visibilityBindings = new WeakMap<HTMLElement, VisibilityBindingState>();

function visibilityState(value: string) {
  const normalized = asciiToken(value);

  if (normalized === 'visible' || normalized === 'true' || normalized === '1') {
    return true;
  }

  if (normalized === 'hidden' || normalized === 'false' || normalized === '0') {
    return false;
  }

  return null;
}

function visibilityPredicate(element: HTMLElement): VisibilityPredicate {
  const exact = element.hasAttribute('visible-value') || element.hasAttribute('visible-values');
  const values = new Set<string>();
  const singleValue = element.getAttribute('visible-value')?.trim();
  if (singleValue) {
    values.add(singleValue);
  }

  for (const value of (element.getAttribute('visible-values') ?? '').split(';')) {
    const trimmed = value.trim();
    if (trimmed) {
      values.add(trimmed);
    }
  }

  return { exact, values };
}

function scalarVisibilityValue(rawValue: unknown): string | null {
  if (typeof rawValue === 'string') {
    return rawValue;
  }

  if (typeof rawValue === 'number' || typeof rawValue === 'boolean' || typeof rawValue === 'bigint') {
    return String(rawValue);
  }

  return null;
}

function evaluateVisibility(value: string, rawValue: unknown, predicate: VisibilityPredicate) {
  if (!predicate.exact) {
    return visibilityState(value);
  }

  const scalarValue = scalarVisibilityValue(rawValue);
  return scalarValue !== null && predicate.values.has(scalarValue);
}

function getVisibilityBindings(element: HTMLElement) {
  return [
    ...parseSignalBindings(element.getAttribute('visibility'), null, visibilityTarget),
    ...parseSignalBindings(element.getAttribute('signal'), element.getAttribute('signals'))
  ].filter((binding) => binding.target === visibilityTarget);
}

function syncVisibilityBinding(element: HTMLElement) {
  const bindings = getVisibilityBindings(element);
  const predicate = visibilityPredicate(element);
  const key = JSON.stringify([signalBindingKey(bindings), predicate.exact, ...predicate.values]);
  const existing = visibilityBindings.get(element);

  if (existing?.key === key) {
    return;
  }

  existing?.subscription?.dispose();
  if (existing) {
    element.hidden = existing.authoredHidden;
  }

  if (bindings.length === 0) {
    visibilityBindings.delete(element);
    return;
  }

  const authoredHidden = existing?.authoredHidden ?? element.hidden;
  if (predicate.exact) {
    element.hidden = true;
  }

  const subscription = subscribeSignalBindings(element, bindings, {
    visibility: (value, rawValue, context) => {
      const visible = context?.aggregated ? rawValue === true : evaluateVisibility(value, rawValue, predicate);
      if (visible !== null) {
        element.hidden = !visible;
      }
    }
  }, {
    visibility: {
      evaluate: (value, rawValue) => evaluateVisibility(value, rawValue, predicate) === true
    }
  });

  visibilityBindings.set(element, { authoredHidden, key, subscription });
}

function disposeVisibilityBinding(element: HTMLElement) {
  const existing = visibilityBindings.get(element);
  existing?.subscription?.dispose();
  if (existing) {
    element.hidden = existing.authoredHidden;
  }
  visibilityBindings.delete(element);
}

function walkElements(node: Node, callback: (element: HTMLElement) => void) {
  if (node instanceof HTMLElement) {
    callback(node);
    for (const element of node.querySelectorAll<HTMLElement>('[visibility],[signal],[signals],[visible-value],[visible-values]')) {
      callback(element);
    }
  }
}

export function bootstrapSignalVisibilityBindings(root: ParentNode = document.body) {
  const boundElements = new Set<HTMLElement>();
  const syncTrackedVisibilityBinding = (element: HTMLElement) => {
    syncVisibilityBinding(element);
    if (visibilityBindings.has(element)) {
      boundElements.add(element);
    } else {
      boundElements.delete(element);
    }
  };
  const disposeTrackedVisibilityBinding = (element: HTMLElement) => {
    disposeVisibilityBinding(element);
    boundElements.delete(element);
  };

  for (const element of root.querySelectorAll<HTMLElement>('[visibility],[signal],[signals],[visible-value],[visible-values]')) {
    syncTrackedVisibilityBinding(element);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
        syncTrackedVisibilityBinding(mutation.target);
      }

      for (const node of mutation.addedNodes) {
        walkElements(node, syncTrackedVisibilityBinding);
      }

      for (const node of mutation.removedNodes) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        for (const element of Array.from(boundElements)) {
          if (element === node || node.contains(element)) {
            disposeTrackedVisibilityBinding(element);
          }
        }
      }
    }
  });

  observer.observe(root, {
    attributeFilter: ['visibility', 'signal', 'signals', 'visible-value', 'visible-values'],
    attributes: true,
    childList: true,
    subtree: true
  });

  return {
    dispose() {
      observer.disconnect();
      for (const element of Array.from(boundElements)) {
        disposeTrackedVisibilityBinding(element);
      }
    }
  };
}
