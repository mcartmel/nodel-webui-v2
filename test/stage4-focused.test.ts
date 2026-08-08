import fc from 'fast-check';
import {
  canonicalRemoteNodeHref,
  encodeUrlPathSegment,
  reversibleUrlPathSegment,
  safeNavigationHref
} from '../src/utils/urls';
import {
  isPortableNodeFilePath,
  nodeFileAliasKey,
  nodeFilePathCompatibility,
  registerDecodedNodeFileEntry,
  isDecodedNodeFileReadCapability,
  copyNodeFileReadCapability,
  assertPortableNodeFilePath,
  registerDecodedNodeRecipeEntry,
  isDecodedNodeRecipeCapability,
  isLegacyNodeFileEntry
} from '../src/utils/node-file-path';
import {
  buildActionPayload,
  ControlActionController,
  executeActionPhases,
  formatActionFailures,
  actionName,
  emptyActionExecution,
  actionErrorMessage,
  dispatchControlActionError
} from '../src/data/control-actions';
import { parseTypedArgStrict } from '../src/utils/control-values';
import { parseSignalBindings } from '../src/data/signal-bindings';
import { createSchemaForm, normalizeSchema, buildArrayEntry, buildMapEntry, enumRawKey } from '../src/schema/schema-model';
import { hydrateSchemaFormModel, serializeSchemaFormModel } from '../src/schema/schema-values';
import { validateField, validateSchemaForm, validateValueAgainstSchema } from '../src/schema/schema-validation';
import { createActivityAccumulator } from '../src/data/activity-accumulator';
import { validateJsonValueBounds, assertJsonValueBounds } from '../src/utils/json-value';
import { runWithDeadline } from '../src/api/request';
import { actionBindingsForPhase, actionExecutionCancelled, actionCancellationError, callActionBindings, hasActionPhase, isActionCancellation, parseActionBindings } from '../src/data/action-bindings';
import { installControlRuntime } from '../src/data/control-runtime';
import { normalizeEntries, nextSeqFrom } from '../src/data/node-activity-source';
import type { NodelActivityLogEntry } from '../src/api/nodel-types';
import { ensureSyntaxTree } from '@codemirror/language';
import { CompletionContext } from '@codemirror/autocomplete';
import { htmlLanguage } from '@codemirror/lang-html';
import { EditorState } from '@codemirror/state';
import { completeNodelDocument } from '../src/editor/nodel-document-definition';
import { diagnoseNodelDocument, NODEL_DIAGNOSTIC_LIMITS } from '../src/editor/nodel-document-diagnostics';

const propertyOptions = { numRuns: 40, seed: 170808, endOnFailure: true } as const;
const pathSegment = fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')), { minLength: 1, maxLength: 8 })
  .map((characters) => characters.join('a'));

