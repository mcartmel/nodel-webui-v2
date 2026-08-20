import { syntaxTree } from '@codemirror/language';
import { forceLinting, linter, type Diagnostic, type LintSource } from '@codemirror/lint';
import { ViewPlugin, type EditorView } from '@codemirror/view';
import type { EditorState, Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { componentContractCommonAttributes, findComponentContract } from '../component-contract';
import { loadIconCatalogue, loadIconIndex, type IconCatalogue, type IconIndex } from '../icons/catalogue-loader';

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

function directChildren(node: SyntaxNode) {
  const children: SyntaxNode[] = [];
  const cursor = node.cursor();
  if (!cursor.firstChild()) return children;
  do children.push(cursor.node); while (cursor.nextSibling());
  return children;
}

function decodeReference(value: string) {
  if (value.length > 256) return value;
  const match = /^&(?:#x[\da-f]+|#[\d]+|[a-z][a-z\d]+);$/i.exec(value.trim());
  if (!match) return value;
  const numeric = /^&#x([\da-f]+);$/i.exec(match[0]) ?? /^&#(\d+);$/i.exec(match[0]);
  if (numeric) {
    const codePoint = Number.parseInt(numeric[1]!, numeric[0].startsWith('&#x') ? 16 : 10);
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : value;
  }
  try {
    const decoded = new DOMParser().parseFromString(`<span>${match[0]}</span>`, 'text/html').querySelector('span')?.textContent;
    return decoded ?? value;
  } catch {
    return value;
  }
}

function isSubstantiveDirectContent(node: SyntaxNode, state: EditorState) {
  const value = state.sliceDoc(node.from, node.to);
  if (node.name === 'Text') return value.trim().length > 0;
  if (node.name === 'EntityReference' || node.name === 'CharacterReference') return decodeReference(value).trim().length > 0;
  return false;
}

function elementName(node: SyntaxNode, state: EditorState) {
  const tag = child(node, 'OpenTag') ?? child(node, 'SelfClosingTag');
  const name = tag && child(tag, 'TagName');
  return name ? state.sliceDoc(name.from, name.to) : undefined;
}

function elementAttributes(node: SyntaxNode, state: EditorState) {
  const tag = child(node, 'OpenTag') ?? child(node, 'SelfClosingTag');
  return tag ? new Map(attrNodes(tag).map((attr) => [attrName(attr, state), attrValue(attr, state)])) : new Map<string, string>();
}

function hasDeclarativeVisibility(attributes: Map<string, string>) {
  if (attributes.has('hidden') || attributes.has('visibility')) return true;
  if ((attributes.has('visible-value') || attributes.has('visible-values')) && attributes.has('visibility')) return true;
  return ['signal', 'signals'].some((name) => /(?:^|[;,])\s*[^:;,]+:\s*visibility(?:\((?:last|any|all)\))?(?:\s*[;,]|$)/.test(attributes.get(name) ?? ''));
}

function diagnoseFillPlacement(item: { node: SyntaxNode; name: string; attrs: SyntaxNode[] }, state: EditorState, result: Diagnostic[]) {
  if ((item.name !== 'nodel-group' && item.name !== 'nodel-control-grid')) return;
  const fill = item.attrs.find((attr) => attrName(attr, state) === 'fill');
  if (!fill) return;
  const parent = item.node.parent;
  const parentName = parent ? elementName(parent, state) : undefined;
  if (!parent || parentName !== 'nodel-column') {
    add(result, 'warning', fill.from, fill.to, 'Fill applies only to a sole visible child directly inside nodel-column.');
    return;
  }
  if (elementAttributes(item.node, state).has('hidden')) return;
  const competing = directChildren(parent).some((sibling) => {
    if (sibling.from === item.node.from && sibling.to === item.node.to) return false;
    if (sibling.name === 'Text' || sibling.name === 'EntityReference' || sibling.name === 'CharacterReference') return isSubstantiveDirectContent(sibling, state);
    if (sibling.name !== 'Element') return false;
    const attributes = elementAttributes(sibling, state);
    return !hasDeclarativeVisibility(attributes);
  });
  if (competing) add(result, 'warning', fill.from, fill.to, 'Fill is inactive while nodel-column has other definitely visible direct content.');
}

export function diagnoseNodelIconCatalogue(state: EditorState, catalogue: IconCatalogue, tree = syntaxTree(state), index?: IconIndex): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const records = catalogue.records;
  const families = new Set(records.map(record => record.family));
  const styles = new Map<string, Set<string>>();
  for (const record of records) styles.set(record.family, (styles.get(record.family) ?? new Set()).add(record.style));
  const aliases = new Set([...records.flatMap(record => record.aliases), ...Object.keys(index?.aliases ?? {})]);
  const officialAliases = new Map(records.flatMap(record => record.officialAliases.map(alias => [alias, record.name] as const)));
  tree.iterate({ enter(cursor) {
    if (cursor.name !== 'Element') return;
    const tag = child(cursor.node, 'OpenTag') ?? child(cursor.node, 'SelfClosingTag');
    const nameNode = tag && child(tag, 'TagName');
    if (!tag || !nameNode || state.sliceDoc(nameNode.from, nameNode.to) !== 'nodel-icon') return;
    const values = new Map<string, SyntaxNode>();
    for (const attr of attrNodes(tag)) values.set(attrName(attr, state), attr);
    const nameAttr = values.get('name');
    const familyAttr = values.get('family');
    const styleAttr = values.get('style');
    const name = nameAttr ? attrValue(nameAttr, state) : '';
    const family = familyAttr ? attrValue(familyAttr, state) : undefined;
    const style = styleAttr ? attrValue(styleAttr, state) : undefined;
    if (isPlaceholder(name) || (family !== undefined && isPlaceholder(family)) || (style !== undefined && isPlaceholder(style))) return;
    if (family !== undefined && !families.has(family)) add(diagnostics, 'error', familyAttr!.from, familyAttr!.to, 'Icon family is unavailable in the installed catalogue.');
    if (style !== undefined && family !== undefined && families.has(family) && !styles.get(family)?.has(style)) add(diagnostics, 'error', styleAttr!.from, styleAttr!.to, 'Icon style is unavailable for this icon family.');
    if (style !== undefined && family === undefined && !styles.get(index?.default.family ?? '')?.has(style)) add(diagnostics, 'error', styleAttr!.from, styleAttr!.to, 'Icon style is unavailable for the default icon family.');
    if (!name || !nameAttr) return;
    const knownName = aliases.has(name) || records.some(record => record.name === name);
    if (officialAliases.has(name) && !knownName) {
      add(diagnostics, 'error', nameAttr.from, nameAttr.to, `Official Font Awesome alias is not an authored icon name; use ${officialAliases.get(name)}.`);
      return;
    }
    if (!knownName) add(diagnostics, 'error', nameAttr.from, nameAttr.to, 'Unknown Nodel icon name in the installed catalogue.');
    const canonical = index?.aliases[name] ?? records.find(record => record.name === name)?.name ?? records.find(record => record.aliases.includes(name))?.name ?? name;
    const canonicalFamily = family ?? index?.default.family ?? records.find(record => record.name === canonical)?.family;
    const effectiveStyle = style ?? (index?.families.find(item => item.family === canonicalFamily)?.defaultStyle);
    if (knownName && (family === undefined || families.has(family)) && (effectiveStyle === undefined || (canonicalFamily !== undefined && styles.get(canonicalFamily)?.has(effectiveStyle)))) {
      const available = records.some(record => record.name === canonical && (!family || record.family === family) && (!effectiveStyle || record.style === effectiveStyle));
      if (!available) add(diagnostics, 'error', nameAttr.from, nameAttr.to, 'Icon is unavailable for the selected family/style combination.');
    }
  }});
  return diagnostics;
}

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
    diagnoseFillPlacement(item, state, diagnostics);
  }
  if (diagnostics.length >= NODEL_DIAGNOSTIC_LIMITS.maxDiagnostics) truncated = true;
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  return { diagnostics, summary: { enabled: true, errors, warnings: diagnostics.length - errors, truncated } };
}

