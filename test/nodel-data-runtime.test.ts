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
});
