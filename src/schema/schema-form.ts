import type { NodelJsonSchema } from '../api/nodel-types';
import { renderFontAwesomeIcon, uiIcons } from '../icons/fontawesome';
import { getJQuery } from '../jsviews/jsviews-runtime';

export type SchemaFieldKind = 'null' | 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface SchemaEnumOption {
  label: string;
  value: string;
  raw: unknown;
}

export interface SchemaArrayEntry {
  id: string;
  index: number;
  fields: SchemaField[];
  valueField: SchemaField | null;
}

export interface SchemaField {
  id: string;
  key: string;
  label: string;
  description: string;
  hint: string;
  kind: SchemaFieldKind;
  inputType: string;
  format: string;
  numberType: 'number' | 'integer' | '';
  value: unknown;
  enumOptions: SchemaEnumOption[];
  children: SchemaField[];
  entries: SchemaArrayEntry[];
  itemSchema: NodelJsonSchema;
  open: boolean;
  min: number | string;
  max: number | string;
  step: number | string;
  minItems: number;
  maxItems: number;
}

export interface SchemaFormModel {
  id: string;
  fields: SchemaField[];
  hasFields: boolean;
}

interface FieldBuildOptions {
  arrayItem?: boolean;
  hideKeyLabel?: boolean;
  inObject?: boolean;
  path: string;
}

const emptySchema: NodelJsonSchema = { type: 'null' };
let registered = false;
let nextId = 0;
const collapseIconMarkup = renderFontAwesomeIcon(uiIcons.chevronDown, 'h-3 w-3');
const chevronUpIconMarkup = renderFontAwesomeIcon(uiIcons.chevronUp, 'h-3 w-3');
const chevronDownIconMarkup = renderFontAwesomeIcon(uiIcons.chevronDown, 'h-3 w-3');

const schemaFieldTemplate = `
  <div class="nodel-schema-field" data-link="data-schema-field-id{:id} data-schema-kind{:kind}">
    {^{if kind === 'null'}}
      <div class="nodel-schema-empty" hidden></div>
    {{else kind === 'object'}}
      <details class="nodel-schema-nested nodel-collapse nodel-card" data-link="open{:open}">
        <summary class="nodel-schema-nested-summary">
          <span>{^{>label || 'Details'}}</span>
          {^{if description}}<small>{^{>description}}</small>{{/if}}
          <span class="nodel-collapse-icon" aria-hidden="true">${collapseIconMarkup}</span>
        </summary>
        {^{if open}}
          <div class="nodel-schema-nested-content">
            {^{for children tmpl="nodelSchemaField"/}}
          </div>
        {{/if}}
      </details>
    {{else kind === 'array'}}
      <details class="nodel-schema-nested nodel-collapse nodel-card" data-link="open{:open}">
        <summary class="nodel-schema-nested-summary">
          <span>{^{>label || 'Items'}}</span>
          {^{if description}}<small>{^{>description}}</small>{{/if}}
          <span class="nodel-collapse-icon" aria-hidden="true">${collapseIconMarkup}</span>
        </summary>
        {^{if open}}
          <div class="nodel-schema-nested-content space-y-3">
            {^{for entries}}
              <div class="nodel-schema-array-entry nodel-card p-3" data-link="data-schema-array-entry{:id}">
                <div class="mb-3 flex items-center justify-between gap-2">
                  <span class="nodel-section-heading">Item {^{:index + 1}}</span>
                  <span class="inline-flex gap-1">
                    <button type="button" class="nodel-button nodel-button-compact" data-schema-array-move="up" title="Move up">${chevronUpIconMarkup}<span class="sr-only">Move up</span></button>
                    <button type="button" class="nodel-button nodel-button-compact nodel-button-danger" data-schema-array-remove title="Remove">Remove</button>
                    <button type="button" class="nodel-button nodel-button-compact" data-schema-array-move="down" title="Move down">${chevronDownIconMarkup}<span class="sr-only">Move down</span></button>
                  </span>
                </div>
                {^{if valueField}}
                  {{include valueField tmpl="nodelSchemaField"/}}
                {{else}}
                  {^{for fields tmpl="nodelSchemaField"/}}
                {{/if}}
              </div>
            {{/for}}
            <button type="button" class="nodel-button" data-schema-array-add data-link="disabled{:maxItems >= 0 && entries.length >= maxItems}">Add</button>
          </div>
        {{/if}}
      </details>
    {{else kind === 'boolean'}}
      <label class="nodel-schema-check inline-flex min-w-0 items-start gap-2 text-sm text-nodel-fg">
        <input type="checkbox" data-link="value" />
        <span class="min-w-0">
          {^{if label}}<span class="block font-medium">{^{>label}}</span>{{/if}}
          {^{if description}}<small class="block text-nodel-muted">{^{>description}}</small>{{/if}}
        </span>
      </label>
    {{else}}
      <label class="block min-w-0 text-sm text-nodel-fg">
        {^{if label}}<span class="mb-1 block font-medium">{^{>label}}</span>{{/if}}
        {^{if description}}<small class="mb-1 block text-nodel-muted">{^{>description}}</small>{{/if}}
        {^{if enumOptions.length}}
          <select class="nodel-field w-full" data-link="{:value:} trigger=true; title{:description}">
            <option value=""></option>
            {^{for enumOptions}}
              <option value="{{:value}}">{^{>label}}</option>
            {{/for}}
          </select>
        {{else format === 'long'}}
          <textarea class="nodel-field min-h-24 w-full" data-link="{:value:} trigger=true; placeholder{:hint}; title{:description}"></textarea>
        {{else kind === 'number'}}
          <input class="nodel-field w-full" data-link="{:value:} trigger=true; type{:inputType}; placeholder{:hint}; title{:description}; min{:min}; max{:max}; step{:step}" />
          {^{if inputType === 'range'}}<output class="mt-1 block text-xs text-nodel-muted">{^{>value}}</output>{{/if}}
        {{else}}
          <input class="nodel-field w-full" data-link="{:value:} trigger=true; type{:inputType}; placeholder{:hint}; title{:description}" />
        {{/if}}
      </label>
    {{/if}}
  </div>
`;

