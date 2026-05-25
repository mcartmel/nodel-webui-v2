import { flush, waitFor } from './helpers';

const editorApiMock = vi.hoisted(() => ({
  files: [
    { path: 'content/index.html' },
    { path: 'image.png' },
    { path: 'script.py' }
  ],
  contents: new Map<string, string>([
    ['script.py', 'print("hello")'],
    ['content/index.html', '<nodel-app></nodel-app>']
  ]),
  listNodeFiles: vi.fn(),
  getNodeFileContents: vi.fn(),
  saveNodeFile: vi.fn(),
  deleteNodeFile: vi.fn()
}));

const codeEditorMock = vi.hoisted(() => ({
  currentDoc: '',
  options: null as null | { onChange?: (text: string) => void; onSave?: () => void },
  instance: {
    setDocument: vi.fn((text: string, _path?: string) => {
      codeEditorMock.currentDoc = text;
    }),
    getDocument: vi.fn(() => codeEditorMock.currentDoc),
    setReadOnly: vi.fn(),
    focus: vi.fn(),
    destroy: vi.fn()
  },
  createNodelCodeEditor: vi.fn((options: { onChange?: (text: string) => void; onSave?: () => void }) => {
    codeEditorMock.options = options;
    return codeEditorMock.instance;
  })
}));

vi.mock('../src/api/nodel-host-client', () => ({
  listNodeFiles: editorApiMock.listNodeFiles,
  getNodeFileContents: editorApiMock.getNodeFileContents,
  saveNodeFile: editorApiMock.saveNodeFile,
  deleteNodeFile: editorApiMock.deleteNodeFile
}));

vi.mock('../src/editor/codemirror-editor', () => ({
  createNodelCodeEditor: codeEditorMock.createNodelCodeEditor
}));

import '../src/components/nodel-editor';

describe('nodel-editor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    editorApiMock.listNodeFiles.mockImplementation(async () => editorApiMock.files);
    editorApiMock.getNodeFileContents.mockImplementation(async (path: string) => editorApiMock.contents.get(path) ?? '');
    editorApiMock.saveNodeFile.mockResolvedValue('');
    editorApiMock.deleteNodeFile.mockResolvedValue('');
    codeEditorMock.currentDoc = '';
    codeEditorMock.options = null;
    codeEditorMock.createNodelCodeEditor.mockClear();
    Object.values(codeEditorMock.instance).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) {
        value.mockClear();
      }
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  async function mountEditor(markup = '<nodel-editor></nodel-editor>') {
    document.body.innerHTML = markup;
    await customElements.whenDefined('nodel-editor');
    await waitFor(() => editorApiMock.getNodeFileContents.mock.calls.length > 0);
    await waitFor(() => document.querySelector<HTMLButtonElement>('[data-editor-toggle-add]')?.disabled === false);
    return document.querySelector('nodel-editor')!;
  }

  it('renders linked file dropdown and opens script.py by default', async () => {
    await mountEditor();

    const options = Array.from(document.querySelectorAll('[data-editor-file-picker] option'));
    expect(options.map((option) => option.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('script.py'), expect.stringContaining('content/index.html')]));
    expect(options.map((option) => option.textContent)).not.toEqual(expect.arrayContaining([expect.stringContaining(' - text'), expect.stringContaining(' - binary')]));
    expect(document.querySelector('.nodel-editor')?.className).toContain('space-y-3');
    expect(document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')?.value).toBe('script.py');
    expect(document.body.textContent).not.toContain('File');
    expect(document.body.textContent).not.toContain('Opened script.py');
    const status = document.querySelector<HTMLElement>('.nodel-editor-body > .nodel-editor-status');
    expect(status).toBeTruthy();
    expect(status?.hidden).toBe(true);
    expect(editorApiMock.getNodeFileContents).toHaveBeenCalledWith('script.py', expect.any(Object));
    expect(codeEditorMock.instance.setDocument).toHaveBeenCalledWith('print("hello")', 'script.py');
    expect(document.querySelector('[data-editor-file-picker] option')?.hasAttribute('data-file-path')).toBe(false);
  });

  it('tracks dirty state and saves through the selected file', async () => {
    const element = await mountEditor();
    const saved = vi.fn();
    element.addEventListener('nodel-editor-file-saved', saved);

    codeEditorMock.currentDoc = 'print("updated")';
    codeEditorMock.options?.onChange?.('print("updated")');
    await flush();

    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(false);
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);

    expect(editorApiMock.saveNodeFile).toHaveBeenCalledWith('script.py', 'print("updated")');
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ detail: { path: 'script.py' } }));
  });

  it('creates files from linked add-file state', async () => {
    const element = await mountEditor();
    const created = vi.fn();
    element.addEventListener('nodel-editor-file-created', created);

    document.querySelector<HTMLButtonElement>('[data-editor-toggle-add]')?.click();
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));

    expect(document.querySelector('[data-editor-toggle-add]')?.parentElement?.className).not.toContain('nodel-card');
    expect(document.querySelector('[data-editor-add-form]')?.parentElement?.className).toContain('nodel-editor-add-wrap');
    const input = document.querySelector<HTMLInputElement>('[data-editor-add-path]')!;
    expect(input.placeholder).toBe('e.g. content/index.html');
    input.value = 'content/new.html';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();

    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);

    expect(editorApiMock.saveNodeFile).toHaveBeenCalledWith('content/new.html', '');
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ detail: { path: 'content/new.html' } }));
  });

  it('opens binary files as read-only and protects script.py deletion', async () => {
    await mountEditor();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'image.png';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.instance.setDocument.mock.calls.some((call) => call[1] === 'image.png'));

    expect(codeEditorMock.instance.setDocument).toHaveBeenCalledWith('Binary file - preview not available.', 'image.png');
    expect(codeEditorMock.instance.setReadOnly).toHaveBeenLastCalledWith(true);
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-editor-delete]')?.click();
    await waitFor(() => editorApiMock.deleteNodeFile.mock.calls.length === 1);
    expect(editorApiMock.deleteNodeFile).toHaveBeenCalledWith('image.png');

    await waitFor(() => editorApiMock.getNodeFileContents.mock.calls.some((call) => call[0] === 'script.py'));
    document.querySelector<HTMLButtonElement>('[data-editor-default]')?.click();
    await flush();
    document.querySelector<HTMLButtonElement>('[data-editor-delete]')?.click();
    await flush();
    expect(editorApiMock.deleteNodeFile).toHaveBeenCalledTimes(1);
  });

  it('destroys CodeMirror on disconnect', async () => {
    const element = await mountEditor();
    element.remove();

    expect(codeEditorMock.instance.destroy).toHaveBeenCalledTimes(1);
  });

  it('refreshes the file list after restart without clobbering dirty editor content', async () => {
    const element = await mountEditor();
    codeEditorMock.currentDoc = 'print("dirty")';
    codeEditorMock.options?.onChange?.('print("dirty")');
    await flush();

    editorApiMock.files = [
      { path: 'content/index.html' },
      { path: 'content/new.html' },
      { path: 'script.py' }
    ];

    await (element as any).refreshAfterRestart();
    await waitFor(() => document.body.textContent?.includes('content/new.html'));

    expect(codeEditorMock.currentDoc).toBe('print("dirty")');
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(false);
    expect(editorApiMock.getNodeFileContents).toHaveBeenCalledTimes(1);
  });
});
