import {
  attachSchemaFormContext,
  buildArrayEntry,
  buildMapEntry,
  enumRawKey,
  type SchemaArrayEntry,
  type SchemaField,
  type SchemaFormModel,
  type SchemaPresenceState
} from './schema-model';
import { hasOwn, isRecord, setOwn } from '../utils/records';
import { validateJsonValueBounds } from '../utils/json-value';
import { safeText } from '../utils/html';

export function cloneSchemaValue<T>(value: T): T {
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return items.map((item) => cloneSchemaValue(item)) as T;
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      setOwn(result, key, cloneSchemaValue(child));
    }
    return result as T;
  }
  return value;
}

export interface SchemaHydrateOptions {
  preserveDirty?: boolean;
}

/** Presence-aware hydration. No DOM, JsViews, or observable state is touched here. */
export function hydrateSchemaFormModel(form: SchemaFormModel, value: unknown, options: SchemaHydrateOptions = {}) {
  form.sourceValue = cloneSchemaValue(value);
  form.rootPresent = value !== undefined;
  form.rootTypeMismatch = form.rootObject && form.rootPresent && !isRecord(value);
  for (const field of form.fields) {
    if (form.rootObject) {
      hydrateSchemaFieldModel(field, value, field.key, hasOwn(value, field.key), undefined, options);
    } else {
      hydrateSchemaFieldModel(field, value, undefined, form.rootPresent, undefined, options);
    }
  }
  form.dirty = form.fields.some(hasDirtyField);
}

