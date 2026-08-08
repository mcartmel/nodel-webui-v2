import type { AttrSpec, ElementSpec } from '@codemirror/lang-xml';
import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import {
  componentContractCommonAttributes as commonNodelAttributes,
  componentContracts as nodelDocumentElements,
  componentContractStyles,
  findComponentContract as findNodelElement
} from '../component-contract';
import { slugPageTitle } from '../navigation/navigation';
import { authoredPageDocumentSnippet, authoredPageHead, authoredPageScaffold, authoredPageScaffoldSnippet } from './authored-page-scaffold';

export { authoredPageDocumentSnippet, authoredPageHead, authoredPageScaffold, authoredPageScaffoldSnippet, commonNodelAttributes, findNodelElement, nodelDocumentElements };
export type { ComponentAttributeContract as NodelAttributeDefinition, ComponentContract as NodelElementDefinition } from '../component-contract';

const section = {
  recommended: { name: 'Recommended Nodel elements', rank: 0 },
  advanced: { name: 'Advanced Nodel elements', rank: 10 },
  semantic: { name: 'Semantic classes', rank: 0 },
  state: { name: 'State and variant classes', rank: 1 },
  utility: { name: 'Named utility classes', rank: 2 },
  scaffolds: { name: 'Nodel document scaffolds', rank: -1 },
  fragments: { name: 'Page destinations', rank: 0 },
  ids: { name: 'Static element ids', rank: 1 }
} as const;

function metadata(description: string, extra: string[]) {
  return [description, ...extra.filter(Boolean)].join(' · ');
}

function attributeDetail(attribute: typeof commonNodelAttributes[number]) {
  const constraints = attribute.numeric ? [
    attribute.numeric.min === undefined ? '' : `min ${attribute.numeric.min}${attribute.numeric.exclusiveMin ? ' exclusive' : ''}`,
    attribute.numeric.max === undefined ? '' : `max ${attribute.numeric.max}`,
    attribute.numeric.unit ?? ''
  ].filter(Boolean).join(', ') : '';
  return metadata(attribute.description, [
    attribute.defaultValue === undefined ? '' : `default: ${attribute.defaultValue}`,
    attribute.defaultDescription ?? '',
    attribute.syntax ? `syntax: ${attribute.syntax}` : '',
    constraints ? `constraints: ${constraints}` : '',
    attribute.lifecycle,
    attribute.legacy ? `legacy: ${attribute.legacy}` : ''
  ]);
}

function elementMetadata(element: typeof nodelDocumentElements[number]): Partial<Completion> {
  return {
    type: 'class',
    boost: element.completion === 'recommended' ? 30 : -10,
    section: element.completion === 'recommended' ? section.recommended : section.advanced,
    detail: metadata(element.description, [element.audience, element.registration]),
    info: element.snippet ? `${element.description}\n\nExample:\n${element.snippet}` : element.description
  };
}

function attributesFor(tagName: string) {
  const element = findNodelElement(tagName);
  const attributes = tagName.startsWith('nodel-')
    ? [...(element?.attributes ?? []), ...commonNodelAttributes.filter((common) => !element?.attributes.some((attribute) => attribute.name === common.name))]
    : (element?.attributes ?? []);
  return attributes.filter((attribute) => attribute.completion !== 'hidden');
}

function attrSpec(attribute: typeof commonNodelAttributes[number], global = false): AttrSpec {
  return { name: attribute.name, ...(attribute.values ? { values: attribute.values } : {}), global, completion: { detail: attributeDetail(attribute), type: 'property' } };
}

const htmlExtraTags = Object.fromEntries(nodelDocumentElements.filter((element) => element.completion !== 'hidden').map((element) => [element.name, { attrs: Object.fromEntries(attributesFor(element.name).map((attribute) => [attribute.name, attribute.values ?? null])) }]));
const htmlExtraGlobalAttributes = {};
const xmlAttributes: AttrSpec[] = [];
const xmlElements: ElementSpec[] = nodelDocumentElements.filter((element) => element.completion !== 'hidden').map((element) => ({
  name: element.name,
  attributes: attributesFor(element.name).map((attribute) => attrSpec(attribute)),
  completion: elementMetadata(element)
}));

