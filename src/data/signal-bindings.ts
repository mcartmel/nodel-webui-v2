import type { NodelActivityLogEntry } from '../api/nodel-types';
import { subscribeNodeActivity } from './node-activity-source';

export interface SignalBinding {
  signal: string;
  target: string;
}

export type SignalTargetHandlers = Record<string, (value: string) => void>;

export interface SignalBindingController {
  sync(signal: string | null, signals: string | null, defaultTarget: string | undefined, handlers: SignalTargetHandlers): void;
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

export function normalizeSignalName(value: string | null) {
  return value?.trim() ?? '';
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
      if (defaultTarget) {
        bindings.push({ signal: trimmed, target: defaultTarget });
      }
      continue;
    }

    if (separatorIndex === 0 || separatorIndex === trimmed.length - 1) {
      continue;
    }

    const signal = trimmed.slice(0, separatorIndex).trim();
    const target = trimmed.slice(separatorIndex + 1).trim();

    if (signal && target) {
      bindings.push({ signal, target });
    }
  }

  return bindings;
}

export function parseSignalBindings(signal: string | null, signals?: string | null, defaultTarget?: string): SignalBinding[] {
  return [
    ...parseSignalBindingList(signal, defaultTarget),
    ...parseSignalBindingList(signals ?? null, defaultTarget)
  ];
}

export function signalBindingKey(bindings: SignalBinding[]) {
  return bindings.map((binding) => `${binding.signal}:${binding.target}`).join(';');
}

export function subscribeSignalBindings(element: HTMLElement, bindings: SignalBinding[], handlers: SignalTargetHandlers) {
  return subscribeNodeActivity(element, (state) => {
    const entries = state.batch?.items.map((item) => item.entry) ?? [];

    for (const entry of entries) {
      for (const binding of bindings) {
        if (isMatchingSignal(entry, binding.signal)) {
          handlers[binding.target]?.(formatSignalValue(entry.arg));
        }
      }
    }
  });
}

export function createSignalBindingController(element: HTMLElement): SignalBindingController {
  let bindingsKey = '';
  let subscription: { dispose(): void } | null = null;

  return {
    sync(signal: string | null, signals: string | null, defaultTarget: string | undefined, handlers: SignalTargetHandlers) {
      const supportedTargets = new Set(Object.keys(handlers));
      const bindings = parseSignalBindings(signal, signals, defaultTarget).filter((binding) => supportedTargets.has(binding.target));
      const nextKey = signalBindingKey(bindings);

      if (nextKey === bindingsKey) {
        return;
      }

      subscription?.dispose();
      subscription = null;
      bindingsKey = nextKey;

      if (bindings.length > 0) {
        subscription = subscribeSignalBindings(element, bindings, handlers);
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
