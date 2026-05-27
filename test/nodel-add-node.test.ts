import { flush, waitFor } from './helpers';
import '../src/components/nodel-add-node';

async function openAddNodePanel(markup = '<nodel-add-node redirect="false"></nodel-add-node>') {
  document.body.innerHTML = markup;
  await customElements.whenDefined('nodel-add-node');
  await flush();

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

    await openAddNodePanel();

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
    nameInput.value = 'My Copy';
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
