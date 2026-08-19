// @vitest-environment jsdom

import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { htmlLanguage } from '@codemirror/lang-html';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import * as lint from '@codemirror/lint';
import { vi } from 'vitest';
import type { IconCatalogue, IconIndex } from '../src/icons/catalogue-loader';

const index: IconIndex = {
  profile: 'free', default: { family: 'classic', style: 'solid' }, aliases: { power: 'power-off', warning: 'warning-octagon' },
  families: [
    { family: 'classic', defaultStyle: 'solid', styles: [
      { style: 'solid', sharding: { bucketCount: 1 }, shards: ['v2/icons/a.json'] },
      { style: 'regular', sharding: { bucketCount: 1 }, shards: ['v2/icons/b.json'] }
    ] },
    { family: 'brands', defaultStyle: 'brands', styles: [{ style: 'brands', sharding: { bucketCount: 1 }, shards: ['v2/icons/c.json'] }] }
  ],
  cataloguePath: 'v2/icons/catalogue-a.json'
};
const catalogue: IconCatalogue = {
  schemaVersion: 1, profile: 'free', records: [
    { name: 'power-off', label: 'Power Off', family: 'classic', style: 'solid', terms: ['power'], aliases: ['power'], officialAliases: ['power-button'] },
    { name: 'warning-octagon', label: 'Warning Octagon', family: 'classic', style: 'solid', terms: ['warning'], aliases: [], officialAliases: ['warning'] },
    { name: 'tv', label: 'TV', family: 'classic', style: 'solid', terms: ['television'], aliases: [], officialAliases: [] },
    { name: '0', label: '0', family: 'classic', style: 'solid', terms: ['nada'], aliases: [], officialAliases: [] },
    { name: 'address-book', label: 'Address Book', family: 'classic', style: 'regular', terms: ['contacts'], aliases: [], officialAliases: ['address-card-old'] },
    { name: 'github', label: 'GitHub', family: 'brands', style: 'brands', terms: ['repository'], aliases: [], officialAliases: [] }
  ]
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
import { diagnoseNodelIconCatalogue, nodelDocumentDiagnostics } from '../src/editor/nodel-document-diagnostics';

function context(text: string) {
  const state = EditorState.create({ doc: text, extensions: [htmlLanguage] });
  return new CompletionContext(state, text.length, true);
}

async function completion(text: string): Promise<CompletionResult | null> {
  const result = nodelHtmlCompletionSource(context(text)) as CompletionResult | Promise<CompletionResult | null> | null;
  return result instanceof Promise ? await result : result;
}

describe('profile-aware icon editor support', () => {
  beforeEach(() => {
    indexResult = Promise.resolve(index);
    catalogueResult = Promise.resolve(catalogue);
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
    const style = await completion('<nodel-icon name="address-book" family="classic" style="');
    expect(style?.options.map(option => option.label)).toEqual(['regular']);
    const ordinary = await completion('<nodel-icon name="');
    expect(new Set(ordinary?.options.map(option => option.label)).size).toBe(ordinary?.options.length);
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
