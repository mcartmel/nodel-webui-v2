import { flush, waitFor } from './helpers';
import '../src/components/nodel-toolbar';
import '../src/components/nodel-app';
import { NODEL_NAVIGATION_CHANGE } from '../src/navigation/navigation';

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

    await waitFor(
      () => document.querySelector('[data-toolbar-title]')?.textContent === 'Nodel Recipes Sync for TRANSCENDENCE 8085',
      { attempts: 20, message: 'Timed out waiting for toolbar state' }
    );

    const title = document.querySelector('[data-toolbar-title]') as HTMLElement | null;
    const icon = document.querySelector('[data-toolbar-icon]') as HTMLImageElement | null;

    expect(title?.hidden).toBe(false);
    expect(icon?.alt).toBe('Nodel Recipes Sync for TRANSCENDENCE 8085');
    expect(fetchMock).toHaveBeenCalledWith('REST/', expect.objectContaining({ signal: expect.any(AbortSignal) }));
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

  it('hides an unsafe toolbar image source', async () => {
    document.body.innerHTML = '<nodel-toolbar title="Unsafe" icon-src="javascript:alert(1)"></nodel-toolbar>';
    await flush();
    const toolbar = document.querySelector('nodel-toolbar') as HTMLElement;
    const icon = toolbar.querySelector('[data-toolbar-icon]') as HTMLImageElement;

    expect(toolbar.dataset.iconState).toBe('error');
    expect(icon.hasAttribute('src')).toBe(false);
    expect(icon.classList.contains('hidden')).toBe(true);
  });

  it('supports keyboard navigation inside grouped page menus', async () => {
    document.body.innerHTML = '<nodel-app><nodel-toolbar title="Pages"></nodel-toolbar></nodel-app>';
    await customElements.whenDefined('nodel-toolbar');
    const app = document.querySelector('nodel-app')!;
    app.dispatchEvent(new CustomEvent(NODEL_NAVIGATION_CHANGE, {
      detail: {
        activePageId: 'settings',
        items: [{
          type: 'group',
          id: 'admin',
          title: 'Admin',
          children: [
            { type: 'page', id: 'overview', title: 'Overview' },
            { type: 'page', id: 'settings', title: 'Settings' },
            { type: 'page', id: 'logs', title: 'Logs' }
          ]
        }]
      }
    }));
    await flush();

    const group = document.querySelector<HTMLElement>('[data-nav-group-id="admin"]')!;
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement?.textContent).toBe('Settings');

    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement?.textContent).toBe('Logs');
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();

    expect(document.activeElement).toBe(document.querySelector('[data-nav-group-id="admin"]'));
    expect(document.querySelector<HTMLElement>('[data-nav-group-menu-id="admin"]')?.hidden).toBe(true);
  });
});