export const schemaFormTemplate = `
  <div class="nodel-schema-form space-y-3">
    {^{for fields tmpl="nodelSchemaField"/}}
  </div>
`;

export function registerSchemaFormTemplates() {
  if (registered) {
    return;
  }

  getJQuery().templates('nodelSchemaForm', schemaFormTemplate);
  getJQuery().templates('nodelSchemaField', schemaFieldTemplate);
  registered = true;
}

export function createSchemaForm(schema: NodelJsonSchema | null | undefined, options: { idPrefix?: string; hideRootKeyLabels?: boolean } = {}): SchemaFormModel {
  const normalizedSchema = normalizeSchema(schema);
  const idPrefix = options.idPrefix ?? 'schema';
  const form: SchemaFormModel = {
    id: nextFieldId(idPrefix),
    fields: [],
    hasFields: false
  };

  if (schemaType(normalizedSchema) === 'object' && normalizedSchema.properties) {
    form.fields = orderedProperties(normalizedSchema).map(([key, childSchema]) => buildField(key, childSchema, {
      hideKeyLabel: options.hideRootKeyLabels,
      inObject: false,
      path: key
    }));
  } else {
    form.fields = [buildField('value', normalizedSchema, {
      hideKeyLabel: options.hideRootKeyLabels,
      inObject: false,
      path: 'value'
    })];
  }

  form.hasFields = form.fields.some((field) => field.kind !== 'null');
  return form;
}

export function hydrateSchemaForm(form: SchemaFormModel, value: Record<string, unknown>) {
  for (const field of form.fields) {
    hydrateSchemaField(field, value[field.key]);
  }
}

export function serializeSchemaForm(form: SchemaFormModel) {
  const payload: Record<string, unknown> = {};
  for (const field of form.fields) {
    const value = serializeSchemaField(field);
    if (value !== undefined) {
      payload[field.key] = value;
    }
  }

  return cleanPayload(payload) ?? {};
}

export function hydrateSchemaField(field: SchemaField, value: unknown) {
  const $ = getJQuery();

  if (field.kind === 'object') {
    const objectValue = isRecord(value) ? value : {};
    for (const child of field.children) {
      hydrateSchemaField(child, objectValue[child.key]);
    }
    return;
  }

  if (field.kind === 'array') {
    const arrayValue = Array.isArray(value) ? value : [];
    const nextEntries = arrayValue.map((item, index) => buildArrayEntry(field, item, index));
    ($.observable(field.entries) as any).refresh(nextEntries);
    return;
  }

  if (field.kind === 'number') {
    $.observable(field).setProperty('value', value === undefined || value === null ? '' : String(value));
    return;
  }

  if (field.enumOptions.length > 0) {
    const matched = field.enumOptions.find((option) => Object.is(option.raw, value) || option.value === String(value ?? ''));
    $.observable(field).setProperty('value', matched?.value ?? '');
    return;
  }

  $.observable(field).setProperty('value', value ?? (field.kind === 'boolean' ? false : ''));
}

