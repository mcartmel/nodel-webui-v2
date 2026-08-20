import { ACTSIG_MATERIALIZE_CHUNK_SIZE, areActSigDefinitionSetsEqual, createActSigSections, createActSigViewModel, formsInSection, hasConcreteArgument, materializeActSigForm, normalizeActSigDefinitionSet } from '../src/features/actsig-model';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const definition = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra });

describe('actsig model', () => {
  it('pairs by response key and gives paired rows action-owned metadata', () => {
    const sections = createActSigSections({ response: definition('Do it', { group: 'Actions', title: 'Action', order: 3 }) }, { response: definition('State', { group: 'Signals', title: 'Signal', order: 1 }) });
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe('Actions');
    expect(sections[0]?.rows[0]?.action?.name).toBe('Do it');
    expect(sections[0]?.rows[0]?.event?.name).toBe('State');
  });

  it('keeps insertion order for sections and ties, with unsafe names distinct', () => {
    const sections = createActSigSections({ a: definition('\ud800', { order: 1 }), b: definition('\ufffd', { order: 1 }), c: definition('plain') }, {});
    const forms = sections.flatMap((section) => formsInSection(section));
    expect(forms.map((form) => form.name)).toEqual(['plain', '\ud800', '\ufffd']);
    expect(new Set(forms.map((form) => form.id)).size).toBe(3);
    expect(forms[1]?.requestEligible).toBe(false);
    expect(forms[2]?.requestEligible).toBe(true);
  });

  it('wraps null, scalar, object and union arguments and selects concrete initial presence', () => {
    const sections = createActSigSections({ n: definition('Null'), s: definition('Scalar', { schema: { type: 'string' } }), o: definition('Object', { schema: { type: 'object', properties: {} } }), u: definition('Union', { schema: { type: [{ type: 'null' }, { type: 'number' }] } }) }, {});
    const forms = sections.flatMap((section) => formsInSection(section));
    expect(forms.map((form) => form.schema.properties?.arg?.type)).toEqual(['null', 'string', 'object', [{ type: 'null' }, { type: 'number' }]]);
    expect(hasConcreteArgument(forms[0]!.schema)).toBe(false);
    expect(hasConcreteArgument(forms[3]!.schema)).toBe(true);
    expect(materializeActSigForm(forms[1]!, false)).not.toBeNull();
  });

  it('creates eight-form chunks without rematerializing forms and disables signal controls', () => {
    const actions = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`a${index}`, definition(`a${index}`)]));
    const sections = createActSigSections(actions, {});
    const forms = formsInSection(sections[0]!);
    expect(forms).toHaveLength(9);
    expect(ACTSIG_MATERIALIZE_CHUNK_SIZE).toBe(8);
    const first = materializeActSigForm(forms[0]!, false);
    expect(first).not.toBeNull();
    expect(materializeActSigForm(forms[0]!, false)).toBeNull();
    const signal = formsInSection(createActSigSections({}, { readOnly: definition('Read only', { schema: { type: 'string' } }) })[0]!)[0]!;
    const signalForm = materializeActSigForm(signal, false);
    expect(signalForm?.controlsDisabled).toBe(true);
  });

  it('creates a default view without DOM state', () => {
    expect(createActSigViewModel()).toEqual({ loading: true, error: '', overrideSignals: false, hasSignals: false, sections: [], empty: false });
  });

  it('normalizes effective defaults and ignores runtime and unknown definition fields', () => {
    const first = normalizeActSigDefinitionSet({
      actions: { response: { name: '', arg: 1, seq: 2, timestamp: 'now', metadata: 'ignored' } },
      signals: {}
    });
    const second = normalizeActSigDefinitionSet({
      actions: { response: { name: 'response', title: 'response', desc: '', group: '', caution: '', order: 0, schema: null, arg: 99, seq: 4, timestamp: 'later', other: true } },
      signals: {}
    });
    expect(first).toEqual(second);
    expect(first.actions[0]).toEqual({ key: 'response', name: 'response', title: 'response', description: '', group: '', caution: '', order: 0, schema: null });
    expect(areActSigDefinitionSetsEqual(first, second)).toBe(true);
  });

  it('treats response order and keys as structural', () => {
    const ordered = normalizeActSigDefinitionSet({ actions: { first: definition('same'), second: definition('same') }, signals: {} });
    const reversed = normalizeActSigDefinitionSet({ actions: { second: definition('same'), first: definition('same') }, signals: {} });
    const renamed = normalizeActSigDefinitionSet({ actions: { other: definition('same'), second: definition('same') }, signals: {} });
    expect(areActSigDefinitionSetsEqual(ordered, reversed)).toBe(false);
    expect(areActSigDefinitionSetsEqual(ordered, renamed)).toBe(false);
  });

  it('compares schemas deeply without depending on object key order', () => {
    const base = normalizeActSigDefinitionSet({ actions: { response: definition('response', { schema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } } }) }, signals: {} });
    const reordered = normalizeActSigDefinitionSet({ actions: { response: definition('response', { schema: { properties: { b: { type: 'number' }, a: { type: 'string' } }, type: 'object' } }) }, signals: {} });
    const changed = normalizeActSigDefinitionSet({ actions: { response: definition('response', { schema: { type: 'object', properties: { a: { type: 'boolean' }, b: { type: 'number' } } } }) }, signals: {} });
    expect(areActSigDefinitionSetsEqual(base, reordered)).toBe(true);
    expect(areActSigDefinitionSetsEqual(base, changed)).toBe(false);
  });

  it('keeps feature model and controller free of UI adapter and DOM dependencies', () => {
    for (const path of ['src/features/actsig-model.ts', 'src/features/actsig-controller.ts']) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8');
      expect(source).not.toMatch(/from ['"][^'"]*(?:schema-form|jquery)[^'"]*['"]/);
      expect(source).not.toMatch(/\bjsviews\b/i);
      expect(source).not.toMatch(/\b(?:document|window|HTMLElement|HTML\w+Element|Element)\b/);
    }
  });
});
