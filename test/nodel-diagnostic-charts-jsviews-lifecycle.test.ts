import { flush, waitFor } from './helpers';

const chartLinkMock = vi.hoisted(() => {
  const links: Array<{ generation: number; resolve: () => void; result?: boolean }> = [];
  return {
    links,
    reset: () => {
      links.length = 0;
    },
    add(generation: number, target: HTMLElement, scope: { isCurrent(): boolean }) {
      let resolve!: () => void;
      const ready = new Promise<void>((done) => {
        resolve = done;
      });
      links.push({ generation, resolve });
      return ready.then(() => {
        if (!scope.isCurrent()) {
          return false;
        }
        target.innerHTML = '<input data-diagnostic-chart-category value="Runtime"><canvas data-diagnostic-chart="Runtime.Heap"></canvas>';
        return true;
      });
    }
  };
});

const chartLifecycleMock = vi.hoisted(() => {
  type Measurement = { name: string; isRate: boolean; values: number[] };
  const fetches: Array<{ resolve: (value: Measurement[]) => void; signal: AbortSignal }> = [];
  let resolveImport!: () => void;
  let importReady: Promise<void>;
  const instances: Array<{ destroy: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }> = [];
  const Chart = vi.fn(function ChartMock(this: { destroy: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }) {
    this.destroy = vi.fn();
    this.update = vi.fn();
    instances.push(this);
  });
  const loadChartModule = vi.fn(() => importReady.then(() => ({ default: Chart })));
  const getDiagnosticMeasurements = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise<Measurement[]>((resolve) => {
    fetches.push({ resolve, signal });
  }));
  const reset = () => {
    fetches.length = 0;
    instances.length = 0;
    Chart.mockClear();
    loadChartModule.mockClear();
    getDiagnosticMeasurements.mockClear();
    importReady = new Promise<void>((resolve) => {
      resolveImport = resolve;
    });
  };
  reset();
  return {
    Chart,
    fetches,
    getDiagnosticMeasurements,
    instances,
    loadChartModule,
    releaseImport: () => resolveImport(),
    reset
  };
});

const pollLifecycleMock = vi.hoisted(() => {
  const subscriptions: Array<{
    active: boolean;
    controller: AbortController;
    dispose: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    subscriptions,
    reset: () => {
      subscriptions.length = 0;
    },
    register(config: { fetcher: (signal: AbortSignal) => Promise<unknown> }) {
      return {
        subscribe(_element: HTMLElement, listener: (state: unknown) => void) {
          const controller = new AbortController();
          const subscription = {
            active: true,
            controller,
            dispose: vi.fn(() => {
              subscription.active = false;
              controller.abort();
            })
          };
          subscriptions.push(subscription);
          void config.fetcher(controller.signal).then(
            (data) => listener({ active: true, data, error: '', loading: false, updatedAt: Date.now() }),
            (error) => listener({ active: false, data: null, error: String(error), loading: false, updatedAt: Date.now() })
          );
          return { dispose: subscription.dispose, getState: vi.fn(), refresh: vi.fn() };
        }
      };
    }
  };
});

vi.mock('../src/jsviews/jsviews-link-controller', () => ({
  JsViewsLinkController: class DelayedJsViewsLinkController {
      constructor(private readonly target: HTMLElement) {}

      link(scope: any) {
        const call = chartLinkMock.links.length;
        return chartLinkMock.add(scope.generation, this.target, scope).then((linked) => {
          chartLinkMock.links[call]!.result = linked;
          return linked;
        });
      }
    }
}));

vi.mock('../src/jsviews/jsviews-runtime', () => ({
  getJQuery: () => ({
    observable: (value: any) => ({
      refresh: (next: unknown[]) => value.splice(0, value.length, ...next),
      setProperty: (values: object) => Object.assign(value, values)
    })
  })
}));

vi.mock('../src/utils/dynamic-imports', () => ({
  loadChartModule: chartLifecycleMock.loadChartModule
}));

vi.mock('../src/api/nodel-host-client', () => ({
  getDiagnosticMeasurements: chartLifecycleMock.getDiagnosticMeasurements
}));

vi.mock('../src/data/nodel-data-runtime', () => ({
  registerNodelPollSource: vi.fn((config) => pollLifecycleMock.register(config))
}));

import '../src/components/nodel-diagnostic-charts';

describe('nodel-diagnostic-charts JsViews lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    chartLinkMock.reset();
    chartLifecycleMock.reset();
    pollLifecycleMock.reset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps delayed links, pending fetches, charts, and subscriptions isolated to the current instance', async () => {
    const oldCharts = document.createElement('nodel-diagnostic-charts');
    document.body.append(oldCharts);
    await waitFor(() => chartLinkMock.links.length === 1);

    oldCharts.remove();
    document.body.append(oldCharts);
    await waitFor(() => chartLinkMock.links.length === 2);
    chartLinkMock.links[0]!.resolve();
    await flush();
    expect(chartLinkMock.links[0]!.result).toBe(false);
    expect(chartLifecycleMock.fetches).toHaveLength(0);
    chartLinkMock.links[1]!.resolve();
    await waitFor(() => chartLifecycleMock.fetches.length === 1);

    oldCharts.remove();
    const freshCharts = document.createElement('nodel-diagnostic-charts');
    document.body.append(freshCharts);
    await waitFor(() => chartLinkMock.links.length === 3);
    chartLinkMock.links[2]!.resolve();
    await waitFor(() => chartLifecycleMock.fetches.length === 2);

    expect(chartLifecycleMock.fetches[0]!.signal.aborted).toBe(true);
    chartLifecycleMock.fetches[0]!.resolve([{ name: 'Stale.First', isRate: false, values: [1] }]);
    chartLifecycleMock.fetches[1]!.resolve([{ name: 'Runtime.Heap', isRate: false, values: [3] }]);

    await waitFor(() => freshCharts.dataset.state === 'ready');
    expect(oldCharts.textContent).not.toContain('Stale');
    expect(freshCharts.textContent).not.toContain('Stale');

    const category = freshCharts.querySelector<HTMLInputElement>('[data-diagnostic-chart-category]')!;
    category.checked = true;
    category.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => chartLifecycleMock.loadChartModule.mock.calls.length === 1);

    chartLifecycleMock.releaseImport();
    await waitFor(() => chartLifecycleMock.instances.length === 1);
    await flush();

    expect(chartLinkMock.links.map((link) => link.result)).toEqual([false, true, true]);
    expect(pollLifecycleMock.subscriptions.filter((subscription) => subscription.active)).toHaveLength(1);
    expect(pollLifecycleMock.subscriptions[0]!.dispose).toHaveBeenCalledOnce();
    expect(pollLifecycleMock.subscriptions[1]!.dispose).not.toHaveBeenCalled();
    expect(chartLifecycleMock.loadChartModule).toHaveBeenCalledOnce();
    expect(chartLifecycleMock.Chart).toHaveBeenCalledOnce();
    expect(freshCharts.querySelectorAll('canvas[data-diagnostic-chart]')).toHaveLength(1);
  });
});
