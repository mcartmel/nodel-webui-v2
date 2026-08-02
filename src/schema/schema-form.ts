import { renderFontAwesomeIcon, uiIcons } from '../icons/fontawesome';
import { getJQuery } from '../jsviews/jsviews-runtime';
import {
  attachSchemaFormContext,
  buildArrayEntry,
  type SchemaArrayEntry,
  type SchemaField,
  type SchemaFormModel,
  type SchemaPresenceState
} from './schema-model';
import {
  hydrateSchemaFormModel,
  activateSchemaField,
  markSchemaFieldDirty,
  markSchemaFieldPresent,
  setSchemaFieldPresence,
  serializeSchemaFieldModel,
  serializeSchemaFormModel,
  type SchemaHydrateOptions
} from './schema-values';
import { validateSchemaForm } from './schema-validation';
import type { SchemaValidationIssue } from './schema-model';

export type { SchemaArrayEntry, SchemaEnumOption, SchemaField, SchemaFieldKind, SchemaFormModel, SchemaMapEntry } from './schema-model';
export { createSchemaForm } from './schema-model';
export { hydrateSchemaFormModel, serializeSchemaFormModel } from './schema-values';
export { activateSchemaField, markSchemaFieldDirty, resetSchemaFormDirty, setSchemaFieldPresence } from './schema-values';
export { validateSchemaForm } from './schema-validation';

const collapseIconMarkup = renderFontAwesomeIcon(uiIcons.chevronDown, 'h-3 w-3');
const chevronUpIconMarkup = renderFontAwesomeIcon(uiIcons.chevronUp, 'h-3 w-3');
const chevronDownIconMarkup = renderFontAwesomeIcon(uiIcons.chevronDown, 'h-3 w-3');
let registered = false;

