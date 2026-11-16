// @vitest-environment jsdom

import { acceptCompletion, autocompletion, CompletionContext, completionStatus, currentCompletions, selectedCompletion, setSelectedCompletion, startCompletion, type CompletionResult } from '@codemirror/autocomplete';
import { htmlLanguage } from '@codemirror/lang-html';
import { xmlLanguage } from '@codemirror/lang-xml';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import * as lint from '@codemirror/lint';
import { vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { IconCatalogue, IconIndex } from '../src/icons/catalogue-loader';
import { validateIconArtifact, validateIconCatalogue } from '../src/icons/icon-artifact';

const catalogue: IconCatalogue = {
  schemaVersion: 2, profile: 'free', records: [
    { name: 'power-off', label: 'Power Off', family: 'classic', style: 'solid', terms: ['power'], aliases: ['power'], officialAliases: ['power-button'] },
    { name: 'warning-octagon', label: 'Warning Octagon', family: 'classic', style: 'solid', terms: ['warning'], aliases: [], officialAliases: ['warning'] },
    { name: 'tv', label: 'TV', family: 'classic', style: 'solid', terms: ['television'], aliases: [], officialAliases: [] },
    { name: '0', label: '0', family: 'classic', style: 'solid', terms: ['nada'], aliases: [], officialAliases: [] },
    { name: 'address-book', label: 'Address Book', family: 'classic', style: 'regular', terms: ['contacts'], aliases: [], officialAliases: ['address-card-old'] },
    { name: 'github', label: 'GitHub', family: 'brands', style: 'brands', terms: ['repository'], aliases: [], officialAliases: [] },
    { name: 'lightbulb', label: 'Lightbulb', family: 'mdi', style: 'default', terms: ['bulb', 'home automation', 'idea', 'lighting', 'power'], aliases: [], officialAliases: ['bulb', 'idea', 'power'] },
    { name: 'power', label: 'Power', family: 'mdi', style: 'default', terms: ['power'], aliases: [], officialAliases: [] }
  ]
};
catalogue.records.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
function contentDigest(value: unknown, length: number) { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length); }
function fixtureStyle(family: string, style: string) {
  const records = catalogue.records.filter(record => record.family === family && record.style === style).map(record => ({ name: record.name, width: 16, height: 16, unicode: 'f001', ligatures: [], paths: ['M0'] }));
  const shard = { schemaVersion: 2, profile: 'free', family, style, bucket: 0, records };
  return { style, sharding: { algorithm: 'fnv1a-32', bucketCount: 1, maxBytes: 131072 }, shards: [`v2/icons/${family}-${style}-0-${contentDigest(shard, 12)}.json`] };
}
const families: IconIndex['families'] = [
  { library: 'fontawesome', family: 'classic', defaultStyle: 'solid', styles: [fixtureStyle('classic', 'solid'), fixtureStyle('classic', 'regular')] },
  { library: 'fontawesome', family: 'brands', defaultStyle: 'brands', styles: [fixtureStyle('brands', 'brands')] },
  { library: 'mdi', family: 'mdi', defaultStyle: 'default', styles: [fixtureStyle('mdi', 'default')] }
];
const index = {
  schemaVersion: 2, profile: 'free' as const, packageVersion: '0.1.2',
  sources: [
    ...['@fortawesome/fontawesome-free', '@fortawesome/free-brands-svg-icons', '@fortawesome/free-regular-svg-icons', '@fortawesome/free-solid-svg-icons'].map(packageName => ({ library: 'fontawesome', package: packageName, version: '7.3.1' })),
    { library: 'mdi', package: '@mdi/svg', version: '7.4.47' }
  ],
  default: { family: 'classic', style: 'solid' }, aliases: { power: 'power-off', warning: 'warning-octagon' },
  families, cataloguePath: `v2/icons/catalogue-${contentDigest(catalogue, 16)}.json`
};

let indexResult: Promise<IconIndex> = Promise.resolve(index);
let catalogueResult: Promise<IconCatalogue> = Promise.resolve(catalogue);
vi.mock('../src/icons/catalogue-loader', async () => {
  const actual = await vi.importActual('../src/icons/catalogue-loader') as Record<string, unknown>;
  return { ...actual, loadIconIndex: () => indexResult, loadIconCatalogue: () => catalogueResult };
});
vi.mock('@codemirror/lint', async () => {
  const actual = await vi.importActual('@codemirror/lint') as Record<string, unknown>;
  return { ...actual, forceLinting: vi.fn() };
});

