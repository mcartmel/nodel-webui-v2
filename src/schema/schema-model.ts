import type { NodelJsonSchema } from '../api/nodel-types';
import { hasOwn, isRecord, setOwn } from '../utils/records';

export type SchemaFieldKind = 'null' | 'string' | 'number' | 'boolean' | 'object' | 'array';
export type SchemaPresenceState = 'missing' | 'null' | 'value';

export interface SchemaEnumOption {
  label: string;
  /** Stable DOM value. It is never the stringified raw value. */
  value: string;
  raw: unknown;
}

export interface SchemaMapEntry {
  id: string;
  key: string;
  field: SchemaField;
}

export interface SchemaArrayEntry {
  id: string;
  index: number;
  canRemove: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  fields: SchemaField[];
  valueField: SchemaField | null;
  unknownProperties: Record<string, unknown>;
  nullValue: boolean;
  nullable: boolean;
  typeMismatch: boolean;
}

export interface SchemaField {
  id: string;
  controlId: string;
  errorId: string;
  /** Original JSON property name. */
  key: string;
  /** JSON pointer used to construct this field's deterministic identity. */
  pointer: string;
  label: string;
  description: string;
  hint: string;
  kind: SchemaFieldKind;
  inputType: string;
  format: string;
  numberType: 'number' | 'integer' | '';
  advanced: boolean;
  value: unknown;
  concreteValue: unknown;
  present: boolean;
  allowMissing: boolean;
  presenceState: SchemaPresenceState;
  dirty: boolean;
  nullable: boolean;
  required: boolean;
  enumOptions: SchemaEnumOption[];
  children: SchemaField[];
  entries: SchemaArrayEntry[];
  mapEntries: SchemaMapEntry[];
  itemSchema: NodelJsonSchema;
  mapItemSchema: NodelJsonSchema | null;
  rootObjectGroup: boolean;
  open: boolean;
  min: number | string;
  max: number | string;
  step: number | string;
  minItems: number;
  maxItems: number;
  errors: string[];
  unsupported: boolean;
  unsupportedReason: string;
  unknownProperties: Record<string, unknown>;
  typeMismatch: boolean;
  /** Parent references are model-only and make presence propagation DOM-independent. */
  parent?: SchemaField;
  nextEntryOrdinal: number;
}

export interface SchemaFormModel {
  id: string;
  fields: SchemaField[];
  hasFields: boolean;
  controlsDisabled: boolean;
  unsupported: boolean;
  unsupportedReason: string;
  invalid: boolean;
  validationIssues: SchemaValidationIssue[];
  /** Complete value loaded from the endpoint, including fields not described by the schema. */
  sourceValue: unknown;
  dirty: boolean;
  rootObject: boolean;
  rootPresent: boolean;
  rootTypeMismatch: boolean;
}

export interface SchemaValidationIssue {
  fieldId: string;
  pointer: string;
  message: string;
}

export interface SchemaNormalization {
  schema: NodelJsonSchema;
  type: string;
  nullable: boolean;
  unsupportedReason: string;
}

const emptySchema: NodelJsonSchema = { type: 'null' };
const supportedTypes = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);
const scalarTypes = new Set(['null', 'string', 'number', 'integer', 'boolean']);
/** Java Nodel's bounded schema dialect, not generic JSON Schema. */
const schemaDialectKeywords = new Set([
  'type', 'title', 'desc', 'hint', 'caution', 'format', 'group', 'enum', 'properties', 'items',
  'order', 'required', 'advanced', 'min', 'max', 'step', 'minItems', 'maxItems'
]);