const schemaFieldTemplate = `
  <div class="nodel-schema-field" data-link="data-schema-field-id{:id} data-schema-kind{:kind}">
    {^{if nullable}}
      <label class="nodel-schema-presence inline-flex items-center gap-2 text-xs text-nodel-muted">
        <span>State</span>
        <select class="nodel-field nodel-field-compact" data-schema-presence data-link="value{:presenceState}; id{:controlId + '-presence'}; aria-label{:label ? label + ' state' : 'Value state'}; disabled{:~controlsDisabled}">
          <option value="value">Value</option>
          <option value="null">Null</option>
          {^{if allowMissing}}<option value="missing">Missing</option>{{/if}}
        </select>
      </label>
      <div class="nodel-alert nodel-alert-sm" role="status" data-link="hidden{:presenceState !== 'null'}">Null value selected</div>
    {{/if}}
    {^{if unsupported}}
      <div class="nodel-alert nodel-alert-danger nodel-alert-sm" role="alert">{^{>unsupportedReason}}</div>
    {{else kind === 'null'}}
      {^{if present}}<div class="sr-only">Null value</div>{{/if}}
    {{else kind === 'object'}}
      {^{if rootObjectGroup}}
      <details class="nodel-schema-root-object nodel-collapse nodel-card" data-link="open{:open}; hidden{:presenceState === 'null'}; aria-invalid{:errors.length ? 'true' : 'false'}; aria-describedby{:errors.length ? errorId : ''}">
        <summary class="nodel-collapse-summary nodel-schema-root-object-summary" aria-label="Arguments">
          <span class="nodel-schema-root-object-summary-text">
            {^{if label}}<span class="nodel-schema-root-object-title">{^{>label}}</span>{{/if}}
            {^{if description}}<small>{^{>description}}</small>{{/if}}
          </span>
          <span class="nodel-collapse-icon" aria-hidden="true">${collapseIconMarkup}</span>
        </summary>
        {^{if open}}
          <div class="nodel-collapse-content nodel-schema-root-object-content nodel-schema-stack">
            {^{for children tmpl="nodelSchemaField" ~controlsDisabled=~controlsDisabled/}}
            {^{for mapEntries}}
              {{include field tmpl="nodelSchemaField" ~controlsDisabled=~controlsDisabled/}}
            {{/for}}
          </div>
        {{/if}}
      </details>
      {^{if errors.length}}<div class="nodel-alert nodel-alert-danger nodel-alert-sm mt-2" role="alert" data-link="id{:errorId} text{:errors[0]}"></div>{{/if}}
      {{else}}
      <details class="nodel-schema-nested nodel-collapse nodel-card" data-link="open{:open}; hidden{:presenceState === 'null'}; aria-invalid{:errors.length ? 'true' : 'false'}; aria-describedby{:errors.length ? errorId : ''}">
        <summary class="nodel-collapse-summary nodel-schema-nested-summary">
          <span class="nodel-collapse-label">{^{>label || 'Details'}}</span>
          {^{if description}}<small>{^{>description}}</small>{{/if}}
          <span class="nodel-collapse-icon" aria-hidden="true">${collapseIconMarkup}</span>
        </summary>
        {^{if open}}
          <div class="nodel-collapse-content nodel-schema-nested-content nodel-schema-stack">
            {^{for children tmpl="nodelSchemaField" ~controlsDisabled=~controlsDisabled/}}
            {^{for mapEntries}}
              {{include field tmpl="nodelSchemaField" ~controlsDisabled=~controlsDisabled/}}
            {{/for}}
          </div>
        {{/if}}
      </details>
      {^{if errors.length}}<div class="nodel-alert nodel-alert-danger nodel-alert-sm mt-2" role="alert" data-link="id{:errorId} text{:errors[0]}"></div>{{/if}}
      {{/if}}
    {{else kind === 'array'}}
      <details class="nodel-schema-nested nodel-collapse nodel-card" data-link="open{:open}; hidden{:presenceState === 'null'}; aria-invalid{:errors.length ? 'true' : 'false'}; aria-describedby{:errors.length ? errorId : ''}">
        <summary class="nodel-collapse-summary nodel-schema-nested-summary">
          <span class="nodel-collapse-label">{^{>label || 'Items'}}</span>
          {^{if description}}<small>{^{>description}}</small>{{/if}}
          <span class="nodel-collapse-icon" aria-hidden="true">${collapseIconMarkup}</span>
        </summary>
        {^{if open}}
          <div class="nodel-collapse-content nodel-schema-nested-content nodel-schema-stack">
            {^{for entries}}
              <div class="nodel-schema-array-entry nodel-card p-3" data-link="data-schema-array-entry{:id}">
                <div class="mb-3 flex items-center justify-between gap-2">
                  <span class="nodel-section-heading">Item {^{:index + 1}}</span>
                  {^{if nullable}}
                    <label class="nodel-schema-presence inline-flex items-center gap-2 text-xs text-nodel-muted">
                      <span>State</span>
                      <select class="nodel-field nodel-field-compact" data-schema-array-presence data-link="value{:nullValue ? 'null' : 'value'}; aria-label{: 'Item ' + (index + 1) + ' state'}; disabled{:~controlsDisabled}">
                        <option value="value">Value</option>
                        <option value="null">Null</option>
                      </select>
                    </label>
                  {{/if}}
                  <span class="inline-flex gap-1">
                    <button type="button" class="nodel-button nodel-button-compact" data-schema-array-move="up" title="Move up" data-link="disabled{:~controlsDisabled || !canMoveUp}">${chevronUpIconMarkup}<span class="sr-only">Move up</span></button>
                    <button type="button" class="nodel-button nodel-button-compact nodel-button-danger" data-schema-array-remove title="Remove" data-link="disabled{:~controlsDisabled || !canRemove}">Remove</button>
                    <button type="button" class="nodel-button nodel-button-compact" data-schema-array-move="down" title="Move down" data-link="disabled{:~controlsDisabled || !canMoveDown}">${chevronDownIconMarkup}<span class="sr-only">Move down</span></button>
                  </span>
                </div>
                {^{if nullValue}}
                  <div class="sr-only">Null value</div>
                {{else valueField}}
                  {{include valueField tmpl="nodelSchemaField" ~controlsDisabled=~controlsDisabled/}}
                {{else}}
                  <div class="nodel-schema-stack">
                    {^{for fields tmpl="nodelSchemaField" ~controlsDisabled=~controlsDisabled/}}
                  </div>
                {{/if}}
              </div>
            {{/for}}
            <button type="button" class="nodel-button" data-schema-array-add data-link="disabled{:~controlsDisabled || (maxItems >= 0 && entries.length >= maxItems)}">Add</button>
          </div>
        {{/if}}
      </details>
      {^{if errors.length}}<div class="nodel-alert nodel-alert-danger nodel-alert-sm mt-2" role="alert" data-link="id{:errorId} text{:errors[0]}"></div>{{/if}}
    {{else kind === 'boolean'}}
      <label class="nodel-schema-check inline-flex min-w-0 items-start gap-2 text-sm text-nodel-fg" data-link="for{:controlId}; hidden{:presenceState === 'null'}">
        {^{if ~controlsDisabled}}
          <input class="nodel-choice" type="checkbox" data-schema-field-input data-link="checked{:value}; id{:controlId}; aria-invalid{:errors.length ? 'true' : 'false'}; aria-describedby{:errors.length ? errorId : ''}" disabled />
        {{else}}
          <input class="nodel-choice" type="checkbox" data-schema-field-input data-link="checked{:value}; id{:controlId}; aria-invalid{:errors.length ? 'true' : 'false'}; aria-describedby{:errors.length ? errorId : ''}" />
        {{/if}}
        <span class="nodel-schema-control-stack">
          {^{if label}}<span class="block font-medium">{^{>label}}</span>{{/if}}
          {^{if description}}<small class="block text-nodel-muted">{^{>description}}</small>{{/if}}
          <span class="nodel-alert nodel-alert-danger nodel-alert-sm mt-1" role="alert" data-link="id{:errorId} text{:errors.length ? errors[0] : ''} hidden{:!errors.length}"></span>
        </span>
      </label>
    {{else}}
      <label class="block min-w-0 text-sm text-nodel-fg" data-link="for{:controlId}; hidden{:presenceState === 'null'}">
        <span class="nodel-schema-control-stack">
          {^{if label}}<span class="block font-medium">{^{>label}}</span>{{/if}}
          {^{if description}}<small class="block text-nodel-muted">{^{>description}}</small>{{/if}}
        {^{if enumOptions.length}}
          <select class="nodel-field w-full" data-schema-field-input data-link="{:value:} trigger=true; id{:controlId}; aria-invalid{:errors.length ? 'true' : 'false'}; aria-describedby{:errors.length ? errorId : ''}; title{:description}; disabled{:~controlsDisabled}">
            <option value=""></option>
            {^{for enumOptions}}
              <option value="{{:value}}">{^{>label}}</option>
            {{/for}}
          </select>
        {{else format === 'long'}}
          <textarea class="nodel-field min-h-24 w-full" data-schema-field-input data-link="{:value:} trigger=true; id{:controlId}; placeholder{:hint}; aria-invalid{:errors.length ? 'true' : 'false'}; aria-describedby{:errors.length ? errorId : ''}; title{:description}; disabled{:~controlsDisabled}"></textarea>
        {{else kind === 'number'}}
          <input class="nodel-field w-full" data-schema-field-input data-link="{:value:} trigger=true; id{:controlId}; type{:inputType}; placeholder{:hint}; aria-invalid{:errors.length ? 'true' : 'false'}; aria-describedby{:errors.length ? errorId : ''}; title{:description}; min{:min}; max{:max}; step{:step}; disabled{:~controlsDisabled}" />
          {^{if inputType === 'range'}}<output class="block text-xs text-nodel-muted">{^{>value}}</output>{{/if}}
        {{else}}
          <input class="nodel-field w-full" data-schema-field-input data-link="{:value:} trigger=true; id{:controlId}; type{:inputType}; placeholder{:hint}; aria-invalid{:errors.length ? 'true' : 'false'}; aria-describedby{:errors.length ? errorId : ''}; title{:description}; disabled{:~controlsDisabled}" />
        {{/if}}
          <span class="nodel-alert nodel-alert-danger nodel-alert-sm mt-1" role="alert" data-link="id{:errorId} text{:errors.length ? errors[0] : ''} hidden{:!errors.length}"></span>
        </span>
      </label>
        {{/if}}
  </div>
`;