import { nodelHtmlCompletionSource } from '../src/editor/nodel-html-document-support';
import { nodelXmlCompletionSource } from '../src/editor/nodel-xml-document-support';
import { diagnoseNodelIconCatalogue, nodelDocumentDiagnostics } from '../src/editor/nodel-document-diagnostics';

function context(text: string) {
  const state = EditorState.create({ doc: text, extensions: [htmlLanguage] });
  return new CompletionContext(state, text.length, true);
}

async function completion(text: string): Promise<CompletionResult | null> {
  const result = nodelHtmlCompletionSource(context(text)) as CompletionResult | Promise<CompletionResult | null> | null;
  return result instanceof Promise ? await result : result;
}

async function xmlCompletion(text: string): Promise<CompletionResult | null> {
  const state = EditorState.create({ doc: text, extensions: [xmlLanguage] });
  const result = nodelXmlCompletionSource(new CompletionContext(state, text.length, true)) as CompletionResult | Promise<CompletionResult | null> | null;
  return result instanceof Promise ? await result : result;
}

function validCompletionValue(result: CompletionResult | null, text: string) {
  const validFor = result?.validFor;
  if (validFor instanceof RegExp) return validFor.test(text);
  return validFor?.(text, 0, text.length, EditorState.create({ doc: text, extensions: [htmlLanguage] })) ?? false;
}

async function waitForEditorOptions(view: EditorView, predicate: (options: ReturnType<typeof currentCompletions>) => boolean) {
  await vi.waitFor(() => {
    const options = currentCompletions(view.state);
    expect(predicate(options), `Current icon completion labels: ${options.slice(0, 10).map(option => option.label).join(', ')}`).toBe(true);
  }, { interval: 5, timeout: 1_000 });
}