export function normalizeSchema(input: NodelJsonSchema | null | undefined): SchemaNormalization {
  if (input === null || input === undefined) {
    return { schema: emptySchema, type: 'null', nullable: false, unsupportedReason: '' };
  }
  if (!isRecord(input)) {
    return unsupportedNormalization('Schema must be an object.');
  }
  const unsupportedKeyword = Object.keys(input).find((key) => !schemaDialectKeywords.has(key));
  if (unsupportedKeyword) {
    return unsupportedNormalization(`Schema keyword "${unsupportedKeyword}" is not supported by the Nodel form dialect.`);
  }

  const type = input.type;
  if (Array.isArray(type)) {
    if (type.length === 0 || type.some((variant) => !isRecord(variant))) {
      return unsupportedNormalization('Schema variants must be non-empty schema objects.');
    }
    const variants = type.map((variant) => normalizeSchema(variant as NodelJsonSchema));
    const unsupported = variants.find((variant) => variant.unsupportedReason);
    if (unsupported) {
      return unsupportedNormalization(unsupported.unsupportedReason);
    }
    const concrete = variants.filter((variant) => variant.type !== 'null');
    if (concrete.length > 1) {
      return unsupportedNormalization('Multiple concrete schema variants are not supported.');
    }
    if (concrete.length === 0) {
      return { schema: { ...input, type: 'null' }, type: 'null', nullable: false, unsupportedReason: '' };
    }
    const selected = concrete[0];
    const nullable = variants.some((variant) => variant.type === 'null');
    const merged = { ...input, ...selected.schema, type: selected.type } as NodelJsonSchema;
    delete (merged as { type?: unknown }).type;
    merged.type = selected.type;
    const checked = normalizeConcrete(merged, selected.type);
    return checked.unsupportedReason ? checked : { ...checked, nullable };
  }

  if (type !== undefined && type !== null && typeof type !== 'string') {
    return unsupportedNormalization('Schema type must be a scalar type or an array of schema objects.');
  }
  if (typeof type === 'string' && !supportedTypes.has(type)) {
    return unsupportedNormalization(`Schema type "${type}" is not supported by the Nodel form dialect.`);
  }

  const inferredType = typeof type === 'string'
    ? type
    : input.properties !== undefined
      ? 'object'
      : input.items !== undefined
        ? 'array'
        : type === null
          ? 'null'
          : '';
  if (!inferredType) {
    return unsupportedNormalization('Schema has no supported type.');
  }
  return normalizeConcrete({ ...input, type: inferredType }, inferredType);
}

