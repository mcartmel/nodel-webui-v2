import { autocompletion } from '@codemirror/autocomplete';
import { html, htmlCompletionSourceWith } from '@codemirror/lang-html';
import type { Extension } from '@codemirror/state';
import {
  nodelHtmlExtraGlobalAttributes,
  nodelHtmlExtraTags,
  withNodelDocumentCompletions
} from './nodel-document-definition';
import { nodelDocumentDiagnostics, type NodelDocumentDiagnosticsOptions } from './nodel-document-diagnostics';

export const nodelHtmlNativeCompletionSource = htmlCompletionSourceWith({
  extraTags: nodelHtmlExtraTags,
  extraGlobalAttributes: nodelHtmlExtraGlobalAttributes
});

export const nodelHtmlCompletionSource = withNodelDocumentCompletions(nodelHtmlNativeCompletionSource);

export function nodelHtmlDocumentSupport(options?: NodelDocumentDiagnosticsOptions): Extension {
  return [
    html({ extraTags: nodelHtmlExtraTags, extraGlobalAttributes: nodelHtmlExtraGlobalAttributes }),
    autocompletion({ override: [nodelHtmlCompletionSource], maxRenderedOptions: 500, tooltipClass: () => 'nodel-editor-completion' }),
    nodelDocumentDiagnostics(options)
  ];
}
