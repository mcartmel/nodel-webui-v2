import type { NodelJsonSchema } from '../api/nodel-types';
import {
  enumRawKey,
  normalizeSchema,
  type SchemaField,
  type SchemaFormModel,
  type SchemaValidationIssue
} from './schema-model';
import { parseStrictNumber, selectedEnumOption } from './schema-values';
import { hasOwn, isRecord } from '../utils/records';
import { validateJsonValueBounds } from '../utils/json-value';

export function validateSchemaForm(form: SchemaFormModel): SchemaValidationIssue[] {
  if (form.unsupported) {
    return [{ fieldId: form.id, pointer: '', message: form.unsupportedReason || 'This schema is not supported.' }];
  }
  const rootIssues = form.rootTypeMismatch
    ? [{ fieldId: form.id, pointer: '', message: 'The loaded value does not match this object schema.' }]
    : [];
  return [...rootIssues, ...form.fields.flatMap((field) => validateField(field))];
}

export function validateField(field: SchemaField): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];
  if (field.unsupported) {
    issues.push(issue(field, field.unsupportedReason || 'This field schema is not supported.'));
    return issues;
  }
  if (field.required && !field.present) {
    issues.push(issue(field, 'This field is required.'));
    return issues;
  }
  if (!field.present && !field.allowMissing) {
    issues.push(issue(field, 'This array item must have a value.'));
    return issues;
  }
  if (!field.present) return issues;
  if (field.typeMismatch) {
    issues.push(issue(field, 'The loaded value does not match this field schema.'));
    return issues;
  }
  if (field.kind === 'null') {
    if (field.value !== null) issues.push(issue(field, 'Value must be null.'));
    return issues;
  }
  if (field.kind === 'json') {
    if (typeof field.value !== 'string') {
      issues.push(issue(field, 'Enter a JSON value.'));
      return issues;
    }
    try {
      const parsed = JSON.parse(field.value);
      if (validateJsonValueBounds(parsed)) issues.push(issue(field, 'Enter a safe, bounded JSON value.'));
    } catch {
      issues.push(issue(field, 'Enter a valid JSON value.'));
    }
    return issues;
  }
  if (field.enumOptions.length > 0) {
    if (field.value === null) {
      if (!field.nullable && !field.enumOptions.some((option) => option.raw === null)) issues.push(issue(field, 'Null is not allowed here.'));
      return issues;
    }
    const option = selectedEnumOption(field);
    if (!option) {
      issues.push(issue(field, 'Choose one of the available values.'));
      return issues;
    }
    if (option.raw === null) return issues;
    if (field.kind === 'number') {
      const value = option.raw;
      if (typeof value !== 'number' || !Number.isFinite(value) || (field.numberType === 'integer' && (!Number.isSafeInteger(value) || !Number.isInteger(value)))) {
        issues.push(issue(field, field.numberType === 'integer' ? 'Enter a whole number.' : 'Enter a finite number.'));
        return issues;
      }
      const min = numeric(field.min);
      const max = numeric(field.max);
      if (min !== undefined && value < min) issues.push(issue(field, `Value must be at least ${min}.`));
      if (max !== undefined && value > max) issues.push(issue(field, `Value must be at most ${max}.`));
      const step = field.step === 'any' ? undefined : numeric(field.step);
      if (step !== undefined && !isAligned(value, min ?? 0, step)) issues.push(issue(field, `Value must align to increments of ${step}.`));
    }
    return issues;
  }

  if (field.value === null) {
    if (!field.nullable) issues.push(issue(field, 'Null is not allowed here.'));
    return issues;
  }

  if (field.kind === 'number') {
    const value = parseStrictNumber(field.value, field.numberType === 'integer');
    if (value === undefined) {
      issues.push(issue(field, field.numberType === 'integer' ? 'Enter a whole number.' : 'Enter a finite number.'));
      return issues;
    }
    const min = numeric(field.min);
    const max = numeric(field.max);
    if (min !== undefined && value < min) issues.push(issue(field, `Value must be at least ${min}.`));
    if (max !== undefined && value > max) issues.push(issue(field, `Value must be at most ${max}.`));
    const step = field.step === 'any' ? undefined : numeric(field.step);
    if (step !== undefined) {
      const base = min ?? 0;
      if (!isAligned(value, base, step)) issues.push(issue(field, `Value must align to increments of ${step}.`));
    }
  } else if (field.kind === 'string' && typeof field.value !== 'string') {
    issues.push(issue(field, 'Enter text.'));
  } else if (field.kind === 'boolean' && typeof field.value !== 'boolean') {
    issues.push(issue(field, 'Choose true or false.'));
  } else if (field.kind === 'object') {
    issues.push(...field.children.flatMap(validateField));
    issues.push(...field.mapEntries.flatMap((entry) => validateField(entry.field)));
  } else if (field.kind === 'array') {
    if (field.entries.length < field.minItems && field.minItems >= 0) issues.push(issue(field, `Add at least ${field.minItems} item${field.minItems === 1 ? '' : 's'}.`));
    if (field.maxItems >= 0 && field.entries.length > field.maxItems) issues.push(issue(field, `Use no more than ${field.maxItems} item${field.maxItems === 1 ? '' : 's'}.`));
    for (const entry of field.entries) {
      if (entry.typeMismatch) issues.push(issue(field, 'An array item does not match this item schema.'));
      else if (entry.nullValue) {
        if (!normalizeSchema(field.itemSchema).nullable) issues.push(issue(field, 'Null is not allowed for an array item.'));
      } else if (entry.valueField) issues.push(...validateField(entry.valueField));
      else issues.push(...entry.fields.flatMap(validateField));
    }
  }
  return issues;
}