describe('Stage 4 pure boundary properties', () => {
  it('keeps URL path encoding bounded and non-traversing', () => {
    fc.assert(fc.property(fc.string({ maxLength: 48 }), (value) => {
      const encoded = encodeUrlPathSegment(value);
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('\\');
      expect(encoded.length).toBeLessThanOrEqual(3 * (value.length + 1));
      if (value !== '' && value !== '.' && value !== '..' && !/[\ud800-\udfff]/.test(value)) {
        const reversible = reversibleUrlPathSegment(value);
        if (reversible) expect(decodeURIComponent(reversible)).toBe(value);
      }
    }), propertyOptions);
  });

  it('accepts only portable generated node-file paths and preserves alias identity', () => {
    fc.assert(fc.property(fc.array(pathSegment, { minLength: 1, maxLength: 4 }), (segments) => {
      const path = segments.join('/');
      expect(isPortableNodeFilePath(path)).toBe(true);
      expect(nodeFilePathCompatibility(path)).toBe('portable');
      expect(nodeFileAliasKey(path)).toBe(path.toLowerCase());
      expect(nodeFilePathCompatibility(`../${path}`)).toBeNull();
    }), propertyOptions);

    const decoded = registerDecodedNodeFileEntry({ path: 'content/script.py', compatibility: 'portable' });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(isDecodedNodeFileReadCapability(decoded)).toBe(true);
    const copy = copyNodeFileReadCapability(decoded, { path: decoded.path, compatibility: decoded.compatibility });
    expect(isDecodedNodeFileReadCapability(copy)).toBe(true);
    expect(() => copyNodeFileReadCapability(decoded, { path: 'content/other.py', compatibility: 'portable' })).toThrow();
    expect(assertPortableNodeFilePath('content/script.py')).toBe('content/script.py');
    const recipe = registerDecodedNodeRecipeEntry({ path: '', compatibility: 'portable' });
    expect(isDecodedNodeRecipeCapability(recipe)).toBe(true);
    expect(isLegacyNodeFileEntry({ path: 'content\\legacy.txt', compatibility: 'legacy' })).toBe(true);
  });

  it('bounds malformed node-file paths and never leaks rejected input', () => {
    const malformedPath = fc.oneof(
      fc.string({ maxLength: 96 }),
      fc.constantFrom('../secret', '/absolute', 'a\\b', 'a//b', '.', '..', 'a/./b', 'a/../b', 'a\u0000b', 'a\u0001b', 'a\u007fb', 'a\u2044b', 'a\uff0fb', '\ud800', '\udfff')
    );
    fc.assert(fc.property(malformedPath, (path) => {
      const portable = isPortableNodeFilePath(path);
      if (portable) {
        expect(path).toBe(path.trim().normalize('NFC'));
        expect([...path].every((character) => {
          const code = character.codePointAt(0) ?? 0;
          return character !== '\\' && character !== ':' && (code < 0 || code > 0x1f) && (code < 0x7f || code > 0x9f);
        })).toBe(true);
        expect(path).not.toMatch(/(?:^|[\\/])\.\.?(?=$|[\\/])/);
        expect(new TextEncoder().encode(path).byteLength).toBeLessThanOrEqual(1024);
      } else {
        expect(() => assertPortableNodeFilePath(path)).toThrow('Node file path is invalid or not portable');
      }
    }), propertyOptions);
    expect(() => assertPortableNodeFilePath('../secret')).toThrow('Node file path is invalid or not portable');
    expect(() => assertPortableNodeFilePath('a\u0000b')).toThrow('Node file path is invalid or not portable');
  });

  it('parses signal expressions deterministically and removes duplicates', () => {
    fc.assert(fc.property(pathSegment, pathSegment, (signal, property) => {
      const bindings = parseSignalBindings(`${signal}.${property}:value(any),${signal}.${property}:value(any)`);
      expect(bindings).toEqual([{ signal, path: [property], target: 'value', mode: 'any' }]);
    }), propertyOptions);
    expect(parseSignalBindings('.bad:value,Signal.:value,:value')).toEqual([]);
    expect(parseSignalBindings('Signal.value: value(ALL)')[0]?.mode).toBe('all');
  });

  it('property-tests action expressions and escaped signal paths', () => {
    const name = fc.string({ maxLength: 24 }).filter((value) => value.trim() !== '' && !/[;,\r\n]/.test(value));
    const phase = fc.string({ maxLength: 12 }).filter((value) => value.trim() !== '' && !/[;,\r\n:]/.test(value));
    fc.assert(fc.property(name, phase, fc.string({ maxLength: 12 }).filter((value) => !/[;,\r\n]/.test(value)), (action, expectedPhase, suffix) => {
      const parsed = parseActionBindings({ action: `${action}:${suffix}:${expectedPhase}`, defaultPhase: 'default' });
      expect(parsed).toEqual([{ action: `${action}:${suffix}`, phase: expectedPhase }]);
      expect(parseActionBindings({ action: `${action}:${expectedPhase}:`, defaultPhase: 'default' })[0]?.phase).toBe('default');
    }), propertyOptions);

    const segment = fc.string({ maxLength: 10 }).filter((value) => value.length > 0 && !/[.\\;,():\r\n]/.test(value));
    fc.assert(fc.property(segment, segment, (signal, property) => {
      const escaped = `${signal}\\.${property}.${property}`;
      const parsed = parseSignalBindings(`${escaped}:target`);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({ signal: `${signal}.${property}`, path: [property], target: 'target' });
    }), propertyOptions);

    for (const malformed of ['', ':click', 'Action:', 'Action\u0000:click', 'Action;\u0001', 'Action\r\n:click']) {
      expect(() => parseActionBindings({ action: malformed, defaultPhase: 'default' })).not.toThrow();
    }
  });

  it('keeps typed action arguments strict and bounded', () => {
    fc.assert(fc.property(fc.integer({ min: -100000, max: 100000 }), (value) => {
      const text = String(value);
      expect(parseTypedArgStrict(text, 'number')).toEqual({ ok: true, value });
      expect(buildActionPayload(text, 'number')).toMatchObject({ ok: true, arg: value });
    }), propertyOptions);
    expect(buildActionPayload(null, 'json')).toEqual({ ok: true, payload: {} });
    expect(buildActionPayload('{broken', 'json')).toMatchObject({ ok: false });
    expect(parseTypedArgStrict('Infinity', 'number')).toMatchObject({ ok: false });
    expect(parseTypedArgStrict('anything', 'boolean')).toEqual({ ok: true, value: false });
  });

  it('round-trips bounded scalar schema values and reports malformed values', () => {
    fc.assert(fc.property(fc.oneof(fc.string({ maxLength: 12 }), fc.boolean(), fc.integer({ min: -20, max: 20 })), (value) => {
      const type = typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'boolean' : 'integer';
      const form = createSchemaForm({ type, required: true } as never);
      hydrateSchemaFormModel(form, value);
      expect(serializeSchemaFormModel(form)).toEqual(value);
      expect(validateValueAgainstSchema(value, { type } as never)).toEqual([]);
    }), propertyOptions);
    expect(validateValueAgainstSchema('not-a-number', { type: 'number' })).toHaveLength(1);
    expect(validateValueAgainstSchema({ value: 'x' }, { type: 'object', properties: { value: { type: 'string', required: true } } })).toEqual([]);
    const jsonForm = createSchemaForm({ title: 'Unconstrained value' } as never);
    hydrateSchemaFormModel(jsonForm, { value: true });
    jsonForm.fields[0]!.value = '{broken';
    expect(serializeSchemaFormModel(jsonForm)).toBeUndefined();
    expect(normalizeSchema(null).type).toBe('null');
    expect(normalizeSchema({ nope: true } as never).unsupportedReason).toContain('nope');
    for (const schema of [
      { type: 'integer', enum: [1.5] },
      { type: 'string', min: 1 },
      { type: 'array', minItems: 2, maxItems: 1 },
      { type: 'string', step: 0 },
      { type: 'string', required: 'yes' },
      { type: 'object', properties: { nested: { type: 'string' } }, items: { type: 'string' } }
    ]) {
      expect(normalizeSchema(schema as never).unsupportedReason).not.toBe('');
    }
    for (const schema of [
      { type: 'array', minItems: -1 },
      { type: 'array', maxItems: 1.5 },
      { type: 'string', order: Number.NaN },
      { type: 'string', title: 1 },
      { type: 'number', step: 'bad' },
      { type: 'number', step: {} },
      { type: 'string', advanced: 'yes' }
    ]) {
      expect(normalizeSchema(schema as never).unsupportedReason).not.toBe('');
    }
    expect(createSchemaForm({ type: 'object', properties: { broken: { nope: true } } } as never).unsupported).toBe(true);
    expect(createSchemaForm({ type: 'object', properties: { broken: { type: 'string', enum: [{}] } } } as never).unsupported).toBe(true);
    expect(normalizeSchema({ type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 1 } as never).unsupportedReason).toContain('minItems');
    for (const schema of [
      { type: [{ type: 'string' }, { type: 'null' }] },
      { properties: { inferred: { type: 'boolean' } } },
      { items: { type: 'number' } },
      { type: null },
      { type: 'integer', min: -2, max: 2, step: 1, order: 1 },
      { type: 'string', format: 'password', group: 'advanced', caution: 'careful' }
    ]) {
      expect(createSchemaForm(schema as never).unsupported).toBe(false);
    }
    const objectForm = createSchemaForm({ type: 'object', properties: { map: { type: 'object', items: { type: 'number' } } } } as never);
    const objectField = objectForm.fields[0]!;
    expect(buildMapEntry(objectField, 'extra').key).toBe('extra');
    const arrayForm = createSchemaForm({ type: 'array', items: { type: 'string' } } as never);
    expect(buildArrayEntry(arrayForm.fields[0]!, undefined, 0).valueField?.present).toBe(true);
    const objectArrayForm = createSchemaForm({ type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } } as never);
    const objectArrayField = objectArrayForm.fields[0]!;
    expect(buildArrayEntry(objectArrayField, { unknown: true }, 0).unknownProperties).toEqual({ unknown: true });
    expect(buildArrayEntry(objectArrayField, null, 1).nullValue).toBe(true);
    for (const schema of [
      { type: 'boolean' },
      { type: 'number', format: 'range', min: 0, max: 10, step: 'any' },
      { type: 'string', format: 'date', title: 'Date', hint: 'Pick one' },
      { type: 'string', enum: ['a', null, true] },
      { type: 'object', properties: { 'a/b~c': { type: 'string', order: 1 } } },
      { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 3 }
    ]) {
      const built = createSchemaForm(schema as never);
      expect(built.unsupported).toBe(false);
      expect(built.fields.length).toBeGreaterThan(0);
    }
    expect(enumRawKey({ value: 1 })).toContain('json:');
    expect(validateSchemaForm(createSchemaForm({ nope: true } as never))).toHaveLength(1);
    const validationCases: Array<[unknown, unknown]> = [
      [null, { type: 'string' }],
      ['x', { type: 'null' }],
      [false, { type: 'string' }],
      ['x', { type: 'boolean' }],
      [1.5, { type: 'integer' }],
      [2, { type: 'number', min: 3, max: 4, step: 2 }],
      ['retired', { type: 'string', enum: ['ready'] }],
      [{}, { type: 'array' }],
      [[], { type: 'array', minItems: 1, items: { type: 'string' } }],
      [['x'], { type: 'array', maxItems: 0, items: { type: 'number' } }],
      [{}, { type: 'object', properties: { required: { type: 'string', required: true } } }],
      [{ extra: 1 }, { type: 'object', items: { type: 'string' } }]
    ];
    for (const [value, schema] of validationCases) {
      expect(validateValueAgainstSchema(value, schema as never).length).toBeGreaterThan(0);
    }
    expect(validateValueAgainstSchema({ required: 'ok', extra: 'mapped' }, {
      type: 'object',
      properties: { required: { type: 'string', required: true } }
    } as never)).toEqual([]);
    expect(validateValueAgainstSchema({ extra: 'mapped' }, { type: 'object', items: { type: 'string' } } as never)).toEqual([]);
    expect(validateValueAgainstSchema([1, 3], { type: 'array', items: { type: 'integer', min: 0, step: 1 } } as never)).toEqual([]);
    expect(validateValueAgainstSchema(null, { type: [{ type: 'string' }, { type: 'null' }] } as never)).toEqual([]);
    expect(validateValueAgainstSchema('ready', { type: 'string', enum: ['ready'] } as never)).toEqual([]);
    const nestedForm = createSchemaForm({ type: 'object', properties: { required: { type: 'string', required: true }, flag: { type: 'boolean' } } } as never);
    hydrateSchemaFormModel(nestedForm, { required: 'ok', flag: false });
    expect(validateSchemaForm(nestedForm)).toEqual([]);
    const boundedArray = createSchemaForm({ type: 'array', minItems: 2, items: { type: 'object', properties: { name: { type: 'string', required: true } } } } as never);
    hydrateSchemaFormModel(boundedArray, [{}]);
    expect(serializeSchemaFormModel(boundedArray)).toBeUndefined();
    const enumNumber = createSchemaForm({ type: 'number', enum: [1, 2], min: 1, max: 2, step: 1 } as never);
    hydrateSchemaFormModel(enumNumber, 2);
    expect(validateSchemaForm(enumNumber)).toEqual([]);
    const invalidEnumNumber = createSchemaForm({ type: 'number', enum: [1, 2], min: 2 } as never);
    hydrateSchemaFormModel(invalidEnumNumber, 1);
    expect(validateSchemaForm(invalidEnumNumber).length).toBeGreaterThan(0);
    const validArrayForm = createSchemaForm({ type: 'array', items: { type: 'string' } } as never);
    hydrateSchemaFormModel(validArrayForm, ['ok']);
    expect(validateSchemaForm(validArrayForm)).toEqual([]);
    const wrongNull = createSchemaForm({ type: 'null' } as never);
    hydrateSchemaFormModel(wrongNull, 'value');
    expect(validateSchemaForm(wrongNull).length).toBeGreaterThan(0);
    const wrongString = createSchemaForm({ type: 'string' } as never);
    hydrateSchemaFormModel(wrongString, 1);
    expect(validateSchemaForm(wrongString).length).toBeGreaterThan(0);
    const wrongBoolean = createSchemaForm({ type: 'boolean' } as never);
    hydrateSchemaFormModel(wrongBoolean, 'true');
    expect(validateSchemaForm(wrongBoolean).length).toBeGreaterThan(0);
    const badNumber = createSchemaForm({ type: 'number', min: 1, max: 3, step: 2 } as never);
    hydrateSchemaFormModel(badNumber, 2);
    expect(validateSchemaForm(badNumber).length).toBeGreaterThan(0);
    const missingJson = createSchemaForm({ title: 'JSON' } as never);
    hydrateSchemaFormModel(missingJson, { value: true });
    missingJson.fields[0]!.value = 'true';
    expect(validateSchemaForm(missingJson)).toEqual([]);
    missingJson.fields[0]!.value = 'not-json';
    expect(validateSchemaForm(missingJson).length).toBeGreaterThan(0);
    const arrayMismatch = createSchemaForm({ type: 'array', items: { type: 'string' } } as never);
    hydrateSchemaFormModel(arrayMismatch, [1]);
    expect(validateSchemaForm(arrayMismatch).length).toBeGreaterThan(0);
    const requiredForm = createSchemaForm({ type: 'object', properties: { required: { type: 'string', required: true } } } as never);
    hydrateSchemaFormModel(requiredForm, {});
    expect(validateSchemaForm(requiredForm).length).toBeGreaterThan(0);
    const wrongObject = createSchemaForm({ type: 'object', properties: { value: { type: 'string' } } } as never);
    hydrateSchemaFormModel(wrongObject, 'wrong');
    expect(validateSchemaForm(wrongObject).length).toBeGreaterThan(0);
    const nullableEnum = createSchemaForm({ type: [{ type: 'string', enum: ['ready'] }, { type: 'null' }] } as never);
    hydrateSchemaFormModel(nullableEnum, null);
    expect(validateSchemaForm(nullableEnum)).toEqual([]);
    const nullEnum = createSchemaForm({ type: 'string', enum: [null, 'ready'] } as never);
    hydrateSchemaFormModel(nullEnum, null);
    expect(validateSchemaForm(nullEnum)).toEqual([]);
    const jsonObject = createSchemaForm({ title: 'json' } as never);
    hydrateSchemaFormModel(jsonObject, { ok: true });
    jsonObject.fields[0]!.value = { bad: true };
    expect(validateSchemaForm(jsonObject).length).toBeGreaterThan(0);
    const boundedArrayTooMany = createSchemaForm({ type: 'array', maxItems: 1, items: { type: 'string' } } as never);
    hydrateSchemaFormModel(boundedArrayTooMany, ['a', 'b']);
    expect(validateSchemaForm(boundedArrayTooMany).length).toBeGreaterThan(0);
    const optionalMissing = createSchemaForm({ type: 'string' } as never);
    hydrateSchemaFormModel(optionalMissing, undefined);
    expect(validateSchemaForm(optionalMissing)).toEqual([]);
    const manualNull = createSchemaForm({ type: 'null' } as never);
    const nullField = manualNull.fields[0]!;
    nullField.present = true;
    nullField.typeMismatch = false;
    nullField.value = 'not-null';
    expect(validateSchemaForm(manualNull).length).toBeGreaterThan(0);
    const nullableValue = createSchemaForm({ type: [{ type: 'string' }, { type: 'null' }] } as never);
    hydrateSchemaFormModel(nullableValue, null);
    expect(validateSchemaForm(nullableValue)).toEqual([]);
    const invalidJsonBounds = createSchemaForm({ title: 'json' } as never);
    hydrateSchemaFormModel(invalidJsonBounds, {});
    invalidJsonBounds.fields[0]!.value = '{bad';
    expect(validateSchemaForm(invalidJsonBounds).length).toBeGreaterThan(0);
    const missingArrayItem = createSchemaForm({ type: 'array', items: { type: 'string' } } as never);
    hydrateSchemaFormModel(missingArrayItem, ['x']);
    missingArrayItem.fields[0]!.entries[0]!.valueField!.present = false;
    expect(validateSchemaForm(missingArrayItem).length).toBeGreaterThan(0);
    const directNumber = createSchemaForm({ type: 'integer' } as never).fields[0]!;
    directNumber.present = true;
    directNumber.value = '1.5';
    expect(validateField(directNumber).length).toBeGreaterThan(0);
    const directNull = createSchemaForm({ type: 'string' } as never).fields[0]!;
    directNull.present = true;
    directNull.value = null;
    expect(validateField(directNull).length).toBeGreaterThan(0);
    const staleEnum = createSchemaForm({ type: 'string', enum: ['ready'] } as never).fields[0]!;
    staleEnum.present = true;
    staleEnum.value = 'stale';
    expect(validateField(staleEnum).length).toBeGreaterThan(0);
    const nullEnumField = createSchemaForm({ type: 'string', enum: ['ready'] } as never).fields[0]!;
    nullEnumField.present = true;
    nullEnumField.value = null;
    expect(validateField(nullEnumField).length).toBeGreaterThan(0);
  });

  it('covers action parsing, cancellation, runtime calls, and control generations', async () => {
    const bindings = parseActionBindings({ action: ' Run:click ', actions: 'Run:click; Stop', join: 'Fallback', defaultPhase: 'default', aliases: [{ action: ' Alias ', phase: 'release' }, { action: null, phase: 'ignored' }] });
    expect(bindings).toEqual([
      { action: 'Run', phase: 'click' },
      { action: 'Stop', phase: 'default' },
      { action: 'Alias', phase: 'release' }
    ]);
    expect(parseActionBindings({ action: null, actions: null, join: 'Fallback', defaultPhase: 'default' })).toEqual([{ action: 'Fallback', phase: 'default' }]);
    expect(actionBindingsForPhase(bindings, 'click')).toHaveLength(1);
    expect(hasActionPhase(bindings, 'missing')).toBe(false);
    expect(actionExecutionCancelled({ isCurrent: () => false })).toBe(true);
    const cancelled = actionCancellationError();
    expect(isActionCancellation(cancelled)).toBe(true);
    expect(emptyActionExecution()).toEqual({ results: [], failures: [] });
    expect(formatActionFailures([], 'fallback')).toBe('fallback');
    expect(formatActionFailures([{ action: 'Run' }])).toContain('Failed');
    expect(actionName(bindings)).toBe('Run');
    expect(actionName([], 'fallback')).toBe('fallback');
    expect(actionErrorMessage(new Error('bad'))).toBe('bad');
    expect(formatActionFailures([{ action: 'A', error: 'a' }, { action: 'B' }])).toBe('A: a; B: Failed to call action');
    const errorEvents: Event[] = [];
    const actionHost = document.createElement('div');
    actionHost.addEventListener('action-error', (event) => errorEvents.push(event));
    actionHost.addEventListener('nodel-toast', (event) => errorEvents.push(event));
    dispatchControlActionError(actionHost, { eventName: 'action-error', payload: { arg: 1 }, failures: [{ action: 'A', phase: 'click', ok: false, error: 'bad' }] });
    expect(errorEvents).toHaveLength(2);

    const calls: unknown[] = [];
    const restore = installControlRuntime({
      callAction: async (name, payload) => { calls.push([name, payload]); return {}; },
      subscribeSignals: () => ({ dispose: () => undefined })
    });
    try {
      await expect(callActionBindings(bindings, 'click', { value: 1 })).resolves.toMatchObject({ results: [{ ok: true }] });
      await expect(executeActionPhases(bindings, ['click'], { value: 2 })).resolves.toMatchObject({ results: [{ ok: true }] });
      expect(calls).toHaveLength(2);
    } finally {
      restore();
    }

    const controller = new ControlActionController();
    const scope = controller.connect();
    const token = controller.nextToken(scope);
    expect(controller.isLatest(token, scope)).toBe(true);
    expect(controller.nextToken(null)).toBe(-1);
    expect(controller.startSingleFlight(scope)).toBe(true);
    expect(controller.startSingleFlight(scope)).toBe(false);
    controller.finishSingleFlight(scope);
    controller.invalidate();
    expect(controller.isLatest(token, scope)).toBe(false);
    controller.disconnect();
    expect(controller.captureScope()).toBeNull();
    await expect(controller.runSerial(null, async () => undefined)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('accumulates by key with bounded eviction and deterministic flushes', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 20 }), (keys) => {
      const batches: string[][] = [];
      const accumulator = createActivityAccumulator((items) => batches.push(items.map((item) => item.key)), { maxItems: 3 });
      for (const key of keys) accumulator.enqueue({ key: String(key), value: key, changed: true, live: true });
      expect(accumulator.size()).toBeLessThanOrEqual(3);
      accumulator.flush();
      expect(accumulator.size()).toBe(0);
      expect(batches.length).toBeLessThanOrEqual(1);
      accumulator.clear();
      expect(accumulator.size()).toBe(0);
    }), propertyOptions);
  });

  it('keeps activity pagination monotonic, deduplicated, ordered, and capped', () => {
    const entry = (seq: number, alias: number): NodelActivityLogEntry => ({
      seq, source: 'local', type: 'event', alias: `alias-${alias}`, timestamp: new Date(seq * 1000).toISOString(), value: seq
    } as NodelActivityLogEntry);
    fc.assert(fc.property(
      fc.array(fc.record({ seq: fc.integer({ min: 0, max: 80 }), alias: fc.integer({ min: 0, max: 8 }) }), { maxLength: 36 }),
      fc.integer({ min: -1, max: 80 }),
      (records, fallback) => {
        const normalized = normalizeEntries(records.map(({ seq, alias }) => entry(seq, alias)));
        expect(normalized.length).toBeLessThanOrEqual(records.length);
        expect(normalized.map((item) => item.seq)).toEqual([...normalized].sort((a, b) => a.seq - b.seq).map((item) => item.seq));
        expect(new Set(normalized.map((item) => `${item.source}_${item.type}_${item.alias}`)).size).toBe(normalized.length);
        const next = nextSeqFrom(normalized, fallback);
        expect(next).toBeGreaterThanOrEqual(fallback);
        if (normalized.length > 0) expect(next).toBe(Math.max(fallback, Math.max(...normalized.map((item) => item.seq)) + 1));
        expect(normalized.every((item) => item.seq < next)).toBe(true);
      }), propertyOptions);
    const repeated = normalizeEntries([entry(3, 1), entry(1, 1), entry(5, 1), entry(2, 2)]);
    expect(repeated.map((item) => item.seq)).toEqual([2, 5]);
    expect(nextSeqFrom([], null)).toBe(0);
  });

  it('bounds malformed URL diagnostics and rejects unsafe navigation', () => {
    fc.assert(fc.property(fc.string({ maxLength: 2000 }), (text) => {
      const href = safeNavigationHref(text, 'https://nodel.test/');
      if (href) expect(href.length).toBeLessThanOrEqual(text.trim().length || 1);
      const remote = canonicalRemoteNodeHref(text);
      if (remote) expect(remote).toMatch(/^https?:\/\//);
    }), propertyOptions);
    expect(safeNavigationHref('javascript:alert(1)')).toBeNull();
    expect(safeNavigationHref('https://user:pass@nodel.test/')).toBeNull();
  });

  it('bounds diagnostics and completions for malformed bounded documents', () => {
    const fragment = fc.oneof(
      fc.string({ maxLength: 240 }),
      fc.constantFrom('<nodel-button', '<nodel-button a="', '<nodel-button unknown="\u0000">', '<nodel-page><', '</nodel-page>', '<nodel-button action="A:bad" />', '<div title="\ud800">')
    );
    fc.assert(fc.property(fragment, (text) => {
      const state = EditorState.create({ doc: text, extensions: [htmlLanguage] });
      ensureSyntaxTree(state, state.doc.length, 2_000);
      expect(() => diagnoseNodelDocument(state)).not.toThrow();
      const diagnostics = diagnoseNodelDocument(state);
      expect(diagnostics.diagnostics.length).toBeLessThanOrEqual(NODEL_DIAGNOSTIC_LIMITS.maxDiagnostics);
      expect(diagnostics.diagnostics.every((item) => item.message.length <= NODEL_DIAGNOSTIC_LIMITS.maxMessageLength)).toBe(true);
      expect(diagnostics.diagnostics.every((item) => item.source === 'Nodel')).toBe(true);
      expect(diagnostics.summary.errors + diagnostics.summary.warnings).toBe(diagnostics.diagnostics.length);
      expect(() => completeNodelDocument(new CompletionContext(state, state.doc.length, true))).not.toThrow();
      const completion = completeNodelDocument(new CompletionContext(state, state.doc.length, true));
      if (completion) {
        expect(completion.options.length).toBeLessThanOrEqual(1_000);
        expect(completion.from).toBeGreaterThanOrEqual(0);
        expect(completion.to ?? state.doc.length).toBeLessThanOrEqual(state.doc.length);
      }
    }), propertyOptions);
  });

  it('bounds JSON values without invoking unsafe object behavior', () => {
    expect(validateJsonValueBounds({ ok: true })).toBeNull();
    expect(validateJsonValueBounds(Number.NaN)?.issue).toBe('number');
    expect(() => assertJsonValueBounds(Number.POSITIVE_INFINITY)).toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(validateJsonValueBounds(cyclic)?.issue).toBe('cyclic');
    expect(validateJsonValueBounds(Object.create(null))).toBeNull();
    expect(validateJsonValueBounds(new Date())?.issue).toBe('prototype');
    const sparse = [] as unknown[];
    sparse.length = 1;
    expect(validateJsonValueBounds(sparse)?.issue).toBe('value');
    const extra = [] as unknown[] & { extra?: boolean };
    extra.extra = true;
    expect(validateJsonValueBounds(extra)?.issue).toBe('value');
  });

  it('uses caller cancellation and direct-operation paths for deadlines', async () => {
    const caller = new AbortController();
    caller.abort('cancelled');
    await expect(runWithDeadline(async (signal) => signal.aborted, caller.signal)).resolves.toBe(true);
    await expect(runWithDeadline(async (signal) => signal.aborted, undefined, 0)).resolves.toBe(false);
  });
});
