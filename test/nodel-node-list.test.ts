import { delay, flush, waitFor } from './helpers';
import '../src/components/nodel-node-list';
import '../src/components/nodel-text';
import { generateHostIconDataUri } from '../src/icons/host-identicon';

describe('nodel-node-list', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState(undefined, '', '/');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders the local nodes list with filtering and icons', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/REST') {
        return new Response(JSON.stringify({
          nodes: {
            alpha: { name: 'Alpha Node (Test)' },
            beta: { name: 'Beta Node' }
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const mockedFetch = fetchMock as unknown as ReturnType<typeof vi.fn>;

    vi.stubGlobal('fetch', fetchMock);

    document.body.innerHTML = '<nodel-node-list scope="local" poll-interval="999999" page-size="10"></nodel-node-list>';
    await customElements.whenDefined('nodel-node-list');

    await waitFor(
      () => document.querySelectorAll('nodel-node-list a.nodel-list-item').length === 2,
      { attempts: 20, intervalMs: 25 }
    );

    const links = document.querySelectorAll('nodel-node-list a.nodel-list-item');
    const collection = document.querySelector('nodel-node-list ul.nodel-list.nodel-node-list-items');
    expect(links.length).toBe(2);
    expect(collection?.children).toHaveLength(2);
    expect(Array.from(collection?.children ?? []).every((child) => child.tagName === 'LI')).toBe(true);
    expect(collection?.querySelectorAll('.nodel-list-item-affordance[data-icon="chevron-right"]')).toHaveLength(2);
    expect(collection?.querySelectorAll('.nodel-list-item-affordance[aria-hidden="true"]')).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('/nodes/AlphaNode');
    expect(links[0].textContent).toContain('localhost');
    expect(links[0].querySelector('nodel-host-icon img')?.getAttribute('src')).toBe(
      generateHostIconDataUri(window.location.host)
    );

    const filter = document.querySelector('.nodel-node-list-filter') as HTMLInputElement;
    expect(filter.placeholder).toBe('Filter nodes');
    expect(document.querySelector('.nodel-node-list-show')?.getAttribute('aria-label')).toBe('Rows per page');
    expect(document.querySelector('.nodel-node-list-total')?.textContent).toContain('2 nodes');
    filter.value = 'beta';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.body.textContent).not.toContain('Loading...');
    expect(document.querySelectorAll('nodel-node-list a.nodel-list-item').length).toBe(2);
    await delay(250);
    await flush();
    await flush();

    expect(document.querySelectorAll('nodel-node-list a.nodel-list-item').length).toBe(1);
    expect(document.body.textContent).not.toContain('Loading...');
    expect(document.body.textContent).toContain('Beta Node');

    filter.value = 'missing';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    await delay(250);
    await flush();
    await flush();

    expect(document.querySelectorAll('nodel-node-list a.nodel-list-item')).toHaveLength(0);
    expect(document.querySelector('nodel-node-list .nodel-list')).toBeNull();
    expect(document.querySelector('.nodel-node-list-empty')?.textContent).toBe('No nodes match this filter.');
    expect(document.querySelector('.nodel-node-list-total')?.textContent).toContain('0 nodes');

    document.querySelector('nodel-node-list')?.remove();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('renders a no-nodes state after an empty successful load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(JSON.stringify({ nodes: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }) as never
    )) as unknown as typeof fetch);

    document.body.innerHTML = '<nodel-node-list scope="local" poll-interval="999999"></nodel-node-list>';
    await customElements.whenDefined('nodel-node-list');

    await waitFor(() => document.querySelector('.nodel-node-list-empty') !== null);

    expect(document.querySelector('.nodel-node-list-empty')?.textContent).toBe('No nodes available.');
    expect(document.querySelector('nodel-node-list .nodel-list')).toBeNull();
    expect(document.querySelector('.nodel-node-list-total')?.textContent).toContain('0 nodes');
    expect(document.body.textContent).not.toContain('Loading...');
  });

  it('renders the network list and marks reachability', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/REST/nodeURLs') {
        return new Response(JSON.stringify([
          { address: 'http://alpha:8085/nodes/Alpha/', name: 'Alpha', host: 'alpha:8085' },
          { address: 'http://beta:8085/nodes/Beta/', name: 'Beta', host: 'beta:8085' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      if (url === 'http://alpha:8085/REST') {
        return new Response('', { status: 200 }) as never;
      }

      if (url === 'http://beta:8085/REST') {
        return new Response('', { status: 503 }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const mockedFetch = fetchMock as unknown as ReturnType<typeof vi.fn>;

    vi.stubGlobal('fetch', fetchMock);

    document.body.innerHTML = '<nodel-node-list scope="network" poll-interval="999999" page-size="10"></nodel-node-list>';
    await customElements.whenDefined('nodel-node-list');
    await flush();
    await flush();
    await flush();

    const items = document.querySelectorAll('nodel-node-list a.nodel-list-item');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute('href')).toBe('http://alpha:8085/nodes/Alpha/');
    expect(items[0].className).not.toContain('is-unreachable');
    expect(items[0].getAttribute('data-reachability')).toBe('reachable');
    expect(items[1].className).toContain('is-unreachable');
    expect(items[1].getAttribute('data-reachability')).toBe('unreachable');
    expect(document.querySelectorAll('nodel-node-list .nodel-list > li')).toHaveLength(2);
    expect(document.querySelectorAll('nodel-node-list .nodel-list-item-affordance[data-icon="chevron-right"]')).toHaveLength(2);
    expect(items[0].querySelector('nodel-host-icon img')?.getAttribute('src')).toContain('data:image/svg+xml;base64,');
    expect(items[1].querySelector('nodel-host-icon img')?.getAttribute('src')).toContain('data:image/svg+xml;base64,');

    document.querySelector('nodel-node-list')?.remove();
    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(new URL('http://alpha:8085/REST'), expect.objectContaining({ mode: 'no-cors' }));
  });

  it('limits network reachability probes and expands beyond the visible result window in the background', async () => {
    const entries = Array.from({ length: 25 }, (_, index) => {
      const id = index + 1;
      const label = String(id).padStart(2, '0');
      return { address: `http://host-${id}:8085/nodes/Node${label}/`, name: `Node ${label}`, host: `host-${id}:8085` };
    });
    let activeProbes = 0;
    let maxActiveProbes = 0;
    let visibleProbeCompletions = 0;
    let backgroundStartedBeforeVisibleComplete = false;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/REST/nodeURLs') {
        return Promise.resolve(new Response(JSON.stringify(entries), { status: 200, headers: { 'Content-Type': 'application/json' } })) as never;
      }
      const match = url.match(/^http:\/\/host-(\d+):8085\/REST$/);
      if (!match) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`)) as never;
      }
      const id = Number(match[1]);
      activeProbes += 1;
      maxActiveProbes = Math.max(maxActiveProbes, activeProbes);
      expect(init?.mode).toBe('no-cors');
      if (id > 10 && visibleProbeCompletions < 10) {
        backgroundStartedBeforeVisibleComplete = true;
      }
      if (id <= 10) {
        activeProbes -= 1;
        visibleProbeCompletions += 1;
        return Promise.resolve(new Response('', { status: 200 })) as never;
      }
      return new Promise<Response>((resolve) => {
        init?.signal?.addEventListener('abort', () => {
          activeProbes -= 1;
          resolve(new Response('', { status: 204 }));
        }, { once: true });
      }) as never;
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);
    document.body.innerHTML = '<nodel-node-list scope="network" poll-interval="999999" page-size="10"></nodel-node-list>';
    await customElements.whenDefined('nodel-node-list');
    await waitFor(() => document.querySelectorAll('nodel-node-list a.nodel-list-item').length === 10);

    expect(visibleProbeCompletions).toBe(10);
    expect(backgroundStartedBeforeVisibleComplete).toBe(false);
    expect(maxActiveProbes).toBeLessThanOrEqual(4);
    document.querySelector('nodel-node-list')?.remove();
  });

  it('prefills the network filter from the first configured query value without overwriting later edits', async () => {
    window.history.replaceState(undefined, '', '/nodes.html?filter=Display%20%C3%9Cnit&filter=Ignored#Network');
    const filters: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/REST/nodeURLs') {
        filters.push(JSON.parse(String(init?.body)).filter);
        return new Response(JSON.stringify([
          { address: 'http://display:8085/nodes/DisplayUnit/', name: 'Display Ünit', host: 'display:8085' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === 'http://display:8085/REST') {
        return new Response('', { status: 200 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    document.body.innerHTML = '<nodel-node-list scope="network" query-param="filter" poll-interval="999999"></nodel-node-list>';
    await waitFor(() => filters.length === 1);
    const filter = document.querySelector<HTMLInputElement>('.nodel-node-list-filter')!;
    expect(filter.value).toBe('Display Ünit');
    expect(filters[0]).toBe('Display Ünit');

    filter.value = 'Manual edit';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('nodel-node-list')?.setAttribute('page-size', '10');
    await delay(250);
    await waitFor(() => filters.includes('Manual edit'));

    expect(filter.value).toBe('Manual edit');
    expect(filters).not.toContain('Ignored');
  });

  it('treats an empty configured query value as an empty filter', async () => {
    window.history.replaceState(undefined, '', '/nodes.html?filter=#Network');
    let filter = 'not called';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== '/REST/nodeURLs') {
        throw new Error(`Unexpected fetch: ${String(input)}`);
      }
      filter = JSON.parse(String(init?.body)).filter;
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
    }) as unknown as typeof fetch);

    document.body.innerHTML = '<nodel-node-list scope="network" query-param="filter" poll-interval="999999"></nodel-node-list>';
    await waitFor(() => filter !== 'not called');

    expect(filter).toBe('');
    expect(document.querySelector<HTMLInputElement>('.nodel-node-list-filter')?.value).toBe('');
  });

  it('renders a bounded error instead of an unsafe discovered link', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/REST/nodeURLs') {
        return new Response(JSON.stringify([{ node: 'Unsafe', address: 'javascript:alert(1)' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }) as never;
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    }) as unknown as typeof fetch);

    document.body.innerHTML = '<nodel-node-list scope="network" poll-interval="999999"></nodel-node-list>';
    await waitFor(() => Boolean(document.querySelector('nodel-node-list .nodel-alert-danger')));

    expect(document.querySelectorAll('nodel-node-list a')).toHaveLength(0);
    expect(document.querySelector('nodel-node-list .nodel-alert-danger')?.textContent).toContain('POST /REST/nodeURLs returned invalid data');
    expect(document.querySelector('nodel-node-list .nodel-alert-danger')?.getAttribute('role')).toBe('alert');
    expect(document.body.textContent).not.toContain('javascript:');
  });

  it('relinks and resumes filtering when the same node list reconnects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      nodes: {
        alpha: { name: 'Alpha Node' },
        beta: { name: 'Beta Node' }
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch);
    document.body.innerHTML = '<nodel-node-list scope="local" poll-interval="999999"></nodel-node-list>';
    const list = document.querySelector('nodel-node-list')!;
    await waitFor(() => list.querySelectorAll('.nodel-node-list-item').length === 2);

    list.remove();
    document.body.append(list);
    await waitFor(() => list.querySelectorAll('.nodel-node-list-item').length === 2);
    const filter = list.querySelector<HTMLInputElement>('.nodel-node-list-filter')!;
    filter.value = 'Beta';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    await delay(250);
    await waitFor(() => list.querySelectorAll('.nodel-node-list-item').length === 1);

    expect(list.textContent).toContain('Beta Node');
    expect(list.textContent).not.toContain('Alpha Node');
  });

  it('does not create a source when disconnected before initialization', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    const list = document.createElement('nodel-node-list');
    list.setAttribute('scope', 'local');
    document.body.append(list);
    list.remove();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the load-more action outside the grouped list surface', async () => {
    const nodes = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [`node-${index}`, { name: `Node ${index}` }])
    );
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(JSON.stringify({ nodes }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }) as never
    )) as unknown as typeof fetch);

    document.body.innerHTML = '<nodel-node-list scope="local" poll-interval="999999" page-size="10"></nodel-node-list>';
    await customElements.whenDefined('nodel-node-list');
    await waitFor(() => document.querySelectorAll('nodel-node-list .nodel-list > li').length === 10);

    const collection = document.querySelector('nodel-node-list .nodel-list');
    const loadMore = document.querySelector<HTMLButtonElement>('.nodel-node-list-more');
    expect(loadMore).not.toBeNull();
    expect(collection?.contains(loadMore)).toBe(false);
  });

  it('caps retained node-list rows before pagination', async () => {
    const nodes = Object.fromEntries(
      Array.from({ length: 1200 }, (_, index) => [`node-${index}`, { name: `Node ${String(index).padStart(4, '0')}` }])
    );
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(JSON.stringify({ nodes }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }) as never
    )) as unknown as typeof fetch);

    document.body.innerHTML = '<nodel-node-list scope="local" poll-interval="999999" page-size="10"></nodel-node-list>';
    await customElements.whenDefined('nodel-node-list');
    await waitFor(() => document.querySelectorAll('nodel-node-list .nodel-list > li').length === 10);

    expect(document.querySelectorAll('nodel-node-list .nodel-list > li')).toHaveLength(10);
    expect(document.querySelector('.nodel-node-list-total')?.textContent).toContain('1000 nodes');
    expect(document.querySelector('.nodel-node-list-more')).not.toBeNull();
  });

  it('pauses local polling while hidden and resumes when visible', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/REST') {
        return new Response(JSON.stringify({
          nodes: {
            alpha: { name: 'Alpha Node' }
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const mockedFetch = fetchMock as unknown as ReturnType<typeof vi.fn>;

    vi.stubGlobal('fetch', fetchMock);

    document.body.innerHTML = '<nodel-page hidden><nodel-node-list scope="local" poll-interval="999999"></nodel-node-list></nodel-page>';
    await customElements.whenDefined('nodel-node-list');
    await flush();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();

    document.querySelector('nodel-page')?.removeAttribute('hidden');

    await waitFor(() => mockedFetch.mock.calls.length > 0, { attempts: 20, intervalMs: 25 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('Alpha Node');
  });

  it('does not poll the network list while hidden', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/REST/nodeURLs') {
        return new Response(JSON.stringify([
          { address: 'http://alpha:8085/nodes/Alpha/', name: 'Alpha', host: 'alpha:8085' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      if (url === '//alpha:8085/REST') {
        return new Response('', { status: 200 }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const mockedFetch = fetchMock as unknown as ReturnType<typeof vi.fn>;

    vi.stubGlobal('fetch', fetchMock);

    document.body.innerHTML = '<nodel-page hidden><nodel-node-list scope="network" poll-interval="999999"></nodel-node-list></nodel-page>';
    await customElements.whenDefined('nodel-node-list');
    await flush();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();

    document.querySelector('nodel-page')?.removeAttribute('hidden');

    await waitFor(
      () => document.querySelectorAll('nodel-node-list a.nodel-list-item').length === 1,
      { attempts: 20, intervalMs: 25 }
    );

    expect(fetchMock).toHaveBeenCalledWith('/REST/nodeURLs', expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(new URL('http://alpha:8085/REST'), expect.anything());
    expect(document.body.textContent).toContain('Alpha');
  });
});
