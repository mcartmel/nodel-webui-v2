import {
  getNodeRemoteBindings,
  getNodeRemoteSchema,
  getRemoteNodeActions,
  getRemoteNodeSignals,
  saveNodeRemoteBindings,
  searchNodeUrls
} from '../api/nodel-host-client';
import type { NodelActionDefinition, NodelActivityLogEntry, NodelJsonSchema, NodelNodeUrlEntry, NodelSignalDefinition } from '../api/nodel-types';
import { subscribeNodeActivity } from '../data/node-activity-source';
import { bootstrapJsViews, getJQuery, linkTemplate, unlinkTemplate } from '../jsviews/jsviews-runtime';
import { getSimpleName, getVerySimpleName } from '../utils/node-name';

type BindingKind = 'actions' | 'events';
type BindingTargetKey = 'action' | 'event';
type SuggestionConfidence = '' | 'high' | 'medium' | 'ambiguous' | 'none';

interface BindingOption {
  label: string;
  value: string;
  address: string;
  detail: string;
}

interface TargetOption {
  label: string;
  value: string;
  detail: string;
}

interface BindingRow {
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
}

interface BindingSection {
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
}

interface TargetDefinition {
  name: string;
  title: string;
  group: string;
}

const template = `
  <div class="nodel-bindings" data-link="class{:loading ? 'nodel-bindings is-loading' : 'nodel-bindings'}">
    {^{if loading}}
      <div class="nodel-alert px-4 py-3 text-sm">Loading bindings...</div>
    {{else}}
      <form class="nodel-bindings-panel space-y-3" data-bindings-form autocomplete="off">
        {^{if error}}
          <div class="nodel-alert nodel-alert-danger px-4 py-3 text-sm">{^{>error}}</div>
        {{else empty}}
          <div class="nodel-alert px-4 py-3 text-sm">No bindings.</div>
        {{else}}
          <fieldset data-link="disabled{:saving}">
            <div class="nodel-bindings-toolbar-panel">
              <div class="nodel-bindings-toolbar">
                <div class="flex min-w-0 items-center gap-2">
                  <input class="nodel-field nodel-field-compact min-w-0 flex-1" type="search" placeholder="Filter bindings" data-bindings-filter data-link="filter trigger=true" />
                  <button type="button" class="nodel-button nodel-field-compact" data-bindings-clear-filter data-link="disabled{:!filter}">Clear</button>
                </div>
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <button type="button" class="nodel-button nodel-field-compact" data-bindings-select="visible">Select visible</button>
                  <button type="button" class="nodel-button nodel-field-compact" data-bindings-select="unbound">Select unwired</button>
                  <button type="button" class="nodel-button nodel-field-compact" data-bindings-select="clear">Clear selection</button>
                </div>
              </div>
              <div class="nodel-bindings-toolbar">
                <div class="nodel-bindings-combobox">
                  <input class="nodel-field nodel-field-compact w-full" type="text" spellcheck="false" placeholder="Search node" data-bindings-bulk-node data-link="bulkNode" />
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
                  <button type="button" class="nodel-button nodel-field-compact" data-bindings-apply-node data-link="disabled{:selectedCount === 0 || !bulkNode}">Set node</button>
                  <button type="button" class="nodel-button nodel-field-compact" data-bindings-suggest data-link="disabled{:selectedCount === 0 || busy}">
                    {^{if busy}}Suggesting...{{else}}Suggest matches{{/if}}
                  </button>
                  <button type="button" class="nodel-button nodel-button-primary nodel-field-compact" data-bindings-apply-suggestions data-link="disabled{:selectedCount === 0}">Apply suggestions</button>
                </div>
              </div>
              {^{if toolbarError}}<div class="nodel-alert nodel-alert-danger px-3 py-2 text-xs">{^{>toolbarError}}</div>{{/if}}
              {^{if message}}<div class="nodel-alert px-3 py-2 text-xs">{^{>message}}</div>{{/if}}
            </div>
            <div class="space-y-3">
              {^{for sections}}
                <details class="nodel-bindings-section nodel-collapse nodel-panel" open data-link="data-bindings-section{:kind}">
                  <summary class="nodel-collapse-summary">
                    <span class="nodel-collapse-label">{^{>title}}</span>
                    <span class="nodel-collapse-preview">{^{:selectedCount}} selected, {^{:unboundCount}} unwired</span>
                    <span class="nodel-collapse-icon" aria-hidden="true"></span>
                  </summary>
                  <div class="nodel-collapse-content space-y-2.5">
                    <div class="nodel-bindings-table" role="table">
                      <div class="nodel-bindings-header" role="row">
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
                              <input type="checkbox" data-bindings-row-select data-link="selected" aria-label="Select binding" />
                            </label>
                            <span class="nodel-bindings-status" data-link="class{:statusClass}">{^{>status}}</span>
                            <span class="min-w-0">
                              <span class="block truncate font-semibold text-nodel-fg" data-link="title{:alias}">{^{>title}}</span>
                              <span class="block truncate text-xs text-nodel-muted">{^{>alias}}</span>
                              {^{if description}}<span class="block truncate text-xs text-nodel-muted">{^{>description}}</span>{{/if}}
                            </span>
                            <span class="nodel-bindings-combobox">
                              <input class="nodel-field nodel-field-compact w-full" type="text" spellcheck="false" placeholder="node" data-bindings-node data-link="node" />
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
                            </span>
                            <span class="nodel-bindings-combobox">
                              <input class="nodel-field nodel-field-compact w-full" type="text" spellcheck="false" data-bindings-target data-link="{:target:} placeholder{:targetLabel}" />
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
                            </span>
                            <span class="nodel-bindings-suggestion" data-link="class{:suggestionClass}">
                              {^{if suggestionLabel}}{^{>suggestionLabel}}{{else}}-{{/if}}
                            </span>
                          </div>
                        {{/for}}
                      {{else}}
                        <div class="nodel-alert px-3 py-2 text-xs">No bindings match the filter.</div>
                      {{/if}}
                    </div>
                  </div>
                </details>
              {{/for}}
            </div>
          </fieldset>
          <div class="flex min-w-0 flex-wrap items-center gap-3">
            <button type="submit" class="nodel-button nodel-button-primary" data-link="disabled{:saving}">
              {^{if saving}}Saving...{{else}}Save{{/if}}
            </button>
            {^{if saveMessage}}<span class="text-sm text-nodel-muted">{^{>saveMessage}}</span>{{/if}}
          </div>
          {^{if saveError}}
            <div class="nodel-alert nodel-alert-danger px-3 py-2 text-xs">{^{>saveError}}</div>
          {{/if}}
        {{/if}}
      </form>
    {{/if}}
  </div>
`;

