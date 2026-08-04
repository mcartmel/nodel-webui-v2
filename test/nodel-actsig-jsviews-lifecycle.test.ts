import { flush, waitFor } from './helpers';

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
    listener: (state: unknown) => void;
  }>,
  getNodeActions: vi.fn(),
  getNodeSignals: vi.fn()
}));

vi.mock('../src/jsviews/jsviews-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/jsviews/jsviews-runtime')>();
  return {
    ...actual,
    bootstrapJsViews: vi.fn(() => jsViewsLifecycleMock.waitForBootstrap().then(() => actual.bootstrapJsViews()))
  };
});

vi.mock('../src/jsviews/jsviews-link-controller', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/jsviews/jsviews-link-controller')>();
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
  subscribeNodeActivity: vi.fn((_element: HTMLElement, listener: (state: unknown) => void) => {
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
});
