import { observeNodelVisibility } from './visibility-scope';

export interface NodelSourceState<T> {
  loading: boolean;
  data: T | null;
  error: string;
  active: boolean;
  updatedAt: number | null;
}

export type NodelSourceRefreshStatus = 'verified' | 'failed' | 'aborted' | 'superseded' | 'skipped' | 'absent' | 'inactive';

export interface NodelSourceRefreshResult {
  status: NodelSourceRefreshStatus;
  detail?: string;
}

export interface NodelSourceRefreshOptions {
  signal?: AbortSignal;
  force?: boolean;
}

export interface NodelPollSourceOptions<T> {
  key: string;
  intervalMs: number;
  fetcher: (signal: AbortSignal) => Promise<T>;
  visibleOnly?: boolean;
  onIdle?: () => void;
}

export interface NodelSourceSubscription<T> {
  refresh(): Promise<void>;
  refreshResult(options?: NodelSourceRefreshOptions): Promise<NodelSourceRefreshResult>;
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
  pendingRefreshForce: boolean;
  refreshWaiters: RefreshWaiter[];
}

interface RefreshWaiter {
  resolve: (result: NodelSourceRefreshResult) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
  cycleToken: number | null;
  force: boolean;
  settled: boolean;
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
  for (const subscriber of [...entry.subscribers]) {
    if (entry.subscribers.has(subscriber)) {
      notifySubscriber(subscriber, entry.state);
    }
  }
}

function notifySubscriber<T>(subscriber: SourceSubscriber<T>, state: NodelSourceState<T>) {
  try {
    subscriber.listener(state);
  } catch (error) {
    window.dispatchEvent(new CustomEvent('nodel-source-listener-error', { detail: { error } }));
  }
}

function clearTimer<T>(entry: SourceEntry<T>) {
  if (entry.timer !== null) {
    window.clearTimeout(entry.timer);
    entry.timer = null;
  }
}