export const schemaFormTemplate = `
  <div class="nodel-schema-form nodel-schema-stack">
    {^{if unsupported}}
      <div class="nodel-alert nodel-alert-danger nodel-alert-md" role="alert">This form cannot be edited: {^{>unsupportedReason}}</div>
    {{/if}}
    {^{for fields tmpl="nodelSchemaField" ~controlsDisabled=controlsDisabled/}}
  </div>
`;

export function registerSchemaFormTemplates() {
  if (registered) return;
  getJQuery().templates('nodelSchemaForm', schemaFormTemplate);
  getJQuery().templates('nodelSchemaField', schemaFieldTemplate);
  registered = true;
}

export function hydrateSchemaForm(form: SchemaFormModel, value: unknown, options: SchemaHydrateOptions = {}) {
  hydrateSchemaFormModel(form, value, options);
  attachSchemaFormContext(form);
  for (const field of allFields(form.fields)) {
    getJQuery().observable(field).setProperty({
      value: field.value,
      concreteValue: field.concreteValue,
      present: field.present,
      presenceState: field.presenceState,
      dirty: field.dirty,
      typeMismatch: field.typeMismatch,
      unknownProperties: field.unknownProperties
    });
    getJQuery().observable(field.entries).refresh(field.entries);
    getJQuery().observable(field.mapEntries).refresh(field.mapEntries);
  }
  applySchemaFormValidation(form);
}

