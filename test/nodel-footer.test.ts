import '../src/components/nodel-footer';
import { flush } from './helpers';

describe('nodel-footer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders a semantic footer in normal flow and preserves arbitrary focusable children', async () => {
    document.body.innerHTML = '<nodel-app><nodel-footer><span>Connection ready</span><button type="button">Details</button></nodel-footer></nodel-app>';
    await flush();
    const footer = document.querySelector('nodel-footer');
    const shell = footer?.querySelector('footer[data-footer-shell]');
    const button = footer?.querySelector('button');

    expect(shell).not.toBeNull();
    expect(shell?.textContent).toContain('Connection ready');
    expect(footer?.getAttribute('data-fixed')).toBe('false');
    button?.focus();
    expect(document.activeElement).toBe(button);
    expect(document.querySelector('nodel-app')?.hasAttribute('data-fixed-footer')).toBe(false);
  });

  it('reserves measured app space only while fixed', async () => {
    document.body.innerHTML = '<nodel-app><nodel-footer fixed><button>Footer action</button></nodel-footer></nodel-app>';
    const shell = document.querySelector<HTMLElement>('[data-footer-shell]')!;
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
      bottom: 64,
      height: 64,
      left: 0,
      right: 320,
      top: 0,
      width: 320,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });
    await flush();
    const app = document.querySelector<HTMLElement>('nodel-app')!;
    const footer = document.querySelector('nodel-footer')!;

    expect(app.getAttribute('data-fixed-footer')).toBe('true');
    expect(app.style.getPropertyValue('--nodel-fixed-footer-height')).toBe('64px');

    footer.removeAttribute('fixed');
    expect(app.hasAttribute('data-fixed-footer')).toBe(false);
    expect(app.style.getPropertyValue('--nodel-fixed-footer-height')).toBe('');
  });

  it('clears fixed reservation on disconnect and leaves no-footer apps untouched', async () => {
    document.body.innerHTML = '<nodel-app><nodel-footer fixed>Footer</nodel-footer></nodel-app><nodel-app id="plain"></nodel-app>';
    await flush();
    const fixedApp = document.querySelector<HTMLElement>('nodel-app')!;
    document.querySelector('nodel-footer')?.remove();

    expect(fixedApp.hasAttribute('data-fixed-footer')).toBe(false);
    expect(document.querySelector('#plain')?.hasAttribute('data-fixed-footer')).toBe(false);
  });

  it('reserves the tallest fixed footer and transfers ownership when one disconnects', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const height = this.closest('#tall-footer') ? 96 : this.closest('#short-footer') ? 48 : 0;
      return { bottom: height, height, left: 0, right: 320, top: 0, width: 320, x: 0, y: 0, toJSON: () => ({}) };
    });
    document.body.innerHTML = `
      <nodel-app>
        <nodel-footer id="short-footer" fixed>Short</nodel-footer>
        <nodel-footer id="hidden-footer" fixed>Hidden</nodel-footer>
        <nodel-footer id="tall-footer" fixed>Tall</nodel-footer>
      </nodel-app>
    `;
    await flush();
    const app = document.querySelector<HTMLElement>('nodel-app')!;
    expect(app.style.getPropertyValue('--nodel-fixed-footer-height')).toBe('96px');

    document.querySelector('#tall-footer')?.remove();
    expect(app.style.getPropertyValue('--nodel-fixed-footer-height')).toBe('48px');
    document.querySelector('#short-footer')?.remove();
    expect(app.style.getPropertyValue('--nodel-fixed-footer-height')).toBe('0px');
    document.querySelector('#hidden-footer')?.remove();
    expect(app.hasAttribute('data-fixed-footer')).toBe(false);
  });
});
