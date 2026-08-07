import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { createNodelCodeEditor, languageExtensionForPath } from '../src/editor/codemirror-editor';

describe('codemirror editor theme', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function withRangeGeometryMock() {
    const descriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
    return () => {
      if (descriptor) {
        Object.defineProperty(Range.prototype, 'getClientRects', descriptor);
      } else {
        Reflect.deleteProperty(Range.prototype, 'getClientRects');
      }
    };
  }

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

  it('uses strict JSON syntax rather than JavaScript syntax', async () => {
    const valid = EditorState.create({ doc: '{"value": true}', extensions: [await languageExtensionForPath('settings.json')] });
    const invalid = EditorState.create({ doc: "{value: 'yes'}", extensions: [await languageExtensionForPath('settings.json')] });
    const validTree = ensureSyntaxTree(valid, valid.doc.length, 1000)!;
    const invalidTree = ensureSyntaxTree(invalid, invalid.doc.length, 1000)!;
    let validErrors = 0;
    let invalidErrors = 0;
    validTree.iterate({ enter: (node) => { if (node.type.isError) validErrors += 1; } });
    invalidTree.iterate({ enter: (node) => { if (node.type.isError) invalidErrors += 1; } });
    expect(validErrors).toBe(0);
    expect(invalidErrors).toBeGreaterThan(0);
  });

  it('does not let a stale asynchronous language load replace a newer plain document', async () => {
    const restoreRangeGeometry = withRangeGeometryMock();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createNodelCodeEditor({ parent: host, path: 'Example.java', text: 'public class Example {}' });
    editor.setDocument('value: true', 'settings.yaml');
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    expect(host.querySelector('.cm-content')?.hasAttribute('data-language')).toBe(false);
    editor.destroy();
    restoreRangeGeometry();
  });

  it('reports bounded diagnostics separately and clears them for non-document languages', async () => {
    const restoreRangeGeometry = withRangeGeometryMock();
    const host = document.createElement('div');
    const summaries: Array<{ enabled: boolean; errors: number; warnings: number; truncated: boolean }> = [];
    document.body.appendChild(host);
    const editor = createNodelCodeEditor({ parent: host, path: 'page.html', text: '<nodel-button variant="bad" />', onDiagnostics: (summary) => summaries.push(summary) });
    await vi.waitFor(() => expect(summaries.some((summary) => summary.enabled && summary.errors > 0)).toBe(true), { timeout: 2_000 });
    editor.setDocument('print(1)', 'script.py');
    expect(summaries.at(-1)?.enabled).toBe(false);
    editor.destroy();
    restoreRangeGeometry();
  });

  it('does not emit stale HTML diagnostics after a rapid language switch before lint debounce', async () => {
    const restoreRangeGeometry = withRangeGeometryMock();
    const host = document.createElement('div');
    const summaries: Array<{ enabled: boolean; errors: number; warnings: number; truncated: boolean }> = [];
    document.body.appendChild(host);
    const editor = createNodelCodeEditor({ parent: host, path: 'page.html', text: '<nodel-button variant="bad" />', onDiagnostics: (summary) => summaries.push(summary) });

    editor.setDocument('<nodel-button variant="default" />', 'panel.xml');
    await vi.waitFor(() => expect(summaries.at(-1)).toEqual(
      expect.objectContaining({ enabled: true, errors: 0, warnings: 0, truncated: false })
    ), { timeout: 2_000 });
    await new Promise((resolve) => window.setTimeout(resolve, 400));

    expect(summaries.some((summary) => summary.enabled && summary.errors > 0)).toBe(false);

    editor.destroy();
    restoreRangeGeometry();
  });

  it('does not change content or notify onChange for an unchanged document, and ignores callbacks after destroy', async () => {
    const host = document.createElement('div');
    const changes: string[] = [];
    const summaries: unknown[] = [];
    document.body.appendChild(host);
    const editor = createNodelCodeEditor({ parent: host, path: 'page.html', text: '<nodel-button />', onChange: (text) => changes.push(text), onDiagnostics: (summary) => summaries.push(summary) });
    editor.setDocument('<nodel-button />', 'page.html');
    expect(editor.getDocument()).toBe('<nodel-button />');
    expect(changes).toEqual([]);
    editor.destroy();
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    expect(summaries).toEqual([]);
  });
});
