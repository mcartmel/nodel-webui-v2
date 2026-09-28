import { getNodeRemoteBindings, getNodeRemoteSchema, saveNodeRemoteBindings } from '../api/nodel-host-client';
import type { BindingOption } from '../features/bindings-model';
import { BindingLookupService } from '../features/bindings-lookup';
import { BindingsController, createBindingsViewModel, type BindingsViewModel } from '../features/bindings-controller';
import { subscribeNodeActivity } from '../data/node-activity-source';
import type { NodeRestartRefreshResult } from '../data/node-restart-source';
import { bootstrapJsViews, getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { renderComponentError } from '../utils/render-component-error';
import { activateActivePopoverOption, clearActivePopoverOption, getPopoverOptions, moveActivePopoverOption } from '../utils/popover-keyboard';
import { apiErrorMessage } from '../utils/errors';
import { requestConfirm } from '../data/confirm';
import { NodeAddressResolver, networkNodeSearchHref } from '../navigation/node-links';
import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons/faArrowUpRightFromSquare';
import { renderFontAwesomeIcon } from '../icons/fontawesome';
import '../components/nodel-collapse';

const openNodeIcon = renderFontAwesomeIcon(faArrowUpRightFromSquare);

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
          <div class="nodel-bindings-toolbar-panel nodel-card relative z-10 flex flex-col gap-2 p-4">
            <div class="nodel-bindings-toolbar nodel-bindings-filter-toolbar grid min-w-0 items-end gap-2">
              <label class="grid min-w-0 gap-1 text-xs font-medium text-nodel-muted"><span>Filter bindings</span><input class="nodel-field nodel-field-compact min-w-0 w-full" type="search" data-bindings-filter data-link="filter trigger=true" /></label>
              <label class="grid min-w-0 gap-1 text-xs font-medium text-nodel-muted"><span>Saved binding status</span><select class="nodel-field nodel-field-compact" aria-label="Saved binding status" data-bindings-status-filter data-link="statusFilter"><option>All</option><option>Unset</option><option>Unwired</option><option>Wired</option><option>Unknown</option></select></label>
              <button type="button" class="nodel-button nodel-button-compact" data-bindings-clear-filter data-link="disabled{:!filter && statusFilter === 'All'}">Clear filters</button>
              <button type="button" class="nodel-button nodel-button-compact" data-bindings-refresh>Refresh results</button>
            </div>
            <div class="nodel-bindings-meta min-w-0 text-xs">
              <span class="text-xs text-nodel-muted" aria-live="polite" aria-atomic="true">{^{if hasFilter}}{^{:visibleCount}} of {^{:totalCount}}{{else}}{^{:totalCount}}{{/if}} bindings{^{if selectedCount}}; {^{:selectedCount}} selected{{/if}}{^{if changedCount}}; {^{:changedCount}} changed{^{if changedOutsideResultsCount}}, {^{:changedOutsideResultsCount}} hidden{{/if}}{{/if}}</span>
            </div>
            {^{if resultsChanged}}<p class="m-0 text-sm text-nodel-warning" role="status">Results changed. Refresh results to update this list.</p>{{/if}}
            <div class="nodel-bindings-toolbar nodel-bindings-selection-toolbar grid min-w-0 items-end gap-2">
              <div class="col-span-full grid w-fit max-w-full grid-cols-3 items-center gap-2">
                <button type="button" class="nodel-button nodel-button-compact min-w-0" data-bindings-select="visible" data-link="disabled{:!canSelectVisible}">{^{if hasFilter}}Select filtered{{else}}Select all{{/if}}</button>
                <button type="button" class="nodel-button nodel-button-compact min-w-0" data-bindings-select="unset" data-link="disabled{:!canSelectUnset}">Select Unset</button>
                <button type="button" class="nodel-button nodel-button-compact min-w-0" data-bindings-select="clear" data-link="disabled{:!selectedCount}">Clear selection</button>
              </div>
            </div>
            <h3 class="col-span-full m-0 text-sm font-semibold text-nodel-fg">Edit selected bindings</h3>
            <div class="nodel-bindings-toolbar nodel-bindings-edit-toolbar grid min-w-0 items-end gap-2">
              <div class="col-start-1 grid min-w-0 gap-1 text-xs font-medium text-nodel-muted"><label data-link="for{:instanceId + '-bulk-node'}">Node to set on selected bindings</label><span class="nodel-bindings-combobox relative min-w-0">
                <input class="nodel-field nodel-field-compact w-full" type="text" spellcheck="false" data-bindings-bulk-node aria-label="Node to set on selected bindings" data-link="{:bulkNode:} id{:instanceId + '-bulk-node'} aria-busy{:searchingBulkNode ? 'true' : 'false'}" />
                {^{if showBulkNodeOptions}}
                  <div class="nodel-bindings-popover nodel-popover absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-auto p-1">
                    {^{for bulkNodeOptions}}
                      <button type="button" class="nodel-menu-item flex w-full flex-col items-start gap-0.5 text-left" data-bindings-option="bulk-node" data-link="data-option-index{:#index} data-option-value{:value} data-option-address{:address}">
                        <span class="truncate">{^{>label}}</span>
                        {^{if detail}}<span class="truncate text-xs text-nodel-muted">{^{>detail}}</span>{{/if}}
                      </button>
                    {{/for}}
                  </div>
                {{/if}}
              </span></div>
              <div class="nodel-bindings-bulk-actions col-start-2 col-span-3 grid min-w-0 grid-cols-3 items-center gap-2">
                  <button type="button" class="nodel-button nodel-button-compact min-w-0" data-bindings-apply-node data-link="disabled{:selectedCount === 0 || !bulkNode}">Set node for {^{:selectedCount}} bindings</button>
                  <button type="button" class="nodel-button nodel-button-compact min-w-0" data-bindings-suggest data-link="disabled{:selectedCount === 0 || busy}">
                  {^{if busy}}Suggesting...{{else}}Suggest matches{{/if}}
                </button>
                  <button type="button" class="nodel-button nodel-button-compact min-w-0" data-bindings-apply-suggestions data-link="disabled{:suggestionCount === 0 || busy}">Apply {^{:suggestionCount}} suggestions</button>
              </div>
            </div>
            {^{if toolbarError}}<div class="nodel-alert nodel-alert-danger nodel-alert-sm">{^{>toolbarError}}</div>{{/if}}
            {^{if message}}<div class="nodel-alert nodel-alert-sm" role="status">{^{>message}}</div>{{/if}}
            {^{if restartNotice}}<div class="nodel-alert nodel-alert-sm" role="status">{^{>restartNotice}}</div>{{/if}}
          </div>
          <div class="flex flex-col gap-3">
            {^{for sections}}
              <nodel-collapse class="nodel-bindings-section" data-link="label{:title} preview{: visibleCount + ' results, ' + selectedCount + ' selected, ' + changedCount + ' changed, ' + invalidCount + ' invalid'} data-bindings-section{:kind}">
                <div class="nodel-bindings-collapse-body flex flex-col gap-2.5">
                  <div class="nodel-bindings-table min-w-0 space-y-1.5" role="table">
                    <div class="nodel-bindings-header nodel-section-heading min-w-0 gap-2 px-2" role="row">
                      <span role="columnheader"><span class="sr-only">Select</span></span>
                      <span role="columnheader">Saved status</span>
                      <span role="columnheader">Name</span>
                      <span role="columnheader">Node</span>
                      <span role="columnheader">{^{>targetLabel}}</span>
                      <span role="columnheader">Suggestion</span>
                    </div>
                    {^{if visibleRows.length}}
                      {^{for visibleRows}}
                        <div class="nodel-bindings-row nodel-card grid min-w-0 items-start gap-2 px-2 py-2 text-13 leading-5" role="row" data-link="data-bindings-row-id{:id}">
                          <label class="inline-flex h-8 items-center justify-center" role="cell">
                            <input class="nodel-choice" type="checkbox" data-bindings-row-select data-link="checked{:selected} aria-label{: 'Select ' + title + ' (' + alias + ')'}" />
                          </label>
                           <span class="nodel-bindings-status" role="cell" data-link="class{:statusClass}" aria-label="Saved binding status">{^{>status}}</span>
                          <span class="min-w-0" role="cell">
                              <span class="block truncate font-semibold text-nodel-fg" data-link="title{:alias}">{^{>title}} {^{if changed}}<span class="ml-1 rounded-control bg-nodel-accent/10 px-1.5 py-0.5 text-xs font-medium text-nodel-accent">Changed</span>{{/if}}</span>
                            <span class="block truncate text-xs text-nodel-muted">{^{>alias}}</span>
                            {^{if description}}<span class="block truncate text-xs text-nodel-muted">{^{>description}}</span>{{/if}}
                          </span>
                           <span class="nodel-bindings-combobox relative min-w-0" role="cell">
                                   <label class="nodel-bindings-mobile-label text-xs font-medium text-nodel-muted" data-link="for{:~root.instanceId + '-' + id + '-node'}">Node</label><span class="nodel-bindings-node-field relative block min-w-0"><input class="nodel-field w-full" type="text" spellcheck="false" data-bindings-node data-link="{:node:} id{:~root.instanceId + '-' + id + '-node'} aria-label{: 'Node for ' + title} aria-busy{:searchingNode ? 'true' : 'false'} aria-invalid{:nodeError ? 'true' : 'false'} aria-describedby{:nodeError ? ~root.instanceId + '-' + id + '-node-error' : ''}" />
                                   <a class="nodel-bindings-open-node nodel-button nodel-button-compact nodel-button-ghost absolute inset-y-px right-px w-9 min-h-0 p-0" data-bindings-open-node data-link="class{: 'nodel-bindings-open-node nodel-button nodel-button-compact nodel-button-ghost absolute inset-y-px right-px w-9 min-h-0 p-0' + (!statusHref ? ' hidden' : '')} href{:statusHref} aria-label{: 'Open node ' + node}" title="Open this node, or search Network when a direct address is unavailable">${openNodeIcon}</a></span>
                            {^{if showNodeOptions}}
                              <div class="nodel-bindings-popover nodel-popover absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-auto p-1">
                                {^{for nodeOptions}}
                                  <button type="button" class="nodel-menu-item flex w-full flex-col items-start gap-0.5 text-left" data-bindings-option="node" data-link="data-option-index{:#index} data-option-value{:value} data-option-address{:address}">
                                    <span class="truncate">{^{>label}}</span>
                                    {^{if detail}}<span class="truncate text-xs text-nodel-muted">{^{>detail}}</span>{{/if}}
                                  </button>
                                {{/for}}
                             </div>
                           {{/if}}
                             {^{if nodeError}}<span class="nodel-alert nodel-alert-danger nodel-alert-sm mt-1 block" role="alert" data-link="id{:~root.instanceId + '-' + id + '-node-error'} text{:nodeError}"></span>{{/if}}
                           </span>
                           <span class="nodel-bindings-combobox relative min-w-0" role="cell">
                                  <label class="nodel-bindings-mobile-label text-xs font-medium text-nodel-muted" data-link="for{:~root.instanceId + '-' + id + '-target'}">{^{>targetLabel}}</label><input class="nodel-field w-full" type="text" spellcheck="false" data-bindings-target data-link="{:target:} id{:~root.instanceId + '-' + id + '-target'} aria-label{: targetLabel + ' for ' + title} aria-busy{:searchingTarget ? 'true' : 'false'} aria-invalid{:targetError ? 'true' : 'false'} aria-describedby{:targetError ? ~root.instanceId + '-' + id + '-target-error' : ''}" />
                            {^{if showTargetOptions}}
                              <div class="nodel-bindings-popover nodel-popover absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-auto p-1">
                                {^{for targetOptions}}
                                  <button type="button" class="nodel-menu-item flex w-full flex-col items-start gap-0.5 text-left" data-bindings-option="target" data-link="data-option-index{:#index} data-option-value{:value}">
                                    <span class="truncate">{^{>label}}</span>
                                    {^{if detail}}<span class="truncate text-xs text-nodel-muted">{^{>detail}}</span>{{/if}}
                                  </button>
                                {{/for}}
                             </div>
                           {{/if}}
                             {^{if targetError}}<span class="nodel-alert nodel-alert-danger nodel-alert-sm mt-1 block" role="alert" data-link="id{:~root.instanceId + '-' + id + '-target-error'} text{:targetError}"></span>{{/if}}
                           </span>
                           <span class="nodel-bindings-suggestion" role="cell" data-link="class{:suggestionClass}">
                            {^{if suggestionLabel}}{^{>suggestionLabel}}{{else}}-{{/if}}
                          </span>
                        </div>
                      {{/for}}
                    {{else}}
                      <div class="nodel-alert nodel-alert-sm">No bindings match the filter.</div>
                    {{/if}}
                  </div>
                </div>
              </nodel-collapse>
            {{/for}}
          </div>
        </fieldset>
        <div class="flex min-w-0 flex-wrap items-center gap-3">
             <button type="submit" class="nodel-button nodel-button-primary nodel-button-compact" data-bindings-save data-link="disabled{:saving || invalid || !changedCount}">
            {^{if saving}}Saving...{{else}}Save changes{{/if}}
          </button>
           <button type="button" class="nodel-button nodel-button-danger nodel-button-compact" data-bindings-revert data-link="disabled{:saving || !changedCount}">Revert changes</button>
           {^{if invalid}}<div class="nodel-alert nodel-alert-danger" role="status">{^{:invalidCount}} invalid binding rows prevent saving. <button type="button" class="nodel-button nodel-button-ghost nodel-button-compact" data-bindings-show-invalid>Show invalid bindings</button></div>{{/if}}
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
  private static nextInstanceId = 0;
  private linked = false;
  private readonly lifecycle = new ComponentLifecycle();
  private readonly linkController = new JsViewsLinkController(this);
  private saveMessageTimer: number | null = null;
  private source: ReturnType<typeof subscribeNodeActivity> | null = null;
  private filterInput: HTMLInputElement | null = null;
  private readonly lookup = new BindingLookupService();
  private readonly state = Object.assign(createBindingsViewModel(), { instanceId: `bindings-${++NodelBindings.nextInstanceId}`, hasFilter: false, canSelectVisible: false, canSelectUnset: false }) as BindingsViewModel;
  private resolver = new NodeAddressResolver();
  private resolverDisposed = false;
  private readonly linkRequests = new Map<string, { request: AbortController; name: string; row: BindingsViewModel['sections'][number]['rows'][number] }>();
  private linkDebounce: number | null = null;
  private wasFiltered = false;
  private readonly disclosureBeforeFilter = new Map<string, boolean>();
  private readonly disclosureOverrides = new Map<string, boolean>();
  private readonly programmaticDisclosure = new Map<string, boolean>();
  private readonly controller = new BindingsController({
    state: this.state,
    adapter: {
      setState: (values) => { getJQuery().observable(this.state).setProperty(values); this.syncUiCounts(); },
      setRow: (row, values) => { getJQuery().observable(row).setProperty(values); this.syncUiCounts(); },
      setSection: (section, values) => { getJQuery().observable(section).setProperty(values); this.syncUiCounts(); },
      replaceVisibleRows: (section, rows) => { getJQuery().observable(section.visibleRows).refresh(rows); this.syncUiCounts(); }
    },
    api: {
      getSchema: (options) => getNodeRemoteSchema(options),
      getValues: (options) => getNodeRemoteBindings(options),
      save: (payload, options) => saveNodeRemoteBindings(payload, options)
    },
    lookup: this.lookup
  });

  connectedCallback() {
    if (this.resolverDisposed) {
      this.resolver = new NodeAddressResolver();
      this.resolverDisposed = false;
    }
    const scope = this.lifecycle.connect();
    if (scope) {
      void scope.run(() => this.initialize(scope), (error) => this.handleInitializationError(error));
    }
  }

  disconnectedCallback() {
    this.controller.clear();
    this.clearNodeLinks(true);
    this.resolver.dispose();
    this.resolverDisposed = true;
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
    scope.listen(this, 'nodel-collapse-toggle', this.handleDisclosureToggle);
    await this.loadBindings(scope);
    if (scope.isCurrent()) {
      this.scheduleNodeLinks(0);
    }
    if (scope.isCurrent()) this.subscribeActivity(scope);
  }

  refreshAfterRestart(): Promise<NodeRestartRefreshResult> {
    const scope = this.lifecycle.current;
    if (!scope) return Promise.resolve({ status: 'aborted', detail: 'Bindings component is disconnected.' });
    this.clearNodeLinks();
    const preserved = this.controller.preserveAfterRestart();
    if (preserved) {
      this.scheduleNodeLinks();
      return Promise.resolve(preserved);
    }
    return this.loadBindings(scope).then((result) => {
      if (scope.isCurrent() && result.status === 'verified') this.scheduleNodeLinks();
      return result;
    });
  }

  private async loadBindings(scope: ConnectionScope): Promise<NodeRestartRefreshResult> {
    const result = await this.controller.load(scope);
    if (scope.isCurrent() && result.status !== 'superseded') {
      this.bindFilterInput();
      this.clearNodeLinks();
      if (result.status === 'verified') {
        this.wasFiltered = false;
        this.disclosureBeforeFilter.clear();
        this.disclosureOverrides.clear();
        this.programmaticDisclosure.clear();
        this.initializeDisclosures();
      }
    }
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
      this.syncFilteredDisclosures(true);
      this.scheduleNodeLinks(0);
      return;
    }
    if (input.hasAttribute('data-bindings-status-filter')) {
      this.controller.setStatusFilter(input.value as BindingsViewModel['statusFilter']);
      this.syncFilteredDisclosures(true);
      this.scheduleNodeLinks(0);
      return;
    }
    if (input.hasAttribute('data-bindings-bulk-node')) {
      this.controller.setBulkNode(input.value, scope);
      return;
    }
    const row = this.rowForElement(input);
    if (!row) return;
    if (input.hasAttribute('data-bindings-node')) {
      this.clearRowNodeLink(input);
      this.controller.editNode(row, input.value);
      this.controller.searchNode(row, input.value, scope);
      this.scheduleNodeLinks();
    } else if (input.hasAttribute('data-bindings-target')) {
      this.controller.editTarget(row, input.value);
      this.controller.searchTarget(row, input.value, scope);
    }
  };

  private handleChange = (event: Event) => {
    const input = event.target;
    if (input instanceof HTMLSelectElement && input.hasAttribute('data-bindings-status-filter')) {
      this.controller.setStatusFilter(input.value as BindingsViewModel['statusFilter']);
      this.syncFilteredDisclosures(true);
      this.scheduleNodeLinks(0);
      return;
    }
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
    if (!(input instanceof HTMLInputElement)) return;
    if (event.key === 'Enter' && input.hasAttribute('data-bindings-filter')) {
      event.preventDefault();
      return;
    }
    if (!this.isAutocompleteInput(input)) return;
    const combobox = input.closest<HTMLElement>('.nodel-bindings-combobox');
    if (!combobox) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (moveActivePopoverOption(combobox, '[data-bindings-option]', event.key === 'ArrowDown' ? 1 : -1)) event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      const activated = activateActivePopoverOption(combobox, '[data-bindings-option]');
      if (activated || input.hasAttribute('data-bindings-bulk-node')) event.preventDefault();
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
      const selector = this.querySelector<HTMLSelectElement>('[data-bindings-status-filter]');
      if (selector) selector.value = 'All';
      this.controller.setStatusFilter('All');
      this.syncFilteredDisclosures(true);
      this.scheduleNodeLinks(0);
      return;
    }
    if (target.closest('[data-bindings-refresh]') && this.contains(target)) {
      this.controller.refreshResults();
      this.syncFilteredDisclosures(true);
      this.clearNodeLinks();
      this.scheduleNodeLinks();
      return;
    }
    const select = target.closest<HTMLElement>('[data-bindings-select]');
    if (select && this.contains(select)) {
      const mode = select.dataset.bindingsSelect;
      if (mode === 'visible' || mode === 'unset' || mode === 'clear') this.controller.selectRows(mode);
      return;
    }
    if (target.closest('[data-bindings-apply-node]') && this.contains(target)) {
      this.controller.applyBulkNode();
      this.clearNodeLinks();
      this.scheduleNodeLinks(0);
      return;
    }
    const scope = this.lifecycle.current;
    if (target.closest('[data-bindings-suggest]') && this.contains(target) && scope) {
      void this.controller.suggest(scope);
      return;
    }
    if (target.closest('[data-bindings-apply-suggestions]') && this.contains(target)) this.controller.applySuggestions();
    if (target.closest('[data-bindings-revert]') && this.contains(target)) void this.revertChanges(target as HTMLElement);
    if (target.closest('[data-bindings-show-invalid]') && this.contains(target)) this.showInvalidBindings();
  };

  private applyOption(element: HTMLElement) {
    const index = Number(element.dataset.optionIndex ?? '-1');
    if (index < 0) return;
    const type = element.dataset.bindingsOption;
    if (type === 'bulk-node') {
      this.controller.applyBulkOption(index, fallbackNodeOption(element));
      this.clearNodeLinks();
      this.scheduleNodeLinks(0);
      return;
    }
    const row = this.rowForElement(element);
    if (!row) return;
    if (type === 'node') {
      this.controller.applyNodeOption(row, index, fallbackNodeOption(element));
      this.clearNodeLinks();
      this.scheduleNodeLinks(0);
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
      if (state.batch) {
        const freshBindings = new Set(state.batch.items
          .filter((item) => item.changed || item.live)
          .filter(({ entry }) => entry.type === 'actionBinding' || entry.type === 'eventBinding')
          .map(({ entry }) => `${entry.type === 'actionBinding' ? 'actions' : 'events'}:${String(entry.alias ?? '')}`));
        this.controller.activityEntries(state.batch.items.map((item) => item.entry), freshBindings);
      }
      else if (!state.connected && !state.loading) this.controller.activityUnavailable();
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

  private syncUiCounts() {
    const rows = this.state.sections.flatMap((section) => section.rows);
    const visibleRows = this.state.sections.flatMap((section) => section.visibleRows);
    // JsViews does not track string-method calls in template conditions.
    getJQuery().observable(this.state).setProperty({
      hasFilter: Boolean(this.state.filter.trim() || this.state.statusFilter !== 'All'),
      totalCount: rows.length,
      canSelectVisible: visibleRows.length > 0,
      canSelectUnset: visibleRows.some((row) => row.status === 'Unset')
    } as Partial<BindingsViewModel>);
  }

  private initializeDisclosures() {
    for (const section of this.querySelectorAll<HTMLElement>('[data-bindings-section]')) {
      if (!section.hasAttribute('open')) section.setAttribute('open', '');
    }
  }

  private handleDisclosureToggle = (event: CustomEvent<{ open?: boolean }>) => {
    const section = event.target;
    if (!(section instanceof HTMLElement) || !section.matches('[data-bindings-section]')) return;
    const kind = section.dataset.bindingsSection ?? '';
    const open = Boolean(event.detail?.open);
    if (this.programmaticDisclosure.get(kind) === open) {
      this.programmaticDisclosure.delete(kind);
      return;
    }
    if (this.wasFiltered) this.disclosureOverrides.set(kind, open);
  };

  private syncFilteredDisclosures(explicit: boolean) {
    const filtered = Boolean(this.state.filter.trim() || this.state.statusFilter !== 'All');
    const disclosures = Array.from(this.querySelectorAll<HTMLElement>('[data-bindings-section]'));
    if (filtered && !this.wasFiltered) {
      this.disclosureBeforeFilter.clear();
      this.disclosureOverrides.clear();
      for (const disclosure of disclosures) this.disclosureBeforeFilter.set(disclosure.dataset.bindingsSection ?? '', disclosure.hasAttribute('open'));
    }
    if (filtered && explicit) {
      for (const disclosure of disclosures) {
        const kind = disclosure.dataset.bindingsSection ?? '';
        const hasMatches = this.state.sections.find((item) => item.kind === kind)?.visibleRows.length;
        if (hasMatches) this.setDisclosureOpen(disclosure, true);
      }
    } else if (!filtered && this.wasFiltered) {
      for (const disclosure of disclosures) {
        const kind = disclosure.dataset.bindingsSection ?? '';
        this.setDisclosureOpen(disclosure, this.disclosureOverrides.get(kind) ?? this.disclosureBeforeFilter.get(kind) ?? true);
      }
      this.disclosureOverrides.clear();
    }
    this.wasFiltered = filtered;
  }

  private setDisclosureOpen(disclosure: HTMLElement, open: boolean) {
    const kind = disclosure.dataset.bindingsSection ?? '';
    if (disclosure.hasAttribute('open') === open) return;
    this.programmaticDisclosure.set(kind, open);
    if (open) disclosure.setAttribute('open', '');
    else disclosure.removeAttribute('open');
  }

  private async revertChanges(trigger: HTMLElement) {
    if (!this.state.changedCount || this.state.saving) return;
    const revision = this.controller.getRevision();
    const hidden = this.state.changedOutsideResultsCount;
    const text = `Discard ${this.state.changedCount} changed binding${this.state.changedCount === 1 ? '' : 's'} locally${hidden ? `, including ${hidden} hidden from the results` : ''}? This does not reload or write configuration.`;
    const confirmed = await requestConfirm(this, { title: 'Revert binding changes', text, confirmLabel: 'Revert changes', tone: 'danger' }, trigger, this.lifecycle.current?.signal);
    if (!confirmed || !this.controller.revert(revision)) return;
    this.clearNodeLinks();
    this.syncFilteredDisclosures(true);
    this.scheduleNodeLinks();
  }

  private showInvalidBindings() {
    this.controller.setFilter('');
    this.controller.setStatusFilter('All');
    this.controller.validate(true);
    getJQuery().observable(this.state).setProperty({ message: 'Filters cleared. Showing invalid bindings.' });
    const filter = this.querySelector<HTMLInputElement>('[data-bindings-filter]');
    if (filter) filter.value = '';
    const status = this.querySelector<HTMLSelectElement>('[data-bindings-status-filter]');
    if (status) status.value = 'All';
    this.controller.refreshResults();
    this.syncFilteredDisclosures(true);
    this.scheduleNodeLinks();
    for (const section of this.querySelectorAll<HTMLElement>('[data-bindings-section]')) {
      const kind = section.dataset.bindingsSection;
      if (this.state.sections.find((item) => item.kind === kind)?.rows.some((row) => row.nodeError || row.targetError)) this.setDisclosureOpen(section, true);
    }
    window.setTimeout(() => this.querySelector<HTMLElement>('[data-bindings-node][aria-invalid="true"], [data-bindings-target][aria-invalid="true"]')?.focus(), 0);
  }

  private scheduleNodeLinks(delay = 180) {
    const visible = new Set(this.state.sections.flatMap((section) => section.visibleRows));
    for (const [id, pending] of this.linkRequests) {
      if (visible.has(pending.row) && pending.row.node === pending.name) continue;
      pending.request.abort();
      this.linkRequests.delete(id);
    }
    if (this.linkDebounce !== null) window.clearTimeout(this.linkDebounce);
    this.linkDebounce = window.setTimeout(() => {
      this.linkDebounce = null;
      for (const link of this.querySelectorAll<HTMLAnchorElement>('[data-bindings-open-node]')) {
        const row = this.rowForElement(link);
        const name = row?.node ?? '';
        const fallback = networkNodeSearchHref(name);
        if (!row || !name || !fallback) {
          if (row) getJQuery().observable(row).setProperty({ statusHref: '' });
          else link.removeAttribute('href');
          continue;
        }
        const existing = this.linkRequests.get(row.id);
        if (existing?.row === row && existing.name === name) continue;
        existing?.request.abort();
        getJQuery().observable(row).setProperty({ statusHref: fallback });
        const request = new AbortController();
        const pending = { request, name, row };
        this.linkRequests.set(row.id, pending);
        void this.resolver.resolve(name, { signal: request.signal }).then((address) => {
          if (!this.isConnected || request.signal.aborted || this.linkRequests.get(row.id) !== pending || row.node !== name
            || !this.state.sections.some((section) => section.visibleRows.includes(row))) return;
          getJQuery().observable(row).setProperty({ statusHref: address || fallback });
        });
      }
    }, delay);
  }

  private clearRowNodeLink(input: HTMLInputElement) {
    const rowId = input.closest<HTMLElement>('[data-bindings-row-id]')?.dataset.bindingsRowId;
    if (rowId) {
      this.linkRequests.get(rowId)?.request.abort();
      this.linkRequests.delete(rowId);
    }
    const rowElement = input.closest<HTMLElement>('[data-bindings-row-id]');
    const link = rowElement?.querySelector<HTMLAnchorElement>('[data-bindings-open-node]');
    const fallback = networkNodeSearchHref(input.value);
    if (rowId) {
      const row = this.rowForElement(input);
      if (row) getJQuery().observable(row).setProperty({ statusHref: fallback });
    }
    if (!fallback) link?.removeAttribute('href');
    if (link) link.setAttribute('aria-label', `Open node ${input.value}`);
  }

  private clearNodeLinks(dispose = false) {
    if (this.linkDebounce !== null) window.clearTimeout(this.linkDebounce);
    this.linkDebounce = null;
    for (const { request } of this.linkRequests.values()) request.abort();
    this.linkRequests.clear();
    this.resolver.clear();
    for (const link of this.querySelectorAll<HTMLAnchorElement>('[data-bindings-open-node]')) {
      const name = link.closest<HTMLElement>('[data-bindings-row-id]')?.querySelector<HTMLInputElement>('[data-bindings-node]')?.value ?? '';
      const fallback = networkNodeSearchHref(name);
      const row = this.rowForElement(link);
      if (row) getJQuery().observable(row).setProperty({ statusHref: fallback });
      if (!fallback) link.removeAttribute('href');
    }
    if (dispose) this.resolver.dispose();
  }

  private rowForElement(element: Element) {
    const id = element.closest<HTMLElement>('[data-bindings-row-id]')?.dataset.bindingsRowId;
    return id ? this.state.sections.flatMap((section) => section.rows).find((row) => row.id === id) ?? null : null;
  }
}

if (!customElements.get('nodel-bindings')) customElements.define('nodel-bindings', NodelBindings);