describe('profile-aware icon editor support', () => {
  beforeEach(() => {
    indexResult = Promise.resolve(index);
    catalogueResult = Promise.resolve(catalogue);
  });

  it('uses a complete schema-valid Free index and catalogue fixture', () => {
    expect(() => validateIconArtifact(index, 'free')).not.toThrow();
    expect(() => validateIconCatalogue(catalogue, 'free', index)).not.toThrow();
  });

  it('matches query prefixes, terms, aliases and official aliases, ranks, caps, and preserves ranges', async () => {
    const result = await completion('<nodel-icon name="tele');
    expect(result?.from).toBe('<nodel-icon name="'.length);
    expect(result?.to).toBe('<nodel-icon name="tele'.length);
    expect(result?.options[0]?.label).toBe('tv');
    expect(result?.options.find(option => option.label === 'power')).toBeUndefined();

    const official = await completion('<nodel-icon name="power-button');
    expect(official?.options.find(option => option.label === 'power-button')?.apply).toBe('power-off');
    const officialSearchTerm = await completion('<nodel-icon name="nada');
    expect(officialSearchTerm?.options.find(option => option.label === '0')?.apply).toBe('0');
  });

  it('filters family and style by the current icon and merges native options without duplicates', async () => {
    const family = await completion('<nodel-icon name="address-book" family="');
    expect(family?.options.map(option => option.label)).toEqual(['classic']);
    const publicFamilies = await completion('<nodel-icon family="');
    expect(publicFamilies?.options.map(option => option.label)).not.toContain('mdi');
    const style = await completion('<nodel-icon name="address-book" family="classic" style="');
    expect(style?.options.map(option => option.label)).toEqual(['regular']);
    const ordinary = await completion('<nodel-icon name="');
    expect(new Set(ordinary?.options.map(option => option.label)).size).toBe(ordinary?.options.length);
  });

  it('offers MDI only for mdi: queries, emits canonical names, and keeps same-name libraries distinct', async () => {
    const prefixed = await completion('<nodel-icon name="mdi:bul');
    expect(prefixed?.options.map(option => option.label)).toContain('mdi:lightbulb');
    expect(prefixed?.options.every(option => String(option.label).startsWith('mdi:'))).toBe(true);
    expect(prefixed?.options.find(option => option.label === 'mdi:lightbulb')?.apply).toBe('mdi:lightbulb');
    const unprefixed = await completion('<nodel-icon name="power');
    expect(unprefixed?.options.map(option => option.label)).toContain('power');
    expect(unprefixed?.options.map(option => option.label)).toContain('mdi:power');
    expect(unprefixed?.options.find(option => option.label === 'mdi:power')?.apply).toBe('mdi:power');
    expect(validCompletionValue(prefixed, 'mdi:bul')).toBe(true);
    const prefixOnly = await completion('<nodel-icon name="mdi:');
    expect(validCompletionValue(prefixOnly, 'mdi:')).toBe(true);
  });

  it('accepts colon completion ranges in HTML and XML authoring contexts', async () => {
    const html = await completion('<nodel-icon name="mdi:light');
    const xml = await xmlCompletion('<nodel-icon name="mdi:light');
    expect(html?.options.map(option => option.label)).toContain('mdi:lightbulb');
    expect(xml?.options.map(option => option.label)).toContain('mdi:lightbulb');
    expect(xml?.from).toBe('<nodel-icon name="'.length);
    expect(validCompletionValue(xml, 'mdi:light')).toBe(true);
  });

  it.each([
    ['HTML', htmlLanguage, nodelHtmlCompletionSource],
    ['XML', xmlLanguage, nodelXmlCompletionSource]
  ] as const)('reruns asynchronous %s completions after typing into an MDI prefix', async (_label, language, source) => {
    const host = document.createElement('div');
    const initial = '<nodel-icon name="mdi:">';
    const observedSource = vi.fn(source);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: initial, selection: EditorSelection.cursor(initial.indexOf('">')), extensions: [language, autocompletion({ override: [observedSource] })] })
    });
    try {
      ensureSyntaxTree(view.state, view.state.doc.length, 10_000);
      const directResult = await Promise.resolve(source(new CompletionContext(view.state, view.state.selection.main.head, true))) as CompletionResult | null;
      expect(directResult?.options.map(option => option.label)).toContain('mdi:power');
      expect(startCompletion(view)).toBe(true);
      await waitForEditorOptions(view, options => options.some(option => option.label === 'mdi:power'));
      expect(currentCompletions(view.state).some(option => option.label === 'mdi:lightbulb')).toBe(true);
      const start = view.state.selection.main.head;
      view.dispatch({ changes: { from: start, insert: 'lig' }, selection: EditorSelection.cursor(start + 3), annotations: Transaction.userEvent.of('input.type') });
      await vi.waitFor(() => expect(observedSource.mock.calls.length).toBeGreaterThan(1), { interval: 5, timeout: 1_000 });
      await waitForEditorOptions(view, options => options.some(option => option.label === 'mdi:lightbulb') && !options.some(option => option.label === 'mdi:power'));
      expect(currentCompletions(view.state).map(option => option.label)).toContain('mdi:lightbulb');
    } finally {
      view.destroy();
    }
  });

  describe.each([
    ['HTML', htmlLanguage, nodelHtmlCompletionSource],
    ['XML', xmlLanguage, nodelXmlCompletionSource]
  ] as const)('bounds accepted icon scalar replacements in %s', (_label, language, source) => {
    it.each([
      ['closed double quote with adjacent attributes', '<nodel-icon name="mdi:bul|b" alt="Lighting"></nodel-icon>'],
      ['closed single quote with adjacent attributes', "<nodel-icon name='mdi:bul|b' alt='Lighting'></nodel-icon>"],
      ['closed multiline double quote', '<nodel-icon name="mdi:bul|\nb" alt="Lighting"></nodel-icon>'],
      ['closed multiline single quote', "<nodel-icon name='mdi:bul|\nb' alt='Lighting'></nodel-icon>"],
      ['missing double quote at EOF', '<nodel-icon name="mdi:bul|'],
      ['missing single quote at EOF', "<nodel-icon name='mdi:bul|"],
      ['missing quote before document closing tags', '<nodel-app><nodel-page><nodel-icon name="mdi:bul|\n</nodel-page>\n</nodel-app>'],
      ['later double quote on another element', '<nodel-icon name="mdi:bul|\n</nodel-page><nodel-page title="Next"></nodel-page></nodel-app>'],
      ['later single quote on another element', "<nodel-icon name='mdi:bul|\n</nodel-page><nodel-page title='Next'></nodel-page></nodel-app>"],
      ['missing quote before an adjacent attribute', '<nodel-icon name="mdi:bul| alt="Lighting"></nodel-icon>'],
      ['uncertain unclosed scalar suffix', '<nodel-icon name="mdi:bul|b\n</nodel-page>\n</nodel-app>']
    ])('preserves the document suffix for %s', async (_case, marked) => {
      const host = document.createElement('div');
      const cursor = marked.indexOf('|');
      const initial = marked.replace('|', '');
      const expected = marked.replace(/mdi:bul\|(?:\n?b(?=["']))?/, 'mdi:lightbulb');
      const view = new EditorView({
        parent: host,
        state: EditorState.create({ doc: initial, selection: EditorSelection.cursor(cursor), extensions: [language, autocompletion({ override: [source], interactionDelay: 0 })] })
      });
      try {
        ensureSyntaxTree(view.state, view.state.doc.length, 10_000);
        expect(startCompletion(view)).toBe(true);
        await waitForEditorOptions(view, options => options.some(option => option.label === 'mdi:lightbulb'));
        expect(currentCompletions(view.state)[0]?.label).toBe('mdi:lightbulb');
        expect(completionStatus(view.state)).toBe('active');
        view.dispatch({ effects: setSelectedCompletion(0) });
        expect(selectedCompletion(view.state)?.label).toBe('mdi:lightbulb');
        expect(acceptCompletion(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(expected);
      } finally {
        view.destroy();
      }
    });
  });

  it('keeps enlarged mixed-library suggestions unique and bounded at 200 results', async () => {
    const records: IconCatalogue['records'] = Array.from({ length: 250 }, (_, number) => {
      const name = `mdi-test-${String(number).padStart(3, '0')}`;
      return { name, label: name, family: 'mdi', style: 'default', terms: ['mdi search'], aliases: [], officialAliases: [] };
    });
    catalogueResult = Promise.resolve({ schemaVersion: 2, profile: 'free', records });
    const result = await completion('<nodel-icon name="mdi:mdi-test-');
    expect(result?.options).toHaveLength(200);
    expect(new Set(result?.options.map(option => option.label)).size).toBe(200);
  });

  it('keeps native completion available when the catalogue fails and does not load it for unrelated values', async () => {
    catalogueResult = Promise.reject(new Error('offline'));
    const failed = await completion('<nodel-icon name="');
    expect(failed).not.toBeNull();
    const calls = { index: indexResult, catalogue: catalogueResult };
    void calls;
    const unrelated = nodelHtmlCompletionSource(context('<nodel-button variant="'));
    expect(unrelated instanceof Promise).toBe(false);
  });

  it('diagnoses catalogue availability without rejecting aliases or placeholders', () => {
    const state = EditorState.create({ doc: '<nodel-icon name="power" /><nodel-icon name="{{item}}" /><nodel-icon name="power-button" /><nodel-icon name="missing" family="bad" style="wrong" /><nodel-icon name="address-book" family="classic" style="solid" />', extensions: [htmlLanguage] });
    ensureSyntaxTree(state, state.doc.length, 10_000);
    const diagnostics = diagnoseNodelIconCatalogue(state, catalogue, undefined, index);
    expect(diagnostics).toHaveLength(4);
    const messages = diagnostics.map(item => item.message);
    expect(messages.some(message => message.toLocaleLowerCase().includes('official'))).toBe(true);
    expect(messages.some(message => message.includes('Unknown Nodel icon'))).toBe(true);
    expect(messages.some(message => message.includes('Icon family'))).toBe(true);
    expect(messages.some(message => message.includes('Icon is unavailable'))).toBe(true);
  });

  it('treats overlapping indexed aliases as authored and canonicalizes official-only suggestions', async () => {
    const state = EditorState.create({ doc: '<nodel-icon name="warning" /><nodel-icon name="address-card-old" />', extensions: [htmlLanguage] });
    ensureSyntaxTree(state, state.doc.length, 10_000);
    const diagnostics = diagnoseNodelIconCatalogue(state, catalogue, undefined, index);
    const messages = diagnostics.map(item => item.message);
    expect(messages).toHaveLength(1);
    expect(messages.some(message => message.includes('use address-book'))).toBe(true);

    const officialCompletion = await completion('<nodel-icon family="classic" style="regular" name="address-card-old');
    expect(officialCompletion?.options.find(option => option.label === 'address-card-old')?.apply).toBe('address-book');
  });

  it('uses the runtime default family for omitted-family diagnostics', () => {
    const state = EditorState.create({ doc: '<nodel-icon name="github" /><nodel-icon name="github" style="brands" />', extensions: [htmlLanguage] });
    ensureSyntaxTree(state, state.doc.length, 10_000);
    const diagnostics = diagnoseNodelIconCatalogue(state, catalogue, undefined, index);
    expect(diagnostics.filter(item => item.message.includes('unavailable')).length).toBe(2);
  });

  it('applies runtime namespace precedence and diagnoses MDI aliases and unknown namespaces', () => {
    const source = '<nodel-icon name="mdi:power" family="bad" style="wrong" /><nodel-icon name="mdi:bulb" /><nodel-icon name="fa:power" /><nodel-icon name="mdi:missing" /><nodel-icon name="mdi:power" family="bad" signal="IconName" /><nodel-icon name="lightbulb" family="mdi" />';
    const state = EditorState.create({ doc: source, extensions: [htmlLanguage] });
    ensureSyntaxTree(state, state.doc.length, 10_000);
    const diagnostics = diagnoseNodelIconCatalogue(state, catalogue, undefined, index);
    expect(diagnostics.map(item => item.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('ignored for an mdi:'),
      expect.stringContaining('MDI alias is search-only; use mdi:lightbulb'),
      expect.stringContaining('Unknown icon namespace'),
      expect.stringContaining('Unknown or excluded MDI icon')
    ]));
    const familyErrors = diagnostics.filter(item => item.message.includes('Icon family is unavailable'));
    expect(familyErrors).toHaveLength(1);
    expect(source.slice(familyErrors[0]!.from, familyErrors[0]!.to)).toContain('family="mdi"');
    expect(diagnostics.filter(item => item.message.includes('ignored for an mdi:'))).toHaveLength(1);
    expect(diagnostics.some(item => item.message.includes('MDI alias is search-only; use mdi:power'))).toBe(false);
  });

  it('recognizes signal-bound dynamic name and family values without redundant-static warnings', () => {
    const source = '<nodel-icon name="mdi:power" family="classic" signals="SelectedIcon; IconFamily:family" /><nodel-icon name="mdi:power" family="classic" signals="SelectedIcon:name(last)" /><nodel-icon name="mdi:power" family="classic" signal="SelectedIcon:label" />';
    const state = EditorState.create({ doc: source, extensions: [htmlLanguage] });
    ensureSyntaxTree(state, state.doc.length, 10_000);
    const diagnostics = diagnoseNodelIconCatalogue(state, catalogue, undefined, index);
    expect(diagnostics.filter(item => item.message.includes('ignored for an mdi:'))).toHaveLength(1);
    const padded = '<nodel-icon name=" power " family=" classic " style=" solid " /><nodel-icon name="power" family="" style="" />';
    const paddedState = EditorState.create({ doc: padded, extensions: [htmlLanguage] });
    ensureSyntaxTree(paddedState, paddedState.doc.length, 10_000);
    const paddedDiagnostics = diagnoseNodelIconCatalogue(paddedState, catalogue, undefined, index);
    expect(paddedDiagnostics).toEqual([]);
  });

  it('force-lints once for a connected valid catalogue and ignores failure or disconnection', async () => {
    const force = vi.spyOn(lint, 'forceLinting');
    let resolveIndex!: (value: IconIndex) => void;
    let resolveCatalogue!: (value: IconCatalogue) => void;
    indexResult = new Promise(resolve => { resolveIndex = resolve; });
    catalogueResult = new Promise(resolve => { resolveCatalogue = resolve; });
    const host = document.createElement('div');
    document.body.append(host);
    const view = new EditorView({ parent: host, state: EditorState.create({ doc: '<nodel-icon name="tv" />', extensions: [htmlLanguage, nodelDocumentDiagnostics()] }) });
    resolveIndex(index);
    resolveCatalogue(catalogue);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(force).toHaveBeenCalledTimes(1);
    view.destroy();
    host.remove();
    force.mockClear();

    let rejectCatalogue!: (reason: unknown) => void;
    indexResult = Promise.resolve(index);
    catalogueResult = new Promise((_, reject) => { rejectCatalogue = reject; });
    const disconnectedHost = document.createElement('div');
    document.body.append(disconnectedHost);
    const disconnectedView = new EditorView({ parent: disconnectedHost, state: EditorState.create({ doc: '<nodel-icon name="tv" />', extensions: [htmlLanguage, nodelDocumentDiagnostics()] }) });
    disconnectedView.destroy();
    disconnectedHost.remove();
    rejectCatalogue(new Error('offline'));
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(force).not.toHaveBeenCalled();
    force.mockRestore();
  });
});
