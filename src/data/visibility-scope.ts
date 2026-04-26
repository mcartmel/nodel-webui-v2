type VisibilityChangeHandler = (visible: boolean) => void;

interface VisibilityObserverEntry {
  element: HTMLElement;
  handler: VisibilityChangeHandler;
  visible: boolean;
}

const entries = new Set<VisibilityObserverEntry>();
let observerStarted = false;
let mutationObserver: MutationObserver | null = null;

function isVisibleInTree(element: HTMLElement) {
  if (!element.isConnected || document.hidden) {
    return false;
  }

  for (let current: HTMLElement | null = element.parentElement; current; current = current.parentElement) {
    if (current.localName === 'nodel-page' && current.hasAttribute('hidden')) {
      return false;
    }
  }

  return true;
}

function syncEntries() {
  for (const entry of entries) {
    const nextVisible = isVisibleInTree(entry.element);
    if (nextVisible !== entry.visible) {
      entry.visible = nextVisible;
      entry.handler(nextVisible);
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

  mutationObserver = new MutationObserver(syncEntries);
  mutationObserver.observe(document.body ?? document.documentElement, {
    attributes: true,
    attributeFilter: ['hidden', 'active'],
    subtree: true
  });
}

export function observeNodelVisibility(element: HTMLElement, handler: VisibilityChangeHandler) {
  ensureObservers();

  const entry: VisibilityObserverEntry = {
    element,
    handler,
    visible: isVisibleInTree(element)
  };

  entries.add(entry);
  handler(entry.visible);

  return () => {
    entries.delete(entry);

    if (entries.size === 0 && mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
      document.removeEventListener('visibilitychange', syncEntries);
      window.removeEventListener('online', syncEntries);
      window.removeEventListener('offline', syncEntries);
      observerStarted = false;
    }
  };
}

export function elementIsVisibleInNodelApp(element: HTMLElement) {
  return isVisibleInTree(element);
}
