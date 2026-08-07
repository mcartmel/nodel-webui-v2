import { autocompletion } from '@codemirror/autocomplete';
import { completeFromSchema, xml } from '@codemirror/lang-xml';
import type { Extension } from '@codemirror/state';
import {
  nodelXmlAttributes,
  nodelXmlElements,
  withNodelDocumentCompletions
} from './nodel-document-definition';
import { nodelDocumentDiagnostics, type NodelDocumentDiagnosticsOptions } from './nodel-document-diagnostics';

export const nodelXmlNativeCompletionSource = completeFromSchema(nodelXmlElements, nodelXmlAttributes);
export const nodelXmlCompletionSource = withNodelDocumentCompletions(nodelXmlNativeCompletionSource);

export function nodelXmlDocumentSupport(options?: NodelDocumentDiagnosticsOptions): Extension {
  return [
    xml({ elements: nodelXmlElements, attributes: nodelXmlAttributes }),
    autocompletion({ override: [nodelXmlCompletionSource], maxRenderedOptions: 500, tooltipClass: () => 'nodel-editor-completion' }),
    nodelDocumentDiagnostics(options)
  ];
}