export function nodelDocumentDiagnostics(options: NodelDocumentDiagnosticsOptions = {}): Extension {
  let catalogue: IconCatalogue | undefined;
  let index: IconIndex | undefined;
  const source: LintSource = (view) => {
    if (options.isCurrent && !options.isCurrent()) return [];
    const result = diagnoseNodelDocument(view.state);
    const iconDiagnostics = catalogue ? diagnoseNodelIconCatalogue(view.state, catalogue, undefined, index) : [];
    const diagnostics = [...result.diagnostics, ...iconDiagnostics].slice(0, NODEL_DIAGNOSTIC_LIMITS.maxDiagnostics);
    const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error').length;
    const summary = { ...result.summary, errors, warnings: diagnostics.length - errors, truncated: result.summary.truncated || diagnostics.length < result.diagnostics.length + iconDiagnostics.length };
    options.onDiagnostics?.(summary);
    return diagnostics;
  };
  const load = Promise.all([loadIconIndex(), loadIconCatalogue()]).then(([loadedIndex, value]) => { index = loadedIndex; catalogue = value; }).catch(() => undefined);
  return [linter(source, { delay: 350 }), ViewPlugin.fromClass(class {
    constructor(private view: EditorView) { void load.then(() => { if (catalogue && this.view.dom.isConnected && (!options.isCurrent || options.isCurrent())) forceLinting(this.view); }); }
  })];
}