export function hydrateSchemaFieldModel(field: SchemaField, containerOrValue: unknown, key?: string, explicitPresent?: boolean, previousField?: SchemaField, options: SchemaHydrateOptions = {}) {
  const previousEntries = (previousField ?? field).entries.slice();
  const previousMapEntries = (previousField ?? field).mapEntries.slice();
  if (previousField) field.dirty = previousField.dirty;
  if (options.preserveDirty && field.dirty) {
    if (previousField && previousField !== field) copySchemaFieldState(field, previousField);
    return;
  }
  const present = explicitPresent ?? (key === undefined ? containerOrValue !== undefined : hasOwn(containerOrValue, key));
  const value = key === undefined ? containerOrValue : isRecord(containerOrValue) ? containerOrValue[key] : undefined;
  field.present = present;
  field.presenceState = !present ? field.allowMissing ? 'missing' : 'value' : field.nullable && value === null ? 'null' : 'value';
  field.typeMismatch = false;
  field.unknownProperties = {};

  if (field.kind === 'json') {
    if (!present) {
      field.value = '';
      field.concreteValue = '';
      return;
    }
    const text = JSON.stringify(value, null, 2);
    if (text === undefined) {
      field.typeMismatch = true;
      return;
    }
    field.value = text;
    field.concreteValue = text;
    return;
  }

  // Enum identities take precedence over primitive conversion and nullable presence.
  // This also canonicalizes a wire null to its enum option when one exists.
  if (present && field.enumOptions.length > 0) {
    const option = enumOptionForRawValue(field, value);
    if (option) {
      field.value = option.value;
      field.concreteValue = field.value;
      field.presenceState = 'value';
      return;
    }
    field.value = value;
    field.concreteValue = value;
    if (field.nullable && value === null) {
      field.presenceState = 'null';
      return;
    }
    field.presenceState = 'value';
    field.typeMismatch = true;
    return;
  }

  if (present && value === null && field.kind !== 'null') {
    if (field.kind !== 'object' && field.kind !== 'array' && field.value !== null) field.concreteValue = field.value;
    field.value = null;
    return;
  }

  if (field.kind === 'object') {
    if (!present) {
      field.value = {};
      field.concreteValue = {};
      field.mapEntries.splice(0, field.mapEntries.length);
      for (const child of field.children) hydrateSchemaFieldModel(child, undefined, undefined, false, child, options);
      return;
    }
    if (!isRecord(value)) {
      field.typeMismatch = true;
      field.mapEntries.splice(0, field.mapEntries.length);
      for (const child of field.children) hydrateSchemaFieldModel(child, undefined, undefined, false, child, options);
      return;
    }
    field.value = {};
    field.concreteValue = {};
    const known = new Set(field.children.map((child) => child.key));
    for (const [childKey, childValue] of Object.entries(value)) {
      if (!known.has(childKey) && field.mapItemSchema === null) setOwn(field.unknownProperties, childKey, cloneSchemaValue(childValue));
    }
    for (const child of field.children) {
      hydrateSchemaFieldModel(child, value, child.key, hasOwn(value, child.key), child, options);
    }
    if (field.mapItemSchema) {
      const mapEntries = Object.keys(value).filter((mapKey) => !known.has(mapKey)).map((mapKey) => {
        const entry = buildMapEntry(field, mapKey);
        const previous = previousMapEntries.find((candidate) => candidate.key === mapKey)?.field;
        hydrateSchemaFieldModel(entry.field, value, mapKey, true, previous, options);
        return entry;
      });
      field.mapEntries.splice(0, field.mapEntries.length, ...mapEntries);
      const form = (field as SchemaField & { form?: SchemaFormModel }).form;
      if (form) attachSchemaFormContext(form);
    }
    return;
  }

  if (field.kind === 'array') {
    if (!present) {
      field.value = [];
      field.concreteValue = [];
      field.entries.splice(0, field.entries.length);
      return;
    }
    if (!Array.isArray(value)) {
      field.typeMismatch = true;
      field.entries.splice(0, field.entries.length);
      return;
    }
    field.value = [];
    field.concreteValue = [];
    const used = new Set<SchemaArrayEntry>();
    const nextEntries = value.map((item, index) => {
      const exact = previousEntries.find((entry) => !used.has(entry) && schemaArrayEntryValue(entry) !== undefined && valuesEqual(schemaArrayEntryValue(entry), item));
      const positional = previousEntries[index] && !used.has(previousEntries[index]) ? previousEntries[index] : undefined;
      const previous = exact ?? positional;
      if (previous) used.add(previous);
      return {
        entry: buildArrayEntry(field, item, index, undefined, previous?.id),
        previous
      };
    });
    field.entries.splice(0, field.entries.length, ...nextEntries.map(({ entry }) => entry));
    syncArrayEntryState(field);
    const form = (field as SchemaField & { form?: SchemaFormModel }).form;
    if (form) attachSchemaFormContext(form);
    for (const [index, next] of nextEntries.entries()) {
      const entry = next.entry;
      const previous = next.previous;
      if (entry.valueField) {
        hydrateSchemaFieldModel(entry.valueField, value[index], undefined, true, previous?.valueField ?? undefined, options);
      }
      else {
        const source: unknown = value[index];
        for (const child of entry.fields) {
          const previousChild = previous?.fields.find((candidate) => candidate.key === child.key);
          hydrateSchemaFieldModel(child, source, child.key, hasOwn(source, child.key), previousChild, options);
        }
      }
    }
    return;
  }

  if (!present) {
    field.value = initialConcreteValue(field);
    field.concreteValue = field.value;
    return;
  }
  if (field.kind === 'number') {
    if (value === null) {
      field.value = null;
      return;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) field.typeMismatch = true;
    field.value = value === undefined ? '' : safeText(value);
    field.concreteValue = field.value;
    return;
  }
  field.value = value;
  field.concreteValue = value;
  if (!valueMatchesKind(field, value)) field.typeMismatch = true;
}

/** Presence-aware serialization. Empty strings, collections, null, false, and zero are values. */
export function serializeSchemaFormModel(form: SchemaFormModel): unknown {
  if (form.rootTypeMismatch) return undefined;
  if (!form.rootObject) {
    const field = form.fields[0];
    return field ? serializeSchemaFieldModel(field) : undefined;
  }
  const root: Record<string, unknown> = form.rootObject && isRecord(form.sourceValue)
    ? cloneSchemaValue(form.sourceValue)
    : {};
  for (const field of form.fields) {
    const value = serializeSchemaFieldModel(field);
    if (field.present && value !== undefined) setOwn(root, field.key, value);
    else if (field.present && (hasArraySerializationFailure(field) || hasInvalidEnumState(field))) return undefined;
    else delete root[field.key];
  }
  return root;
}

