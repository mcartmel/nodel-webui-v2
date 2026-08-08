import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic, type LintSource } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { componentContractCommonAttributes, findComponentContract } from '../component-contract';

export const NODEL_DIAGNOSTIC_LIMITS = Object.freeze({ maxDocumentLength: 100_000, maxNodes: 3_000, maxDiagnostics: 100, maxMessageLength: 160 });

export interface NodelDiagnosticsSummary { enabled: boolean; errors: number; warnings: number; truncated: boolean; }
export interface NodelDocumentDiagnosticsResult { diagnostics: Diagnostic[]; summary: NodelDiagnosticsSummary; }
export interface NodelDocumentDiagnosticsOptions { onDiagnostics?: (summary: NodelDiagnosticsSummary) => void; isCurrent?: () => boolean; }

const standardAttributes = new Set('id class style slot part title role tabindex lang dir hidden accesskey contenteditable draggable spellcheck translate inert nonce autocapitalize autofocus enterkeyhint inputmode is itemid itemprop itemref itemscope itemtype exportparts xmlns xmlns:xlink xmlns:svg xmlns:html'.split(' '));
const standardEventAttributes = new Set('onabort onauxclick onbeforeinput onbeforematch onbeforetoggle onblur oncancel onchange onclick onclose oncontextmenu oncopy oncut ondblclick ondrag ondragend ondragenter ondragleave ondragover ondragstart ondrop onerror onfocus onformdata oninput oninvalid onkeydown onkeypress onkeyup onload onmousedown onmouseenter onmouseleave onmousemove onmouseout onmouseover onmouseup onpaste onpointercancel onpointerdown onpointerenter onpointerleave onpointermove onpointerout onpointerover onpointerup onreset onscroll onscrollend onselect onslotchange onsubmit ontoggle onwheel'.split(' '));
const destinationAttributes = new Set(['href', 'node', 'event-binding']);
const placeholder = /\{\{[^}]*\}\}/;

function message(text: string) { return text.length > NODEL_DIAGNOSTIC_LIMITS.maxMessageLength ? text.slice(0, NODEL_DIAGNOSTIC_LIMITS.maxMessageLength - 1) + '…' : text; }
function child(node: SyntaxNode, name: string) { return node.getChild(name); }
function attrNodes(tag: SyntaxNode) { const result: SyntaxNode[] = []; tag.cursor().iterate((node) => { if (node.name === 'Attribute') result.push(node.node); }); return result; }
function attrName(node: SyntaxNode, state: EditorState) { const name = child(node, 'AttributeName'); return name ? state.sliceDoc(name.from, name.to) : ''; }
function attrValue(node: SyntaxNode, state: EditorState) { const value = child(node, 'AttributeValue'); if (!value) return ''; return state.sliceDoc(value.from, value.to).replace(/^['"]|['"]$/g, ''); }
function attrRange(node: SyntaxNode) { return { from: node.from, to: node.to }; }
function add(result: Diagnostic[], severity: Diagnostic['severity'], from: number, to: number, text: string) {
  if (result.length >= NODEL_DIAGNOSTIC_LIMITS.maxDiagnostics) return;
  result.push({ source: 'Nodel', severity, from, to: Math.max(from + 1, to), message: message(text) });
}
function isPlaceholder(value: string) { return placeholder.test(value); }

function parseActions(value: string, phases: readonly string[]) {
  if (!value.trim()) return true;
  return value.split(/[;,]/).every((part) => {
    const item = part.trim();
    if (!item) return true;
    const separator = item.lastIndexOf(':');
    const action = separator > 0 ? item.slice(0, separator).trim() : item;
    const phase = separator > 0 && separator < item.length - 1 ? item.slice(separator + 1).trim() : '';
    return Boolean(action) && (!phase || phases.includes(phase));
  });
}

function signalExpressionIsValid(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  let firstDot = -1;
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== '.') continue;
    let slashes = 0;
    for (let previous = index - 1; previous >= 0 && trimmed[previous] === '\\'; previous -= 1) slashes += 1;
    if (slashes % 2 === 0) { firstDot = index; break; }
  }
  if (firstDot < 0) return trimmed.length > 0;
  const signal = trimmed.slice(0, firstDot).trim();
  const path: string[] = [];
  let segmentStart = firstDot + 1;
  for (let index = segmentStart; index < trimmed.length; index += 1) {
    if (trimmed[index] !== '.') continue;
    let slashes = 0;
    for (let previous = index - 1; previous >= 0 && trimmed[previous] === '\\'; previous -= 1) slashes += 1;
    if (slashes % 2 === 0) {
      path.push(trimmed.slice(segmentStart, index));
      segmentStart = index + 1;
    }
  }
  path.push(trimmed.slice(segmentStart));
  return Boolean(signal) && path.every((segment) => Boolean(segment.trim()));
}

function parseSignals(value: string, targets: { name: string; aggregations: readonly string[] }[], defaultTarget: string | undefined) {
  if (!value.trim()) return true;
  const targetMap = new Map(targets.map((target) => [target.name, target]));
  return value.split(/[;,]/).every((part) => {
    const item = part.trim();
    if (!item) return true;
    const colon = item.indexOf(':');
    if (colon < 0) return Boolean(defaultTarget) && signalExpressionIsValid(item);
    const source = item.slice(0, colon).trim();
    const targetText = item.slice(colon + 1).trim();
    if (!source || !signalExpressionIsValid(source) || !targetText) return false;
    const match = /^([^()]+?)(?:\((last|any|all)\))?$/i.exec(targetText);
    if (!match) return false;
    const targetName = match[1];
    if (!targetName) return false;
    const target = targetMap.get(targetName.trim());
    const mode = match[2]?.toLowerCase();
    if (!target) return false;
    return !mode || mode === 'last' || target.aggregations.includes(mode);
  });
}

function checkNumeric(value: string, numeric: NonNullable<ReturnType<typeof findComponentContract>>['attributes'][number]['numeric'], integer: boolean) {
  if (!numeric) return { valid: true, warning: false };
  const strict = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value.trim());
  const prefixed = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(value.trim());
  if (!strict && !(numeric.normalizesToInteger && prefixed)) return { valid: false, warning: false };
  const number = Number(prefixed?.[0] ?? value);
  if (!Number.isFinite(number)) return { valid: false, warning: false };
    const numericPrefix = prefixed?.[0];
    const normalized = Boolean(numeric.normalizesToInteger && numericPrefix && (numericPrefix !== value.trim() || !Number.isInteger(number)));
  const invalidInteger = integer && !Number.isInteger(number) && !numeric.normalizesToInteger;
  if (invalidInteger) return { valid: false, warning: false };
  const below = numeric.min !== undefined && (numeric.exclusiveMin ? number <= numeric.min : number < numeric.min);
  const above = numeric.max !== undefined && number > numeric.max;
  return { valid: true, warning: normalized || below || above };
}

