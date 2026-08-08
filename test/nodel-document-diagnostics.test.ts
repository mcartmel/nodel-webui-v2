import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { diagnoseNodelDocument, NODEL_DIAGNOSTIC_LIMITS } from '../src/editor/nodel-document-diagnostics';
import { languageExtensionForKind } from '../src/editor/codemirror-editor';

async function diagnose(text: string, kind: 'html' | 'xml' = 'html') {
  const state = EditorState.create({ doc: text, extensions: [await languageExtensionForKind(kind)] });
  ensureSyntaxTree(state, state.doc.length, 10_000);
  return diagnoseNodelDocument(state);
}

describe('Nodel document diagnostics', () => {
  it('validates closed enums but preserves enum-or-string values', async () => {
    expect((await diagnose('<nodel-button variant="not-real" />')).summary.errors).toBe(1);
    expect((await diagnose('<nodel-status state="custom-state" />')).summary.errors).toBe(0);
  });

  it('validates numbers, ranges, actions, and target-bearing signals', async () => {
    const result = await diagnose('<nodel-qrcode size="not-a-number" /><nodel-button actions="Do:bogus" signal="State:unknown" />');
    expect(result.summary.errors).toBe(3);
    expect((await diagnose('<nodel-column span="20" />')).summary.warnings).toBe(1);
    expect((await diagnose('<nodel-qrcode size="64.5px" />')).summary.warnings).toBe(1);
  });

  it('allows omitted phases and default targets, arbitrary names, and escaped dots', async () => {
    const result = await diagnose('<nodel-button action="Some:Action:click" signal="Point\\.Name.value" /><nodel-text signals="Any.Name:value" />');
    expect(result.summary.errors).toBe(0);
  });

  it('uses runtime last-colon action parsing and ignores non-phase aliases', async () => {
    expect((await diagnose('<nodel-button action="Some:Action:click" />')).summary.errors).toBe(0);
    expect((await diagnose('<nodel-button action="Some:Action:wrong" />')).summary.errors).toBe(1);
    expect((await diagnose('<nodel-button join="Some:Action:wrong" action-on="Some:Action:wrong" action-off="Some:Action:wrong" />')).summary.errors).toBe(0);
  });

  it('uses distinct visibility and options-signal grammars', async () => {
    expect((await diagnose('<nodel-select visibility="Local.Signal" options-signal="Options.path" />')).summary.errors).toBe(0);
    expect((await diagnose('<nodel-select visibility="Local:active" options-signal="Options:value" />')).summary.errors).toBe(2);
    expect((await diagnose('<nodel-description signals="Free\\.Name.value\\.with\\.dots:visibility" />')).summary.errors).toBe(0);
    expect((await diagnose('<nodel-description signals="Free..Name:visibility" />')).summary.errors).toBe(1);
    expect((await diagnose('<nodel-button join="Free.Name:unknown(any)" signal="Free.Name:active(last)" />')).summary.errors).toBe(0);
    expect((await diagnose('<nodel-meter signal="Free.Name:value(any)" />')).summary.errors).toBe(1);
  });

  it('checks links, required placement, and direct required children', async () => {
    expect((await diagnose('<nodel-link href="" node="A" event-binding="B" />')).summary.errors).toBe(1);
    expect((await diagnose('<nodel-link href="" />')).summary.errors).toBe(1);
    expect((await diagnose('<nodel-control-space />')).summary.errors).toBe(1);
    expect((await diagnose('<nodel-segmented />')).summary.errors).toBe(0);
  });

  it('reports authoring warnings without rejecting globals or ordinary HTML', async () => {
    const result = await diagnose('<nodel-button data-test="x" aria-label="x" onpointerdown="x" xmlns:svg="x" class="nodel-button" unknown="x" /><nodel-console collapse-preview="last-line" /><div weird="free-form" />');
    expect(result.summary.errors).toBe(0);
    expect(result.summary.warnings).toBe(2);
    expect((await diagnose('<nodel-button onlywrong="x" />')).summary.warnings).toBe(1);
    expect((await diagnose('<nodel-toast-host />')).summary.warnings).toBe(1);
    expect((await diagnose('<nodel-button action="{{item}}" variant="{{value}}" />')).summary.errors).toBe(0);
  });

  it('supports XML and deterministic bounds without raw document content in messages', async () => {
    expect((await diagnose('<nodel-button variant="bad"/>', 'xml')).summary.errors).toBe(1);
    const result = await diagnose('x'.repeat(NODEL_DIAGNOSTIC_LIMITS.maxDocumentLength + 1));
    expect(result.summary.truncated).toBe(true);
    expect(result.diagnostics.every((diagnostic) => diagnostic.message.length <= NODEL_DIAGNOSTIC_LIMITS.maxMessageLength)).toBe(true);
    expect(result.diagnostics.every((diagnostic) => diagnostic.source === 'Nodel')).toBe(true);
  });

  it('stops at the node bound instead of traversing later invalid content', async () => {
    const nestedElements = NODEL_DIAGNOSTIC_LIMITS.maxNodes + 100;
    const prefix = `${'<i>'.repeat(nestedElements)}x${'</i>'.repeat(nestedElements)}`;
    expect(prefix.length).toBeLessThan(NODEL_DIAGNOSTIC_LIMITS.maxDocumentLength);
    const text = `${prefix}<nodel-button variant="not-real" />`;
    const state = EditorState.create({ doc: text, extensions: [await languageExtensionForKind('html')] });
    const tree = ensureSyntaxTree(state, state.doc.length, 10_000);
    expect(tree).not.toBeNull();
    if (!tree) throw new Error('Expected the complete diagnostic syntax tree');
    let nodeCount = 0;
    tree.iterate({ enter() { nodeCount += 1; } });
    expect(nodeCount).toBeGreaterThan(NODEL_DIAGNOSTIC_LIMITS.maxNodes);
    const result = diagnoseNodelDocument(state, tree);
    expect(result.summary.truncated).toBe(true);
    expect(result.summary.errors).toBe(0);
  });

  it('caps diagnostics emitted by a single element', async () => {
    const attributes = Array.from({ length: NODEL_DIAGNOSTIC_LIMITS.maxDiagnostics + 20 }, (_, index) => `unknown-${index}="x"`).join(' ');
    const result = await diagnose(`<nodel-button ${attributes} />`);
    expect(result.diagnostics).toHaveLength(NODEL_DIAGNOSTIC_LIMITS.maxDiagnostics);
    expect(result.summary.truncated).toBe(true);
  });
});
