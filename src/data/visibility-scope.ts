import { subscribeConnectivity } from './connectivity';

type VisibilityChangeHandler = (visible: boolean) => void;

export interface NodelVisibilityObserverOptions {
  suspendOnDocumentHidden?: boolean;
  suspendOnConnectivity?: boolean;
}

interface VisibilityObserverEntry {
  element: HTMLElement;
  handler: VisibilityChangeHandler;
  options: Required<NodelVisibilityObserverOptions>;
  visible: boolean;
}

const entries = new Set<VisibilityObserverEntry>();
const activePageOwners = new WeakMap<HTMLElement, HTMLElement>();
let observerStarted = false;
let mutationObserver: MutationObserver | null = null;
let connectivityOffline = false;
let connectivitySubscription: { dispose(): void } | null = null;

export function claimNodelPageActive(page: HTMLElement, app: HTMLElement) {
  activePageOwners.set(page, app);
}

export function clearNodelPageActive(page: HTMLElement, app: HTMLElement) {
  if (activePageOwners.get(page) === app) {
    activePageOwners.delete(page);
  }
}

export function releaseNodelPageActive(page: HTMLElement) {
  activePageOwners.delete(page);
}

function ownsActivePage(page: HTMLElement, app: HTMLElement) {
  return activePageOwners.get(page) === app;
}

function isVisibleInTree(element: HTMLElement, options: Required<NodelVisibilityObserverOptions>) {
  if (!element.isConnected) {
    return false;
  }

  if (options.suspendOnDocumentHidden && document.hidden) {
    return false;
  }

  if (options.suspendOnConnectivity && (navigator.onLine === false || connectivityOffline)) {
    return false;
  }

  for (let current: HTMLElement | null = element.parentElement; current; current = current.parentElement) {
    if (
      current.localName === 'nodel-page' &&
      (current.hasAttribute('hidden') ||
        (current.closest('nodel-app') &&
          (!current.hasAttribute('active') || !ownsActivePage(current, current.closest('nodel-app') as HTMLElement))))
    ) {
      return false;
    }
  }

  return true;
}

function syncEntries() {
  for (const entry of entries) {
    const nextVisible = isVisibleInTree(entry.element, entry.options);
    if (nextVisible !== entry.visible) {
      entry.visible = nextVisible;
      notify(entry, nextVisible);
    }
  }
}

function ensureObservers() {
  if (observerStarted) {
    return;
  }

  observerStarted = true;

  document.addEventListener('visibilitychange', syncEntries);
  window.addEventListener('online', syncEntries);
  window.addEventListener('offline', syncEntries);
  connectivitySubscription = subscribeConnectivity((state) => {
    connectivityOffline = state.offline;
    syncEntries();
  });

  mutationObserver = new MutationObserver(syncEntries);
  mutationObserver.observe(document.body ?? document.documentElement, {
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'active'],
    subtree: true
  });
}

export function observeNodelVisibility(
  element: HTMLElement,
  handler: VisibilityChangeHandler,
  options: NodelVisibilityObserverOptions = {}
) {
  ensureObservers();

  const observerOptions: Required<NodelVisibilityObserverOptions> = {
    suspendOnDocumentHidden: options.suspendOnDocumentHidden ?? true,
    suspendOnConnectivity: options.suspendOnConnectivity ?? true
  };

  const entry: VisibilityObserverEntry = {
    element,
    handler,
    options: observerOptions,
    visible: isVisibleInTree(element, observerOptions)
  };

  entries.add(entry);
  notify(entry, entry.visible);

  return () => {
    entries.delete(entry);

    if (entries.size === 0 && mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
      document.removeEventListener('visibilitychange', syncEntries);
      window.removeEventListener('online', syncEntries);
      window.removeEventListener('offline', syncEntries);
      connectivitySubscription?.dispose();
      connectivitySubscription = null;
      connectivityOffline = false;
      observerStarted = false;
    }
  };
}

function notify(entry: VisibilityObserverEntry, visible: boolean) {
  try {
    entry.handler(visible);
  } catch (error) {
    window.dispatchEvent(new CustomEvent('nodel-visibility-listener-error', { detail: { error } }));
  }
}
