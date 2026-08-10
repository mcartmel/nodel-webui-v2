import { flush, waitFor } from './helpers';

const nodeMenuMock = vi.hoisted(() => ({
  getNodeDetails: vi.fn(),
  listCustomUiEntries: vi.fn(),
  removeCurrentNode: vi.fn(),
  renameCurrentNode: vi.fn(),
  restartCurrentNode: vi.fn(),
  waitForNodeReady: vi.fn()
}));

vi.mock('../src/api/nodel-host-client', () => ({
  getNodeDetails: nodeMenuMock.getNodeDetails,
  listCustomUiEntries: nodeMenuMock.listCustomUiEntries,
  removeCurrentNode: nodeMenuMock.removeCurrentNode,
  renameCurrentNode: nodeMenuMock.renameCurrentNode,
  restartCurrentNode: nodeMenuMock.restartCurrentNode,
  waitForNodeReady: nodeMenuMock.waitForNodeReady
}));

import '../src/components/nodel-app';
import '../src/components/nodel-toolbar';
import '../src/components/nodel-node-menu';
import type { NodelConfirmHostElement } from '../src/components/nodel-confirm-host';
import { THEME_STORAGE_KEY } from '../src/theme/theme';

function mockSystemTheme(theme: 'light' | 'dark') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' && theme === 'dark',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