function normalizeConcrete(schema: NodelJsonSchema, type: string): SchemaNormalization {
  const unsupportedKeyword = Object.keys(schema).find((key) => !schemaDialectKeywords.has(key));
  if (unsupportedKeyword) {
    return unsupportedNormalization(`Schema keyword "${unsupportedKeyword}" is not supported by the Nodel form dialect.`);
  }
  const metadataError = validateMetadata(schema);
  if (metadataError) {
    return unsupportedNormalization(metadataError);
  }
  if (type === 'null' && (schema.properties !== undefined || schema.items !== undefined || schema.enum !== undefined || schema.min !== undefined || schema.max !== undefined || schema.step !== undefined || schema.minItems !== undefined || schema.maxItems !== undefined)) {
    return unsupportedNormalization('Null schemas cannot declare value constraints or child schemas.');
  }
  if (type === 'array' && !isRecord(schema.items)) {
    return unsupportedNormalization('Array schemas must declare an items schema.');
  }
  if (type === 'object' && schema.properties !== undefined && !isRecord(schema.properties)) {
    return unsupportedNormalization('Object properties must be a map of schema objects.');
  }
  if (schema.items !== undefined && !isRecord(schema.items)) {
    return unsupportedNormalization('Schema items must be a schema object.');
  }
  if (scalarTypes.has(type) && type !== 'null' && (schema.properties !== undefined || schema.items !== undefined || schema.minItems !== undefined || schema.maxItems !== undefined)) {
    return unsupportedNormalization('Scalar schemas cannot declare child schemas or item-count constraints.');
  }
  if (type === 'array' && schema.properties !== undefined) {
    return unsupportedNormalization('Array schemas cannot declare object properties.');
  }
  if (type === 'object' && schema.properties !== undefined && schema.items !== undefined) {
    return unsupportedNormalization('Object schemas must declare properties or map items, not both.');
  }
  if (!scalarTypes.has(type) && schema.enum !== undefined) {
    return unsupportedNormalization('Enum values are supported only for scalar schemas.');
  }
  if (schema.properties) {
    for (const child of Object.values(schema.properties)) {
      if (!isRecord(child)) {
        return unsupportedNormalization('Object properties must contain schema objects.');
      }
      const normalized = normalizeSchema(child);
      if (normalized.unsupportedReason) {
        return unsupportedNormalization(normalized.unsupportedReason);
      }
    }
  }
  if (schema.items) {
    const normalized = normalizeSchema(schema.items);
    if (normalized.unsupportedReason) {
      return unsupportedNormalization(normalized.unsupportedReason);
    }
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.some((value) => !isSupportedEnumValue(value))) {
      return unsupportedNormalization('Enum values must be JSON scalar values.');
    }
  }
  if ((type === 'number' || type === 'integer') && schema.enum) {
    if (schema.enum.some((value) => !enumValueMatchesType(value, type))) {
      return unsupportedNormalization('Enum values do not match the declared numeric type.');
    }
  }
  if (type !== 'number' && type !== 'integer' && (schema.min !== undefined || schema.max !== undefined || schema.step !== undefined)) {
    return unsupportedNormalization('Numeric constraints require a number or integer schema.');
  }
  if (type !== 'array' && (schema.minItems !== undefined || schema.maxItems !== undefined)) {
    return unsupportedNormalization('Item-count constraints require an array schema.');
  }
  if (schema.min !== undefined && schema.max !== undefined && Number(schema.min) > Number(schema.max)) {
    return unsupportedNormalization('Schema minimum cannot exceed maximum.');
  }
  if (schema.minItems !== undefined && schema.maxItems !== undefined && schema.minItems > schema.maxItems) {
    return unsupportedNormalization('Schema minItems cannot exceed maxItems.');
  }
  return { schema, type, nullable: false, unsupportedReason: '' };
}

function validateMetadata(schema: NodelJsonSchema) {
  for (const key of ['title', 'desc', 'hint', 'caution', 'format', 'group'] as const) {
    if (schema[key] !== undefined && typeof schema[key] !== 'string') {
      return `${key} must be a string.`;
    }
  }
  for (const key of ['order', 'min', 'max'] as const) {
    if (schema[key] !== undefined && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) {
      return `${key} must be a finite number.`;
    }
  }
  if (schema.step !== undefined) {
    const step = schema.step;
    if (step !== 'any' && (typeof step !== 'number' && typeof step !== 'string')) {
      return 'step must be a positive number or "any".';
    }
    if (step !== 'any' && (typeof step === 'number' && (!Number.isFinite(step) || step <= 0))) {
      return 'step must be positive.';
    }
    if (typeof step === 'string' && step !== 'any' && (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?$/.test(step) || !Number.isFinite(Number(step)) || Number(step) <= 0)) {
      return 'step must be a positive number or "any".';
    }
  }
  for (const key of ['minItems', 'maxItems'] as const) {
    const value = schema[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) {
      return `${key} must be a non-negative safe integer.`;
    }
  }
  if (schema.required !== undefined && typeof schema.required !== 'boolean') {
    return 'required must be boolean.';
  }
  if (schema.advanced !== undefined && typeof schema.advanced !== 'boolean') {
    return 'advanced must be boolean.';
  }
  return '';
}

function unsupportedNormalization(reason: string): SchemaNormalization {
  return {
    schema: emptySchema,
    type: 'unsupported',
    nullable: false,
    unsupportedReason: reason.slice(0, 180)
  };
}

