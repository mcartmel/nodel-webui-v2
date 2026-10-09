import { flush, waitFor } from './helpers';
import { rapidReconnect } from './lifecycle-helpers';
import '../src/components/nodel-page';
import '../src/components/nodel-host-log';
import '../src/components/nodel-collapse';

describe('nodel-host-log', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('loads initial host logs, appends incremental logs, and caps rows', async () => {
    const initial = [
      { seq: 2, timestamp: '2026-01-01T00:00:02Z', level: 'WARN', thread: 'main', tag: 'Host', message: 'Second' },
      { seq: 1, timestamp: '2026-01-01T00:00:01Z', level: 'INFO', thread: 'main', tag: 'Host', message: 'First' }
    ];
    const many = Array.from({ length: 205 }, (_, index) => ({
      seq: index + 3,
      timestamp: '2026-01-01T00:01:00Z',
      level: 'INFO',
      thread: 'worker',
      tag: 'Bulk',
      message: `Entry ${index + 3}`
    })).reverse();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/REST/logs?from=-1&max=200') {
        return new Response(JSON.stringify(initial), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }) as never;
      }

      if (url === '/REST/logs?from=3&max=200') {
        return new Response(JSON.stringify(many), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }) as never;
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);
    document.body.innerHTML = '<nodel-host-log></nodel-host-log>';
    await customElements.whenDefined('nodel-host-log');

    await waitFor(() => document.body.textContent?.includes('Second') ?? false);
    expect(document.body.textContent).toMatch(/First[\s\S]*Second/);
    expect(document.querySelector('nodel-host-log')?.getAttribute('data-state')).toBe('active');
    expect(document.body.textContent).not.toContain('Host log polling active');
    expect(document.querySelector('.nodel-host-log-status')).toBeNull();

    await ((document.querySelector('nodel-host-log') as unknown as { source: { refresh: () => Promise<void> } }).source.refresh());
    await waitFor(() => document.body.textContent?.includes('Entry 207') ?? false);

    const rows = document.querySelectorAll('.nodel-host-log-line');
    expect(rows.length).toBe(200);
    expect(document.body.textContent).not.toContain('First');
    expect(document.body.textContent).toContain('Entry 207');
  });

  it('displays the local date and time in rows and collapsed previews', async () => {
    const timestamp = '2026-01-01T00:00:01Z';
    const expectedDisplayTime = new Date(timestamp).toLocaleString();
    const sameTimeDifferentDate = '2026-01-02T00:00:01Z';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { seq: 2, timestamp: sameTimeDifferentDate, level: 'INFO', message: 'second date' },
      { seq: 1, timestamp, level: 'INFO', message: 'first date' }
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch);
    document.body.innerHTML = '<nodel-collapse><nodel-host-log></nodel-host-log></nodel-collapse>';

    const collapse = document.querySelector('nodel-collapse')!;
    const hostLog = document.querySelector('nodel-host-log')!;
    await waitFor(() => hostLog.querySelectorAll('.nodel-host-log-line').length === 2);

    const timestamps = Array.from(hostLog.querySelectorAll('.nodel-host-log-timestamp'), (element) => element.textContent);
    expect(timestamps).toEqual([
      new Date(timestamp).toLocaleString(),
      new Date(sameTimeDifferentDate).toLocaleString()
    ]);
    expect(timestamps[0]).toBe(expectedDisplayTime);
    expect(timestamps[0]).not.toBe(timestamps[1]);
    await waitFor(() => collapse.textContent?.includes(`${new Date(sameTimeDifferentDate).toLocaleString()} INFO: second date`) ?? false);
  });

  it('updates a closed parent preview from newest retained entry and supports opt-out', async () => {
    let batch = [{ seq: 1, timestamp: '2026-01-01T00:00:01Z', level: 'WARN', message: 'first' }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(batch), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch);
    document.body.innerHTML = '<nodel-collapse label="Host log"><nodel-host-log></nodel-host-log></nodel-collapse>';
    const collapse = document.querySelector('nodel-collapse')!;
    const hostLog = document.querySelector('nodel-host-log')! as HTMLElement & { source: { refresh: () => Promise<void> } };
    await waitFor(() => collapse.textContent?.includes('WARN: first') ?? false);
    expect(collapse.querySelector('details')?.open).toBe(false);
    batch = [{ seq: 3, timestamp: '2026-01-01T00:00:03Z', level: 'ERROR', message: '<img>\nnext' }, { seq: 2, timestamp: '2026-01-01T00:00:02Z', level: 'INFO', message: 'middle' }];
    await hostLog.source.refresh();
    await waitFor(() => collapse.textContent?.includes('ERROR: <img> next') ?? false);
    expect(collapse.querySelector('img')).toBeNull();
    hostLog.setAttribute('collapse-preview', 'none');
    await waitFor(() => !collapse.textContent?.includes('ERROR: <img> next'));
    hostLog.setAttribute('collapse-preview', 'last-line');
    await waitFor(() => collapse.textContent?.includes('ERROR: <img> next') ?? false);
  });

  it('distinguishes pending, confirmed empty, paused, and failed preview states', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done; })) as unknown as typeof fetch);
    document.body.innerHTML = '<nodel-collapse><nodel-host-log></nodel-host-log></nodel-collapse>';
    const collapse = document.querySelector('nodel-collapse')!;
    await waitFor(() => collapse.textContent?.includes('Loading host log') ?? false);
    resolve(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await waitFor(() => collapse.textContent?.includes('No host log entries yet') ?? false);
  });

  it('keeps a static preview when opted out initially and publishes blank messages as plain text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { seq: 1, timestamp: '2026-01-01T00:00:01Z', level: 'INFO', message: '  \n  ' }
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch);
    document.body.innerHTML = '<nodel-collapse preview="Static summary"><nodel-host-log collapse-preview="none"></nodel-host-log></nodel-collapse>';
    const collapse = document.querySelector('nodel-collapse')!;
    const hostLog = document.querySelector('nodel-host-log')!;
    const previews: Array<{ source: string; text: string }> = [];
    hostLog.addEventListener('nodel-collapse-preview', (event) => previews.push((event as CustomEvent<{ source: string; text: string }>).detail));
    await waitFor(() => hostLog.querySelector('.nodel-host-log-line') !== null);
    expect(collapse.textContent).toContain('Static summary');
    expect(previews).toEqual([]);
    hostLog.setAttribute('collapse-preview', 'last-line');
    await waitFor(() => collapse.textContent?.includes('(no message)') ?? false);
    expect(previews.at(-1)).toMatchObject({ source: 'host-log' });
    expect(previews.at(-1)?.text).toMatch(/ INFO: \(no message\)$/);
  });

  it('replays the current preview when a connected host log receives a new parent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { seq: 1, timestamp: '2026-01-01T00:00:01Z', level: 'INFO', message: 'replayed' }
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch);
    document.body.innerHTML = '<nodel-collapse><nodel-host-log></nodel-host-log></nodel-collapse>';
    const hostLog = document.querySelector('nodel-host-log')!;
    await waitFor(() => document.querySelector('nodel-collapse')?.textContent?.includes('replayed') ?? false);
    const newParent = document.createElement('nodel-collapse');
    document.querySelector('nodel-collapse')!.replaceWith(newParent);
    newParent.append(hostLog);
    await waitFor(() => newParent.textContent?.includes('replayed') ?? false);
  });

  it('clears and republishes a failed initialization preview when the attribute changes', async () => {
    const collapse = document.createElement('nodel-collapse');
    collapse.setAttribute('preview', 'Static summary');
    const hostLog = document.createElement('nodel-host-log') as HTMLElement & { linkController: { link: () => Promise<boolean> } };
    collapse.append(hostLog);
    hostLog.linkController = { link: () => Promise.reject(new Error('link failed')) };
    document.body.append(collapse);
    await waitFor(() => collapse.textContent?.includes('Host log unavailable') ?? false);
    hostLog.setAttribute('collapse-preview', 'none');
    await waitFor(() => collapse.querySelector<HTMLElement>('[data-collapse-preview]')?.hidden ?? false);
    hostLog.setAttribute('collapse-preview', 'last-line');
    await waitFor(() => collapse.textContent?.includes('Host log unavailable') ?? false);
  });

  it('replays a failed initialization preview when reconnected to a new parent', async () => {
    const collapse = document.createElement('nodel-collapse');
    const hostLog = document.createElement('nodel-host-log') as HTMLElement & { linkController: { link: () => Promise<boolean> } };
    const link = vi.fn(() => Promise.reject(new Error('link failed')));
    hostLog.linkController = { link };
    const previews: Array<{ source: string; text: string }> = [];
    hostLog.addEventListener('nodel-collapse-preview', (event) => previews.push((event as CustomEvent<{ source: string; text: string }>).detail));
    collapse.append(hostLog);
    document.body.append(collapse);
    await waitFor(() => collapse.querySelector('[data-collapse-preview]')?.textContent === 'Host log unavailable');
    const initialLinkCount = link.mock.calls.length;

    const newParent = document.createElement('nodel-collapse');
    collapse.replaceWith(newParent);
    newParent.querySelector('[data-collapse-content]')!.append(hostLog);
    await waitFor(() => newParent.querySelector('[data-collapse-preview]')?.textContent === 'Host log unavailable');

    expect(link).toHaveBeenCalledTimes(initialLinkCount + 1);
    expect(previews).toEqual([
      { source: 'host-log', text: 'Host log unavailable' },
      { source: 'host-log', text: 'Host log unavailable' }
    ]);
    hostLog.setAttribute('collapse-preview', 'last-line');
    expect(previews).toHaveLength(2);
  });

  it('does not publish failed initialization previews for disconnected attribute changes', async () => {
    const hostLog = document.createElement('nodel-host-log') as HTMLElement & { linkController: { link: () => Promise<boolean> } };
    hostLog.linkController = { link: () => Promise.reject(new Error('link failed')) };
    const preview = vi.fn();
    hostLog.addEventListener('nodel-collapse-preview', preview);
    document.body.append(hostLog);
    await waitFor(() => preview.mock.calls.length === 1);

    hostLog.remove();
    hostLog.setAttribute('collapse-preview', 'none');
    hostLog.setAttribute('collapse-preview', 'last-line');
    hostLog.removeAttribute('collapse-preview');
    await flush();

    expect(preview).toHaveBeenCalledOnce();
  });

  it('renders an error state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response('', { status: 500, statusText: 'Server Error' }) as never
    )) as unknown as typeof fetch);

    document.body.innerHTML = '<nodel-host-log></nodel-host-log>';
    await customElements.whenDefined('nodel-host-log');
    await waitFor(() => document.querySelector('nodel-host-log')?.getAttribute('data-state') === 'error');

    expect(document.body.textContent).toContain('500 Server Error');
    expect(document.querySelector('.nodel-alert-danger')).not.toBeNull();
  });

  it('renders hostile host-log text as text rather than markup', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { seq: 1, timestamp: '2026-01-01T00:00:01Z', message: '<img src=x onerror=alert(1)>', error: '<script>bad()</script>' }
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch);
    document.body.innerHTML = '<nodel-host-log></nodel-host-log>';
    await waitFor(() => document.body.textContent?.includes('<img src=x onerror=alert(1)>') ?? false);

    const hostLog = document.querySelector('nodel-host-log')!;
    expect(hostLog.querySelector('img, script:not([type^="jsv"])')).toBeNull();
    expect(hostLog.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('waits for the page to become visible before fetching', async () => {
    const fetchMock = vi.fn(async () => (
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }) as never
    )) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);
    document.body.innerHTML = '<nodel-page hidden><nodel-host-log></nodel-host-log></nodel-page>';
    await customElements.whenDefined('nodel-host-log');
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();

    document.querySelector('nodel-page')?.removeAttribute('hidden');
    await waitFor(() => (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length === 1);

    expect(fetchMock).toHaveBeenCalledWith('/REST/logs?from=-1&max=200', expect.any(Object));
  });

  it('does not let an abort-ignoring stale fetch advance the reconnect cursor', async () => {
    let resolveFirst!: (response: Response) => void;
    const urls: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (urls.length === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify(url.includes('from=2') ? [] : [
        { seq: 1, timestamp: '2026-01-01T00:00:01Z', level: 'INFO', message: 'Current' }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    const hostLog = document.createElement('nodel-host-log');
    document.body.append(hostLog);
    await waitFor(() => urls.length === 1);

    hostLog.remove();
    document.body.append(hostLog);
    await waitFor(() => urls.length === 2);
    resolveFirst(new Response(JSON.stringify([
      { seq: 100, timestamp: '2026-01-01T00:01:40Z', level: 'INFO', message: 'Stale' }
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await waitFor(() => hostLog.textContent?.includes('Current') ?? false);

    await ((hostLog as unknown as { source: { refresh: () => Promise<void> } }).source.refresh());
    expect(urls.at(-1)).toBe('/REST/logs?from=2&max=200');
    expect(hostLog.textContent).not.toContain('Stale');
  });

  it('keeps one current poll path through rapid reconnects', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    const hostLog = document.createElement('nodel-host-log');
    document.body.append(hostLog);
    await waitFor(() => (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length === 1);
    let reconnects = 0;
    await rapidReconnect(hostLog, async () => {
      reconnects += 1;
      await waitFor(() => (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length === reconnects + 1);
    });

    expect((fetchMock as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(4);
    expect(hostLog.querySelectorAll('[data-host-log-output]')).toHaveLength(1);
  });

  it('does not let a disposed pending poll update a fresh host-log instance', async () => {
    let resolveStale!: (response: Response) => void;
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise<Response>((resolve) => {
          resolveStale = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify([
        { seq: 1, timestamp: '2026-01-01T00:00:01Z', level: 'INFO', message: 'Current' }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    const oldHostLog = document.createElement('nodel-host-log');
    document.body.append(oldHostLog);
    await waitFor(() => calls === 1);
    oldHostLog.remove();

    const freshHostLog = document.createElement('nodel-host-log');
    document.body.append(freshHostLog);
    await waitFor(() => freshHostLog.textContent?.includes('Current') ?? false);
    resolveStale(new Response(JSON.stringify([
      { seq: 100, timestamp: '2026-01-01T00:01:40Z', level: 'INFO', message: 'Stale' }
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await flush();

    expect(oldHostLog.textContent).not.toContain('Stale');
    expect(freshHostLog.textContent).toContain('Current');
    expect(freshHostLog.textContent).not.toContain('Stale');
  });
});
