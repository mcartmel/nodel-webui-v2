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
    const hostIcon = document.querySelector('[data-toolbar-host-icon]') as HTMLElement | null;

    expect(title?.hidden).toBe(true);
    expect(title?.textContent).toBe('');
    expect(icon?.alt).toBe('');
    expect(hostIcon?.hidden).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hides the host icon unless explicitly enabled', async () => {
    document.body.innerHTML = '<nodel-toolbar></nodel-toolbar>';
    await customElements.whenDefined('nodel-toolbar');
    await flush();

    const hostIcon = document.querySelector('[data-toolbar-host-icon]') as HTMLElement;

    expect(hostIcon.hidden).toBe(true);
  });

  it('renders the opted-in host icon with current-host link and accessible labels', async () => {
    document.body.innerHTML = '<nodel-toolbar show-host-icon></nodel-toolbar>';
    await customElements.whenDefined('nodel-toolbar');
    await flush();

    const hostIcon = document.querySelector('[data-toolbar-host-icon]') as HTMLElement;
    const link = hostIcon.querySelector('a') as HTMLAnchorElement;
    const image = hostIcon.querySelector('img') as HTMLImageElement;
    const expectedHref = `${window.location.protocol}//${window.location.host}/`;

    expect(hostIcon.hidden).toBe(false);
    expect(link.href).toBe(expectedHref);
    expect(link.title).toBe('Browse this host');
    expect(image.alt).toBe('Browse this host');
  });

  it('updates host icon visibility when the opt-in attribute changes', async () => {
    document.body.innerHTML = '<nodel-toolbar></nodel-toolbar>';
    await customElements.whenDefined('nodel-toolbar');
    await flush();

    const toolbar = document.querySelector('nodel-toolbar') as HTMLElement;
    const hostIcon = toolbar.querySelector('[data-toolbar-host-icon]') as HTMLElement;

    toolbar.setAttribute('show-host-icon', '');
    expect(hostIcon.hidden).toBe(false);
    toolbar.removeAttribute('show-host-icon');
    expect(hostIcon.hidden).toBe(true);
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

  it('bounds a desktop group menu to the available viewport space', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(400);
    document.body.innerHTML = '<nodel-app><nodel-toolbar title="Pages"></nodel-toolbar></nodel-app>';
    await customElements.whenDefined('nodel-toolbar');
    const app = document.querySelector('nodel-app')!;
    app.dispatchEvent(new CustomEvent(NODEL_NAVIGATION_CHANGE, {
      detail: {
        activePageId: 'one',
        items: [{
          type: 'group', id: 'group', title: 'Group',
          children: Array.from({ length: 13 }, (_, index) => ({ type: 'page' as const, id: `page-${index}`, title: `Page ${index}` }))
        }]
      }
    }));
    await flush();

    document.querySelector<HTMLElement>('[data-nav-group-id="group"]')!.click();
    await flush();

    const group = document.querySelector<HTMLElement>('[data-nav-group-id="group"]')!;
    const menu = document.querySelector<HTMLElement>('[data-nav-group-menu-id="group"]')!;
    vi.spyOn(group, 'getBoundingClientRect').mockReturnValue({ top: 300, bottom: 340 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    expect(menu.dataset.menuPlacement).toBe('below');
    expect(menu.style.maxHeight).toBe('36px');
    expect(menu.style.overflowY).toBe('');
  });

  it('places an oversized desktop group menu above the trigger when that side has more room', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(400);
    document.body.innerHTML = '<nodel-app><nodel-toolbar title="Pages"></nodel-toolbar></nodel-app>';
    await customElements.whenDefined('nodel-toolbar');
    const app = document.querySelector('nodel-app')!;
    app.dispatchEvent(new CustomEvent(NODEL_NAVIGATION_CHANGE, {
      detail: { activePageId: 'page-0', items: [{ type: 'group', id: 'group', title: 'Group', children: [{ type: 'page', id: 'page-0', title: 'Page 0' }] }] }
    }));
    await flush();
    document.querySelector<HTMLElement>('[data-nav-group-id="group"]')!.click();
    await flush();

    const group = document.querySelector<HTMLElement>('[data-nav-group-id="group"]')!;
    const menu = document.querySelector<HTMLElement>('[data-nav-group-menu-id="group"]')!;
    vi.spyOn(group, 'getBoundingClientRect').mockReturnValue({ top: 300, bottom: 340 } as DOMRect);
    Object.defineProperty(menu, 'scrollHeight', { configurable: true, value: 300 });
    window.dispatchEvent(new Event('resize'));

    expect(menu.dataset.menuPlacement).toBe('above');
    expect(menu.style.maxHeight).toBe('276px');
  });

  it('resets desktop menu bounds when resized to mobile', async () => {
    const viewportWidth = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(400);
    document.body.innerHTML = '<nodel-app><nodel-toolbar title="Pages"></nodel-toolbar></nodel-app>';
    await customElements.whenDefined('nodel-toolbar');
    const app = document.querySelector('nodel-app')!;
    app.dispatchEvent(new CustomEvent(NODEL_NAVIGATION_CHANGE, {
      detail: { activePageId: 'page-0', items: [{ type: 'group', id: 'group', title: 'Group', children: [{ type: 'page', id: 'page-0', title: 'Page 0' }] }] }
    }));
    await flush();
    document.querySelector<HTMLElement>('[data-nav-group-id="group"]')!.click();
    await flush();

    const group = document.querySelector<HTMLElement>('[data-nav-group-id="group"]')!;
    const menu = document.querySelector<HTMLElement>('[data-nav-group-menu-id="group"]')!;
    vi.spyOn(group, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 140 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
    viewportWidth.mockReturnValue(500);
    window.dispatchEvent(new Event('resize'));

    expect(menu.dataset.menuPlacement).toBe('below');
    expect(menu.style.maxHeight).toBe('');
    expect(menu.style.getPropertyValue('--nodel-toolbar-menu-top')).toBe('148px');
  });
});