function ancestor(node: SyntaxNode | null, name: string): SyntaxNode | null {
  while (node && node.name !== name) node = node.parent;
  return node;
}

function child(node: SyntaxNode, name: string) {
  return node.getChild(name);
}

interface DocumentContext {
  tag: SyntaxNode;
  tagNameNode?: SyntaxNode;
  tagName: string;
  attribute?: string;
  attributeFrom?: number;
  valueFrom?: number;
  valueText?: string;
}

function documentContext(context: CompletionContext): DocumentContext | null {
  const treeNode = syntaxTree(context.state).resolveInner(context.pos, -1);
  const tag = ancestor(treeNode, 'OpenTag') ?? ancestor(treeNode, 'SelfClosingTag');
  if (!tag) return null;
  const tagNode = child(tag, 'TagName');
  const tagName = tagNode ? context.state.sliceDoc(tagNode.from, tagNode.to) : '';
  const valueNode = ancestor(treeNode, 'AttributeValue');
  const attrNode = ancestor(valueNode ?? treeNode, 'Attribute');
  const attrNameNode = attrNode ? child(attrNode, 'AttributeName') : null;
  if (!attrNameNode) return { tag, ...(tagNode ? { tagNameNode: tagNode } : {}), tagName };
  if (!valueNode) return { tag, ...(tagNode ? { tagNameNode: tagNode } : {}), tagName, attribute: context.state.sliceDoc(attrNameNode.from, attrNameNode.to), attributeFrom: attrNameNode.from };
  const raw = context.state.sliceDoc(valueNode.from, Math.min(context.pos, valueNode.to));
  const startsQuoted = raw[0] === '"' || raw[0] === "'";
  const valueFrom = valueNode.from + (startsQuoted ? 1 : 0);
  return { tag, ...(tagNode ? { tagNameNode: tagNode } : {}), tagName, attribute: context.state.sliceDoc(attrNameNode.from, attrNameNode.to), attributeFrom: attrNameNode.from, valueFrom, valueText: context.state.sliceDoc(valueFrom, context.pos).replace(/["']$/, '') };
}

function valueRange(context: CompletionContext, from: number) {
  return { from: Math.max(from, Math.min(context.pos, from)), to: context.pos };
}

function actionPhaseCompletions(context: CompletionContext, value: string, from: number, tagName: string, attribute: string): CompletionResult | null {
  const definition = attributesFor(tagName).find((item) => item.name === attribute);
  if (!definition?.syntax?.startsWith('ActionName')) return null;
  const binding = findNodelElement(tagName)?.actionBindings.find((item) => item.attribute === attribute);
  if (!binding) return null;
  const segmentStart = Math.max(value.lastIndexOf(';'), value.lastIndexOf(',')) + 1;
  const colon = value.lastIndexOf(':');
  if (colon < segmentStart) return null;
  const phaseStart = from + colon + 1;
  const options = binding.phases.map((phase) => ({ label: phase, type: 'keyword', detail: phase === binding.defaultPhase ? 'default action phase' : 'action phase', apply: phase }));
  return { ...valueRange(context, phaseStart), options };
}

function signalCompletions(context: CompletionContext, value: string, from: number, tagName: string, attribute: string): CompletionResult | null {
  if (attribute !== 'signal' && attribute !== 'signals') return null;
  const binding = findNodelElement(tagName)?.signalBindings.find((item) => item.attribute === attribute)
    ?? (attribute === 'signals' ? { attribute, targets: [{ name: 'visibility', aggregations: ['any', 'all'] as Array<'any' | 'all'> }] } : undefined);
  if (!binding) return null;
  const segmentStart = Math.max(value.lastIndexOf(';'), value.lastIndexOf(',')) + 1;
  const colon = value.indexOf(':', segmentStart);
  if (colon < segmentStart) return null;
  const targetStart = from + colon + 1;
  const targetText = value.slice(colon + 1);
  const aggregate = targetText.includes('(') ? targetText.slice(0, targetText.indexOf('(')) : targetText;
  const openParen = targetText.indexOf('(');
  const options = openParen >= 0
    ? (binding.targets.find((target) => target.name === aggregate)?.aggregations ?? []).map((item) => ({ label: item, type: 'constant', apply: item }))
    : binding.targets.map((target) => ({ label: target.name, type: 'property', ...(target.aggregations.length ? { detail: 'supports any/all aggregation' } : {}), apply: target.name }));
  return { ...valueRange(context, openParen >= 0 ? from + colon + 1 + openParen + 1 : targetStart), options };
}

function classCompletions(context: CompletionContext, value: string, from: number): CompletionResult {
  let tokenStart = value.length;
  while (tokenStart > 0 && !/\s/.test(value[tokenStart - 1] ?? '')) tokenStart -= 1;
  const existing = new Set(value.split(/\s+/).filter(Boolean));
  const groups = [
    ['semanticClasses', section.semantic],
    ['stateClasses', section.state],
    ['tailwindUtilities', section.utility]
  ] as const;
  const options = groups.flatMap(([key, group]) => componentContractStyles[key].filter((style) => !existing.has(style.name)).map((style) => ({ label: style.name, type: 'type', detail: style.description, section: group, apply: style.name })));
  return { from: from + tokenStart, to: context.pos, options };
}

function fragmentCompletions(context: CompletionContext, from: number): CompletionResult | null {
  const current = documentContext(context);
  if (!current?.attribute || current.attribute !== 'href' || current.tagName !== 'nodel-link' || !current.valueText?.startsWith('#')) return null;
  const pageExplicit = new Map<string, number>();
  const pageTitles = new Map<string, number>();
  const staticIds = new Map<string, number>();
  syntaxTree(context.state).iterate({ enter(node) {
    if (node.name !== 'Element') return;
    const tag = node.node.getChild('OpenTag') ?? node.node.getChild('SelfClosingTag');
    if (!tag) return;
    const tagName = tag.getChild('TagName');
    if (!tagName) return;
    const name = context.state.sliceDoc(tagName.from, tagName.to);
    let title = '';
    let explicitId = '';
    tag.cursor().iterate((part) => {
      if (part.name !== 'Attribute') return;
      const name = part.node.getChild('AttributeName');
      const value = part.node.getChild('AttributeValue');
      if (!name || !value) return;
      const attr = context.state.sliceDoc(name.from, name.to);
      const raw = context.state.sliceDoc(value.from, value.to).replace(/^["']|["']$/g, '');
      if (attr === 'title') title = raw;
      if (attr === 'nav-id') explicitId = raw;
       if (attr === 'id' && raw) staticIds.set(raw, (staticIds.get(raw) ?? 0) + 1);
    });
    if (name === 'nodel-page') {
      if (explicitId) pageExplicit.set(explicitId, (pageExplicit.get(explicitId) ?? 0) + 1);
      if (title && !explicitId) {
        const id = slugPageTitle(title);
        pageTitles.set(id, (pageTitles.get(id) ?? 0) + 1);
      }
    }
  }});
  const candidates = new Map<string, { count: number; option: Completion }>();
  const addCandidates = (values: Map<string, number>, option: (id: string) => Completion) => {
    for (const [id, count] of values) {
      const existing = candidates.get(id);
      candidates.set(id, { count: (existing?.count ?? 0) + count, option: existing?.option ?? option(id) });
    }
  };
  addCandidates(pageExplicit, (id) => ({ label: id, type: 'constant', detail: 'explicit page navigation id', section: section.fragments, apply: id }));
  addCandidates(pageTitles, (id) => ({ label: id, type: 'constant', detail: 'unambiguous page title destination', section: section.fragments, apply: id }));
  addCandidates(staticIds, (id) => ({ label: id, type: 'constant', detail: 'static element id', section: section.ids, apply: id }));
  const options: Completion[] = [...candidates.values()].filter(({ count }) => count === 1).map(({ option }) => option);
  return { from: from + 1, to: context.pos, options: Array.from(new Map(options.map((option) => [option.label, option])).values()) };
}

export function completeNodelDocument(context: CompletionContext): CompletionResult | null {
  const current = documentContext(context);
  if (!current) {
    return context.explicit && context.state.sliceDoc(0, context.pos).trim() === '' ? { from: context.pos, options: nodelDocumentSnippets, validFor: /^[\w -]*$/ } : null;
  }
  if (current.attribute && current.valueText !== undefined && current.valueFrom !== undefined) {
    if (current.attribute === 'class') return classCompletions(context, current.valueText, current.valueFrom);
    const fragments = fragmentCompletions(context, current.valueFrom);
    if (fragments) return fragments;
    const action = actionPhaseCompletions(context, current.valueText, current.valueFrom, current.tagName, current.attribute);
    if (action) return action;
    const signal = signalCompletions(context, current.valueText, current.valueFrom, current.tagName, current.attribute);
    if (signal) return signal;
    return null;
  }
  return null;
}

type SyncCompletionSource = (context: CompletionContext) => CompletionResult | null;

function nativeMetadata(context: CompletionContext, option: Completion): Partial<Completion> {
  const current = documentContext(context);
  const element = nodelDocumentElements.find((candidate) => candidate.name === option.label);
  if (element) return elementMetadata(element);
  if (!current?.tagName) return {};
  const attribute = attributesFor(current.tagName).find((candidate) => candidate.name === option.label);
  if (attribute) return { detail: attributeDetail(attribute), type: 'property' };
  const valueAttribute = current.attribute
    ? attributesFor(current.tagName).find((candidate) => candidate.name === current.attribute)
    : undefined;
  return valueAttribute?.values?.includes(option.label) ? { detail: attributeDetail(valueAttribute) } : {};
}

function decorateNativeResult(context: CompletionContext, result: CompletionResult): CompletionResult {
  return { ...result, options: result.options.map((option) => ({ ...option, ...nativeMetadata(context, option) })) };
}

export function withNodelDocumentCompletions(native: CompletionSource): SyncCompletionSource {
  return (context) => {
    const base = native(context);
    const extra = completeNodelDocument(context);
    if (base instanceof Promise || extra instanceof Promise) return null;
    if (!base) return extra;
    const decorated = decorateNativeResult(context, base);
    if (!extra) return decorated;
    if (extra.from !== decorated.from || (extra.to ?? context.pos) !== (decorated.to ?? context.pos)) return extra;
    const options = [...extra.options, ...decorated.options].filter((option, index, all) => all.findIndex((candidate) => candidate.label === option.label) === index);
    const validFor = extra.validFor ?? decorated.validFor;
    return { ...decorated, ...(validFor ? { validFor } : {}), options };
  };
}

export { htmlExtraGlobalAttributes as nodelHtmlExtraGlobalAttributes, htmlExtraTags as nodelHtmlExtraTags, xmlAttributes as nodelXmlAttributes, xmlElements as nodelXmlElements };

export const nodelDocumentSnippets: Completion[] = [
  snippetCompletion(authoredPageScaffoldSnippet, { label: 'nodel page scaffold', type: 'text', detail: 'Nodel page with row and column', section: section.scaffolds, boost: 100 }),
  snippetCompletion(authoredPageDocumentSnippet, { label: 'nodel custom page head', type: 'text', detail: 'Complete stable authored-page document', section: section.scaffolds, boost: 100 })
];
