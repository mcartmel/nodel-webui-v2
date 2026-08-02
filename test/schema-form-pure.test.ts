import {
  createSchemaForm,
  escapePointerSegment,
  enumRawKey
} from '../src/schema/schema-model';
import { decodeSchema } from '../src/api/codecs/nodel-codecs';
import { hydrateSchemaFormModel, serializeSchemaFormModel, setSchemaFieldPresence } from '../src/schema/schema-values';
import { validateSchemaForm } from '../src/schema/schema-validation';
import { syncSchemaFormControls } from '../src/schema/schema-form';

function field(form: ReturnType<typeof createSchemaForm>, key: string) {
  return form.fields.find((item) => item.key === key)!;
}

describe('schema form pure layers', () => {
  it('accepts Java Nodel hint metadata after codec normalization', () => {
    const schema = decodeSchema({
      type: 'object',
      title: 'Parameters',
      properties: {
        ipAddress: { type: 'string', title: 'IP Address', order: 0 },
        port: { type: 'integer', hint: 9999, title: 'port', order: 0 },
        disabled: { type: 'boolean', title: 'disabled', desc: 'Disables this node', order: 0 }
      }
    }, 'GET REST/params/schema');
    const form = createSchemaForm(schema);

    expect(form.unsupported).toBe(false);
    expect(field(form, 'port').hint).toBe('9999');
  });

  it('round-trips presence-distinct supported values and unknown nested properties', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        emptyString: { type: 'string' as const },
        emptyArray: { type: 'array' as const, items: { type: 'string' as const } },
        emptyObject: { type: 'object' as const, properties: { value: { type: 'string' as const } } },
        nothing: { type: 'string' as const },
        nullable: { type: [{ type: 'string' }, { type: 'null' }] as any },
        enabled: { type: 'boolean' as const },
        count: { type: 'integer' as const },
        map: { type: 'object' as const, items: { type: 'integer' as const } }
      }
    };
    const value = {
      emptyString: '',
      emptyArray: [],
      emptyObject: {},
      nullable: null,
      enabled: false,
      count: 0,
      map: { one: 0, extra: 2 },
      unknownRoot: { keep: true }
    };
    const form = createSchemaForm(schema);
    hydrateSchemaFormModel(form, value);
    expect(serializeSchemaFormModel(form)).toEqual(value);

    const missing = createSchemaForm(schema);
    hydrateSchemaFormModel(missing, { emptyString: '', emptyArray: [], emptyObject: {}, enabled: false, count: 0 });
    const serialized = serializeSchemaFormModel(missing) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(serialized, 'nothing')).toBe(false);
    expect(serialized.emptyString).toBe('');
    expect(serialized.emptyArray).toEqual([]);
    expect(serialized.emptyObject).toEqual({});
    expect(serialized.enabled).toBe(false);
    expect(serialized.count).toBe(0);
  });

  it('keeps enum identities collision-free while serializing exact raw values', () => {
    const values = [1, '1', true, 'true', null, '', 'plain'];
    const form = createSchemaForm({ type: 'object', properties: { value: { type: 'string', enum: values } } });
    const options = field(form, 'value').enumOptions;
    expect(new Set(options.map((option) => option.value)).size).toBe(values.length);
    expect(new Set(options.map((option) => enumRawKey(option.raw))).size).toBe(values.length);
    expect(options.map((option) => option.raw)).toEqual(values);
    for (const option of options) {
      const hydrated = createSchemaForm({ type: 'object', properties: { value: { type: 'string', enum: values } } });
      hydrateSchemaFormModel(hydrated, { value: option.raw });
      expect(serializeSchemaFormModel(hydrated)).toEqual({ value: option.raw });
    }
  });

  it('rejects multi-concrete unions and malformed constraints without a partial form', () => {
    const union = createSchemaForm({ type: [{ type: 'string' }, { type: 'number' }] as any });
    expect(union.unsupported).toBe(true);
    expect(union.controlsDisabled).toBe(true);
    expect(union.fields).toHaveLength(0);

    const malformed = createSchemaForm({ type: 'integer', step: 0, min: 10, max: 1 });
    expect(malformed.unsupported).toBe(true);
    expect(malformed.controlsDisabled).toBe(true);

    const unsupportedKeyword = createSchemaForm({ type: 'string', pattern: '.*' } as any);
    expect(unsupportedKeyword.unsupported).toBe(true);
    expect(unsupportedKeyword.fields).toHaveLength(0);

    for (const schema of [
      { type: 'number', minimum: 1 },
      { type: 'number', maximum: 10 },
      { type: 'integer', minmum: 1 },
      { type: 'string', arbitraryConstraint: true },
      { type: [{ type: 'null' }], arbitraryConstraint: true }
    ]) {
      const unsupported = createSchemaForm(schema as any);
      expect(unsupported.unsupported).toBe(true);
      expect(unsupported.controlsDisabled).toBe(true);
      expect(unsupported.fields).toHaveLength(0);
    }
  });

  it('round-trips scalar roots, explicit null, and nullable unions without object wrapping', () => {
    const cases: Array<{ schema: any; value: unknown }> = [
      { schema: { type: 'string' }, value: '' },
      { schema: { type: 'number' }, value: 0 },
      { schema: { type: 'integer' }, value: 0 },
      { schema: { type: 'boolean' }, value: false },
      { schema: { type: 'null' }, value: null },
      { schema: { type: 'array', items: { type: 'string' } }, value: [] },
      { schema: { type: 'object', properties: {} }, value: {} },
      { schema: { type: [{ type: 'string' }, { type: 'null' }] }, value: null },
      { schema: { type: 'array', items: { type: [{ type: 'object', properties: {} }, { type: 'null' }] } }, value: [null, {}] }
    ];

    for (const { schema, value } of cases) {
      const form = createSchemaForm(schema);
      hydrateSchemaFormModel(form, value);
      expect(serializeSchemaFormModel(form)).toEqual(value);
      expect(validateSchemaForm(form)).toEqual([]);
    }

    const missing = createSchemaForm({ type: 'string' });
    hydrateSchemaFormModel(missing, undefined);
    expect(serializeSchemaFormModel(missing)).toBeUndefined();
  });

  it('validates exact integers, finite numbers, step alignment, required fields, and item counts', () => {
    const form = createSchemaForm({
      type: 'object',
      properties: {
        amount: { type: 'integer', min: 2, max: 10, step: 2, required: true },
        items: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string' } }
      }
    });
    hydrateSchemaFormModel(form, { amount: 4, items: ['a'] });
    const amount = field(form, 'amount');
    amount.value = '12abc';
    const issues = validateSchemaForm(form);
    expect(issues.some((issue) => issue.fieldId === amount.id && issue.message.includes('whole'))).toBe(true);
    amount.value = '5';
    expect(validateSchemaForm(form).some((issue) => issue.fieldId === amount.id && issue.message.includes('increments'))).toBe(true);
    amount.value = '6';
    expect(validateSchemaForm(form).some((issue) => issue.fieldId === amount.id)).toBe(false);
    expect(validateSchemaForm(form).some((issue) => issue.message.includes('at least 2 items'))).toBe(true);

    amount.value = '12';
    const invalidPayload = serializeSchemaFormModel(form) as Record<string, unknown>;
    expect(invalidPayload.amount).toBeUndefined();
    expect(invalidPayload.items).toBeUndefined();
  });

  it('reports and blocks below-min, above-max, maxItems, and non-finite values independently', () => {
    const form = createSchemaForm({
      type: 'object',
      properties: {
        amount: { type: 'number', min: 2, max: 4 },
        items: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } }
      }
    });
    hydrateSchemaFormModel(form, { amount: 1, items: ['a', 'b', 'c'] });
    const amount = field(form, 'amount');
    expect(validateSchemaForm(form).some((issue) => issue.message.includes('at least 2'))).toBe(true);
    amount.value = '5';
    expect(validateSchemaForm(form).some((issue) => issue.message.includes('at most 4'))).toBe(true);
    amount.value = 'Infinity';
    expect(validateSchemaForm(form).some((issue) => issue.message.includes('finite'))).toBe(true);
    expect((serializeSchemaFormModel(form) as Record<string, unknown>).amount).toBeUndefined();
    expect(validateSchemaForm(form).some((issue) => issue.message.includes('no more than 2 items'))).toBe(true);
    expect((serializeSchemaFormModel(form) as Record<string, unknown>).items).toBeUndefined();
  });

  it('uses deterministic escaped pointer IDs and stable array entry identities', () => {
    const schema = { type: 'object' as const, properties: {
      'a/b': { type: 'string' as const },
      'a~1b': { type: 'string' as const },
      'punctuation.?': { type: 'string' as const },
      rows: { type: 'array' as const, items: { type: 'string' as const } }
    } };
    const first = createSchemaForm(schema, { idPrefix: 'same/form' });
    const second = createSchemaForm(schema, { idPrefix: 'same/form' });
    expect(first.fields.map((item) => item.id)).toEqual(second.fields.map((item) => item.id));
    expect(new Set(first.fields.map((item) => item.id)).size).toBe(first.fields.length);
    expect(escapePointerSegment('a/b~c')).toBe('a~1b~0c');
    expect(first.fields.find((item) => item.key === 'a/b')?.pointer).toBe('/a~1b');
    expect(first.fields.find((item) => item.key === 'a~1b')?.pointer).toBe('/a~01b');
    // Entry identity is generated per form, not from a module-global counter; reorder and rehydration do not rewrite it.
    const hydrated = createSchemaForm(schema, { idPrefix: 'same/form' });
    hydrateSchemaFormModel(hydrated, { rows: ['first', 'second'] });
    const ids = hydrated.fields.find((item) => item.key === 'rows')!.entries.map((entry) => entry.id);
    const [firstId, secondId] = ids;
    const rowField = hydrated.fields.find((item) => item.key === 'rows')!;
    rowField.entries.reverse();
    expect(rowField.entries.map((entry) => entry.id).sort()).toEqual(ids.sort());
    hydrateSchemaFormModel(hydrated, { rows: ['second', 'first'] });
    expect(rowField.entries.map((entry) => entry.id)).toEqual([secondId, firstId]);
  });

  it('round-trips a property-style set of nested values without cleaning valid empties', () => {
    const schema = {
      type: 'object',
      properties: {
        text: { type: 'string' },
        count: { type: 'integer' },
        enabled: { type: 'boolean' },
        maybe: { type: [{ type: 'object', properties: { label: { type: 'string' } } }, { type: 'null' }] },
        list: { type: 'array', items: { type: 'object', properties: { value: { type: 'number' } } } }
      }
    } as any;
    const values = [
      { text: '', count: 0, enabled: false, maybe: null, list: [] },
      { text: 'ready', count: -2, enabled: true, maybe: {}, list: [{}] },
      { text: 'x', count: 12, enabled: false, maybe: { label: '' }, list: [{ value: 0 }, { value: 2.5 }] }
    ];
    for (const value of values) {
      const form = createSchemaForm(schema);
      hydrateSchemaFormModel(form, value);
      expect(serializeSchemaFormModel(form)).toEqual(value);
    }
  });

  it('lets nullable fields intentionally distinguish null, empty string, and missing', () => {
    const schema = { type: 'object', properties: { maybe: { type: [{ type: 'string' }, { type: 'null' }] } } } as any;
    for (const value of [{ maybe: null }, { maybe: '' }, {}]) {
      const form = createSchemaForm(schema);
      hydrateSchemaFormModel(form, value);
      expect(serializeSchemaFormModel(form)).toEqual(value);
    }
  });

  it('transitions optional nullable fields through missing, null, value, and back to missing', () => {
    const schema = {
      type: 'object',
      properties: {
        maybe: { type: [{ type: 'string' }, { type: 'null' }] },
        requiredMaybe: { type: [{ type: 'string' }, { type: 'null' }], required: true }
      }
    } as any;
    const form = createSchemaForm(schema);
    hydrateSchemaFormModel(form, { maybe: '', requiredMaybe: null });
    const maybe = field(form, 'maybe');
    expect(maybe.presenceState).toBe('value');
    expect(setSchemaFieldPresence(form, maybe.id, 'missing')).toBe(maybe);
    expect(serializeSchemaFormModel(form)).toEqual({ requiredMaybe: null });
    setSchemaFieldPresence(form, maybe.id, 'null');
    expect(serializeSchemaFormModel(form)).toEqual({ maybe: null, requiredMaybe: null });
    setSchemaFieldPresence(form, maybe.id, 'value');
    expect(serializeSchemaFormModel(form)).toEqual({ maybe: '', requiredMaybe: null });
    setSchemaFieldPresence(form, maybe.id, 'missing');
    expect(serializeSchemaFormModel(form)).toEqual({ requiredMaybe: null });

    const required = field(form, 'requiredMaybe');
    expect(setSchemaFieldPresence(form, required.id, 'missing')).toBeNull();
    expect(serializeSchemaFormModel(form)).toEqual({ requiredMaybe: null });
  });

  it('edits nullable object array items between null and concrete values while retaining stable IDs', () => {
    const form = createSchemaForm({
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: { type: [{ type: 'object', properties: { name: { type: 'string' } } }, { type: 'null' }] }
        }
      }
    } as any);
    hydrateSchemaFormModel(form, { rows: [null, {}] });
    const rows = field(form, 'rows');
    const [nullEntry, concreteEntry] = rows.entries;
    expect(rows.entries.map((entry) => entry.id)).toHaveLength(2);
    expect(nullEntry.nullable).toBe(true);
    expect(nullEntry.fields).toHaveLength(1);
    expect(serializeSchemaFormModel(form)).toEqual({ rows: [null, {}] });

    nullEntry.nullValue = false;
    concreteEntry.nullValue = true;
    expect(serializeSchemaFormModel(form)).toEqual({ rows: [{}, null] });
    rows.entries.reverse();
    expect(serializeSchemaFormModel(form)).toEqual({ rows: [null, {}] });
    expect(rows.entries.map((entry) => entry.id)).toEqual([concreteEntry.id, nullEntry.id]);
  });

  it('never permits nullable scalar array items to become missing', () => {
    const form = createSchemaForm({
      type: 'object',
      properties: {
        values: { type: 'array', items: { type: [{ type: 'string' }, { type: 'null' }] } }
      }
    } as any);
    hydrateSchemaFormModel(form, { values: [null, 'ready'] });
    const values = field(form, 'values');
    const item = values.entries[0].valueField!;
    expect(item.allowMissing).toBe(false);
    expect(setSchemaFieldPresence(form, item.id, 'missing')).toBeNull();
    item.present = false;
    item.presenceState = 'value';
    expect(validateSchemaForm(form).some((issue) => issue.message.includes('array item'))).toBe(true);
    expect(serializeSchemaFormModel(form)).toBeUndefined();
  });

  it('activates missing nullable ancestors when a child becomes concrete', () => {
    const form = createSchemaForm({
      type: 'object',
      properties: {
        config: { type: [{ type: 'object', properties: { name: { type: 'string' } } }, { type: 'null' }] },
        values: { type: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] }
      }
    } as any);
    hydrateSchemaFormModel(form, {});
    const config = field(form, 'config');
    const name = config.children[0];
    setSchemaFieldPresence(form, name.id, 'value');
    name.value = 'active';
    expect(config.present).toBe(true);
    expect(config.presenceState).toBe('value');
    expect(serializeSchemaFormModel(form)).toEqual({ config: { name: 'active' } });
  });

  it('activates nullable ancestor fields when a nested nullable child is set to null', () => {
    const form = createSchemaForm({
      type: 'object',
      properties: {
        config: {
          type: [
            { type: 'object', properties: { name: { type: [{ type: 'string' }, { type: 'null' }] } }, required: false },
            { type: 'null' }
          ]
        }
      }
    } as any);
    hydrateSchemaFormModel(form, {});

    const config = field(form, 'config');
    const name = config.children[0];
    expect(config.present).toBe(false);
    expect(config.presenceState).toBe('missing');
    expect(config.value).toEqual({});
    expect(config.concreteValue).toEqual({});
    expect(name.concreteValue).toBe('');
    expect(name.value).toBe('');

    setSchemaFieldPresence(form, name.id, 'null');

    expect(config.present).toBe(true);
    expect(config.presenceState).toBe('value');
    expect(config.value).toEqual({});
    expect(config.concreteValue).toEqual({});
    expect(name.present).toBe(true);
    expect(name.presenceState).toBe('null');
    expect(name.value).toBeNull();
    expect(name.concreteValue).toBe('');
    expect(validateSchemaForm(form)).toEqual([]);
    expect(serializeSchemaFormModel(form)).toEqual({ config: { name: null } });
  });

  it('reconciles a form with one scoped selector traversal', () => {
    const form = createSchemaForm({ type: 'object', properties: { maybe: { type: [{ type: 'string' }, { type: 'null' }] } } } as any);
    hydrateSchemaFormModel(form, { maybe: null });
    const root = document.createElement('div');
    const maybe = field(form, 'maybe');
    root.innerHTML = `<div data-schema-field-id="${maybe.id}"><select data-schema-presence><option value="value">Value</option><option value="null">Null</option><option value="missing">Missing</option></select><input data-schema-field-input /></div>`;
    const querySpy = vi.spyOn(root, 'querySelectorAll');
    syncSchemaFormControls(form, root);
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(root.querySelector<HTMLSelectElement>('[data-schema-presence]')?.value).toBe('null');
  });

  it('round-trips many bounded generated supported schema/value combinations reproducibly', () => {
    let seed = 0x5eed1234;
    const next = (limit: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % limit;
    };
    const scalar = (_depth: number): { schema: any; value: unknown } => {
      const choice = next(5);
      if (choice === 0) return { schema: { type: 'string' }, value: next(3) === 0 ? '' : `s${next(8)}` };
      if (choice === 1) return { schema: { type: 'integer' }, value: next(3) === 0 ? 0 : next(21) - 10 };
      if (choice === 2) return { schema: { type: 'number' }, value: next(3) === 0 ? 0 : (next(21) - 10) / 2 };
      if (choice === 3) return { schema: { type: 'boolean' }, value: next(2) === 0 };
      const enumValues = ['', 'On', '1', 1, false, null];
      const raw = enumValues[next(enumValues.length)];
      return { schema: { type: [{ type: 'string', enum: enumValues }, { type: 'null' }] }, value: raw };
    };
    const generated = (depth: number): { schema: any; value: unknown } => {
      if (depth >= 2) return scalar(depth);
      const choice = next(4);
      if (choice === 0) return scalar(depth);
      if (choice === 1) {
        const child = generated(depth + 1);
        const escaped = scalar(depth + 1);
        const value: Record<string, unknown> = { 'unknown/meta': { keep: true } };
        if (next(2) === 0) value['a/b'] = child.value;
        if (next(2) === 0) value['a~1b'] = escaped.value;
        return { schema: { type: 'object', properties: { 'a/b': child.schema, 'a~1b': escaped.schema } }, value };
      }
      if (choice === 2) {
        const item = generated(depth + 1);
        const count = next(3);
        return { schema: { type: 'array', items: item.schema }, value: Array.from({ length: count }, () => item.value) };
      }
      const item = scalar(depth + 1);
      return { schema: { type: 'object', items: item.schema }, value: { '': item.value, 'key/with~escape': item.value } };
    };

    for (let index = 0; index < 128; index += 1) {
      const { schema, value } = generated(0);
      const form = createSchemaForm(schema);
      hydrateSchemaFormModel(form, value);
      expect(serializeSchemaFormModel(form), `generated case ${index}, seed ${seed}`).toEqual(value);
    }
  });
});
