import { waitFor } from './helpers';
import '../src/components/nodel-app';
import '../src/components/nodel-toolbar';
import '../src/components/nodel-page';
import '../src/components/nodel-row';
import '../src/components/nodel-column';
import '../src/components/nodel-text';
import '../src/components/nodel-theme-toggle';

describe('nodel app base layer', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'light';
    window.history.replaceState(undefined, '', '/');
    document.body.innerHTML = `
      <nodel-app theme="default" title="Nodel">
        <nodel-toolbar icon-src="./v2/img/logo.png">
          <nodel-theme-toggle></nodel-theme-toggle>
        </nodel-toolbar>
        <nodel-page title="Base UI">
          <nodel-row>
            <nodel-column span="12">
              <nodel-text id="content">Base layer</nodel-text>
            </nodel-column>
          </nodel-row>
        </nodel-page>
      </nodel-app>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders the base toolbar and page structure', async () => {
    await customElements.whenDefined('nodel-app');
    await Promise.resolve();

    const toolbar = document.querySelector('nodel-toolbar');
    const page = document.querySelector('nodel-page');
    const column = document.querySelector('nodel-column') as HTMLElement | null;
    const icon = document.querySelector('nodel-toolbar img[data-toolbar-icon]');
    const toolbarTitle = document.querySelector('nodel-toolbar [data-toolbar-title]') as HTMLElement | null;
    const hostIcon = document.querySelector('nodel-toolbar nodel-host-icon img') as HTMLImageElement | null;

    expect(toolbar).not.toBeNull();
    expect(page).not.toBeNull();
    expect(document.querySelector('[data-page-title]')).toBeNull();
    expect(column?.dataset.span).toBe('12');
    expect(column?.style.getPropertyValue('--nodel-column-span')).toBe('12');
    expect(icon?.getAttribute('src')).toContain('./v2/img/logo.png');
    expect(icon?.getAttribute('alt')).toBe('');
    expect(toolbarTitle?.hidden).toBe(true);
    expect(toolbarTitle?.textContent).toBe('');
    expect(hostIcon?.getAttribute('src')).toContain('data:image/svg+xml;base64,');
    expect(document.querySelector('#content')?.textContent).toBe('Base layer');
  });

  it('switches the theme through the attribute', async () => {
    await customElements.whenDefined('nodel-theme-toggle');
    await Promise.resolve();

    const app = document.querySelector('nodel-app');
    const toggle = document.querySelector('nodel-theme-toggle button') as HTMLButtonElement;

    expect(app?.getAttribute('theme')).toBe('default');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.querySelector('svg')?.dataset.icon).toBe('sun');

    toggle.click();
    await Promise.resolve();

    expect(app?.getAttribute('theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.querySelector('svg')?.dataset.icon).toBe('moon');
  });

  it('uses the current node name as the document title on node pages', async () => {
    window.history.replaceState(undefined, '', '/nodes/ExampleNode/nodel.html');
    document.title = 'Nodel';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('REST/');
      return new Response(JSON.stringify({ name: 'Example Node' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }) as never;
    }) as unknown as typeof fetch);

    document.body.innerHTML = '<nodel-app><nodel-page title="Activity"></nodel-page></nodel-app>';
    await customElements.whenDefined('nodel-app');

    await waitFor(() => document.title === 'Example Node');

    expect(document.title).toBe('Example Node');
  });
});
