export function isAbortError(error: unknown) {
  if (error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  return error instanceof Error && error.name === 'AbortError';
}

export function boundedErrorMessage(error: unknown, fallback = 'Listener failed') {
  return (error instanceof Error ? error.message : String(error || fallback)).replace(/\s+/g, ' ').slice(0, 500);
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
