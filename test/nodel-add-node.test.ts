import '../src/components/nodel-add-node';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('nodel-add-node', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState(undefined, '', '/');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('creates a node from a recipe path', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });

      if (url === '/REST/recipes/list') {
        return new Response(JSON.stringify([{ path: 'Recipes/Starter' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      if (url === '/REST/nodeURLs') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      if (url === '/REST/newNode') {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);

    document.body.innerHTML = '<nodel-add-node redirect="false"></nodel-add-node>';
    await customElements.whenDefined('nodel-add-node');
    await flush();

    const toggle = document.querySelector('.nodel-add-node-toggle') as HTMLButtonElement;
    toggle.click();
    await flush();

    const nameInput = document.querySelector('.nodel-add-node-name') as HTMLInputElement;
    const templateInput = document.querySelector('.nodel-add-node-template') as HTMLInputElement;
    nameInput.value = 'My Test Node';
    templateInput.value = 'Recipes/Starter';

    const form = document.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    await flush();

    const postCall = calls.find((call) => call.url === '/REST/newNode');
    expect(postCall).toBeDefined();
    expect(postCall?.init?.method).toBe('POST');
    expect(String(postCall?.init?.body)).toContain('My Test Node');
    expect(String(postCall?.init?.body)).toContain('Recipes/Starter');
    expect(document.body.textContent).toContain('Node created');
  });
});
