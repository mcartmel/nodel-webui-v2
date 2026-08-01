import { installControlRuntime, type NodelControlSignalState } from '../src/data/control-runtime';
import '../src/components/nodel-markdown';
import { sanitizeHtml } from '../src/utils/markdown';
import { flush } from './helpers';

describe('nodel-markdown', () => {
  let listener: ((state: NodelControlSignalState) => void) | null = null;
  let dispose: ReturnType<typeof vi.fn>;
  let restoreRuntime: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    dispose = vi.fn();
    listener = null;
    restoreRuntime = installControlRuntime({
      callAction: vi.fn(),
      subscribeSignals: (_element, nextListener) => {
        listener = nextListener;
        nextListener({ loading: true, connected: false, error: '', entries: [] });
        return { dispose };
      }
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    restoreRuntime?.();
    restoreRuntime = null;
  });

  it('renders sanitized literal Markdown and safe links', async () => {
    document.body.innerHTML = `<nodel-markdown value="# Heading&#10;&#10;[Safe](/docs)&#10;&#10;&lt;a href='javascript:alert(1)' target='_blank'&gt;Unsafe&lt;/a&gt;&#10;&#10;&lt;a href='java&amp;#10;script:alert(1)'&gt;Obfuscated&lt;/a&gt;&#10;&#10;&lt;script&gt;bad()&lt;/script&gt;"></nodel-markdown>`;
    await flush();
    const component = document.querySelector('nodel-markdown')!;

    expect(component.querySelector('h1')?.textContent).toBe('Heading');
    expect(component.querySelector<HTMLAnchorElement>('a[href="/docs"]')).not.toBeNull();
    expect(Array.from(component.querySelectorAll('a')).find((anchor) => anchor.textContent === 'Unsafe')?.hasAttribute('href')).toBe(false);
    expect(Array.from(component.querySelectorAll('a')).find((anchor) => anchor.textContent === 'Obfuscated')?.hasAttribute('href')).toBe(false);
    expect(component.querySelector('script')).toBeNull();
    expect(component.textContent).not.toContain('bad()');
  });

  it('adds opener protections to safe blank-target links', () => {
    const output = document.createElement('div');
    output.innerHTML = sanitizeHtml('<a href="https://example.test/docs" target="_blank" rel="external opener">External</a>');
    const anchor = output.querySelector('a')!;

    expect(anchor.getAttribute('href')).toBe('https://example.test/docs');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('strips global styling classes and only keeps constrained code-language classes', async () => {
    document.body.innerHTML = `<nodel-markdown value="&lt;span class='nodel-connectivity-backdrop fixed inset-0'&gt;Overlay&lt;/span&gt;&#10;&#10;&lt;code class='language-typescript'&gt;safe&lt;/code&gt;&#10;&#10;&lt;code class='nodel-panel language-js'&gt;mixed&lt;/code&gt;"></nodel-markdown>`;
    await flush();
    const component = document.querySelector('nodel-markdown')!;
    const span = component.querySelector('span');
    const codes = component.querySelectorAll('code');

    expect(span?.textContent).toBe('Overlay');
    expect(span?.hasAttribute('class')).toBe(false);
    expect(codes[0].getAttribute('class')).toBe('language-typescript');
    expect(codes[1].hasAttribute('class')).toBe(false);
  });

  it('uses constrained overflow tokens and a plain-text empty fallback', async () => {
    document.body.innerHTML = '<nodel-markdown max-height="md"></nodel-markdown>';
    await flush();
    const component = document.querySelector('nodel-markdown')!;

    expect(component.getAttribute('data-max-height')).toBe('md');
    expect(component.querySelector('.nodel-markdown-region')).not.toBeNull();
    expect(component.querySelector('[role="status"]')?.textContent).toBe('No content available.');

    component.setAttribute('max-height', '47rem');
    expect(component.getAttribute('data-max-height')).toBe('none');
  });

  it('shows loading and error text and reflects signal Markdown safely', async () => {
    document.body.innerHTML = '<nodel-markdown signal="PanelContent" max-height="sm"></nodel-markdown>';
    await flush();
    const component = document.querySelector('nodel-markdown')!;
    expect(component.querySelector('[role="status"]')?.textContent).toBe('Loading content...');
    expect(component.querySelector('.nodel-markdown-region')?.getAttribute('aria-busy')).toBe('true');

    listener?.({
      loading: false,
      connected: true,
      error: '',
      entries: [{ seq: 1, timestamp: '', source: 'local', type: 'event', alias: 'PanelContent', arg: '**Ready** <img src=x onerror=alert(1)>' }]
    });
    await flush();
    expect(component.querySelector('strong')?.textContent).toBe('Ready');
    expect(component.querySelector('img')).toBeNull();
    expect(component.querySelector('.nodel-markdown-region')?.getAttribute('aria-busy')).toBe('false');

    listener?.({ loading: false, connected: false, error: 'offline', entries: [] });
    expect(component.querySelector('[role="alert"]')?.textContent).toBe('Content unavailable.');
  });

  it('renders a value delivered synchronously during subscription', async () => {
    restoreRuntime?.();
    restoreRuntime = installControlRuntime({
      callAction: vi.fn(),
      subscribeSignals: (_element, nextListener) => {
        nextListener({
          loading: false,
          connected: true,
          error: '',
          entries: [{ seq: 1, timestamp: '', source: 'local', type: 'event', alias: 'PanelContent', arg: '## Ready now' }]
        });
        return { dispose() {} };
      }
    });
    document.body.innerHTML = '<nodel-markdown signal="PanelContent"></nodel-markdown>';
    await flush();

    expect(document.querySelector('nodel-markdown h2')?.textContent).toBe('Ready now');
    expect(document.querySelector('.nodel-markdown-region')?.getAttribute('aria-busy')).toBe('false');

    (document.querySelector('nodel-markdown') as unknown as { connectedCallback(): void }).connectedCallback();
    expect(document.querySelector('nodel-markdown h2')?.textContent).toBe('Ready now');
    expect(document.querySelector('.nodel-markdown-region')?.getAttribute('aria-busy')).toBe('false');
  });

  it('disposes its signal subscription on disconnect', async () => {
    document.body.innerHTML = '<nodel-markdown signal="PanelContent"></nodel-markdown>';
    await flush();
    document.querySelector('nodel-markdown')?.remove();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
