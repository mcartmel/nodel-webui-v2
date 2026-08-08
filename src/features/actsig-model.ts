import type { NodelActionDefinition, NodelJsonSchema, NodelSignalDefinition } from '../api/nodel-types';
import { logIcons, renderFontAwesomeIcon } from '../icons/fontawesome';
import { createSchemaForm, setSchemaFormControlsDisabled, type SchemaFormModel } from '../schema/schema-form';
import { reversibleUrlPathSegment } from '../utils/urls';

export type ActSigPointType = 'action' | 'event';

export interface ActSigFormModel {
  id: string;
  pointType: ActSigPointType;
  name: string;
  title: string;
  description: string;
  caution: string;
  schema: NodelJsonSchema;
  schemaForm: SchemaFormModel | null;
  materialized: boolean;
  requestEligible: boolean;
  busy: boolean;
  error: string;
  pulse: boolean;
  iconMarkup: string;
  copyLabel: string;
  copyTitle: string;
}

export interface ActSigRowModel {
  id: string;
  title: string;
  order: number;
  index: number;
  action: ActSigFormModel | null;
  event: ActSigFormModel | null;
}

export interface ActSigSectionModel {
  id: string;
  title: string;
  grouped: boolean;
  open: boolean;
  materializing: boolean;
  rows: ActSigRowModel[];
}

export interface ActSigViewModel {
  loading: boolean;
  error: string;
  overrideSignals: boolean;
  hasSignals: boolean;
  sections: ActSigSectionModel[];
  empty: boolean;
}

let nextOrdinal = 0;
export const ACTSIG_MATERIALIZE_CHUNK_SIZE = 8;

export function createActSigViewModel(): ActSigViewModel {
  return { loading: true, error: '', overrideSignals: false, hasSignals: false, sections: [], empty: false };
}

function nextId() {
  nextOrdinal += 1;
  return `nodel-actsig-${nextOrdinal}`;
}

function titleFor(definition: { name?: string; title?: string }, fallback: string) {
  return definition.title || definition.name || fallback;
}

function orderFor(definition: { order?: number } | undefined) {
  return typeof definition?.order === 'number' ? definition.order : 0;
}

function wrappedSchema(schema: NodelJsonSchema | null | undefined): NodelJsonSchema {
  return { type: 'object', properties: { arg: schema ?? { type: 'null' } } };
}

export function hasConcreteArgument(schema: NodelJsonSchema) {
  const type = schema.properties?.arg?.type;
  if (typeof type === 'string') return type !== 'null';
  if (Array.isArray(type)) return type.some((variant) => variant.type !== 'null');
  return Boolean(schema.properties?.arg && type !== null);
}

function makeForm(pointType: ActSigPointType, definition: NodelActionDefinition | NodelSignalDefinition, fallbackName: string): ActSigFormModel {
  const name = definition.name || fallbackName;
  const action = pointType === 'action';
  const requestEligible = reversibleUrlPathSegment(name) !== null;
  return {
    id: nextId(), pointType, name, title: titleFor(definition, name),
    description: typeof definition.desc === 'string' ? definition.desc : '',
    caution: typeof definition.caution === 'string' ? definition.caution : '',
    schema: wrappedSchema(definition.schema), schemaForm: null, materialized: false,
    requestEligible, busy: false, error: requestEligible ? '' : `This ${action ? 'action' : 'signal'} name cannot be represented safely in a request URL.`,
    pulse: false, iconMarkup: renderFontAwesomeIcon(action ? logIcons.action : logIcons.event, 'h-4 w-4'),
    copyLabel: `Copy ${action ? 'action' : 'signal'} name ${name}`, copyTitle: `Copy ${action ? 'action' : 'signal'} name`
  };
}

function sortRows(rows: ActSigRowModel[]) {
  return [...rows].sort((left, right) => left.order - right.order || left.index - right.index);
}

export function createActSigSections(actions: Record<string, NodelActionDefinition>, signals: Record<string, NodelSignalDefinition>) {
  const remaining = new Map(Object.entries(signals));
  const ungrouped: ActSigRowModel[] = [];
  const groups = new Map<string, ActSigRowModel[]>();
  let index = 0;
  const add = (group: string | undefined, row: ActSigRowModel) => {
    if (!group) ungrouped.push(row);
    else (groups.get(group) ?? (groups.set(group, []), groups.get(group)!)).push(row);
  };
  for (const [key, action] of Object.entries(actions)) {
    const signal = remaining.get(key);
    if (signal) remaining.delete(key);
    index += 1;
    add(action.group, { id: nextId(), title: titleFor(action, action.name || key), order: orderFor(action), index,
      action: makeForm('action', action, key), event: signal ? makeForm('event', signal, key) : null });
  }
  for (const [key, signal] of remaining) {
    index += 1;
    add(signal.group, { id: nextId(), title: titleFor(signal, signal.name || key), order: orderFor(signal), index,
      action: null, event: makeForm('event', signal, key) });
  }
  const sections: ActSigSectionModel[] = [];
  if (ungrouped.length) sections.push({ id: nextId(), title: '', grouped: false, open: true, materializing: false, rows: sortRows(ungrouped) });
  for (const [title, rows] of groups) sections.push({ id: nextId(), title, grouped: true, open: false, materializing: false, rows: sortRows(rows) });
  return sections;
}

export function formsInSection(section: ActSigSectionModel, unmaterializedOnly = false) {
  return section.rows.flatMap((row) => [row.action, row.event]).filter((form): form is ActSigFormModel => Boolean(form && (!unmaterializedOnly || !form.materialized)));
}

export function materializeActSigForm(form: ActSigFormModel, overrideSignals: boolean) {
  if (form.materialized) return null;
  form.schemaForm = createSchemaForm(form.schema, { idPrefix: form.id, hideRootKeyLabels: true, controlsDisabled: form.pointType === 'event' && !overrideSignals, initialPresent: hasConcreteArgument(form.schema) });
  form.materialized = true;
  return form.schemaForm;
}

export function syncActSigSignalControls(sections: ActSigSectionModel[], overrideSignals: boolean) {
  for (const section of sections) for (const form of formsInSection(section)) {
    if (form.schemaForm) setSchemaFormControlsDisabled(form.schemaForm, form.pointType === 'event' && !overrideSignals);
  }
}

export function findActSigFormById(sections: ActSigSectionModel[], id: string) {
  return sections.flatMap((section) => formsInSection(section)).find((form) => form.id === id) ?? null;
}

export function findActSigSectionById(sections: ActSigSectionModel[], id: string) {
  return sections.find((section) => section.id === id) ?? null;
}

export function findActSigSectionForForm(sections: ActSigSectionModel[], id: string) {
  return sections.find((section) => formsInSection(section).some((form) => form.id === id)) ?? null;
}
