import { createNodelComponentLoader } from '../src/nodel-component-loader';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected test value to be present');
  return value;
}

let sequence = 0;

function tagName() {
  sequence += 1;
  return `nodel-test-loader-${sequence}`;
}

function defineImporter(tag: string, outcome: 'success' | 'failure' = 'success') {
  return vi.fn(async () => {
    if (outcome === 'failure') throw new Error('private chunk response must not be exposed');
    customElements.define(tag, class extends HTMLElement {});
  });
}

describe('nodel component loader', () => {
  const loadErrorListeners = new Set<EventListener>();

  afterEach(() => {
    for (const listener of loadErrorListeners) {
      window.removeEventListener('nodel-component-load-error', listener);
    }
    loadErrorListeners.clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders one safe fallback for initial and dynamic failures and preserves markup', async () => {
    const tag = tagName();
    const loader = createNodelComponentLoader({ loaders: { [tag]: defineImporter(tag, 'failure') } });
    const initial = document.createElement(tag);
    initial.setAttribute('data-authored', 'yes');
    initial.innerHTML = '<span>Keep this authored content</span>';
    document.body.append(initial);
    loader.bootstrapNodelComponentLoader();
    await vi.waitFor(() => expect(document.querySelectorAll('.nodel-component-fallback')).toHaveLength(1));
    const dynamic = document.createElement(tag);
    document.body.append(dynamic);
    await vi.waitFor(() => expect(document.querySelectorAll('.nodel-component-fallback')).toHaveLength(2));
    const fallback = initial.nextElementSibling as HTMLElement;
    expect(initial.getAttribute('data-authored')).toBe('yes');
    expect(initial.innerHTML).toContain('Keep this authored content');
    expect(fallback.getAttribute('role')).toBe('alert');
    expect(fallback.className).toBe('nodel-component-fallback nodel-alert nodel-alert-danger nodel-alert-md');
    expect(fallback.textContent).not.toContain('private chunk');
    expect(fallback.querySelector('[data-nodel-component-retry]')).not.toBeNull();
    expect(fallback.querySelector('[data-nodel-component-reload]')).not.toBeNull();
    loader.dispose();
  });

  it('single-flights concurrent callers, reports one event per generation, and retries', async () => {
    const tag = tagName();
    let rejectLoad = true;
    const importer = vi.fn(async () => {
      if (rejectLoad) throw new Error('unbounded response');
      customElements.define(tag, class extends HTMLElement {});
    });
    const loader = createNodelComponentLoader({ loaders: { [tag]: importer } });
    const events: Event[] = [];
    const listener: EventListener = (event) => events.push(event);
    loadErrorListeners.add(listener);
    window.addEventListener('nodel-component-load-error', listener);
    const first = loader.loadNodelComponent(tag);
    const second = loader.loadNodelComponent(tag);
    await expect(first).rejects.toThrow(/unbounded response/);
    await expect(second).rejects.toThrow(/Failed to load/);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect((events[0] as CustomEvent).detail.message).toContain('unbounded response');
    expect((events[0] as CustomEvent).detail.message.length).toBeLessThanOrEqual(200);
    expect((events[0] as CustomEvent).detail.attemptGeneration).toBe(1);
    rejectLoad = false;
    await loader.loadNodelComponent(tag);
    expect(importer).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(1);
    loader.dispose();
  });

  it('single-flights concurrent automatic instances and emits one contextual failure', async () => {
    const tag = tagName();
    const importer = vi.fn(async () => { throw new Error('chunk-context'); });
    const loader = createNodelComponentLoader({ loaders: { [tag]: importer } });
    const events: CustomEvent[] = [];
    const listener: EventListener = (event) => events.push(event as CustomEvent);
    loadErrorListeners.add(listener);
    window.addEventListener('nodel-component-load-error', listener);
    document.body.innerHTML = `<${tag}></${tag}><${tag}></${tag}>`;
    loader.bootstrapNodelComponentLoader();
    await vi.waitFor(() => expect(document.querySelectorAll('.nodel-component-fallback')).toHaveLength(2));
    expect(importer).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(required(events[0]).detail.message).toContain('chunk-context');
    loader.dispose();
  });

  it('keeps the generic fallback while a retry succeeds and removes every fallback after definition', async () => {
    const tag = tagName();
    let attempt = 0;
    let resolveRetry: (() => void) | undefined;
    const importer = vi.fn(() => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error('initial context'));
      return new Promise<void>((resolve) => {
        resolveRetry = () => {
          customElements.define(tag, class extends HTMLElement {});
          resolve();
        };
      });
    });
    const loader = createNodelComponentLoader({ loaders: { [tag]: importer } });
    loader.bootstrapNodelComponentLoader();
    document.body.innerHTML = `<${tag}></${tag}><${tag}></${tag}>`;
    await vi.waitFor(() => expect(document.querySelectorAll('.nodel-component-fallback')).toHaveLength(2));
    const retries = [...document.querySelectorAll<HTMLButtonElement>(`[data-nodel-component-retry="${tag}"]`)];
    required(retries[0]).click();
    expect(retries.every((button) => button.disabled)).toBe(true);
    await vi.waitFor(() => expect(importer).toHaveBeenCalledTimes(2));
    resolveRetry?.();
    await vi.waitFor(() => expect(document.querySelectorAll('.nodel-component-fallback')).toHaveLength(0));
    expect(customElements.get(tag)).toBeDefined();
    loader.dispose();
  });

  it('disables every retry while pending, consumes retry failures, and reloads', async () => {
    const tag = tagName();
    let release: (() => void) | undefined;
    const importer = vi.fn(() => new Promise<unknown>((resolve) => {
      release = () => {
        customElements.define(tag, class extends HTMLElement {});
        resolve(undefined);
      };
    }));
    const reload = vi.fn();
    const loader = createNodelComponentLoader({ loaders: { [tag]: importer }, reload });
    loader.bootstrapNodelComponentLoader();
    const first = document.createElement(tag);
    const second = document.createElement(tag);
    document.body.append(first, second);
    await vi.waitFor(() => expect(document.querySelectorAll('.nodel-component-fallback')).toHaveLength(0));
    await vi.waitFor(() => expect(importer).toHaveBeenCalled());
    release?.();
    await vi.waitFor(() => expect(customElements.get(tag)).toBeDefined());
    const failedTag = tagName();
    const failedImporter = vi.fn(async () => { throw new Error('failure'); });
    const failedLoader = createNodelComponentLoader({ loaders: { [failedTag]: failedImporter }, reload });
    failedLoader.bootstrapNodelComponentLoader();
    document.body.append(document.createElement(failedTag), document.createElement(failedTag));
    await vi.waitFor(() => expect(document.querySelectorAll(`[data-nodel-component-retry="${failedTag}"]`)).toHaveLength(2));
    const retries = [...document.querySelectorAll<HTMLButtonElement>(`[data-nodel-component-retry="${failedTag}"]`)];
    required(retries[0]).click();
    expect(retries.every((button) => button.disabled)).toBe(true);
    await vi.waitFor(() => expect(retries.every((button) => !button.disabled)).toBe(true));
    expect(document.querySelectorAll('.nodel-component-fallback')).toHaveLength(2);
    document.querySelector<HTMLButtonElement>(`[data-nodel-component-reload="${failedTag}"]`)?.click();
    expect(reload).toHaveBeenCalledTimes(1);
    loader.dispose();
    failedLoader.dispose();
  });

  it('cleans removed instances and observer resources', async () => {
    const tag = tagName();
    const loader = createNodelComponentLoader({ loaders: { [tag]: defineImporter(tag, 'failure') } });
    loader.bootstrapNodelComponentLoader();
    const element = document.createElement(tag);
    document.body.append(element);
    await vi.waitFor(() => expect(element.nextElementSibling?.classList.contains('nodel-component-fallback')).toBe(true));
    const movedHost = document.createElement('section');
    document.body.append(movedHost);
    movedHost.append(element);
    await vi.waitFor(() => expect(element.nextElementSibling?.classList.contains('nodel-component-fallback')).toBe(true));
    element.remove();
    await Promise.resolve();
    expect(document.querySelector('.nodel-component-fallback')).toBeNull();
    loader.dispose();
    document.body.append(document.createElement(tag));
    await Promise.resolve();
    expect(document.querySelector('.nodel-component-fallback')).toBeNull();
  });

  it('does not report or render a pending failure after disposal', async () => {
    const tag = tagName();
    let rejectLoad: ((error: Error) => void) | undefined;
    const importer = vi.fn(() => new Promise<unknown>((_resolve, reject) => {
      rejectLoad = reject;
    }));
    const loader = createNodelComponentLoader({ loaders: { [tag]: importer } });
    const listener = vi.fn();
    loadErrorListeners.add(listener);
    window.addEventListener('nodel-component-load-error', listener);
    const element = document.createElement(tag);
    document.body.append(element);
    loader.bootstrapNodelComponentLoader();
    const pending = loader.loadNodelComponent(tag);
    await vi.waitFor(() => expect(importer).toHaveBeenCalledTimes(1));
    loader.dispose();
    rejectLoad?.(new Error('private pending response'));
    await expect(pending).rejects.toThrow(/Failed to load/);
    expect(listener).not.toHaveBeenCalled();
    expect(document.querySelector('.nodel-component-fallback')).toBeNull();
    await expect(loader.loadNodelComponent(tag)).rejects.toThrow('disposed');
    loader.bootstrapNodelComponentLoader();
    document.body.append(document.createElement(tag));
    await Promise.resolve();
    expect(document.querySelector('.nodel-component-fallback')).toBeNull();
  });

  it('bounds complete unknown and fallback messages', async () => {
    const loader = createNodelComponentLoader({ loaders: {} });
    const longUnknown = `nodel-${'x'.repeat(300)}`;
    const unknownError = await loader.loadNodelComponent(longUnknown).catch((error: unknown) => error);
    expect(unknownError).toBeInstanceOf(Error);
    expect((unknownError as Error).message.length).toBeLessThanOrEqual(200);
    const longTag = `nodel-${'y'.repeat(300)}`;
    const failing = createNodelComponentLoader({ loaders: { [longTag]: vi.fn(async () => { throw new Error('secret'); }) } });
    failing.bootstrapNodelComponentLoader();
    document.body.append(document.createElement(longTag));
    await vi.waitFor(() => expect(document.querySelector('.nodel-component-fallback')).not.toBeNull());
    expect(document.querySelector('.nodel-component-fallback')?.textContent?.length).toBeLessThanOrEqual(200);
    expect(document.querySelector('.nodel-component-fallback')?.textContent).not.toContain('secret');
    loader.dispose();
    failing.dispose();
  });
});
