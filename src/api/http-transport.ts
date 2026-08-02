import { fetchWithConnectivity } from '../data/connectivity';
import { boundedErrorMessage } from '../utils/errors';
import { DEFAULT_REQUEST_TIMEOUT_MS, runWithDeadline } from './request';

export async function responseError(response: Response) {
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  let detail = '';

  try {
    const body = (await response.text()).trim();
    if (body) {
      try {
        const parsed = JSON.parse(body) as unknown;
        if (typeof parsed === 'string') {
          detail = parsed;
        } else if (parsed !== null && typeof parsed === 'object') {
          const record = parsed as Record<string, unknown>;
          const value = record.message ?? record.error;
          detail = typeof value === 'string' ? value : body;
        } else {
          detail = body;
        }
      } catch {
        detail = body;
      }
    }
  } catch {
    // Fall back to the HTTP status when the response body cannot be read.
  }

  return new Error(boundedErrorMessage(detail ? new Error(detail) : null, status));
}

export async function fetchJson(input: RequestInfo | URL, init?: RequestInit, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return runWithDeadline(async (signal) => {
    const response = await fetchWithConnectivity(input, { ...init, signal });
    if (!response.ok) {
      throw await responseError(response);
    }
    return response.json() as Promise<unknown>;
  }, callerSignal, timeoutMs);
}

export async function postJson(input: RequestInfo | URL, body: unknown, init?: RequestInit, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
  return fetchJson(input, {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    body: JSON.stringify(body)
  }, timeoutMs);
}

export async function fetchOk(input: RequestInfo | URL, init?: RequestInit, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<unknown> {
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return runWithDeadline(async (signal) => {
    const response = await fetchWithConnectivity(input, { ...init, signal });
    if (!response.ok) {
      throw await responseError(response);
    }

    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json() as Promise<unknown>;
    }

    return response.text();
  }, callerSignal, timeoutMs);
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException('The operation was aborted', 'AbortError');
}

export function throwIfAborted(signal?: AbortSignal | null) {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

export async function waitAbortable(ms: number, signal?: AbortSignal | null) {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timer);
      reject(abortReason(signal!));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function boundedLongPollTimeout(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(Math.trunc(value), 120_000)
    : 0;
}