export function diagnoseNodelDocument(state: EditorState, tree = syntaxTree(state)): NodelDocumentDiagnosticsResult {
  const diagnostics: Diagnostic[] = [];
  let nodes = 0;
  let truncated = state.doc.length > NODEL_DIAGNOSTIC_LIMITS.maxDocumentLength;
  if (truncated) return { diagnostics: [], summary: { enabled: true, errors: 0, warnings: 0, truncated: true } };
  const elements: Array<{ node: SyntaxNode; name: string; tag: SyntaxNode; attrs: SyntaxNode[] }> = [];
  const cursor = tree.cursor();
  let done = false;
  while (!done) {
    nodes += 1;
    if (nodes > NODEL_DIAGNOSTIC_LIMITS.maxNodes) { truncated = true; break; }
    if (cursor.name === 'Element') {
      const element = cursor.node;
      const tag = child(element, 'OpenTag') ?? child(element, 'SelfClosingTag');
      const nameNode = tag ? child(tag, 'TagName') : null;
      if (tag && nameNode) elements.push({ node: element, name: state.sliceDoc(nameNode.from, nameNode.to), tag, attrs: attrNodes(tag) });
    }
    if (cursor.firstChild()) continue;
    while (!cursor.nextSibling()) {
      if (!cursor.parent()) { done = true; break; }
    }
  }
  for (const item of elements) {
    if (diagnostics.length >= NODEL_DIAGNOSTIC_LIMITS.maxDiagnostics) { truncated = true; break; }
    const contract = findComponentContract(item.name);
    if (!contract) {
      if (item.name.startsWith('nodel-')) add(diagnostics, 'warning', item.tag.from, item.tag.to, 'Unknown Nodel element.');
      continue;
    }
    if (contract.completion === 'advanced') add(diagnostics, 'warning', item.tag.from, item.tag.to, 'Advanced Nodel component authored directly.');
    if (contract.registration === 'auto-host') add(diagnostics, 'warning', item.tag.from, item.tag.to, 'Internal auto-host component authored directly.');
    const definitions = new Map([...componentContractCommonAttributes, ...contract.attributes].map((attribute) => [attribute.name, attribute]));
    const values = new Map<string, string>();
    for (const attr of item.attrs) {
      if (diagnostics.length >= NODEL_DIAGNOSTIC_LIMITS.maxDiagnostics) { truncated = true; break; }
      const name = attrName(attr, state);
      const value = attrValue(attr, state);
      values.set(name, value);
      const definition = definitions.get(name);
      const allowed = Boolean(definition) || name.startsWith('data-') || name.startsWith('aria-') || standardAttributes.has(name) || standardEventAttributes.has(name) || name.startsWith('xmlns:');
      if (!allowed) { const range = attrRange(attr); add(diagnostics, 'warning', range.from, range.to, 'Unknown attribute on Nodel element.'); continue; }
      if (definition?.completion === 'hidden') add(diagnostics, 'warning', attr.from, attr.to, 'Internal or hidden attribute authored directly.');
      if (definition?.legacy) add(diagnostics, 'warning', attr.from, attr.to, 'Legacy or deprecated attribute.');
      if (isPlaceholder(value)) continue;
      if (definition?.valueType === 'enum' && definition.values && !definition.values.includes(value)) add(diagnostics, 'error', attr.from, attr.to, 'Enum value is not supported.');
      if (definition?.numeric) {
        const numeric = checkNumeric(value, definition.numeric, definition.valueType === 'integer');
        if (!numeric.valid) add(diagnostics, 'error', attr.from, attr.to, 'Numeric value is malformed.');
        else if (numeric.warning) add(diagnostics, 'warning', attr.from, attr.to, 'Numeric value is normalized or outside its contract range.');
      }
      const action = definition?.syntax?.includes('ActionName') ? contract.actionBindings.find((binding) => binding.attribute === name) : undefined;
      if (action && !parseActions(value, action.phases)) add(diagnostics, 'error', attr.from, attr.to, 'Action binding list is malformed or uses an unsupported phase.');
      const signal = name === 'signal' || name === 'signals' ? contract.signalBindings.find((binding) => binding.attribute === name) ?? (name === 'signals' ? { attribute: name, targets: [{ name: 'visibility', aggregations: ['any', 'all'] as const }] } : undefined) : undefined;
      if (signal && !parseSignals(value, signal.targets, signal.defaultTarget)) add(diagnostics, 'error', attr.from, attr.to, 'Signal binding is malformed or targets an unsupported aggregation.');
      if (name === 'options-signal' && (!signalExpressionIsValid(value) || /[;,():]/.test(value))) add(diagnostics, 'error', attr.from, attr.to, 'Signal binding is malformed.');
      if (name === 'visibility' && (!signalExpressionIsValid(value) || /[;,():]/.test(value))) add(diagnostics, 'error', attr.from, attr.to, 'Visibility signal is malformed.');
    }
    if (item.name === 'nodel-link') {
      const sources = item.attrs.filter((attr) => destinationAttributes.has(attrName(attr, state)));
      if (sources.length !== 1) add(diagnostics, 'error', item.tag.from, item.tag.to, 'Nodel link must have exactly one destination source.');
      else {
        const source = sources[0];
        if (source && !attrValue(source, state).trim()) add(diagnostics, 'error', source.from, source.to, 'Nodel link destination must be nonempty.');
      }
    }
    const parent = item.node.parent;
    const parentTag = parent ? (child(parent, 'OpenTag') ?? child(parent, 'SelfClosingTag')) : null;
    const parentNameNode = parentTag ? child(parentTag, 'TagName') : null;
    const parentName = parentNameNode ? state.sliceDoc(parentNameNode.from, parentNameNode.to) : undefined;
    if (contract.composition?.requiredParent && parentName !== contract.composition.requiredParent) add(diagnostics, 'error', item.tag.from, item.tag.to, 'Component is in an invalid parent placement.');
    if (contract.composition?.requiredDirectChildren) {
      const childNames = new Set<string>();
      for (const directChild of item.node.getChildren('Element')) { const tag = child(directChild, 'OpenTag') ?? child(directChild, 'SelfClosingTag'); const name = tag ? child(tag, 'TagName') : null; if (name) childNames.add(state.sliceDoc(name.from, name.to)); }
      if (contract.composition.requiredDirectChildren.some((required) => !childNames.has(required))) add(diagnostics, 'error', item.tag.from, item.tag.to, 'Component is missing a required direct child.');
    }
  }
  if (diagnostics.length >= NODEL_DIAGNOSTIC_LIMITS.maxDiagnostics) truncated = true;
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  return { diagnostics, summary: { enabled: true, errors, warnings: diagnostics.length - errors, truncated } };
}

export function nodelDocumentDiagnostics(options: NodelDocumentDiagnosticsOptions = {}): Extension {
  const source: LintSource = (view) => {
    if (options.isCurrent && !options.isCurrent()) return [];
    const result = diagnoseNodelDocument(view.state);
    options.onDiagnostics?.(result.summary);
    return result.diagnostics;
  };
  return linter(source, { delay: 350 });
}
