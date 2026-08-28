import { reportBoundedListenerError } from '../utils/errors';

export interface ShortcutRuntimeEntry {
  readonly element: HTMLElement;
  chord(): ShortcutChord | null;
  eligible(): boolean;
  activate(): void;
  conflict(entries: readonly ShortcutRuntimeEntry[]): void;
}

export interface ShortcutChord {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const registry = new Set<ShortcutRuntimeEntry>();
let listening = false;
let removalRetryScheduled = false;
let addRetryScheduled = false;

function sameChord(a: ShortcutChord, b: KeyboardEvent) {
  return a.key === b.key && a.ctrl === b.ctrlKey && a.alt === b.altKey
    && a.shift === b.shiftKey && a.meta === b.metaKey;
}

function compareDocumentOrder(a: ShortcutRuntimeEntry, b: ShortcutRuntimeEntry) {
  if (a.element === b.element) return 0;
  const position = a.element.compareDocumentPosition(b.element);
  return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function handleKeydown(event: KeyboardEvent) {
  const matches: ShortcutRuntimeEntry[] = [];
  for (const entry of Array.from(registry)) {
    try {
      const chord = entry.chord();
      if (chord && entry.eligible() && sameChord(chord, event)) matches.push(entry);
    } catch (error) {
      reportBoundedListenerError('nodel-shortcut-listener-error', error, 'shortcut-runtime:eligibility');
    }
  }
  try {
    matches.sort(compareDocumentOrder);
  } catch (error) {
    reportBoundedListenerError('nodel-shortcut-listener-error', error, 'shortcut-runtime:document-order');
    if (matches.length > 0) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }
  if (matches.length === 0) return;

  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return;

  if (matches.length > 1) {
    try {
      matches[0]?.conflict(matches);
    } catch (error) {
      reportBoundedListenerError('nodel-shortcut-listener-error', error, 'shortcut-runtime:conflict');
    }
    return;
  }

  try {
    matches[0]?.activate();
  } catch (error) {
    reportBoundedListenerError('nodel-shortcut-listener-error', error, 'shortcut-runtime:activation');
  }
}

function scheduleAddRetry() {
  if (addRetryScheduled) return;
  addRetryScheduled = true;
  queueMicrotask(() => {
    addRetryScheduled = false;
    if (registry.size > 0 && !listening) start(true);
  });
}

function start(isRetry = false) {
  if (!listening) {
    try {
      window.addEventListener('keydown', handleKeydown, true);
      listening = true;
    } catch (error) {
      reportBoundedListenerError('nodel-shortcut-listener-error', error, 'shortcut-runtime:add-listener');
      if (!isRetry && registry.size > 0) scheduleAddRetry();
    }
  }
}

function stop() {
  if (listening && registry.size === 0) {
    if (removalRetryScheduled) return;
    try {
      window.removeEventListener('keydown', handleKeydown, true);
      listening = false;
    } catch (error) {
      reportBoundedListenerError('nodel-shortcut-listener-error', error, 'shortcut-runtime:remove-listener');
      removalRetryScheduled = true;
      queueMicrotask(() => {
        removalRetryScheduled = false;
        if (registry.size === 0 && listening) stopAfterRetry();
      });
    }
  }
}

function stopAfterRetry() {
  try {
    window.removeEventListener('keydown', handleKeydown, true);
    listening = false;
  } catch (error) {
    reportBoundedListenerError('nodel-shortcut-listener-error', error, 'shortcut-runtime:remove-listener-retry');
    // Keep the listener marked active: the failed removal may have left it installed.
  }
}

export function registerShortcut(entry: ShortcutRuntimeEntry) {
  registry.add(entry);
  start();
}

export function unregisterShortcut(entry: ShortcutRuntimeEntry) {
  registry.delete(entry);
  stop();
}
