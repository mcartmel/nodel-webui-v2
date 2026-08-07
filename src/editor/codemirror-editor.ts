import { indentLess, indentMore } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { tags } from '@lezer/highlight';
import { languageKindForPath, type EditorLanguageKind } from './file-types';
import type { NodelDiagnosticsSummary } from './nodel-document-diagnostics';

export type { NodelDiagnosticsSummary } from './nodel-document-diagnostics';

export interface NodelCodeEditor {
  setDocument(text: string, path: string): void;
  getDocument(): string;
  setReadOnly(readOnly: boolean): void;
  focus(): void;
  destroy(): void;
}

export interface NodelCodeEditorOptions {
  ariaLabel?: string;
  parent: HTMLElement;
  path?: string;
  text?: string;
  readOnly?: boolean;
  onChange?: (text: string) => void;
  onError?: (error: unknown) => void;
  onSave?: () => void;
  onDiagnostics?: (summary: NodelDiagnosticsSummary) => void;
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

export function languageExtensionForPath(path: string, options?: { onDiagnostics?: (summary: NodelDiagnosticsSummary) => void; isCurrent?: () => boolean }): Promise<Extension> {
  return languageExtensionForKind(languageKindForPath(path), options);
}

export async function languageExtensionForKind(kind: EditorLanguageKind, options?: { onDiagnostics?: (summary: NodelDiagnosticsSummary) => void; isCurrent?: () => boolean }): Promise<Extension> {
  switch (kind) {
    case 'python': {
      const { python } = await import('@codemirror/lang-python');
      return python();
    }
    case 'html': {
      const { nodelHtmlDocumentSupport } = await import('./nodel-html-document-support');
      return nodelHtmlDocumentSupport(options);
    }
    case 'xml': {
      const { nodelXmlDocumentSupport } = await import('./nodel-xml-document-support');
      return nodelXmlDocumentSupport(options);
    }
    case 'javascript': {
      const { javascript } = await import('@codemirror/lang-javascript');
      return javascript();
    }
    case 'json': {
      const { json } = await import('@codemirror/lang-json');
      return json();
    }
    case 'css': {
      const { css } = await import('@codemirror/lang-css');
      return css();
    }
    case 'markdown': {
      const { markdown } = await import('@codemirror/lang-markdown');
      return markdown();
    }
    case 'java': {
      const { java } = await import('@codemirror/lang-java');
      return java();
    }
    case 'groovy': {
      const { groovy } = await import('@codemirror/legacy-modes/mode/groovy');
      return StreamLanguage.define(groovy);
    }
    case 'sql': {
      const { sql } = await import('@codemirror/lang-sql');
      return sql();
    }
    case 'shell': {
      const { shell } = await import('@codemirror/legacy-modes/mode/shell');
      return StreamLanguage.define(shell);
    }
    default:
      return [];
  }
}

export function createNodelCodeEditor(options: NodelCodeEditorOptions): NodelCodeEditor {
  const language = new Compartment();
  const editable = new Compartment();
  let path = options.path ?? '';
  let kind = languageKindForPath(path);
  let languageRequest = 0;
  let destroyed = false;

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
        EditorView.contentAttributes.of({ 'aria-label': options.ariaLabel ?? 'Code editor' }),
        syntaxHighlighting(nodelHighlightStyle),
        language.of([]),
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

  const applyLanguage = async (nextPath: string) => {
    const request = ++languageRequest;
    const nextKind = languageKindForPath(nextPath);
    const hasKindChanged = nextKind !== kind;
    if (!destroyed && request === languageRequest && (hasKindChanged || (nextKind !== 'html' && nextKind !== 'xml'))) {
      options.onDiagnostics?.({ enabled: false, errors: 0, warnings: 0, truncated: false });
    }
    let extension: Extension;
    try {
      extension = await languageExtensionForPath(nextPath, { onDiagnostics: options.onDiagnostics, isCurrent: () => !destroyed && request === languageRequest });
    } catch (error) {
      if (!destroyed && request === languageRequest) {
        options.onError?.(error);
      }
      return;
    }
    if (destroyed || request !== languageRequest) {
      return;
    }
    kind = nextKind;
    view.dispatch({ effects: language.reconfigure(extension) });
  };
  void applyLanguage(path);

  return {
    setDocument(text, nextPath) {
      if (destroyed) {
        return;
      }
      path = nextPath;
      if (view.state.doc.toString() !== text) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      void applyLanguage(path);
    },
    getDocument() {
      return destroyed ? '' : view.state.doc.toString();
    },
    setReadOnly(readOnly) {
      if (destroyed) {
        return;
      }
      view.dispatch({
        effects: editable.reconfigure(EditorView.editable.of(!readOnly))
      });
    },
    focus() {
      if (!destroyed) {
        view.focus();
      }
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      languageRequest += 1;
      view.destroy();
    }
  };
}