export function serializeSchemaFieldModel(field: SchemaField): unknown {
  if (!field.present) return undefined;
  if (field.typeMismatch) return undefined;
  if (field.kind === 'null') return null;
  if (field.enumOptions.length > 0) {
    if (field.value === null && (field.nullable || enumOptionForRawValue(field, null))) return null;
    return selectedEnumOption(field)?.raw;
  }
  if (field.value === null) return null;
  if (field.kind === 'json') {
    if (typeof field.value !== 'string') return undefined;
    try {
      const parsed: unknown = JSON.parse(field.value);
      return validateJsonValueBounds(parsed) ? undefined : parsed;
    } catch {
      return undefined;
    }
  }
  if (field.kind === 'object') {
    const result: Record<string, unknown> = cloneSchemaValue(field.unknownProperties);
    for (const child of field.children) {
      const value = serializeSchemaFieldModel(child);
      if (child.present && value === undefined) return undefined;
      if (child.present) setOwn(result, child.key, value);
      else delete result[child.key];
    }
    for (const entry of field.mapEntries) {
      const value = serializeSchemaFieldModel(entry.field);
      if (entry.field.present && value === undefined) return undefined;
      if (entry.field.present) setOwn(result, entry.key, value);
      else delete result[entry.key];
    }
    return result;
  }
  if (field.kind === 'array') {
    if ((field.minItems >= 0 && field.entries.length < field.minItems) || (field.maxItems >= 0 && field.entries.length > field.maxItems)) return undefined;
    const values = field.entries.map(serializeArrayEntry);
    return values.some((value) => value === undefined) ? undefined : values;
  }
  if (field.kind === 'boolean') return typeof field.value === 'boolean' ? field.value : undefined;
  if (field.kind === 'number') {
    const parsed = parseStrictNumber(field.value, field.numberType === 'integer');
    if (parsed === undefined || !numericConstraintsMatch(field, parsed)) return undefined;
    return parsed;
  }
  if (field.kind === 'string' && typeof field.value !== 'string') return undefined;
  return field.value;
}

/** Resolve a private form identity; raw values never serve as control identities. */
export function selectedEnumOption(field: SchemaField) {
  return field.enumOptions.find((option) => option.value === field.value);
}

function enumOptionForRawValue(field: SchemaField, value: unknown) {
  // find() deliberately chooses the first authored duplicate deterministically.
  return field.enumOptions.find((option) => enumRawKey(option.raw) === enumRawKey(value));
}

function serializeArrayEntry(entry: SchemaArrayEntry) {
  if (entry.typeMismatch) return undefined;
  if (entry.nullValue) return null;
  if (entry.valueField) return serializeSchemaFieldModel(entry.valueField);
  const result: Record<string, unknown> = cloneSchemaValue(entry.unknownProperties);
  for (const child of entry.fields) {
    const value = serializeSchemaFieldModel(child);
    if (child.present && value === undefined) return undefined;
    if (child.present) setOwn(result, child.key, value);
    else delete result[child.key];
  }
  return result;
}

function hasArraySerializationFailure(field: SchemaField): boolean {
  if (field.kind === 'array') {
    return field.entries.some((entry) => {
      if (entry.valueField && !entry.valueField.present && !entry.valueField.allowMissing) return true;
      return entry.fields.some((child) => (!child.present && !child.allowMissing) || hasArraySerializationFailure(child));
    });
  }
  return field.children.some(hasArraySerializationFailure) || field.mapEntries.some((entry) => hasArraySerializationFailure(entry.field));
}

