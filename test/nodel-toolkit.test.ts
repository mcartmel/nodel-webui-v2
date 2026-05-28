import { flush, waitFor } from './helpers';
import '../src/components/nodel-toolkit';

async function waitForToolkit() {
  await customElements.whenDefined('nodel-toolkit');
  await waitFor(() => Boolean(document.querySelector('nodel-toolkit .cm-editor')), {
    attempts: 20,
    intervalMs: 25
  });
}

describe('nodel-toolkit', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.createRange = () => ({
      setStart: vi.fn(),
      setEnd: vi.fn(),
      getClientRects: () => [],
      getBoundingClientRect: () => new DOMRect(0, 0, 0, 0),
      commonAncestorContainer: document.body
    }) as unknown as Range;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders the host toolkit reference in a read-only editor', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/REST/toolkit');
      return new Response(JSON.stringify({
        script: 'def createTCP(dest):\n  return nodetoolkit.createTCP(dest)\n'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }) as never;
    }) as unknown as typeof fetch);

    document.body.innerHTML = '<nodel-toolkit></nodel-toolkit>';
    await waitForToolkit();

    expect(document.querySelector('nodel-toolkit')?.getAttribute('data-state')).toBe('ready');
    expect(document.querySelector('[data-toolkit-status]')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('nodel-toolkit .cm-content')?.textContent).toContain('createTCP');
    expect(document.querySelector('nodel-toolkit .cm-content')?.getAttribute('contenteditable')).toBe('false');
  });

  it('waits for the page to become visible before fetching', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/REST/toolkit');
      return new Response(JSON.stringify({ script: 'console.info("ready")' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }) as never;
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);
    document.body.innerHTML = '<nodel-page hidden><nodel-toolkit></nodel-toolkit></nodel-page>';
    await customElements.whenDefined('nodel-toolkit');
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();

    document.querySelector('nodel-page')?.removeAttribute('hidden');
    await waitFor(() => (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length > 0, {
      attempts: 20,
      intervalMs: 25
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renders an error when the toolkit cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response('', { status: 500, statusText: 'Server Error' }) as never
    )) as unknown as typeof fetch);

    document.body.innerHTML = '<nodel-toolkit></nodel-toolkit>';
    await waitFor(() => document.querySelector('nodel-toolkit')?.getAttribute('data-state') === 'error', {
      attempts: 20,
      intervalMs: 25
    });

    expect(document.querySelector('[data-toolkit-status]')?.textContent).toContain('500 Server Error');
  });
});
