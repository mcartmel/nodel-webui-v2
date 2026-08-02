import { createBindingSections, hasBindingSchema, serializeBindingPayload, validateBindingRow } from '../src/features/bindings-model';
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

  it('validates rows against their backend schema', () => {
    const sections = createBindingSections(schema, { actions: { Power: { node: 'Display', action: 'PowerOn' } } });
    const row = sections[0].rows[0];
    row.target = 'MissingAction';
    row.dirty = true;
    row.targetDirty = true;

    expect(validateBindingRow(row)).not.toEqual([]);
  });
});
