import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { createNodelCodeEditor, languageExtensionForPath } from '../src/editor/codemirror-editor';

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

  it.each([
    ['Example.java', 'public class Example { private int value = 1; }'],
    ['build.groovy', 'def value = true\nprintln value'],
    ['query.sql', 'SELECT name FROM devices WHERE active = true;'],
    ['deploy.sh', '#!/bin/sh\nif true; then echo "ready"; fi']
  ])('loads syntax highlighting for %s on demand', async (path, text) => {
    const state = EditorState.create({ doc: text, extensions: [await languageExtensionForPath(path)] });
    const tree = ensureSyntaxTree(state, state.doc.length, 1000);
    const highlighted: string[] = [];
    expect(tree).not.toBeNull();
    highlightTree(tree!, classHighlighter, (_from, _to, classes) => highlighted.push(classes));
    expect(highlighted.length).toBeGreaterThan(0);
  });

  it('keeps unsupported extensions as plain text', async () => {
    const state = EditorState.create({ doc: 'value: true', extensions: [await languageExtensionForPath('settings.yaml')] });
    const tree = ensureSyntaxTree(state, state.doc.length, 1000);
    const highlighted: string[] = [];
    if (tree) {
      highlightTree(tree, classHighlighter, (_from, _to, classes) => highlighted.push(classes));
    }
    expect(highlighted).toEqual([]);
  });

  it('does not let a stale asynchronous language load replace a newer plain document', async () => {
    const getClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createNodelCodeEditor({ parent: host, path: 'Example.java', text: 'public class Example {}' });
    editor.setDocument('value: true', 'settings.yaml');
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    expect(host.querySelector('.cm-content')?.hasAttribute('data-language')).toBe(false);
    editor.destroy();
    if (getClientRects) {
      Object.defineProperty(Range.prototype, 'getClientRects', getClientRects);
    } else {
      Reflect.deleteProperty(Range.prototype, 'getClientRects');
    }
  });
});