export function serializeSchemaField(field: SchemaField): unknown {
  if (field.kind === 'null') {
    return undefined;
  }

  if (field.kind === 'object') {
    const objectValue: Record<string, unknown> = {};
    for (const child of field.children) {
      const childValue = serializeSchemaField(child);
      if (childValue !== undefined) {
        objectValue[child.key] = childValue;
      }
    }
    return cleanPayload(objectValue);
  }

  if (field.kind === 'array') {
    const values = field.entries.map((entry) => {
      if (entry.valueField) {
        return serializeSchemaField(entry.valueField);
      }

      const objectValue: Record<string, unknown> = {};
      for (const child of entry.fields) {
        const childValue = serializeSchemaField(child);
        if (childValue !== undefined) {
          objectValue[child.key] = childValue;
        }
      }
      return cleanPayload(objectValue);
    });
    return cleanPayload(values);
  }

  if (field.enumOptions.length > 0) {
    return field.enumOptions.find((option) => option.value === field.value)?.raw ?? field.value;
  }

  if (field.kind === 'boolean') {
    return Boolean(field.value);
  }

  if (field.kind === 'number') {
    if (field.value === '' || field.value === undefined || field.value === null) {
      return undefined;
    }
    const parsed = field.numberType === 'integer' ? parseInt(String(field.value), 10) : parseFloat(String(field.value));
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return field.value;
}

export function findSchemaField(fields: SchemaField[], id: string): SchemaField | null {
  for (const field of fields) {
    if (field.id === id) {
      return field;
    }

    const child = findSchemaField(field.children, id);
    if (child) {
      return child;
    }

    for (const entry of field.entries) {
      if (entry.valueField?.id === id) {
        return entry.valueField;
      }

      const entryChild = findSchemaField(entry.fields, id);
      if (entryChild) {
        return entryChild;
      }
    }
  }

  return null;
}

export function addArrayEntry(field: SchemaField) {
  if (field.kind !== 'array' || (field.maxItems >= 0 && field.entries.length >= field.maxItems)) {
    return;
  }

  const $ = getJQuery();
  const nextEntries = [...field.entries, buildArrayEntry(field, undefined, field.entries.length)];
  ($.observable(field.entries) as any).refresh(syncArrayEntryIndexes(nextEntries));
}

export function removeArrayEntry(field: SchemaField, entryId: string) {
  if (field.kind !== 'array') {
    return;
  }

  const $ = getJQuery();
  const nextEntries = field.entries.filter((entry) => entry.id !== entryId);
  ($.observable(field.entries) as any).refresh(syncArrayEntryIndexes(nextEntries));
}

export function moveArrayEntry(field: SchemaField, entryId: string, direction: 'up' | 'down') {
  if (field.kind !== 'array') {
    return;
  }

  const index = field.entries.findIndex((entry) => entry.id === entryId);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= field.entries.length) {
    return;
  }

  const $ = getJQuery();
  const nextEntries = [...field.entries];
  const [entry] = nextEntries.splice(index, 1);
  nextEntries.splice(targetIndex, 0, entry);
  ($.observable(field.entries) as any).refresh(syncArrayEntryIndexes(nextEntries));
}

export function cleanPayload(value: unknown): unknown {
  if (value === '' || value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const arrayValue = value.map(cleanPayload).filter((item) => item !== undefined);
    return arrayValue.length > 0 ? arrayValue : undefined;
  }

  if (isRecord(value)) {
    const objectValue: Record<string, unknown> = {};
    for (const [key, childValue] of Object.entries(value)) {
      const cleanValue = cleanPayload(childValue);
      if (cleanValue !== undefined) {
        objectValue[key] = cleanValue;
      }
    }
    return Object.keys(objectValue).length > 0 ? objectValue : undefined;
  }

  return value;
}

function buildField(key: string, schema: NodelJsonSchema | null | undefined, options: FieldBuildOptions): SchemaField {
  const normalizedSchema = normalizeSchema(schema);
  const type = schemaType(normalizedSchema);
  const kind = fieldKind(type);
  const format = typeof normalizedSchema.format === 'string' ? normalizedSchema.format : '';
  const label = labelFor(key, normalizedSchema, options);
  const field: SchemaField = {
    id: nextFieldId(options.path),
    key,
    label,
    description: typeof normalizedSchema.desc === 'string' ? normalizedSchema.desc : '',
    hint: typeof normalizedSchema.hint === 'string' ? normalizedSchema.hint : '',
    kind,
    inputType: inputTypeFor(kind, format),
    format,
    numberType: type === 'integer' ? 'integer' : kind === 'number' ? 'number' : '',
    value: initialValueFor(kind),
    enumOptions: enumOptionsFor(normalizedSchema),
    children: [],
    entries: [],
    itemSchema: normalizeSchema(isRecord(normalizedSchema.items) ? normalizedSchema.items as NodelJsonSchema : emptySchema),
    open: false,
    min: numericConstraint(normalizedSchema.min),
    max: numericConstraint(normalizedSchema.max),
    step: stepFor(type, normalizedSchema.step),
    minItems: typeof normalizedSchema.minItems === 'number' ? normalizedSchema.minItems : -1,
    maxItems: typeof normalizedSchema.maxItems === 'number' ? normalizedSchema.maxItems : -1
  };

  if (kind === 'object') {
    field.children = orderedProperties(normalizedSchema).map(([childKey, childSchema]) => buildField(childKey, childSchema, {
      inObject: true,
      path: `${options.path}.${childKey}`
    }));
  }

  if (kind === 'array' && field.minItems > 0) {
    field.entries = Array.from({ length: field.minItems }, (_, index) => buildArrayEntry(field, undefined, index));
  }

  return field;
}

