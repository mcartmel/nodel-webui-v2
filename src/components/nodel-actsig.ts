import {
  callNodeAction,
  emitNodeSignal,
  getNodeActions,
  getNodeSignals
} from '../api/nodel-host-client';
import type { NodelActionDefinition, NodelActivityLogEntry, NodelJsonSchema, NodelSignalDefinition } from '../api/nodel-types';
import { subscribeNodeActivity } from '../data/node-activity-source';
import { logIcons, renderFontAwesomeIcon } from '../icons/fontawesome';
import { bootstrapJsViews, getJQuery, linkTemplate, unlinkTemplate } from '../jsviews/jsviews-runtime';
import {
  addArrayEntry,
  createSchemaForm,
  findSchemaField,
  hydrateSchemaForm,
  moveArrayEntry,
  registerSchemaFormTemplates,
  removeArrayEntry,
  serializeSchemaForm,
  type SchemaField,
  type SchemaFormModel
} from '../schema/schema-form';

type ActSigPointType = 'action' | 'event';

interface ActSigFormModel {
  id: string;
  pointType: ActSigPointType;
  name: string;
  title: string;
  description: string;
  caution: string;
  schema: NodelJsonSchema;
  schemaForm: SchemaFormModel | null;
  materialized: boolean;
  busy: boolean;
  error: string;
  pulse: boolean;
  iconMarkup: string;
}

interface ActSigRowModel {
  id: string;
  title: string;
  order: number;
  index: number;
  action: ActSigFormModel | null;
  event: ActSigFormModel | null;
}

interface ActSigSectionModel {
  id: string;
  title: string;
  grouped: boolean;
  open: boolean;
  materializing: boolean;
  rows: ActSigRowModel[];
}

interface ActSigViewModel {
  loading: boolean;
  error: string;
  overrideSignals: boolean;
  hasSignals: boolean;
  sections: ActSigSectionModel[];
  empty: boolean;
}

const ungroupedSectionTitle = '';
const materializeChunkSize = 8;
let registered = false;
let nextId = 0;

const actSigFormTemplate = `
  <form class="nodel-actsig-form nodel-card p-2.5" data-link="data-actsig-form-id{:id} class{:pulse ? 'nodel-actsig-form nodel-card p-2.5 is-pulsing' : 'nodel-actsig-form nodel-card p-2.5'}" autocomplete="off">
    <fieldset class="min-w-0" data-link="disabled{:busy || (pointType === 'event' && !~root.overrideSignals)}">
      <div class="mb-2.5 flex min-w-0 items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="truncate text-sm font-semibold text-nodel-fg" data-link="title{:name}">{^{>title}}</h3>
          {^{if description}}<p class="mt-1 text-xs leading-5 text-nodel-muted">{^{>description}}</p>{{/if}}
          {^{if caution}}<p class="mt-1 text-xs leading-5 text-nodel-warning">{^{>caution}}</p>{{/if}}
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span class="nodel-actsig-form-icon" aria-hidden="true">{^{:iconMarkup}}</span>
          <button type="submit" class="nodel-button nodel-field-compact" data-link="disabled{:busy || !materialized} title{:name}">
            {^{if busy}}Sending...{{else}}{^{>pointType === 'action' ? 'Call' : 'Emit'}}{{/if}}
          </button>
        </div>
      </div>
      {^{if materialized && schemaForm}}
        {{include schemaForm tmpl="nodelSchemaForm"/}}
      {{else}}
        <div class="nodel-alert px-3 py-2 text-xs">Preparing form...</div>
      {{/if}}
      {^{if error}}
        <div class="nodel-alert nodel-alert-danger mt-3 px-3 py-2 text-xs">{^{>error}}</div>
      {{/if}}
    </fieldset>
  </form>
`;

const actSigRowTemplate = `
  <div class="nodel-actsig-row grid gap-3 md:grid-cols-2">
    {^{if action}}
      <div class="min-w-0">{{include action tmpl="nodelActSigForm"/}}</div>
    {{else}}
      <div class="hidden md:block"></div>
    {{/if}}
    {^{if event}}
      <div class="min-w-0">{{include event tmpl="nodelActSigForm"/}}</div>
    {{/if}}
  </div>
`;