describe('nodel-node-menu', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
    mockSystemTheme('light');
    window.history.replaceState(undefined, '', '/nodes/OldNode/nodel.html');
    nodeMenuMock.getNodeDetails.mockReset().mockResolvedValue({ name: 'Old Node' });
    nodeMenuMock.listCustomUiEntries.mockReset().mockResolvedValue([
      { href: 'custom.html', path: 'content/custom.html', title: 'custom.html' },
      { href: 'index.xml', path: 'content/index.xml', title: 'index.xml' },
      { href: 'panel.xml', path: 'content/panel.xml', title: 'panel.xml' }
    ]);
    nodeMenuMock.removeCurrentNode.mockReset().mockResolvedValue('');
    nodeMenuMock.renameCurrentNode.mockReset().mockResolvedValue('');
    nodeMenuMock.restartCurrentNode.mockReset().mockResolvedValue('');
    nodeMenuMock.waitForNodeReady.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.classList.remove('nodel-node-menu-scroll-lock');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function mountMenu(content = '') {
    document.body.innerHTML = `<nodel-app>${content}<nodel-toolbar><nodel-node-menu></nodel-node-menu></nodel-toolbar></nodel-app>`;
    await customElements.whenDefined('nodel-node-menu');
    await waitFor(() => document.querySelector<HTMLInputElement>('[data-node-menu-rename-input]')?.value === 'Old Node');
    return document.querySelector('nodel-node-menu')!;
  }

  function openMenu() {
    document.querySelector<HTMLButtonElement>('[data-node-menu-open]')?.click();
  }

  it('opens and closes from the hamburger, Escape, and backdrop', async () => {
    await mountMenu();

    openMenu();
    expect(document.querySelector('.nodel-node-menu-layer')?.hasAttribute('hidden')).toBe(false);
    expect(document.documentElement.classList.contains('nodel-node-menu-scroll-lock')).toBe(true);
    expect(document.querySelector('[data-node-menu-open]')?.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-node-menu-open] [data-icon="bars"]')).not.toBeNull();
    expect(document.querySelector<HTMLAnchorElement>('.nodel-ui-version-toggle a')?.getAttribute('href')).toBe('index.xml');
    expect(document.querySelector('.nodel-ui-version-toggle [aria-current="page"]')?.textContent).toBe('V2');
    expect(document.querySelector('.nodel-node-menu-drawer')?.getAttribute('aria-label')).toBe('Node menu');
    expect(document.querySelector('.nodel-node-menu-header')?.textContent?.trim()).toBe('');
    expect(document.querySelector('[data-node-menu-close] [data-icon="xmark"]')).not.toBeNull();
    expect(document.querySelector('.nodel-node-menu-section-appearance nodel-theme-toggle')).not.toBeNull();
    expect(document.querySelector('.nodel-node-menu-drawer input[type="search"]')).toBeNull();
    expect(document.querySelector('.nodel-node-menu-drawer [data-node-search]')).toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.nodel-node-menu-layer')?.hasAttribute('hidden')).toBe(true);
    expect(document.documentElement.classList.contains('nodel-node-menu-scroll-lock')).toBe(false);

    openMenu();
    document.querySelector<HTMLButtonElement>('[data-node-menu-backdrop]')?.click();
    expect(document.querySelector('.nodel-node-menu-layer')?.hasAttribute('hidden')).toBe(true);
    expect(document.documentElement.classList.contains('nodel-node-menu-scroll-lock')).toBe(false);
  });

  it('makes background content inert and supports drawer arrow navigation', async () => {
    await mountMenu('<main id="background"><button id="outside">Outside</button></main>');
    const background = document.querySelector<HTMLElement>('#background')!;

    openMenu();
    await flush();

    expect(background.inert).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('[data-node-menu-close]'));

    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(document.querySelector('[data-node-menu-rename-input]'));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect((document.activeElement as HTMLElement | null)?.textContent).toContain('Diagnostics');
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(document.querySelector('[data-node-menu-close]'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(background.inert).toBe(false);
  });

  it('yields drawer navigation while a confirmation layer is topmost', async () => {
    await mountMenu();
    openMenu();
    await flush();
    const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
    const focus = HTMLElement.prototype.focus;
    const nativeFocus = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (this.closest('[inert]')) {
        return;
      }
      focus.call(this, options);
    });
    host.confirm({ text: 'Confirm this action?', resolve: vi.fn() }, document.querySelector('[data-node-menu-close]'));
    await flush();

    const confirm = host.querySelector<HTMLButtonElement>('[data-confirm-action="confirm"]')!;
    expect(document.activeElement).toBe(confirm);
    for (const key of ['ArrowDown', 'Home', 'End']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(confirm);
    }
    nativeFocus.mockRestore();

    expect(document.querySelector<HTMLElement>('.nodel-node-menu-layer')?.closest<HTMLElement>('nodel-toolbar')?.inert).toBe(true);
    expect(host.querySelector<HTMLElement>('.nodel-confirm-backdrop')?.inert).not.toBe(true);
  });

  it('renders custom UI links and reference links', async () => {
    await mountMenu();
    openMenu();

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.nodel-node-menu-link-list a'));
    const collection = document.querySelector('.nodel-node-menu-link-list ul.nodel-list');
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'custom.html',
      'panel.xml',
      'Toolkit',
      'Diagnostics'
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'custom.html',
      'panel.xml',
      '/toolkit.html',
      '/nodes.html#Diagnostics'
    ]);
    expect(collection?.children).toHaveLength(4);
    expect(collection?.querySelectorAll('.nodel-list-item-affordance[data-icon="chevron-right"]')).toHaveLength(4);
    expect(collection?.querySelectorAll('.nodel-list-item-affordance[aria-hidden="true"]')).toHaveLength(4);
    expect(document.querySelector('.nodel-node-menu-section-open')).not.toBeNull();
  });

  it('switches the app theme from the drawer', async () => {
    await mountMenu();
    openMenu();

    const toggle = document.querySelector<HTMLButtonElement>('.nodel-node-menu-section-appearance nodel-theme-toggle button')!;
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    toggle.click();
    await Promise.resolve();

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('shows an empty custom UI state', async () => {
    nodeMenuMock.listCustomUiEntries.mockResolvedValueOnce([]);

    await mountMenu();
    openMenu();

    const empty = Array.from(document.querySelectorAll('.nodel-alert')).find((element) => element.textContent?.includes('No custom UIs.'));
    expect(empty).not.toBeUndefined();
    expect(empty?.closest('.nodel-list')).toBeNull();
    expect(document.querySelectorAll('.nodel-node-menu-link-list .nodel-list > li')).toHaveLength(2);
    expect(document.querySelector<HTMLAnchorElement>('.nodel-ui-version-toggle a')?.getAttribute('href')).toBe('nodel.xml');
  });

  it('renames the node, shows a toast, waits for readiness, and redirects', async () => {
    const menu = await mountMenu();
    const toast = vi.fn();
    const navigate = vi.fn((event: Event) => event.preventDefault());
    menu.addEventListener('nodel-toast', toast);
    menu.addEventListener('nodel-node-menu-navigate', navigate);
    openMenu();

    const input = document.querySelector<HTMLInputElement>('[data-node-menu-rename-input]')!;
    input.value = 'New Node';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.querySelector<HTMLFormElement>('[data-node-menu-rename-form]')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => nodeMenuMock.renameCurrentNode.mock.calls.length === 1);
    await flush();

    expect(nodeMenuMock.renameCurrentNode).toHaveBeenCalledWith('New Node', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(nodeMenuMock.waitForNodeReady).toHaveBeenCalledWith(
      `${window.location.origin}/nodes/NewNode/`,
      30,
      1000,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ message: 'Rename successful. Redirecting...', tone: 'success' })
    }));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      detail: { url: `${window.location.origin}/nodes/NewNode/` }
    }));
  });

  it('rejects malformed names before rename or readiness requests', async () => {
    const menu = await mountMenu();
    openMenu();

    // HTML input bindings may normalize malformed UTF-16 before the component
    // receives it; exercise the component boundary with its authored state.
    (menu as unknown as { state: { nodeName: string } }).state.nodeName = 'Node\ud800';
    document.querySelector<HTMLFormElement>('[data-node-menu-rename-form]')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => document.body.textContent?.includes('well-formed UTF-16') ?? false);
    expect(nodeMenuMock.renameCurrentNode).not.toHaveBeenCalled();
    expect(nodeMenuMock.waitForNodeReady).not.toHaveBeenCalled();
  });

  it('restarts the node and shows a toast', async () => {
    const menu = await mountMenu();
    const toast = vi.fn();
    menu.addEventListener('nodel-toast', toast);
    openMenu();

    document.querySelector<HTMLButtonElement>('[data-node-menu-restart]')?.click();

    await waitFor(() => nodeMenuMock.restartCurrentNode.mock.calls.length === 1);

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ message: 'Restarting node...', tone: 'info' })
    }));
    expect(document.querySelector('.nodel-node-menu-layer')?.hasAttribute('hidden')).toBe(true);
  });

  it('requires confirmation before deleting then redirects to the host root', async () => {
    const menu = await mountMenu();
    vi.useFakeTimers();
    const toast = vi.fn();
    const navigate = vi.fn((event: Event) => event.preventDefault());
    menu.addEventListener('nodel-toast', toast);
    menu.addEventListener('nodel-node-menu-navigate', navigate);
    openMenu();

    document.querySelector<HTMLButtonElement>('[data-node-menu-delete-start]')?.click();
    expect(nodeMenuMock.removeCurrentNode).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Confirm delete');

    document.querySelector<HTMLButtonElement>('[data-node-menu-delete-confirm]')?.click();
    await waitFor(() => nodeMenuMock.removeCurrentNode.mock.calls.length === 1);

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ message: 'Delete successful. Redirecting...', tone: 'success' })
    }));

    await vi.advanceTimersByTimeAsync(2500);
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      detail: { url: '/' }
    }));
  });

  it('cancels delayed navigation when disconnected after delete', async () => {
    const menu = await mountMenu();
    vi.useFakeTimers();
    const navigate = vi.fn((event: Event) => event.preventDefault());
    menu.addEventListener('nodel-node-menu-navigate', navigate);
    openMenu();
    document.querySelector<HTMLButtonElement>('[data-node-menu-delete-start]')?.click();
    document.querySelector<HTMLButtonElement>('[data-node-menu-delete-confirm]')?.click();
    await waitFor(() => nodeMenuMock.removeCurrentNode.mock.calls.length === 1);

    menu.remove();
    await vi.advanceTimersByTimeAsync(2500);

    expect(navigate).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('nodel-node-menu-scroll-lock')).toBe(false);
  });

  it('keeps one data load and document listener set through rapid reconnect loops', async () => {
    const menu = await mountMenu();
    const initialLoads = nodeMenuMock.getNodeDetails.mock.calls.length;
    const initialUiLoads = nodeMenuMock.listCustomUiEntries.mock.calls.length;
    for (let index = 0; index < 3; index += 1) {
      menu.remove();
      document.body.append(menu);
      await waitFor(() => (
        nodeMenuMock.getNodeDetails.mock.calls.length === initialLoads + index + 1
        && nodeMenuMock.listCustomUiEntries.mock.calls.length === initialUiLoads + index + 1
      ));
    }

    expect(nodeMenuMock.getNodeDetails).toHaveBeenCalledTimes(initialLoads + 3);
    expect(nodeMenuMock.listCustomUiEntries).toHaveBeenCalledTimes(initialUiLoads + 3);
    openMenu();
    expect(document.querySelector('.nodel-node-menu-layer')?.hasAttribute('hidden')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.nodel-node-menu-layer')?.hasAttribute('hidden')).toBe(true);
  });

  it('ignores abort-insensitive menu data from a disconnected generation', async () => {
    let resolveStale!: (value: { name: string }) => void;
    nodeMenuMock.getNodeDetails
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveStale = resolve;
      }))
      .mockResolvedValueOnce({ name: 'Current Node' });
    const menu = document.createElement('nodel-node-menu');
    document.body.append(menu);
    await waitFor(() => nodeMenuMock.getNodeDetails.mock.calls.length === 1);

    menu.remove();
    document.body.append(menu);
    await waitFor(() => menu.querySelector<HTMLInputElement>('[data-node-menu-rename-input]')?.value === 'Current Node');
    resolveStale({ name: 'Stale Node' });
    await flush();

    expect(menu.querySelector<HTMLInputElement>('[data-node-menu-rename-input]')?.value).toBe('Current Node');
  });
});
