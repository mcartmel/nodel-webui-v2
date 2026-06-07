import { flush, waitFor } from './helpers';
import '../src/components/nodel-page';

const chartMock = vi.hoisted(() => {
  const instances: Array<{
    canvas: HTMLCanvasElement;
    config: any;
    destroy: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  }> = [];

  const Chart = vi.fn(function ChartMock(this: any, canvas: HTMLCanvasElement, config: any) {
    this.canvas = canvas;
    this.config = config;
    this.destroy = vi.fn();
    this.update = vi.fn();
    instances.push(this);
  });

  return { Chart, instances };
});

vi.mock('chart.js/auto', () => ({
  default: chartMock.Chart
}));

import '../src/components/nodel-diagnostic-charts';

function measurementsResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  }) as never;
}

function mockMeasurements(body: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/REST/diagnostics/measurements') {
      return measurementsResponse(body);
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as unknown as typeof fetch;

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

function categoryInputs() {
  return Array.from(document.querySelectorAll<HTMLInputElement>('[data-diagnostic-chart-category]'));
}

function checkedValues() {
  return categoryInputs().filter((input) => input.checked).map((input) => input.value);
}

function setCategoryChecked(value: string, checked: boolean) {
  const input = categoryInputs().find((candidate) => candidate.value === value);
  expect(input).not.toBeUndefined();
  input!.checked = checked;
  input!.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('nodel-diagnostic-charts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    chartMock.instances.length = 0;
    chartMock.Chart.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('loads measurements, waits for selected categories, and scales rates', async () => {
    mockMeasurements([
      { name: 'Java runtime.Free bytes', isRate: false, values: [100, 200] },
      { name: 'HTTP client.Receive.rate', isRate: true, values: [10, 20, 30] },
      { name: 'Uncategorized', isRate: false, values: [5] }
    ]);

    document.body.innerHTML = '<nodel-diagnostic-charts></nodel-diagnostic-charts>';
    await customElements.whenDefined('nodel-diagnostic-charts');
    await waitFor(() => document.body.textContent?.includes('Select one or more categories') ?? false);

    expect(categoryInputs().map((input) => input.value)).toEqual(expect.arrayContaining([
      'HTTP client',
      'Java runtime',
      'general'
    ]));
    expect(checkedValues()).toEqual([]);
    expect(chartMock.instances).toHaveLength(0);

    setCategoryChecked('HTTP client', true);

    await waitFor(() => chartMock.instances.length === 1);

    const chartConfig = chartMock.instances[0].config;
    expect(document.body.textContent).toContain('Receive.rate');
    expect(chartConfig.data.datasets[0].data).toEqual([1, 2, 3]);
    expect(chartConfig.options.animation).toBe(false);
    expect(chartConfig.options.interaction).toEqual({ axis: 'x', intersect: false, mode: 'index' });
    expect(chartConfig.options.hover).toMatchObject({ intersect: false, mode: 'index' });
    expect(document.querySelector('.nodel-diagnostic-chart-card')?.getAttribute('title')).toBe('');
    expect(document.querySelector('canvas[data-diagnostic-chart]')?.getAttribute('title')).toBe('');
  });

  it('adds and removes charts when selected categories change', async () => {
    mockMeasurements([
      { name: 'Java runtime.Free bytes', isRate: false, values: [100] },
      { name: 'HTTP client.Receive rate', isRate: true, values: [10] }
    ]);

    document.body.innerHTML = '<nodel-diagnostic-charts></nodel-diagnostic-charts>';
    await waitFor(() => categoryInputs().length === 2);

    document.querySelector<HTMLButtonElement>('[data-diagnostic-chart-select="all"]')?.click();

    await waitFor(() => chartMock.instances.length === 2);
    const firstCharts = [...chartMock.instances];

    setCategoryChecked('HTTP client', false);

    await waitFor(() => firstCharts.some((chart) => chart.destroy.mock.calls.length === 1));
    expect(chartMock.instances).toHaveLength(2);
    expect(firstCharts.filter((chart) => chart.destroy.mock.calls.length === 1)).toHaveLength(1);
    expect(checkedValues()).toEqual(['Java runtime']);
    expect(document.body.textContent).toContain('Free bytes');
    expect(document.body.textContent).not.toContain('Receive rate');
  });

  it('recreates charts after a category is deselected and selected again', async () => {
    mockMeasurements([
      { name: 'Java runtime.Free bytes', isRate: false, values: [100] }
    ]);

    document.body.innerHTML = '<nodel-diagnostic-charts></nodel-diagnostic-charts>';
    await waitFor(() => categoryInputs().length === 1);

    setCategoryChecked('Java runtime', true);
    await waitFor(() => chartMock.instances.length === 1);
    const firstChart = chartMock.instances[0];
    const firstCanvas = firstChart.canvas;

    setCategoryChecked('Java runtime', false);
    await waitFor(() => firstChart.destroy.mock.calls.length === 1);
    expect(document.querySelector('canvas[data-diagnostic-chart]')).toBeNull();

    setCategoryChecked('Java runtime', true);
    await waitFor(() => chartMock.instances.length === 2);
    const secondChart = chartMock.instances[1];

    expect(secondChart.canvas).not.toBe(firstCanvas);
    expect(secondChart.canvas).toBe(document.querySelector('canvas[data-diagnostic-chart]'));
    expect(secondChart.config.data.datasets[0].data).toEqual([100]);
  });

  it('redraws chart colours on theme change without losing selected categories', async () => {
    mockMeasurements([
      { name: 'HTTP client.Receive rate', isRate: true, values: [10] }
    ]);

    document.body.innerHTML = '<nodel-diagnostic-charts></nodel-diagnostic-charts>';
    await waitFor(() => categoryInputs().length === 1);

    setCategoryChecked('HTTP client', true);
    await waitFor(() => chartMock.instances.length === 1);

    const firstChart = chartMock.instances[0];
    document.documentElement.setAttribute('data-theme', 'dark');
    await waitFor(() => firstChart.update.mock.calls.length > 0);

    expect(firstChart.destroy).not.toHaveBeenCalled();
    expect(checkedValues()).toEqual(['HTTP client']);
  });

  it('keeps the selector stable while measurements refresh', async () => {
    const batches = [
      [{ name: 'HTTP client.Receive rate', isRate: true, values: [10] }],
      [{ name: 'HTTP client.Receive rate', isRate: true, values: [20] }]
    ];
    let fetchIndex = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/REST/diagnostics/measurements') {
        const batch = batches[Math.min(fetchIndex, batches.length - 1)];
        fetchIndex += 1;
        return measurementsResponse(batch);
      }

      throw new Error(`Unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);
    document.body.innerHTML = '<nodel-diagnostic-charts></nodel-diagnostic-charts>';
    await waitFor(() => categoryInputs().length === 1);

    const checkbox = categoryInputs()[0];
    setCategoryChecked('HTTP client', true);
    await waitFor(() => chartMock.instances.length === 1);

    await ((document.querySelector('nodel-diagnostic-charts') as unknown as { source: { refresh: () => Promise<void> } }).source.refresh());
    await waitFor(() => chartMock.instances[0].config.data.datasets[0].data[0] === 2);

    const nextCheckbox = categoryInputs()[0];
    expect(nextCheckbox).toBe(checkbox);
    expect(checkedValues()).toEqual(['HTTP client']);
    expect(chartMock.instances).toHaveLength(1);
    expect(chartMock.instances[0].config.data.datasets[0].data).toEqual([2]);
  });

  it('renders empty and error states', async () => {
    mockMeasurements([]);

    document.body.innerHTML = '<nodel-diagnostic-charts></nodel-diagnostic-charts>';
    await waitFor(() => document.body.textContent?.includes('No diagnostic measurements.') ?? false);

    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response('', { status: 500, statusText: 'Server Error' }) as never
    )) as unknown as typeof fetch);

    document.body.innerHTML = '<nodel-diagnostic-charts></nodel-diagnostic-charts>';
    await waitFor(() => document.querySelector('nodel-diagnostic-charts')?.getAttribute('data-state') === 'error');

    expect(document.body.textContent).toContain('500 Server Error');
    expect(document.querySelector('.nodel-alert-danger')).not.toBeNull();
  });

  it('waits for the page to become visible before fetching', async () => {
    const fetchMock = mockMeasurements([]);

    document.body.innerHTML = '<nodel-page hidden><nodel-diagnostic-charts></nodel-diagnostic-charts></nodel-page>';
    await customElements.whenDefined('nodel-diagnostic-charts');
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();

    document.querySelector('nodel-page')?.removeAttribute('hidden');
    await waitFor(() => fetchMock.mock.calls.length === 1);

    expect(fetchMock).toHaveBeenCalledWith('/REST/diagnostics/measurements', expect.any(Object));
  });
});
