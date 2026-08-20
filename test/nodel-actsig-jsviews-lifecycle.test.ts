import { flush, waitFor } from './helpers';
import type * as jsViewsLinkController from '../src/jsviews/jsviews-link-controller';
import type * as jsViewsRuntime from '../src/jsviews/jsviews-runtime';

type PulseActivityState = { batch: { items: Array<{ entry: { seq: number; source: 'local'; type: 'action'; alias: string } }> } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const jsViewsLifecycleMock = vi.hoisted(() => {
  let resolveBootstrap!: () => void;
  let bootstrapReady: Promise<void>;
  const links: Array<{ generation: number; resolve: () => void; result?: boolean }> = [];

  const reset = () => {
    links.length = 0;
    bootstrapReady = new Promise<void>((resolve) => {
      resolveBootstrap = resolve;
    });
  };
  reset();

  return {
    links,
    releaseBootstrap: () => resolveBootstrap(),
    reset,
    waitForBootstrap: () => bootstrapReady,
    addLink(generation: number) {
      let resolve!: () => void;
      const ready = new Promise<void>((done) => {
        resolve = done;
      });
      links.push({ generation, resolve });
      return ready;
    }
  };
});

const actsigLifecycleMock = vi.hoisted(() => ({
  subscriptions: [] as Array<{
    active: boolean;
    dispose: ReturnType<typeof vi.fn>;
    listener: (state: PulseActivityState) => void;
  }>,
  getNodeActions: vi.fn(),
  getNodeSignals: vi.fn()
}));

vi.mock('../src/jsviews/jsviews-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof jsViewsRuntime>();
  return {
    ...actual,
    bootstrapJsViews: vi.fn(() => jsViewsLifecycleMock.waitForBootstrap().then(() => actual.bootstrapJsViews()))
  };
});

vi.mock('../src/jsviews/jsviews-link-controller', async (importOriginal) => {
  const actual = await importOriginal<typeof jsViewsLinkController>();
  return {
    ...actual,
    JsViewsLinkController: class DelayedJsViewsLinkController extends actual.JsViewsLinkController {
      override link(scope: any, template: string, data: unknown, helpersOrContext?: object) {
        const call = jsViewsLifecycleMock.links.length;
        const ready = jsViewsLifecycleMock.addLink(scope.generation);
        return ready.then(async () => {
          const linked = await super.link(scope, template, data, helpersOrContext);
          jsViewsLifecycleMock.links[call]!.result = linked;
          return linked;
        });
      }
    }
  };
});

vi.mock('../src/api/nodel-host-client', () => ({
  callNodeAction: vi.fn(),
  emitNodeSignal: vi.fn(),
  getNodeActions: actsigLifecycleMock.getNodeActions,
  getNodeSignals: actsigLifecycleMock.getNodeSignals
}));

vi.mock('../src/data/node-activity-source', () => ({
  subscribeNodeActivity: vi.fn((_element: HTMLElement, listener: (state: PulseActivityState) => void) => {
    const subscription = {
      active: true,
      dispose: vi.fn(() => {
        subscription.active = false;
      }),
      listener
    };
    actsigLifecycleMock.subscriptions.push(subscription);
    return { dispose: subscription.dispose };
  })
}));

import '../src/components/nodel-actsig';

