import { waitFor } from './helpers';

const dynamicImportMock = vi.hoisted(() => ({
  loadCodeEditorModule: vi.fn(),
  loadChartModule: vi.fn()
}));

vi.mock('../src/utils/dynamic-imports', () => ({
  loadCodeEditorModule: dynamicImportMock.loadCodeEditorModule,
  loadChartModule: dynamicImportMock.loadChartModule
}));

vi.mock('../src/data/nodel-data-runtime', () => ({
  registerNodelOneShotSource: vi.fn(() => ({
    subscribe(_element: HTMLElement, listener: (state: unknown) => void) {
      listener({ active: true, data: { script: 'def toolkit():\n  pass\n' }, error: '', loading: false });
      return { dispose: vi.fn(), getState: vi.fn(), refresh: vi.fn() };
    }
  })),
  registerNodelPollSource: vi.fn(() => ({
    subscribe(_element: HTMLElement, listener: (state: unknown) => void) {
      listener({
        active: true,
        data: [{ name: 'Runtime.Heap', isRate: false, values: [1] }],
        error: '',
        loading: false
      });
      return { dispose: vi.fn(), getState: vi.fn(), refresh: vi.fn() };
    }
  }))
}));

import '../src/components/nodel-toolkit';
import '../src/components/nodel-diagnostic-charts';

describe('dynamic import errors', () => {
  beforeEach(() => {
    dynamicImportMock.loadCodeEditorModule.mockReset().mockRejectedValue(new Error('Code editor bundle unavailable'));
    dynamicImportMock.loadChartModule.mockReset().mockRejectedValue(new Error('Chart bundle unavailable'));
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders CodeMirror and Chart.js import failures', async () => {
    document.body.innerHTML = '<nodel-toolkit></nodel-toolkit><nodel-diagnostic-charts></nodel-diagnostic-charts>';
    await waitFor(() => document.querySelector<HTMLInputElement>('[data-diagnostic-chart-category]') !== null);
    const category = document.querySelector<HTMLInputElement>('[data-diagnostic-chart-category]')!;
    category.checked = true;
    category.dispatchEvent(new Event('change', { bubbles: true }));

    await waitFor(() => document.querySelector('nodel-toolkit')?.getAttribute('data-state') === 'error');
    await waitFor(() => document.querySelector('nodel-diagnostic-charts')?.getAttribute('data-state') === 'error');

    expect(document.querySelector('[data-toolkit-status]')?.textContent).toContain('Code editor bundle unavailable');
    expect(document.querySelector('nodel-diagnostic-charts')?.textContent).toContain('Chart bundle unavailable');
    expect(document.querySelector('[data-toolkit-retry-editor]')).not.toBeNull();
    expect(document.querySelector('[data-diagnostic-chart-retry]')).not.toBeNull();
  });

  it('retries CodeMirror and Chart.js imports from visible controls', async () => {
    const setDocument = vi.fn();
    const destroy = vi.fn();
    class FakeChart {
      canvas: HTMLCanvasElement;
      data: unknown;
      options: unknown;
      constructor(canvas: HTMLCanvasElement, config: { data: unknown; options: unknown }) {
        this.canvas = canvas;
        this.data = config.data;
        this.options = config.options;
      }
      update = vi.fn();
      destroy = vi.fn();
    }
    dynamicImportMock.loadCodeEditorModule
      .mockRejectedValueOnce(new Error('Code editor bundle unavailable'))
      .mockResolvedValue({ createNodelCodeEditor: vi.fn(() => ({ setDocument, destroy, setReadOnly: vi.fn() })) });
    dynamicImportMock.loadChartModule
      .mockRejectedValueOnce(new Error('Chart bundle unavailable'))
      .mockResolvedValue({ default: FakeChart });

    document.body.innerHTML = '<nodel-toolkit></nodel-toolkit><nodel-diagnostic-charts></nodel-diagnostic-charts>';
    await waitFor(() => document.querySelector<HTMLInputElement>('[data-diagnostic-chart-category]') !== null);
    const category = document.querySelector<HTMLInputElement>('[data-diagnostic-chart-category]')!;
    category.checked = true;
    category.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => document.querySelector('[data-toolkit-retry-editor]') !== null);
    await waitFor(() => document.querySelector('[data-diagnostic-chart-retry]') !== null);

    document.querySelector<HTMLButtonElement>('[data-toolkit-retry-editor]')?.click();
    document.querySelector<HTMLButtonElement>('[data-diagnostic-chart-retry]')?.click();

    await waitFor(() => document.querySelector('nodel-toolkit')?.getAttribute('data-state') === 'ready');
    await waitFor(() => document.querySelector('nodel-diagnostic-charts')?.getAttribute('data-state') === 'ready');

    expect(setDocument).toHaveBeenCalledWith('def toolkit():\n  pass\n', 'nodetoolkit.py');
    expect(destroy).not.toHaveBeenCalled();
  });
});
