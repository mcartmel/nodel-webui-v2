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
    let subscription!: ReturnType<typeof source.subscribe>;
    subscription = source.subscribe(createPage(false).host, () => {
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
});