function shouldRun<T>(entry: SourceEntry<T>, force = false) {
  if (document.hidden) {
    return false;
  }

  if (!navigator.onLine) {
    return false;
  }

  if (entry.options.visibleOnly === false) {
    return entry.subscribers.size > 0;
  }

  if (force) {
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

function resolveRefreshWaiters<T>(entry: SourceEntry<T>, waiters: RefreshWaiter[], result: NodelSourceRefreshResult) {
  for (const waiter of waiters) {
    if (waiter.settled) {
      continue;
    }
    waiter.settled = true;
    if (waiter.signal && waiter.abortListener) {
      waiter.signal.removeEventListener('abort', waiter.abortListener);
    }
    waiter.resolve(result);
  }
}

function hasQueuedRefreshWaiter<T>(entry: SourceEntry<T>) {
  return entry.refreshWaiters.some((waiter) => !waiter.settled && waiter.cycleToken === null);
}

function hasQueuedForcedRefreshWaiter<T>(entry: SourceEntry<T>) {
  return entry.refreshWaiters.some((waiter) => !waiter.settled && waiter.cycleToken === null && waiter.force);
}

async function refreshSource<T>(entry: SourceEntry<T>, force = false) {
  if (!shouldRun(entry, force)) {
    entry.state.active = false;
    entry.pendingRefresh = true;
    entry.pendingRefreshForce ||= force;
    emit(entry);
    return;
  }

  if (entry.inFlight) {
    entry.pendingRefresh = true;
    entry.pendingRefreshForce ||= force;
    return entry.inFlight;
  }

  const token = ++entry.refreshToken;
  const refreshWaiters = entry.refreshWaiters.splice(0);
  for (const waiter of refreshWaiters) {
    waiter.cycleToken = token;
  }
  entry.abortController?.abort();
  const controller = new AbortController();
  entry.abortController = controller;
  entry.state.loading = entry.state.data === null;
  entry.state.active = true;
  entry.state.error = '';
  entry.pendingRefresh = false;
  entry.pendingRefreshForce = false;
  let outcome: NodelSourceRefreshResult = { status: 'verified' };
  const inFlight = Promise.resolve()
    .then(() => {
      if (token !== entry.refreshToken || controller.signal.aborted || !shouldRun(entry, force)) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      return entry.options.fetcher(controller.signal);
    })
    .then((data) => {
      if (token !== entry.refreshToken) {
        outcome = { status: 'superseded', detail: 'The source refresh was superseded.' };
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
        outcome = { status: 'superseded', detail: 'The source refresh was superseded.' };
        return;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        outcome = { status: 'aborted', detail: 'The source refresh was aborted.' };
        return;
      }

      entry.state.loading = false;
      entry.state.error = error instanceof Error ? error.message : 'Failed to load data';
      entry.failureCount += 1;
      outcome = { status: 'failed', detail: entry.state.error };
      emit(entry);
    })
    .finally(() => {
      resolveRefreshWaiters(entry, refreshWaiters, outcome);
      if (entry.inFlight === inFlight) {
        entry.inFlight = null;
        entry.abortController = null;
      }

      if (token !== entry.refreshToken) {
        if (entry.pendingRefresh && shouldRun(entry, entry.pendingRefreshForce) && entry.subscribers.size > 0) {
          void refreshSource(entry, entry.pendingRefreshForce);
        }
        return;
      }

      if (entry.pendingRefresh) {
        void refreshSource(entry, entry.pendingRefreshForce);
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
  emit(entry);
  return inFlight;
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
    pendingRefresh: false,
    pendingRefreshForce: false,
    refreshWaiters: []
  };

  sources.set(options.key, entry as SourceEntry<unknown>);
  return entry;
}

export function registerNodelPollSource<T>(options: NodelPollSourceOptions<T>) {
  const entry = getOrCreateSource(options);

  function ensureRegistered() {
    if (sources.get(options.key) !== entry) {
      if (sources.has(options.key)) {
        throw new Error(`Nodel data source handle "${options.key}" is stale`);
      }
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
    entry.pendingRefreshForce = false;
    resolveRefreshWaiters(entry, entry.refreshWaiters.splice(0), { status: 'superseded', detail: 'The source refresh was superseded.' });
    try {
      entry.options.onIdle?.();
    } catch (error) {
      window.dispatchEvent(new CustomEvent('nodel-source-listener-error', { detail: { error } }));
    }
    if (sources.get(options.key) === entry) {
      sources.delete(options.key);
    }
  }

  function evaluate() {
    const active = shouldRun(entry);
    entry.state.active = active;

    if (!active) {
      clearTimer(entry);
      if (entry.inFlight || entry.state.data === null) {
        entry.pendingRefresh = true;
        entry.pendingRefreshForce = false;
      }
      entry.abortController?.abort();
      entry.abortController = null;
      entry.inFlight = null;
      entry.refreshToken += 1;
      entry.pendingRefreshForce = false;
      resolveRefreshWaiters(entry, entry.refreshWaiters.splice(0), { status: 'aborted', detail: 'The source refresh was aborted.' });
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
      notifySubscriber(subscriber, entry.state);
      evaluate();

      let disposed = false;
      return {
        refresh: () => refreshSource(entry),
        refreshResult: (options: NodelSourceRefreshOptions = {}) => {
          ensureRegistered();
          return refreshWithResult(entry, options);
        },
        dispose: () => {
          if (disposed) {
            return;
          }
          disposed = true;
          subscriber.disposeVisibility();
          entry.subscribers.delete(subscriber);

          if (entry.subscribers.size === 0) {
            resetAfterLastSubscriber();
          }
        },
        getState: () => entry.state
      };
    },
    refresh: () => {
      ensureRegistered();
      return refreshSource(entry);
    },
    refreshResult: (options: NodelSourceRefreshOptions = {}) => {
      ensureRegistered();
      return refreshWithResult(entry, options);
    },
    getState: () => entry.state
  };
}

async function refreshWithResult<T>(entry: SourceEntry<T>, options: NodelSourceRefreshOptions = {}): Promise<NodelSourceRefreshResult> {
  if (options.signal?.aborted) {
    return { status: 'aborted', detail: 'The source refresh was aborted.' };
  }
  if (!shouldRun(entry, options.force)) {
    entry.pendingRefresh = true;
    entry.pendingRefreshForce ||= Boolean(options.force);
    return {
      status: entry.subscribers.size === 0 ? 'absent' : 'inactive',
      detail: entry.subscribers.size === 0
        ? 'The source has no subscribers.'
        : 'The source has subscribers but none are active and visible.'
    };
  }

  return new Promise((resolve) => {
    const waiter: RefreshWaiter = {
      resolve,
      signal: options.signal,
      cycleToken: null,
      force: Boolean(options.force),
      settled: false
    };
    waiter.abortListener = () => {
      if (waiter.settled) {
        return;
      }
      waiter.settled = true;
      const index = entry.refreshWaiters.indexOf(waiter);
      if (index >= 0) {
        entry.refreshWaiters.splice(index, 1);
      }
      if (waiter.cycleToken !== null && entry.refreshToken === waiter.cycleToken) {
        entry.refreshToken += 1;
        entry.abortController?.abort();
      } else if (waiter.cycleToken === null && !hasQueuedRefreshWaiter(entry)) {
        entry.pendingRefresh = false;
        entry.pendingRefreshForce = false;
      } else if (waiter.cycleToken === null && !hasQueuedForcedRefreshWaiter(entry)) {
        entry.pendingRefreshForce = false;
      }
      waiter.resolve({ status: 'aborted', detail: 'The source refresh was aborted.' });
    };
    options.signal?.addEventListener('abort', waiter.abortListener, { once: true });
    entry.refreshWaiters.push(waiter);
    void refreshSource(entry, options.force);
  });
}

export function registerNodelOneShotSource<T>(options: Omit<NodelPollSourceOptions<T>, 'intervalMs'>) {
  const source = registerNodelPollSource<T>({
    ...options,
    intervalMs: 0
  });

  return source;
}
