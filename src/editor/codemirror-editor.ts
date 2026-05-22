import { autocompletion } from '@codemirror/autocomplete';
import { indentLess, indentMore } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { tags } from '@lezer/highlight';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { xml } from '@codemirror/lang-xml';
import { languageKindForPath, type EditorLanguageKind } from './file-types';
import { completeNodelDocument } from './nodel-document-definition';

export interface NodelCodeEditor {
  setDocument(text: string, path: string): void;
  getDocument(): string;
  setReadOnly(readOnly: boolean): void;
  focus(): void;
  destroy(): void;
}

export interface NodelCodeEditorOptions {
  parent: HTMLElement;
  path?: string;
  text?: string;
  readOnly?: boolean;
  onChange?: (text: string) => void;
  onSave?: () => void;
}

const nodelHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--nodel-editor-keyword)' },
  { tag: [tags.atom, tags.bool], color: 'var(--nodel-editor-atom)' },
  { tag: tags.number, color: 'var(--nodel-editor-number)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--nodel-editor-string)' },
  { tag: tags.comment, color: 'var(--nodel-editor-comment)', fontStyle: 'italic' },
  { tag: tags.variableName, color: 'var(--nodel-editor-variable)' },
  { tag: [tags.definition(tags.variableName), tags.function(tags.variableName), tags.className], color: 'var(--nodel-editor-definition)' },
  { tag: tags.propertyName, color: 'var(--nodel-editor-property)' },
  { tag: tags.tagName, color: 'var(--nodel-editor-tag)' },
  { tag: tags.attributeName, color: 'var(--nodel-editor-attribute)' },
  { tag: tags.typeName, color: 'var(--nodel-editor-type)' },
  { tag: tags.invalid, color: 'var(--nodel-editor-invalid)' }
]);

export function languageExtensionForPath(path: string): Extension {
  return languageExtensionForKind(languageKindForPath(path));
}

export function languageExtensionForKind(kind: EditorLanguageKind): Extension {
  switch (kind) {
    case 'python':
      return python();
    case 'html':
      return [html(), autocompletion({ override: [completeNodelDocument] })];
    case 'xml':
      return [xml(), autocompletion({ override: [completeNodelDocument] })];
    case 'javascript':
      return javascript();
    case 'json':
      return javascript();
    case 'css':
      return css();
    case 'markdown':
      return markdown();
    default:
      return [];
  }
}

export function createNodelCodeEditor(options: NodelCodeEditorOptions): NodelCodeEditor {
  const language = new Compartment();
  const editable = new Compartment();
  let path = options.path ?? '';

  const theme = EditorView.theme({
    '&': {
      height: '100%',
      minHeight: '100%',
      backgroundColor: 'rgb(var(--nodel-surface))',
      color: 'rgb(var(--nodel-fg))',
      border: '1px solid rgb(var(--nodel-border))',
      borderRadius: '0.75rem',
      overflow: 'hidden'
    },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      minHeight: '100%'
    },
    '.cm-content': {
      caretColor: 'var(--nodel-editor-cursor)'
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--nodel-editor-cursor)'
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'var(--nodel-editor-selection)'
    },
    '.cm-content ::selection': {
      backgroundColor: 'var(--nodel-editor-selection)'
    },
    '.cm-gutters': {
      backgroundColor: 'rgb(var(--nodel-bg))',
      color: 'rgb(var(--nodel-muted))',
      borderRightColor: 'rgb(var(--nodel-border))'
    },
    '.cm-activeLine, .cm-activeLineGutter': {
      backgroundColor: 'var(--nodel-editor-active-line)'
    },
    '.cm-matchingBracket, .cm-nonmatchingBracket': {
      backgroundColor: 'var(--nodel-editor-matching-bracket-bg)',
      outline: '1px solid var(--nodel-editor-matching-bracket-border)'
    },
    '.cm-searchMatch': {
      backgroundColor: 'var(--nodel-editor-search-match)'
    },
    '&.cm-focused': {
      outline: '2px solid rgb(var(--nodel-accent) / 0.35)',
      outlineOffset: '2px'
    }
  });

  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.text ?? '',
      extensions: [
        basicSetup,
        theme,
        syntaxHighlighting(nodelHighlightStyle),
        language.of(languageExtensionForPath(path)),
        editable.of(EditorView.editable.of(!options.readOnly)),
        keymap.of([
          {
            key: 'Tab',
            run: indentMore
          },
          {
            key: 'Shift-Tab',
            run: indentLess
          },
          {
            key: 'Mod-s',
            preventDefault: true,
            run() {
              options.onSave?.();
              return true;
            }
          }
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            options.onChange?.(update.state.doc.toString());
          }
        })
      ]
    })
  });

  return {
    setDocument(text, nextPath) {
      path = nextPath;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        effects: language.reconfigure(languageExtensionForPath(path))
      });
    },
    getDocument() {
      return view.state.doc.toString();
    },
    setReadOnly(readOnly) {
      view.dispatch({
        effects: editable.reconfigure(EditorView.editable.of(!readOnly))
      });
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    }
  };
}
