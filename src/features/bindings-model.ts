import type { NodelJsonSchema } from '../api/nodel-types';
import { networkNodeSearchHref } from '../navigation/node-links';
import { cloneSchemaValue } from '../schema/schema-values';
import { validateValueAgainstSchema } from '../schema/schema-validation';
import { hasOwn, isRecord, setOwn } from '../utils/records';
import type { SuggestionConfidence, TargetOption } from './bindings-matching';

export type BindingKind = 'actions' | 'events';
type BindingTargetKey = 'action' | 'event';

export interface BindingOption {
  label: string;
  value: string;
  address: string;
  detail: string;
}

export interface BindingRow {
  id: string;
  kind: BindingKind;
  targetKey: BindingTargetKey;
  targetLabel: string;
  alias: string;
  title: string;
  description: string;
  node: string;
  nodeAddress: string;
  target: string;
  selected: boolean;
  status: string;
  statusClass: string;
  statusHref: string;
  statusLinkLabel: string;
  nodeOptions: BindingOption[];
  targetOptions: TargetOption[];
  showNodeOptions: boolean;
  showTargetOptions: boolean;
  searchingNode: boolean;
  searchingTarget: boolean;
  suggestionValue: string;
  suggestionLabel: string;
  suggestionConfidence: SuggestionConfidence;
  suggestionClass: string;
  schema: NodelJsonSchema;
  originalValue: Record<string, unknown>;
  rowPresent: boolean;
  nodePresent: boolean;
  targetPresent: boolean;
  dirty: boolean;
  nodeDirty: boolean;
  targetDirty: boolean;
  nodeError: string;
  targetError: string;
}

export interface BindingSection {
  kind: BindingKind;
  title: string;
  targetKey: BindingTargetKey;
  targetLabel: string;
  rows: BindingRow[];
  visibleRows: BindingRow[];
  selectedCount: number;
  visibleCount: number;
  unboundCount: number;
}

function nextBindingId(kind: BindingKind, alias: string) {
  return `nodel-bindings-${kind}-${alias.replace(/[^a-zA-Z0-9_-]+/g, '-')}-${bindingHash(`${kind}:${alias}`)}`;
}

function bindingHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function sectionTitle(kind: BindingKind) {
  return kind === 'actions' ? 'Actions' : 'Events';
}

function targetKeyFor(kind: BindingKind): BindingTargetKey {
  return kind === 'actions' ? 'action' : 'event';
}