export function createSchemaForm(schema: NodelJsonSchema | null | undefined, options: { idPrefix?: string; hideRootKeyLabels?: boolean; controlsDisabled?: boolean; initialPresent?: boolean } = {}): SchemaFormModel {
  const normalized = normalizeSchema(schema);
  const id = formId(options.idPrefix ?? 'schema');
  const form: SchemaFormModel = {
    id,
    fields: [],
    hasFields: false,
    controlsDisabled: Boolean(options.controlsDisabled) || Boolean(normalized.unsupportedReason),
    unsupported: Boolean(normalized.unsupportedReason),
    unsupportedReason: normalized.unsupportedReason,
    invalid: Boolean(normalized.unsupportedReason),
    validationIssues: normalized.unsupportedReason ? [{ fieldId: id, pointer: '', message: normalized.unsupportedReason }] : [],
    sourceValue: undefined,
    dirty: false,
    rootObject: normalized.type === 'object',
    rootPresent: false,
    rootTypeMismatch: false
  };

  if (!normalized.unsupportedReason) {
    if (normalized.type === 'object') {
      form.fields = orderedProperties(normalized.schema).map(([key, childSchema]) => buildField(key, childSchema, {
        form,
        hideKeyLabel: options.hideRootKeyLabels,
        inObject: false,
        path: `/${escapePointerSegment(key)}`
      }));
    } else {
      form.fields = [buildField('value', normalized.schema, {
        form,
        hideKeyLabel: options.hideRootKeyLabels,
        inObject: false,
        path: '',
        normalization: normalized
      })];
    }
  }
  if (options.initialPresent && form.fields.length === 1) {
    form.fields[0].present = true;
    form.fields[0].presenceState = 'value';
  }
  form.hasFields = form.fields.some((field) => field.kind !== 'null' || field.present);
  if (form.fields.some(containsUnsupported)) {
    form.fields = [];
    form.hasFields = false;
    form.unsupported = true;
    form.controlsDisabled = true;
    form.unsupportedReason = 'The schema contains an unsupported field definition.';
    form.invalid = true;
    form.validationIssues = [{ fieldId: form.id, pointer: '', message: form.unsupportedReason }];
  }
  attachSchemaFormContext(form);
  return form;
}

interface FieldBuildOptions {
  form: SchemaFormModel;
  arrayItem?: boolean;
  hideKeyLabel?: boolean;
  inObject?: boolean;
  path: string;
  parent?: SchemaField;
  entryBaseId?: string;
  allowMissing?: boolean;
  normalization?: SchemaNormalization;
}

function buildField(key: string, input: NodelJsonSchema | null | undefined, options: FieldBuildOptions): SchemaField {
  const normalized = options.normalization ?? normalizeSchema(input);
  const kind = fieldKind(normalized.type);
  const schema = normalized.schema;
  const format = typeof schema.format === 'string' ? schema.format : '';
  const required = schema.required === true;
  const allowMissing = options.allowMissing ?? !required;
  const field: SchemaField = {
    id: fieldId(options.form.id, options.path, options.entryBaseId),
    controlId: '',
    errorId: '',
    key,
    pointer: options.path,
    label: labelFor(key, schema, options),
    description: typeof schema.desc === 'string' ? schema.desc : '',
    hint: typeof schema.hint === 'string' ? schema.hint : '',
    kind,
    inputType: inputTypeFor(kind, format),
    format,
    numberType: normalized.type === 'integer' ? 'integer' : kind === 'number' ? 'number' : '',
    advanced: schema.advanced === true,
    value: initialValueFor(kind),
    concreteValue: initialValueFor(kind),
    present: false,
    allowMissing,
    presenceState: allowMissing ? 'missing' : 'value',
    dirty: false,
    nullable: normalized.nullable,
    required,
    enumOptions: enumOptionsFor(schema),
    children: [],
    entries: [],
    mapEntries: [],
    itemSchema: isRecord(schema.items) ? schema.items : emptySchema,
    mapItemSchema: kind === 'object' && isRecord(schema.items) ? schema.items : null,
    rootObjectGroup: kind === 'object' && Boolean(options.hideKeyLabel) && !options.inObject && !options.arrayItem,
    open: false,
    min: numericConstraint(schema.min),
    max: numericConstraint(schema.max),
    step: stepFor(normalized.type, schema.step),
    minItems: typeof schema.minItems === 'number' ? schema.minItems : -1,
    maxItems: typeof schema.maxItems === 'number' ? schema.maxItems : -1,
    errors: [],
    unsupported: Boolean(normalized.unsupportedReason),
    unsupportedReason: normalized.unsupportedReason,
    unknownProperties: {},
    typeMismatch: false,
    parent: options.parent,
    nextEntryOrdinal: 0
  };
  field.controlId = `${field.id}-input`;
  field.errorId = `${field.id}-error`;

  if (kind === 'object') {
    field.children = orderedProperties(schema).map(([childKey, childSchema]) => buildField(childKey, childSchema, {
      ...options,
      form: options.form,
      inObject: true,
      path: `${options.path}/${escapePointerSegment(childKey)}`,
      parent: field,
      entryBaseId: undefined
    }));
  }
  return field;
}

