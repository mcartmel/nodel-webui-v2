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
import '../src/components/nodel-node-menu';
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

  async function mountMenu() {
    document.body.innerHTML = '<nodel-node-menu></nodel-node-menu>';
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
    expect(document.querySelector('.nodel-node-menu-drawer')?.getAttribute('aria-label')).toBe('Node menu');
    expect(document.querySelector('.nodel-node-menu-header')?.textContent?.trim()).toBe('');
    expect(document.querySelector('[data-node-menu-close] [data-icon="xmark"]')).not.toBeNull();
    expect(document.querySelector('.nodel-node-menu-section-appearance nodel-theme-toggle')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.nodel-node-menu-layer')?.hasAttribute('hidden')).toBe(true);
    expect(document.documentElement.classList.contains('nodel-node-menu-scroll-lock')).toBe(false);

    openMenu();
    document.querySelector<HTMLButtonElement>('[data-node-menu-backdrop]')?.click();
    expect(document.querySelector('.nodel-node-menu-layer')?.hasAttribute('hidden')).toBe(true);
    expect(document.documentElement.classList.contains('nodel-node-menu-scroll-lock')).toBe(false);
  });

  it('renders custom UI links and reference links', async () => {
    await mountMenu();
    openMenu();

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.nodel-node-menu-link-list a'));
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
      '/diagnostics.xml'
    ]);
    expect(document.querySelector('.nodel-node-menu-section-open')).not.toBeNull();
  });

  it('switches the app theme from the drawer', async () => {
    document.body.innerHTML = '<nodel-app><nodel-node-menu></nodel-node-menu></nodel-app>';
    await customElements.whenDefined('nodel-node-menu');
    await waitFor(() => document.querySelector<HTMLInputElement>('[data-node-menu-rename-input]')?.value === 'Old Node');
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

    expect(document.body.textContent).toContain('No custom UIs.');
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
    document.querySelector<HTMLFormElement>('[data-node-menu-rename-form]')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => nodeMenuMock.renameCurrentNode.mock.calls.length === 1);
    await flush();

    expect(nodeMenuMock.renameCurrentNode).toHaveBeenCalledWith('New Node');
    expect(nodeMenuMock.waitForNodeReady).toHaveBeenCalledWith(`${window.location.origin}/nodes/NewNode/`);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ message: 'Rename successful. Redirecting...', tone: 'success' })
    }));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      detail: { url: `${window.location.origin}/nodes/NewNode/` }
    }));
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
});
