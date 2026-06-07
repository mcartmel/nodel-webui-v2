import { observeNodelVisibility } from './visibility-scope';

export interface NodelSourceState<T> {
  loading: boolean;
  data: T | null;
  error: string;
  active: boolean;
  updatedAt: number | null;
}

export interface NodelPollSourceOptions<T> {
  key: string;
  intervalMs: number;
  fetcher: (signal: AbortSignal) => Promise<T>;
  visibleOnly?: boolean;
}

export interface NodelSourceSubscription<T> {
  refresh(): Promise<void>;
  dispose(): void;
  getState(): NodelSourceState<T>;
}

type Listener<T> = (state: NodelSourceState<T>) => void;

interface SourceSubscriber<T> {
  element: HTMLElement;
  visible: boolean;
  listener: Listener<T>;
  disposeVisibility: () => void;
}

interface SourceEntry<T> {
  options: NodelPollSourceOptions<T>;
  subscribers: Set<SourceSubscriber<T>>;
  state: NodelSourceState<T>;
  timer: number | null;
  inFlight: Promise<void> | null;
  abortController: AbortController | null;
  refreshToken: number;
  failureCount: number;
  pendingRefresh: boolean;
}

const sources = new Map<string, SourceEntry<unknown>>();

function createState<T>(): NodelSourceState<T> {
  return {
    loading: true,
    data: null,
    error: '',
    active: false,
    updatedAt: null
  };
}

function emit<T>(entry: SourceEntry<T>) {
  for (const subscriber of entry.subscribers) {
    subscriber.listener(entry.state);
  }
}

function clearTimer<T>(entry: SourceEntry<T>) {
  if (entry.timer !== null) {
    window.clearTimeout(entry.timer);
    entry.timer = null;
  }
}

function shouldRun<T>(entry: SourceEntry<T>) {
  if (document.hidden) {
    return false;
  }

  if (!navigator.onLine) {
    return false;
  }

  if (entry.options.visibleOnly === false) {
    return entry.subscribers.size > 0;
  }

  return Array.from(entry.subscribers).some((subscriber) => subscriber.visible);
}

function scheduleNext<T>(entry: SourceEntry<T>) {
  clearTimer(entry);

  if (!shouldRun(entry)) {
    entry.state.active = false;
    emit(entry);
    return;
  }

  const delay = Math.max(0, entry.options.intervalMs * Math.max(1, entry.failureCount + 1));
  entry.timer = window.setTimeout(() => {
    entry.timer = null;
    void refreshSource(entry);
  }, delay);
}

async function refreshSource<T>(entry: SourceEntry<T>) {
  if (!shouldRun(entry)) {
    entry.state.active = false;
    entry.pendingRefresh = true;
    emit(entry);
    return;
  }

  if (entry.inFlight) {
    entry.pendingRefresh = true;
    return entry.inFlight;
  }

  const token = ++entry.refreshToken;
  entry.abortController?.abort();
  entry.abortController = new AbortController();
  entry.state.loading = entry.state.data === null;
  entry.state.active = true;
  entry.state.error = '';
  entry.pendingRefresh = false;
  emit(entry);

  const inFlight = entry.options.fetcher(entry.abortController.signal)
    .then((data) => {
      if (token !== entry.refreshToken) {
        return;
      }

      entry.state.data = data;
      entry.state.loading = false;
      entry.state.error = '';
      entry.state.updatedAt = Date.now();
      entry.failureCount = 0;
      emit(entry);
    })
    .catch((error) => {
      if (token !== entry.refreshToken) {
        return;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      entry.state.loading = false;
      entry.state.error = error instanceof Error ? error.message : 'Failed to load data';
      entry.failureCount += 1;
      emit(entry);
    })
    .finally(() => {
      if (entry.inFlight === inFlight) {
        entry.inFlight = null;
        entry.abortController = null;
      }

      if (token !== entry.refreshToken) {
        return;
      }

      if (entry.pendingRefresh) {
        void refreshSource(entry);
        return;
      }

      if (entry.options.intervalMs > 0) {
        scheduleNext(entry);
      } else {
        entry.state.active = false;
        emit(entry);
      }
    });

  entry.inFlight = inFlight;
  return entry.inFlight;
}

function getOrCreateSource<T>(options: NodelPollSourceOptions<T>) {
  const existing = sources.get(options.key) as SourceEntry<T> | undefined;
  if (existing) {
    return existing;
  }

  const entry: SourceEntry<T> = {
    options,
    subscribers: new Set(),
    state: createState<T>(),
    timer: null,
    inFlight: null,
    abortController: null,
    refreshToken: 0,
    failureCount: 0,
    pendingRefresh: false
  };

  sources.set(options.key, entry as SourceEntry<unknown>);
  return entry;
}

export function registerNodelPollSource<T>(options: NodelPollSourceOptions<T>) {
  const entry = getOrCreateSource(options);

  function ensureRegistered() {
    if (!sources.has(options.key)) {
      sources.set(options.key, entry as SourceEntry<unknown>);
    }
  }

  function resetAfterLastSubscriber() {
    clearTimer(entry);
    entry.abortController?.abort();
    entry.abortController = null;
    entry.inFlight = null;
    entry.refreshToken += 1;
    entry.state = createState<T>();
    entry.failureCount = 0;
    entry.pendingRefresh = false;
    sources.delete(options.key);
  }

  function evaluate() {
    const active = shouldRun(entry);
    entry.state.active = active;

    if (!active) {
      clearTimer(entry);
      entry.abortController?.abort();
      entry.refreshToken += 1;
      emit(entry);
      return;
    }

    if ((entry.state.data === null || entry.pendingRefresh) && entry.inFlight === null) {
      void refreshSource(entry);
      return;
    }

    if (entry.options.intervalMs > 0 && entry.timer === null && entry.inFlight === null) {
      scheduleNext(entry);
    }
  }

  return {
    subscribe(element: HTMLElement, listener: Listener<T>): NodelSourceSubscription<T> {
      ensureRegistered();

      const subscriber: SourceSubscriber<T> = {
        element,
        visible: false,
        listener,
        disposeVisibility: () => undefined
      };

      subscriber.disposeVisibility = observeNodelVisibility(element, (visible) => {
        subscriber.visible = visible;
        evaluate();
      });

      entry.subscribers.add(subscriber);
      listener(entry.state);
      evaluate();

      return {
        refresh: () => refreshSource(entry),
        dispose: () => {
          subscriber.disposeVisibility();
          entry.subscribers.delete(subscriber);

          if (entry.subscribers.size === 0) {
            resetAfterLastSubscriber();
          }
        },
        getState: () => entry.state
      };
    },
    refresh: () => refreshSource(entry),
    getState: () => entry.state
  };
}

export function registerNodelOneShotSource<T>(options: Omit<NodelPollSourceOptions<T>, 'intervalMs'>) {
  const source = registerNodelPollSource<T>({
    ...options,
    intervalMs: 0
  });

  return source;
}
