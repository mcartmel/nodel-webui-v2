import '../src/components/nodel-toolbar';

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) {
      return;
    }

    await flush();
  }

  throw new Error('Timed out waiting for toolbar state');
}

describe('nodel-toolbar', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState(undefined, '', '/');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('defaults to no visible title on host pages', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    document.body.innerHTML = '<nodel-toolbar icon-src="./v2/img/logo.png"></nodel-toolbar>';
    await customElements.whenDefined('nodel-toolbar');
    await flush();

    const title = document.querySelector('[data-toolbar-title]') as HTMLElement | null;
    const icon = document.querySelector('[data-toolbar-icon]') as HTMLImageElement | null;

    expect(title?.hidden).toBe(true);
    expect(title?.textContent).toBe('');
    expect(icon?.alt).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults to the node display name on node pages', async () => {
    window.history.replaceState(undefined, '', '/nodes/NodelRecipesSyncforTRANSCENDENCE8085/nodel.html');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'REST/') {
        return new Response(JSON.stringify({
          name: 'Nodel Recipes Sync for TRANSCENDENCE 8085'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    document.body.innerHTML = '<nodel-toolbar icon-src="./v2/img/logo.png"></nodel-toolbar>';
    await customElements.whenDefined('nodel-toolbar');

    await waitFor(() => document.querySelector('[data-toolbar-title]')?.textContent === 'Nodel Recipes Sync for TRANSCENDENCE 8085');

    const title = document.querySelector('[data-toolbar-title]') as HTMLElement | null;
    const icon = document.querySelector('[data-toolbar-icon]') as HTMLImageElement | null;

    expect(title?.hidden).toBe(false);
    expect(icon?.alt).toBe('Nodel Recipes Sync for TRANSCENDENCE 8085');
    expect(fetchMock).toHaveBeenCalledWith('REST/');
  });

  it('uses an explicit title instead of fetching a node default', async () => {
    window.history.replaceState(undefined, '', '/nodes/TestUI/nodel.html');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    document.body.innerHTML = '<nodel-toolbar title="Explicit" icon-src="./v2/img/logo.png"></nodel-toolbar>';
    await customElements.whenDefined('nodel-toolbar');
    await flush();

    const title = document.querySelector('[data-toolbar-title]') as HTMLElement | null;
    const icon = document.querySelector('[data-toolbar-icon]') as HTMLImageElement | null;

    expect(title?.hidden).toBe(false);
    expect(title?.textContent).toBe('Explicit');
    expect(icon?.alt).toBe('Explicit');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