describe('nodel-actsig JsViews lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    jsViewsLifecycleMock.reset();
    actsigLifecycleMock.subscriptions.length = 0;
    actsigLifecycleMock.getNodeActions.mockReset().mockResolvedValue({});
    actsigLifecycleMock.getNodeSignals.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('links and subscribes only the current generation when bootstrap and linking are delayed', async () => {
    const actsig = document.createElement('nodel-actsig');
    document.body.append(actsig);
    await flush();

    actsig.remove();
    document.body.append(actsig);
    jsViewsLifecycleMock.releaseBootstrap();

    await waitFor(() => jsViewsLifecycleMock.links.length === 1);
    expect(jsViewsLifecycleMock.links[0]!.generation).toBe(2);

    actsig.remove();
    document.body.append(actsig);
    await waitFor(() => jsViewsLifecycleMock.links.length === 2);
    expect(jsViewsLifecycleMock.links[1]!.generation).toBe(3);

    jsViewsLifecycleMock.links[0]!.resolve();
    await flush();
    expect(jsViewsLifecycleMock.links[0]!.result).toBe(false);
    expect(actsigLifecycleMock.getNodeActions).not.toHaveBeenCalled();
    expect(actsigLifecycleMock.subscriptions).toHaveLength(0);

    jsViewsLifecycleMock.links[1]!.resolve();
    await waitFor(() => actsigLifecycleMock.getNodeActions.mock.calls.length === 1);
    await waitFor(() => actsigLifecycleMock.subscriptions.length === 1);

    expect(actsigLifecycleMock.getNodeSignals).toHaveBeenCalledOnce();
    expect(actsigLifecycleMock.subscriptions.filter((subscription) => subscription.active)).toHaveLength(1);
    expect(actsigLifecycleMock.subscriptions[0]!.dispose).not.toHaveBeenCalled();
  });

  it('tracks only the current pulse timer across repeated activity and restart/disconnect cleanup', async () => {
    actsigLifecycleMock.getNodeActions.mockResolvedValue({ Pulse: { name: 'Pulse' } });
    const actsig = document.createElement('nodel-actsig');
    document.body.append(actsig);
    await flush();
    jsViewsLifecycleMock.releaseBootstrap();
    await waitFor(() => jsViewsLifecycleMock.links.length === 1);
    jsViewsLifecycleMock.links[0]!.resolve();
    await waitFor(() => actsigLifecycleMock.getNodeActions.mock.calls.length === 1);
    await waitFor(() => actsigLifecycleMock.subscriptions.length === 1);
    const pulseTimers = (actsig as unknown as { pulseTimers: Map<string, number> }).pulseTimers;
    const entry = { seq: 1, source: 'local' as const, type: 'action' as const, alias: 'Pulse' };
    const listener = actsigLifecycleMock.subscriptions[0]!.listener;
    listener({ batch: { items: [{ entry }] } });
    listener({ batch: { items: [{ entry: { ...entry, seq: 2 } }] } });
    expect(pulseTimers.size).toBe(1);

    await (actsig as unknown as { refreshAfterRestart(): Promise<unknown> }).refreshAfterRestart();
    expect(pulseTimers.size).toBe(0);
    await waitFor(() => actsigLifecycleMock.getNodeActions.mock.calls.length === 2);
    const activeSubscription = actsigLifecycleMock.subscriptions.find((subscription) => subscription.active)!;
    activeSubscription.listener({ batch: { items: [{ entry: { ...entry, seq: 3 } }] } });
    expect(pulseTimers.size).toBe(1);
    actsig.remove();
    expect(pulseTimers.size).toBe(0);
  });

  it('cancels a pending discovery timer on disconnect and keeps one active subscription after reconnect', async () => {
    const actsig = document.createElement('nodel-actsig');
    document.body.append(actsig);
    await flush();
    jsViewsLifecycleMock.releaseBootstrap();
    await waitFor(() => jsViewsLifecycleMock.links.length === 1);
    jsViewsLifecycleMock.links[0]!.resolve();
    await waitFor(() => actsigLifecycleMock.subscriptions.length === 1);

    vi.useFakeTimers();
    try {
      actsigLifecycleMock.subscriptions[0]!.listener({ batch: { items: [{ entry: { seq: 1, source: 'local', type: 'action', alias: 'NewPoint' } }] } });
      expect((actsig as any).activityTimer).not.toBeNull();
      actsig.remove();
      await vi.advanceTimersByTimeAsync(200);
      expect(actsigLifecycleMock.getNodeActions).toHaveBeenCalledOnce();
      expect(actsigLifecycleMock.subscriptions[0]!.dispose).toHaveBeenCalledOnce();
      expect(actsigLifecycleMock.subscriptions.filter((subscription) => subscription.active)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a reconnect generation guard when a stale activity refresh settles late', async () => {
    const actsig = document.createElement('nodel-actsig');
    document.body.append(actsig);
    await flush();
    jsViewsLifecycleMock.releaseBootstrap();
    await waitFor(() => jsViewsLifecycleMock.links.length === 1);
    jsViewsLifecycleMock.links[0]!.resolve();
    await waitFor(() => actsigLifecycleMock.subscriptions.length === 1);

    const stale = deferred<Record<string, unknown>>();
    const fresh = deferred<Record<string, unknown>>();
    actsigLifecycleMock.getNodeActions.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({}).mockReturnValueOnce(fresh.promise);
    actsigLifecycleMock.getNodeSignals.mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const unknown = (listener: (state: any) => void) => listener({ batch: { items: [{ entry: { seq: 1, source: 'local', type: 'action', alias: 'NewPoint' } }] } });

    vi.useFakeTimers();
    unknown(actsigLifecycleMock.subscriptions[0]!.listener);
    await vi.advanceTimersByTimeAsync(200);
    expect(actsigLifecycleMock.getNodeActions).toHaveBeenCalledTimes(2);
    vi.useRealTimers();

    actsig.remove();
    document.body.append(actsig);
    await waitFor(() => jsViewsLifecycleMock.links.length === 2);
    jsViewsLifecycleMock.links[1]!.resolve();
    await waitFor(() => actsigLifecycleMock.subscriptions.length === 2);

    vi.useFakeTimers();
    try {
      const active = actsigLifecycleMock.subscriptions.find((subscription) => subscription.active)!;
      unknown(active.listener);
      await vi.advanceTimersByTimeAsync(200);
      expect(actsigLifecycleMock.getNodeActions).toHaveBeenCalledTimes(4);
      stale.resolve({});
      await Promise.resolve();
      await Promise.resolve();
      unknown(active.listener);
      await vi.advanceTimersByTimeAsync(200);
      expect(actsigLifecycleMock.getNodeActions).toHaveBeenCalledTimes(4);
      fresh.resolve({});
    } finally {
      vi.useRealTimers();
    }
  });
});