const template = `
  <div class="nodel-actsig" data-link="class{:loading ? 'nodel-actsig is-loading' : 'nodel-actsig'}">
    {^{if loading}}
      <div class="nodel-alert px-4 py-3 text-sm">Loading actions and signals...</div>
    {{else}}
      <div class="nodel-actsig-panel space-y-3">
        {^{if error}}
          <div class="nodel-alert nodel-alert-danger px-4 py-3 text-sm">{^{>error}}</div>
        {{/if}}
        {^{if hasSignals}}
          <label class="inline-flex items-center gap-2 text-sm text-nodel-muted">
            <input type="checkbox" data-actsig-override data-link="overrideSignals" />
            Override signals
          </label>
        {{/if}}
        {^{if empty}}
          <div class="nodel-alert px-4 py-3 text-sm">No actions or signals.</div>
        {{else}}
          <div class="space-y-4">
            {^{for sections}}
              {^{if grouped}}
                <details class="nodel-actsig-section nodel-collapse nodel-panel" data-link="open{:open} data-actsig-section-id{:id}">
                  <summary class="nodel-collapse-summary">
                    <span class="nodel-collapse-label">{^{>title}}</span>
                    <span class="nodel-collapse-preview">{^{:rows.length}} item{^{if rows.length !== 1}}s{{/if}}</span>
                    <span class="nodel-collapse-icon" aria-hidden="true"></span>
                  </summary>
                  {^{if open}}
                    <div class="nodel-collapse-content space-y-3">
                      {^{for rows tmpl="nodelActSigRow"/}}
                      {^{if materializing}}<div class="nodel-alert px-3 py-2 text-xs">Preparing forms...</div>{{/if}}
                    </div>
                  {{/if}}
                </details>
              {{else}}
                <div class="nodel-actsig-section space-y-3" data-link="data-actsig-section-id{:id}">
                  {^{for rows tmpl="nodelActSigRow"/}}
                  {^{if materializing}}<div class="nodel-alert px-3 py-2 text-xs">Preparing forms...</div>{{/if}}
                </div>
              {{/if}}
            {{/for}}
          </div>
        {{/if}}
      </div>
    {{/if}}
  </div>
`;

function registerActSigTemplates() {
  if (registered) {
    return;
  }

  const $ = getJQuery();
  $.templates('nodelActSigForm', actSigFormTemplate);
  $.templates('nodelActSigRow', actSigRowTemplate);
  registered = true;
}

function nextActSigId(prefix: string) {
  nextId += 1;
  return `nodel-actsig-${prefix.replace(/[^a-zA-Z0-9_-]+/g, '-')}-${nextId}`;
}

function actionSignalSchema(schema: NodelJsonSchema | null | undefined): NodelJsonSchema {
  return {
    type: 'object',
    properties: {
      arg: schema ?? { type: 'null' }
    }
  };
}

function titleFor(definition: { name?: string; title?: string }, fallback: string) {
  return definition.title || definition.name || fallback;
}

function orderFor(definition: { order?: number } | undefined) {
  return typeof definition?.order === 'number' ? definition.order : 0;
}

function formKey(pointType: ActSigPointType, name: string) {
  return `${pointType}:${name}`;
}

function iconFor(pointType: ActSigPointType) {
  return renderFontAwesomeIcon(pointType === 'action' ? logIcons.action : logIcons.event, 'h-4 w-4');
}

function normalizeDefinitionName<T extends { name?: string }>(key: string, definition: T): T & { name: string } {
  return { ...definition, name: definition.name || key };
}

function makeForm(pointType: ActSigPointType, definition: NodelActionDefinition | NodelSignalDefinition, fallbackName: string): ActSigFormModel {
  const name = definition.name || fallbackName;
  return {
    id: nextActSigId(`${pointType}-${name}`),
    pointType,
    name,
    title: titleFor(definition, name),
    description: typeof definition.desc === 'string' ? definition.desc : '',
    caution: typeof definition.caution === 'string' ? definition.caution : '',
    schema: actionSignalSchema(definition.schema),
    schemaForm: null,
    materialized: false,
    busy: false,
    error: '',
    pulse: false,
    iconMarkup: iconFor(pointType)
  };
}

