import { waitFor } from './helpers';

const toolkitLanguageMock = vi.hoisted(() => {
  const editor = {
    destroy: vi.fn(),
    focus: vi.fn(),
    getDocument: vi.fn(() => ''),
    setDocument: vi.fn(),
    setReadOnly: vi.fn()
  };
  let onError: ((error: unknown) => void) | undefined;
  return {
    editor,
    getOnError: () => onError,
    create: vi.fn((options: { onError?: (error: unknown) => void }) => {
      onError = options.onError;
      return editor;
    })
  };
});

vi.mock('../src/utils/dynamic-imports', () => ({
  loadCodeEditorModule: vi.fn(async () => ({ createNodelCodeEditor: toolkitLanguageMock.create }))
}));

vi.mock('../src/data/nodel-data-runtime', () => ({
  registerNodelOneShotSource: vi.fn(() => ({
    subscribe(_element: HTMLElement, listener: (state: unknown) => void) {
      listener({
        active: false,
        data: { script: 'def toolkit():\n  return True\n' },
        error: '',
        loading: false,
        updatedAt: Date.now()
      });
      return { dispose: vi.fn(), getState: vi.fn(), refresh: vi.fn() };
    }
  }))
}));

import '../src/components/nodel-toolkit';

describe('nodel-toolkit language errors', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders a repeated CodeMirror language error only once', async () => {
    document.body.innerHTML = '<nodel-toolkit></nodel-toolkit>';
    await waitFor(() => toolkitLanguageMock.editor.setDocument.mock.calls.length === 1);
    const error = new Error('Python mode unavailable');
    toolkitLanguageMock.getOnError()?.(error);
    await waitFor(() => toolkitLanguageMock.editor.setDocument.mock.calls.length === 2);
    toolkitLanguageMock.getOnError()?.(error);

    expect(toolkitLanguageMock.editor.setDocument).toHaveBeenCalledTimes(2);
    expect(toolkitLanguageMock.editor.setDocument).toHaveBeenLastCalledWith('# Python mode unavailable', 'nodetoolkit.py');
    expect(document.querySelector('[data-toolkit-status]')?.textContent).toContain('Python mode unavailable');
  });
});
