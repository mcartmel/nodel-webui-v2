import { flush, waitFor } from './helpers';

const editorLinkMock = vi.hoisted(() => {
  const links: Array<{ generation: number; resolve: () => void; result?: boolean }> = [];
  return {
    links,
    reset: () => {
      links.length = 0;
    },
    add(generation: number, target: HTMLElement, scope: { isCurrent(): boolean }) {
      let resolve!: () => void;
      const ready = new Promise<void>((done) => {
        resolve = done;
      });
      links.push({ generation, resolve });
      return ready.then(() => {
        if (!scope.isCurrent()) {
          return false;
        }
        target.innerHTML = '<div data-editor-host></div>';
        return true;
      });
    }
  };
});

const editorLifecycleMock = vi.hoisted(() => {
  let resolveImport!: () => void;
  let importReady: Promise<void>;
  const editor = {
    destroy: vi.fn(),
    focus: vi.fn(),
    getDocument: vi.fn(() => ''),
    setDocument: vi.fn(),
    setReadOnly: vi.fn()
  };
  const create = vi.fn(() => editor);
  const reset = () => {
    importReady = new Promise<void>((resolve) => {
      resolveImport = resolve;
    });
    create.mockClear();
    editor.destroy.mockClear();
    editor.setDocument.mockClear();
  };
  reset();
  return {
    create,
    editor,
    releaseImport: () => resolveImport(),
    reset,
    waitForImport: () => importReady
  };
});

vi.mock('../src/jsviews/jsviews-link-controller', () => ({
  JsViewsLinkController: class DelayedJsViewsLinkController {
      constructor(private readonly target: HTMLElement) {}

      link(scope: any) {
        const call = editorLinkMock.links.length;
        return editorLinkMock.add(scope.generation, this.target, scope).then((linked) => {
          editorLinkMock.links[call]!.result = linked;
          return linked;
        });
      }
    }
}));

vi.mock('../src/jsviews/jsviews-runtime', () => ({
  bootstrapJsViews: vi.fn(async () => ({})),
  getJQuery: () => ({
    observable: (value: any) => ({
      refresh: (next: unknown[]) => value.splice(0, value.length, ...next),
      setProperty: (values: object) => Object.assign(value, values)
    })
  })
}));

vi.mock('../src/utils/dynamic-imports', () => ({
  loadCodeEditorModule: vi.fn(() => editorLifecycleMock.waitForImport().then(() => ({
    createNodelCodeEditor: editorLifecycleMock.create
  })))
}));

vi.mock('../src/api/nodel-host-client', () => ({
  deleteNodeFile: vi.fn(),
  getNodeFileContents: vi.fn(async () => 'print("current")'),
  listNodeFiles: vi.fn(async () => [{ path: 'script.py' }]),
  saveNodeFile: vi.fn()
}));

import '../src/components/nodel-editor';

describe('nodel-editor JsViews lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    editorLinkMock.reset();
    editorLifecycleMock.reset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('imports and creates one editor only after the current delayed JsViews link', async () => {
    const editor = document.createElement('nodel-editor');
    document.body.append(editor);
    await waitFor(() => editorLinkMock.links.length === 1);

    editor.remove();
    document.body.append(editor);
    await waitFor(() => editorLinkMock.links.length === 2);

    editorLinkMock.links[0]!.resolve();
    await flush();
    expect(editorLinkMock.links[0]!.result).toBe(false);
    expect(editorLifecycleMock.create).not.toHaveBeenCalled();

    editorLinkMock.links[1]!.resolve();
    await waitFor(() => editorLifecycleMock.create.mock.calls.length === 0 && editor.querySelector('[data-editor-host]') !== null);
    expect(editorLifecycleMock.create).not.toHaveBeenCalled();

    editorLifecycleMock.releaseImport();
    await waitFor(() => editorLifecycleMock.create.mock.calls.length === 1);

    expect(editorLinkMock.links[1]!.result).toBe(true);
    expect(editorLifecycleMock.create).toHaveBeenCalledOnce();
    expect(editorLifecycleMock.editor.setDocument).toHaveBeenCalledWith('print("current")', 'script.py');
    expect(editor.querySelectorAll('[data-editor-host]')).toHaveLength(1);
  });
});
