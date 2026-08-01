import { waitFor } from './helpers';

const toolkitImportMock = vi.hoisted(() => {
  let resolve!: () => void;
  const ready = new Promise<void>((done) => {
    resolve = done;
  });
  const editor = {
    destroy: vi.fn(),
    focus: vi.fn(),
    getDocument: vi.fn(() => ''),
    setDocument: vi.fn(),
    setReadOnly: vi.fn()
  };
  return { create: vi.fn(() => editor), editor, ready, resolve };
});

vi.mock('../src/utils/dynamic-imports', () => ({
  loadCodeEditorModule: vi.fn(() => toolkitImportMock.ready.then(() => ({ createNodelCodeEditor: toolkitImportMock.create })))
}));

vi.mock('../src/data/nodel-data-runtime', () => ({
  registerNodelOneShotSource: vi.fn(() => ({
    subscribe(_element: HTMLElement, listener: (state: unknown) => void) {
      listener({ active: true, data: { script: 'def current():\n  return True\n' }, error: '', loading: false });
      return { dispose: vi.fn(), getState: vi.fn(), refresh: vi.fn() };
    }
  }))
}));

import '../src/components/nodel-toolkit';

describe('nodel-toolkit import lifecycle', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not create an editor for a disconnected dynamic-import generation', async () => {
    const toolkit = document.createElement('nodel-toolkit');
    document.body.append(toolkit);
    await waitFor(() => toolkit.querySelector('[data-toolkit-editor]') !== null);
    toolkit.remove();
    document.body.append(toolkit);
    toolkitImportMock.resolve();
    await waitFor(() => toolkitImportMock.create.mock.calls.length === 1);

    expect(toolkitImportMock.create).toHaveBeenCalledOnce();
    expect(toolkit.querySelectorAll('[data-toolkit-editor]')).toHaveLength(1);
    expect(toolkitImportMock.editor.destroy).not.toHaveBeenCalled();
  });
});