export function serializeSchemaForm(form: SchemaFormModel) {
  return serializeSchemaFormModel(form);
}

export function serializeSchemaField(field: SchemaField): unknown {
  return serializeSchemaFieldModel(field);
}

export function syncSchemaFormControls(form: SchemaFormModel, root: HTMLElement) {
  const fieldElements = new Map<string, { control?: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; presence?: HTMLSelectElement }>();
  const entryElements = new Map<string, HTMLSelectElement>();
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-schema-field-id], [data-schema-array-entry], [data-schema-field-input], [data-schema-presence], [data-schema-array-presence]'))) {
    const fieldId = element.dataset.schemaFieldId ?? element.closest<HTMLElement>('[data-schema-field-id]')?.dataset.schemaFieldId;
    if (fieldId) {
      const state = fieldElements.get(fieldId) ?? {};
      if (element.hasAttribute('data-schema-field-input')) state.control = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (element.hasAttribute('data-schema-presence')) state.presence = element as HTMLSelectElement;
      fieldElements.set(fieldId, state);
    }
    if (element.hasAttribute('data-schema-array-presence')) {
      const entryId = element.closest<HTMLElement>('[data-schema-array-entry]')?.dataset.schemaArrayEntry;
      if (entryId) entryElements.set(entryId, element as HTMLSelectElement);
    }
  }

  for (const field of allFields(form.fields)) {
    const elements = fieldElements.get(field.id);
    if (!elements) continue;
    if (elements.presence) elements.presence.value = field.presenceState;
    const control = elements.control;
    if (!control) continue;
    if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = field.value === true;
    else control.value = field.value === null || field.value === undefined ? '' : String(field.value);
    control.setAttribute('aria-invalid', field.errors.length > 0 ? 'true' : 'false');
    if (field.errors.length > 0) control.setAttribute('aria-describedby', field.errorId);
    else control.removeAttribute('aria-describedby');
  }

  for (const field of allFields(form.fields)) {
    if (field.kind !== 'array') continue;
    for (const entry of field.entries) {
      const presence = entryElements.get(entry.id);
      if (presence) presence.value = entry.nullValue ? 'null' : 'value';
    }
  }
}

