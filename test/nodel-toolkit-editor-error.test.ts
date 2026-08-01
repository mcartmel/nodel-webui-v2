import { waitFor } from './helpers';

const toolkitErrorMock = vi.hoisted(() => ({
  listener: null as null | ((state: unknown) => void)
}));

vi.mock('../src/utils/dynamic-imports', () => ({
  loadCodeEditorModule: vi.fn(() => Promise.reject(new Error('Editor import failed')))
}));

vi.mock('../src/data/nodel-data-runtime', () => ({
  registerNodelOneShotSource: vi.fn(() => ({
    subscribe(_element: HTMLElement, listener: (state: unknown) => void) {
      toolkitErrorMock.listener = listener;
      return { dispose: vi.fn(), getState: vi.fn(), refresh: vi.fn() };
    }
  }))
}));

import '../src/components/nodel-toolkit';

describe('nodel-toolkit editor errors', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('retains editor import errors after toolkit source success', async () => {
    document.body.innerHTML = '<nodel-toolkit></nodel-toolkit>';
    await waitFor(() => document.querySelector('nodel-toolkit')?.getAttribute('data-state') === 'error');

    toolkitErrorMock.listener?.({
      active: false,
      data: { script: 'def loaded():\n  return True\n' },
      error: '',
      loading: false,
      updatedAt: Date.now()
    });

    expect(document.querySelector('nodel-toolkit')?.getAttribute('data-state')).toBe('error');
    expect(document.querySelector('[data-toolkit-status]')?.textContent).toContain('Editor import failed');
  });
});
