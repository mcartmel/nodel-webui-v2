import {
  callNodeAction,
  emitNodeSignal,
  getNodeActions,
  getNodeSignals
} from '../api/nodel-host-client';
import { subscribeNodeActivity } from '../data/node-activity-source';
import type { NodeRestartRefreshResult } from '../data/node-restart-source';
import { renderFontAwesomeIcon, uiIcons } from '../icons/fontawesome';
import { bootstrapJsViews, getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { renderComponentError } from '../utils/render-component-error';
import { copyTextToClipboard } from '../utils/clipboard';
import { apiErrorMessage } from '../utils/errors';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';
import {
  handleSchemaFormClick,
  handleSchemaFormInput,
  handleSchemaFormToggle,
  revealSchemaValidationIssues,
  registerSchemaFormTemplates,
  syncSchemaFormControls,
  type SchemaField,
} from '../schema/schema-form';
import { ActSigController } from '../features/actsig-controller';
import { ACTSIG_MATERIALIZE_CHUNK_SIZE, type ActSigFormModel, type ActSigSectionModel, type ActSigViewModel } from '../features/actsig-model';

const collapseIconMarkup = renderFontAwesomeIcon(uiIcons.chevronDown, 'h-3 w-3');
const busyIconMarkup = renderFontAwesomeIcon(uiIcons.spinner, 'h-4 w-4 animate-spin');
const copyIconMarkup = renderFontAwesomeIcon(uiIcons.copy, 'h-3.5 w-3.5');
const copyToastId = 'nodel-actsig-copy-name';
let registered = false;

const actSigFormTemplate = `
  <form class="nodel-actsig-form nodel-card p-2.5" data-link="data-actsig-form-id{:id} class{:pulse ? 'nodel-actsig-form nodel-card p-2.5 is-pulsing' : 'nodel-actsig-form nodel-card p-2.5'}" autocomplete="off">
    <div class="flex min-w-0 items-start justify-between gap-2" data-link="class{:(materialized && schemaForm && !schemaForm.hasFields && !schemaForm.unsupported && !error) ? 'flex min-w-0 items-start justify-between gap-2' : 'mb-2.5 flex min-w-0 items-start justify-between gap-2'}">
      <div class="min-w-0">
        <h3 class="truncate text-sm font-semibold text-nodel-fg" data-link="title{:name}">{^{>title}}</h3>
        {^{if description}}<p class="mt-1 text-xs leading-5 text-nodel-muted">{^{>description}}</p>{{/if}}
        {^{if caution}}<p class="mt-1 text-xs leading-5 text-nodel-warning">{^{>caution}}</p>{{/if}}
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span class="nodel-actsig-form-icon" data-link="data-actsig-point-type{:pointType}" aria-hidden="true">{^{if busy}}${busyIconMarkup}{{else}}{^{:iconMarkup}}{{/if}}</span>
        <button type="button" class="nodel-button nodel-actsig-copy nodel-button-compact" data-link="data-actsig-copy-id{:id} title{:copyTitle} aria-label{:copyLabel}">${copyIconMarkup}</button>
        <button type="submit" class="nodel-button nodel-button-compact" data-link="disabled{:busy || !requestEligible || !materialized || !schemaForm || (pointType === 'event' && !~root.overrideSignals)} aria-busy{:busy} title{:name}">
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
                    <div class="nodel-collapse-content flex flex-col gap-3">
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

export class NodelActSig extends HTMLElement {
  private linked = false;
  private lifecycle = new ComponentLifecycle();
  private linkController = new JsViewsLinkController(this);
  private materializeTimers = new Map<string, number>();
  private pulseTimers = new Map<string, number>();
  private source: ReturnType<typeof subscribeNodeActivity> | null = null;
  private controller = new ActSigController({
    getActions: (init) => getNodeActions(init),
    getSignals: (init) => getNodeSignals(init),
    callAction: (name, payload, init) => callNodeAction(name, payload, init),
    emitSignal: (name, payload, init) => emitNodeSignal(name, payload, init)
  }, {
    setState: (values) => getJQuery().observable(this.state).setProperty(values),
    setForm: (form, values) => getJQuery().observable(form).setProperty(values),
    setSection: (section, values) => getJQuery().observable(section).setProperty(values)
  });
  private state: ActSigViewModel = this.controller.state;

  connectedCallback() {
    const scope = this.lifecycle.connect();
    if (scope) {
      void scope.run(() => this.initialize(scope), (error) => this.handleInitializationError(error));
    }
  }

  disconnectedCallback() {
    this.lifecycle.disconnect();
    this.controller.abort();
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

  refreshAfterRestart(): Promise<NodeRestartRefreshResult> {
    this.controller.clearFeedback();
    for (const timer of this.materializeTimers.values()) {
      window.clearTimeout(timer);
    }
    for (const timer of this.pulseTimers.values()) {
      window.clearTimeout(timer);
    }
    this.materializeTimers.clear();
    this.pulseTimers.clear();
    const scope = this.lifecycle.current;
    return scope ? this.loadDefinitions(scope) : Promise.resolve({ status: 'aborted', detail: 'Actions and signals component is disconnected.' });
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

  private async loadDefinitions(scope: ConnectionScope): Promise<NodeRestartRefreshResult> {
    const result = await this.controller.load({ signal: scope.signal, isCurrent: () => scope.isCurrent() });
    if (result.status === 'verified') {
      for (const section of this.state.sections) if (!section.grouped || section.open) this.materializeSection(section);
    }
    return result;
  }

  private materializeSection(section: ActSigSectionModel) {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    if (section.materializing || this.materializeTimers.has(section.id)) {
      return;
    }

    const forms = this.controller.formsNeedingMaterialization(section);
    if (forms.length === 0) {
      this.applyCachedArgsToSection(section);
      return;
    }

    this.controller.startMaterialization(section);
    let index = 0;

    const step = () => {
      if (!scope.isCurrent() || !this.state.sections.includes(section)) {
        this.materializeTimers.delete(section.id);
        return;
      }
      const end = Math.min(index + ACTSIG_MATERIALIZE_CHUNK_SIZE, forms.length);
      for (; index < end; index += 1) {
        const form = forms[index];
        if (form) {
          this.controller.materializeForm(form);
          this.applyCachedArgToForm(form);
          this.lifecycle.current?.setTimeout(() => this.applyCachedArgToForm(form), 0);
        }
      }

      if (index < forms.length) {
        const timer = scope.setTimeout(step, 0);
        if (timer !== null) {
          this.materializeTimers.set(section.id, timer);
        }
        return;
      }

      this.materializeTimers.delete(section.id);
      this.controller.finishMaterialization(section);
      this.applyCachedArgsToSection(section);
    };

    step();
  }

  private syncSignalFormReadOnlyState() {
    this.controller.syncSignalFormReadOnlyState();
  }

  private subscribeActivity(scope: ConnectionScope) {
    if (this.source) {
      return;
    }

    const source = subscribeNodeActivity(this, scope.guard((state) => {
      if (state.batch) {
        const result = this.controller.applyActivityEntries(state.batch.items.map((item) => item.entry), this.hydrationContext());
        this.syncSchemaFormControls(result.hydrated);
        for (const pulse of result.pulses) this.pulseForm(pulse.form, pulse.token, pulse.durationMs);
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

  private applyCachedArgsToSection(section: ActSigSectionModel) {
    const forms = this.controller.hydrateCachedForms(this.hydrationContextForSection(section));
    this.syncSchemaFormControls(forms);
  }

  private applyCachedArgToForm(form: ActSigFormModel) {
    const forms = this.controller.hydrateCachedForms(this.hydrationContextForForm(form));
    this.syncSchemaFormControls(forms);
  }

  private syncSchemaFormControls(forms: ActSigFormModel[]) {
    for (const form of forms) {
      if (!form.schemaForm) continue;
      const root = Array.from(this.querySelectorAll<HTMLFormElement>('[data-actsig-form-id]')).find((element) => element.dataset.actsigFormId === form.id);
      syncSchemaFormControls(form.schemaForm, root ?? this);
    }
  }

  private hydrationContext() {
    return { canHydrate: (section: ActSigSectionModel) => this.canHydrateSection(section) };
  }

  private hydrationContextForSection(section: ActSigSectionModel) {
    return { canHydrate: (candidate: ActSigSectionModel) => candidate === section && this.canHydrateSection(candidate) };
  }

  private hydrationContextForForm(form: ActSigFormModel) {
    return { canHydrate: (section: ActSigSectionModel) => section.rows.some((row) => row.action === form || row.event === form) && this.canHydrateSection(section) };
  }

  private canHydrateSection(section: ActSigSectionModel) {
    return section.open && !document.hidden && !this.isInHiddenPage();
  }

  private isInHiddenPage() {
    const page = this.closest('nodel-page');
    return page instanceof HTMLElement && page.hidden;
  }

  private findFormById(id: string) {
    return this.controller.findFormById(id);
  }

  private findSectionById(id: string) {
    return this.controller.findSectionById(id);
  }

  private findField(fieldId: string): SchemaField | null {
    return this.controller.findField(fieldId);
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
    if (!form) {
      return;
    }

    void this.submitForm(form, target);
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

  private async submitForm(form: ActSigFormModel, target: HTMLFormElement) {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const result = await this.controller.submit(form, { signal: scope.signal, isCurrent: () => scope.isCurrent() });
    if (result.type === 'invalid' && form.schemaForm) {
      revealSchemaValidationIssues(form.schemaForm, target);
    } else if (result.type === 'submitted') {
      this.dispatchEvent(new CustomEvent('nodel-actsig-submitted', { bubbles: true, detail: result.detail }));
    } else if (result.type === 'error') {
      this.dispatchEvent(new CustomEvent('nodel-actsig-error', { bubbles: true, detail: result.detail }));
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
          message: `${pointLabel.charAt(0).toUpperCase()}${pointLabel.slice(1)} name copied`,
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

  private pulseForm(form: ActSigFormModel, token: number, durationMs: number) {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const existing = this.pulseTimers.get(form.id);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timer = scope.setTimeout(() => {
      if (this.pulseTimers.get(form.id) !== timer) {
        return;
      }
      this.controller.completePulse(form, token);
      if (this.pulseTimers.get(form.id) === timer) {
        this.pulseTimers.delete(form.id);
      }
    }, durationMs);
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

if (!customElements.get('nodel-actsig')) {
  customElements.define('nodel-actsig', NodelActSig);
}
