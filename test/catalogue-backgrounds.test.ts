import { flush, waitFor } from './helpers';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import '../src/components/nodel-button';
import '../src/components/nodel-select';
import '../src/components/nodel-palette';
import { createCatalogueRuntime } from '../src/catalogue/runtime';
import { installControlRuntime } from '../src/data/control-runtime';

function sectionMarkup() {
  return '<section data-background-catalogue-section><div data-background-catalogue="backgrounds"></div><div data-background-catalogue-markup></div></section>';
}

function catalogueMarkup() {
  return `<script type="module" data-nodel-runtime="memory"></script>${sectionMarkup()}`;
}

function wrappedCatalogueMarkup() {
  return `<script type="module" data-nodel-runtime="memory"></script><div data-background-root><div data-background-parent>${sectionMarkup()}</div></div>`;
}

describe('catalogue background integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState(undefined, '', '/components.html');
  });

  it('does not bind controls when the memory marker is absent', async () => {
    const subscribe = vi.fn(() => ({ dispose: vi.fn() }));
    const restore = installControlRuntime({ callAction: vi.fn(), subscribeSignals: subscribe });
    const { mountBackgroundCatalogue } = await import('../src/catalogue/backgrounds');
    document.body.innerHTML = sectionMarkup();

    await mountBackgroundCatalogue();

    expect(subscribe).not.toHaveBeenCalled();
    expect(document.querySelector('[data-background-catalogue="backgrounds"]')?.textContent).toBe('');
    restore();
  });

  it('aborts a mount if the marker disappears during bootstrap', async () => {
    document.body.innerHTML = `<script type="module" data-nodel-runtime="memory"></script>${sectionMarkup()}`;
    const runtime = createCatalogueRuntime();
    const restore = installControlRuntime(runtime);
    const { mountBackgroundCatalogue } = await import('../src/catalogue/backgrounds');
    const pending = mountBackgroundCatalogue();
    document.querySelector('[data-nodel-runtime]')?.remove();
    await pending;

    expect(document.querySelector('[data-background-catalogue="backgrounds"]')?.textContent).toBe('');
    restore();
  });

  it('uses real component actions and signal feedback for selection and colour', async () => {
    document.body.innerHTML = catalogueMarkup();
    const runtime = createCatalogueRuntime();
    const callAction = vi.spyOn(runtime, 'callAction');
    const restore = installControlRuntime(runtime);
    const { mountBackgroundCatalogue } = await import('../src/catalogue/backgrounds');
    await mountBackgroundCatalogue();
    const host = document.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
    const section = document.querySelector<HTMLElement>('[data-background-catalogue-section]')!;
    await waitFor(() => Boolean(host.querySelector('[data-background-preview]')));

    const select = host.querySelector('nodel-select')!;
    select.querySelector<HTMLButtonElement>('.nodel-select-trigger')?.click();
    select.querySelector<HTMLElement>('nodel-button[value="ripples"]')?.click();
    await flush();
    expect(callAction.mock.calls[0]?.slice(0, 2)).toEqual(['SetCatalogueBackgroundPattern', { arg: 'ripples' }]);
    expect(callAction.mock.calls.filter(([name]) => name === 'SetCatalogueBackgroundPattern')).toHaveLength(1);
    expect(select.getAttribute('value')).toBe('ripples');

    const color = host.querySelector<HTMLInputElement>('[data-background-field="color"]')!;
    color.value = '#a1b2c3';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(callAction.mock.calls[1]?.slice(0, 2)).toEqual(['SetCatalogueBackgroundColor', { arg: 'rgb(161 178 195)' }]);
    expect(callAction.mock.calls.filter(([name]) => name === 'SetCatalogueBackgroundColor')).toHaveLength(1);
    expect(section.querySelector('[data-background-markup="app"] code')?.textContent).toContain('background-color="rgb(161 178 195)"');
    restore();
  });

  it('keeps valid output while colour and numeric drafts are invalid', async () => {
    document.body.innerHTML = catalogueMarkup();
    const restore = installControlRuntime(createCatalogueRuntime());
    const { mountBackgroundCatalogue } = await import('../src/catalogue/backgrounds');
    await mountBackgroundCatalogue();
    const host = document.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
    const section = document.querySelector<HTMLElement>('[data-background-catalogue-section]')!;
    await waitFor(() => Boolean(host.querySelector('[data-background-preview]')));
    const original = section.querySelector('[data-background-markup="app"] code')?.textContent;
    const color = host.querySelector<HTMLInputElement>('[data-background-field="color"]')!;
    color.value = 'rgb(1 2 3 / .5)';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    const number = host.querySelector<HTMLInputElement>('#background-strength-number')!;
    number.value = '';
    number.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();

    expect(color.getAttribute('aria-invalid')).toBe('true');
    expect(number.getAttribute('aria-invalid')).toBe('true');
    expect(section.querySelector('[data-background-markup="app"] code')?.textContent).toBe(original);
    expect(section.querySelector<HTMLButtonElement>('[data-background-copy="app"]')?.disabled).toBe(true);
    restore();
  });

  it('preserves focused sequential drafts while preview state is normalized', async () => {
    document.body.innerHTML = catalogueMarkup();
    const restore = installControlRuntime(createCatalogueRuntime());
    const { mountBackgroundCatalogue } = await import('../src/catalogue/backgrounds');
    await mountBackgroundCatalogue();
    const host = document.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
    const section = document.querySelector<HTMLElement>('[data-background-catalogue-section]')!;
    const color = host.querySelector<HTMLInputElement>('[data-background-field="color"]')!;
    color.focus();
    color.value = '#abc';
    color.setSelectionRange(4, 4);
    color.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(color.value).toBe('#abc');
    expect(color.selectionStart).toBe(4);
    expect(section.querySelector('[data-background-markup="app"] code')?.textContent).toContain('background-color="rgb(170 187 204)"');
    for (const character of 'def') {
      color.value += character;
      color.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
    }
    expect(color.value).toBe('#abcdef');
    expect(section.querySelector('[data-background-markup="app"] code')?.textContent).toContain('background-color="rgb(171 205 239)"');

    const scale = host.querySelector<HTMLInputElement>('#background-scale-number')!;
    scale.focus();
    scale.value = '1';
    scale.dispatchEvent(new Event('input', { bubbles: true }));
    expect(scale.value).toBe('1');
    expect(host.querySelector<HTMLInputElement>('#background-scale-range')?.value).toBe('25');
    scale.value += '50';
    scale.dispatchEvent(new Event('input', { bubbles: true }));
    expect(scale.value).toBe('150');
    expect(host.querySelector<HTMLInputElement>('#background-scale-range')?.value).toBe('150');
    scale.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    expect(scale.value).toBe('150');
    color.focus();
    color.value = '#abc';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    section.querySelector<HTMLButtonElement>('[data-background-copy="app"]')?.click();
    expect(color.value).toBe('rgb(170 187 204)');
    expect(section.querySelector('[data-background-markup="app"] code')?.textContent).toContain('background-color="rgb(170 187 204)"');
    restore();
  });

  it('replaces a focused invalid colour draft only for external colour feedback', async () => {
    document.body.innerHTML = catalogueMarkup();
    const runtime = createCatalogueRuntime();
    const restore = installControlRuntime(runtime);
    const { mountBackgroundCatalogue } = await import('../src/catalogue/backgrounds');
    await mountBackgroundCatalogue();
    const host = document.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
    const section = document.querySelector<HTMLElement>('[data-background-catalogue-section]')!;
    const color = host.querySelector<HTMLInputElement>('[data-background-field="color"]')!;
    const error = host.querySelector<HTMLElement>('[data-background-color-error]')!;
    const copy = section.querySelector<HTMLButtonElement>('[data-background-copy="app"]')!;

    color.focus();
    color.value = '#abc';
    color.setSelectionRange(4, 4);
    color.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(document.activeElement).toBe(color);
    expect(color.value).toBe('#abc');
    expect(color.selectionStart).toBe(4);

    color.value = 'invalid';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    await runtime.callAction('SetCatalogueBackgroundPattern', { arg: 'ripples' });
    await flush();
    expect(document.activeElement).toBe(color);
    expect(color.value).toBe('invalid');
    expect(color.getAttribute('aria-invalid')).toBe('true');
    expect(error.textContent).toContain('Enter an opaque RGB');
    expect(copy.disabled).toBe(true);

    await runtime.callAction('SetCatalogueBackgroundColor', { arg: '#abcdef' });
    await flush();
    expect(document.activeElement).toBe(color);
    expect(color.value).toBe('rgb(171 205 239)');
    expect(color.getAttribute('aria-invalid')).toBe('false');
    expect(error.textContent).toBe('');
    expect(copy.disabled).toBe(false);
    expect(section.querySelector('[data-background-markup="app"] code')?.textContent).toContain('background-color="rgb(171 205 239)"');
    restore();
  });

  it('recovers only the colour draft from valid palette and theme feedback', async () => {
    document.body.innerHTML = catalogueMarkup();
    const runtime = createCatalogueRuntime();
    const callAction = vi.spyOn(runtime, 'callAction');
    const restore = installControlRuntime(runtime);
    const { mountBackgroundCatalogue } = await import('../src/catalogue/backgrounds');
    await mountBackgroundCatalogue();
    const host = document.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
    const section = document.querySelector<HTMLElement>('[data-background-catalogue-section]')!;
    const color = host.querySelector<HTMLInputElement>('[data-background-field="color"]')!;

    color.value = 'rgb(1 2 3 / .5)';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    host.querySelector<HTMLElement>('nodel-palette nodel-button[value="#f0f3f5"]')?.click();
    await flush();

    expect(color.value).toBe('rgb(240 243 245)');
    expect(color.getAttribute('aria-invalid')).toBe('false');
    expect(section.querySelector<HTMLButtonElement>('[data-background-copy="app"]')?.disabled).toBe(false);
    expect(callAction.mock.calls.filter(([name]) => name === 'SetCatalogueBackgroundColor')).toHaveLength(1);

    color.value = 'invalid';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    host.querySelector<HTMLButtonElement>('nodel-button[arg="theme"] button')?.click();
    await flush();

    expect(color.value).toBe('theme');
    expect(color.getAttribute('aria-invalid')).toBe('false');
    expect(section.querySelector<HTMLButtonElement>('[data-background-copy="app"]')?.disabled).toBe(false);
    expect(callAction.mock.calls.filter(([name]) => name === 'SetCatalogueBackgroundColor')).toHaveLength(2);
    restore();
  });

  it('retains an unrelated invalid numeric draft until a clamped valid correction', async () => {
    document.body.innerHTML = catalogueMarkup();
    const runtime = createCatalogueRuntime();
    const restore = installControlRuntime(runtime);
    const { mountBackgroundCatalogue } = await import('../src/catalogue/backgrounds');
    await mountBackgroundCatalogue();
    const host = document.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
    const section = document.querySelector<HTMLElement>('[data-background-catalogue-section]')!;
    const strength = host.querySelector<HTMLInputElement>('#background-strength-number')!;

    strength.value = '';
    strength.dispatchEvent(new Event('input', { bubbles: true }));
    const select = host.querySelector('nodel-select')!;
    select.querySelector<HTMLButtonElement>('.nodel-select-trigger')?.click();
    select.querySelector<HTMLElement>('nodel-button[value="ripples"]')?.click();
    await flush();

    expect(strength.value).toBe('');
    expect(strength.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('[data-background-number-error="patternStrength"]')?.textContent).toContain('Enter a number');
    expect(section.querySelector<HTMLButtonElement>('[data-background-copy="app"]')?.disabled).toBe(true);

    strength.focus();
    strength.value = '150';
    strength.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();

    expect(strength.value).toBe('150');
    expect(host.querySelector<HTMLInputElement>('#background-strength-range')?.value).toBe('100');
    expect(strength.getAttribute('aria-invalid')).toBe('false');
    expect(section.querySelector('[data-background-markup="app"] code')?.textContent).toContain('background-pattern-strength="100"');
    expect(section.querySelector<HTMLButtonElement>('[data-background-copy="app"]')?.disabled).toBe(false);
    strength.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    expect(strength.value).toBe('100');
    restore();
  });

  it('represents theme as a sentinel and cleans subscriptions on remount', async () => {
    document.body.innerHTML = catalogueMarkup();
    const runtime = createCatalogueRuntime();
    const restore = installControlRuntime(runtime);
    const { mountBackgroundCatalogue } = await import('../src/catalogue/backgrounds');
    const dispose = await mountBackgroundCatalogue();
    const host = document.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
    const section = document.querySelector<HTMLElement>('[data-background-catalogue-section]')!;
    await waitFor(() => Boolean(host.querySelector('[data-background-preview]')));
    await runtime.callAction('SetCatalogueBackgroundColor', { arg: 'theme' });
    await flush();
    expect(host.querySelector('[data-background-theme-status]')?.hasAttribute('hidden')).toBe(false);
    expect(host.querySelector('nodel-palette')?.getAttribute('value')).toBe('');
    expect(section.querySelector('[data-background-markup="page"] code')?.textContent).toContain('background-color="theme"');
    dispose();
    expect(host.dataset.backgroundCatalogueMounted).toBeUndefined();
    restore();
  });

  it('disposes a removed catalogue parent and remounts it without treating hiding as teardown', async () => {
    document.body.innerHTML = wrappedCatalogueMarkup();
    const runtime = createCatalogueRuntime();
    const originalSubscribe = runtime.subscribeSignals.bind(runtime);
    const subscriptionDisposers: Array<{ element: Element; dispose: ReturnType<typeof vi.fn> }> = [];
    vi.spyOn(runtime, 'subscribeSignals').mockImplementation((element, listener) => {
      const subscription = originalSubscribe(element, listener);
      const dispose = vi.fn(() => subscription.dispose());
      subscriptionDisposers.push({ element, dispose });
      return { dispose };
    });
    const restore = installControlRuntime(runtime);
    const jsViews = await import('../src/jsviews/jsviews-runtime');
    const jq = await jsViews.bootstrapJsViews();
    const unlink = vi.spyOn(jq, 'unlink');
    const { startCatalogueMounting } = await import('../src/catalogue/backgrounds');
    const stop = startCatalogueMounting();
    const oldSection = document.querySelector<HTMLElement>('[data-background-catalogue-section]')!;
    const oldHost = oldSection.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
    const root = document.querySelector<HTMLElement>('[data-background-root]')!;
    const parent = document.querySelector<HTMLElement>('[data-background-parent]')!;
    await waitFor(() => oldHost.dataset.backgroundCatalogueMounted === 'pending' && Boolean(oldHost.querySelector('[data-background-preview]')));
    const oldCode = oldSection.querySelector<HTMLElement>('[data-background-markup="app"] code')!;
    const color = oldHost.querySelector<HTMLInputElement>('[data-background-field="color"]')!;
    color.value = '#345678';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    root.hidden = true;
    await flush();
    root.hidden = false;
    expect(color.value).toBe('rgb(52 86 120)');
    expect(subscriptionDisposers.filter(({ element }) => element === oldHost)).toHaveLength(1);

    parent.remove();
    await waitFor(() => subscriptionDisposers.filter(({ element }) => element === oldHost)[0]?.dispose.mock.calls.length === 1);
    expect(unlink).toHaveBeenCalled();
    expect(oldHost.dataset.backgroundCatalogueMounted).toBeUndefined();
    const detachedCode = oldCode.textContent;
    await runtime.callAction('SetCatalogueBackgroundPattern', { arg: 'ripples' });
    await flush();
    expect(oldCode.textContent).toBe(detachedCode);

    root.append(parent);
    await waitFor(() => subscriptionDisposers.filter(({ element }) => element === oldHost).length === 2);
    const ownedSubscriptions = subscriptionDisposers.filter(({ element }) => element === oldHost);
    expect(ownedSubscriptions[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(oldCode.textContent).toContain('background-color="rgb(52 86 120)"');
    expect(oldCode.textContent).toContain('background-pattern="ripples"');

    stop();
    stop();
    expect(ownedSubscriptions[1]?.dispose).toHaveBeenCalledTimes(1);
    restore();
  });

  it('cleans an active mount when a higher catalogue ancestor is removed and restored', async () => {
    document.body.innerHTML = wrappedCatalogueMarkup();
    const runtime = createCatalogueRuntime();
    const originalSubscribe = runtime.subscribeSignals.bind(runtime);
    const ownedDisposers: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(runtime, 'subscribeSignals').mockImplementation((element, listener) => {
      const subscription = originalSubscribe(element, listener);
      const dispose = vi.fn(() => subscription.dispose());
      if ((element as HTMLElement).matches('[data-background-catalogue="backgrounds"]')) ownedDisposers.push(dispose);
      return { dispose };
    });
    const restore = installControlRuntime(runtime);
    const { startCatalogueMounting } = await import('../src/catalogue/backgrounds');
    const root = document.querySelector<HTMLElement>('[data-background-root]')!;
    const host = root.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
    const stop = startCatalogueMounting();
    await waitFor(() => ownedDisposers.length === 1);

    root.remove();
    await waitFor(() => ownedDisposers[0]?.mock.calls.length === 1);
    expect(host.dataset.backgroundCatalogueMounted).toBeUndefined();

    document.body.append(root);
    await waitFor(() => ownedDisposers.length === 2);
    expect(ownedDisposers[0]).toHaveBeenCalledTimes(1);
    expect(ownedDisposers[1]).not.toHaveBeenCalled();
    stop();
    expect(ownedDisposers[1]).toHaveBeenCalledTimes(1);
    restore();
  });

  it('does not let a stale pending bootstrap claim a replacement host', async () => {
    document.body.innerHTML = wrappedCatalogueMarkup();
    const runtime = createCatalogueRuntime();
    const originalSubscribe = runtime.subscribeSignals.bind(runtime);
    const subscriptionDisposers: Array<{ element: Element; dispose: ReturnType<typeof vi.fn> }> = [];
    vi.spyOn(runtime, 'subscribeSignals').mockImplementation((element, listener) => {
      const subscription = originalSubscribe(element, listener);
      const dispose = vi.fn(() => subscription.dispose());
      subscriptionDisposers.push({ element, dispose });
      return { dispose };
    });
    const restore = installControlRuntime(runtime);
    const { startCatalogueMounting } = await import('../src/catalogue/backgrounds');
    const root = document.querySelector<HTMLElement>('[data-background-root]')!;
    const oldHost = root.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
    const stop = startCatalogueMounting();
    root.remove();
    await flush();

    expect(oldHost.dataset.backgroundCatalogueMounted).toBeUndefined();
    document.body.append(root);
    await waitFor(() => Boolean(oldHost.querySelector('[data-background-preview]')) && oldHost.dataset.backgroundCatalogueMounted === 'pending');
    await waitFor(() => subscriptionDisposers.filter(({ element, dispose }) => element === oldHost && dispose.mock.calls.length === 0).length === 1);
    const ownedSubscriptions = subscriptionDisposers.filter(({ element }) => element === oldHost);
    expect(ownedSubscriptions.filter(({ dispose }) => dispose.mock.calls.length === 0)).toHaveLength(1);
    stop();
    expect(ownedSubscriptions.every(({ dispose }) => dispose.mock.calls.length === 1)).toBe(true);
    restore();
  });

  it('reclaims the same host reinserted before its stale bootstrap completes', async () => {
    const { startCatalogueMounting } = await import('../src/catalogue/backgrounds');
    document.body.innerHTML = wrappedCatalogueMarkup();
    const runtime = createCatalogueRuntime();
    const originalSubscribe = runtime.subscribeSignals.bind(runtime);
    const subscriptions: Array<{ element: Element; dispose: ReturnType<typeof vi.fn> }> = [];
    vi.spyOn(runtime, 'subscribeSignals').mockImplementation((element, listener) => {
      const subscription = originalSubscribe(element, listener);
      const dispose = vi.fn(() => subscription.dispose());
      subscriptions.push({ element, dispose });
      return { dispose };
    });
    const restoreRuntime = installControlRuntime(runtime);
    const jsViews = await import('../src/jsviews/jsviews-runtime');
    const jq = await jsViews.bootstrapJsViews();
    const originalBootstrap = jsViews.bootstrapJsViews;
    let releaseBootstrap!: (value: typeof jq) => void;
    const bootstrapGate = new Promise<typeof jq>((resolvePromise) => { releaseBootstrap = resolvePromise; });
    const bootstrap = vi.spyOn(jsViews, 'bootstrapJsViews').mockReturnValueOnce(bootstrapGate).mockImplementation(originalBootstrap);
    const root = document.querySelector<HTMLElement>('[data-background-root]')!;
    const parent = document.querySelector<HTMLElement>('[data-background-parent]')!;
    const host = parent.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
    const stop = startCatalogueMounting();
    await waitFor(() => bootstrap.mock.calls.length === 1 && host.dataset.backgroundCatalogueMounted === 'pending');

    parent.remove();
    await flush();
    root.append(parent);
    releaseBootstrap(jq);
    await flush();
    expect(bootstrap.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(bootstrap.mock.results[1]?.value).not.toBe(bootstrapGate);
    await bootstrap.mock.results[1]?.value;
    await flush();
    const ownedSubscriptions = () => subscriptions.filter(({ element }) => element === host);
    await waitFor(() => ownedSubscriptions().length === 1 && Boolean(host.querySelector('[data-background-preview]')));

    expect(ownedSubscriptions()).toHaveLength(1);
    expect(ownedSubscriptions()[0]?.dispose).not.toHaveBeenCalled();
    const select = host.querySelector('nodel-select')!;
    select.querySelector<HTMLButtonElement>('.nodel-select-trigger')?.click();
    select.querySelector<HTMLElement>('nodel-button[value="ripples"]')?.click();
    const scale = host.querySelector<HTMLInputElement>('#background-scale-number')!;
    scale.value = '150';
    scale.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(select.getAttribute('value')).toBe('ripples');
    expect(host.querySelector<HTMLInputElement>('#background-scale-range')?.value).toBe('150');
    expect(document.querySelector('[data-background-markup="app"] code')?.textContent).toContain('background-pattern="ripples"');
    expect(document.querySelector('[data-background-markup="app"] code')?.textContent).toContain('background-pattern-scale="150"');

    stop();
    expect(ownedSubscriptions()[0]?.dispose).toHaveBeenCalledTimes(1);
    bootstrap.mockRestore();
    restoreRuntime();
  });

  it('does not subscribe when stopped pending bootstrap later completes', async () => {
    const { startCatalogueMounting } = await import('../src/catalogue/backgrounds');
    document.body.innerHTML = wrappedCatalogueMarkup();
    const runtime = createCatalogueRuntime();
    const subscribe = vi.spyOn(runtime, 'subscribeSignals');
    const restoreRuntime = installControlRuntime(runtime);
    const jsViews = await import('../src/jsviews/jsviews-runtime');
    const jq = await jsViews.bootstrapJsViews();
    const originalBootstrap = jsViews.bootstrapJsViews;
    let releaseBootstrap!: (value: typeof jq) => void;
    const bootstrapGate = new Promise<typeof jq>((resolvePromise) => { releaseBootstrap = resolvePromise; });
    const bootstrap = vi.spyOn(jsViews, 'bootstrapJsViews').mockReturnValueOnce(bootstrapGate).mockImplementation(originalBootstrap);
    const host = document.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
    const stop = startCatalogueMounting();
    await waitFor(() => bootstrap.mock.calls.length === 1 && host.dataset.backgroundCatalogueMounted === 'pending');
    stop();
    releaseBootstrap(jq);
    await flush();
    await flush();

    expect(subscribe).not.toHaveBeenCalled();
    expect(host.dataset.backgroundCatalogueMounted).toBeUndefined();
    expect(host.querySelector('[data-background-preview]')).toBeNull();
    bootstrap.mockRestore();
    restoreRuntime();
  });

  it.each(['resolve', 'reject'] as const)('ignores deferred clipboard %s after actual section removal', async (outcome) => {
    document.body.innerHTML = catalogueMarkup();
    const runtime = createCatalogueRuntime();
    const restoreRuntime = installControlRuntime(runtime);
    let settle!: (value?: void | PromiseLike<void>) => void;
    let reject!: (reason?: unknown) => void;
    const clipboardPromise = new Promise<void>((resolvePromise, rejectPromise) => {
      settle = resolvePromise;
      reject = rejectPromise;
    });
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const execCommand = document.execCommand;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => clipboardPromise) } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    const { startCatalogueMounting } = await import('../src/catalogue/backgrounds');
    const stop = startCatalogueMounting();
    const section = document.querySelector<HTMLElement>('[data-background-catalogue-section]')!;
    await waitFor(() => Boolean(section.querySelector('[data-background-preview]')));
    const status = section.querySelector<HTMLElement>('[data-background-copy-status]')!;
    section.querySelector<HTMLButtonElement>('[data-background-copy="app"]')?.click();
    section.remove();
    await flush();

    if (outcome === 'resolve') settle();
    else reject(new Error('blocked'));
    await flush();
    await flush();

    expect(status.textContent).toBe('');
    expect(unhandled).not.toHaveBeenCalled();
    stop();
    window.removeEventListener('unhandledrejection', unhandled);
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else delete (navigator as unknown as { clipboard?: Clipboard }).clipboard;
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    restoreRuntime();
  });

  it('renders standard code blocks beside the examples inside the Backgrounds section', async () => {
    const componentsUi = await readFile(resolve(process.cwd(), 'components.html'), 'utf8');
    const template = document.createElement('template');
    template.innerHTML = componentsUi;
    const section = template.content.querySelector<HTMLElement>('[data-background-catalogue-section]')!;
    const examples = section.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
    const markupHost = section.querySelector<HTMLElement>('[data-background-catalogue-markup]')!;

    expect(markupHost).not.toBeNull();
    expect(examples.contains(markupHost)).toBe(false);

    document.body.innerHTML = `<script type="module" data-nodel-runtime="memory"></script>${section.outerHTML}`;
    const restore = installControlRuntime(createCatalogueRuntime());
    const { mountBackgroundCatalogue } = await import('../src/catalogue/backgrounds');
    const dispose = await mountBackgroundCatalogue();
    const renderedSection = document.querySelector<HTMLElement>('[data-background-catalogue-section]')!;
    const renderedExamples = renderedSection.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
    const blocks = Array.from(renderedSection.querySelectorAll<HTMLElement>('[data-background-markup]'));

    expect(blocks).toHaveLength(2);
    expect(blocks.every((block) => block.matches('pre.nodel-catalogue-code'))).toBe(true);
    expect(blocks.every((block) => !renderedExamples.contains(block))).toBe(true);
    expect(blocks.every((block) => !block.hasAttribute('data-catalogue-code-for'))).toBe(true);
    expect(blocks.every((block) => block.tabIndex === 0)).toBe(true);
    dispose();
    restore();
  });
});
