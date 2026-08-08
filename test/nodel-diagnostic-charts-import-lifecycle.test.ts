import { waitFor } from './helpers';

const chartImportMock = vi.hoisted(() => {
  let resolve!: () => void;
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  const instances: Array<{ destroy: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }> = [];
  const Chart = vi.fn(function ChartMock(this: { destroy: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }) {
    this.destroy = vi.fn();
    this.update = vi.fn();
    instances.push(this);
  });
  return { Chart, instances, ready, resolve };
});

vi.mock('../src/utils/dynamic-imports', () => ({
  loadChartModule: vi.fn(() => chartImportMock.ready.then(() => ({ default: chartImportMock.Chart })))
}));

vi.mock('../src/data/nodel-data-runtime', () => ({
  registerNodelPollSource: vi.fn(() => ({
    subscribe(_element: HTMLElement, listener: (state: unknown) => void) {
      listener({
        active: true,
        data: [{ name: 'Runtime.Heap', isRate: false, values: [1, 2] }],
        error: '',
        loading: false
      });
      return { dispose: vi.fn(), getState: vi.fn(), refresh: vi.fn() };
    }
  }))
}));

import '../src/components/nodel-diagnostic-charts';

describe('nodel-diagnostic-charts import lifecycle', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not construct a chart for a disconnected dynamic-import generation', async () => {
    const charts = document.createElement('nodel-diagnostic-charts');
    document.body.append(charts);
    await waitFor(() => charts.querySelector<HTMLInputElement>('[data-diagnostic-chart-category]') !== null);
    const input = charts.querySelector<HTMLInputElement>('[data-diagnostic-chart-category]')!;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    charts.remove();
    document.body.append(charts);
    chartImportMock.resolve();
    await waitFor(() => chartImportMock.instances.length === 1);

    expect(chartImportMock.Chart).toHaveBeenCalledOnce();
    expect(charts.querySelectorAll('canvas[data-diagnostic-chart]')).toHaveLength(1);
     expect(chartImportMock.instances[0]?.destroy).not.toHaveBeenCalled();
  });
});