export function validateAndUpdateSchemaForm(form: SchemaFormModel) {
  return applySchemaFormValidation(form);
}

export function applySchemaFormValidation(form: SchemaFormModel): SchemaValidationIssue[] {
  const issues = validateSchemaForm(form);
  const byField = new Map<string, string[]>();
  for (const item of issues) byField.set(item.fieldId, [...(byField.get(item.fieldId) ?? []), item.message]);
  for (const field of allFields(form.fields)) {
    const errors = [
      ...(byField.get(field.id) ?? []),
      ...issues
        .filter((item) => item.fieldId !== field.id && isDescendantPointer(item.pointer, field.pointer))
        .map((item) => item.message)
    ].filter((message, index, values) => values.indexOf(message) === index);
    getJQuery().observable(field).setProperty('errors', errors);
  }
  getJQuery().observable(form).setProperty({
    validationIssues: issues,
    invalid: issues.length > 0
  });
  return issues;
}

export function setSchemaFormControlsDisabled(form: SchemaFormModel, controlsDisabled: boolean) {
  getJQuery().observable(form).setProperty('controlsDisabled', controlsDisabled || form.unsupported);
}

export function markSchemaFormFieldPresent(form: SchemaFormModel, fieldId: string, present = true) {
  const field = markSchemaFieldPresent(form, fieldId, present);
  if (field) {
    syncActivatedFieldState(field);
    applySchemaFormValidation(form);
  }
  return field;
}

export function handleSchemaFormInput(event: Event, root: HTMLElement, findField: SchemaFieldFinder) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return false;
  if (!root.contains(target) && !target.closest('[data-schema-field-id]')) return false;
  const arrayPresence = target instanceof HTMLSelectElement && target.hasAttribute('data-schema-array-presence');
  if (arrayPresence) {
    const arrayField = arrayFieldFor(target, findField);
    const entryId = target.closest<HTMLElement>('[data-schema-array-entry]')?.dataset.schemaArrayEntry;
    const entry = arrayField?.entries.find((candidate) => candidate.id === entryId);
    const form = (arrayField as (SchemaField & { form?: SchemaFormModel }) | null)?.form;
    if (!arrayField || !entry || !form) return false;
    getJQuery().observable(entry).setProperty('nullValue', target.value === 'null');
    arrayField.dirty = true;
    form.dirty = true;
    attachSchemaFormContext(form);
    applySchemaFormValidation(form);
    syncSchemaFormControls(form, root);
    return true;
  }
  const presenceControl = target instanceof HTMLSelectElement && target.hasAttribute('data-schema-presence');
  if (!presenceControl && !target.hasAttribute('data-schema-field-input')) return false;
  const fieldId = target.closest<HTMLElement>('[data-schema-field-id]')?.dataset.schemaFieldId;
  if (!fieldId) return false;
  const field = findField(fieldId);
  if (!field) return false;
  const form = (field as SchemaField & { form?: SchemaFormModel }).form;
  if (presenceControl) {
    if (!form || !setSchemaFieldPresence(form, field.id, target.value as SchemaPresenceState)) return false;
    markSchemaFieldDirty(form, field.id);
    syncActivatedFieldState(field);
    applySchemaFormValidation(form);
    syncSchemaFormControls(form, root);
    return true;
  }
  let nextValue: unknown;
  if (target instanceof HTMLInputElement && target.type === 'checkbox') {
    nextValue = target.checked;
  } else {
    nextValue = target.value;
  }
  if (form) {
    markSchemaFormFieldPresent(form, field.id, true);
    markSchemaFieldDirty(form, field.id);
  }
  field.presenceState = 'value';
  getJQuery().observable(field).setProperty({ value: nextValue, present: field.present, presenceState: field.presenceState });
  if (form) syncSchemaFormControls(form, root);
  return true;
}

