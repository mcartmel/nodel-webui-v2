import { waitFor } from './helpers';

vi.mock('../src/utils/dynamic-imports', () => ({
  loadCodeEditorModule: vi.fn(() => Promise.reject(new Error('Code editor bundle unavailable'))),
  loadChartModule: vi.fn(() => Promise.reject(new Error('Chart bundle unavailable')))
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
  });
});
