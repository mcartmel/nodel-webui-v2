import { flush, waitFor } from './helpers';
import { registerNodelOneShotSource } from '../src/data/nodel-data-runtime';

function uniqueKey() {
  return `runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createPage(hidden = false) {
  const page = document.createElement('nodel-page');
  const host = document.createElement('div');

  if (hidden) {
    page.setAttribute('hidden', '');
  }

  page.append(host);
  document.body.append(page);

  return { page, host };
}

describe('nodel-data-runtime', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('defers one-shot fetches until the page is visible', async () => {
    const { page, host } = createPage(true);
    const fetcher = vi.fn(async () => 'ready');
    const source = registerNodelOneShotSource<string>({
      key: uniqueKey(),
      fetcher
    });
    const states: Array<{ loading: boolean; active: boolean; data: string | null; error: string }> = [];
    const subscription = source.subscribe(host, (state) => {
      states.push({
        loading: state.loading,
        active: state.active,
        data: state.data,
        error: state.error
      });
    });

    await flush();
    expect(fetcher).not.toHaveBeenCalled();

    page.removeAttribute('hidden');
    await waitFor(() => fetcher.mock.calls.length === 1);
    await waitFor(() => states.at(-1)?.data === 'ready');

    expect(states.some((state) => state.active)).toBe(true);

    subscription.dispose();
  });

  it('refetches after an aborted fetch when the page becomes visible again', async () => {
    const { page, host } = createPage(false);
    let calls = 0;
    let firstAborted = false;
    const fetcher = vi.fn((signal: AbortSignal) => {
      calls += 1;

      if (calls === 1) {
        return new Promise<string>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              firstAborted = true;
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true }
          );
        });
      }

      return Promise.resolve('resumed');
    });

    const source = registerNodelOneShotSource<string>({
      key: uniqueKey(),
      fetcher
    });
    const states: Array<{ loading: boolean; active: boolean; data: string | null; error: string }> = [];
    const subscription = source.subscribe(host, (state) => {
      states.push({
        loading: state.loading,
        active: state.active,
        data: state.data,
        error: state.error
      });
    });

    await waitFor(() => calls === 1);
    page.setAttribute('hidden', '');
    await waitFor(() => firstAborted);
    page.removeAttribute('hidden');
    await waitFor(() => calls === 2);
    await waitFor(() => states.at(-1)?.data === 'resumed');

    expect(firstAborted).toBe(true);

    subscription.dispose();
  });

  it('queues a manual refresh while hidden and runs it after reveal', async () => {
    const { page, host } = createPage(true);
    const fetcher = vi.fn(async () => 'queued');
    const source = registerNodelOneShotSource<string>({
      key: uniqueKey(),
      fetcher
    });
    const subscription = source.subscribe(host, () => undefined);

    await flush();
    expect(fetcher).not.toHaveBeenCalled();

    await source.refresh();
    expect(fetcher).not.toHaveBeenCalled();

    page.removeAttribute('hidden');
    await waitFor(() => fetcher.mock.calls.length === 1);

    subscription.dispose();
  });

  it('isolates throwing listeners from successful fetches and other subscribers', async () => {
    const first = createPage(false).host;
    const second = createPage(false).host;
    const listenerError = vi.fn();
    window.addEventListener('nodel-source-listener-error', listenerError);
    const source = registerNodelOneShotSource<string>({
      key: uniqueKey(),
      fetcher: async () => 'ready'
    });
    const firstSubscription = source.subscribe(first, () => {
      throw new Error('listener failed');
    });
    const states: string[] = [];
    const secondSubscription = source.subscribe(second, (state) => {
      if (state.data) {
        states.push(state.data);
      }
    });

    await waitFor(() => states.includes('ready'));
    expect(source.getState()).toMatchObject({ data: 'ready', error: '' });
    expect(listenerError).toHaveBeenCalled();

    firstSubscription.dispose();
    firstSubscription.dispose();
    secondSubscription.dispose();
    window.removeEventListener('nodel-source-listener-error', listenerError);
  });

  it('emits defensive state snapshots to subscribers and getState callers', async () => {
    const source = registerNodelOneShotSource<string>({ key: uniqueKey(), fetcher: async () => 'ready' });
    const subscription = source.subscribe(createPage(false).host, (state) => {
      if (state.data) {
        state.error = 'mutated by listener';
      }
    });

    await waitFor(() => source.getState().data === 'ready');
    const snapshot = source.getState();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => {
      snapshot.error = 'mutated by caller';
    }).toThrow();

    expect(source.getState()).toMatchObject({ data: 'ready', error: '' });
    subscription.dispose();
  });

  it('freezes nested arrays and plain records without traversing platform objects', async () => {
    const date = new Date();
    const data = [{ nested: { labels: ['original'] }, date }];
    const source = registerNodelOneShotSource<typeof data>({ key: uniqueKey(), fetcher: async () => data });
    let snapshot: typeof data | null = null;
    const firstSubscription = source.subscribe(createPage(false).host, (state) => {
      if (!state.data) {
        return;
      }
      snapshot = state.data;
    });
    const received: typeof data[] = [];
    const second = source.subscribe(createPage(false).host, (state) => {
      if (state.data) {
        received.push(state.data);
      }
    });

    await waitFor(() => received.length > 0);
    const snapshotData: typeof data | null = snapshot;
    if (snapshotData === null) throw new Error('Expected snapshot to be present');
    expect(snapshotData).not.toBeNull();
    expect(Object.isFrozen(snapshotData)).toBe(true);
    const firstEntryCandidate = snapshotData[0];
    if (firstEntryCandidate === undefined) throw new Error('Expected snapshot entry to be present');
    const firstEntry: typeof data[number] = firstEntryCandidate;
    expect(Object.isFrozen(firstEntry)).toBe(true);
    expect(Object.isFrozen(firstEntry.nested)).toBe(true);
    expect(Object.isFrozen(firstEntry.nested.labels)).toBe(true);
    expect(Object.isFrozen(firstEntry.date)).toBe(false);
    expect(() => firstEntry.nested.labels.push('changed')).toThrow();
    expect(() => {
      firstEntry.nested = { labels: [] };
    }).toThrow();
    expect(received.at(-1)?.[0]?.nested.labels).toEqual(['original']);
    expect(source.getState().data?.[0]?.nested.labels).toEqual(['original']);
    firstSubscription.dispose();
    second.dispose();
  });

  it('restarts after an abort-ignoring hidden request finally settles', async () => {
    const { page, host } = createPage(false);
    let resolveFirst!: (value: string) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce('current');
    const source = registerNodelOneShotSource<string>({ key: uniqueKey(), fetcher });
    const subscription = source.subscribe(host, () => undefined);

    await waitFor(() => fetcher.mock.calls.length === 1);
    page.setAttribute('hidden', '');
    await waitFor(() => (fetcher.mock.calls[0]?.[0] as AbortSignal | undefined)?.aborted === true);
    page.removeAttribute('hidden');
    await waitFor(() => fetcher.mock.calls.length === 2);
    resolveFirst('stale');
    await waitFor(() => source.getState().data === 'current');

    expect(source.getState().data).toBe('current');
    subscription.dispose();
  });

  it('rejects an evicted handle when a new source owns the same key', async () => {
    const key = uniqueKey();
    const first = registerNodelOneShotSource<string>({ key, fetcher: async () => 'first' });
    const firstSubscription = first.subscribe(createPage(false).host, () => undefined);
    await waitFor(() => first.getState().data === 'first');
    firstSubscription.dispose();

    const second = registerNodelOneShotSource<string>({ key, fetcher: async () => 'second' });
    expect(() => first.subscribe(createPage(false).host, () => undefined)).toThrow('is stale');
    const secondSubscription = second.subscribe(createPage(false).host, () => undefined);
    await waitFor(() => second.getState().data === 'second');
    secondSubscription.dispose();
  });

  it('establishes request ownership before reentrant listener refresh or disposal', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('initial').mockResolvedValueOnce('current');
    const source = registerNodelOneShotSource<string>({ key: uniqueKey(), fetcher });
    let disposeDuringEmit = false;
    let refreshDuringEmit = false;
    const subscription = source.subscribe(createPage(false).host, () => {
      if (refreshDuringEmit) {
        refreshDuringEmit = false;
        void source.refresh();
      }
      if (disposeDuringEmit) {
        disposeDuringEmit = false;
        subscription.dispose();
      }
    });
    await waitFor(() => source.getState().data === 'initial');

    refreshDuringEmit = true;
    const refresh = source.refresh();
    await refresh;
    expect(fetcher).toHaveBeenCalledTimes(3);

    disposeDuringEmit = true;
    await expect(source.refresh()).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('returns explicit failure results for restart refreshes without hiding local source errors', async () => {
    const { host } = createPage(false);
    const fetcher = vi.fn().mockResolvedValueOnce('initial').mockRejectedValueOnce(new Error('console unavailable'));
    const source = registerNodelOneShotSource<string>({ key: uniqueKey(), fetcher });
    const subscription = source.subscribe(host, () => undefined);
    await waitFor(() => source.getState().data === 'initial');

    const result = await source.refreshResult();

    expect(result).toMatchObject({ status: 'failed', detail: 'console unavailable' });
    expect(source.getState().error).toBe('console unavailable');
    subscription.dispose();
  });

  it('treats Error-shaped AbortError failures as aborted refreshes', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    const source = registerNodelOneShotSource<string>({
      key: uniqueKey(),
      fetcher: vi.fn().mockRejectedValue(abortError)
    });
    const states: Array<{ active: boolean; error: string; data: string | null }> = [];
    const subscription = source.subscribe(createPage(false).host, (state) => {
      states.push({ active: state.active, error: state.error, data: state.data });
    });

    await waitFor(() => states.some((state) => state.active));
    await waitFor(() => states.at(-1)?.active === false);

    expect(states.at(-1)).toMatchObject({ error: '', data: null });
    subscription.dispose();
  });

  it('reports a superseded result when a requested refresh is aborted by lifecycle visibility', async () => {
    const { page, host } = createPage(false);
    let resolveRefresh!: (value: string) => void;
    const fetcher = vi.fn()
      .mockResolvedValueOnce('initial')
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveRefresh = resolve;
      }));
    const source = registerNodelOneShotSource<string>({ key: uniqueKey(), fetcher });
    const subscription = source.subscribe(host, () => undefined);
    await waitFor(() => source.getState().data === 'initial');

    const resultPromise = source.refreshResult();
    await waitFor(() => fetcher.mock.calls.length === 2);
    page.setAttribute('hidden', '');
    resolveRefresh('stale');
    const result = await resultPromise;

    expect(['aborted', 'superseded']).toContain(result.status);
    expect(source.getState().data).toBe('initial');
    subscription.dispose();
  });

  it('distinguishes an absent optional source from an inactive hidden source', async () => {
    const hiddenPage = createPage(true);
    const hiddenSource = registerNodelOneShotSource<string>({ key: uniqueKey(), fetcher: vi.fn(async () => 'hidden') });
    const hiddenSubscription = hiddenSource.subscribe(hiddenPage.host, () => undefined);
    await expect(hiddenSource.refreshResult()).resolves.toMatchObject({ status: 'inactive' });
    hiddenSubscription.dispose();

    const absentSource = registerNodelOneShotSource<string>({ key: uniqueKey(), fetcher: vi.fn(async () => 'absent') });
    await expect(absentSource.refreshResult()).resolves.toMatchObject({ status: 'absent' });
  });

  it('forces a bounded restart refresh for a hidden but subscribed source', async () => {
    const { host } = createPage(true);
    const fetcher = vi.fn(async () => 'forced');
    const source = registerNodelOneShotSource<string>({ key: uniqueKey(), fetcher });
    const subscription = source.subscribe(host, () => undefined);

    await expect(source.refreshResult()).resolves.toMatchObject({ status: 'inactive' });
    await expect(source.refreshResult({ force: true })).resolves.toMatchObject({ status: 'verified' });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(source.getState().data).toBe('forced');
    subscription.dispose();
  });

  it('does not run an unowned queued restart refresh after its signal aborts', async () => {
    const { host } = createPage(false);
    let resolveInitial!: (value: string) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => {
      resolveInitial = resolve;
    }));
    const source = registerNodelOneShotSource<string>({ key: uniqueKey(), fetcher });
    const subscription = source.subscribe(host, () => undefined);
    await waitFor(() => fetcher.mock.calls.length === 1);

    const controller = new AbortController();
    const queued = source.refreshResult({ signal: controller.signal });
    controller.abort();
    await expect(queued).resolves.toMatchObject({ status: 'aborted' });
    resolveInitial('initial');
    await flush();
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(source.getState().data).toBe('initial');
    subscription.dispose();
  });
});