export type SchemaFieldFinder = (fieldId: string) => SchemaField | null;

export function handleSchemaFormClick(event: MouseEvent, root: HTMLElement, findField: SchemaFieldFinder) {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const addButton = target.closest<HTMLElement>('[data-schema-array-add]');
  if (addButton && root.contains(addButton)) {
    const field = arrayFieldFor(addButton, findField);
    if (field) {
      addArrayEntry(field);
      const form = (field as SchemaField & { form?: SchemaFormModel }).form;
      if (form) syncSchemaFormControls(form, root);
    }
    return true;
  }
  const removeButton = target.closest<HTMLElement>('[data-schema-array-remove]');
  if (removeButton && root.contains(removeButton)) {
    const field = arrayFieldFor(removeButton, findField);
    const entryId = removeButton.closest<HTMLElement>('[data-schema-array-entry]')?.dataset.schemaArrayEntry;
    if (field && entryId) {
      removeArrayEntry(field, entryId);
      const form = (field as SchemaField & { form?: SchemaFormModel }).form;
      if (form) syncSchemaFormControls(form, root);
    }
    return true;
  }
  const moveButton = target.closest<HTMLElement>('[data-schema-array-move]');
  if (moveButton && root.contains(moveButton)) {
    const field = arrayFieldFor(moveButton, findField);
    const entryId = moveButton.closest<HTMLElement>('[data-schema-array-entry]')?.dataset.schemaArrayEntry;
    const direction = moveButton.dataset.schemaArrayMove === 'up' ? 'up' : 'down';
    if (field && entryId) {
      moveArrayEntry(field, entryId, direction);
      const form = (field as SchemaField & { form?: SchemaFormModel }).form;
      if (form) syncSchemaFormControls(form, root);
    }
    return true;
  }
  return false;
}

export function handleSchemaFormToggle(event: Event, root: HTMLElement, findField: SchemaFieldFinder) {
  const target = event.target;
  if (!(target instanceof HTMLDetailsElement) || !root.contains(target)) return false;
  const fieldId = target.closest<HTMLElement>('[data-schema-field-id]')?.dataset.schemaFieldId;
  if (!fieldId) return false;
  const field = findField(fieldId);
  if (field) getJQuery().observable(field).setProperty('open', target.open);
  return true;
}

export function addArrayEntry(field: SchemaField) {
  if (field.kind !== 'array' || (field.maxItems >= 0 && field.entries.length >= field.maxItems)) return;
  field.dirty = true;
  const entry = buildArrayEntry(field, undefined, field.entries.length);
  getJQuery().observable(field.entries).refresh(syncArrayEntryIndexes(field, [...field.entries, entry]));
  const form = (field as SchemaField & { form?: SchemaFormModel }).form;
  if (form) {
    activateSchemaField(form, field.id);
    syncActivatedFieldState(field);
    form.dirty = true;
    attachSchemaFormContext(form);
  } else {
    field.present = true;
    field.presenceState = 'value';
  }
  applyFieldFormValidation(field);
}

export function removeArrayEntry(field: SchemaField, entryId: string) {
  if (field.kind !== 'array' || (field.minItems >= 0 && field.entries.length <= field.minItems)) return;
  const index = field.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return;
  field.dirty = true;
  getJQuery().observable(field.entries).remove(index);
  getJQuery().observable(field.entries).refresh(syncArrayEntryIndexes(field, field.entries));
  const form = (field as SchemaField & { form?: SchemaFormModel }).form;
  if (form) form.dirty = true;
  applyFieldFormValidation(field);
}

