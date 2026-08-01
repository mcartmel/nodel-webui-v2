import { DEFAULT_REQUEST_TIMEOUT_MS, FILE_REQUEST_TIMEOUT_MS, fetchWithDeadline, NodelRequestTimeoutError, runWithDeadline } from '../src/api/request';

describe('request deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('defines explicit default and file-operation deadlines', () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(FILE_REQUEST_TIMEOUT_MS).toBe(120_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('aborts and reports a bounded timeout error', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })) as unknown as typeof fetch);

    const request = fetchWithDeadline('/REST', undefined, 100);
    const rejection = expect(request).rejects.toEqual(expect.objectContaining({
      name: 'TimeoutError',
      message: 'Request timed out after 100 ms'
    }));
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    await expect(request).rejects.toBeInstanceOf(NodelRequestTimeoutError);
  });

  it('combines caller cancellation without misreporting it as a timeout', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })) as unknown as typeof fetch);
    const caller = new AbortController();
    const request = fetchWithDeadline('/REST', { signal: caller.signal }, 1000);

    caller.abort();
    await expect(request).rejects.toEqual(expect.objectContaining({ name: 'AbortError' }));
  });

  it('keeps the deadline active while a response body is consumed', async () => {
    const operation = runWithDeadline(async (signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
      return 'body';
    }, undefined, 75);
    const rejection = expect(operation).rejects.toBeInstanceOf(NodelRequestTimeoutError);

    await vi.advanceTimersByTimeAsync(75);
    await rejection;
  });

  it('preserves caller cancellation when its rejection settles after the deadline', async () => {
    const caller = new AbortController();
    const reason = new Error('Caller cancelled');
    const operation = runWithDeadline((signal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        window.setTimeout(() => reject(signal.reason), 50);
      }, { once: true });
    }), caller.signal, 25);
    const rejection = expect(operation).rejects.toBe(reason);

    caller.abort(reason);
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
  });

  it('keeps timeout classification when the deadline wins the cancellation race', async () => {
    const caller = new AbortController();
    const operation = runWithDeadline((signal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        window.setTimeout(() => reject(signal.reason), 50);
      }, { once: true });
    }), caller.signal, 25);
    const rejection = expect(operation).rejects.toBeInstanceOf(NodelRequestTimeoutError);

    await vi.advanceTimersByTimeAsync(25);
    caller.abort(new Error('Too late'));
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
  });

  it('clears its deadline after a successful response', async () => {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch);

    await expect(fetchWithDeadline('/REST', undefined, 100)).resolves.toBeInstanceOf(Response);
    await vi.advanceTimersByTimeAsync(200);
    expect(requestSignal?.aborted).toBe(false);
  });
});
