const linkMock = vi.hoisted(() => {
  let resolveBootstrap!: (value: any) => void;
  let bootstrapPromise = new Promise<any>((resolve) => {
    resolveBootstrap = resolve;
  });
  const link = vi.fn();
  const unlink = vi.fn();
  const jq = Object.assign(vi.fn((target: unknown) => target), {
    templates: vi.fn(() => ({ link })),
    unlink
  });
  return {
    jq,
    link,
    unlink,
    resolve() {
      resolveBootstrap(jq);
    },
    reset() {
      bootstrapPromise = new Promise<any>((resolve) => {
        resolveBootstrap = resolve;
      });
      link.mockClear();
      unlink.mockClear();
      jq.mockClear();
      jq.templates.mockClear();
    },
    promise() {
      return bootstrapPromise;
    }
  };
});

vi.mock('../src/jsviews/jsviews-runtime', () => ({
  bootstrapJsViews: vi.fn(() => linkMock.promise())
}));

import { JsViewsLinkController } from '../src/jsviews/jsviews-link-controller';
import { ComponentLifecycle } from '../src/utils/component-lifecycle';

describe('component lifecycle', () => {
  beforeEach(() => {
    linkMock.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invalidates generations synchronously and disposes owned resources once', () => {
    const lifecycle = new ComponentLifecycle();
    const first = lifecycle.connect()!;
    const dispose = vi.fn();
    first.own(dispose);

    expect(lifecycle.connect()).toBeNull();
    expect(first.isCurrent()).toBe(true);
    lifecycle.disconnect();
    lifecycle.disconnect();

    expect(first.isCurrent()).toBe(false);
    expect(first.signal.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();

    const staleResource = vi.fn();
    first.own(staleResource);
    expect(staleResource).toHaveBeenCalledOnce();
    expect(lifecycle.connect()!.generation).toBeGreaterThan(first.generation);
  });

  it('preserves a reconnect created by an abort listener and skips stale operations', async () => {
    const lifecycle = new ComponentLifecycle();
    const first = lifecycle.connect()!;
    first.signal.addEventListener('abort', () => {
      lifecycle.connect();
    });

    lifecycle.disconnect();
    const reconnect = lifecycle.current!;
    expect(reconnect.isCurrent()).toBe(true);
    const staleOperation = vi.fn();
    await first.run(staleOperation);
    expect(staleOperation).not.toHaveBeenCalled();

    lifecycle.disconnect();
    expect(reconnect.signal.aborted).toBe(true);
  });

  it('serializes delayed links so an old generation cannot unlink the reconnect', async () => {
    const lifecycle = new ComponentLifecycle();
    const target = document.createElement('div');
    const controller = new JsViewsLinkController(target);
    const first = lifecycle.connect()!;
    const firstLink = controller.link(first, '<div>first</div>', { generation: 1 });

    lifecycle.disconnect();
    const second = lifecycle.connect()!;
    const secondLink = controller.link(second, '<div>second</div>', { generation: 2 });
    linkMock.resolve();

    await expect(firstLink).resolves.toBe(false);
    await expect(secondLink).resolves.toBe(true);
    await controller.unlink(first.generation);

    expect(linkMock.link).toHaveBeenCalledOnce();
    expect(linkMock.link).toHaveBeenCalledWith(target, { generation: 2 }, undefined);
    expect(linkMock.unlink).not.toHaveBeenCalled();

    lifecycle.disconnect();
    await controller.whenSettled();
    expect(linkMock.unlink).toHaveBeenCalledOnce();
  });

  it('keeps only current listeners and timers through rapid fake-timer reconnect loops', () => {
    vi.useFakeTimers();
    const lifecycle = new ComponentLifecycle();
    const target = new EventTarget();
    const listener = vi.fn();
    const timer = vi.fn();
    for (let index = 0; index < 10; index += 1) {
      const scope = lifecycle.connect()!;
      scope.listen(target, 'change', listener);
      scope.setTimeout(timer, 100);
      lifecycle.disconnect();
    }
    const current = lifecycle.connect()!;
    current.listen(target, 'change', listener);
    current.setTimeout(timer, 100);

    target.dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(100);

    expect(listener).toHaveBeenCalledOnce();
    expect(timer).toHaveBeenCalledOnce();
    lifecycle.disconnect();
  });
});