function hasInvalidEnumState(field: SchemaField): boolean {
  if (field.present && field.enumOptions.length > 0 && (field.typeMismatch || (field.value !== null && !selectedEnumOption(field)))) return true;
  return field.children.some(hasInvalidEnumState)
    || field.entries.some((entry) => entry.fields.some(hasInvalidEnumState) || Boolean(entry.valueField && hasInvalidEnumState(entry.valueField)))
    || field.mapEntries.some((entry) => hasInvalidEnumState(entry.field));
}

export function parseStrictNumber(value: unknown, integer: boolean): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (integer && (!Number.isSafeInteger(value) || !Number.isInteger(value)))) return undefined;
    return value;
  }
  if (typeof value !== 'string' || value === '' || value.trim() !== value || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) return undefined;
  if (integer && !/^[+-]?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && (!Number.isSafeInteger(parsed) || !Number.isInteger(parsed)))) return undefined;
  return parsed;
}

export function markSchemaFieldPresent(form: SchemaFormModel, fieldId: string, present = true): SchemaField | null {
  const field = findField(form.fields, fieldId);
  if (!field) return null;
  if (present) activateSchemaField(form, fieldId);
  else {
    field.present = false;
    field.presenceState = field.allowMissing ? 'missing' : 'value';
  }
  return field;
}

export function activateSchemaField(form: SchemaFormModel, fieldId: string): SchemaField[] {
  const field = findField(form.fields, fieldId);
  if (!field) return [];
  const activated: SchemaField[] = [];
  let current: SchemaField | undefined = field;
  while (current) {
    if (current.value === null) current.value = cloneSchemaValue(current.concreteValue ?? initialConcreteValue(current));
    current.present = true;
    current.presenceState = 'value';
    activated.push(current);
    current = current.parent;
  }
  return activated;
}

export function setSchemaFieldPresence(form: SchemaFormModel, fieldId: string, state: SchemaPresenceState): SchemaField | null {
  const field = findField(form.fields, fieldId);
  if (!field || (state === 'missing' && !field.allowMissing) || (state === 'null' && !field.nullable)) return null;
  if (state === 'missing') {
    field.present = false;
    field.presenceState = 'missing';
    return field;
  }
  if (state === 'null') {
    // Reuse the same ancestor-activation path used for concrete edits.
    // This keeps nested nullable ancestors present and in the 'value' presence state.
    activateSchemaField(form, field.id);
    if (field.enumOptions.length > 0) {
      // Do not retain an unmatched loaded raw value: it may collide with a private option identity.
      const option = field.typeMismatch ? undefined : selectedEnumOption(field);
      field.concreteValue = option?.value ?? initialConcreteValue(field);
    } else if (field.value !== null && field.kind !== 'object' && field.kind !== 'array') {
      field.concreteValue = cloneSchemaValue(field.value);
    }
    field.value = null;
    if (field.enumOptions.length > 0) field.typeMismatch = false;
    field.presenceState = 'null';
    return field;
  }
  activateSchemaField(form, fieldId);
  return field;
}

export function setSchemaFieldValue(form: SchemaFormModel, fieldId: string, value: unknown, present = true) {
  const field = markSchemaFieldPresent(form, fieldId, present);
  if (field) {
    field.value = value;
    // Setter values are user selections, unlike loaded raw values. Invalid identities
    // are validated as unselected enum values rather than loaded type mismatches.
    if (field.enumOptions.length > 0) {
      field.typeMismatch = false;
    }
    field.presenceState = present && field.nullable && value === null ? 'null' : present ? 'value' : field.allowMissing ? 'missing' : 'value';
    if (present && value !== null) field.concreteValue = cloneSchemaValue(value);
  }
  return field;
}

export function markSchemaFieldDirty(form: SchemaFormModel, fieldId: string): SchemaField | null {
  const field = findField(form.fields, fieldId);
  if (!field) return null;
  field.dirty = true;
  form.dirty = true;
  return field;
}

export function resetSchemaFormDirty(form: SchemaFormModel) {
  for (const field of allFields(form.fields)) field.dirty = false;
  form.dirty = false;
}

