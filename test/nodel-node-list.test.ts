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
      () => document.querySelectorAll('nodel-node-list a.list-group-item').length === 2,
      { attempts: 20, intervalMs: 25 }
    );

    const links = document.querySelectorAll('nodel-node-list a.list-group-item');
    expect(links.length).toBe(2);
    expect(links[0].getAttribute('href')).toBe('/nodes/AlphaNode');
    expect(links[0].textContent).toContain('localhost');
    expect(links[0].querySelector('nodel-host-icon img')?.getAttribute('src')).toBe(
      generateHostIconDataUri(window.location.host)
    );

    const filter = document.querySelector('.nodel-node-list-filter') as HTMLInputElement;
    filter.value = 'beta';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.body.textContent).not.toContain('Loading...');
    expect(document.querySelectorAll('nodel-node-list a.list-group-item').length).toBe(2);
    await delay(250);
    await flush();
    await flush();

    expect(document.querySelectorAll('nodel-node-list a.list-group-item').length).toBe(1);
    expect(document.body.textContent).not.toContain('Loading...');
    expect(document.body.textContent).toContain('Beta Node');

    document.querySelector('nodel-node-list')?.remove();
    expect(fetchMock).toHaveBeenCalled();
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

      if (url === '//alpha:8085/REST') {
        return new Response('', { status: 200 }) as never;
      }

      if (url === '//beta:8085/REST') {
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

    const items = document.querySelectorAll('nodel-node-list a.list-group-item');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute('href')).toBe('http://alpha:8085/nodes/Alpha/');
    expect(items[0].className).not.toContain('is-unreachable');
    expect(items[1].className).toContain('is-unreachable');
    expect(items[0].querySelector('nodel-host-icon img')?.getAttribute('src')).toContain('data:image/svg+xml;base64,');
    expect(items[1].querySelector('nodel-host-icon img')?.getAttribute('src')).toContain('data:image/svg+xml;base64,');

    document.querySelector('nodel-node-list')?.remove();
    expect(fetchMock).toHaveBeenCalled();
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
      () => document.querySelectorAll('nodel-node-list a.list-group-item').length === 1,
      { attempts: 20, intervalMs: 25 }
    );

    expect(fetchMock).toHaveBeenCalledWith('/REST/nodeURLs', expect.anything());
    expect(fetchMock).toHaveBeenCalledWith('//alpha:8085/REST', expect.anything());
    expect(document.body.textContent).toContain('Alpha');
  });
});
