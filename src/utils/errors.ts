export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError';
}

export function errorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : '';
  return message || fallback;
}

export function boundedErrorMessage(error: unknown, fallback = 'Listener failed', maxLength = 500) {
  const message = errorMessage(error, fallback).replace(/\s+/g, ' ').trim();
  return message.slice(0, Math.max(0, maxLength));
}

export function apiErrorMessage(error: unknown, fallback: string) {
  return boundedErrorMessage(error, fallback);
}

export function reportBoundedListenerError(eventName: string, error: unknown, source: string) {
  window.dispatchEvent(new CustomEvent(eventName, {
    detail: {
      error,
      message: boundedErrorMessage(error),
      source
    }
  }));
}