function findField(fields: SchemaField[], id: string): SchemaField | null {
  for (const field of fields) {
    if (field.id === id) return field;
    const child = findField(field.children, id);
    if (child) return child;
    for (const entry of field.entries) {
      const nested = entry.valueField?.id === id ? entry.valueField : findField(entry.fields, id);
      if (nested) return nested;
    }
    const mapField = field.mapEntries.find((entry) => entry.field.id === id)?.field;
    if (mapField) return mapField;
  }
  return null;
}

function valueMatchesKind(field: SchemaField, value: unknown) {
  if (value === null) return field.kind === 'null' || field.nullable;
  if (field.kind === 'null') return false;
  if (field.kind === 'string') return typeof value === 'string';
  if (field.kind === 'boolean') return typeof value === 'boolean';
  if (field.kind === 'number') return typeof value === 'number' && Number.isFinite(value);
  return true;
}

function initialConcreteValue(field: SchemaField) {
  if (field.kind === 'boolean') return false;
  if (field.kind === 'null') return null;
  if (field.kind === 'object') return {};
  if (field.kind === 'array') return [];
  return '';
}

function syncArrayEntryState(field: SchemaField) {
  field.entries.forEach((entry, index) => {
    entry.index = index;
    entry.canRemove = field.minItems < 0 || field.entries.length > field.minItems;
    entry.canMoveUp = index > 0;
    entry.canMoveDown = index < field.entries.length - 1;
  });
}

export function refreshSchemaFormPresence(form: SchemaFormModel) {
  return form;
}

function schemaArrayEntryValue(entry: SchemaArrayEntry): unknown {
  if (entry.valueField) return serializeSchemaFieldModel(entry.valueField);
  return serializeArrayEntry(entry);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => valuesEqual(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => hasOwn(right, key) && valuesEqual(left[key], right[key]));
  }
  return false;
}

function hasDirtyField(field: SchemaField): boolean {
  return field.dirty || field.children.some(hasDirtyField)
    || field.entries.some((entry) => entry.fields.some(hasDirtyField) || Boolean(entry.valueField && hasDirtyField(entry.valueField)))
    || field.mapEntries.some((entry) => hasDirtyField(entry.field));
}

function allFields(fields: SchemaField[]): SchemaField[] {
  return fields.flatMap((field) => [
    field,
    ...allFields(field.children),
    ...field.entries.flatMap((entry) => [...allFields(entry.fields), ...(entry.valueField ? allFields([entry.valueField]) : [])]),
    ...field.mapEntries.flatMap((entry) => allFields([entry.field]))
  ]);
}

function copySchemaFieldState(target: SchemaField, source: SchemaField) {
  target.value = cloneSchemaValue(source.value);
  target.concreteValue = cloneSchemaValue(source.concreteValue);
  target.present = source.present;
  target.presenceState = source.presenceState;
  target.dirty = source.dirty;
  target.typeMismatch = source.typeMismatch;
  target.unknownProperties = cloneSchemaValue(source.unknownProperties);
  target.open = source.open;
  target.errors = source.errors.slice();
  target.entries.splice(0, target.entries.length, ...source.entries);
  target.mapEntries.splice(0, target.mapEntries.length, ...source.mapEntries);
  for (const child of target.children) {
    const sourceChild = source.children.find((candidate) => candidate.key === child.key);
    if (sourceChild) copySchemaFieldState(child, sourceChild);
  }
}

function numericConstraintsMatch(field: SchemaField, value: number) {
  const min = numeric(field.min);
  const max = numeric(field.max);
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  const step = field.step === 'any' ? undefined : numeric(field.step);
  if (step === undefined) return true;
  const base = min ?? 0;
  const quotient = (value - base) / step;
  return Number.isFinite(step) && step > 0 && Math.abs(quotient - Math.round(quotient)) <= Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8;
}

function numeric(value: number | string) {
  if (value === '') return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}
