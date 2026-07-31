import '../src/components/nodel-app';
import type { NodelConnectivityHostElement } from '../src/components/nodel-connectivity-host';
import { flush, waitFor } from './helpers';

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

describe('nodel connectivity presentation', () => {
  beforeEach(() => {
    setOnline(true);
    window.history.replaceState(undefined, '', '/components.html');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defaults to a non-dismissible modal and restores content state and focus', async () => {
    document.body.innerHTML = `
      <nodel-app>
        <main id="content"><input id="field" value="preserved" /><button id="control">Control</button></main>
      </nodel-app>
    `;
    await flush();
    const content = document.querySelector<HTMLElement>('#content')!;
    const field = document.querySelector<HTMLInputElement>('#field')!;
    const host = document.querySelector('nodel-connectivity-host') as NodelConnectivityHostElement;
    field.value = 'operator entry';
    field.focus();

    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    await flush();

    expect(host.hidden).toBe(false);
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(host.querySelector('[aria-modal="true"]')).not.toBeNull();
    expect(content.inert).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('[role="alertdialog"]'));
    host.querySelector('.nodel-connectivity-backdrop')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.hidden).toBe(false);

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => host.hidden);
    await flush();

    expect(content.hasAttribute('inert')).toBe(false);
    expect(field.value).toBe('operator entry');
    expect(document.activeElement).toBe(field);
  });

  it('keeps overlay mode non-blocking and switches modes without losing authored inert state', async () => {
    document.body.innerHTML = `
      <nodel-app offline-mode="overlay">
        <main id="content"><input id="field" /></main>
        <aside id="authored-inert" inert></aside>
      </nodel-app>
    `;
    await flush();
    const app = document.querySelector('nodel-app')!;
    const content = document.querySelector<HTMLElement>('#content')!;
    const authoredInert = document.querySelector<HTMLElement>('#authored-inert')!;
    const field = document.querySelector<HTMLInputElement>('#field')!;
    const host = document.querySelector('nodel-connectivity-host') as NodelConnectivityHostElement;
    field.focus();

    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    await flush();

    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('[aria-live="assertive"]')).not.toBeNull();
    expect(content.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(field);

    app.setAttribute('offline-mode', 'modal');
    await flush();
    expect(content.inert).toBe(true);
    expect(authoredInert.inert).toBe(true);
    const added = document.createElement('section');
    app.append(added);
    await flush();
    expect(added.inert).toBe(true);

    app.setAttribute('offline-mode', 'overlay');
    await flush();
    expect(content.inert).toBe(false);
    expect(authoredInert.inert).toBe(true);
    expect(added.inert).toBe(false);
    expect(document.activeElement).toBe(field);
  });
});
