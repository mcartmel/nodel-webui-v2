import {
  callNodeAction,
  emitNodeSignal,
  getNodeActions,
  getNodeSignals
} from '../api/nodel-host-client';
import type { NodelActionDefinition, NodelActivityLogEntry, NodelJsonSchema, NodelSignalDefinition } from '../api/nodel-types';
import { subscribeNodeActivity } from '../data/node-activity-source';
import { logIcons, renderFontAwesomeIcon, uiIcons } from '../icons/fontawesome';
import { bootstrapJsViews, getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { renderComponentError } from '../utils/render-component-error';
import { copyTextToClipboard } from '../utils/clipboard';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';
import {
  createSchemaForm,
  findSchemaField,
  handleSchemaFormClick,
  handleSchemaFormInput,
  handleSchemaFormToggle,
  hydrateSchemaForm,
  resetSchemaFormDirty,
  revealSchemaValidationIssues,
  registerSchemaFormTemplates,
  serializeSchemaForm,
  setSchemaFormControlsDisabled,
  syncSchemaFormControls,
  type SchemaField,
  type SchemaFormModel,
  validateAndUpdateSchemaForm
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
  copyLabel: string;
  copyTitle: string;
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
const collapseIconMarkup = renderFontAwesomeIcon(uiIcons.chevronDown, 'h-3 w-3');
const busyIconMarkup = renderFontAwesomeIcon(uiIcons.spinner, 'h-4 w-4 animate-spin');
const copyIconMarkup = renderFontAwesomeIcon(uiIcons.copy, 'h-3.5 w-3.5');
const copyToastId = 'nodel-actsig-copy-name';
let registered = false;

const actSigFormTemplate = `
  <form class="nodel-actsig-form nodel-card p-2.5" data-link="data-actsig-form-id{:id} class{:pulse ? 'nodel-actsig-form nodel-card p-2.5 is-pulsing' : 'nodel-actsig-form nodel-card p-2.5'}" autocomplete="off">
    <div class="mb-2.5 flex min-w-0 items-start justify-between gap-2">
      <div class="min-w-0">
        <h3 class="truncate text-sm font-semibold text-nodel-fg" data-link="title{:name}">{^{>title}}</h3>
        {^{if description}}<p class="mt-1 text-xs leading-5 text-nodel-muted">{^{>description}}</p>{{/if}}
        {^{if caution}}<p class="mt-1 text-xs leading-5 text-nodel-warning">{^{>caution}}</p>{{/if}}
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span class="nodel-actsig-form-icon" data-link="data-actsig-point-type{:pointType}" aria-hidden="true">{^{if busy}}${busyIconMarkup}{{else}}{^{:iconMarkup}}{{/if}}</span>
        <button type="button" class="nodel-button nodel-actsig-copy nodel-button-compact" data-link="data-actsig-copy-id{:id} title{:copyTitle} aria-label{:copyLabel}">${copyIconMarkup}</button>
        <button type="submit" class="nodel-button nodel-button-compact" data-link="disabled{:busy || !materialized || !schemaForm || (pointType === 'event' && !~root.overrideSignals)} aria-busy{:busy} title{:name}">
          {^{>pointType === 'action' ? 'Call' : 'Emit'}}
        </button>
      </div>
    </div>
    <fieldset class="min-w-0" data-link="disabled{:busy} aria-disabled{:pointType === 'event' && !~root.overrideSignals}">
      {^{if materialized && schemaForm}}
        {{include schemaForm tmpl="nodelSchemaForm"/}}
      {{else}}
        <div class="nodel-alert nodel-alert-sm">Preparing form...</div>
      {{/if}}
      {^{if error}}
        <div class="nodel-alert nodel-alert-danger nodel-alert-sm mt-3">{^{>error}}</div>
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
    <div class="nodel-actsig-panel space-y-3">
      {^{if loading}}
        <div class="nodel-alert nodel-alert-md">Loading actions and signals...</div>
      {{else}}
        {^{if error}}
          <div class="nodel-alert nodel-alert-danger nodel-alert-md">{^{>error}}</div>
        {{/if}}
        {^{if hasSignals}}
          <label class="inline-flex items-center gap-2 text-sm text-nodel-muted">
            <input class="nodel-choice" type="checkbox" data-actsig-override data-link="overrideSignals" />
            Override signals
          </label>
        {{/if}}
        {^{if empty}}
          <div class="nodel-alert nodel-alert-md">No actions or signals.</div>
        {{else}}
          <div class="space-y-4">
            {^{for sections}}
              {^{if grouped}}
                <details class="nodel-actsig-section nodel-collapse nodel-panel" data-link="open{:open} data-actsig-section-id{:id}">
                  <summary class="nodel-collapse-summary">
                    <span class="nodel-collapse-label">{^{>title}}</span>
                    <span class="nodel-collapse-preview">{^{:rows.length}} item{^{if rows.length !== 1}}s{{/if}}</span>
                    <span class="nodel-collapse-icon" aria-hidden="true">${collapseIconMarkup}</span>
                  </summary>
                  {^{if open}}
                    <div class="nodel-collapse-content space-y-3">
                      {^{for rows tmpl="nodelActSigRow"/}}
                      {^{if materializing}}<div class="nodel-alert nodel-alert-sm">Preparing forms...</div>{{/if}}
                    </div>
                  {{/if}}
                </details>
              {{else}}
                <div class="nodel-actsig-section space-y-3" data-link="data-actsig-section-id{:id}">
                  {^{for rows tmpl="nodelActSigRow"/}}
                  {^{if materializing}}<div class="nodel-alert nodel-alert-sm">Preparing forms...</div>{{/if}}
                </div>
              {{/if}}
            {{/for}}
          </div>
        {{/if}}
      {{/if}}
    </div>
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
  return `nodel-actsig-${encodeURIComponent(prefix)}`;
}

function actionSignalSchema(schema: NodelJsonSchema | null | undefined): NodelJsonSchema {
  return {
    type: 'object',
    properties: {
      arg: schema ?? { type: 'null' }
    }
  };
}

function hasConcreteArgument(schema: NodelJsonSchema) {
  const argument = schema.properties?.arg;
  const type = argument?.type;
  if (typeof type === 'string') return type !== 'null';
  if (Array.isArray(type)) return type.some((variant) => variant.type !== 'null');
  return Boolean(argument && type !== null);
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
    iconMarkup: iconFor(pointType),
    copyLabel: `Copy ${pointType === 'action' ? 'action' : 'signal'} name ${name}`,
    copyTitle: `Copy ${pointType === 'action' ? 'action' : 'signal'} name`
  };
}

function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export class NodelActSig extends HTMLElement {
  private abortController: AbortController | null = null;
  private linked = false;
  private lifecycle = new ComponentLifecycle();
  private linkController = new JsViewsLinkController(this);
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
    const scope = this.lifecycle.connect();
    if (scope) {
      void scope.run(() => this.initialize(scope), (error) => this.handleInitializationError(error));
    }
  }

  disconnectedCallback() {
    this.lifecycle.disconnect();
    this.abortController?.abort();
    this.abortController = null;
    this.source?.dispose();
    this.source = null;
    this.removeEventListener('submit', this.handleSubmit);
    this.removeEventListener('input', this.handleInput);
    this.removeEventListener('change', this.handleChange);
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
    const scope = this.lifecycle.current;
    return scope ? this.loadDefinitions(scope) : Promise.resolve();
  }

  private async initialize(scope: ConnectionScope) {
    await bootstrapJsViews();
    if (!scope.isCurrent()) {
      return;
    }
    registerSchemaFormTemplates();
    registerActSigTemplates();
    const linked = await this.linkController.link(scope, template, this.state);
    if (!linked || !scope.isCurrent()) {
      return;
    }
    this.linked = true;
    scope.listen(this, 'submit', this.handleSubmit);
    scope.listen(this, 'input', this.handleInput);
    scope.listen(this, 'change', this.handleChange);
    scope.listen(this, 'click', this.handleClick);
    scope.listen(this, 'toggle', this.handleToggle, true);
    scope.listen(document, 'visibilitychange', this.handleVisibilityChange);

    await this.loadDefinitions(scope);
    if (scope.isCurrent()) {
      this.subscribeActivity(scope);
    }
  }

  private async loadDefinitions(scope: ConnectionScope) {
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const abort = () => controller.abort();
    scope.signal.addEventListener('abort', abort, { once: true });
    this.setState({ loading: true, error: '', empty: false });

    try {
      const [actions, signals] = await Promise.all([
        getNodeActions({ signal: controller.signal }),
        getNodeSignals({ signal: controller.signal })
      ]);
      if (!scope.isCurrent() || controller !== this.abortController) {
        return;
      }
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
      if (!scope.isCurrent() || controller !== this.abortController) {
        return;
      }
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
    } finally {
      scope.signal.removeEventListener('abort', abort);
      if (this.abortController === controller) {
        this.abortController = null;
      }
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
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
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
      if (!scope.isCurrent() || !this.state.sections.includes(section)) {
        this.materializeTimers.delete(section.id);
        return;
      }
      const end = Math.min(index + materializeChunkSize, forms.length);
      for (; index < end; index += 1) {
        this.materializeForm(forms[index]);
      }

      if (index < forms.length) {
        const timer = scope.setTimeout(step, 0);
        if (timer !== null) {
          this.materializeTimers.set(section.id, timer);
        }
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
      hideRootKeyLabels: true,
      controlsDisabled: this.isReadOnlySignalForm(form),
      initialPresent: hasConcreteArgument(form.schema)
    });
    getJQuery().observable(form).setProperty({
      schemaForm,
      materialized: true
    });
    this.applyCachedArgToForm(form);
    this.lifecycle.current?.setTimeout(() => this.applyCachedArgToForm(form), 0);
  }

  private syncSignalFormReadOnlyState(overrideSignals = this.state.overrideSignals) {
    for (const section of this.state.sections) {
      for (const row of section.rows) {
        for (const form of [row.action, row.event]) {
          if (form?.schemaForm) {
            setSchemaFormControlsDisabled(form.schemaForm, this.isReadOnlySignalForm(form, overrideSignals));
          }
        }
      }
    }
  }

  private isReadOnlySignalForm(form: ActSigFormModel, overrideSignals = this.state.overrideSignals) {
    return form.pointType === 'event' && !overrideSignals;
  }

  private subscribeActivity(scope: ConnectionScope) {
    if (this.source) {
      return;
    }

    const source = subscribeNodeActivity(this, scope.guard((state) => {
      if (state.batch) {
        this.applyActivityEntries(state.batch.items.map((item) => item.entry));
      }
    }));
    this.source = source;
    scope.own(() => {
      source.dispose();
      if (this.source === source) {
        this.source = null;
      }
    });
  }

  private applyActivityEntries(entries: NodelActivityLogEntry[]) {
    for (const entry of entries) {
      if (entry.source !== 'local' || (entry.type !== 'action' && entry.type !== 'event')) {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(entry, 'arg')) {
        this.latestArgs.set(formKey(entry.type, String(entry.alias ?? '')), entry.arg);
      }
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

    hydrateSchemaForm(form.schemaForm, { arg: this.latestArgs.get(key) }, { preserveDirty: form.pointType === 'action' });
    const formRoot = Array.from(this.querySelectorAll<HTMLFormElement>('[data-actsig-form-id]'))
      .find((element) => element.dataset.actsigFormId === form.id);
    syncSchemaFormControls(form.schemaForm, formRoot ?? this);
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

    if (validateAndUpdateSchemaForm(form.schemaForm).length > 0) {
      revealSchemaValidationIssues(form.schemaForm, target);
      return;
    }

    void this.submitForm(form);
  };

  private handleChange = (event: Event) => {
    handleSchemaFormInput(event, this, (fieldId) => this.findField(fieldId));
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.hasAttribute('data-actsig-override')) {
      return;
    }

    this.lifecycle.current?.setTimeout(() => this.syncSignalFormReadOnlyState(), 0);
  };

  private handleInput = (event: Event) => {
    handleSchemaFormInput(event, this, (fieldId) => this.findField(fieldId));
  };

  private handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (target instanceof Element) {
      const copyButton = target.closest<HTMLButtonElement>('[data-actsig-copy-id]');
      if (copyButton && this.contains(copyButton)) {
        event.preventDefault();
        const form = this.findFormById(copyButton.dataset.actsigCopyId ?? '');
        if (form) {
          void this.copyFormName(form);
        }
        return;
      }
    }

    handleSchemaFormClick(event, this, (fieldId) => this.findField(fieldId));
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

    handleSchemaFormToggle(event, this, (fieldId) => this.findField(fieldId));
  };

  private handleVisibilityChange = () => {
    if (document.hidden) {
      return;
    }

    for (const section of this.state.sections) {
      this.applyCachedArgsToSection(section);
    }
  };

  private async submitForm(form: ActSigFormModel) {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    getJQuery().observable(form).setProperty({ busy: true, error: '' });
    const payload = serializeSchemaForm(form.schemaForm!);

    try {
      if (form.pointType === 'action') {
        await callNodeAction(form.name, payload, { signal: scope.signal });
      } else {
        await emitNodeSignal(form.name, payload, { signal: scope.signal });
      }
      if (!scope.isCurrent()) {
        return;
      }
      resetSchemaFormDirty(form.schemaForm!);
      this.dispatchEvent(new CustomEvent('nodel-actsig-submitted', {
        bubbles: true,
        detail: { type: form.pointType, name: form.name, payload }
      }));
    } catch (error) {
      if (!scope.isCurrent()) {
        return;
      }
      const message = apiErrorMessage(error, `Failed to ${form.pointType === 'action' ? 'call action' : 'emit signal'}`);
      getJQuery().observable(form).setProperty('error', message);
      this.dispatchEvent(new CustomEvent('nodel-actsig-error', {
        bubbles: true,
        detail: { type: form.pointType, name: form.name, error: message }
      }));
    } finally {
      if (scope.isCurrent()) {
        getJQuery().observable(form).setProperty('busy', false);
      }
    }
  }

  private async copyFormName(form: ActSigFormModel) {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const pointLabel = form.pointType === 'action' ? 'action' : 'signal';
    try {
      await copyTextToClipboard(form.name);
      if (!scope.isCurrent()) {
        return;
      }
      this.dispatchEvent(new CustomEvent<NodelToastDetail>(NODEL_TOAST, {
        bubbles: true,
        detail: {
          id: copyToastId,
          message: `${pointLabel[0].toUpperCase()}${pointLabel.slice(1)} name copied`,
          detail: form.name,
          tone: 'success'
        }
      }));
    } catch (error) {
      if (!scope.isCurrent()) {
        return;
      }
      this.dispatchEvent(new CustomEvent<NodelToastDetail>(NODEL_TOAST, {
        bubbles: true,
        detail: {
          id: copyToastId,
          message: `Failed to copy ${pointLabel} name`,
          detail: apiErrorMessage(error, 'Clipboard access unavailable'),
          tone: 'danger',
          durationMs: 7000
        }
      }));
    }
  }

  private pulseForm(form: ActSigFormModel) {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const $ = getJQuery();
    $.observable(form).setProperty('pulse', true);
    const existing = this.pulseTimers.get(form.id);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timer = scope.setTimeout(() => {
      $.observable(form).setProperty('pulse', false);
      this.pulseTimers.delete(form.id);
    }, 700);
    if (timer !== null) {
      this.pulseTimers.set(form.id, timer);
    }
  }

  private handleInitializationError(error: unknown) {
    const message = apiErrorMessage(error, 'Failed to initialize actions and signals');
    if (this.linked) {
      this.setState({ loading: false, error: message });
    } else {
      this.dataset.state = 'error';
      renderComponentError(this, message);
    }
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