/** Validate a raw value against the emitted Java Nodel subset (used by bindings). */
export function validateValueAgainstSchema(value: unknown, schema: NodelJsonSchema | null | undefined, pointer = ''): SchemaValidationIssue[] {
  const normalized = normalizeSchema(schema);
  if (normalized.unsupportedReason) {
    return [{ fieldId: pointer || 'schema', pointer, message: normalized.unsupportedReason }];
  }
  if (normalized.type === 'json' && validateJsonValueBounds(value)) {
    return [rawIssue(pointer, 'Enter a safe, bounded JSON value.')];
  }
  return validateRaw(value, normalized.schema, normalized.type, normalized.nullable, pointer);
}

function validateRaw(value: unknown, schema: NodelJsonSchema, type: string, nullable: boolean, pointer: string): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];
  if (value === null) {
    if (type !== 'null' && !nullable) issues.push(rawIssue(pointer, 'Null is not allowed here.'));
    return issues;
  }
  if (type === 'null') {
    issues.push(rawIssue(pointer, 'Value must be null.'));
    return issues;
  }
  if (type === 'string' && typeof value !== 'string') {
    issues.push(rawIssue(pointer, 'Enter text.'));
    return issues;
  }
  if (type === 'boolean' && typeof value !== 'boolean') {
    issues.push(rawIssue(pointer, 'Choose true or false.'));
    return issues;
  }
  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (type === 'integer' && (!Number.isSafeInteger(value) || !Number.isInteger(value)))) {
      issues.push(rawIssue(pointer, type === 'integer' ? 'Value must be a finite whole number.' : 'Value must be a finite number.'));
      return issues;
    }
    const min = numeric(schema.min);
    const max = numeric(schema.max);
    if (min !== undefined && value < min) issues.push(rawIssue(pointer, `Value must be at least ${min}.`));
    if (max !== undefined && value > max) issues.push(rawIssue(pointer, `Value must be at most ${max}.`));
    const step = schema.step === 'any' ? undefined : numeric(schema.step ?? (type === 'integer' ? 1 : undefined));
    if (step !== undefined && !isAligned(value, min ?? 0, step)) issues.push(rawIssue(pointer, `Value must align to increments of ${step}.`));
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => enumRawKey(candidate) === enumRawKey(value))) {
    issues.push(rawIssue(pointer, 'Choose one of the available values.'));
  }
  if (type === 'object') {
    if (!isRecord(value)) {
      issues.push(rawIssue(pointer, 'Value must be an object.'));
      return issues;
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      const childPointer = `${pointer}/${escapePointer(key)}`;
      if (childSchema.required === true && !hasOwn(value, key)) {
        issues.push({ fieldId: childPointer, pointer: childPointer, message: 'This field is required.' });
      } else if (hasOwn(value, key)) {
        const child = normalizeSchema(childSchema);
        if (child.unsupportedReason) issues.push(rawIssue(childPointer, child.unsupportedReason));
        else issues.push(...validateRaw(value[key], child.schema, child.type, child.nullable, childPointer));
      }
    }
    if (schema.items) {
      const item = normalizeSchema(schema.items);
      if (item.unsupportedReason) issues.push(rawIssue(pointer, item.unsupportedReason));
      else {
        for (const [key, child] of Object.entries(value)) {
          if (!hasOwn(schema.properties ?? {}, key)) issues.push(...validateRaw(child, item.schema, item.type, item.nullable, `${pointer}/${escapePointer(key)}`));
        }
      }
    }
  }
  if (type === 'array') {
    if (!Array.isArray(value)) {
      issues.push(rawIssue(pointer, 'Value must be an array.'));
      return issues;
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push(rawIssue(pointer, `Add at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}.`));
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push(rawIssue(pointer, `Use no more than ${schema.maxItems} item${schema.maxItems === 1 ? '' : 's'}.`));
    if (schema.items) {
      const item = normalizeSchema(schema.items);
      if (item.unsupportedReason) issues.push(rawIssue(pointer, item.unsupportedReason));
      else value.forEach((child, index) => issues.push(...validateRaw(child, item.schema, item.type, item.nullable, `${pointer}/${index}`)));
    }
  }
  return issues;
}

function issue(field: SchemaField, message: string): SchemaValidationIssue {
  return { fieldId: field.id, pointer: field.pointer, message };
}

function rawIssue(pointer: string, message: string): SchemaValidationIssue {
  return { fieldId: pointer || 'schema', pointer, message };
}

function numeric(value: number | string | undefined) {
  if (value === undefined || value === '') return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function isAligned(value: number, base: number, step: number) {
  if (!Number.isFinite(step) || step <= 0) return false;
  const quotient = (value - base) / step;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8;
  return Math.abs(quotient - Math.round(quotient)) <= tolerance;
}

function escapePointer(value: string) {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}
