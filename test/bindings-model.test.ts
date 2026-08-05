import { bindingStatusLinkProperties, createBindingSections, hasBindingSchema, serializeBindingPayload, validateBindingRow } from '../src/features/bindings-model';
import type { NodelJsonSchema } from '../src/api/nodel-types';

const schema: NodelJsonSchema = {
  type: 'object',
  properties: {
    actions: {
      type: 'object',
      properties: {
        Power: {
          type: 'object',
          title: 'Power',
          properties: {
            node: { type: 'string' },
            action: { type: 'string', enum: ['PowerOn', 'PowerOff'] }
          }
        }
      }
    },
    events: {
      type: 'object',
      properties: {
        Online: {
          type: 'object',
          properties: {
            node: { type: 'string' },
            event: { type: 'string' }
          }
        }
      }
    }
  }
};

const requiredSchema: NodelJsonSchema = {
  type: 'object',
  properties: {
    actions: {
      type: 'object',
      properties: {
        Power: {
          type: 'object',
          properties: {
            node: { type: 'string', required: true },
            action: { type: 'string', enum: ['PowerOn', 'PowerOff'], required: true }
          }
        }
      }
    }
  }
};

describe('bindings model', () => {
  it('creates binding sections from schema and backend values', () => {
    const sections = createBindingSections(schema, {
      actions: { Power: { node: 'Display', action: 'PowerOn' } }
    });

    expect(hasBindingSchema(schema)).toBe(true);
    expect(sections.map((section) => section.kind)).toEqual(['actions', 'events']);
    expect(sections[0].rows[0]).toEqual(expect.objectContaining({
      alias: 'Power',
      title: 'Power',
      node: 'Display',
      target: 'PowerOn',
      targetKey: 'action',
      status: 'Unwired'
    }));
    expect(sections[0].rows[0].statusHref).toContain('Display');
  });

  it('serializes dirty rows while preserving untouched backend metadata', () => {
    const source = {
      actions: {
        Power: { node: 'Display', action: 'PowerOn', extra: 'keep' }
      }
    };
    const sections = createBindingSections(schema, source);
    const row = sections[0].rows[0];
    row.target = 'PowerOff';
    row.dirty = true;
    row.targetDirty = true;

    expect(serializeBindingPayload(source, sections)).toEqual({
      actions: {
        Power: { node: 'Display', action: 'PowerOff', extra: 'keep' }
      }
    });
  });

  it('serializes an absent prototype-like alias as an own property without changing the section prototype', () => {
    const prototypeSchema = JSON.parse('{"type":"object","properties":{"actions":{"type":"object","properties":{"__proto__":{"type":"object","properties":{"node":{"type":"string"},"action":{"type":"string"}}}}}}}');
    const sections = createBindingSections(prototypeSchema, {});
    const row = sections[0].rows[0];
    row.node = 'Display';
    row.target = 'PowerOn';
    row.dirty = true;
    row.nodeDirty = true;
    row.targetDirty = true;

    const payload = serializeBindingPayload({}, sections) as { actions: Record<string, unknown> };
    expect(Object.getPrototypeOf(payload.actions)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(payload.actions, '__proto__')).toBe(true);
    expect(payload.actions.__proto__).toEqual({ node: 'Display', action: 'PowerOn' });
  });

  it('updates existing constructor and prototype aliases as exact own payload properties', () => {
    const prototypeSchema = JSON.parse('{"type":"object","properties":{"actions":{"type":"object","properties":{"constructor":{"type":"object","properties":{"node":{"type":"string"},"action":{"type":"string"}}},"prototype":{"type":"object","properties":{"node":{"type":"string"},"action":{"type":"string"}}}}}}}');
    const source = JSON.parse('{"actions":{"constructor":{"node":"Existing","action":"Old"},"prototype":{"node":"Existing","action":"Old"}}}');
    const sections = createBindingSections(prototypeSchema, source);
    for (const row of sections[0].rows) {
      row.target = 'New';
      row.dirty = true;
      row.targetDirty = true;
    }

    const payload = serializeBindingPayload(source, sections) as { actions: Record<string, unknown> };
    expect(Object.getPrototypeOf(payload.actions)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(payload.actions, 'constructor')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(payload.actions, 'prototype')).toBe(true);
    expect(payload).toEqual({
      actions: {
        constructor: { node: 'Existing', action: 'New' },
        prototype: { node: 'Existing', action: 'New' }
      }
    });
  });

  it('allows partial rows while validating supplied values without mutating the backend schema', () => {
    const validValues = [
      {},
      { node: 'Display' },
      { action: 'PowerOn' },
      { node: 'Display', action: 'PowerOn' }
    ];

    for (const value of validValues) {
      const row = createBindingSections(requiredSchema, { actions: { Power: value } })[0].rows[0];
      expect(validateBindingRow(row)).toEqual([]);
    }

    const invalidRow = createBindingSections(requiredSchema, { actions: { Power: { action: 'MissingAction' } } })[0].rows[0];
    expect(validateBindingRow(invalidRow)).toEqual([
      expect.objectContaining({ pointer: expect.stringMatching(/\/action$/), message: 'Choose one of the available values.' })
    ]);
    expect(requiredSchema.properties?.actions?.properties?.Power?.properties?.node?.required).toBe(true);
    expect(requiredSchema.properties?.actions?.properties?.Power?.properties?.action?.required).toBe(true);
  });

  it('does not turn malformed backend names into replacement-character search links', () => {
    expect(bindingStatusLinkProperties('Node\ud800')).toEqual({
      statusHref: '',
      statusLinkLabel: 'Open Node\ud800 in Network nodes'
    });
    expect(bindingStatusLinkProperties('Node\ufffd').statusHref).toBe('/nodes.html?filter=Node%EF%BF%BD#Network');
  });
});