function targetLabelFor(kind: BindingKind) {
  return kind === 'actions' ? 'Action' : 'Event';
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function titleFor(alias: string, schema: NodelJsonSchema) {
  return schema.title || alias;
}

export function hasBindingSchema(schema: NodelJsonSchema | null | undefined) {
  const properties = schema?.properties ?? {};
  return Boolean(properties.actions?.properties && Object.keys(properties.actions.properties).length > 0)
    || Boolean(properties.events?.properties && Object.keys(properties.events.properties).length > 0);
}

export function normalizeBindingStatus(status: unknown) {
  return status === 'Wired' ? 'Wired' : 'Unwired';
}

export function bindingStatusClass(status: string) {
  return status === 'Wired' ? 'nodel-bindings-status is-wired' : 'nodel-bindings-status is-unwired';
}

export function bindingStatusLinkProperties(node: string) {
  const name = node;
  return {
    statusHref: name ? networkNodeSearchHref(name) : '',
    statusLinkLabel: name ? `Open ${name} in Network nodes` : ''
  };
}

export function bindingSuggestionClass(confidence: SuggestionConfidence) {
  if (confidence === 'high') {
    return 'nodel-bindings-suggestion is-high';
  }
  if (confidence === 'medium') {
    return 'nodel-bindings-suggestion is-medium';
  }
  if (confidence === 'ambiguous') {
    return 'nodel-bindings-suggestion is-ambiguous';
  }
  if (confidence === 'none') {
    return 'nodel-bindings-suggestion is-none';
  }
  return 'nodel-bindings-suggestion';
}

export function validateBindingRow(row: BindingRow) {
  // Java RemoteBindingValues serialises a declared but unbound row as an empty
  // object; BaseNode treats that state as valid and reports it as unbound.
  if (!row.nodePresent && !row.targetPresent && !row.nodeDirty && !row.targetDirty) return [];
  const value: Record<string, unknown> = cloneSchemaValue(row.originalValue);
  if (row.nodeDirty || row.nodePresent) value.node = row.node;
  if (row.targetDirty || row.targetPresent) value[row.targetKey] = row.target;
  const schema = cloneSchemaValue(row.schema);
  const nodeSchema = schema.properties?.node;
  if (nodeSchema) nodeSchema.required = false;
  const targetSchema = schema.properties?.[row.targetKey];
  if (targetSchema) targetSchema.required = false;
  return validateValueAgainstSchema(value, schema, row.id).map((issue) => ({
    ...issue,
    fieldId: issue.fieldId.startsWith(row.id) ? issue.fieldId : `${row.id}${issue.pointer}`,
    pointer: issue.pointer.startsWith(row.id) ? issue.pointer : `${row.id}${issue.pointer}`
  }));
}

export function createBindingSections(schema: NodelJsonSchema, values: Record<string, unknown>): BindingSection[] {
  return (['actions', 'events'] as BindingKind[])
    .map((kind) => createBindingSection(kind, schema.properties?.[kind], objectValue(values[kind])))
    .filter((section) => section.rows.length > 0);
}

function createBindingSection(kind: BindingKind, schema: NodelJsonSchema | undefined, values: Record<string, unknown>): BindingSection {
  const targetKey = targetKeyFor(kind);
  const targetLabel = targetLabelFor(kind);
  const rows = Object.entries(schema?.properties ?? {})
    .map(([alias, rowSchema]) => {
      const value = objectValue(values[alias]);
      const node = stringValue(value.node);
      const status = normalizeBindingStatus('');
      const row: BindingRow = {
        id: nextBindingId(kind, alias),
        kind,
        targetKey,
        targetLabel,
        alias,
        title: titleFor(alias, rowSchema),
        description: typeof rowSchema.desc === 'string' ? rowSchema.desc : '',
        node,
        nodeAddress: '',
        target: stringValue(value[targetKey]),
        schema: rowSchema,
        originalValue: cloneSchemaValue(value),
        rowPresent: hasOwn(values, alias),
        nodePresent: hasOwn(value, 'node'),
        targetPresent: hasOwn(value, targetKey),
        dirty: false,
        nodeDirty: false,
        targetDirty: false,
        nodeError: '',
        targetError: '',
        selected: false,
        status,
        statusClass: bindingStatusClass(status),
        ...bindingStatusLinkProperties(node),
        nodeOptions: [],
        targetOptions: [],
        showNodeOptions: false,
        showTargetOptions: false,
        searchingNode: false,
        searchingTarget: false,
        suggestionValue: '',
        suggestionLabel: '',
        suggestionConfidence: '',
        suggestionClass: bindingSuggestionClass('')
      };
      return row;
    });

  return {
    kind,
    title: sectionTitle(kind),
    targetKey,
    targetLabel,
    rows,
    visibleRows: rows.slice(),
    selectedCount: 0,
    visibleCount: rows.length,
    unboundCount: rows.length
  };
}

export function serializeBindingPayload(sourceBindings: Record<string, unknown>, sections: BindingSection[]) {
  const payload: Record<string, unknown> = cloneSchemaValue(sourceBindings);

  for (const section of sections) {
    const sourceSectionPresent = hasOwn(payload, section.kind);
    if (!sourceSectionPresent && !section.rows.some((row) => row.dirty)) continue;
    const sectionPayload: Record<string, unknown> = isRecord(payload[section.kind]) ? cloneSchemaValue(payload[section.kind]) as Record<string, unknown> : {};
    for (const row of section.rows) {
      if (!row.dirty && row.rowPresent) {
        continue;
      }
      if (!row.dirty) continue;
      const rowPayload: Record<string, unknown> = cloneSchemaValue(row.originalValue);
      if (row.nodeDirty) rowPayload.node = row.node;
      if (row.targetDirty) rowPayload[row.targetKey] = row.target;
      setOwn(sectionPayload, row.alias, rowPayload);
    }
    payload[section.kind] = sectionPayload;
  }

  return payload;
}