function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export class NodelActSig extends HTMLElement {
  private abortController: AbortController | null = null;
  private linked = false;
  private materializeTimers = new Map<string, number>();
  private pulseTimers = new Map<string, number>();
  private source: ReturnType<typeof subscribeNodeActivity> | null = null;
  private latestArgs = new Map<string, unknown>();
  private state: ActSigViewModel = {
    loading: true,
    error: '',
    overrideSignals: false,
    hasSignals: false,
    sections: [],
    empty: false
  };

  connectedCallback() {
    void this.initialize();
  }

  disconnectedCallback() {
    this.abortController?.abort();
    this.abortController = null;
    this.source?.dispose();
    this.source = null;
    this.removeEventListener('submit', this.handleSubmit);
    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('toggle', this.handleToggle, true);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    for (const timer of this.materializeTimers.values()) {
      window.clearTimeout(timer);
    }
    for (const timer of this.pulseTimers.values()) {
      window.clearTimeout(timer);
    }
    this.materializeTimers.clear();
    this.pulseTimers.clear();
    void unlinkTemplate(this);
    this.linked = false;
  }

  refreshAfterRestart() {
    this.latestArgs.clear();
    for (const timer of this.materializeTimers.values()) {
      window.clearTimeout(timer);
    }
    for (const timer of this.pulseTimers.values()) {
      window.clearTimeout(timer);
    }
    this.materializeTimers.clear();
    this.pulseTimers.clear();
    return this.loadDefinitions();
  }

  private async initialize() {
    if (!this.linked) {
      await bootstrapJsViews();
      registerSchemaFormTemplates();
      registerActSigTemplates();
      await linkTemplate(this, template, this.state);
      this.linked = true;
      this.addEventListener('submit', this.handleSubmit);
      this.addEventListener('click', this.handleClick);
      this.addEventListener('toggle', this.handleToggle, true);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    await this.loadDefinitions();
    this.subscribeActivity();
  }

  private async loadDefinitions() {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.setState({ loading: true, error: '', empty: false });

    try {
      const [actions, signals] = await Promise.all([
        getNodeActions({ signal: this.abortController.signal }),
        getNodeSignals({ signal: this.abortController.signal })
      ]);
      const sections = this.buildSections(actions, signals);
      this.setState({
        loading: false,
        error: '',
        sections,
        hasSignals: sections.some((section) => section.rows.some((row) => row.event)),
        empty: sections.length === 0
      });
      for (const section of sections) {
        if (!section.grouped || section.open) {
          this.materializeSection(section);
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      this.setState({
        loading: false,
        error: apiErrorMessage(error, 'Failed to load actions and signals'),
        sections: [],
        hasSignals: false,
        empty: false
      });
    }
  }

  private buildSections(actionsInput: Record<string, NodelActionDefinition>, signalsInput: Record<string, NodelSignalDefinition>): ActSigSectionModel[] {
    const remainingSignals = new Map(Object.entries(signalsInput).map(([key, signal]) => [key, normalizeDefinitionName(key, signal)]));
    const ungroupedRows: ActSigRowModel[] = [];
    const groups = new Map<string, ActSigRowModel[]>();
    let rowIndex = 0;

    const pushRow = (group: string | undefined, row: ActSigRowModel) => {
      if (group) {
        const rows = groups.get(group) ?? [];
        rows.push(row);
        groups.set(group, rows);
      } else {
        ungroupedRows.push(row);
      }
    };

    for (const [key, rawAction] of Object.entries(actionsInput)) {
      const action = normalizeDefinitionName(key, rawAction);
      const signal = remainingSignals.get(key) ?? null;
      if (signal) {
        remainingSignals.delete(key);
      }
      const order = orderFor(action);
      rowIndex += 1;
      pushRow(action.group, {
        id: nextActSigId(`row-${key}`),
        title: titleFor(action, action.name),
        order,
        index: rowIndex,
        action: makeForm('action', action, key),
        event: signal ? makeForm('event', signal, key) : null
      });
    }

    for (const [key, signal] of remainingSignals) {
      rowIndex += 1;
      pushRow(signal.group, {
        id: nextActSigId(`row-${key}`),
        title: titleFor(signal, signal.name),
        order: orderFor(signal),
        index: rowIndex,
        action: null,
        event: makeForm('event', signal, key)
      });
    }

    const sections: ActSigSectionModel[] = [];
    if (ungroupedRows.length > 0) {
      sections.push({
        id: nextActSigId('section-ungrouped'),
        title: ungroupedSectionTitle,
        grouped: false,
        open: true,
        materializing: false,
        rows: sortRows(ungroupedRows)
      });
    }

    for (const [title, rows] of groups) {
      sections.push({
        id: nextActSigId(`section-${title}`),
        title,
        grouped: true,
        open: false,
        materializing: false,
        rows: sortRows(rows)
      });
    }

    return sections;
  }

  private materializeSection(section: ActSigSectionModel) {
    if (section.materializing || this.materializeTimers.has(section.id)) {
      return;
    }

    const forms = section.rows.flatMap((row) => [row.action, row.event]).filter((form): form is ActSigFormModel => Boolean(form && !form.materialized));
    if (forms.length === 0) {
      this.applyCachedArgsToSection(section);
      return;
    }

    getJQuery().observable(section).setProperty('materializing', true);
    let index = 0;

    const step = () => {
      const end = Math.min(index + materializeChunkSize, forms.length);
      for (; index < end; index += 1) {
        this.materializeForm(forms[index]);
      }

      if (index < forms.length) {
        const timer = window.setTimeout(step, 0);
        this.materializeTimers.set(section.id, timer);
        return;
      }

      this.materializeTimers.delete(section.id);
      getJQuery().observable(section).setProperty('materializing', false);
      this.applyCachedArgsToSection(section);
    };

    step();
  }

  private materializeForm(form: ActSigFormModel) {
    if (form.materialized) {
      return;
    }

    const schemaForm = createSchemaForm(form.schema, {
      idPrefix: form.id,
      hideRootKeyLabels: true
    });
    getJQuery().observable(form).setProperty({
      schemaForm,
      materialized: true
    });
    this.applyCachedArgToForm(form);
  }

  private subscribeActivity() {
    if (this.source) {
      return;
    }

    this.source = subscribeNodeActivity(this, (state) => {
      if (state.batch) {
        this.applyActivityEntries(state.batch.items.map((item) => item.entry));
      }
    });
  }

  private applyActivityEntries(entries: NodelActivityLogEntry[]) {
    for (const entry of entries) {
      if (entry.source !== 'local' || (entry.type !== 'action' && entry.type !== 'event')) {
        continue;
      }

      this.latestArgs.set(formKey(entry.type, String(entry.alias ?? '')), entry.arg);
      const form = this.findForm(entry.type, String(entry.alias ?? ''));
      if (form) {
        this.applyCachedArgToForm(form);
        this.pulseForm(form);
      }
    }
  }

  private applyCachedArgsToSection(section: ActSigSectionModel) {
    if (!this.canHydrateSection(section)) {
      return;
    }

    for (const row of section.rows) {
      if (row.action) {
        this.applyCachedArgToForm(row.action);
      }
      if (row.event) {
        this.applyCachedArgToForm(row.event);
      }
    }
  }

  private applyCachedArgToForm(form: ActSigFormModel) {
    const section = this.findSectionForForm(form.id);
    if (!form.materialized || !form.schemaForm || !section || !this.canHydrateSection(section)) {
      return;
    }

    const key = formKey(form.pointType, form.name);
    if (!this.latestArgs.has(key)) {
      return;
    }

    hydrateSchemaForm(form.schemaForm, { arg: this.latestArgs.get(key) });
  }

  private canHydrateSection(section: ActSigSectionModel) {
    return section.open && !document.hidden && !this.isInHiddenPage();
  }

  private isInHiddenPage() {
    const page = this.closest('nodel-page');
    return page instanceof HTMLElement && page.hidden;
  }

  private findForm(pointType: ActSigPointType, name: string) {
    for (const section of this.state.sections) {
      for (const row of section.rows) {
        const form = pointType === 'action' ? row.action : row.event;
        if (form?.name === name) {
          return form;
        }
      }
    }

    return null;
  }

  private findFormById(id: string) {
    for (const section of this.state.sections) {
      for (const row of section.rows) {
        if (row.action?.id === id) {
          return row.action;
        }
        if (row.event?.id === id) {
          return row.event;
        }
      }
    }

    return null;
  }

  private findSectionById(id: string) {
    return this.state.sections.find((section) => section.id === id) ?? null;
  }

  private findSectionForForm(formId: string) {
    return this.state.sections.find((section) => section.rows.some((row) => row.action?.id === formId || row.event?.id === formId)) ?? null;
  }

  private findField(fieldId: string): SchemaField | null {
    for (const section of this.state.sections) {
      for (const row of section.rows) {
        for (const form of [row.action, row.event]) {
          if (!form?.schemaForm) {
            continue;
          }
          const field = findSchemaField(form.schemaForm.fields, fieldId);
          if (field) {
            return field;
          }
        }
      }
    }

    return null;
  }

  private handleSubmit = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement)) {
      return;
    }

    const formId = target.dataset.actsigFormId;
    if (!formId) {
      return;
    }

    event.preventDefault();
    const form = this.findFormById(formId);
    if (!form || !form.schemaForm || form.busy || (form.pointType === 'event' && !this.state.overrideSignals)) {
      return;
    }

    void this.submitForm(form);
  };

  private handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const addButton = target.closest<HTMLElement>('[data-schema-array-add]');
    if (addButton && this.contains(addButton)) {
      const field = this.arrayFieldFor(addButton);
      if (field) {
        addArrayEntry(field);
      }
      return;
    }

    const removeButton = target.closest<HTMLElement>('[data-schema-array-remove]');
    if (removeButton && this.contains(removeButton)) {
      const field = this.arrayFieldFor(removeButton);
      const entryId = removeButton.closest<HTMLElement>('[data-schema-array-entry]')?.dataset.schemaArrayEntry;
      if (field && entryId) {
        removeArrayEntry(field, entryId);
      }
      return;
    }

    const moveButton = target.closest<HTMLElement>('[data-schema-array-move]');
    if (moveButton && this.contains(moveButton)) {
      const field = this.arrayFieldFor(moveButton);
      const entryId = moveButton.closest<HTMLElement>('[data-schema-array-entry]')?.dataset.schemaArrayEntry;
      const direction = moveButton.dataset.schemaArrayMove === 'up' ? 'up' : 'down';
      if (field && entryId) {
        moveArrayEntry(field, entryId, direction);
      }
    }
  };

  private handleToggle = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLDetailsElement) || !this.contains(target)) {
      return;
    }

    const sectionId = target.dataset.actsigSectionId;
    if (sectionId) {
      const section = this.findSectionById(sectionId);
      if (!section) {
        return;
      }
      getJQuery().observable(section).setProperty('open', target.open);
      if (target.open) {
        this.materializeSection(section);
      }
      return;
    }

    const fieldId = target.closest<HTMLElement>('[data-schema-field-id]')?.dataset.schemaFieldId;
    if (fieldId) {
      const field = this.findField(fieldId);
      if (field) {
        getJQuery().observable(field).setProperty('open', target.open);
      }
    }
  };

  private handleVisibilityChange = () => {
    if (document.hidden) {
      return;
    }

    for (const section of this.state.sections) {
      this.applyCachedArgsToSection(section);
    }
  };

  private arrayFieldFor(element: Element) {
    const fieldId = element.closest<HTMLElement>('[data-schema-kind="array"]')?.dataset.schemaFieldId;
    if (!fieldId) {
      return null;
    }

    const field = this.findField(fieldId);
    return field?.kind === 'array' ? field : null;
  }

  private async submitForm(form: ActSigFormModel) {
    getJQuery().observable(form).setProperty({ busy: true, error: '' });
    const payload = serializeSchemaForm(form.schemaForm!);

    try {
      if (form.pointType === 'action') {
        await callNodeAction(form.name, payload);
      } else {
        await emitNodeSignal(form.name, payload);
      }
      this.dispatchEvent(new CustomEvent('nodel-actsig-submitted', {
        bubbles: true,
        detail: { type: form.pointType, name: form.name, payload }
      }));
    } catch (error) {
      const message = apiErrorMessage(error, `Failed to ${form.pointType === 'action' ? 'call action' : 'emit signal'}`);
      getJQuery().observable(form).setProperty('error', message);
      this.dispatchEvent(new CustomEvent('nodel-actsig-error', {
        bubbles: true,
        detail: { type: form.pointType, name: form.name, error: message }
      }));
    } finally {
      getJQuery().observable(form).setProperty('busy', false);
    }
  }

  private pulseForm(form: ActSigFormModel) {
    const $ = getJQuery();
    $.observable(form).setProperty('pulse', true);
    const existing = this.pulseTimers.get(form.id);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
      $.observable(form).setProperty('pulse', false);
      this.pulseTimers.delete(form.id);
    }, 1000);
    this.pulseTimers.set(form.id, timer);
  }

  private setState(values: Partial<ActSigViewModel>) {
    getJQuery().observable(this.state).setProperty(values);
  }
}

function sortRows(rows: ActSigRowModel[]) {
  return [...rows].sort((left, right) => left.order - right.order || left.index - right.index);
}

if (!customElements.get('nodel-actsig')) {
  customElements.define('nodel-actsig', NodelActSig);
}
