import { DEFAULT_REQUEST_TIMEOUT_MS, FILE_REQUEST_TIMEOUT_MS, fetchWithDeadline, NodelRequestTimeoutError, runWithDeadline, startRequestDeadline } from '../src/api/request';

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

  it('does not dispatch pre-aborted work in cooperative or strict mode', async () => {
    const caller = new AbortController();
    const reason = new Error('Already cancelled');
    caller.abort(reason);
    const operation = vi.fn(async () => 'unreachable');
    const fetchMock = vi.fn(async () => new Response());
    vi.stubGlobal('fetch', fetchMock);

    const hard = startRequestDeadline(operation, caller.signal);
    await expect(hard.result).rejects.toBe(reason);
    await hard.settled;
    await expect(runWithDeadline(operation, caller.signal, 0)).rejects.toBe(reason);
    await expect(fetchWithDeadline('/REST', { signal: caller.signal })).rejects.toBe(reason);
    expect(operation).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a cooperative fetch pending until the fetch settles, even after its deadline', async () => {
    let finish!: (response: Response) => void;
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>((resolve) => { finish = resolve; });
    }));
    const notified = vi.fn();
    const request = fetchWithDeadline('/REST', undefined, 75);
    void request.then(notified, notified);
    await vi.advanceTimersByTimeAsync(75);
    expect(signal?.aborted).toBe(true);
    expect(notified).not.toHaveBeenCalled();
    finish(new Response('{}'));
    await expect(request).rejects.toBeInstanceOf(NodelRequestTimeoutError);
  });

  it('reports a strict deadline without pretending that abort-insensitive work has settled', async () => {
    let finish!: (value: string) => void;
    const operation = startRequestDeadline(() => new Promise<string>((resolve) => { finish = resolve; }), undefined, 75);
    const rejection = expect(operation.result).rejects.toBeInstanceOf(NodelRequestTimeoutError);
    const settled = vi.fn();
    void operation.settled.then(settled);
    await vi.advanceTimersByTimeAsync(75);
    await rejection;
    expect(settled).not.toHaveBeenCalled();
    finish('late');
    await operation.settled;
    expect(settled).toHaveBeenCalledOnce();
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
