import '../src/components/nodel-diagnostics';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForDiagnostics() {
  await customElements.whenDefined('nodel-diagnostics');
  for (let i = 0; i < 20; i += 1) {
    if (!document.body.textContent?.includes('Loading diagnostics...')) {
      return;
    }
    await flush();
  }
}

describe('nodel-diagnostics', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders the diagnostics table with build links', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/REST/diagnostics') {
        return new Response(JSON.stringify({
          hostname: 'host-one',
          httpAddresses: ['http://host-one:8085', 'http://192.168.1.10:8085'],
          uptime: 3723000,
          startTime: '2026-04-26T09:00:00Z',
          hostPath: '/opt/nodel',
          nodesRoot: '/opt/nodel/nodes',
          hostingRule: 'allow all',
          agent: 'nodel-agent'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      if (url === '/build.json') {
        return new Response(JSON.stringify({
          version: '0.1.0',
          date: '2026-04-20T10:30:00Z',
          host: 'builder',
          origin: 'https://example.com/nodel',
          branch: 'main',
          id: 'abc123'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const mockedFetch = fetchMock as unknown as ReturnType<typeof vi.fn>;

    vi.stubGlobal('fetch', fetchMock);
    document.body.innerHTML = '<nodel-diagnostics></nodel-diagnostics>';
    await waitForDiagnostics();

    const table = document.querySelector('nodel-diagnostics table');
    const links = document.querySelectorAll('nodel-diagnostics a');

    expect(table).not.toBeNull();
    expect(document.body.textContent).toContain('Release');
    expect(document.body.textContent).toContain('0.1.0');
    expect(document.body.textContent).toContain('host-one');
    expect(document.body.textContent).toContain('http://host-one:8085');
    expect(document.body.textContent).toContain('/opt/nodel/nodes');
    expect(document.body.textContent).toContain('nodel-agent');
    expect(Array.from(links).map((link) => link.getAttribute('href'))).toEqual(expect.arrayContaining([
      'https://example.com/nodel',
      'https://example.com/nodel/tree/main',
      'https://example.com/nodel/commit/abc123'
    ]));
  });

  it('renders diagnostics when build metadata is unavailable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/REST/diagnostics') {
        return new Response(JSON.stringify({ hostname: 'host-two' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }) as never;
      }

      if (url === '/build.json') {
        return new Response('', { status: 404, statusText: 'Not Found' }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const mockedFetch = fetchMock as unknown as ReturnType<typeof vi.fn>;

    vi.stubGlobal('fetch', fetchMock);
    document.body.innerHTML = '<nodel-diagnostics></nodel-diagnostics>';
    await waitForDiagnostics();

    expect(document.querySelector('nodel-diagnostics table')).not.toBeNull();
    expect(document.body.textContent).toContain('host-two');
    expect(document.body.textContent).toContain('Unavailable');
  });

  it('renders an error when diagnostics cannot load', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/REST/diagnostics') {
        return new Response('', { status: 500, statusText: 'Server Error' }) as never;
      }

      if (url === '/build.json') {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const mockedFetch = fetchMock as unknown as ReturnType<typeof vi.fn>;

    vi.stubGlobal('fetch', fetchMock);
    document.body.innerHTML = '<nodel-diagnostics></nodel-diagnostics>';
    await waitForDiagnostics();

    expect(document.querySelector('nodel-diagnostics table')).toBeNull();
    expect(document.body.textContent).toContain('500 Server Error');
  });

  it('waits for the page to become visible before fetching', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/REST/diagnostics') {
        return new Response(JSON.stringify({ hostname: 'host-hidden' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }) as never;
      }

      if (url === '/build.json') {
        return new Response(JSON.stringify({ version: 'hidden' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const mockedFetch = fetchMock as unknown as ReturnType<typeof vi.fn>;

    vi.stubGlobal('fetch', fetchMock);
    document.body.innerHTML = '<nodel-page hidden><nodel-diagnostics></nodel-diagnostics></nodel-page>';
    await waitForDiagnostics();

    expect(fetchMock).not.toHaveBeenCalled();

    document.querySelector('nodel-page')?.removeAttribute('hidden');

    for (let i = 0; i < 20; i += 1) {
      if (mockedFetch.mock.calls.length > 0) {
        break;
      }
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('host-hidden');
    expect(document.body.textContent).toContain('hidden');
  });

  it('refetches after an initial visible fetch is aborted by page hiding', async () => {
    let diagnosticsCalls = 0;
    let buildCalls = 0;

    function abortable(signal?: AbortSignal) {
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === '/REST/diagnostics') {
        diagnosticsCalls += 1;
        if (diagnosticsCalls === 1) {
          return abortable(init?.signal ?? undefined) as never;
        }

        return new Response(JSON.stringify({ hostname: 'host-resumed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }) as never;
      }

      if (url === '/build.json') {
        buildCalls += 1;
        if (buildCalls === 1) {
          return abortable(init?.signal ?? undefined) as never;
        }

        return new Response(JSON.stringify({ version: 'resumed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);
    document.body.innerHTML = '<nodel-page><nodel-diagnostics></nodel-diagnostics></nodel-page>';
    await customElements.whenDefined('nodel-diagnostics');
    await flush();

    expect(diagnosticsCalls).toBe(1);
    expect(buildCalls).toBe(1);

    document.querySelector('nodel-page')?.setAttribute('hidden', '');
    await flush();
    document.querySelector('nodel-page')?.removeAttribute('hidden');

    for (let i = 0; i < 20; i += 1) {
      if (document.body.textContent?.includes('host-resumed')) {
        break;
      }
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(diagnosticsCalls).toBe(2);
    expect(buildCalls).toBe(2);
    expect(document.body.textContent).toContain('host-resumed');
    expect(document.body.textContent).toContain('resumed');
  });
});
