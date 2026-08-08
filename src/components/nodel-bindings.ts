import { getNodeRemoteBindings, getNodeRemoteSchema, saveNodeRemoteBindings } from '../api/nodel-host-client';
import type { BindingOption } from '../features/bindings-model';
import { BindingLookupService } from '../features/bindings-lookup';
import { BindingsController, createBindingsViewModel, type BindingsViewModel } from '../features/bindings-controller';
import { subscribeNodeActivity } from '../data/node-activity-source';
import type { NodeRestartRefreshResult } from '../data/node-restart-source';
import { renderFontAwesomeIcon, uiIcons } from '../icons/fontawesome';
import { bootstrapJsViews, getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { renderComponentError } from '../utils/render-component-error';
import { activateActivePopoverOption, clearActivePopoverOption, getPopoverOptions, moveActivePopoverOption } from '../utils/popover-keyboard';
import { apiErrorMessage } from '../utils/errors';

const collapseIconMarkup = renderFontAwesomeIcon(uiIcons.chevronDown, 'h-3 w-3');

const template = `
  <div class="nodel-bindings" data-link="class{:loading ? 'nodel-bindings is-loading' : 'nodel-bindings'}">
    <form class="nodel-bindings-panel flex flex-col gap-3" data-bindings-form autocomplete="off">
      {^{if loading}}
        <div class="nodel-alert nodel-alert-md">Loading bindings...</div>
      {{else error}}
        <div class="nodel-alert nodel-alert-danger nodel-alert-md">{^{>error}}</div>
      {{else empty}}
        <div class="nodel-alert nodel-alert-md">No bindings.</div>
      {{else}}
        <fieldset class="flex flex-col gap-3" data-link="disabled{:saving}">
          <div class="nodel-bindings-toolbar-panel">
            <div class="nodel-bindings-toolbar">
              <div class="flex min-w-0 items-center gap-2">
                <input class="nodel-field nodel-field-compact min-w-0 flex-1" type="search" placeholder="Filter bindings" data-bindings-filter data-link="filter trigger=true" />
                <button type="button" class="nodel-button nodel-button-compact" data-bindings-clear-filter data-link="disabled{:!filter}">Clear</button>
              </div>
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <button type="button" class="nodel-button nodel-button-compact" data-bindings-select="visible">Select visible</button>
                <button type="button" class="nodel-button nodel-button-compact" data-bindings-select="unbound">Select unwired</button>
                <button type="button" class="nodel-button nodel-button-compact" data-bindings-select="clear">Clear selection</button>
              </div>
            </div>
            <div class="nodel-bindings-toolbar">
              <div class="nodel-bindings-combobox">
                <input class="nodel-field nodel-field-compact w-full" type="text" spellcheck="false" placeholder="Search node" data-bindings-bulk-node data-link="{:bulkNode:} aria-busy{:searchingBulkNode ? 'true' : 'false'}" />
                {^{if showBulkNodeOptions}}
                  <div class="nodel-bindings-popover nodel-popover">
                    {^{for bulkNodeOptions}}
                      <button type="button" class="nodel-menu-item" data-bindings-option="bulk-node" data-link="data-option-index{:#index} data-option-value{:value} data-option-address{:address}">
                        <span class="truncate">{^{>label}}</span>
                        {^{if detail}}<span class="truncate text-xs text-nodel-muted">{^{>detail}}</span>{{/if}}
                      </button>
                    {{/for}}
                  </div>
                {{/if}}
              </div>
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <button type="button" class="nodel-button nodel-button-compact" data-bindings-apply-node data-link="disabled{:selectedCount === 0 || !bulkNode}">Set node</button>
                <button type="button" class="nodel-button nodel-button-compact" data-bindings-suggest data-link="disabled{:selectedCount === 0 || busy}">
                  {^{if busy}}Suggesting...{{else}}Suggest matches{{/if}}
                </button>
                <button type="button" class="nodel-button nodel-button-primary nodel-button-compact" data-bindings-apply-suggestions data-link="disabled{:selectedCount === 0}">Apply suggestions</button>
              </div>
            </div>
            {^{if toolbarError}}<div class="nodel-alert nodel-alert-danger nodel-alert-sm">{^{>toolbarError}}</div>{{/if}}
            {^{if message}}<div class="nodel-alert nodel-alert-sm">{^{>message}}</div>{{/if}}
          </div>
          <div class="flex flex-col gap-3">
            {^{for sections}}
              <details class="nodel-bindings-section nodel-collapse nodel-panel" open data-link="data-bindings-section{:kind}">
                <summary class="nodel-collapse-summary">
                  <span class="nodel-collapse-label">{^{>title}}</span>
                  <span class="nodel-collapse-preview">{^{:selectedCount}} selected, {^{:unboundCount}} unwired</span>
                  <span class="nodel-collapse-icon" aria-hidden="true">${collapseIconMarkup}</span>
                </summary>
                <div class="nodel-collapse-content flex flex-col gap-2.5">
                  <div class="nodel-bindings-table" role="table">
                    <div class="nodel-bindings-header nodel-section-heading" role="row">
                      <span></span>
                      <span>Status</span>
                      <span>Name</span>
                      <span>Node</span>
                      <span>{^{>targetLabel}}</span>
                      <span>Suggestion</span>
                    </div>
                    {^{if visibleRows.length}}
                      {^{for visibleRows}}
                        <div class="nodel-bindings-row" role="row" data-link="data-bindings-row-id{:id}">
                          <label class="inline-flex h-8 items-center justify-center">
                            <input class="nodel-choice" type="checkbox" data-bindings-row-select data-link="selected" aria-label="Select binding" />
                          </label>
                           {^{if status === 'Wired' && statusHref}}
                             <a class="nodel-bindings-status nodel-link" data-link="href{:statusHref} aria-label{:statusLinkLabel} class{:statusClass + ' nodel-link'}">{^{>status}}</a>
                           {{else}}
                             <span class="nodel-bindings-status" data-link="class{:statusClass}">{^{>status}}</span>
                           {{/if}}
                          <span class="min-w-0">
                            <span class="block truncate font-semibold text-nodel-fg" data-link="title{:alias}">{^{>title}}</span>
                            <span class="block truncate text-xs text-nodel-muted">{^{>alias}}</span>
                            {^{if description}}<span class="block truncate text-xs text-nodel-muted">{^{>description}}</span>{{/if}}
                          </span>
                          <span class="nodel-bindings-combobox">
                             <input class="nodel-field nodel-field-compact w-full" type="text" spellcheck="false" placeholder="node" data-bindings-node data-link="{:node:} id{:id + '-node'} aria-busy{:searchingNode ? 'true' : 'false'} aria-invalid{:nodeError ? 'true' : 'false'} aria-describedby{:nodeError ? id + '-node-error' : ''}" />
                            {^{if showNodeOptions}}
                              <div class="nodel-bindings-popover nodel-popover">
                                {^{for nodeOptions}}
                                  <button type="button" class="nodel-menu-item" data-bindings-option="node" data-link="data-option-index{:#index} data-option-value{:value} data-option-address{:address}">
                                    <span class="truncate">{^{>label}}</span>
                                    {^{if detail}}<span class="truncate text-xs text-nodel-muted">{^{>detail}}</span>{{/if}}
                                  </button>
                                {{/for}}
                             </div>
                           {{/if}}
                            {^{if nodeError}}<span class="nodel-alert nodel-alert-danger nodel-alert-sm mt-1 block" role="alert" data-link="id{:id + '-node-error'} text{:nodeError}"></span>{{/if}}
                           </span>
                           <span class="nodel-bindings-combobox">
                              <input class="nodel-field nodel-field-compact w-full" type="text" spellcheck="false" data-bindings-target data-link="{:target:} id{:id + '-target'} placeholder{:targetLabel} aria-busy{:searchingTarget ? 'true' : 'false'} aria-invalid{:targetError ? 'true' : 'false'} aria-describedby{:targetError ? id + '-target-error' : ''}" />
                            {^{if showTargetOptions}}
                              <div class="nodel-bindings-popover nodel-popover">
                                {^{for targetOptions}}
                                  <button type="button" class="nodel-menu-item" data-bindings-option="target" data-link="data-option-index{:#index} data-option-value{:value}">
                                    <span class="truncate">{^{>label}}</span>
                                    {^{if detail}}<span class="truncate text-xs text-nodel-muted">{^{>detail}}</span>{{/if}}
                                  </button>
                                {{/for}}
                             </div>
                           {{/if}}
                            {^{if targetError}}<span class="nodel-alert nodel-alert-danger nodel-alert-sm mt-1 block" role="alert" data-link="id{:id + '-target-error'} text{:targetError}"></span>{{/if}}
                           </span>
                          <span class="nodel-bindings-suggestion" data-link="class{:suggestionClass}">
                            {^{if suggestionLabel}}{^{>suggestionLabel}}{{else}}-{{/if}}
                          </span>
                        </div>
                      {{/for}}
                    {{else}}
                      <div class="nodel-alert nodel-alert-sm">No bindings match the filter.</div>
                    {{/if}}
                  </div>
                </div>
              </details>
            {{/for}}
          </div>
        </fieldset>
        <div class="flex min-w-0 flex-wrap items-center gap-3">
             <button type="submit" class="nodel-button nodel-button-primary" data-link="disabled{:saving || invalid}">
            {^{if saving}}Saving...{{else}}Save{{/if}}
          </button>
          {^{if saveMessage}}<span class="text-sm text-nodel-muted">{^{>saveMessage}}</span>{{/if}}
        </div>
        {^{if saveError}}
          <div class="nodel-alert nodel-alert-danger nodel-alert-sm">{^{>saveError}}</div>
        {{/if}}
      {{/if}}
    </form>
  </div>
`;

function fallbackNodeOption(element: HTMLElement): BindingOption {
  const value = element.dataset.optionValue ?? '';
  return { value, label: value, address: element.dataset.optionAddress ?? '', detail: '' };
}

export class NodelBindings extends HTMLElement {
  private linked = false;
  private readonly lifecycle = new ComponentLifecycle();
  private readonly linkController = new JsViewsLinkController(this);
  private saveMessageTimer: number | null = null;
  private source: ReturnType<typeof subscribeNodeActivity> | null = null;
  private filterInput: HTMLInputElement | null = null;
  private readonly lookup = new BindingLookupService();
  private readonly state: BindingsViewModel = createBindingsViewModel();
  private readonly controller = new BindingsController({
    state: this.state,
    adapter: {
      setState: (values) => getJQuery().observable(this.state).setProperty(values),
      setRow: (row, values) => getJQuery().observable(row).setProperty(values),
      setSection: (section, values) => getJQuery().observable(section).setProperty(values),
      replaceVisibleRows: (section, rows) => getJQuery().observable(section.visibleRows).refresh(rows)
    },
    api: {
      getSchema: (options) => getNodeRemoteSchema(options),
      getValues: (options) => getNodeRemoteBindings(options),
      save: (payload, options) => saveNodeRemoteBindings(payload, options)
    },
    lookup: this.lookup
  });

  connectedCallback() {
    const scope = this.lifecycle.connect();
    if (scope) {
      void scope.run(() => this.initialize(scope), (error) => this.handleInitializationError(error));
    }
  }

  disconnectedCallback() {
    this.controller.clear();
    this.lifecycle.disconnect();
    this.unbindFilterInput();
    if (this.saveMessageTimer !== null) {
      window.clearTimeout(this.saveMessageTimer);
      this.saveMessageTimer = null;
    }
    this.linked = false;
  }

  private async initialize(scope: ConnectionScope) {
    await bootstrapJsViews();
    if (!scope.isCurrent()) return;
    const linked = await this.linkController.link(scope, template, this.state);
    if (!linked || !scope.isCurrent()) return;
    this.linked = true;
    scope.listen(this, 'submit', this.handleSubmit);
    scope.listen(this, 'input', this.handleInput);
    scope.listen(this, 'change', this.handleChange);
    scope.listen(this, 'mousedown', this.handleMouseDown);
    scope.listen(this, 'click', this.handleClick);
    scope.listen(this, 'keydown', this.handleKeydown);
    scope.listen(this, 'focusout', this.handleFocusOut);
    await this.loadBindings(scope);
    if (scope.isCurrent()) this.subscribeActivity(scope);
  }

  refreshAfterRestart(): Promise<NodeRestartRefreshResult> {
    const scope = this.lifecycle.current;
    return scope ? this.loadBindings(scope) : Promise.resolve({ status: 'aborted', detail: 'Bindings component is disconnected.' });
  }

  private async loadBindings(scope: ConnectionScope): Promise<NodeRestartRefreshResult> {
    const result = await this.controller.load(scope);
    if (scope.isCurrent()) this.bindFilterInput();
    return result;
  }

  private handleSubmit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-bindings-form')) return;
    event.preventDefault();
    if (this.state.saving || this.state.error || this.state.empty) return;
    void this.saveBindings();
  };

  private handleInput = (event: Event) => {
    const input = event.target;
    const scope = this.lifecycle.current;
    if (!(input instanceof HTMLInputElement) || !scope) return;
    if (input.hasAttribute('data-bindings-filter')) {
      this.controller.setFilter(input.value);
      return;
    }
    if (input.hasAttribute('data-bindings-bulk-node')) {
      this.controller.setBulkNode(input.value, scope);
      return;
    }
    const row = this.rowForElement(input);
    if (!row) return;
    if (input.hasAttribute('data-bindings-node')) {
      this.controller.editNode(row, input.value);
      this.controller.searchNode(row, input.value, scope);
    } else if (input.hasAttribute('data-bindings-target')) {
      this.controller.editTarget(row, input.value);
      this.controller.searchTarget(row, input.value, scope);
    }
  };

  private handleChange = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.hasAttribute('data-bindings-row-select')) return;
    const row = this.rowForElement(input);
    if (row) this.controller.selectRow(row, input.checked);
  };

  private handleFocusOut = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const combobox = target.closest<HTMLElement>('.nodel-bindings-combobox');
    const nextFocus = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (!combobox || (nextFocus && combobox.contains(nextFocus))) return;
    if (combobox.querySelector('[data-bindings-bulk-node]')) {
      this.controller.closeLookup(null, 'bulk-node');
      return;
    }
    const row = this.rowForElement(combobox);
    if (!row) return;
    if (combobox.querySelector('[data-bindings-node]')) this.controller.closeLookup(row, 'node');
    if (combobox.querySelector('[data-bindings-target]')) this.controller.closeLookup(row, 'target');
  };

  private handleKeydown = (event: KeyboardEvent) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !this.isAutocompleteInput(input)) return;
    const combobox = input.closest<HTMLElement>('.nodel-bindings-combobox');
    if (!combobox) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (moveActivePopoverOption(combobox, '[data-bindings-option]', event.key === 'ArrowDown' ? 1 : -1)) event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      if (activateActivePopoverOption(combobox, '[data-bindings-option]')) event.preventDefault();
      return;
    }
    if (event.key !== 'Escape') return;
    const row = this.rowForElement(input);
    const hasOptions = getPopoverOptions(combobox, '[data-bindings-option]').length > 0;
    const searching = input.hasAttribute('data-bindings-bulk-node') ? this.state.searchingBulkNode
      : input.hasAttribute('data-bindings-node') ? Boolean(row?.searchingNode) : Boolean(row?.searchingTarget);
    if (!hasOptions && !searching) return;
    event.preventDefault();
    if (hasOptions) clearActivePopoverOption(combobox, '[data-bindings-option]');
    this.closeAutocompleteForInput(input);
  };

  private handleMouseDown = (event: MouseEvent) => {
    const target = event.target;
    if (event.button === 0 && target instanceof Element && target.closest('[data-bindings-option]') && this.contains(target)) event.preventDefault();
  };

  private handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const option = target.closest<HTMLElement>('[data-bindings-option]');
    if (option && this.contains(option)) {
      this.applyOption(option);
      return;
    }
    if (target.closest('[data-bindings-clear-filter]') && this.contains(target)) {
      this.controller.clearFilter();
      return;
    }
    const select = target.closest<HTMLElement>('[data-bindings-select]');
    if (select && this.contains(select)) {
      const mode = select.dataset.bindingsSelect;
      if (mode === 'visible' || mode === 'unbound' || mode === 'clear') this.controller.selectRows(mode);
      return;
    }
    if (target.closest('[data-bindings-apply-node]') && this.contains(target)) {
      this.controller.applyBulkNode();
      return;
    }
    const scope = this.lifecycle.current;
    if (target.closest('[data-bindings-suggest]') && this.contains(target) && scope) {
      void this.controller.suggest(scope);
      return;
    }
    if (target.closest('[data-bindings-apply-suggestions]') && this.contains(target)) this.controller.applySuggestions();
  };

  private applyOption(element: HTMLElement) {
    const index = Number(element.dataset.optionIndex ?? '-1');
    if (index < 0) return;
    const type = element.dataset.bindingsOption;
    if (type === 'bulk-node') {
      this.controller.applyBulkOption(index, fallbackNodeOption(element));
      return;
    }
    const row = this.rowForElement(element);
    if (!row) return;
    if (type === 'node') {
      this.controller.applyNodeOption(row, index, fallbackNodeOption(element));
    } else if (type === 'target') {
      const value = element.dataset.optionValue ?? '';
      this.controller.applyTargetOption(row, index, { value, label: value, detail: '' });
    }
  }

  private isAutocompleteInput(input: HTMLInputElement) {
    return input.hasAttribute('data-bindings-bulk-node') || input.hasAttribute('data-bindings-node') || input.hasAttribute('data-bindings-target');
  }

  private closeAutocompleteForInput(input: HTMLInputElement) {
    if (input.hasAttribute('data-bindings-bulk-node')) {
      this.controller.closeLookup(null, 'bulk-node');
      return;
    }
    const row = this.rowForElement(input);
    if (!row) return;
    this.controller.closeLookup(row, input.hasAttribute('data-bindings-node') ? 'node' : 'target');
  }

  private async saveBindings() {
    const scope = this.lifecycle.current;
    if (!scope) return;
    const outcome = await this.controller.save(scope);
    if (!outcome || outcome.status === 'stale') return;
    if (outcome.status === 'error') {
      this.dispatchEvent(new CustomEvent('nodel-bindings-error', { bubbles: true, detail: { error: outcome.error, payload: outcome.payload } }));
      return;
    }
    this.dispatchEvent(new CustomEvent('nodel-bindings-saved', { bubbles: true, detail: { payload: outcome.payload } }));
    if (this.saveMessageTimer !== null) window.clearTimeout(this.saveMessageTimer);
    this.saveMessageTimer = scope.setTimeout(() => {
      this.controller.clearSaveMessage();
      this.saveMessageTimer = null;
    }, 2500);
  }

  private subscribeActivity(scope: ConnectionScope) {
    if (this.source) return;
    const source = subscribeNodeActivity(this, scope.guard((state) => {
      if (state.batch) this.controller.activityEntries(state.batch.items.map((item) => item.entry));
    }));
    this.source = source;
    scope.own(() => {
      source.dispose();
      if (this.source === source) this.source = null;
    });
  }

  private handleInitializationError(error: unknown) {
    if (this.linked) {
      this.controller.failInitialization(error);
    } else {
      this.dataset.state = 'error';
      renderComponentError(this, apiErrorMessage(error, 'Failed to initialize bindings'));
    }
  }

  private bindFilterInput() {
    this.unbindFilterInput();
    this.filterInput = this.querySelector<HTMLInputElement>('[data-bindings-filter]');
    this.filterInput?.addEventListener('search', this.handleFilterSearch);
  }

  private unbindFilterInput() {
    this.filterInput?.removeEventListener('search', this.handleFilterSearch);
    this.filterInput = null;
  }

  private handleFilterSearch = () => {
    this.filterInput?.dispatchEvent(new InputEvent('input', { bubbles: true }));
  };

  private rowForElement(element: Element) {
    const id = element.closest<HTMLElement>('[data-bindings-row-id]')?.dataset.bindingsRowId;
    return id ? this.state.sections.flatMap((section) => section.rows).find((row) => row.id === id) ?? null : null;
  }
}

if (!customElements.get('nodel-bindings')) customElements.define('nodel-bindings', NodelBindings);
