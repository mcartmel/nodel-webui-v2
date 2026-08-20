import {
  callNodeAction,
  emitNodeSignal,
  getNodeActions,
  getNodeSignals
} from '../api/nodel-host-client';
import { subscribeNodeActivity } from '../data/node-activity-source';
import type { NodeRestartRefreshResult } from '../data/node-restart-source';
import { logIcons, renderFontAwesomeIcon, uiIcons } from '../icons/fontawesome';
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
  setSchemaFormControlsDisabled,
  syncSchemaFormControls,
  synchronizeSchemaForm,
  type SchemaField,
} from '../schema/schema-form';
import { ActSigController } from '../features/actsig-controller';
import { ACTSIG_MATERIALIZE_CHUNK_SIZE, type ActSigFormModel, type ActSigSectionModel, type ActSigViewModel } from '../features/actsig-model';

const collapseIconMarkup = renderFontAwesomeIcon(uiIcons.chevronDown, 'h-3 w-3');
const busyIconMarkup = renderFontAwesomeIcon(uiIcons.spinner, 'h-4 w-4 animate-spin');
const copyIconMarkup = renderFontAwesomeIcon(uiIcons.copy, 'h-3.5 w-3.5');
const actionIconMarkup = renderFontAwesomeIcon(logIcons.action, 'h-4 w-4');
const eventIconMarkup = renderFontAwesomeIcon(logIcons.event, 'h-4 w-4');
const copyToastId = 'nodel-actsig-copy-name';
const refreshToastId = 'nodel-actsig-refresh-warning';
const activityCoalesceMs = 200;
const activityRetryMs = 5000;
const maxRefreshErrorDetail = 240;
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
        <span class="nodel-actsig-form-icon" data-link="data-actsig-point-type{:pointType}" aria-hidden="true">{^{if busy}}${busyIconMarkup}{{else pointType === 'action'}}${actionIconMarkup}{{else}}${eventIconMarkup}{{/if}}</span>
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
  private activityTimer: number | null = null;
  private activityRefresh: Promise<void> | null = null;
  private activityGeneration = 0;
  private pendingActivity = new Set<string>();
  private trailingActivity = new Set<string>();
  private lastActivityAttempt = -Infinity;
  private restartGeneration = 0;
  private activeRestartGeneration: number | null = null;
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
    this.cancelActivityScheduler();
    this.restartGeneration += 1;
    this.activeRestartGeneration = null;
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
    this.cancelActivityScheduler();
    const restartGeneration = ++this.restartGeneration;
    this.activeRestartGeneration = restartGeneration;
    this.controller.clearFeedback();
    this.clearPulseTimers();
    const scope = this.lifecycle.current;
    if (!scope) {
      if (this.activeRestartGeneration === restartGeneration) this.activeRestartGeneration = null;
      return Promise.resolve({ status: 'aborted', detail: 'Actions and signals component is disconnected.' });
    }
    return this.refreshDefinitions(scope, false, false).finally(() => {
      if (this.activeRestartGeneration === restartGeneration) this.activeRestartGeneration = null;
    });
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

    await this.refreshDefinitions(scope, true, false);
    if (scope.isCurrent()) {
      this.subscribeActivity(scope);
    }
  }

  private async refreshDefinitions(scope: ConnectionScope, initial: boolean, activity: boolean): Promise<NodeRestartRefreshResult> {
    const result = initial
      ? await this.controller.load({ signal: scope.signal, isCurrent: () => scope.isCurrent() })
      : await this.controller.refresh({ signal: scope.signal, isCurrent: () => scope.isCurrent() });
    if (result.status === 'verified' && result.changed) {
      this.clearMaterializationAndPulseTimers();
      for (const section of this.state.sections) if (!section.grouped || section.open) this.materializeSection(section);
      this.syncSchemaFormControls(this.controller.hydrateCachedForms(this.hydrationContext()));
    }
    if (!activity && scope.isCurrent() && result.status === 'verified') this.setState({ error: '' });
    if (!activity && scope.isCurrent() && result.status === 'failed') this.setState({ error: result.detail ?? 'Failed to refresh actions and signals' });
    if (activity && result.status === 'failed' && scope.isCurrent()) {
      this.dispatchActivityRefreshWarning(result.detail);
    }
    return result;
  }

  private clearMaterializationAndPulseTimers() {
    for (const timer of this.materializeTimers.values()) window.clearTimeout(timer);
    this.materializeTimers.clear();
    this.clearPulseTimers();
  }

  private clearPulseTimers() {
    for (const timer of this.pulseTimers.values()) window.clearTimeout(timer);
    this.pulseTimers.clear();
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
    for (const update of this.controller.syncSignalFormReadOnlyState()) {
      setSchemaFormControlsDisabled(update.form, update.controlsDisabled);
    }
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
        this.scheduleActivityRefresh(result.unseen);
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

  private scheduleActivityRefresh(identities: string[]) {
    if (!identities.length || this.activitySchedulingSuppressed()) return;
    for (const identity of identities) this.pendingActivity.add(identity);
    this.schedulePendingActivityRefresh();
  }

  private scheduleTrailingActivityRefresh() {
    if (!this.pendingActivity.size || this.activitySchedulingSuppressed()) return;
    this.schedulePendingActivityRefresh();
  }

  private schedulePendingActivityRefresh() {
    if (this.activityRefresh || this.activityTimer !== null) return;
    const scope = this.lifecycle.current;
    if (!scope) return;
    const delay = Math.max(activityCoalesceMs, this.lastActivityAttempt + activityRetryMs - Date.now());
    const timer = scope.setTimeout(() => {
      if (this.activityTimer !== timer) return;
      this.activityTimer = null;
      void this.runActivityRefresh(scope);
    }, delay);
    if (timer !== null) this.activityTimer = timer;
  }

  private async runActivityRefresh(scope: ConnectionScope) {
    if (this.activityRefresh || !this.pendingActivity.size || !scope.isCurrent() || this.activitySchedulingSuppressed()) return;
    const generation = this.activityGeneration;
    this.pendingActivity.clear();
    this.lastActivityAttempt = Date.now();
    const operation = (async () => {
      const result = await this.refreshDefinitions(scope, false, true);
      if (generation !== this.activityGeneration) return;
      this.activityRefresh = null;
      if (result.status === 'verified') {
        const trailing = new Set<string>();
        for (const identity of this.pendingActivity) {
          if (this.trailingActivity.has(identity)) continue;
          const [pointType, name] = this.activityIdentity(identity);
          if (!this.controller.isPointKnown(pointType, name)) trailing.add(identity);
        }
        this.pendingActivity = trailing;
        if (trailing.size) {
          for (const identity of trailing) this.trailingActivity.add(identity);
          this.scheduleTrailingActivityRefresh();
        } else {
          this.trailingActivity.clear();
        }
      } else if (result.status === 'failed') {
        // Drop failed identities so only a later unseen activity batch can explicitly
        // trigger the next cooldown-bounded discovery attempt.
        this.pendingActivity.clear();
        this.trailingActivity.clear();
      }
    })();
    this.activityRefresh = operation;
    await operation;
  }

  private cancelActivityScheduler() {
    this.activityGeneration += 1;
    if (this.activityTimer !== null) window.clearTimeout(this.activityTimer);
    this.activityTimer = null;
    this.pendingActivity.clear();
    this.trailingActivity.clear();
    this.activityRefresh = null;
    this.lastActivityAttempt = -Infinity;
  }

  private activitySchedulingSuppressed() {
    return this.activeRestartGeneration !== null;
  }

  private activityIdentity(identity: string): ['action' | 'event', string] {
    const separator = identity.indexOf('|');
    return [identity.slice(0, separator) as 'action' | 'event', identity.slice(separator + 1)];
  }

  private dispatchActivityRefreshWarning(detail?: string) {
    this.dispatchEvent(new CustomEvent<NodelToastDetail>(NODEL_TOAST, {
      bubbles: true,
      detail: {
        id: refreshToastId,
        message: 'Actions and signals may be out of date',
        ...(detail ? { detail: detail.slice(0, maxRefreshErrorDetail) } : {}),
        tone: 'warning',
        durationMs: 7000
      }
    }));
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
      synchronizeSchemaForm(form.schemaForm);
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
      synchronizeSchemaForm(form.schemaForm);
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
