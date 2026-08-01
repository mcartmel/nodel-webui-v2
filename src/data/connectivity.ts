import { getNodePathName } from '../utils/node-name';

export type NodelConnectivityReason = '' | 'browser' | 'network';

export interface NodelConnectivityState {
  offline: boolean;
  reason: NodelConnectivityReason;
  retryAttempt: number;
}

type ConnectivityListener = (state: NodelConnectivityState) => void;

const probeTimeoutMs = 3000;
const retryDelaysMs = [1000, 2000, 5000];
const listeners = new Set<ConnectivityListener>();

let started = false;
let state: NodelConnectivityState = { offline: false, reason: '', retryAttempt: 0 };
let probeController: AbortController | null = null;
let retryTimer: number | null = null;

function browserOnline() {
  return navigator.onLine !== false;
}

function probeUrl() {
  return getNodePathName() ? 'REST/' : '/REST';
}

function requestUrl(input: RequestInfo | URL) {
  try {
    if (input instanceof Request) {
      return new URL(input.url, window.location.href);
    }
    return new URL(String(input), window.location.href);
  } catch {
    return null;
  }
}

function isSameOriginRequest(input: RequestInfo | URL) {
  return requestUrl(input)?.origin === window.location.origin;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function clearRetryTimer() {
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function emit(next: NodelConnectivityState) {
  if (state.offline === next.offline && state.reason === next.reason && state.retryAttempt === next.retryAttempt) {
    return;
  }
  state = next;
  for (const listener of [...listeners]) {
    if (!listeners.has(listener)) {
      continue;
    }
    try {
      listener({ ...state });
    } catch (error) {
      window.dispatchEvent(new CustomEvent('nodel-connectivity-listener-error', { detail: { error } }));
    }
  }
}

function cancelActiveProbe() {
  const controller = probeController;
  probeController = null;
  controller?.abort();
}

function markOnline(activeProbe?: AbortController) {
  if (probeController && probeController !== activeProbe) {
    cancelActiveProbe();
  }
  clearRetryTimer();
  emit({ offline: false, reason: '', retryAttempt: 0 });
}

function markOffline(reason: Exclude<NodelConnectivityReason, ''>) {
  emit({ offline: true, reason, retryAttempt: state.retryAttempt });
}

function scheduleRetry() {
  if (!started || retryTimer !== null) {
    return;
  }
  const attempt = state.retryAttempt;
  const delay = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)];
  emit({ ...state, retryAttempt: attempt + 1 });
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    if (!browserOnline()) {
      markOffline('browser');
      scheduleRetry();
      return;
    }
    void runProbe();
  }, delay);
}

async function runProbe() {
  if (!started || probeController) {
    return;
  }
  if (!browserOnline()) {
    markOffline('browser');
    scheduleRetry();
    return;
  }

  const controller = new AbortController();
  probeController = controller;
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, probeTimeoutMs);

  try {
    await fetch(probeUrl(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (probeController === controller) {
      markOnline(controller);
    }
  } catch (error) {
    if (probeController !== controller || (!timedOut && isAbortError(error))) {
      return;
    }
    markOffline(browserOnline() ? 'network' : 'browser');
    scheduleRetry();
  } finally {
    window.clearTimeout(timeout);
    if (probeController === controller) {
      probeController = null;
    }
  }
}

function handleBrowserOffline() {
  cancelActiveProbe();
  markOffline('browser');
  scheduleRetry();
}

function handleBrowserOnline() {
  clearRetryTimer();
  void runProbe();
}

function start() {
  if (started) {
    return;
  }
  started = true;
  window.addEventListener('offline', handleBrowserOffline);
  window.addEventListener('online', handleBrowserOnline);
  if (!browserOnline()) {
    markOffline('browser');
    scheduleRetry();
  }
}

function stop() {
  if (!started) {
    return;
  }
  started = false;
  window.removeEventListener('offline', handleBrowserOffline);
  window.removeEventListener('online', handleBrowserOnline);
  cancelActiveProbe();
  clearRetryTimer();
  state = { offline: false, reason: '', retryAttempt: 0 };
}

export function subscribeConnectivity(listener: ConnectivityListener) {
  start();
  listeners.add(listener);
  try {
    listener({ ...state });
  } catch (error) {
    window.dispatchEvent(new CustomEvent('nodel-connectivity-listener-error', { detail: { error } }));
  }
  return {
    dispose() {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stop();
      }
    }
  };
}

export function reportConnectivityFailure(input: RequestInfo | URL, error: unknown, signal?: AbortSignal | null) {
  if (!started || !isSameOriginRequest(input) || signal?.aborted || isAbortError(error)) {
    return;
  }
  if (!browserOnline()) {
    handleBrowserOffline();
    return;
  }
  void runProbe();
}

export function reportConnectivityResponse(input: RequestInfo | URL) {
  if (!started || !isSameOriginRequest(input)) {
    return;
  }
  if (!browserOnline()) {
    markOffline('browser');
    return;
  }
  markOnline();
}

export async function fetchWithConnectivity(input: RequestInfo | URL, init?: RequestInit) {
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  try {
    const response = await fetch(input, init);
    reportConnectivityResponse(input);
    return response;
  } catch (error) {
    reportConnectivityFailure(input, error, signal);
    throw error;
  }
}
