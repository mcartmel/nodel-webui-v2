import { waitFor } from './helpers';

const editorImportMock = vi.hoisted(() => {
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
  const create = vi.fn(() => editor);
  const load = vi.fn(() => ready.then(() => ({ createNodelCodeEditor: create })));
  return { create, editor, load, resolve };
});

vi.mock('../src/utils/dynamic-imports', () => ({
  loadCodeEditorModule: editorImportMock.load
}));

vi.mock('../src/api/nodel-host-client', () => ({
  deleteNodeFile: vi.fn(),
  getNodeFileContents: vi.fn(async () => 'print("current")'),
  listNodeFiles: vi.fn(async () => [{ path: 'script.py' }]),
  saveNodeFile: vi.fn()
}));

import '../src/components/nodel-editor';

describe('nodel-editor import lifecycle', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not create CodeMirror for a disconnected import generation', async () => {
    const editor = document.createElement('nodel-editor');
    document.body.append(editor);
    await waitFor(() => editorImportMock.load.mock.calls.length === 1);
    editor.remove();
    document.body.append(editor);
    await waitFor(() => editorImportMock.load.mock.calls.length === 2);
    editorImportMock.resolve();
    await waitFor(() => editorImportMock.create.mock.calls.length === 1);

    expect(editorImportMock.create).toHaveBeenCalledOnce();
    expect(editorImportMock.editor.destroy).not.toHaveBeenCalled();
    expect(editorImportMock.editor.setDocument).toHaveBeenCalledWith('print("current")', 'script.py');
  });
});
