import {
  getNodeRemoteBindings,
  getNodeRemoteSchema,
  saveNodeRemoteBindings
} from '../api/nodel-host-client';
import type { NodelActivityLogEntry } from '../api/nodel-types';
import {
  bindingStatusClass,
  bindingStatusLinkProperties,
  bindingSuggestionClass,
  createBindingSections,
  hasBindingSchema,
  normalizeBindingStatus,
  serializeBindingPayload,
  validateBindingRow,
  type BindingKind,
  type BindingOption,
  type BindingRow,
  type BindingSection
} from '../features/bindings-model';
import { BindingLookupService } from '../features/bindings-lookup';
import { subscribeNodeActivity } from '../data/node-activity-source';
import type { NodeRestartRefreshResult } from '../data/node-restart-source';
import { renderFontAwesomeIcon, uiIcons } from '../icons/fontawesome';
import { bootstrapJsViews, getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { renderComponentError } from '../utils/render-component-error';
import { activateActivePopoverOption, clearActivePopoverOption, getPopoverOptions, moveActivePopoverOption } from '../utils/popover-keyboard';
import { cloneSchemaValue } from '../schema/schema-values';
import { normalizeSchema } from '../schema/schema-model';
import { apiErrorMessage, isAbortError } from '../utils/errors';
import { LatestOperationCoordinator } from '../utils/latest-operation-coordinator';

const collapseIconMarkup = renderFontAwesomeIcon(uiIcons.chevronDown, 'h-3 w-3');

interface BindingsViewModel {
  loading: boolean;
  error: string;
  saveError: string;
  saveMessage: string;
  saving: boolean;
  empty: boolean;
  sections: BindingSection[];
  filter: string;
  bulkNode: string;
  bulkNodeAddress: string;
  bulkNodeOptions: BindingOption[];
  showBulkNodeOptions: boolean;
  searchingBulkNode: boolean;
  selectedCount: number;
  visibleCount: number;
  unboundCount: number;
  busy: boolean;
  message: string;
  toolbarError: string;
  invalid: boolean;
}

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

function optionFromModelEntry<T extends { value: string; label: string }>(
  entries: readonly T[],
  index: number,
  element: HTMLElement,
  fallback: (value: string) => T
) {
  return entries[index] ?? fallback(element.dataset.optionValue ?? '');
}

export class NodelBindings extends HTMLElement {
  private abortController: AbortController | null = null;
  private linked = false;
  private lifecycle = new ComponentLifecycle();
  private linkController = new JsViewsLinkController(this);
  private saveMessageTimer: number | null = null;
  private source: ReturnType<typeof subscribeNodeActivity> | null = null;
  private filterInput: HTMLInputElement | null = null;
  private observingControls = false;
  private bindingLookup = new BindingLookupService();
  private lookupOperations = new LatestOperationCoordinator<string>();
  private suggestionOperations = new LatestOperationCoordinator<'suggestions'>();
  private state: BindingsViewModel = {
    loading: true,
    error: '',
    saveError: '',
    saveMessage: '',
    saving: false,
    empty: false,
    sections: [],
    filter: '',
    bulkNode: '',
    bulkNodeAddress: '',
    bulkNodeOptions: [],
    showBulkNodeOptions: false,
    searchingBulkNode: false,
    selectedCount: 0,
    visibleCount: 0,
    unboundCount: 0,
    busy: false,
    message: '',
    toolbarError: '',
    invalid: false
  };
  private sourceBindings: Record<string, unknown> = {};

  connectedCallback() {
    const scope = this.lifecycle.connect();
    if (scope) {
      void scope.run(() => this.initialize(scope), (error) => this.handleInitializationError(error));
    }
  }

  disconnectedCallback() {
    this.invalidateSuggestionWork();
    this.lookupOperations.invalidateAll();
    this.clearAutocompleteState();
    this.clearLookupCaches();
    if (this.linked) {
      this.setState({ busy: false, loading: false, saving: false, searchingBulkNode: false, showBulkNodeOptions: false });
    }
    this.lifecycle.disconnect();
    this.abortController?.abort();
    this.abortController = null;
    this.unbindFilterInput();
    if (this.saveMessageTimer !== null) {
      window.clearTimeout(this.saveMessageTimer);
      this.saveMessageTimer = null;
    }
    this.linked = false;
  }

  private async initialize(scope: ConnectionScope) {
    await bootstrapJsViews();
    if (!scope.isCurrent()) {
      return;
    }
    const linked = await this.linkController.link(scope, template, this.state);
    if (!linked || !scope.isCurrent()) {
      return;
    }
    this.linked = true;
    scope.listen(this, 'submit', this.handleSubmit);
    scope.listen(this, 'input', this.handleInput);
    scope.listen(this, 'change', this.handleChange);
    scope.listen(this, 'mousedown', this.handleMouseDown);
    scope.listen(this, 'click', this.handleClick);
    scope.listen(this, 'keydown', this.handleKeydown);
    scope.listen(this, 'focusout', this.handleFocusOut);
    this.observeControls();
    scope.own(() => this.unobserveControls());

    await this.loadBindings(scope);
    if (scope.isCurrent()) {
      this.subscribeActivity(scope);
    }
  }

  refreshAfterRestart(): Promise<NodeRestartRefreshResult> {
    const scope = this.lifecycle.current;
    return scope ? this.loadBindings(scope) : Promise.resolve({ status: 'aborted', detail: 'Bindings component is disconnected.' });
  }

  private async loadBindings(scope: ConnectionScope): Promise<NodeRestartRefreshResult> {
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    const abort = () => controller.abort();
    scope.signal.addEventListener('abort', abort, { once: true });
    this.clearLookupCaches();
    this.lookupOperations.invalidateAll();
    this.invalidateSuggestionWork();
    this.setState({
      busy: false,
      loading: true,
      error: '',
      saveError: '',
      saveMessage: '',
      saving: false,
      empty: false,
      sections: [],
      filter: '',
      bulkNode: '',
      bulkNodeAddress: '',
      bulkNodeOptions: [],
      showBulkNodeOptions: false,
      searchingBulkNode: false,
      selectedCount: 0,
      visibleCount: 0,
      unboundCount: 0,
      message: '',
      toolbarError: '',
      invalid: false
    });

    try {
      const [schema, values] = await Promise.all([
        getNodeRemoteSchema({ signal: controller.signal }),
        getNodeRemoteBindings({ signal: controller.signal })
      ]);
      if (!scope.isCurrent() || controller !== this.abortController) {
        return { status: 'superseded', detail: 'Bindings refresh was superseded.' };
      }

      const normalizedSchema = normalizeSchema(schema);
      if (normalizedSchema.unsupportedReason) {
        this.setState({
          loading: false,
          error: `Unsupported binding schema: ${normalizedSchema.unsupportedReason}`,
          sections: [],
          empty: false,
          invalid: true
        });
        return { status: 'failed', detail: `Unsupported binding schema: ${normalizedSchema.unsupportedReason}` };
      }

      if (!hasBindingSchema(normalizedSchema.schema)) {
        this.setState({
          loading: false,
          empty: true,
          sections: []
        });
        return { status: 'verified' };
      }

      this.sourceBindings = cloneSchemaValue(values);
      const sections = createBindingSections(normalizedSchema.schema, values);
      for (const section of sections) {
        this.updateSectionSummary(section);
      }
      this.setState({
        loading: false,
        empty: sections.every((section) => section.rows.length === 0),
        sections,
        invalid: false
      });
      this.validateBindings(true);
      this.bindFilterInput();
      this.updateToolbarSummary();
      return { status: 'verified' };
    } catch (error) {
      if (!scope.isCurrent() || controller !== this.abortController) {
        return { status: 'superseded', detail: 'Bindings refresh was superseded.' };
      }
      if (isAbortError(error)) {
        return { status: 'aborted', detail: 'Bindings refresh was canceled.' };
      }
      const detail = apiErrorMessage(error, 'Failed to load bindings');
      this.setState({
        loading: false,
        error: detail,
        empty: false,
        sections: [],
        selectedCount: 0,
        visibleCount: 0,
        unboundCount: 0
      });
      return { status: 'failed', detail };
    } finally {
      scope.signal.removeEventListener('abort', abort);
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  private handleSubmit = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLFormElement) || !target.hasAttribute('data-bindings-form')) {
      return;
    }

    event.preventDefault();
    if (this.state.saving || this.state.error || this.state.empty) {
      return;
    }

    if (this.validateBindings(true).length > 0) {
      return;
    }

    void this.saveBindings();
  };

  private handleInput = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.hasAttribute('data-bindings-bulk-node')) {
      this.setState({
        bulkNode: target.value,
        bulkNodeAddress: ''
      });
      void this.searchBulkNodes(target.value);
      return;
    }

    const row = this.rowForElement(target);
    if (!row) {
      return;
    }

    if (target.hasAttribute('data-bindings-node')) {
      this.invalidateSuggestionWork();
      this.clearLookupCaches();
      this.invalidateRowLookup(row, 'target');
      getJQuery().observable(row).setProperty({
        node: target.value,
        nodeAddress: '',
        nodePresent: true,
        dirty: true,
        nodeDirty: true,
        ...bindingStatusLinkProperties(target.value)
      });
      this.validateBindings();
      void this.searchRowNodes(row, target.value);
      return;
    }

    if (target.hasAttribute('data-bindings-target')) {
      this.invalidateSuggestionWork();
      getJQuery().observable(row).setProperty({
        target: target.value,
        targetPresent: true,
        dirty: true,
        targetDirty: true,
        suggestionValue: '',
        suggestionLabel: '',
        suggestionConfidence: '',
        suggestionClass: bindingSuggestionClass('')
      });
      this.validateBindings();
      void this.searchTargets(row, target.value);
    }
  };

  private handleChange = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.hasAttribute('data-bindings-row-select')) {
      return;
    }

    const row = this.rowForElement(target);
    if (row) {
      this.invalidateSuggestionWork();
      getJQuery().observable(row).setProperty('selected', target.checked);
    }

    const section = this.sectionForElement(target);
    if (section) {
      this.updateSectionSummary(section);
      this.updateToolbarSummary();
    }
  };

  private lookupKey(row: BindingRow | null, field: 'node' | 'target' | 'bulk-node') {
    return field === 'bulk-node' ? 'bulk:node' : `${row?.id ?? 'missing'}:${field}`;
  }

  private handleFocusOut = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const combobox = target.closest<HTMLElement>('.nodel-bindings-combobox');
    const nextFocus = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (!combobox || (nextFocus && combobox.contains(nextFocus))) {
      return;
    }

    if (combobox.querySelector('[data-bindings-bulk-node]')) {
      this.invalidateBulkLookup();
      return;
    }

    const row = this.rowForElement(combobox);
    if (row) {
      if (combobox.querySelector('[data-bindings-node]')) {
        this.invalidateRowLookup(row, 'node');
      }
      if (combobox.querySelector('[data-bindings-target]')) {
        this.invalidateRowLookup(row, 'target');
      }
    }
  };

  private handleKeydown = (event: KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !this.isAutocompleteInput(target)) {
      return;
    }

    const combobox = target.closest<HTMLElement>('.nodel-bindings-combobox');
    if (!combobox) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (moveActivePopoverOption(combobox, '[data-bindings-option]', direction)) {
        event.preventDefault();
      }
      return;
    }

    if (event.key === 'Enter') {
      if (activateActivePopoverOption(combobox, '[data-bindings-option]')) {
        event.preventDefault();
      }
      return;
    }

    if (event.key === 'Escape') {
      const hasOptions = getPopoverOptions(combobox, '[data-bindings-option]').length > 0;
      const row = this.rowForElement(target);
      const searching = target.hasAttribute('data-bindings-bulk-node')
        ? this.state.searchingBulkNode
        : target.hasAttribute('data-bindings-node')
          ? Boolean(row?.searchingNode)
          : Boolean(row?.searchingTarget);
      if (hasOptions || searching) {
        event.preventDefault();
        if (hasOptions) {
          clearActivePopoverOption(combobox, '[data-bindings-option]');
        }
        this.closeAutocompleteForInput(target);
      }
    }
  };

  private handleMouseDown = (event: MouseEvent) => {
    const target = event.target;
    if (event.button !== 0 || !(target instanceof Element)) {
      return;
    }

    const option = target.closest<HTMLElement>('[data-bindings-option]');
    if (option && this.contains(option)) {
      event.preventDefault();
    }
  };

  private handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const option = target.closest<HTMLElement>('[data-bindings-option]');
    if (option && this.contains(option)) {
      this.applyOption(option);
      return;
    }

    const clearFilterButton = target.closest<HTMLElement>('[data-bindings-clear-filter]');
    if (clearFilterButton && this.contains(clearFilterButton)) {
      this.clearFilter();
      return;
    }

    const selectButton = target.closest<HTMLElement>('[data-bindings-select]');
    if (selectButton && this.contains(selectButton)) {
      this.selectRows(selectButton.dataset.bindingsSelect ?? '');
      return;
    }

    const applyNodeButton = target.closest<HTMLElement>('[data-bindings-apply-node]');
    if (applyNodeButton && this.contains(applyNodeButton)) {
      this.applyBulkNode();
      return;
    }

    const suggestButton = target.closest<HTMLElement>('[data-bindings-suggest]');
    if (suggestButton && this.contains(suggestButton)) {
      void this.suggestMatches();
      return;
    }

    const applySuggestionsButton = target.closest<HTMLElement>('[data-bindings-apply-suggestions]');
    if (applySuggestionsButton && this.contains(applySuggestionsButton)) {
      this.applySuggestions();
    }
  };

  private applyOption(option: HTMLElement) {
    const optionType = option.dataset.bindingsOption;
    const index = Number(option.dataset.optionIndex ?? '-1');
    if (index < 0) {
      return;
    }

    const $ = getJQuery();
    if (optionType === 'bulk-node') {
      const selected = optionFromModelEntry(this.state.bulkNodeOptions, index, option, (value) => ({
        value,
        label: value,
        address: option.dataset.optionAddress ?? '',
        detail: ''
      }));
      this.clearLookupCaches();
      this.invalidateBulkLookup();
      this.setState({
        bulkNode: selected.value,
        bulkNodeAddress: selected.address,
        bulkNodeOptions: [],
        showBulkNodeOptions: false
      });
      return;
    }

    const row = this.rowForElement(option);
    if (!row) {
      return;
    }

    if (optionType === 'node') {
      const selected = optionFromModelEntry(row.nodeOptions, index, option, (value) => ({
        value,
        label: value,
        address: option.dataset.optionAddress ?? '',
        detail: ''
      }));
      this.invalidateSuggestionWork();
      this.clearLookupCaches();
      this.invalidateRowLookup(row, 'node');
      this.invalidateRowLookup(row, 'target');
      $.observable(row).setProperty({
        node: selected.value,
        nodeAddress: selected.address,
        nodePresent: true,
        dirty: true,
        nodeDirty: true,
        ...bindingStatusLinkProperties(selected.value),
        nodeOptions: [],
        showNodeOptions: false
      });
      this.validateBindings();
      return;
    }

    if (optionType === 'target') {
      const selected = optionFromModelEntry(row.targetOptions, index, option, (value) => ({
        value,
        label: value,
        detail: ''
      }));
      this.invalidateSuggestionWork();
      this.invalidateRowLookup(row, 'target');
      $.observable(row).setProperty({
        target: selected.value,
        targetPresent: true,
        dirty: true,
        targetDirty: true,
        targetOptions: [],
        showTargetOptions: false,
        suggestionValue: '',
        suggestionLabel: '',
        suggestionConfidence: '',
        suggestionClass: bindingSuggestionClass('')
      });
      this.validateBindings();
    }
  }

  private isAutocompleteInput(input: HTMLInputElement) {
    return input.hasAttribute('data-bindings-bulk-node')
      || input.hasAttribute('data-bindings-node')
      || input.hasAttribute('data-bindings-target');
  }

  private closeAutocompleteForInput(input: HTMLInputElement) {
    if (input.hasAttribute('data-bindings-bulk-node')) {
      this.invalidateBulkLookup();
      return;
    }

    const row = this.rowForElement(input);
    if (!row) {
      return;
    }

    if (input.hasAttribute('data-bindings-node')) {
      this.invalidateRowLookup(row, 'node');
      return;
    }

    if (input.hasAttribute('data-bindings-target')) {
      this.invalidateRowLookup(row, 'target');
    }
  }

  private async searchBulkNodes(query: string) {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const lookup = this.lookupOperations.begin(this.lookupKey(null, 'bulk-node'), scope.signal);
    const originalQuery = query;
    this.setState({ searchingBulkNode: true, toolbarError: '' });
    try {
      const options = await this.bindingLookup.searchNodeOptions(query, lookup.signal);
      if (lookup.isCurrent() && this.state.bulkNode === originalQuery) {
        this.setState({
          bulkNodeOptions: options,
          showBulkNodeOptions: options.length > 0
        });
      }
    } catch (error) {
      if (lookup.isCurrent()) {
        this.setState({
          bulkNodeOptions: [],
          showBulkNodeOptions: false,
          toolbarError: apiErrorMessage(error, 'Failed to search nodes')
        });
      }
    } finally {
      if (lookup.isCurrent()) {
        this.setState({ searchingBulkNode: false });
      }
      lookup.finish();
    }
  }

  private async searchRowNodes(row: BindingRow, query: string) {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const lookup = this.lookupOperations.begin(this.lookupKey(row, 'node'), scope.signal);
    const originalQuery = query;
    getJQuery().observable(row).setProperty({ searchingNode: true });
    this.setState({ toolbarError: '' });
    try {
      const options = await this.bindingLookup.searchNodeOptions(query, lookup.signal);
      if (lookup.isCurrent() && row.node === originalQuery) {
        getJQuery().observable(row).setProperty({
          nodeOptions: options,
          showNodeOptions: options.length > 0
        });
      }
    } catch (error) {
      if (lookup.isCurrent()) {
        getJQuery().observable(row).setProperty({
          nodeOptions: [],
          showNodeOptions: false
        });
        this.setState({ toolbarError: apiErrorMessage(error, 'Failed to search nodes') });
      }
    } finally {
      if (lookup.isCurrent()) {
        getJQuery().observable(row).setProperty({ searchingNode: false });
      }
      lookup.finish();
    }
  }

  private async searchTargets(row: BindingRow, query: string) {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const lookup = this.lookupOperations.begin(this.lookupKey(row, 'target'), scope.signal);
    const originalQuery = query;
    const originalNode = row.node;
    const originalNodeAddress = row.nodeAddress;
    const isCurrentTargetLookup = () => lookup.isCurrent()
      && row.target === originalQuery
      && row.node === originalNode
      && row.nodeAddress === originalNodeAddress;
    getJQuery().observable(row).setProperty({ searchingTarget: true });
    this.setState({ toolbarError: '' });
    try {
      const options = originalNode
        ? await this.bindingLookup.getTargetOptions({ kind: row.kind, node: originalNode, nodeAddress: originalNodeAddress }, query, lookup.signal)
        : [];
      if (isCurrentTargetLookup()) {
        getJQuery().observable(row).setProperty({
          targetOptions: options,
          showTargetOptions: options.length > 0
        });
      }
    } catch (error) {
      if (isCurrentTargetLookup()) {
        getJQuery().observable(row).setProperty({
          targetOptions: [],
          showTargetOptions: false
        });
        this.setState({ toolbarError: apiErrorMessage(error, 'Failed to load target definitions') });
      }
    } finally {
      if (lookup.isCurrent()) {
        getJQuery().observable(row).setProperty({ searchingTarget: false });
      }
      lookup.finish();
    }
  }

  private selectRows(mode: string) {
    this.invalidateSuggestionWork();
    const rows = mode === 'visible'
      ? this.state.sections.flatMap((section) => section.visibleRows)
      : mode === 'unbound'
        ? this.allRows().filter((row) => row.status !== 'Wired')
        : this.allRows();
    const selected = mode !== 'clear';
    for (const row of rows) {
      getJQuery().observable(row).setProperty('selected', selected);
    }
    this.updateAllSummaries();
  }

  private applyBulkNode() {
    if (!this.state.bulkNode) {
      return;
    }

    this.invalidateSuggestionWork();
    this.clearLookupCaches();
    for (const row of this.allRows()) {
      if (row.selected) {
        this.invalidateRowLookup(row, 'target');
        getJQuery().observable(row).setProperty({
          node: this.state.bulkNode,
          nodeAddress: this.state.bulkNodeAddress,
          nodePresent: true,
          dirty: true,
          nodeDirty: true,
          ...bindingStatusLinkProperties(this.state.bulkNode),
          suggestionValue: '',
          suggestionLabel: '',
          suggestionConfidence: '',
          suggestionClass: bindingSuggestionClass('')
        });
      }
    }
    this.validateBindings();
  }

  private async suggestMatches() {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const snapshots = this.allRows()
      .filter((row) => row.selected && row.node)
      .map((row) => ({
        row,
        kind: row.kind,
        node: row.node,
        nodeAddress: row.nodeAddress,
        alias: row.alias,
        title: row.title
      }));
    if (snapshots.length === 0) {
      this.setState({
        message: 'Select rows with a node before suggesting matches.',
        toolbarError: ''
      });
      return;
    }

    const ticket = this.suggestionOperations.begin('suggestions', scope.signal);
    const isCurrentSnapshot = (snapshot: typeof snapshots[number]) => scope.isCurrent()
      && ticket.isCurrent()
      && snapshot.row.selected
      && snapshot.row.kind === snapshot.kind
      && snapshot.row.node === snapshot.node
      && snapshot.row.nodeAddress === snapshot.nodeAddress
      && snapshot.row.alias === snapshot.alias
      && snapshot.row.title === snapshot.title;

    this.setState({
      busy: true,
      message: '',
      toolbarError: ''
    });

    try {
      let suggested = 0;
      for (const snapshot of snapshots) {
        if (!isCurrentSnapshot(snapshot)) {
          return;
        }
        const suggestion = await this.bindingLookup.getSuggestion({
          kind: snapshot.kind,
          node: snapshot.node,
          nodeAddress: snapshot.nodeAddress,
          alias: snapshot.alias,
          title: snapshot.title
        }, ticket.signal);
        if (!isCurrentSnapshot(snapshot)) {
          return;
        }
        if (suggestion.confidence === 'high' || suggestion.confidence === 'medium') {
          suggested += 1;
        }
        getJQuery().observable(snapshot.row).setProperty({
          suggestionValue: suggestion.value,
          suggestionLabel: suggestion.label,
          suggestionConfidence: suggestion.confidence,
          suggestionClass: bindingSuggestionClass(suggestion.confidence)
        });
      }
      if (!scope.isCurrent() || !ticket.isCurrent()) {
        return;
      }
      this.setState({ message: `${suggested} suggestion${suggested === 1 ? '' : 's'} ready.` });
    } catch (error) {
      if (scope.isCurrent() && ticket.isCurrent()) {
        this.setState({ toolbarError: apiErrorMessage(error, 'Failed to suggest matches') });
      }
    } finally {
      const current = ticket.isCurrent();
      ticket.finish();
      if (scope.isCurrent() && current) {
        this.setState({ busy: false });
      }
    }
  }

  private applySuggestions() {
    let applied = 0;
    for (const row of this.allRows()) {
      if (!row.selected || !row.suggestionValue || (row.suggestionConfidence !== 'high' && row.suggestionConfidence !== 'medium')) {
        continue;
      }
      getJQuery().observable(row).setProperty({ target: row.suggestionValue, targetPresent: true, dirty: true, targetDirty: true });
      applied += 1;
    }
    this.setState({
      message: `${applied} suggestion${applied === 1 ? '' : 's'} applied.`,
      toolbarError: ''
    });
    this.validateBindings();
  }

  private clearLookupCaches() {
    this.bindingLookup.clear();
  }

  private invalidateSuggestionWork() {
    this.suggestionOperations.invalidate('suggestions');
    if (this.state.busy) {
      this.setState({ busy: false });
    }
  }

  private clearAutocompleteState() {
    this.setState({
      bulkNodeOptions: [],
      showBulkNodeOptions: false,
      searchingBulkNode: false
    });
    const $ = getJQuery();
    for (const row of this.allRows()) {
      $.observable(row).setProperty({
        nodeOptions: [],
        showNodeOptions: false,
        searchingNode: false,
        targetOptions: [],
        showTargetOptions: false,
        searchingTarget: false
      });
    }
  }

  private invalidateBulkLookup() {
    this.lookupOperations.invalidate(this.lookupKey(null, 'bulk-node'));
    this.setState({
      bulkNodeOptions: [],
      showBulkNodeOptions: false,
      searchingBulkNode: false
    });
  }

  private invalidateRowLookup(row: BindingRow, field: 'node' | 'target') {
    this.lookupOperations.invalidate(this.lookupKey(row, field));
    const $ = getJQuery();
    if (field === 'node') {
      $.observable(row).setProperty({
        nodeOptions: [],
        showNodeOptions: false,
        searchingNode: false
      });
      return;
    }
    $.observable(row).setProperty({
      targetOptions: [],
      showTargetOptions: false,
      searchingTarget: false
    });
  }

  private async saveBindings() {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    if (this.validateBindings(true).length > 0) {
      return;
    }
    const payload = serializeBindingPayload(this.sourceBindings, this.state.sections);
    this.setState({
      saving: true,
      saveError: '',
      saveMessage: ''
    });

    try {
      await saveNodeRemoteBindings(payload, { signal: scope.signal });
      if (!scope.isCurrent()) {
        return;
      }
      this.setState({ saveMessage: 'Saved' });
      this.dispatchEvent(new CustomEvent('nodel-bindings-saved', {
        bubbles: true,
        detail: { payload }
      }));
      if (this.saveMessageTimer !== null) {
        window.clearTimeout(this.saveMessageTimer);
      }
      this.saveMessageTimer = scope.setTimeout(() => {
        this.setState({ saveMessage: '' });
        this.saveMessageTimer = null;
      }, 2500);
    } catch (error) {
      if (!scope.isCurrent()) {
        return;
      }
      const message = apiErrorMessage(error, 'Failed to save bindings');
      this.setState({ saveError: message });
      this.dispatchEvent(new CustomEvent('nodel-bindings-error', {
        bubbles: true,
        detail: { error: message, payload }
      }));
    } finally {
      if (scope.isCurrent()) {
        this.setState({ saving: false });
      }
    }
  }

  private validateBindings(revealAll = false) {
    const issues = this.allRows().flatMap((row) => validateBindingRow(row));
    for (const row of this.allRows()) {
      const rowIssues = issues.filter((issue) => issue.fieldId === row.id || issue.fieldId.startsWith(`${row.id}/`));
      const nodeIssue = rowIssues.find((issue) => issue.pointer.endsWith('/node'));
      const targetIssue = rowIssues.find((issue) => issue.pointer.endsWith(`/${row.targetKey}`));
      const revealNodeError = revealAll || row.nodeDirty || Boolean(row.nodeError);
      const revealTargetError = revealAll || row.targetDirty || Boolean(row.targetError);
      getJQuery().observable(row).setProperty({
        nodeError: revealNodeError ? nodeIssue?.message ?? (!targetIssue && rowIssues.length > 0 ? rowIssues[0]?.message ?? '' : '') : '',
        targetError: revealTargetError ? targetIssue?.message ?? '' : ''
      });
    }
    this.setState({ invalid: issues.length > 0 });
    return issues;
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

  private handleInitializationError(error: unknown) {
    const message = apiErrorMessage(error, 'Failed to initialize bindings');
    if (this.linked) {
      this.setState({ loading: false, error: message });
    } else {
      this.dataset.state = 'error';
      renderComponentError(this, message);
    }
  }

  private applyActivityEntries(entries: NodelActivityLogEntry[]) {
    for (const entry of entries) {
      if (entry.source !== 'remote' || (entry.type !== 'actionBinding' && entry.type !== 'eventBinding')) {
        continue;
      }

      const kind: BindingKind = entry.type === 'actionBinding' ? 'actions' : 'events';
      const row = this.findRow(kind, String(entry.alias ?? ''));
      if (!row) {
        continue;
      }

      const status = normalizeBindingStatus(entry.arg);
      getJQuery().observable(row).setProperty({
        status,
        statusClass: bindingStatusClass(status)
      });
      const section = this.state.sections.find((item) => item.kind === kind);
      if (section) {
        this.updateSectionSummary(section);
      }
      this.updateToolbarSummary();
    }
  }

  private refreshAllVisibleRows() {
    for (const section of this.state.sections) {
      this.refreshVisibleRows(section);
    }
    this.updateToolbarSummary();
  }

  private clearFilter() {
    this.setState({ filter: '' });
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

  private observeControls() {
    if (this.observingControls) {
      return;
    }

    const $ = getJQuery() as ReturnType<typeof getJQuery> & {
      observe: (object: unknown, paths: string, handler: () => void) => void;
    };
    $.observe(this.state, 'filter', this.handleFilterChange);
    this.observingControls = true;
  }

  private unobserveControls() {
    if (!this.observingControls) {
      return;
    }

    const $ = getJQuery() as ReturnType<typeof getJQuery> & {
      unobserve: (object: unknown, paths: string, handler: () => void) => void;
    };
    $.unobserve?.(this.state, 'filter', this.handleFilterChange);
    this.observingControls = false;
  }

  private handleFilterChange = () => {
    this.refreshAllVisibleRows();
  };

  private handleFilterSearch = () => {
    this.filterInput?.dispatchEvent(new InputEvent('input', { bubbles: true }));
  };

  private refreshVisibleRows(section: BindingSection) {
    const query = this.state.filter.trim().toLocaleLowerCase();
    const visibleRows = query
      ? section.rows.filter((row) => {
        return row.alias.toLocaleLowerCase().includes(query)
          || row.title.toLocaleLowerCase().includes(query)
          || row.description.toLocaleLowerCase().includes(query)
          || row.node.toLocaleLowerCase().includes(query)
          || row.target.toLocaleLowerCase().includes(query);
      })
      : section.rows;

    getJQuery().observable(section.visibleRows).refresh(visibleRows);
    this.updateSectionSummary(section);
  }

  private updateAllSummaries() {
    for (const section of this.state.sections) {
      this.updateSectionSummary(section);
    }
    this.updateToolbarSummary();
  }

  private updateSectionSummary(section: BindingSection) {
    getJQuery().observable(section).setProperty({
      selectedCount: section.rows.filter((row) => row.selected).length,
      visibleCount: section.visibleRows.length,
      unboundCount: section.rows.filter((row) => row.status !== 'Wired').length
    });
  }

  private updateToolbarSummary() {
    const rows = this.allRows();
    this.setState({
      selectedCount: rows.filter((row) => row.selected).length,
      visibleCount: this.state.sections.reduce((total, section) => total + section.visibleRows.length, 0),
      unboundCount: rows.filter((row) => row.status !== 'Wired').length
    });
  }

  private allRows() {
    return this.state.sections.flatMap((section) => section.rows);
  }

  private sectionForElement(element: Element) {
    const sectionKind = element.closest<HTMLElement>('[data-bindings-section]')?.dataset.bindingsSection as BindingKind | undefined;
    return sectionKind ? this.state.sections.find((section) => section.kind === sectionKind) ?? null : null;
  }

  private rowForElement(element: Element) {
    const rowId = element.closest<HTMLElement>('[data-bindings-row-id]')?.dataset.bindingsRowId;
    if (!rowId) {
      return null;
    }

    for (const section of this.state.sections) {
      const row = section.rows.find((item) => item.id === rowId);
      if (row) {
        return row;
      }
    }
    return null;
  }

  private findRow(kind: BindingKind, alias: string) {
    return this.state.sections.find((section) => section.kind === kind)?.rows.find((row) => row.alias === alias) ?? null;
  }

  private setState(values: Partial<BindingsViewModel>) {
    getJQuery().observable(this.state).setProperty(values);
  }
}

if (!customElements.get('nodel-bindings')) {
  customElements.define('nodel-bindings', NodelBindings);
}