export function moveArrayEntry(field: SchemaField, entryId: string, direction: 'up' | 'down') {
  if (field.kind !== 'array') return;
  const index = field.entries.findIndex((entry) => entry.id === entryId);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= field.entries.length) return;
  field.dirty = true;
  const next = [...field.entries];
  const [entry] = next.splice(index, 1);
  next.splice(targetIndex, 0, entry);
  getJQuery().observable(field.entries).refresh(syncArrayEntryIndexes(field, next));
  const form = (field as SchemaField & { form?: SchemaFormModel }).form;
  if (form) form.dirty = true;
  applyFieldFormValidation(field);
}

export function findSchemaField(fields: SchemaField[], id: string): SchemaField | null {
  for (const field of fields) {
    if (field.id === id) return field;
    const child = findSchemaField(field.children, id);
    if (child) return child;
    for (const entry of field.entries) {
      if (entry.valueField?.id === id) return entry.valueField;
      const entryChild = findSchemaField(entry.fields, id);
      if (entryChild) return entryChild;
    }
    const mapChild = field.mapEntries.find((entry) => entry.field.id === id)?.field;
    if (mapChild) return mapChild;
  }
  return null;
}

function allFields(fields: SchemaField[]): SchemaField[] {
  return fields.flatMap((field) => [field, ...allFields(field.children), ...field.entries.flatMap((entry) => [...entry.fields.flatMap((child) => allFields([child])), ...(entry.valueField ? allFields([entry.valueField]) : [])]), ...field.mapEntries.flatMap((entry) => allFields([entry.field]))]);
}

function applyFieldFormValidation(field: SchemaField) {
  const form = (field as SchemaField & { form?: SchemaFormModel }).form;
  if (form) applySchemaFormValidation(form);
}

function syncActivatedFieldState(field: SchemaField) {
  let current: SchemaField | undefined = field;
  while (current) {
    getJQuery().observable(current).setProperty({
      value: current.value,
      concreteValue: current.concreteValue,
      present: current.present,
      presenceState: current.presenceState
    });
    current = current.parent;
  }
}

export function revealSchemaValidationIssues(form: SchemaFormModel, root: HTMLElement) {
  const issue = form.validationIssues[0];
  if (!issue) return;
  const field = findSchemaField(form.fields, issue.fieldId);
  if (!field) return;

  let ancestor: SchemaField | undefined = field;
  while (ancestor) {
    getJQuery().observable(ancestor).setProperty('open', true);
    ancestor = ancestor.parent;
  }

  const focusControl = () => {
    const fieldElement = Array.from(root.querySelectorAll<HTMLElement>('[data-schema-field-id]'))
      .find((element) => element.dataset.schemaFieldId === field.id);
    const control = fieldElement?.querySelector<HTMLElement>('[data-schema-field-input], [data-schema-null-toggle]');
    if (control) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', field.errorId);
    }
    (control ?? fieldElement?.querySelector<HTMLElement>('summary'))?.focus();
  };
  window.setTimeout(focusControl, 0);
}

function syncArrayEntryIndexes(field: SchemaField, entries: SchemaArrayEntry[]) {
  const minItems = field.minItems;
  return entries.map((entry, index) => ({
    ...entry,
    index,
    canRemove: minItems < 0 || entries.length > minItems,
    canMoveUp: index > 0,
    canMoveDown: index < entries.length - 1
  }));
}

function isDescendantPointer(pointer: string, parent: string) {
  if (!parent) return pointer !== '';
  return pointer.startsWith(`${parent}/`);
}

function arrayFieldFor(element: Element, findField: SchemaFieldFinder) {
  const fieldId = element.closest<HTMLElement>('[data-schema-kind="array"]')?.dataset.schemaFieldId;
  if (!fieldId) return null;
  const field = findField(fieldId);
  return field?.kind === 'array' ? field : null;
}