export function buildArrayEntry(field: SchemaField, value: unknown, index: number, ordinal = field.nextEntryOrdinal++, entryId?: string): SchemaArrayEntry {
  const itemSchema = field.itemSchema;
  const normalized = normalizeSchema(itemSchema);
  const id = entryId ?? `${field.id}-e-${ordinal}`;
  const isNew = value === undefined;
  const unknownProperties: Record<string, unknown> = {};
  if (isRecord(value) && normalized.type === 'object') {
    for (const key of Object.keys(value)) {
      if (!hasOwn(normalized.schema.properties ?? {}, key)) {
        setOwn(unknownProperties, key, value[key]);
      }
    }
  }

  if (normalized.type === 'object') {
    if (value === null && !normalized.nullable) {
      return { id, index, canRemove: true, canMoveUp: index > 0, canMoveDown: false, fields: [], valueField: null, unknownProperties, nullValue: true, nullable: false, typeMismatch: false };
    }
    const fields = orderedProperties(normalized.schema).map(([key, schema]) => buildField(key, schema, {
      form: formForField(field),
      arrayItem: true,
      inObject: true,
      path: `${field.pointer}/${index}/${escapePointerSegment(key)}`,
      parent: field,
      entryBaseId: id
    }));
    return { id, index, canRemove: true, canMoveUp: index > 0, canMoveDown: false, fields, valueField: null, unknownProperties, nullValue: value === null, nullable: normalized.nullable, typeMismatch: value !== undefined && value !== null && !isRecord(value) };
  }

  const valueField = buildField('value', itemSchema, {
    form: formForField(field),
    arrayItem: true,
    hideKeyLabel: true,
    inObject: false,
    path: `${field.pointer}/${index}`,
    parent: field,
    allowMissing: false,
    entryBaseId: id
  });
  if (isNew) {
    valueField.present = true;
  }
  return { id, index, canRemove: true, canMoveUp: index > 0, canMoveDown: false, fields: [], valueField, unknownProperties, nullValue: false, nullable: false, typeMismatch: false };
}

export function buildMapEntry(field: SchemaField, key: string): SchemaMapEntry {
  const itemSchema = field.mapItemSchema ?? emptySchema;
  const id = `${field.id}-m-${pointerId(key)}`;
  const child = buildField(key, itemSchema, {
    form: formForField(field),
    inObject: true,
    path: `${field.pointer}/${escapePointerSegment(key)}`,
    parent: field,
    entryBaseId: id
  });
  return { id, key, field: child };
}

function formForField(field: SchemaField): SchemaFormModel {
  // The form is attached non-enumerably to every root field by createSchemaForm.
  return (field as SchemaField & { form?: SchemaFormModel }).form!;
}

