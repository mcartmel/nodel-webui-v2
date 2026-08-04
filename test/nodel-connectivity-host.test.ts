import '../src/components/nodel-app';
import type { NodelConnectivityHostElement } from '../src/components/nodel-connectivity-host';
import type { NodelConfirmHostElement } from '../src/components/nodel-confirm-host';
import type { NodelActivityLogEntry } from '../src/api/nodel-types';
import type { NodelControlRuntime, NodelControlSignalState } from '../src/data/control-runtime';
import { installControlRuntime } from '../src/data/control-runtime';
import { flush, waitFor } from './helpers';

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

function signalEntry(alias: string, arg: unknown): NodelActivityLogEntry {
  return { seq: 1, timestamp: '2026-08-04T00:00:00Z', source: 'local', type: 'event', alias, arg };
}

describe('nodel connectivity presentation', () => {
  let restoreRuntime: (() => void) | null = null;

  beforeEach(() => {
    setOnline(true);
    window.history.replaceState(undefined, '', '/components.html');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch);
  });

  afterEach(() => {
    restoreRuntime?.();
    restoreRuntime = null;
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

  it('restores the connectivity layer after a top confirmation closes', async () => {
    document.body.innerHTML = '<nodel-app><main id="content"><button>Control</button></main></nodel-app>';
    await flush();
    const connectivity = document.querySelector('nodel-connectivity-host') as NodelConnectivityHostElement;
    const confirm = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;

    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    await flush();
    expect(document.activeElement).toBe(connectivity.querySelector('[role="alertdialog"]'));

    confirm.confirm({ text: 'Confirm layered focus?', resolve: vi.fn() }, connectivity.querySelector('[role="alertdialog"]'));
    await flush();
    expect(connectivity.inert).toBe(true);
    expect(document.activeElement).toBe(confirm.querySelector('[data-confirm-action="confirm"]'));

    confirm.querySelector<HTMLButtonElement>('[data-confirm-action="cancel"]')?.click();
    await flush();
    expect(connectivity.inert).toBe(false);
    expect(document.activeElement).toBe(connectivity.querySelector('[role="alertdialog"]'));

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => connectivity.hidden);
  });

  it('keeps connectivity top when a code confirmation rerenders from a signal update', async () => {
    let signalListener: (state: NodelControlSignalState) => void = () => {
      throw new Error('Code confirmation did not subscribe to signals.');
    };
    const runtime: NodelControlRuntime = {
      callAction: vi.fn(async () => ({})),
      subscribeSignals: vi.fn((_element, listener) => {
        signalListener = listener;
        return { dispose: vi.fn() };
      })
    };
    restoreRuntime = installControlRuntime(runtime);
    document.body.innerHTML = '<nodel-app><main><button>Control</button></main></nodel-app>';
    await flush();
    const connectivity = document.querySelector('nodel-connectivity-host') as NodelConnectivityHostElement;
    const confirm = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
    const resolved = vi.fn();

    confirm.confirm({ mode: 'code', codeSignal: 'OperatorPin', resolve: resolved });
    await flush();
    expect(document.activeElement).toBe(confirm.querySelector('button[data-confirm-action="cancel"]'));

    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    await flush();
    const connectivityDialog = connectivity.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(document.activeElement).toBe(connectivityDialog);
    expect(confirm.inert).toBe(true);

    signalListener({
      loading: false,
      connected: true,
      error: '',
      entries: [signalEntry('OperatorPin', '1234')]
    });
    await flush();

    expect(confirm.inert).toBe(true);
    expect(document.activeElement).toBe(connectivityDialog);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }));
    expect(document.activeElement).toBe(connectivityDialog);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(resolved).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(connectivityDialog);

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => connectivity.hidden);
    await flush();
    expect(document.activeElement).toBe(confirm.querySelector('[data-confirm-code-digit="1"]'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(resolved).toHaveBeenCalledWith(false);
  });
});
