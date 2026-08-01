import { fetchWithConnectivity } from '../data/connectivity';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const FILE_REQUEST_TIMEOUT_MS = 120_000;

export class NodelRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms`);
    this.name = 'TimeoutError';
  }
}

export async function runWithDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, callerSignal?: AbortSignal | null, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return operation(callerSignal ?? new AbortController().signal);
  }

  const controller = new AbortController();
  let abortCause: 'caller' | 'timeout' | null = null;
  const abortFromCaller = () => {
    if (abortCause !== null) {
      return;
    }
    abortCause = 'caller';
    controller.abort(callerSignal?.reason);
  };
  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  }
  const timer = window.setTimeout(() => {
    if (abortCause !== null) {
      return;
    }
    abortCause = 'timeout';
    controller.abort();
  }, timeoutMs);

  try {
    return await operation(controller.signal);
  } catch (error) {
    if (abortCause === 'timeout') {
      throw new NodelRequestTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function fetchWithDeadline(input: RequestInfo | URL, init?: RequestInit, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return runWithDeadline(
    (signal) => fetchWithConnectivity(input, { ...init, signal }),
    callerSignal,
    timeoutMs
  );
}