function buildArrayEntry(field: SchemaField, value: unknown, index: number): SchemaArrayEntry {
  const itemSchema = field.itemSchema;
  const itemType = schemaType(itemSchema);
  const id = nextFieldId(`${field.id}.entry`);

  if (itemType === 'object' && itemSchema.properties) {
    const fields = orderedProperties(itemSchema).map(([key, schema]) => buildField(key, schema, {
      arrayItem: true,
      inObject: true,
      path: `${id}.${key}`
    }));
    if (isRecord(value)) {
      for (const child of fields) {
        hydrateSchemaField(child, value[child.key]);
      }
    }
    return { id, index, fields, valueField: null };
  }

  const valueField = buildField('value', itemSchema, {
    arrayItem: true,
    hideKeyLabel: true,
    inObject: false,
    path: `${id}.value`
  });
  hydrateSchemaField(valueField, value);
  return { id, index, fields: [], valueField };
}

function syncArrayEntryIndexes(entries: SchemaArrayEntry[]) {
  return entries.map((entry, index) => ({ ...entry, index }));
}

function normalizeSchema(schema: NodelJsonSchema | null | undefined): NodelJsonSchema {
  if (!schema || !isRecord(schema)) {
    return emptySchema;
  }

  if (!schema.type && schema.properties) {
    return { ...schema, type: 'object' };
  }

  return schema;
}

function schemaType(schema: NodelJsonSchema): string {
  if (Array.isArray(schema.type)) {
    return schemaType(schema.type[0] ?? emptySchema);
  }

  if (typeof schema.type === 'string') {
    return schema.type;
  }

  if (schema.properties) {
    return 'object';
  }

  return 'null';
}

function fieldKind(type: string): SchemaFieldKind {
  if (type === 'integer' || type === 'number') {
    return 'number';
  }

  if (type === 'boolean' || type === 'object' || type === 'array' || type === 'string') {
    return type;
  }

  return 'null';
}

function orderedProperties(schema: NodelJsonSchema): Array<[string, NodelJsonSchema]> {
  return Object.entries(schema.properties ?? {})
    .sort(([, left], [, right]) => orderOf(left) - orderOf(right));
}

function orderOf(schema: NodelJsonSchema) {
  return typeof schema.order === 'number' ? schema.order : 0;
}

function labelFor(key: string, schema: NodelJsonSchema, options: FieldBuildOptions) {
  if (typeof schema.title === 'string' && schema.title.trim()) {
    return schema.title;
  }

  if (options.hideKeyLabel && !options.inObject && !options.arrayItem) {
    return '';
  }

  return key === 'value' && options.hideKeyLabel ? '' : key;
}

function inputTypeFor(kind: SchemaFieldKind, format: string) {
  if (kind === 'number') {
    return format === 'range' ? 'range' : 'number';
  }

  if (kind === 'string' && ['date', 'time', 'password', 'color'].includes(format)) {
    return format;
  }

  return 'text';
}

function initialValueFor(kind: SchemaFieldKind) {
  if (kind === 'boolean') {
    return false;
  }

  return '';
}

function enumOptionsFor(schema: NodelJsonSchema): SchemaEnumOption[] {
  return Array.isArray(schema.enum)
    ? schema.enum.map((raw) => ({ label: String(raw), value: String(raw), raw }))
    : [];
}

function numericConstraint(value: unknown) {
  return typeof value === 'number' || typeof value === 'string' ? value : '';
}

function stepFor(type: string, step: unknown) {
  if (typeof step === 'number' || typeof step === 'string') {
    return step;
  }

  return type === 'integer' ? 1 : 'any';
}

function nextFieldId(prefix: string) {
  nextId += 1;
  return `nodel-schema-${prefix.replace(/[^a-zA-Z0-9_-]+/g, '-')}-${nextId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