let nextId = 0;

function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function nextBindingId(kind: BindingKind, alias: string) {
  nextId += 1;
  return `nodel-bindings-${kind}-${alias.replace(/[^a-zA-Z0-9_-]+/g, '-')}-${nextId}`;
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

function hasBindingSchema(schema: NodelJsonSchema | null | undefined) {
  const properties = schema?.properties ?? {};
  return Boolean(properties.actions?.properties && Object.keys(properties.actions.properties).length > 0)
    || Boolean(properties.events?.properties && Object.keys(properties.events.properties).length > 0);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function titleFor(alias: string, schema: NodelJsonSchema) {
  return schema.title || alias;
}

function normalizeStatus(status: unknown) {
  return status === 'Wired' ? 'Wired' : 'Unwired';
}

function statusClass(status: string) {
  return status === 'Wired' ? 'nodel-bindings-status is-wired' : 'nodel-bindings-status is-unwired';
}

function getNodeOptionValue(entry: NodelNodeUrlEntry) {
  return getSimpleName(entry.node || entry.name || '');
}

function optionFromNode(entry: NodelNodeUrlEntry): BindingOption {
  const label = getNodeOptionValue(entry) || getSimpleName(entry.address);
  return {
    label,
    value: label,
    address: entry.address,
    detail: entry.host || new URL(entry.address, window.location.origin).host
  };
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
}

function levenshtein(a: string, b: string) {
  if (a === b) {
    return 0;
  }
  if (!a) {
    return b.length;
  }
  if (!b) {
    return a.length;
  }

  const previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 0; i < a.length; i += 1) {
    current[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function similarity(a: string, b: string) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  if (left.includes(right) || right.includes(left)) {
    return 0.82;
  }
  const maxLength = Math.max(left.length, right.length);
  return 1 - levenshtein(left, right) / maxLength;
}

function definitionsToOptions(definitions: TargetDefinition[], query: string) {
  const normalized = query.toLocaleLowerCase();
  return definitions
    .filter((definition) => {
      if (!normalized) {
        return true;
      }
      return definition.name.toLocaleLowerCase().includes(normalized)
        || definition.title.toLocaleLowerCase().includes(normalized)
        || definition.group.toLocaleLowerCase().includes(normalized);
    })
    .slice(0, 20)
    .map((definition) => ({
      label: definition.title || definition.name,
      value: definition.name,
      detail: [definition.group ? `[${definition.group}]` : '', definition.name].filter(Boolean).join(' ')
    }));
}

function normalizeDefinitions(definitions: Record<string, NodelActionDefinition | NodelSignalDefinition> | Array<NodelActionDefinition | NodelSignalDefinition>) {
  const entries = Array.isArray(definitions)
    ? definitions.map((definition) => [definition.name, definition] as const)
    : Object.entries(definitions);

  return entries.map(([key, definition]) => {
    const name = definition.name || key;
    return {
      name,
      title: definition.title || name,
      group: definition.group || ''
    };
  });
}

function buildSuggestion(row: BindingRow, definitions: TargetDefinition[]) {
  const candidates = definitions
    .map((definition) => ({
      definition,
      score: Math.max(
        similarity(row.alias, definition.name),
        similarity(row.alias, definition.title),
        similarity(row.title, definition.name),
        similarity(row.title, definition.title)
      )
    }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 0.55) {
    return {
      value: '',
      label: 'No match',
      confidence: 'none' as SuggestionConfidence
    };
  }

  const tied = candidates.filter((candidate) => Math.abs(candidate.score - best.score) < 0.02);
  if (tied.length > 1) {
    return {
      value: '',
      label: `Ambiguous (${tied.length} matches)`,
      confidence: 'ambiguous' as SuggestionConfidence
    };
  }

  const confidence: SuggestionConfidence = best.score >= 0.8 ? 'high' : 'medium';
  return {
    value: best.definition.name,
    label: `${confidence}: ${best.definition.name}`,
    confidence
  };
}

function suggestionClass(confidence: SuggestionConfidence) {
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

export class NodelBindings extends HTMLElement {
  private abortController: AbortController | null = null;
  private linked = false;
  private saveMessageTimer: number | null = null;
  private source: ReturnType<typeof subscribeNodeActivity> | null = null;
  private filterInput: HTMLInputElement | null = null;
  private observingControls = false;
  private targetCache = new Map<string, Promise<TargetDefinition[]>>();
  private nodeSearchToken = 0;
  private targetSearchToken = 0;
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
    toolbarError: ''
  };

  connectedCallback() {
    void this.initialize();
  }

  disconnectedCallback() {
    this.abortController?.abort();
    this.abortController = null;
    this.source?.dispose();
    this.source = null;
    this.unobserveControls();
    this.unbindFilterInput();
    this.removeEventListener('submit', this.handleSubmit);
    this.removeEventListener('input', this.handleInput);
    this.removeEventListener('change', this.handleChange);
    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('focusout', this.handleFocusOut);
    if (this.saveMessageTimer !== null) {
      window.clearTimeout(this.saveMessageTimer);
      this.saveMessageTimer = null;
    }
    void unlinkTemplate(this);
    this.linked = false;
  }

  private async initialize() {
    if (!this.linked) {
      await bootstrapJsViews();
      await linkTemplate(this, template, this.state);
      this.linked = true;
      this.addEventListener('submit', this.handleSubmit);
      this.addEventListener('input', this.handleInput);
      this.addEventListener('change', this.handleChange);
      this.addEventListener('click', this.handleClick);
      this.addEventListener('focusout', this.handleFocusOut);
      this.observeControls();
    }

    await this.loadBindings();
    this.subscribeActivity();
  }

  private async loadBindings() {
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.targetCache.clear();
    this.setState({
      loading: true,
      error: '',
      saveError: '',
      saveMessage: '',
      empty: false,
      sections: [],
      filter: '',
      bulkNode: '',
      bulkNodeAddress: '',
      bulkNodeOptions: [],
      showBulkNodeOptions: false,
      selectedCount: 0,
      visibleCount: 0,
      unboundCount: 0,
      message: '',
      toolbarError: ''
    });

    try {
      const [schema, values] = await Promise.all([
        getNodeRemoteSchema({ signal: this.abortController.signal }),
        getNodeRemoteBindings({ signal: this.abortController.signal })
      ]);

      if (!hasBindingSchema(schema)) {
        this.setState({
          loading: false,
          empty: true,
          sections: []
        });
        return;
      }

      const sections = this.createSections(schema, values);
      this.setState({
        loading: false,
        empty: sections.every((section) => section.rows.length === 0),
        sections
      });
      this.bindFilterInput();
      this.updateToolbarSummary();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      this.setState({
        loading: false,
        error: apiErrorMessage(error, 'Failed to load bindings'),
        empty: false,
        sections: [],
        selectedCount: 0,
        visibleCount: 0,
        unboundCount: 0
      });
    }
  }

  private createSections(schema: NodelJsonSchema, values: Record<string, unknown>) {
    return (['actions', 'events'] as BindingKind[])
      .map((kind) => this.createSection(kind, schema.properties?.[kind], objectValue(values[kind])))
      .filter((section) => section.rows.length > 0);
  }

  private createSection(kind: BindingKind, schema: NodelJsonSchema | undefined, values: Record<string, unknown>): BindingSection {
    const targetKey = targetKeyFor(kind);
    const targetLabel = targetLabelFor(kind);
    const rows = Object.entries(schema?.properties ?? {})
      .map(([alias, rowSchema]) => {
        const value = objectValue(values[alias]);
        const row: BindingRow = {
          id: nextBindingId(kind, alias),
          kind,
          targetKey,
          targetLabel,
          alias,
          title: titleFor(alias, rowSchema),
          description: typeof rowSchema.desc === 'string' ? rowSchema.desc : '',
          node: stringValue(value.node),
          nodeAddress: '',
          target: stringValue(value[targetKey]),
          selected: false,
          status: normalizeStatus(''),
          statusClass: statusClass(normalizeStatus('')),
          nodeOptions: [],
          targetOptions: [],
          showNodeOptions: false,
          showTargetOptions: false,
          searchingNode: false,
          searchingTarget: false,
          suggestionValue: '',
          suggestionLabel: '',
          suggestionConfidence: '',
          suggestionClass: suggestionClass('')
        };
        return row;
      });

    const section: BindingSection = {
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
    this.updateSectionSummary(section);
    return section;
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
      getJQuery().observable(row).setProperty({
        node: target.value,
        nodeAddress: ''
      });
      void this.searchRowNodes(row, target.value);
      return;
    }

    if (target.hasAttribute('data-bindings-target')) {
      getJQuery().observable(row).setProperty({
        target: target.value,
        suggestionValue: '',
        suggestionLabel: '',
        suggestionConfidence: '',
        suggestionClass: suggestionClass('')
      });
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
      getJQuery().observable(row).setProperty('selected', target.checked);
    }

    const section = this.sectionForElement(target);
    if (section) {
      this.updateSectionSummary(section);
      this.updateToolbarSummary();
    }
  };

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
      this.setState({
        bulkNodeOptions: [],
        showBulkNodeOptions: false
      });
      return;
    }

    const row = this.rowForElement(combobox);
    if (row) {
      getJQuery().observable(row).setProperty({
        nodeOptions: [],
        showNodeOptions: false,
        targetOptions: [],
        showTargetOptions: false
      });
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
      const selected = this.state.bulkNodeOptions[index] ?? {
        value: option.dataset.optionValue ?? '',
        label: option.dataset.optionValue ?? '',
        address: option.dataset.optionAddress ?? '',
        detail: ''
      };
      if (selected) {
        this.setState({
          bulkNode: selected.value,
          bulkNodeAddress: selected.address,
          bulkNodeOptions: [],
          showBulkNodeOptions: false
        });
      }
      return;
    }

    const row = this.rowForElement(option);
    if (!row) {
      return;
    }

    if (optionType === 'node') {
      const selected = row.nodeOptions[index] ?? {
        value: option.dataset.optionValue ?? '',
        label: option.dataset.optionValue ?? '',
        address: option.dataset.optionAddress ?? '',
        detail: ''
      };
      if (selected) {
        $.observable(row).setProperty({
          node: selected.value,
          nodeAddress: selected.address,
          nodeOptions: [],
          showNodeOptions: false
        });
      }
      return;
    }

    if (optionType === 'target') {
      const selected = row.targetOptions[index] ?? {
        value: option.dataset.optionValue ?? '',
        label: option.dataset.optionValue ?? '',
        detail: ''
      };
      if (selected) {
        $.observable(row).setProperty({
          target: selected.value,
          targetOptions: [],
          showTargetOptions: false,
          suggestionValue: '',
          suggestionLabel: '',
          suggestionConfidence: '',
          suggestionClass: suggestionClass('')
        });
      }
    }
  }

  private async searchBulkNodes(query: string) {
    const token = ++this.nodeSearchToken;
    this.setState({ searchingBulkNode: true });
    try {
      const options = query.trim() ? (await searchNodeUrls(query)).slice(0, 20).map(optionFromNode) : [];
      if (token === this.nodeSearchToken) {
        this.setState({
          bulkNodeOptions: options,
          showBulkNodeOptions: options.length > 0
        });
      }
    } catch {
      if (token === this.nodeSearchToken) {
        this.setState({
          bulkNodeOptions: [],
          showBulkNodeOptions: false
        });
      }
    } finally {
      if (token === this.nodeSearchToken) {
        this.setState({ searchingBulkNode: false });
      }
    }
  }

  private async searchRowNodes(row: BindingRow, query: string) {
    const token = ++this.nodeSearchToken;
    getJQuery().observable(row).setProperty({ searchingNode: true });
    try {
      const options = query.trim() ? (await searchNodeUrls(query)).slice(0, 20).map(optionFromNode) : [];
      if (token === this.nodeSearchToken) {
        getJQuery().observable(row).setProperty({
          nodeOptions: options,
          showNodeOptions: options.length > 0
        });
      }
    } catch {
      if (token === this.nodeSearchToken) {
        getJQuery().observable(row).setProperty({
          nodeOptions: [],
          showNodeOptions: false
        });
      }
    } finally {
      if (token === this.nodeSearchToken) {
        getJQuery().observable(row).setProperty({ searchingNode: false });
      }
    }
  }

  private async searchTargets(row: BindingRow, query: string) {
    const token = ++this.targetSearchToken;
    getJQuery().observable(row).setProperty({ searchingTarget: true });
    try {
      const definitions = row.node ? await this.getTargetDefinitions(row) : [];
      const options = definitionsToOptions(definitions, query);
      if (token === this.targetSearchToken) {
        getJQuery().observable(row).setProperty({
          targetOptions: options,
          showTargetOptions: options.length > 0
        });
      }
    } catch {
      if (token === this.targetSearchToken) {
        getJQuery().observable(row).setProperty({
          targetOptions: [],
          showTargetOptions: false
        });
      }
    } finally {
      if (token === this.targetSearchToken) {
        getJQuery().observable(row).setProperty({ searchingTarget: false });
      }
    }
  }

  private selectRows(mode: string) {
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

    for (const row of this.allRows()) {
      if (row.selected) {
        getJQuery().observable(row).setProperty({
          node: this.state.bulkNode,
          nodeAddress: this.state.bulkNodeAddress,
          suggestionValue: '',
          suggestionLabel: '',
          suggestionConfidence: '',
          suggestionClass: suggestionClass('')
        });
      }
    }
  }

  private async suggestMatches() {
    const rows = this.allRows().filter((row) => row.selected && row.node);
    if (rows.length === 0) {
      this.setState({
        message: 'Select rows with a node before suggesting matches.',
        toolbarError: ''
      });
      return;
    }

    this.setState({
      busy: true,
      message: '',
      toolbarError: ''
    });

    try {
      let suggested = 0;
      for (const row of rows) {
        const definitions = await this.getTargetDefinitions(row);
        const suggestion = buildSuggestion(row, definitions);
        if (suggestion.confidence === 'high' || suggestion.confidence === 'medium') {
          suggested += 1;
        }
        getJQuery().observable(row).setProperty({
          suggestionValue: suggestion.value,
          suggestionLabel: suggestion.label,
          suggestionConfidence: suggestion.confidence,
          suggestionClass: suggestionClass(suggestion.confidence)
        });
      }
      this.setState({ message: `${suggested} suggestion${suggested === 1 ? '' : 's'} ready.` });
    } catch (error) {
      this.setState({ toolbarError: apiErrorMessage(error, 'Failed to suggest matches') });
    } finally {
      this.setState({ busy: false });
    }
  }

  private applySuggestions() {
    let applied = 0;
    for (const row of this.allRows()) {
      if (!row.selected || !row.suggestionValue || (row.suggestionConfidence !== 'high' && row.suggestionConfidence !== 'medium')) {
        continue;
      }
      getJQuery().observable(row).setProperty('target', row.suggestionValue);
      applied += 1;
    }
    this.setState({
      message: `${applied} suggestion${applied === 1 ? '' : 's'} applied.`,
      toolbarError: ''
    });
  }

  private async getTargetDefinitions(row: BindingRow) {
    const nodeUrl = await this.resolveNodeUrl(row);
    const key = `${row.kind}:${nodeUrl}`;
    if (!this.targetCache.has(key)) {
      this.targetCache.set(key, (row.kind === 'actions' ? getRemoteNodeActions(nodeUrl) : getRemoteNodeSignals(nodeUrl)).then(normalizeDefinitions));
    }
    return this.targetCache.get(key)!;
  }

  private async resolveNodeUrl(row: BindingRow) {
    if (row.nodeAddress) {
      return row.nodeAddress;
    }

    const entries = await searchNodeUrls(row.node);
    const options = entries.map(optionFromNode);
    const match = options.find((option) => option.value === row.node || option.label === row.node) ?? options[0];
    if (match) {
      getJQuery().observable(row).setProperty('nodeAddress', match.address);
      return match.address;
    }

    return `/nodes/${encodeURIComponent(getVerySimpleName(row.node))}/`;
  }

  private async saveBindings() {
    const payload = this.serializePayload();
    this.setState({
      saving: true,
      saveError: '',
      saveMessage: ''
    });

    try {
      await saveNodeRemoteBindings(payload);
      this.setState({ saveMessage: 'Saved' });
      this.dispatchEvent(new CustomEvent('nodel-bindings-saved', {
        bubbles: true,
        detail: { payload }
      }));
      if (this.saveMessageTimer !== null) {
        window.clearTimeout(this.saveMessageTimer);
      }
      this.saveMessageTimer = window.setTimeout(() => {
        this.setState({ saveMessage: '' });
        this.saveMessageTimer = null;
      }, 2500);
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to save bindings');
      this.setState({ saveError: message });
      this.dispatchEvent(new CustomEvent('nodel-bindings-error', {
        bubbles: true,
        detail: { error: message, payload }
      }));
    } finally {
      this.setState({ saving: false });
    }
  }

  private serializePayload() {
    const payload: Record<string, unknown> = {
      actions: {},
      events: {}
    };

    for (const section of this.state.sections) {
      const sectionPayload: Record<string, unknown> = {};
      for (const row of section.rows) {
        sectionPayload[row.alias] = {
          node: row.node,
          [row.targetKey]: row.target
        };
      }
      payload[section.kind] = sectionPayload;
    }

    return payload;
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
      if (entry.source !== 'remote' || (entry.type !== 'actionBinding' && entry.type !== 'eventBinding')) {
        continue;
      }

      const kind: BindingKind = entry.type === 'actionBinding' ? 'actions' : 'events';
      const row = this.findRow(kind, String(entry.alias ?? ''));
      if (!row) {
        continue;
      }

      const status = normalizeStatus(entry.arg);
      getJQuery().observable(row).setProperty({
        status,
        statusClass: statusClass(status)
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
