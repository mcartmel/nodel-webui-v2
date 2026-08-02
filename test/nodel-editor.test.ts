import { flush, waitFor } from './helpers';
import type { NodelFileEntry } from '../src/api/nodel-types';
import { cancelNodeRestartExpectation, getNodeRestartExpectation } from '../src/data/node-restart-source';

const editorApiMock = vi.hoisted(() => ({
  files: [
    { path: 'content/index.html' },
    { path: 'image.png', size: 3 },
    { path: 'script.py' }
  ] as NodelFileEntry[],
  contents: new Map<string, string>([
    ['script.py', 'print("hello")'],
    ['content/index.html', '<nodel-app></nodel-app>']
  ]),
  listNodeFiles: vi.fn(),
  getNodeFileContents: vi.fn(),
  getNodeRestartStatus: vi.fn(),
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
  getNodeRestartStatus: editorApiMock.getNodeRestartStatus,
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
    editorApiMock.files = [
      { path: 'content/index.html' },
      { path: 'image.png', size: 3 },
      { path: 'script.py' }
    ];
    editorApiMock.contents = new Map<string, string>([
      ['script.py', 'print("hello")'],
      ['content/index.html', '<nodel-app></nodel-app>']
    ]);
    editorApiMock.listNodeFiles.mockImplementation(async () => editorApiMock.files);
    editorApiMock.getNodeFileContents.mockImplementation(async (path: string) => editorApiMock.contents.get(path) ?? '');
    editorApiMock.getNodeRestartStatus.mockResolvedValue({ timestamp: 'start-1' });
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
    cancelNodeRestartExpectation(getNodeRestartExpectation());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function mountEditor(markup = '<nodel-editor></nodel-editor>') {
    document.body.innerHTML = markup;
    await customElements.whenDefined('nodel-editor');
    await waitFor(
      () => codeEditorMock.instance.setDocument.mock.calls.some((call) => call[1] === 'script.py'),
      { attempts: 100, message: 'Timed out opening script.py' }
    );
    await waitFor(
      () => document.querySelector<HTMLButtonElement>('[data-editor-toggle-add]')?.disabled === false,
      { attempts: 100, message: 'Timed out enabling editor actions' }
    );
    return document.querySelector('nodel-editor')!;
  }

  function dispatchFileDrag(element: Element, type: string, files: File[], relatedTarget: EventTarget | null = null) {
    const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
    const dataTransfer = {
      dropEffect: 'none',
      files,
      items: files.map((file) => ({ getAsFile: () => file, kind: 'file', type: file.type })),
      types: ['Files']
    };
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
    element.dispatchEvent(event);
    return { dataTransfer, event };
  }

  function textFile(content: string, name: string, type = 'text/plain') {
    const file = new File([content], name, { type });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(content) });
    return file;
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    return { promise, reject, resolve };
  }

  function handleConfirmations(element: Element, decisions: boolean[] = [true]) {
    const requests: Array<{ title?: string; text?: string; trigger?: Element | null }> = [];
    element.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      const detail = (event as CustomEvent<{ title?: string; text?: string; trigger?: Element | null; resolve: (confirmed: boolean) => void }>).detail;
      requests.push(detail);
      detail.resolve(decisions.shift() ?? false);
    });
    return requests;
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
    expect(editorApiMock.getNodeFileContents).toHaveBeenCalledWith('script.py', expect.any(Object), 1024 * 1024);
    expect(codeEditorMock.instance.setDocument).toHaveBeenCalledWith('print("hello")', 'script.py');
    expect(document.querySelector('[data-editor-file-picker] option')?.hasAttribute('data-file-path')).toBe(false);
  });

  it('tracks dirty state and saves through the selected file', async () => {
    const element = await mountEditor();
    const saved = vi.fn();
    element.addEventListener('nodel-editor-file-saved', saved);

    codeEditorMock.currentDoc = 'print("updated")';
    codeEditorMock.options?.onChange?.('print("updated")');

    await waitFor(() => document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled === false);
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(false);
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);

    expect(editorApiMock.saveNodeFile).toHaveBeenCalledWith('script.py', 'print("updated")', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ detail: { path: 'script.py' } }));
  });

  it('keeps typing available but blocks click and keyboard script saves during reload pending', async () => {
    const pendingSave = deferred<unknown>();
    editorApiMock.saveNodeFile.mockImplementationOnce(() => pendingSave.promise);
    const editor = await mountEditor();

    codeEditorMock.currentDoc = 'print("snapshot")';
    codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);

    codeEditorMock.currentDoc = 'print("typed immediately")';
    codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
    codeEditorMock.options?.onSave?.();
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    expect(editorApiMock.saveNodeFile).toHaveBeenCalledTimes(1);

    pendingSave.resolve('');
    await waitFor(() => (editor as any).scriptReloadState === 'pending');
    expect(codeEditorMock.currentDoc).toBe('print("typed immediately")');
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(true);
    expect(editor.textContent).not.toContain('script.py saved. Waiting for node reload.');
  });

  it('coordinates exact script.py overwrite and create saves through the shared gate', async () => {
    const editor = await mountEditor();
    const confirmations = handleConfirmations(editor, [true]);
    document.querySelector<HTMLButtonElement>('[data-editor-toggle-add]')?.click();
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    const pathInput = document.querySelector<HTMLInputElement>('[data-editor-add-path]')!;
    pathInput.value = 'script.py';
    pathInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();

    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);
    await waitFor(() => (editor as any).scriptReloadState === 'pending');

    expect(confirmations[0]?.title).toBe('Overwrite existing file?');
    expect(editorApiMock.saveNodeFile.mock.calls[0][0]).toBe('script.py');
    expect(editorApiMock.getNodeRestartStatus).toHaveBeenCalledWith(
      { timestamp: null, timeout: 0 },
      expect.any(Object)
    );
    expect(editor.textContent).not.toContain('script.py saved. Waiting for node reload.');
  });

  it('blocks exact script writes from a second editor instance', async () => {
    const pendingSave = deferred<unknown>();
    editorApiMock.saveNodeFile.mockImplementationOnce(() => pendingSave.promise);
    const first = await mountEditor();
    const second = document.createElement('nodel-editor');
    document.body.append(second);
    await waitFor(() => codeEditorMock.instance.setDocument.mock.calls.filter((call) => call[1] === 'script.py').length >= 2);

    codeEditorMock.currentDoc = 'print("first editor")';
    (first as any).handleEditorChange(codeEditorMock.currentDoc);
    void (first as any).saveSelectedFile();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);

    codeEditorMock.currentDoc = 'print("second editor")';
    (second as any).handleEditorChange(codeEditorMock.currentDoc);
    await (second as any).saveSelectedFile();
    expect(editorApiMock.saveNodeFile).toHaveBeenCalledTimes(1);

    pendingSave.resolve('');
    await waitFor(() => (second as any).scriptReloadState === 'pending');
    expect(editorApiMock.saveNodeFile).toHaveBeenCalledTimes(1);
    expect((second as any).scriptReloadState).toBe('pending');
  });

  it('keeps a committed global expectation after its initiating editor disconnects', async () => {
    const first = await mountEditor();
    const second = document.createElement('nodel-editor');
    document.body.append(second);
    await waitFor(() => codeEditorMock.instance.setDocument.mock.calls.filter((call) => call[1] === 'script.py').length >= 2);

    codeEditorMock.currentDoc = 'print("owner save")';
    (first as any).handleEditorChange(codeEditorMock.currentDoc);
    void (first as any).saveSelectedFile();
    await waitFor(() => (first as any).scriptReloadState === 'pending');
    expect(editorApiMock.saveNodeFile).toHaveBeenCalledTimes(1);

    first.remove();
    codeEditorMock.currentDoc = 'print("second save")';
    (second as any).handleEditorChange(codeEditorMock.currentDoc);
    await (second as any).saveSelectedFile();

    expect(editorApiMock.saveNodeFile).toHaveBeenCalledTimes(1);
    expect((second as any).scriptReloadState).toBe('pending');
  });

  it('does not issue script save when the reload baseline cannot be captured', async () => {
    const editor = await mountEditor();
    codeEditorMock.currentDoc = 'print("baseline failure")';
    codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
    editorApiMock.getNodeRestartStatus.mockRejectedValueOnce(new Error('node unavailable'));

    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => document.body.textContent?.includes('script.py was not saved') ?? false);

    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
    expect(codeEditorMock.currentDoc).toBe('print("baseline failure")');
    expect(editor).toBeTruthy();
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

    expect(editorApiMock.saveNodeFile).toHaveBeenCalledWith('content/new.html', '', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ detail: { path: 'content/new.html' } }));
  });

  it('stages one dropped text file for path editing before using the existing create flow', async () => {
    const element = await mountEditor();
    const file = textFile('<nodel-app></nodel-app>', 'panel.html', 'text/html');
    const entered = dispatchFileDrag(element, 'dragenter', [file]);
    expect(entered.event.defaultPrevented).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-editor-drop-target]')?.hidden).toBe(false);

    const dropped = dispatchFileDrag(element, 'drop', [file]);
    expect(dropped.event.defaultPrevented).toBe(true);
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    expect(document.querySelector<HTMLElement>('[data-editor-drop-target]')?.hidden).toBe(true);
    expect(document.querySelector<HTMLInputElement>('[data-editor-add-path]')?.value).toBe('panel.html');
    expect(document.body.textContent).toContain('Selected local file: panel.html');
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();

    const pathInput = document.querySelector<HTMLInputElement>('[data-editor-add-path]')!;
    pathInput.value = 'content/panel.html';
    pathInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);
    expect(editorApiMock.saveNodeFile).toHaveBeenCalledWith('content/panel.html', '<nodel-app></nodel-app>', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('routes dropped binary files through the same binary upload path', async () => {
    const element = await mountEditor();
    const confirmations = handleConfirmations(element);
    const file = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    dispatchFileDrag(element, 'drop', [file]);
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);
    expect(editorApiMock.saveNodeFile).toHaveBeenCalledWith('image.png', file, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(confirmations[0]).toMatchObject({ title: 'Overwrite existing file?' });
  });

  it('rejects multiple dropped files without navigating or selecting one', async () => {
    const element = await mountEditor();
    const errored = vi.fn();
    element.addEventListener('nodel-editor-error', errored);
    dispatchFileDrag(element, 'drop', [new File(['staged'], 'staged.txt')]);
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    const dropped = dispatchFileDrag(element, 'drop', [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')]);
    await flush();

    expect(dropped.event.defaultPrevented).toBe(true);
    expect(document.body.textContent).toContain('Drop one file at a time.');
    expect(document.querySelector('[data-editor-add-path]')).toBeNull();
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
    expect(errored).toHaveBeenCalledWith(expect.objectContaining({ detail: { message: 'Drop one file at a time.' } }));
  });

  it('shows drag affordance only for valid file drags and clears it on leave and disconnect', async () => {
    const element = await mountEditor();
    const target = document.querySelector<HTMLElement>('[data-editor-drop-target]')!;
    const textDrag = new Event('dragenter', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(textDrag, 'dataTransfer', { value: { dropEffect: 'none', files: [], items: [], types: ['text/plain'] } });
    element.dispatchEvent(textDrag);
    expect(textDrag.defaultPrevented).toBe(false);
    expect(target.hidden).toBe(true);

    dispatchFileDrag(element, 'dragenter', [new File(['a'], 'a.txt')]);
    expect(target.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(target.hidden).toBe(true);
    dispatchFileDrag(element, 'dragenter', [new File(['a'], 'a.txt')]);
    dispatchFileDrag(element, 'dragleave', [new File(['a'], 'a.txt')]);
    expect(target.hidden).toBe(true);
    dispatchFileDrag(element, 'dragenter', [new File(['a'], 'a.txt')]);
    element.remove();
    expect(target.hidden).toBe(true);
  });

  it('creates a staged upload without discarding the dirty document', async () => {
    const element = await mountEditor();
    codeEditorMock.currentDoc = 'print("dirty")';
    codeEditorMock.options?.onChange?.('print("dirty")');
    await flush();
    const confirmations = handleConfirmations(element);

    dispatchFileDrag(element, 'drop', [textFile('next', 'next.txt')]);
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);
    expect(confirmations).toHaveLength(0);
    expect(codeEditorMock.currentDoc).toBe('print("dirty")');
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(false);
  });

  it('keeps the accessible upload input and stages its selected file', async () => {
    await mountEditor();
    const input = document.querySelector<HTMLInputElement>('[data-editor-upload]')!;
    const file = textFile('local', 'local.txt');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));

    expect(input.type).toBe('file');
    expect(document.querySelector<HTMLInputElement>('[data-editor-add-path]')?.value).toBe('local.txt');
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
  });

  it('clears staged upload state across cancellation and reconnection', async () => {
    const element = await mountEditor();
    dispatchFileDrag(element, 'drop', [new File(['staged'], 'staged.txt')]);
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    document.querySelector<HTMLButtonElement>('[data-editor-cancel-add]')?.click();
    expect(document.querySelector('[data-editor-add-path]')).toBeNull();

    dispatchFileDrag(element, 'drop', [new File(['staged'], 'staged.txt')]);
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    element.remove();
    await flush();
    document.body.append(element);
    await waitFor(() => document.querySelector<HTMLButtonElement>('[data-editor-toggle-add]')?.disabled === false);
    expect(document.querySelector('[data-editor-add-path]')).toBeNull();
  });

  it('opens binary files as read-only and protects script.py deletion', async () => {
    const editor = await mountEditor();
    const confirmations = handleConfirmations(editor);

    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.focus();
    picker.value = 'image.png';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.instance.setDocument.mock.calls.some((call) => call[1] === 'image.png'));

    expect(codeEditorMock.instance.setDocument).toHaveBeenCalledWith('Binary file - preview not available.', 'image.png');
    expect(codeEditorMock.instance.setReadOnly).toHaveBeenLastCalledWith(true);
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-editor-delete]')?.click();
    await waitFor(() => editorApiMock.deleteNodeFile.mock.calls.length === 1);
    expect(editorApiMock.deleteNodeFile).toHaveBeenCalledWith('image.png', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(confirmations[0]).toMatchObject({ title: 'Delete file?' });

    await waitFor(() => editorApiMock.getNodeFileContents.mock.calls.some((call) => call[0] === 'script.py'));
    picker.value = 'script.py';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
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

  it('replaces an unchanged clean script buffer only after confirmed reload', async () => {
    const editor = await mountEditor();
    editorApiMock.files = [{ path: 'script.py', modified: 'after-reload', size: 20 }];
    editorApiMock.contents.set('script.py', 'print("server revision")');

    const result = await (editor as any).refreshAfterRestart({
      expectation: { id: 10, generation: 10, baselineTimestamp: 'start-1', state: 'refreshing' },
      detail: { previousTimestamp: 'start-1', timestamp: 'start-2' }
    });

    expect(result).toEqual({ status: 'verified' });
    expect(codeEditorMock.currentDoc).toBe('print("server revision")');
    expect(editor.textContent).not.toContain('Node reloaded. View is up to date.');
    expect(editor.textContent).not.toContain('View refreshed.');
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(true);
  });

  it('retains newer script edits and updates metadata when confirmed remote content matches the saved baseline', async () => {
    const editor = await mountEditor();
    codeEditorMock.currentDoc = 'print("saved revision")';
    codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);
    await waitFor(() => (editor as any).scriptReloadState === 'pending');

    codeEditorMock.currentDoc = 'print("newer local revision")';
    codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
    editorApiMock.files = [{ path: 'script.py', modified: 'after-reload', size: 22 }];
    editorApiMock.contents.set('script.py', 'print("saved revision")');
    const result = await (editor as any).refreshAfterRestart({
      expectation: {
        id: (editor as any).scriptExpectationId,
        generation: (editor as any).scriptExpectationGeneration,
        baselineTimestamp: 'start-1',
        state: 'refreshing'
      },
      detail: { previousTimestamp: 'start-1', timestamp: 'start-2' }
    });

    expect(result).toMatchObject({ status: 'dirty-preserved' });
    expect(codeEditorMock.currentDoc).toBe('print("newer local revision")');
    expect(editor.textContent).toContain('newer local edits remain unsaved');
    (editor as any).handleRestartEvent({
      type: 'expected-verified',
      expectation: {
        id: (editor as any).scriptExpectationId,
        generation: (editor as any).scriptExpectationGeneration,
        baselineTimestamp: 'start-1',
        state: 'idle'
      },
      result
    });
    expect(editor.textContent).not.toContain('Node reloaded. Newer local edits remain unsaved.');
    expect((editor as any).openedModified).toBe('after-reload');
  });

  it('auto-dismisses transient editor status pill notices', async () => {
    const editor = await mountEditor();
    vi.useFakeTimers();

    (editor as any).setState({ notice: true, status: 'Files refreshed.' });
    expect(document.querySelector<HTMLElement>('.nodel-editor-status')?.hidden).toBe(false);

    await vi.advanceTimersByTimeAsync(3500);

    expect(document.querySelector<HTMLElement>('.nodel-editor-status')?.hidden).toBe(true);
    expect(editor.textContent).not.toContain('Files refreshed.');
  });

  it('preserves local script text and reports conflict or failure during confirmed reconciliation', async () => {
    const editor = await mountEditor();
    codeEditorMock.currentDoc = 'print("local revision")';
    codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
    editorApiMock.contents.set('script.py', 'print("different remote revision")');
    const conflict = await (editor as any).refreshAfterRestart({
      expectation: { id: 11, generation: 11, baselineTimestamp: 'start-1', state: 'refreshing' },
      detail: { previousTimestamp: 'start-1', timestamp: 'start-2' }
    });
    expect(conflict).toMatchObject({ status: 'conflict' });
    expect(codeEditorMock.currentDoc).toBe('print("local revision")');

    (editor as any).handleRestartEvent({
      type: 'expected-superseded',
      expectation: { id: 11, generation: 11, baselineTimestamp: 'start-1', state: 'verification-failed' }
    });
    editorApiMock.listNodeFiles.mockRejectedValueOnce(new Error('refresh list failed'));
    const failure = await (editor as any).refreshAfterRestart({
      expectation: { id: 12, generation: 12, baselineTimestamp: 'start-1', state: 'refreshing' },
      detail: { previousTimestamp: 'start-1', timestamp: 'start-3' }
    });
    expect(failure).toMatchObject({ status: 'failed' });
    expect(codeEditorMock.currentDoc).toBe('print("local revision")');
  });

  it('does not duplicate reload lifecycle text inside the editor', async () => {
    const editor = await mountEditor();
    const expectation = { id: 51, generation: 51, baselineTimestamp: 'start-1', state: 'pending' as const };

    (editor as any).handleRestartEvent({ type: 'expected-pending', expectation });
    expect(editor.textContent).not.toContain('script.py saved. Waiting for node reload.');
    expect(editor.textContent).not.toContain('Newer edits stay local');

    (editor as any).handleRestartEvent({
      type: 'expected-verification-failed',
      expectation: { ...expectation, state: 'verification-failed' as const },
      result: { status: 'failed' as const, detail: 'Parameters failed' }
    });

    expect(editor.textContent).not.toContain('Node reloaded, but view verification failed');
    expect(editor.textContent).not.toContain('Local edits are preserved; check Console');
  });

  it('ignores an expectation A refresh when expectation B supersedes it during file-list await', async () => {
    const pendingList = deferred<NodelFileEntry[]>();
    const editor = await mountEditor();
    editorApiMock.listNodeFiles.mockImplementationOnce(() => pendingList.promise);
    const expectationA = { id: 41, generation: 41, baselineTimestamp: 'start-1', state: 'refreshing' as const };
    const expectationB = { id: 42, generation: 42, baselineTimestamp: 'start-2', state: 'pending' as const };
    const refreshPromise = (editor as any).refreshAfterRestart({
      expectation: expectationA,
      detail: { previousTimestamp: 'start-1', timestamp: 'start-2' }
    });
    await waitFor(() => editorApiMock.listNodeFiles.mock.calls.length >= 2);

    (editor as any).handleRestartEvent({ type: 'expected-superseded', expectation: expectationA });
    (editor as any).handleRestartEvent({ type: 'expected-preparing', expectation: { id: expectationB.id, generation: expectationB.generation, baselineTimestamp: expectationB.baselineTimestamp } });
    (editor as any).handleRestartEvent({ type: 'expected-pending', expectation: expectationB });
    const statusAfterB = (editor as any).state.status;
    const contentBefore = codeEditorMock.currentDoc;
    const dirtyBefore = (editor as any).state.dirty;
    pendingList.resolve(editorApiMock.files);
    const result = await refreshPromise;

    expect(result).toMatchObject({ status: 'superseded' });
    expect(codeEditorMock.currentDoc).toBe(contentBefore);
    expect((editor as any).state.dirty).toBe(dirtyBefore);
    expect((editor as any).state.status).toBe(statusAfterB);
  });

  it('ignores an expectation A content refresh when expectation B supersedes it during content await', async () => {
    const pendingContent = deferred<string>();
    const editor = await mountEditor();
    codeEditorMock.currentDoc = 'print("local")';
    codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
    editorApiMock.getNodeFileContents.mockImplementationOnce(() => pendingContent.promise);
    const expectationA = { id: 51, generation: 51, baselineTimestamp: 'start-1', state: 'refreshing' as const };
    const expectationB = { id: 52, generation: 52, baselineTimestamp: 'start-2', state: 'pending' as const };
    const openedModifiedBefore = (editor as any).openedModified;
    const refreshPromise = (editor as any).refreshAfterRestart({
      expectation: expectationA,
      detail: { previousTimestamp: 'start-1', timestamp: 'start-2' }
    });
    await waitFor(() => editorApiMock.getNodeFileContents.mock.calls.length >= 2);

    (editor as any).handleRestartEvent({ type: 'expected-superseded', expectation: expectationA });
    (editor as any).handleRestartEvent({ type: 'expected-preparing', expectation: { id: expectationB.id, generation: expectationB.generation, baselineTimestamp: expectationB.baselineTimestamp } });
    (editor as any).handleRestartEvent({ type: 'expected-pending', expectation: expectationB });
    const statusAfterB = (editor as any).state.status;
    pendingContent.resolve('print("stale remote")');
    const result = await refreshPromise;

    expect(result).toMatchObject({ status: 'superseded' });
    expect(codeEditorMock.currentDoc).toBe('print("local")');
    expect((editor as any).openedModified).toBe(openedModifiedBefore);
    expect((editor as any).state.dirty).toBe(true);
    expect((editor as any).state.status).toBe(statusAfterB);
  });

  it('ignores an abort-insensitive file list from a disconnected generation', async () => {
    let resolveFirst!: (files: Array<{ path: string }>) => void;
    editorApiMock.listNodeFiles
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce(editorApiMock.files);
    const editor = document.createElement('nodel-editor');
    document.body.append(editor);
    await waitFor(() => editorApiMock.listNodeFiles.mock.calls.length === 1);

    editor.remove();
    document.body.append(editor);
    await waitFor(() => editorApiMock.listNodeFiles.mock.calls.length === 2);
    resolveFirst([{ path: 'stale.py' }]);
    await waitFor(() => codeEditorMock.instance.setDocument.mock.calls.some((call) => call[1] === 'script.py'));

    expect(Array.from(editor.querySelectorAll('option')).some((option) => option.textContent?.includes('stale.py'))).toBe(false);
    expect(codeEditorMock.instance.setDocument).not.toHaveBeenCalledWith(expect.anything(), 'stale.py');
  });

  it('does not expose a stale dirty selection when reconnect loading fails', async () => {
    const editor = await mountEditor();
    codeEditorMock.currentDoc = 'print("dirty")';
    codeEditorMock.options?.onChange?.('print("dirty")');
    await flush();
    expect(editor.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(false);
    editorApiMock.listNodeFiles.mockRejectedValueOnce(new Error('Reconnect failed'));

    editor.remove();
    document.body.append(editor);
    await waitFor(() => editor.getAttribute('data-state') === 'error');

    expect(editor.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(true);
    expect(editor.querySelector<HTMLButtonElement>('[data-editor-delete]')?.disabled).toBe(true);
    expect(editor.querySelector<HTMLSelectElement>('[data-editor-file-picker]')?.value).toBe('');
  });

  it('keeps newer edits dirty and visible when an older save resolves', async () => {
    const pendingSave = deferred<unknown>();
    editorApiMock.saveNodeFile.mockImplementationOnce(() => pendingSave.promise);
    await mountEditor();
    codeEditorMock.currentDoc = 'print("snapshot")';
    codeEditorMock.options?.onChange?.('print("snapshot")');
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);

    codeEditorMock.currentDoc = 'print("newer")';
    codeEditorMock.options?.onChange?.('print("newer")');
    pendingSave.resolve('');
    await waitFor(() => document.body.textContent?.includes('newer edits remain unsaved') ?? false);

    expect(codeEditorMock.currentDoc).toBe('print("newer")');
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(true);
    expect(editorApiMock.getNodeFileContents).toHaveBeenCalledTimes(2);
  });

  it('preserves edits after timeout and requires confirmation for a corrective save', async () => {
    const editor = await mountEditor();
    vi.useFakeTimers();
    codeEditorMock.currentDoc = 'print("first revision")';
    codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await Promise.resolve();
    }
    expect(editorApiMock.saveNodeFile).toHaveBeenCalledTimes(1);
    editorApiMock.contents.set('script.py', 'print("first revision")');

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await Promise.resolve();
    }
    const source = await import('../src/data/node-restart-source');
    await vi.advanceTimersByTimeAsync(source.NODE_RESTART_EXPECTATION_TIMEOUT_MS);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await Promise.resolve();
    }
    expect(document.body.textContent).not.toContain('corrective save is available');
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(false);

    const confirmations = handleConfirmations(editor, [false, true]);
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await Promise.resolve();
    }
    expect(confirmations[0]?.title).toBe('Corrective script save?');
    expect(editorApiMock.saveNodeFile).toHaveBeenCalledTimes(1);

    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    for (let attempt = 0; attempt < 20 && editorApiMock.saveNodeFile.mock.calls.length < 2; attempt += 1) {
      await Promise.resolve();
    }
    expect(confirmations[1]?.title).toBe('Corrective script save?');
    expect(editorApiMock.saveNodeFile).toHaveBeenCalledTimes(2);
    expect(codeEditorMock.currentDoc).toBe('print("first revision")');
    vi.useRealTimers();
  });

  it('preserves the old unconfirmed expectation when a corrective script save fails', async () => {
    const editor = await mountEditor();
    vi.useFakeTimers();
    const source = await import('../src/data/node-restart-source');
    try {
      codeEditorMock.currentDoc = 'print("first revision")';
      codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
      document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
      for (let attempt = 0; attempt < 16; attempt += 1) {
        await Promise.resolve();
      }
      expect(editorApiMock.saveNodeFile).toHaveBeenCalledTimes(1);
      editorApiMock.contents.set('script.py', 'print("first revision")');

      await vi.advanceTimersByTimeAsync(source.NODE_RESTART_EXPECTATION_TIMEOUT_MS);
      for (let attempt = 0; attempt < 16; attempt += 1) {
        await Promise.resolve();
      }
      expect(source.getNodeRestartExpectation()).toMatchObject({ state: 'unconfirmed' });

      editorApiMock.saveNodeFile.mockRejectedValueOnce(new Error('script save response lost'));
      handleConfirmations(editor, [true]);
      document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await Promise.resolve();
      }

      expect(editorApiMock.saveNodeFile).toHaveBeenCalledTimes(2);
      expect(editor.textContent).toContain('script save response lost');
      expect(source.getNodeRestartExpectation()).toMatchObject({ state: 'unconfirmed' });
    } finally {
      source.cancelNodeRestartExpectation(source.getNodeRestartExpectation());
      vi.useRealTimers();
    }
  });

  it('does not let a late save for file A mutate file B', async () => {
    const pendingSave = deferred<unknown>();
    editorApiMock.saveNodeFile.mockImplementationOnce(() => pendingSave.promise);
    const editor = await mountEditor();
    handleConfirmations(editor, [true]);
    codeEditorMock.currentDoc = 'print("snapshot")';
    codeEditorMock.options?.onChange?.('print("snapshot")');
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);

    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'content/index.html';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.currentDoc === '<nodel-app></nodel-app>');
    pendingSave.resolve('');
    await flush();

    expect(picker.value).toBe('content/index.html');
    expect(codeEditorMock.currentDoc).toBe('<nodel-app></nodel-app>');
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(true);
  });

  it('requires explicit overwrite confirmation for canonical existing paths', async () => {
    const editor = await mountEditor();
    let resolveOverwrite!: (confirmed: boolean) => void;
    const requests: Array<{ title?: string; resolve: (confirmed: boolean) => void }> = [];
    editor.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      const detail = (event as CustomEvent<{ title?: string; resolve: (confirmed: boolean) => void }>).detail;
      requests.push(detail);
      resolveOverwrite = detail.resolve;
    });
    document.querySelector<HTMLButtonElement>('[data-editor-toggle-add]')?.click();
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    const input = document.querySelector<HTMLInputElement>('[data-editor-add-path]')!;
    input.value = 'Content/Index.HTML';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => requests.length === 1);

    expect(requests[0].title).toBe('Overwrite existing file?');
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
    resolveOverwrite(false);
    await flush();
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>('[data-editor-add-path]')?.value).toBe('Content/Index.HTML');
  });

  it('does not read an upload before accepted overwrite confirmation', async () => {
    const editor = await mountEditor();
    let resolveOverwrite!: (confirmed: boolean) => void;
    editor.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      resolveOverwrite = (event as CustomEvent<{ resolve: (confirmed: boolean) => void }>).detail.resolve;
    });
    const upload = textFile('replacement', 'index.html', 'text/html');
    dispatchFileDrag(editor, 'drop', [upload]);
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    const input = document.querySelector<HTMLInputElement>('[data-editor-add-path]')!;
    input.value = 'content/index.html';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => typeof resolveOverwrite === 'function');
    expect(upload.text).not.toHaveBeenCalled();
    resolveOverwrite(true);
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);
    expect(upload.text).toHaveBeenCalledOnce();
    expect(editorApiMock.saveNodeFile.mock.calls[0][0]).toBe('content/index.html');
  });

  it('rejects oversized local files before reading or saving them', async () => {
    const editor = await mountEditor();
    const textUpload = textFile('large', 'large.txt');
    Object.defineProperty(textUpload, 'size', { value: 1024 * 1024 + 1 });
    dispatchFileDrag(editor, 'drop', [textUpload]);
    await flush();
    expect(textUpload.text).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('1 MiB upload limit');

    const binaryUpload = new File(['binary'], 'large.zip');
    Object.defineProperty(binaryUpload, 'size', { value: 8 * 1024 * 1024 + 1 });
    dispatchFileDrag(editor, 'drop', [binaryUpload]);
    await flush();
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('8 MiB upload limit');
  });

  it('does not download a listed text file above the edit limit', async () => {
    editorApiMock.files = [{ path: 'script.py', size: 1024 * 1024 + 1 }];
    await mountEditor();

    expect(editorApiMock.getNodeFileContents).not.toHaveBeenCalled();
    expect(codeEditorMock.currentDoc).toBe('File is too large to edit in the browser.');
    expect(document.body.textContent).toContain('download or manage it externally');
    expect(document.querySelector('[data-editor-file-picker] option')?.textContent).toContain('2 MiB');
  });

  it('registers the dirty unload guard and removes it after save and disconnect', async () => {
    const editor = await mountEditor();
    codeEditorMock.currentDoc = 'print("dirty")';
    codeEditorMock.options?.onChange?.('print("dirty")');
    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => editor.getAttribute('data-state') === 'ready');
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    codeEditorMock.currentDoc = 'print("dirty again")';
    codeEditorMock.options?.onChange?.('print("dirty again")');
    editor.remove();
    const disconnectedEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(disconnectedEvent);
    expect(disconnectedEvent.defaultPrevented).toBe(false);
  });

  it('refuses to save when modified metadata or server content changed', async () => {
    editorApiMock.files = [
      { path: 'script.py', modified: '2026-01-01T00:00:00.000Z' },
      { path: 'content/index.html' },
      { path: 'image.png' }
    ];
    await mountEditor();
    codeEditorMock.currentDoc = 'print("local")';
    codeEditorMock.options?.onChange?.('print("local")');
    editorApiMock.files = editorApiMock.files.map((file) => file.path === 'script.py'
      ? { ...file, modified: '2026-01-01T00:00:01.000Z' }
      : file);
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => document.body.textContent?.includes('changed on the node') ?? false);
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();

    editorApiMock.files = editorApiMock.files.map((file) => file.path === 'script.py'
      ? { ...file, modified: '2026-01-01T00:00:00.000Z' }
      : file);
    editorApiMock.contents.set('script.py', 'print("remote")');
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => editorApiMock.getNodeFileContents.mock.calls.length >= 2);
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
  });

  it('applies only the latest file open when requests resolve out of order', async () => {
    const firstOpen = deferred<string>();
    const secondOpen = deferred<string>();
    const editor = await mountEditor();
    editorApiMock.files = [
      ...editorApiMock.files,
      { path: 'content/a.txt' },
      { path: 'content/b.txt' }
    ];
    await (editor as any).refreshAfterRestart();
    editorApiMock.getNodeFileContents.mockImplementation((path: string) => {
      if (path === 'content/a.txt') return firstOpen.promise;
      if (path === 'content/b.txt') return secondOpen.promise;
      return Promise.resolve(editorApiMock.contents.get(path) ?? '');
    });
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'content/a.txt';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    picker.value = 'content/b.txt';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    secondOpen.resolve('current B');
    await waitFor(() => codeEditorMock.currentDoc === 'current B');
    firstOpen.resolve('stale A');
    await flush();

    expect(codeEditorMock.currentDoc).toBe('current B');
    expect(picker.value).toBe('content/b.txt');
  });

  it('does not let late delete completion clear a newer document', async () => {
    const pendingDelete = deferred<unknown>();
    editorApiMock.deleteNodeFile.mockImplementationOnce(() => pendingDelete.promise);
    const editor = await mountEditor();
    handleConfirmations(editor, [true]);
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'image.png';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.currentDoc === 'Binary file - preview not available.');
    document.querySelector<HTMLButtonElement>('[data-editor-delete]')?.click();
    await waitFor(() => editorApiMock.deleteNodeFile.mock.calls.length === 1);

    picker.value = 'script.py';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.currentDoc === 'print("hello")');
    pendingDelete.resolve('');
    await flush();

    expect(codeEditorMock.currentDoc).toBe('print("hello")');
    expect(picker.value).toBe('script.py');
  });

  it('uses shared confirmation before discarding a dirty document', async () => {
    const editor = await mountEditor();
    codeEditorMock.currentDoc = 'print("dirty")';
    codeEditorMock.options?.onChange?.('print("dirty")');
    let resolveDiscard!: (confirmed: boolean) => void;
    let request: { title?: string; text?: string; trigger?: Element | null } | null = null;
    editor.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      const detail = (event as CustomEvent<{ title?: string; text?: string; trigger?: Element | null; resolve: (confirmed: boolean) => void }>).detail;
      request = detail;
      resolveDiscard = detail.resolve;
    });
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.focus();
    picker.value = 'content/index.html';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => request !== null);

    expect(request).toMatchObject({
      title: 'Discard unsaved changes?',
      text: 'Discard unsaved changes to script.py?',
      trigger: picker
    });
    expect(editorApiMock.getNodeFileContents.mock.calls.filter((call) => call[0] === 'content/index.html')).toHaveLength(0);
    resolveDiscard(false);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(picker.value).toBe('script.py');
    expect(codeEditorMock.currentDoc).toBe('print("dirty")');
    expect(document.activeElement).toBe(picker);
  });

  it('cancels delete through the shared confirmation without an API call', async () => {
    const editor = await mountEditor();
    handleConfirmations(editor, [false]);
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'image.png';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.currentDoc === 'Binary file - preview not available.');
    document.querySelector<HTMLButtonElement>('[data-editor-delete]')?.click();
    await flush();
    expect(editorApiMock.deleteNodeFile).not.toHaveBeenCalled();
    expect(picker.value).toBe('image.png');
  });

  it('suppresses an abort-insensitive open completion after disconnect', async () => {
    const pendingOpen = deferred<string>();
    const editor = await mountEditor();
    editorApiMock.files = [...editorApiMock.files, { path: 'content/pending.txt' }];
    await (editor as any).refreshAfterRestart();
    editorApiMock.getNodeFileContents.mockImplementation((path: string) => path === 'content/pending.txt'
      ? pendingOpen.promise
      : Promise.resolve(editorApiMock.contents.get(path) ?? ''));
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'content/pending.txt';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => editorApiMock.getNodeFileContents.mock.calls.some((call) => call[0] === 'content/pending.txt'));
    editor.remove();
    pendingOpen.resolve('stale open');
    await flush();
    expect(codeEditorMock.instance.setDocument).not.toHaveBeenCalledWith('stale open', 'content/pending.txt');
  });

  it('suppresses abort-insensitive save, create, and delete completions after disconnect', async () => {
    const pendingSave = deferred<unknown>();
    editorApiMock.saveNodeFile.mockImplementationOnce(() => pendingSave.promise);
    const editor = await mountEditor();
    const saved = vi.fn();
    editor.addEventListener('nodel-editor-file-saved', saved);
    codeEditorMock.currentDoc = 'print("pending")';
    codeEditorMock.options?.onChange?.('print("pending")');
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);
    editor.remove();
    pendingSave.resolve('');
    await flush();
    expect(saved).not.toHaveBeenCalled();

    document.body.append(editor);
    await waitFor(() => (editor as any).linked === true);
    const pendingCreate = deferred<unknown>();
    editorApiMock.saveNodeFile.mockImplementationOnce(() => pendingCreate.promise);
    const created = vi.fn();
    editor.addEventListener('nodel-editor-file-created', created);
    document.querySelector<HTMLButtonElement>('[data-editor-toggle-add]')?.click();
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    const pathInput = document.querySelector<HTMLInputElement>('[data-editor-add-path]')!;
    pathInput.value = 'content/pending.txt';
    pathInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 2);
    editor.remove();
    pendingCreate.resolve('');
    await flush();
    expect(created).not.toHaveBeenCalled();

    document.body.append(editor);
    await waitFor(() => (editor as any).linked === true);
    const pendingDelete = deferred<unknown>();
    editorApiMock.deleteNodeFile.mockImplementationOnce(() => pendingDelete.promise);
    handleConfirmations(editor, [true]);
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'image.png';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.currentDoc === 'Binary file - preview not available.');
    document.querySelector<HTMLButtonElement>('[data-editor-delete]')?.click();
    await waitFor(() => editorApiMock.deleteNodeFile.mock.calls.length === 1);
    const deleted = vi.fn();
    editor.addEventListener('nodel-editor-file-deleted', deleted);
    editor.remove();
    pendingDelete.resolve('');
    await flush();
    expect(deleted).not.toHaveBeenCalled();
  });

  it('does not discard edits made while refresh confirmation is pending', async () => {
    const editor = await mountEditor();
    codeEditorMock.currentDoc = 'print("first dirty")';
    codeEditorMock.options?.onChange?.('print("first dirty")');
    let resolveDiscard!: (confirmed: boolean) => void;
    editor.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      resolveDiscard = (event as CustomEvent<{ resolve: (confirmed: boolean) => void }>).detail.resolve;
    });
    const initialLists = editorApiMock.listNodeFiles.mock.calls.length;
    document.querySelector<HTMLButtonElement>('[data-editor-refresh]')?.click();
    await waitFor(() => typeof resolveDiscard === 'function');
    codeEditorMock.currentDoc = 'print("newer dirty")';
    codeEditorMock.options?.onChange?.('print("newer dirty")');
    resolveDiscard(true);
    await flush();

    expect(editorApiMock.listNodeFiles).toHaveBeenCalledTimes(initialLists);
    expect(codeEditorMock.currentDoc).toBe('print("newer dirty")');
  });

  it('revalidates overwrite metadata after confirmation', async () => {
    editorApiMock.files = [
      { path: 'script.py' },
      { path: 'content/index.html', modified: '2026-01-01T00:00:00.000Z' },
      { path: 'image.png' }
    ];
    const editor = await mountEditor();
    let resolveOverwrite!: (confirmed: boolean) => void;
    editor.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      resolveOverwrite = (event as CustomEvent<{ resolve: (confirmed: boolean) => void }>).detail.resolve;
    });
    document.querySelector<HTMLButtonElement>('[data-editor-toggle-add]')?.click();
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    const pathInput = document.querySelector<HTMLInputElement>('[data-editor-add-path]')!;
    pathInput.value = 'Content/Index.HTML';
    pathInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => typeof resolveOverwrite === 'function');
    editorApiMock.files = editorApiMock.files.map((file) => file.path === 'content/index.html'
      ? { ...file, modified: '2026-01-01T00:00:01.000Z' }
      : file);
    resolveOverwrite(true);
    await waitFor(() => document.body.textContent?.includes('changed while overwrite confirmation was pending') ?? false);

    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
  });

  it('does not overwrite a file created after the initial create check', async () => {
    await mountEditor();
    const initialFiles = [...editorApiMock.files];
    editorApiMock.listNodeFiles
      .mockResolvedValueOnce(initialFiles)
      .mockResolvedValueOnce([...initialFiles, { path: 'content/new.txt' }]);
    document.querySelector<HTMLButtonElement>('[data-editor-toggle-add]')?.click();
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    const pathInput = document.querySelector<HTMLInputElement>('[data-editor-add-path]')!;
    pathInput.value = 'content/new.txt';
    pathInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => document.body.textContent?.includes('was created on the node') ?? false);
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
  });

  it('revalidates delete metadata after confirmation', async () => {
    editorApiMock.files = [
      { path: 'script.py' },
      { path: 'content/index.html' },
      { path: 'image.png', modified: '2026-01-01T00:00:00.000Z' }
    ];
    const editor = await mountEditor();
    let resolveDelete!: (confirmed: boolean) => void;
    editor.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      resolveDelete = (event as CustomEvent<{ resolve: (confirmed: boolean) => void }>).detail.resolve;
    });
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'image.png';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.currentDoc === 'Binary file - preview not available.');
    document.querySelector<HTMLButtonElement>('[data-editor-delete]')?.click();
    await waitFor(() => typeof resolveDelete === 'function');
    editorApiMock.files = editorApiMock.files.map((file) => file.path === 'image.png'
      ? { ...file, modified: '2026-01-01T00:00:01.000Z' }
      : file);
    resolveDelete(true);
    await waitFor(() => document.body.textContent?.includes('changed on the node') ?? false);
    expect(editorApiMock.deleteNodeFile).not.toHaveBeenCalled();
  });

  it('blocks keyboard save during delete and preserves later edits as dirty', async () => {
    const pendingDelete = deferred<unknown>();
    editorApiMock.deleteNodeFile.mockImplementationOnce(() => pendingDelete.promise);
    const editor = await mountEditor();
    handleConfirmations(editor, [true]);
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'content/index.html';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.currentDoc === '<nodel-app></nodel-app>');
    codeEditorMock.currentDoc = '<nodel-app>dirty</nodel-app>';
    codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
    document.querySelector<HTMLButtonElement>('[data-editor-delete]')?.click();
    await waitFor(() => editorApiMock.deleteNodeFile.mock.calls.length === 1);
    codeEditorMock.options?.onSave?.();
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
    codeEditorMock.currentDoc = '<nodel-app>newer</nodel-app>';
    codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
    pendingDelete.resolve('');
    await waitFor(() => document.body.textContent?.includes('remains open and unsaved') ?? false);

    expect(codeEditorMock.currentDoc).toBe('<nodel-app>newer</nodel-app>');
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(false);
  });

  it('rejects normal editor saves above the text upload limit', async () => {
    await mountEditor();
    codeEditorMock.currentDoc = 'x'.repeat(1024 * 1024 + 1);
    codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => document.body.textContent?.includes('text-upload limit') ?? false);
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
  });

  it('keeps mixed-case script aliases read-only and undeletable', async () => {
    editorApiMock.files = [...editorApiMock.files, { path: 'Script.py' }];
    const editor = await mountEditor();
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'Script.py';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.currentDoc === 'Case-only script.py aliases are read-only in the browser editor.');

    expect(editorApiMock.getNodeFileContents.mock.calls.some((call) => call[0] === 'Script.py')).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[data-editor-delete]')?.disabled).toBe(true);
    expect(editor.textContent).toContain('cannot be edited safely');
  });

  it('targets the listed script.py spelling when a create alias is explicitly overwritten', async () => {
    const editor = await mountEditor();
    handleConfirmations(editor, [true]);
    document.querySelector<HTMLButtonElement>('[data-editor-toggle-add]')?.click();
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    const input = document.querySelector<HTMLInputElement>('[data-editor-add-path]')!;
    input.value = 'SCRIPT.PY';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);
    expect(editorApiMock.saveNodeFile.mock.calls[0][0]).toBe('script.py');
  });

  it('uses literal identity when normalization-distinct legacy files coexist', async () => {
    const composed = 'content/caf\u00e9.txt';
    const decomposed = 'content/cafe\u0301.txt';
    editorApiMock.files = [...editorApiMock.files, { path: composed }, { path: decomposed }];
    editorApiMock.contents.set(composed, 'composed');
    editorApiMock.contents.set(decomposed, 'decomposed');
    await mountEditor();
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = decomposed;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.currentDoc === 'decomposed');

    expect(editorApiMock.getNodeFileContents).toHaveBeenCalledWith(decomposed, expect.any(Object), 1024 * 1024);
    expect(picker.value).toBe(decomposed);
  });

  it('rechecks metadata-free text content after overwrite confirmation', async () => {
    const editor = await mountEditor();
    let resolveOverwrite!: (confirmed: boolean) => void;
    editor.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      resolveOverwrite = (event as CustomEvent<{ resolve: (confirmed: boolean) => void }>).detail.resolve;
    });
    const upload = textFile('replacement', 'index.html');
    dispatchFileDrag(editor, 'drop', [upload]);
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    const input = document.querySelector<HTMLInputElement>('[data-editor-add-path]')!;
    input.value = 'content/index.html';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => typeof resolveOverwrite === 'function');
    editorApiMock.contents.set('content/index.html', 'changed during confirmation');
    resolveOverwrite(true);
    await waitFor(() => document.body.textContent?.includes('changed while overwrite confirmation was pending') ?? false);
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
  });

  it('guards staged upload work from page unload', async () => {
    const editor = await mountEditor();
    dispatchFileDrag(editor, 'drop', [textFile('staged', 'staged.txt')]);
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    const stagedEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(stagedEvent);
    expect(stagedEvent.defaultPrevented).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-editor-cancel-add]')?.click();
    const cancelledEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cancelledEvent);
    expect(cancelledEvent.defaultPrevented).toBe(false);
  });

  it('marks an open buffer dirty when refresh finds its remote file removed', async () => {
    const editor = await mountEditor();
    editorApiMock.files = editorApiMock.files.filter((file) => file.path !== 'script.py');
    await (editor as any).refreshAfterRestart();

    expect(document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')?.value).toBe('script.py');
    expect(document.querySelector('[data-editor-file-picker] option:checked')?.textContent).toContain('local buffer');
    expect(codeEditorMock.currentDoc).toBe('print("hello")');
    expect(editor.textContent).toContain('local buffer remains unsaved');
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(false);
  });

  it('blocks keyboard save while a file open is pending', async () => {
    const pendingOpen = deferred<string>();
    const editor = await mountEditor();
    editorApiMock.getNodeFileContents.mockImplementation((path: string) => path === 'content/index.html'
      ? pendingOpen.promise
      : Promise.resolve(editorApiMock.contents.get(path) ?? ''));
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'content/index.html';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => editorApiMock.getNodeFileContents.mock.calls.some((call) => call[0] === 'content/index.html'));
    codeEditorMock.currentDoc = 'print("dirty during open")';
    codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
    codeEditorMock.options?.onSave?.();
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
    pendingOpen.resolve('<nodel-app></nodel-app>');
    await flush();
    expect(editor.textContent).toContain('newer local edits remain');
  });

  it('does not update one legacy alias baseline when overwriting its sibling', async () => {
    editorApiMock.files = [...editorApiMock.files, { path: 'content/Foo.txt' }, { path: 'content/foo.txt' }];
    editorApiMock.contents.set('content/Foo.txt', 'upper');
    editorApiMock.contents.set('content/foo.txt', 'lower');
    const editor = await mountEditor();
    handleConfirmations(editor, [true]);
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'content/Foo.txt';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.currentDoc === 'upper');
    codeEditorMock.currentDoc = 'replacement';
    codeEditorMock.options?.onChange?.('replacement');
    document.querySelector<HTMLButtonElement>('[data-editor-toggle-add]')?.click();
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    const input = document.querySelector<HTMLInputElement>('[data-editor-add-path]')!;
    input.value = 'content/foo.txt';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);

    expect(editorApiMock.saveNodeFile.mock.calls[0][0]).toBe('content/foo.txt');
    expect(codeEditorMock.currentDoc).toBe('replacement');
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(false);
  });

  it('invalidates a pending open when refresh preserves a removed local buffer', async () => {
    const pendingOpen = deferred<string>();
    const editor = await mountEditor();
    editorApiMock.files = [...editorApiMock.files, { path: 'content/pending.txt' }];
    await (editor as any).refreshAfterRestart();
    editorApiMock.getNodeFileContents.mockImplementation((path: string) => path === 'content/pending.txt'
      ? pendingOpen.promise
      : Promise.resolve(editorApiMock.contents.get(path) ?? ''));
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'content/pending.txt';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => editorApiMock.getNodeFileContents.mock.calls.some((call) => call[0] === 'content/pending.txt'));
    editorApiMock.files = editorApiMock.files.filter((file) => file.path !== 'script.py');
    await (editor as any).refreshAfterRestart();
    pendingOpen.resolve('late pending file');
    await flush();

    expect(codeEditorMock.currentDoc).toBe('print("hello")');
    expect(editor.textContent).toContain('local buffer remains unsaved');
  });

  it('uses content checks after a successful save whose metadata refresh failed', async () => {
    editorApiMock.files = [
      { path: 'script.py', modified: '2026-01-01T00:00:00.000Z' },
      { path: 'content/index.html' },
      { path: 'image.png' }
    ];
    const editor = await mountEditor();
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'content/index.html';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.currentDoc === '<nodel-app></nodel-app>');
    editorApiMock.listNodeFiles
      .mockResolvedValueOnce(editorApiMock.files)
      .mockRejectedValueOnce(new Error('metadata refresh failed'));
    editorApiMock.saveNodeFile.mockImplementation(async (path: string, content: string) => {
      editorApiMock.contents.set(path, content);
      editorApiMock.files = editorApiMock.files.map((file) => file.path === path
        ? { ...file, modified: '2026-01-01T00:00:01.000Z' }
        : file);
      return '';
    });
    codeEditorMock.currentDoc = '<nodel-app>first save</nodel-app>';
    codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);
    await waitFor(() => editor.textContent?.includes('metadata refresh failed') ?? false);

    codeEditorMock.currentDoc = '<nodel-app>second save</nodel-app>';
    codeEditorMock.options?.onChange?.(codeEditorMock.currentDoc);
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 2);
    expect(editorApiMock.saveNodeFile.mock.calls[1][1]).toBe('<nodel-app>second save</nodel-app>');
  });

  it('revalidates metadata-free binary size after delete confirmation', async () => {
    editorApiMock.files = [
      { path: 'script.py' },
      { path: 'image.png', size: 3 }
    ];
    const editor = await mountEditor();
    let resolveDelete!: (confirmed: boolean) => void;
    editor.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      resolveDelete = (event as CustomEvent<{ resolve: (confirmed: boolean) => void }>).detail.resolve;
    });
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'image.png';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.currentDoc === 'Binary file - preview not available.');
    document.querySelector<HTMLButtonElement>('[data-editor-delete]')?.click();
    await waitFor(() => typeof resolveDelete === 'function');
    editorApiMock.files = editorApiMock.files.map((file) => file.path === 'image.png' ? { ...file, size: 4 } : file);
    resolveDelete(true);
    await waitFor(() => editor.textContent?.includes('changed on the node') ?? false);
    expect(editorApiMock.deleteNodeFile).not.toHaveBeenCalled();
  });

  it('recreates a removed file from its preserved local buffer after confirmation', async () => {
    const editor = await mountEditor();
    handleConfirmations(editor, [true]);
    editorApiMock.files = editorApiMock.files.filter((file) => file.path !== 'script.py');
    await (editor as any).refreshAfterRestart();
    editorApiMock.saveNodeFile.mockImplementationOnce(async (path: string, content: string) => {
      editorApiMock.contents.set(path, content);
      editorApiMock.files = [...editorApiMock.files, { path }];
      return '';
    });
    document.querySelector<HTMLButtonElement>('[data-editor-save]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);

    expect(editorApiMock.saveNodeFile.mock.calls[0][0]).toBe('script.py');
    expect(codeEditorMock.currentDoc).toBe('print("hello")');
    expect(document.querySelector<HTMLButtonElement>('[data-editor-save]')?.disabled).toBe(true);
  });

  it('keeps create and delete success visible and restores safe focus', async () => {
    const editor = await mountEditor();
    document.querySelector<HTMLButtonElement>('[data-editor-toggle-add]')?.click();
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    const input = document.querySelector<HTMLInputElement>('[data-editor-add-path]')!;
    input.value = 'content/success.txt';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => editorApiMock.saveNodeFile.mock.calls.length === 1);
    expect(document.querySelector<HTMLElement>('.nodel-editor-status')?.hidden).toBe(false);
    expect(editor.textContent).toContain('Created content/success.txt.');

    handleConfirmations(editor, [true]);
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'image.png';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.currentDoc === 'Binary file - preview not available.');
    document.querySelector<HTMLButtonElement>('[data-editor-delete]')?.click();
    await waitFor(() => editorApiMock.deleteNodeFile.mock.calls.length === 1);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(editor.textContent).toContain('Deleted image.png.');
    expect(document.querySelector<HTMLElement>('.nodel-editor-status')?.hidden).toBe(false);
    expect(document.activeElement).toBe(picker);
  });

  it('blocks overwrite of a listed mixed-case script alias', async () => {
    editorApiMock.files = [{ path: 'Script.py', modified: '2026-01-01T00:00:00.000Z' }];
    document.body.innerHTML = '<nodel-editor></nodel-editor>';
    await waitFor(() => codeEditorMock.instance.setDocument.mock.calls.some((call) => call[1] === 'Script.py'));
    const editor = document.querySelector('nodel-editor')!;
    document.querySelector<HTMLButtonElement>('[data-editor-default]')?.click();
    await flush();
    expect(editorApiMock.getNodeFileContents.mock.calls.some((call) => call[0] === 'script.py')).toBe(false);
    expect(codeEditorMock.currentDoc).toBe('Case-only script.py aliases are read-only in the browser editor.');
    document.querySelector<HTMLButtonElement>('[data-editor-toggle-add]')?.click();
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    const input = document.querySelector<HTMLInputElement>('[data-editor-add-path]')!;
    input.value = 'SCRIPT.PY';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => editor.textContent?.includes('cannot be overwritten safely') ?? false);
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
  });

  it('blocks metadata-free binary overwrite and delete', async () => {
    editorApiMock.files = [{ path: 'script.py' }, { path: 'image.png' }];
    const editor = await mountEditor();
    const picker = document.querySelector<HTMLSelectElement>('[data-editor-file-picker]')!;
    picker.value = 'image.png';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => codeEditorMock.currentDoc === 'Binary file - preview not available.');
    document.querySelector<HTMLButtonElement>('[data-editor-delete]')?.click();
    await waitFor(() => editor.textContent?.includes('no metadata for safe delete verification') ?? false);
    expect(editorApiMock.deleteNodeFile).not.toHaveBeenCalled();

    dispatchFileDrag(editor, 'drop', [new File(['replacement'], 'image.png')]);
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => editor.textContent?.includes('no metadata for safe overwrite verification') ?? false);
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
  });

  it('enforces the text upload limit after decoding', async () => {
    const editor = await mountEditor();
    const upload = textFile('x'.repeat(1024 * 1024 + 1), 'expanded.txt');
    Object.defineProperty(upload, 'size', { value: 1 });
    dispatchFileDrag(editor, 'drop', [upload]);
    await waitFor(() => Boolean(document.querySelector('[data-editor-add-path]')));
    document.querySelector<HTMLButtonElement>('[data-editor-create-empty]')?.click();
    await waitFor(() => editor.textContent?.includes('text-upload limit after decoding') ?? false);
    expect(editorApiMock.saveNodeFile).not.toHaveBeenCalled();
  });
});
