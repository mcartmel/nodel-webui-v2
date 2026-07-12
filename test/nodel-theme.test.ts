import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import '../src/components/nodel-app';
import { THEME_STORAGE_KEY } from '../src/theme/theme';

interface SystemThemeMock {
  change(theme: 'light' | 'dark'): void;
  mediaQuery: MediaQueryList;
}

function mockSystemTheme(theme: 'light' | 'dark'): SystemThemeMock {
  let currentTheme = theme;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQuery = {
    get matches() {
      return currentTheme === 'dark';
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    addEventListener: vi.fn((event: string, listener: EventListenerOrEventListenerObject) => {
      if (event === 'change' && typeof listener === 'function') {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      }
    }),
    removeEventListener: vi.fn((event: string, listener: EventListenerOrEventListenerObject) => {
      if (event === 'change' && typeof listener === 'function') {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      }
    }),
    dispatchEvent: vi.fn()
  } as unknown as MediaQueryList;

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => mediaQuery)
  });

  return {
    mediaQuery,
    change(nextTheme) {
      currentTheme = nextTheme;
      for (const listener of listeners) {
        listener({ matches: nextTheme === 'dark', media: mediaQuery.media } as MediaQueryListEvent);
      }
    }
  };
}

async function renderApp(markup = '<nodel-app title="Nodel"></nodel-app>') {
  document.body.innerHTML = markup;
  await customElements.whenDefined('nodel-app');
  await Promise.resolve();
}

describe('theme synchronization', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    mockSystemTheme('light');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('defaults to the system theme when no theme attribute is set', async () => {
    mockSystemTheme('dark');
    await renderApp();

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('uses a stored theme preference over the system theme', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    await renderApp();

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('ignores malformed stored preferences', async () => {
    mockSystemTheme('dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
    await renderApp();

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('falls back to the system theme when storage is unavailable', async () => {
    mockSystemTheme('dark');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    await renderApp();

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('ignores stored preference when an explicit theme is set', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    await renderApp('<nodel-app theme="light" title="Nodel"></nodel-app>');

    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('reflects dark theme changes to the document root', async () => {
    await renderApp();

    const app = document.querySelector('nodel-app') as HTMLElement | null;
    app?.setAttribute('theme', 'dark');
    await Promise.resolve();

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('follows live system theme changes without an explicit or stored preference', async () => {
    const systemTheme = mockSystemTheme('light');
    await renderApp();

    systemTheme.change('dark');

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('synchronizes valid stored preferences changed in another tab', async () => {
    await renderApp();
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('keeps an explicit theme ahead of system and storage changes', async () => {
    const systemTheme = mockSystemTheme('light');
    await renderApp('<nodel-app theme="dark" title="Nodel"></nodel-app>');

    systemTheme.change('light');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'light' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('removes theme listeners when disconnected', async () => {
    const systemTheme = mockSystemTheme('light');
    await renderApp();

    document.body.innerHTML = '';
    systemTheme.change('dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));

    expect(systemTheme.mediaQuery.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('places an identical bootstrap before CSS on every shipped visual page', async () => {
    const pages = ['components.html', 'nodes.html', 'nodel.html', 'toolkit.html'];
    const bootstraps = await Promise.all(pages.map(async (page) => {
      const source = await readFile(resolve(process.cwd(), page), 'utf8');
      const start = source.indexOf('<script>');
      const end = source.indexOf('</script>', start) + '</script>'.length;
      const stylesheet = source.indexOf('<link rel="stylesheet"');
      const bootstrap = source.slice(start, end);

      expect(start).toBeGreaterThan(-1);
      expect(start).toBeLessThan(stylesheet);
      expect(bootstrap).toContain("localStorage.getItem('nodel.theme')");
      expect(bootstrap).toContain("matchMedia('(prefers-color-scheme: dark)')");
      expect(bootstrap).toContain('root.dataset.theme = theme');
      return bootstrap;
    }));

    expect(new Set(bootstraps).size).toBe(1);
  });
});
