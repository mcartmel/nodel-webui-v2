import { flush, waitFor } from './helpers';
import '../src/components/nodel-add-node';

async function openAddNodePanel(markup = '<nodel-add-node redirect="false"></nodel-add-node>') {
  document.body.innerHTML = markup;
  await customElements.whenDefined('nodel-add-node');
  await waitFor(() => Boolean(document.querySelector('.nodel-add-node-toggle')));

  const toggle = document.querySelector('.nodel-add-node-toggle') as HTMLButtonElement;
  toggle.click();
  await flush();
}

async function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await flush();
}

async function pressKey(input: HTMLInputElement, key: string) {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await flush();
}

function stubAddNodeLookups(recipes: unknown[] = [], nodes: unknown[] = []) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url === '/REST/recipes/list') {
      return new Response(JSON.stringify(recipes), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
    }

    if (url === '/REST/nodeURLs') {
      return new Response(JSON.stringify(nodes), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;

  vi.stubGlobal('fetch', fetchMock);
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

      if (url === '/nodes/MyTestNode/REST/') {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);

    await openAddNodePanel();

    const nameInput = document.querySelector('.nodel-add-node-name') as HTMLInputElement;
    const templateInput = document.querySelector('.nodel-add-node-template') as HTMLInputElement;
    await setInputValue(nameInput, 'My Test Node');
    await setInputValue(templateInput, 'Recipes/Starter');

    const form = document.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    await flush();

    const postCall = calls.find((call) => call.url === '/REST/newNode');
    expect(postCall).toBeDefined();
    expect(postCall?.init?.method).toBe('POST');
    expect(String(postCall?.init?.body)).toContain('My Test Node');
    expect(String(postCall?.init?.body)).toContain('Recipes/Starter');
    expect(calls.some((call) => call.url === '/nodes/MyTestNode/REST/')).toBe(true);
    expect(document.body.textContent).toContain('Node created');
  });

  it('shows the server message when a node name already exists', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/REST/recipes/list') {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      if (url === '/REST/newNode') {
        return new Response(JSON.stringify({ message: "A node with the name 'Existing Node' already exists." }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'application/json' }
        }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);
    await openAddNodePanel();

    const errorListener = vi.fn();
    document.querySelector('nodel-add-node')?.addEventListener('nodel-add-node-error', errorListener);
    const nameInput = document.querySelector('.nodel-add-node-name') as HTMLInputElement;
    await setInputValue(nameInput, 'Existing Node');
    document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => Boolean(document.querySelector('.nodel-add-node-error')));

    const error = document.querySelector('.nodel-add-node-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain("A node with the name 'Existing Node' already exists.");
    expect(error?.textContent).not.toContain('500');
    expect(document.querySelector('.nodel-add-node-panel')?.classList.contains('hidden')).toBe(false);
    expect((document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    expect(errorListener).toHaveBeenCalledWith(expect.objectContaining({
      detail: {
        error: "A node with the name 'Existing Node' already exists.",
        name: 'Existing Node'
      }
    }));
  });

  it('selects a recipe template autocomplete result with the keyboard', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/REST/recipes/list') {
        return new Response(JSON.stringify([{ path: 'Recipes/Starter' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      if (url === '/REST/nodeURLs') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);
    await openAddNodePanel();

    const templateInput = document.querySelector('.nodel-add-node-template') as HTMLInputElement;
    await setInputValue(templateInput, 'Starter');
    await waitFor(() => document.querySelectorAll('.nodel-template-autocomplete .nodel-menu-item').length === 1, {
      attempts: 80,
      intervalMs: 5
    });
    expect(document.querySelector('.nodel-template-autocomplete .nodel-add-node-result-secondary')?.textContent).toBeTruthy();

    await pressKey(templateInput, 'ArrowDown');
    expect(document.querySelector('.nodel-template-autocomplete .nodel-menu-item')?.classList.contains('nodel-menu-item-active')).toBe(true);
    await pressKey(templateInput, 'Enter');

    expect(templateInput.value).toBe('Recipes/Starter');
    expect(document.body.textContent).toContain('Recipe: Recipes/Starter');
    expect(document.querySelector('.nodel-template-autocomplete')?.classList.contains('hidden')).toBe(true);
  });

  it('selects a duplicate node autocomplete result with the keyboard', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);

      if (url === '/REST/recipes/list') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      if (url === '/REST/nodeURLs') {
        return new Response(JSON.stringify([{ node: 'Existing Node', address: 'http://host/nodes/Existing%20Node/', host: 'host' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      if (url === 'http://host/nodes/Existing%20Node/REST/files') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      if (url === '/REST/newNode') {
        expect(init?.method).toBe('POST');
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      if (url.endsWith('/nodes/MyCopy/REST/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);
    await openAddNodePanel('<nodel-add-node redirect="false" duplicate="true"></nodel-add-node>');

    const nameInput = document.querySelector('.nodel-add-node-name') as HTMLInputElement;
    const templateInput = document.querySelector('.nodel-add-node-template') as HTMLInputElement;
    await setInputValue(nameInput, 'My Copy');
    await setInputValue(templateInput, 'Existing');
    await waitFor(() => document.querySelectorAll('.nodel-template-autocomplete .nodel-menu-item').length === 1, {
      attempts: 80,
      intervalMs: 5
    });

    await pressKey(templateInput, 'ArrowDown');
    await pressKey(templateInput, 'Enter');

    expect(templateInput.value).toBe('Existing Node');
    expect(document.body.textContent).toContain('Node: Existing Node');

    document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => calls.includes('/REST/newNode'), {
      attempts: 80,
      intervalMs: 5
    });
    await waitFor(() => document.body.textContent?.includes('Node created'), {
      attempts: 80,
      intervalMs: 5
    });

    expect(calls).toContain('http://host/nodes/Existing%20Node/REST/files');
    expect(calls).toContain('/REST/newNode');
  });

  it('shows duplicate-only configuration choice and reports current file progress', async () => {
    let releaseContents: (() => void) | undefined;
    const contentsReady = new Promise<void>((resolve) => {
      releaseContents = resolve;
    });
    const saves: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/REST/recipes/list') {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/nodeURLs') {
        return new Response(JSON.stringify([{ node: 'Existing Node', address: 'http://host/nodes/Existing%20Node/', host: 'host' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === 'http://host/nodes/Existing%20Node/REST/files') {
        return new Response(JSON.stringify([{ path: 'payload.bin' }, { path: 'nodeConfig.json' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode' || url.endsWith('/nodes/ConfiguredCopy/REST/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url.includes('http://host/nodes/Existing%20Node/REST/files/contents?path=')) {
        if (url.endsWith('payload.bin')) {
          await contentsReady;
        }
        return new Response(Uint8Array.from([0, 255, 1]), { status: 200 }) as never;
      }
      if (url.includes('/nodes/ConfiguredCopy/REST/files/save?path=')) {
        saves.push(decodeURIComponent(url.split('path=')[1]));
        expect(Object.prototype.toString.call(init?.body)).toBe('[object ArrayBuffer]');
        return new Response('{}', { status: 200 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);
    await openAddNodePanel('<nodel-add-node redirect="false"></nodel-add-node>');
    expect(document.querySelector('[data-add-node-copy-config]')).toBeNull();

    const nameInput = document.querySelector('.nodel-add-node-name') as HTMLInputElement;
    const templateInput = document.querySelector('.nodel-add-node-template') as HTMLInputElement;
    await setInputValue(nameInput, 'Configured Copy');
    await setInputValue(templateInput, 'Existing');
    await waitFor(() => document.querySelectorAll('.nodel-template-autocomplete .nodel-menu-item').length === 1, { attempts: 80, intervalMs: 5 });
    await pressKey(templateInput, 'ArrowDown');
    await pressKey(templateInput, 'Enter');

    const copyConfig = document.querySelector('[data-add-node-copy-config]') as HTMLInputElement;
    expect(copyConfig).not.toBeNull();
    expect(copyConfig.checked).toBe(false);
    expect(document.body.textContent).toContain('environment-specific settings');
    copyConfig.click();
    expect(copyConfig.checked).toBe(true);

    document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => document.querySelector('.nodel-add-node-status')?.textContent?.includes('Copying payload.bin') === true, { attempts: 80, intervalMs: 5 });
    expect(document.body.textContent).toContain('Node: Existing Node');
    releaseContents?.();
    await waitFor(() => document.body.textContent?.includes('Node created') === true, { attempts: 80, intervalMs: 5 });

    expect(saves).toEqual(['payload.bin', 'nodeConfig.json']);
    expect(document.querySelector('.nodel-add-node-panel')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector<HTMLAnchorElement>('.nodel-add-node-created-link')?.href).toContain('/nodes/ConfiguredCopy/');
  });

  it('keeps duplicate input and source selection visible after partial file failures', async () => {
    const partialListener = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/REST/recipes/list') {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/nodeURLs') {
        return new Response(JSON.stringify([{ node: 'Existing Node', address: 'http://host/nodes/Existing%20Node/', host: 'host' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === 'http://host/nodes/Existing%20Node/REST/files') {
        return new Response(JSON.stringify([{ path: 'broken.bin' }, { path: 'good.bin' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode' || url.endsWith('/nodes/PartialCopy/REST/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url.includes('http://host/nodes/Existing%20Node/REST/files/contents?path=')) {
        return new Response(Uint8Array.from([1, 2, 3]), { status: 200 }) as never;
      }
      if (url.includes('/nodes/PartialCopy/REST/files/save?path=broken.bin')) {
        return new Response(JSON.stringify({ message: 'disk rejected file' }), { status: 507, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url.includes('/nodes/PartialCopy/REST/files/save?path=good.bin')) {
        return new Response('{}', { status: 200 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);
    await openAddNodePanel('<nodel-add-node redirect="false"></nodel-add-node>');
    document.querySelector('nodel-add-node')?.addEventListener('nodel-node-duplicate-partial', partialListener);

    const nameInput = document.querySelector('.nodel-add-node-name') as HTMLInputElement;
    const templateInput = document.querySelector('.nodel-add-node-template') as HTMLInputElement;
    await setInputValue(nameInput, 'Partial Copy');
    await setInputValue(templateInput, 'Existing');
    await waitFor(() => document.querySelectorAll('.nodel-template-autocomplete .nodel-menu-item').length === 1, { attempts: 80, intervalMs: 5 });
    await pressKey(templateInput, 'ArrowDown');
    await pressKey(templateInput, 'Enter');
    document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => Boolean(document.querySelector('.nodel-add-node-warning')), { attempts: 80, intervalMs: 5 });
    const warning = document.querySelector('.nodel-add-node-warning');
    expect(warning?.getAttribute('role')).toBe('alert');
    expect(warning?.textContent).toContain('broken.bin');
    expect(warning?.textContent).toContain('HTTP 507');
    expect(warning?.textContent).toContain('disk rejected file');
    expect(nameInput.value).toBe('Partial Copy');
    expect(templateInput.value).toBe('Existing Node');
    expect(document.body.textContent).toContain('Node: Existing Node');
    expect(document.querySelector('.nodel-add-node-panel')?.classList.contains('hidden')).toBe(false);
    expect(document.querySelector<HTMLAnchorElement>('.nodel-add-node-created-link')?.href).toContain('/nodes/PartialCopy/');
    expect(partialListener).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({
        failed: [expect.objectContaining({ path: 'broken.bin', phase: 'save', status: 507 })]
      })
    }));
  });

  it('shows the created-node link when script.py makes duplication fatal', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/REST/recipes/list') {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/nodeURLs') {
        return new Response(JSON.stringify([{ node: 'Existing Node', address: 'http://host/nodes/Existing%20Node/', host: 'host' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === 'http://host/nodes/Existing%20Node/REST/files') {
        return new Response(JSON.stringify([{ path: 'script.py' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode' || url.endsWith('/nodes/BrokenCopy/REST/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === 'http://host/nodes/Existing%20Node/REST/files/contents?path=script.py') {
        return new Response('print("hello")', { status: 200 }) as never;
      }
      if (url.includes('/nodes/BrokenCopy/REST/files/save?path=script.py')) {
        return new Response('invalid recipe', { status: 500 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);
    await openAddNodePanel('<nodel-add-node redirect="false"></nodel-add-node>');
    const nameInput = document.querySelector('.nodel-add-node-name') as HTMLInputElement;
    const templateInput = document.querySelector('.nodel-add-node-template') as HTMLInputElement;
    await setInputValue(nameInput, 'Broken Copy');
    await setInputValue(templateInput, 'Existing');
    await waitFor(() => document.querySelectorAll('.nodel-template-autocomplete .nodel-menu-item').length === 1, { attempts: 80, intervalMs: 5 });
    await pressKey(templateInput, 'ArrowDown');
    await pressKey(templateInput, 'Enter');
    document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => Boolean(document.querySelector('.nodel-add-node-error')), { attempts: 80, intervalMs: 5 });
    expect(document.querySelector('.nodel-add-node-error')?.textContent).toContain('created but is incomplete');
    expect(document.querySelector('.nodel-add-node-error')?.textContent).toContain('script.py');
    expect(document.querySelector<HTMLAnchorElement>('.nodel-add-node-created-link')?.href).toContain('/nodes/BrokenCopy/');
    expect(nameInput.value).toBe('Broken Copy');
    expect(templateInput.value).toBe('Existing Node');
  });

  it('closes the add-node panel with Cancel', async () => {
    stubAddNodeLookups();
    await openAddNodePanel();

    document.querySelector<HTMLButtonElement>('.nodel-add-node-cancel')?.click();

    expect(document.querySelector('.nodel-add-node-panel')?.classList.contains('hidden')).toBe(true);
  });

  it('closes when clicking the host whitespace or outside the component', async () => {
    stubAddNodeLookups();
    await openAddNodePanel();

    document.querySelector('nodel-add-node')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.nodel-add-node-panel')?.classList.contains('hidden')).toBe(true);

    document.querySelector<HTMLButtonElement>('.nodel-add-node-toggle')?.click();
    expect(document.querySelector('.nodel-add-node-panel')?.classList.contains('hidden')).toBe(false);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.nodel-add-node-panel')?.classList.contains('hidden')).toBe(true);
  });

  it('closes autocomplete when clicking another control in the panel', async () => {
    stubAddNodeLookups([{ path: 'Recipes/Starter' }]);
    await openAddNodePanel();

    const templateInput = document.querySelector('.nodel-add-node-template') as HTMLInputElement;
    await setInputValue(templateInput, 'Starter');
    await waitFor(() => document.querySelectorAll('.nodel-template-autocomplete .nodel-menu-item').length === 1, {
      attempts: 80,
      intervalMs: 5
    });

    document.querySelector<HTMLInputElement>('.nodel-add-node-name')?.click();

    expect(document.querySelector('.nodel-template-autocomplete')?.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('.nodel-add-node-panel')?.classList.contains('hidden')).toBe(false);
  });

  it('closes the panel with Escape from the node name field', async () => {
    stubAddNodeLookups();
    await openAddNodePanel();

    await pressKey(document.querySelector('.nodel-add-node-name') as HTMLInputElement, 'Escape');

    expect(document.querySelector('.nodel-add-node-panel')?.classList.contains('hidden')).toBe(true);
  });

  it('closes template autocomplete with Escape without closing the add-node panel', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === '/REST/recipes/list') {
        return new Response(JSON.stringify([{ path: 'Recipes/Starter' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      if (url === '/REST/nodeURLs') {
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);
    await openAddNodePanel();

    const templateInput = document.querySelector('.nodel-add-node-template') as HTMLInputElement;
    await setInputValue(templateInput, 'Starter');
    await waitFor(() => document.querySelectorAll('.nodel-template-autocomplete .nodel-menu-item').length === 1, {
      attempts: 80,
      intervalMs: 5
    });

    await pressKey(templateInput, 'Escape');

    expect(document.querySelector('.nodel-template-autocomplete')?.classList.contains('hidden')).toBe(true);
    expect(document.querySelector('.nodel-add-node-panel')?.classList.contains('hidden')).toBe(false);
  });
});
