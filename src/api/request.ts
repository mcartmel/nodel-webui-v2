import { fetchWithConnectivity } from '../data/connectivity';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const FILE_REQUEST_TIMEOUT_MS = 120_000;

export class NodelRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms`);
    this.name = 'TimeoutError';
  }
}

export interface NodelReadInit extends RequestInit {
  /** Let an outer scheduler hold the request slot until the whole read settles. */
  waitForSettlement?: boolean;
}

function beginDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, callerSignal: AbortSignal | null | undefined, timeoutMs: number, strict: boolean) {
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- AbortSignal.reason can be any value; preserve the caller's reason.
  if (callerSignal?.aborted) return { result: Promise.reject<T>(callerSignal.reason), settled: Promise.resolve() };
  const controller = new AbortController();
  const { signal } = controller;
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = strict ? new Promise<never>((_resolve, reject) => { rejectAbort = reject; }) : undefined;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? window.setTimeout(() => controller.abort(new NodelRequestTimeoutError(timeoutMs)), timeoutMs)
    : undefined;
  const cleanup = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortFromCaller);
    signal.removeEventListener('abort', onAbort);
  };
  const onAbort = () => {
    cleanup();
    rejectAbort?.(signal.reason);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

  const work = (async () => {
    try {
      const result = await operation(signal);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    } finally {
      cleanup();
    }
  })();
  return {
    result: aborted ? Promise.race([work, aborted]) : work,
    settled: work.then(() => undefined, () => undefined)
  };
}

/** Abort transport at the deadline; keep its slot until the operation settles. */
export function runWithDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, callerSignal?: AbortSignal | null, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  return beginDeadline(operation, callerSignal, timeoutMs, false).result;
}

/** Report deadlines even if a read ignores abort, separately from its true lifetime. */
export function startRequestDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, callerSignal?: AbortSignal | null, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  return beginDeadline(operation, callerSignal, timeoutMs, true);
}

export async function fetchWithDeadline(input: RequestInfo | URL, init?: RequestInit, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return runWithDeadline(
    (signal) => fetchWithConnectivity(input, { ...init, signal }),
    callerSignal,
    timeoutMs
  );
}
