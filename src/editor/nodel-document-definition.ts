import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import {
  commonNodelAttributes,
  findNodelElement,
  nodelDocumentElements
} from '../nodel-component-metadata';

export { commonNodelAttributes, findNodelElement, nodelDocumentElements } from '../nodel-component-metadata';
export type { NodelAttributeDefinition, NodelElementDefinition } from '../nodel-component-metadata';

export const nodelDocumentSnippets: Completion[] = [
  { label: 'nodel-page scaffold', type: 'text', apply: '<nodel-page title="Page">\n  <nodel-row>\n    <nodel-column>\n      ${}\n    </nodel-column>\n  </nodel-row>\n</nodel-page>', detail: 'Nodel page with row and column' },
  { label: 'nodel custom page head', type: 'text', apply: '<link rel="stylesheet" href="./v2/nodel-webui.css" />\n<script type="module" src="./v2/nodel-webui.js"></script>', detail: 'Stable v2 asset references' }
];

function elementCompletions(): Completion[] {
  return nodelDocumentElements.map((element) => ({ label: element.name, type: 'class', detail: element.description, apply: element.snippet ?? `<${element.name}></${element.name}>` }));
}

function attributeCompletions(tagName: string): Completion[] {
  const element = findNodelElement(tagName);
  const attributes = tagName.startsWith('nodel-')
    ? [...(element?.attributes ?? []), ...commonNodelAttributes.filter((common) => !element?.attributes.some((attribute) => attribute.name === common.name))]
    : (element?.attributes ?? []);
  return attributes.filter((attribute) => attribute.completable !== false).map((attribute) => ({ label: attribute.name, type: 'property', detail: attribute.description, apply: attribute.values?.length ? `${attribute.name}="${attribute.values[0]}"` : `${attribute.name}=""` }));
}

function valueCompletions(tagName: string, attributeName: string): Completion[] {
  const attribute = findNodelElement(tagName)?.attributes.find((item) => item.name === attributeName)
    ?? (tagName.startsWith('nodel-') ? commonNodelAttributes.find((item) => item.name === attributeName) : undefined);
  return (attribute?.values ?? []).map((value) => ({ label: value, type: 'constant', apply: value }));
}

export function completeNodelDocument(context: CompletionContext): CompletionResult | null {
  const before = context.state.sliceDoc(Math.max(0, context.pos - 160), context.pos);
  const tagName = before.match(/<\/?([a-z][\w-]*)[^<>]*$/i)?.[1] ?? '';
  const attributeValue = before.match(/<([a-z][\w-]*)[^<>]*\s([a-z][\w-]*)="[^"]*$/i);
  if (attributeValue) return { from: context.pos, options: valueCompletions(attributeValue[1], attributeValue[2]) };
  if (tagName && before.includes('<') && !before.endsWith('</')) {
    const word = context.matchBefore(/[\w-]*$/);
    return { from: word?.from ?? context.pos, options: attributeCompletions(tagName) };
  }
  const tag = context.matchBefore(/<\/?[\w-]*$/);
  if (tag) return { from: tag.from + (tag.text.startsWith('</') ? 2 : 1), options: elementCompletions() };
  const word = context.matchBefore(/[\w-]*$/);
  return context.explicit && word ? { from: word.from, options: [...elementCompletions(), ...nodelDocumentSnippets] } : null;
}