function containsUnsupported(field: SchemaField): boolean {
  return field.unsupported || field.children.some(containsUnsupported) || field.entries.some((entry) => entry.fields.some(containsUnsupported) || Boolean(entry.valueField && containsUnsupported(entry.valueField))) || field.mapEntries.some((entry) => containsUnsupported(entry.field));
}

function fieldKind(type: string): SchemaFieldKind {
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'boolean' || type === 'object' || type === 'array' || type === 'string') return type;
  return 'null';
}

function orderedProperties(schema: NodelJsonSchema): Array<[string, NodelJsonSchema]> {
  return Object.entries(schema.properties ?? {}).sort(([, left], [, right]) => orderOf(left) - orderOf(right));
}

function orderOf(schema: NodelJsonSchema) {
  return typeof schema.order === 'number' ? schema.order : 0;
}

function labelFor(key: string, schema: NodelJsonSchema, options: FieldBuildOptions) {
  if (typeof schema.title === 'string' && schema.title.trim()) return schema.title;
  if (options.hideKeyLabel && !options.inObject && !options.arrayItem) return '';
  return key === 'value' && options.hideKeyLabel ? '' : key;
}

function inputTypeFor(kind: SchemaFieldKind, format: string) {
  if (kind === 'number') return format === 'range' ? 'range' : 'number';
  if (kind === 'string' && ['date', 'time', 'password', 'color'].includes(format)) return format;
  return 'text';
}

function initialValueFor(kind: SchemaFieldKind) {
  if (kind === 'boolean') return false;
  if (kind === 'null') return null;
  return '';
}

function enumOptionsFor(schema: NodelJsonSchema): SchemaEnumOption[] {
  if (!Array.isArray(schema.enum)) return [];
  const labels = schema.enum.map((raw) => String(raw));
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return schema.enum.map((raw, index) => ({
    label: raw === null ? 'null' : String(raw),
    value: labels[index] !== '' && counts.get(labels[index]) === 1
      ? labels[index]
      : `enum-${encodeURIComponent(enumRawKey(raw))}-${index}`,
    raw
  }));
}

export function enumRawKey(value: unknown) {
  if (value === null) return 'null';
  if (typeof value === 'number') return `number:${Object.is(value, -0) ? '-0' : String(value)}`;
  if (typeof value === 'string') return `string:${value}`;
  if (typeof value === 'boolean') return `boolean:${String(value)}`;
  return `json:${JSON.stringify(value)}`;
}

function numericConstraint(value: unknown): number | string {
  return typeof value === 'number' || typeof value === 'string' ? value : '';
}

function stepFor(type: string, step: unknown): number | string {
  if (typeof step === 'number' || typeof step === 'string') return step;
  return type === 'integer' ? 1 : 'any';
}

function formId(prefix: string) {
  return `nodel-schema-${slug(prefix)}-${hashString(prefix)}`;
}

function fieldId(form: string, pointer: string, entryBaseId?: string) {
  return `${entryBaseId ?? form}-field-${pointerId(pointer)}`;
}

function pointerId(pointer: string) {
  return [...pointer].map((character) => character.codePointAt(0)!.toString(16)).join('_') || 'root';
}

function slug(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'schema';
}

function hashString(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function escapePointerSegment(value: string) {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function isSupportedEnumValue(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

function enumValueMatchesType(value: unknown, type: string) {
  return typeof value === 'number' && Number.isFinite(value) && (type !== 'integer' || Number.isSafeInteger(value));
}

/** Attach the form context without making the public model cyclic during JSON/debug serialization. */
export function attachSchemaFormContext(form: SchemaFormModel) {
  const attach = (field: SchemaField) => {
    Object.defineProperty(field, 'form', { value: form, writable: true, configurable: true });
    field.children.forEach(attach);
    field.entries.forEach((entry) => {
      entry.fields.forEach(attach);
      if (entry.valueField) attach(entry.valueField);
    });
    field.mapEntries.forEach((entry) => attach(entry.field));
  };
  form.fields.forEach(attach);
  return form;
}
