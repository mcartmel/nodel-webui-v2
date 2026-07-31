import {
  fetchWithConnectivity,
  reportConnectivityFailure,
  reportConnectivityResponse,
  subscribeConnectivity,
  type NodelConnectivityState
} from '../src/data/connectivity';

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe('connectivity coordinator', () => {
  let subscription: { dispose(): void } | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    setOnline(true);
    window.history.replaceState(undefined, '', '/nodes.html');
  });

  afterEach(() => {
    subscription?.dispose();
    subscription = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not poll while healthy', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    subscription = subscribeConnectivity(vi.fn());

    vi.advanceTimersByTime(60_000);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enters browser-offline state immediately and requires a successful online probe', async () => {
    setOnline(false);
    const fetchMock = vi.fn(async () => new Response('host error', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const states: NodelConnectivityState[] = [];
    subscription = subscribeConnectivity((state) => states.push(state));

    expect(states.at(-1)).toMatchObject({ offline: true, reason: 'browser' });
    expect(fetchMock).not.toHaveBeenCalled();

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledWith('/REST', expect.objectContaining({ cache: 'no-store' }));
    expect(states.at(-1)).toEqual({ offline: false, reason: '', retryAttempt: 0 });
  });

  it('confirms same-origin network failure, retries with bounded backoff, and recovers on any HTTP response', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(new Response('still an application error', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const states: NodelConnectivityState[] = [];
    subscription = subscribeConnectivity((state) => states.push(state));

    reportConnectivityFailure('/REST/actions/Run', new TypeError('request failed'));
    await flushAsync();
    expect(states.at(-1)).toMatchObject({ offline: true, reason: 'network', retryAttempt: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toMatchObject({ offline: true, retryAttempt: 2 });

    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(states.at(-1)).toEqual({ offline: false, reason: '', retryAttempt: 0 });
  });

  it('caps repeated retry delay at five seconds', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('network unavailable');
    });
    vi.stubGlobal('fetch', fetchMock);
    subscription = subscribeConnectivity(vi.fn());
    reportConnectivityFailure('/REST', new TypeError('request failed'));
    await flushAsync();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('treats probe timeout as offline but ignores caller aborts and cross-origin failures', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const states: NodelConnectivityState[] = [];
    subscription = subscribeConnectivity((state) => states.push(state));

    reportConnectivityFailure('/REST/activity', new DOMException('Aborted', 'AbortError'));
    reportConnectivityFailure('https://remote.example/REST', new TypeError('remote unavailable'));
    expect(fetchMock).not.toHaveBeenCalled();

    reportConnectivityFailure('/REST/activity', new TypeError('same origin unavailable'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(states.at(-1)).toMatchObject({ offline: true, reason: 'network' });
  });

  it('lets a newer same-origin response invalidate a stale failing probe', async () => {
    const probe = deferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => probe.promise)
      .mockResolvedValueOnce(new Response('application error', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const states: NodelConnectivityState[] = [];
    subscription = subscribeConnectivity((state) => states.push(state));

    reportConnectivityFailure('/REST/activity', new TypeError('request failed'));
    const response = await fetchWithConnectivity('/REST/params');
    expect(response.status).toBe(500);
    expect(states.at(-1)).toEqual({ offline: false, reason: '', retryAttempt: 0 });

    probe.reject(new TypeError('stale probe failed'));
    await flushAsync();
    expect(states.at(-1)).toEqual({ offline: false, reason: '', retryAttempt: 0 });
  });

  it('keeps replacement probe timeout independent from an aborted stale probe', async () => {
    const firstProbe = deferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstProbe.promise)
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }));
    vi.stubGlobal('fetch', fetchMock);
    const states: NodelConnectivityState[] = [];
    subscription = subscribeConnectivity((state) => states.push(state));

    reportConnectivityFailure('/REST/activity', new TypeError('request failed'));
    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    firstProbe.reject(new DOMException('Aborted', 'AbortError'));
    await flushAsync();
    await vi.advanceTimersByTimeAsync(3000);
    expect(states.at(-1)).toMatchObject({ offline: true, reason: 'network' });
  });

  it('ignores requests aborted with a custom reason', async () => {
    const controller = new AbortController();
    const reason = new Error('superseded');
    controller.abort(reason);
    const fetchMock = vi.fn(async () => {
      throw reason;
    });
    vi.stubGlobal('fetch', fetchMock);
    const states: NodelConnectivityState[] = [];
    subscription = subscribeConnectivity((state) => states.push(state));

    await expect(fetchWithConnectivity('/REST/activity', { signal: controller.signal })).rejects.toBe(reason);
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toEqual({ offline: false, reason: '', retryAttempt: 0 });
  });

  it('reads a custom abort reason from Request.signal when RequestInit is omitted', async () => {
    const controller = new AbortController();
    const reason = new Error('request superseded');
    controller.abort(reason);
    const request = new Request(new URL('/REST/activity', window.location.href));
    Object.defineProperty(request, 'signal', { configurable: true, value: controller.signal });
    const fetchMock = vi.fn(async () => {
      throw reason;
    });
    vi.stubGlobal('fetch', fetchMock);
    const states: NodelConnectivityState[] = [];
    subscription = subscribeConnectivity((state) => states.push(state));

    await expect(fetchWithConnectivity(request)).rejects.toBe(reason);
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toEqual({ offline: false, reason: '', retryAttempt: 0 });
  });

  it('uses a node-relative probe on node pages', async () => {
    window.history.replaceState(undefined, '', '/nodes/ExampleNode/nodel.html');
    const fetchMock = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    subscription = subscribeConnectivity(vi.fn());

    reportConnectivityFailure('REST/activity', new TypeError('request failed'));
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledWith('REST/', expect.any(Object));
  });

  it('uses same-origin responses to recover without hiding application HTTP errors', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('probe failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'bad request' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const states: NodelConnectivityState[] = [];
    subscription = subscribeConnectivity((state) => states.push(state));
    reportConnectivityFailure('/REST', new TypeError('request failed'));
    await flushAsync();
    expect(states.at(-1)?.offline).toBe(true);

    const response = await fetchWithConnectivity('/REST/params/save');
    expect(response.status).toBe(400);
    expect(states.at(-1)).toEqual({ offline: false, reason: '', retryAttempt: 0 });

    reportConnectivityResponse('/REST/another-error');
    expect(states.at(-1)?.offline).toBe(false);
  });

  it('does not turn a cross-origin request failure into local host offline state', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('remote node unavailable');
    });
    vi.stubGlobal('fetch', fetchMock);
    const states: NodelConnectivityState[] = [];
    subscription = subscribeConnectivity((state) => states.push(state));

    await expect(fetchWithConnectivity('https://remote.example/REST/files')).rejects.toThrow('remote node unavailable');
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toEqual({ offline: false, reason: '', retryAttempt: 0 });
  });
});
