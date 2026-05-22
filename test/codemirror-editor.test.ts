import { createNodelCodeEditor } from '../src/editor/codemirror-editor';

describe('codemirror editor theme', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('creates an editor with Nodel cursor and syntax theme styling', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const editor = createNodelCodeEditor({
      parent: host,
      path: 'script.py',
      text: 'print("hello")'
    });

    const editorNode = host.querySelector('.cm-editor');
    const contentNode = host.querySelector('.cm-content');
    const styleText = Array.from(document.querySelectorAll('style')).map((style) => style.textContent ?? '').join('\n');

    expect(editorNode).not.toBeNull();
    expect(contentNode).not.toBeNull();
    expect(styleText).toContain('--nodel-editor-cursor');
    expect(styleText).toContain('--nodel-editor-keyword');

    editor.destroy();
  });
});
