import '../src/components/nodel-app';
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
});
