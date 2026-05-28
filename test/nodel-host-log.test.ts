import { flush, waitFor } from './helpers';
import '../src/components/nodel-page';
import '../src/components/nodel-host-log';

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

      if (url === '/REST/logs?from=3&max=9999') {
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
});
