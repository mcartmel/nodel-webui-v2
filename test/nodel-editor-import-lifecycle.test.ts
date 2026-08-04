import { waitFor } from './helpers';
import { rapidReconnect } from './lifecycle-helpers';

const editorImportMock = vi.hoisted(() => {
  let resolve!: () => void;
  let ready: Promise<void>;
  const reset = () => {
    ready = new Promise<void>((done) => {
      resolve = done;
    });
  };
  reset();
  const editor = {
    destroy: vi.fn(),
    focus: vi.fn(),
    getDocument: vi.fn(() => ''),
    setDocument: vi.fn(),
    setReadOnly: vi.fn()
  };
  const create = vi.fn(() => editor);
  const loadDefault = () => ready.then(() => ({ createNodelCodeEditor: create }));
  const load = vi.fn(loadDefault);
  return {
    create,
    editor,
    load,
    reset,
    resolve: () => resolve(),
    restoreLoad: () => load.mockReset().mockImplementation(loadDefault)
  };
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
  beforeEach(() => {
    editorImportMock.reset();
    editorImportMock.create.mockClear();
    editorImportMock.editor.destroy.mockClear();
    editorImportMock.editor.setDocument.mockClear();
    editorImportMock.restoreLoad();
  });

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

  it('does not let a disposed pending editor create or update a fresh instance', async () => {
    const oldEditor = document.createElement('nodel-editor');
    document.body.append(oldEditor);
    await waitFor(() => editorImportMock.load.mock.calls.length === 1);
    oldEditor.remove();

    const freshEditor = document.createElement('nodel-editor');
    document.body.append(freshEditor);
    await waitFor(() => editorImportMock.load.mock.calls.length === 2);
    editorImportMock.resolve();
    await waitFor(() => editorImportMock.create.mock.calls.length === 1);

    expect((oldEditor as any).editor).toBeNull();
    expect((freshEditor as any).editor).toBe(editorImportMock.editor);
    expect(editorImportMock.create).toHaveBeenCalledOnce();
    expect(editorImportMock.editor.setDocument).toHaveBeenCalledWith('print("current")', 'script.py');
  });

  it('keeps one editor after rapid reconnects while its import is pending', async () => {
    const editor = document.createElement('nodel-editor');
    document.body.append(editor);
    await waitFor(() => editorImportMock.load.mock.calls.length === 1);
    let reconnects = 0;
    await rapidReconnect(editor, async () => {
      reconnects += 1;
      await waitFor(() => editorImportMock.load.mock.calls.length === reconnects + 1);
    });
    editorImportMock.resolve();
    await waitFor(() => editorImportMock.create.mock.calls.length === 1);

    expect(editorImportMock.create).toHaveBeenCalledOnce();
    expect((editor as any).editor).toBe(editorImportMock.editor);
  });

  it('shows and retries an editor import failure', async () => {
    editorImportMock.create.mockClear();
    editorImportMock.editor.setDocument.mockClear();
    editorImportMock.load.mockReset()
      .mockRejectedValueOnce(new Error('Editor chunk unavailable'))
      .mockResolvedValue({ createNodelCodeEditor: editorImportMock.create });

    document.body.innerHTML = '<nodel-editor></nodel-editor>';
    await waitFor(() => document.querySelector('[data-editor-retry-import]') !== null);

    expect(document.querySelector('nodel-editor')?.textContent).toContain('Editor chunk unavailable');
    document.querySelector<HTMLButtonElement>('[data-editor-retry-import]')?.click();

    await waitFor(() => editorImportMock.create.mock.calls.length === 1);
    await waitFor(() => editorImportMock.editor.setDocument.mock.calls.length > 0);
    expect(editorImportMock.editor.setDocument).toHaveBeenCalledWith('print("current")', 'script.py');
  });
});
