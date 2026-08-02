import {
  getLocalRest,
  getNodeRemoteBindings,
  getNodeRemoteSchema,
  getRemoteNodeActions,
  getRemoteNodeSignals,
  saveNodeRemoteBindings,
  searchNodeUrls
} from '../api/nodel-host-client';
import type { NodelActionDefinition, NodelActivityLogEntry, NodelJsonSchema, NodelLocalNodeEntry, NodelNodeUrlEntry, NodelSignalDefinition } from '../api/nodel-types';
import { subscribeNodeActivity } from '../data/node-activity-source';
import type { NodeRestartRefreshResult } from '../data/node-restart-source';
import { renderFontAwesomeIcon, uiIcons } from '../icons/fontawesome';
import { bootstrapJsViews, getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { renderComponentError } from '../utils/render-component-error';
import { getSimpleName, getVerySimpleName } from '../utils/node-name';
import { networkNodeSearchHref } from '../navigation/node-links';
import { activateActivePopoverOption, getPopoverOptions, moveActivePopoverOption } from '../utils/popover-keyboard';
import { safeRemoteNodeUrl } from '../utils/urls';
import { cloneSchemaValue } from '../schema/schema-values';
import { validateValueAgainstSchema } from '../schema/schema-validation';
import { normalizeSchema } from '../schema/schema-model';

type BindingKind = 'actions' | 'events';
type BindingTargetKey = 'action' | 'event';
type SuggestionConfidence = '' | 'high' | 'medium' | 'ambiguous' | 'none';
const collapseIconMarkup = renderFontAwesomeIcon(uiIcons.chevronDown, 'h-3 w-3');

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
  statusHref: string;
  statusLinkLabel: string;
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
  schema: NodelJsonSchema;
  originalValue: Record<string, unknown>;
  rowPresent: boolean;
  nodePresent: boolean;
  targetPresent: boolean;
  dirty: boolean;
  nodeDirty: boolean;
  targetDirty: boolean;
  nodeError: string;
  targetError: string;
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
  invalid: boolean;
}

interface TargetDefinition {
  name: string;
  title: string;
  group: string;
}

interface TargetCacheEntry {
  expiresAt: number;
  promise: Promise<TargetDefinition[]>;
}

interface TargetFetchResult {
  definitions: TargetDefinition[];
  url: string;
}

interface LocalNodeCandidate {
  key: string;
  entry: NodelLocalNodeEntry;
  name: string;
}

const targetCacheTtlMs = 30 * 1000;
const targetLookupTimeoutMs = 3000;

const template = `
  <div class="nodel-bindings" data-link="class{:loading ? 'nodel-bindings is-loading' : 'nodel-bindings'}">
    <form class="nodel-bindings-panel space-y-3" data-bindings-form autocomplete="off">
      {^{if loading}}
        <div class="nodel-alert nodel-alert-md">Loading bindings...</div>
      {{else error}}
        <div class="nodel-alert nodel-alert-danger nodel-alert-md">{^{>error}}</div>
      {{else empty}}
        <div class="nodel-alert nodel-alert-md">No bindings.</div>
      {{else}}
        <fieldset data-link="disabled{:saving}">
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
          <div class="space-y-3">
            {^{for sections}}
              <details class="nodel-bindings-section nodel-collapse nodel-panel" open data-link="data-bindings-section{:kind}">
                <summary class="nodel-collapse-summary">
                  <span class="nodel-collapse-label">{^{>title}}</span>
                  <span class="nodel-collapse-preview">{^{:selectedCount}} selected, {^{:unboundCount}} unwired</span>
                  <span class="nodel-collapse-icon" aria-hidden="true">${collapseIconMarkup}</span>
                </summary>
                <div class="nodel-collapse-content space-y-2.5">
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
                             <input class="nodel-field nodel-field-compact w-full" type="text" spellcheck="false" placeholder="node" data-bindings-node data-link="{:node:} id{:id + '-node'} aria-invalid{:nodeError ? 'true' : 'false'} aria-describedby{:nodeError ? id + '-node-error' : ''}" />
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
                           {^{if nodeError}}<span class="nodel-alert nodel-alert-danger nodel-alert-sm" role="alert" data-link="id{:id + '-node-error'} text{:nodeError}"></span>{{/if}}
                           </span>
                           <span class="nodel-bindings-combobox">
                             <input class="nodel-field nodel-field-compact w-full" type="text" spellcheck="false" data-bindings-target data-link="{:target:} id{:id + '-target'} placeholder{:targetLabel} aria-invalid{:targetError ? 'true' : 'false'} aria-describedby{:targetError ? id + '-target-error' : ''}" />
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
                           {^{if targetError}}<span class="nodel-alert nodel-alert-danger nodel-alert-sm" role="alert" data-link="id{:id + '-target-error'} text{:targetError}"></span>{{/if}}
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

function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function nextBindingId(kind: BindingKind, alias: string) {
  return `nodel-bindings-${kind}-${alias.replace(/[^a-zA-Z0-9_-]+/g, '-')}-${bindingHash(`${kind}:${alias}`)}`;
}

function bindingHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateBindingRow(row: BindingRow) {
  // Java RemoteBindingValues serialises a declared but unbound row as an empty
  // object; BaseNode treats that state as valid and reports it as unbound.
  if (!row.nodePresent && !row.targetPresent && !row.nodeDirty && !row.targetDirty) return [];
  const value: Record<string, unknown> = cloneSchemaValue(row.originalValue);
  if (row.nodeDirty || row.nodePresent) value.node = row.node;
  if (row.targetDirty || row.targetPresent) value[row.targetKey] = row.target;
  return validateValueAgainstSchema(value, row.schema, row.id).map((issue) => ({
    ...issue,
    fieldId: issue.fieldId.startsWith(row.id) ? issue.fieldId : `${row.id}${issue.pointer}`,
    pointer: issue.pointer.startsWith(row.id) ? issue.pointer : `${row.id}${issue.pointer}`
  }));
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

function statusLinkProperties(node: string) {
  const name = node.trim();
  return {
    statusHref: name ? networkNodeSearchHref(name) : '',
    statusLinkLabel: name ? `Open ${name} in Network nodes` : ''
  };
}

function getNodeOptionValue(entry: NodelNodeUrlEntry) {
  return getSimpleName(entry.node || entry.name || '');
}

function optionFromNode(entry: NodelNodeUrlEntry): BindingOption {
  const url = safeRemoteNodeUrl(entry.address);
  if (!url) {
    throw new Error('Discovered node URL is invalid');
  }
  const label = getNodeOptionValue(entry) || getSimpleName(entry.address);
  return {
    label,
    value: label,
    address: url.href,
    detail: entry.host || url.host
  };
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeNodeIdentity(value: string) {
  return normalizeText(getVerySimpleName(getSimpleName(value)));
}

function nodeNameMatches(left: string, right: string) {
  const normalizedLeft = normalizeNodeIdentity(left);
  const normalizedRight = normalizeNodeIdentity(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function nodeUrlMatches(entry: NodelNodeUrlEntry, node: string) {
  return nodeNameMatches(entry.node || entry.name || getSimpleName(entry.address), node);
}

function localNodeName(key: string, entry: NodelLocalNodeEntry) {
  return entry.name || entry.node || key;
}

function nodeBaseUrl(nodeUrl: string) {
  return nodeUrl.replace(/\/?$/, '/');
}

function localNodeUrl(name: string) {
  return new URL(`/nodes/${encodeURIComponent(getVerySimpleName(name))}/`, window.location.origin).href;
}

function uniqueUrls(urls: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const url of urls) {
    const normalized = safeRemoteNodeUrl(new URL(nodeBaseUrl(url), window.location.origin).href)?.href;
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function mergeDefinitions(results: TargetFetchResult[]) {
  const byName = new Map<string, TargetDefinition>();
  for (const result of results) {
    for (const definition of result.definitions) {
      if (!byName.has(definition.name)) {
        byName.set(definition.name, definition);
      }
    }
  }
  return Array.from(byName.values());
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Target lookup timed out')), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
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
  private lifecycle = new ComponentLifecycle();
  private linkController = new JsViewsLinkController(this);
  private saveMessageTimer: number | null = null;
  private source: ReturnType<typeof subscribeNodeActivity> | null = null;
  private filterInput: HTMLInputElement | null = null;
  private observingControls = false;
  private targetCache = new Map<string, TargetCacheEntry>();
  private localNodesPromise: Promise<LocalNodeCandidate[]> | null = null;
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
    this.nodeSearchToken += 1;
    this.targetSearchToken += 1;
    if (this.linked) {
      this.setState({ busy: false, loading: false, saving: false, searchingBulkNode: false, showBulkNodeOptions: false });
    }
    this.lifecycle.disconnect();
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
    this.removeEventListener('keydown', this.handleKeydown);
    this.removeEventListener('focusout', this.handleFocusOut);
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
      const sections = this.createSections(normalizedSchema.schema, values);
      this.setState({
        loading: false,
        empty: sections.every((section) => section.rows.length === 0),
        sections,
        invalid: false
      });
      this.validateBindings();
      this.bindFilterInput();
      this.updateToolbarSummary();
      return { status: 'verified' };
    } catch (error) {
      if (!scope.isCurrent() || controller !== this.abortController) {
        return { status: 'superseded', detail: 'Bindings refresh was superseded.' };
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
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
        const node = stringValue(value.node);
        const row: BindingRow = {
          id: nextBindingId(kind, alias),
          kind,
          targetKey,
          targetLabel,
          alias,
          title: titleFor(alias, rowSchema),
          description: typeof rowSchema.desc === 'string' ? rowSchema.desc : '',
          node,
          nodeAddress: '',
          target: stringValue(value[targetKey]),
          schema: rowSchema,
          originalValue: cloneSchemaValue(value),
          rowPresent: Object.prototype.hasOwnProperty.call(values, alias),
          nodePresent: Object.prototype.hasOwnProperty.call(value, 'node'),
          targetPresent: Object.prototype.hasOwnProperty.call(value, targetKey),
          dirty: false,
          nodeDirty: false,
          targetDirty: false,
          nodeError: '',
          targetError: '',
          selected: false,
          status: normalizeStatus(''),
          statusClass: statusClass(normalizeStatus('')),
          ...statusLinkProperties(node),
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

    if (this.validateBindings().length > 0) {
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
      this.clearLookupCaches();
      getJQuery().observable(row).setProperty({
        node: target.value,
        nodeAddress: '',
        nodePresent: true,
        dirty: true,
        nodeDirty: true,
        ...statusLinkProperties(target.value)
      });
      this.validateBindings();
      void this.searchRowNodes(row, target.value);
      return;
    }

    if (target.hasAttribute('data-bindings-target')) {
      getJQuery().observable(row).setProperty({
        target: target.value,
        targetPresent: true,
        dirty: true,
        targetDirty: true,
        suggestionValue: '',
        suggestionLabel: '',
        suggestionConfidence: '',
        suggestionClass: suggestionClass('')
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
      this.nodeSearchToken += 1;
      this.setState({
        bulkNodeOptions: [],
        showBulkNodeOptions: false
      });
      return;
    }

    const row = this.rowForElement(combobox);
    if (row) {
      this.nodeSearchToken += 1;
      this.targetSearchToken += 1;
      getJQuery().observable(row).setProperty({
        nodeOptions: [],
        showNodeOptions: false,
        targetOptions: [],
        showTargetOptions: false
      });
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

    if (event.key === 'Escape' && getPopoverOptions(combobox, '[data-bindings-option]').length > 0) {
      event.preventDefault();
      this.closeAutocompleteForInput(target);
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
      this.clearLookupCaches();
      this.nodeSearchToken += 1;
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
      this.clearLookupCaches();
      this.nodeSearchToken += 1;
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
          nodePresent: true,
          dirty: true,
          nodeDirty: true,
          ...statusLinkProperties(selected.value),
          nodeOptions: [],
          showNodeOptions: false
        });
        this.validateBindings();
      }
      return;
    }

    if (optionType === 'target') {
      this.targetSearchToken += 1;
      const selected = row.targetOptions[index] ?? {
        value: option.dataset.optionValue ?? '',
        label: option.dataset.optionValue ?? '',
        detail: ''
      };
      if (selected) {
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
          suggestionClass: suggestionClass('')
        });
        this.validateBindings();
      }
    }
  }

  private isAutocompleteInput(input: HTMLInputElement) {
    return input.hasAttribute('data-bindings-bulk-node')
      || input.hasAttribute('data-bindings-node')
      || input.hasAttribute('data-bindings-target');
  }

  private closeAutocompleteForInput(input: HTMLInputElement) {
    if (input.hasAttribute('data-bindings-bulk-node')) {
      this.nodeSearchToken += 1;
      this.setState({
        bulkNodeOptions: [],
        showBulkNodeOptions: false
      });
      return;
    }

    const row = this.rowForElement(input);
    if (!row) {
      return;
    }

    if (input.hasAttribute('data-bindings-node')) {
      this.nodeSearchToken += 1;
      getJQuery().observable(row).setProperty({
        nodeOptions: [],
        showNodeOptions: false
      });
      return;
    }

    if (input.hasAttribute('data-bindings-target')) {
      this.targetSearchToken += 1;
      getJQuery().observable(row).setProperty({
        targetOptions: [],
        showTargetOptions: false
      });
    }
  }

  private async searchBulkNodes(query: string) {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const token = ++this.nodeSearchToken;
    const originalQuery = query;
    this.setState({ searchingBulkNode: true, toolbarError: '' });
    try {
      const options = query.trim() ? (await searchNodeUrls(query, { signal: scope.signal })).slice(0, 20).map(optionFromNode) : [];
      if (scope.isCurrent() && token === this.nodeSearchToken && this.state.bulkNode === originalQuery) {
        this.setState({
          bulkNodeOptions: options,
          showBulkNodeOptions: options.length > 0
        });
      }
    } catch (error) {
      if (scope.isCurrent() && token === this.nodeSearchToken) {
        this.setState({
          bulkNodeOptions: [],
          showBulkNodeOptions: false,
          toolbarError: apiErrorMessage(error, 'Failed to search nodes')
        });
      }
    } finally {
      if (scope.isCurrent() && token === this.nodeSearchToken) {
        this.setState({ searchingBulkNode: false });
      }
    }
  }

  private async searchRowNodes(row: BindingRow, query: string) {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const token = ++this.nodeSearchToken;
    const originalQuery = query;
    getJQuery().observable(row).setProperty({ searchingNode: true });
    this.setState({ toolbarError: '' });
    try {
      const options = query.trim() ? (await searchNodeUrls(query, { signal: scope.signal })).slice(0, 20).map(optionFromNode) : [];
      if (scope.isCurrent() && token === this.nodeSearchToken && row.node === originalQuery) {
        getJQuery().observable(row).setProperty({
          nodeOptions: options,
          showNodeOptions: options.length > 0
        });
      }
    } catch (error) {
      if (scope.isCurrent() && token === this.nodeSearchToken) {
        getJQuery().observable(row).setProperty({
          nodeOptions: [],
          showNodeOptions: false
        });
        this.setState({ toolbarError: apiErrorMessage(error, 'Failed to search nodes') });
      }
    } finally {
      if (scope.isCurrent() && token === this.nodeSearchToken) {
        getJQuery().observable(row).setProperty({ searchingNode: false });
      }
    }
  }

  private async searchTargets(row: BindingRow, query: string) {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    const token = ++this.targetSearchToken;
    const originalQuery = query;
    getJQuery().observable(row).setProperty({ searchingTarget: true });
    this.setState({ toolbarError: '' });
    try {
      const definitions = row.node ? await this.getTargetDefinitions(row, scope) : [];
      const options = definitionsToOptions(definitions, query);
      if (scope.isCurrent() && token === this.targetSearchToken && row.target === originalQuery) {
        getJQuery().observable(row).setProperty({
          targetOptions: options,
          showTargetOptions: options.length > 0
        });
      }
    } catch (error) {
      if (scope.isCurrent() && token === this.targetSearchToken) {
        getJQuery().observable(row).setProperty({
          targetOptions: [],
          showTargetOptions: false
        });
        this.setState({ toolbarError: apiErrorMessage(error, 'Failed to load target definitions') });
      }
    } finally {
      if (scope.isCurrent() && token === this.targetSearchToken) {
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

    this.clearLookupCaches();
    for (const row of this.allRows()) {
      if (row.selected) {
        getJQuery().observable(row).setProperty({
          node: this.state.bulkNode,
          nodeAddress: this.state.bulkNodeAddress,
          nodePresent: true,
          dirty: true,
          nodeDirty: true,
          ...statusLinkProperties(this.state.bulkNode),
          suggestionValue: '',
          suggestionLabel: '',
          suggestionConfidence: '',
          suggestionClass: suggestionClass('')
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
        const definitions = await this.getTargetDefinitions(row, scope);
        if (!scope.isCurrent()) {
          return;
        }
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
      if (scope.isCurrent()) {
        this.setState({ toolbarError: apiErrorMessage(error, 'Failed to suggest matches') });
      }
    } finally {
      if (scope.isCurrent()) {
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

  private async getTargetDefinitions(row: BindingRow, scope: ConnectionScope) {
    const key = this.targetCacheKey(row);
    const cached = this.targetCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }

    const promise = this.loadTargetDefinitions(row, scope);
    this.targetCache.set(key, {
      expiresAt: Date.now() + targetCacheTtlMs,
      promise
    });

    promise.catch(() => {
      if (this.targetCache.get(key)?.promise === promise) {
        this.targetCache.delete(key);
      }
    });

    return promise;
  }

  private targetCacheKey(row: BindingRow) {
    return `${row.kind}:${normalizeNodeIdentity(row.node)}:${row.nodeAddress}`;
  }

  private async loadTargetDefinitions(row: BindingRow, scope: ConnectionScope) {
    const localNode = await this.findLocalNode(row.node, scope);
    if (!scope.isCurrent()) {
      return [];
    }
    if (localNode) {
      const result = await this.fetchTargetDefinitions(row.kind, localNodeUrl(localNode.name), scope);
      return result.definitions;
    }

    const entries = await searchNodeUrls(row.node, { signal: scope.signal });
    if (!scope.isCurrent()) {
      return [];
    }
    const discoveredUrls = entries
      .filter((entry) => nodeUrlMatches(entry, row.node))
      .map((entry) => entry.address);
    const candidateUrls = uniqueUrls([
      row.nodeAddress,
      ...discoveredUrls,
      discoveredUrls.length === 0 && entries[0] ? entries[0].address : '',
      discoveredUrls.length === 0 && entries.length === 0 ? localNodeUrl(row.node) : ''
    ].filter((url): url is string => Boolean(url)));

    const results = await Promise.all(candidateUrls.map((url) => this.fetchTargetDefinitions(row.kind, url, scope).then(
      (result) => result,
      () => null
    )));
    const successful = results.filter((result): result is TargetFetchResult => Boolean(result));
    if (successful.length === 0) {
      throw new Error('Failed to load target definitions');
    }

    return mergeDefinitions(successful);
  }

  private async fetchTargetDefinitions(kind: BindingKind, nodeUrl: string, scope: ConnectionScope): Promise<TargetFetchResult> {
    const definitions = await withTimeout(
      kind === 'actions' ? getRemoteNodeActions(nodeUrl, { signal: scope.signal }) : getRemoteNodeSignals(nodeUrl, { signal: scope.signal }),
      targetLookupTimeoutMs
    );
    return {
      definitions: normalizeDefinitions(definitions),
      url: nodeBaseUrl(nodeUrl)
    };
  }

  private async findLocalNode(node: string, scope: ConnectionScope) {
    const localNodes = await this.getLocalNodes(scope).catch(() => []);
    return localNodes.find((item) => nodeNameMatches(item.name, node)) ?? null;
  }

  private getLocalNodes(scope: ConnectionScope) {
    if (!this.localNodesPromise) {
      this.localNodesPromise = getLocalRest({ signal: scope.signal }).then((rest) => {
        return Object.entries(rest.nodes ?? {}).map(([key, entry]) => ({
          key,
          entry,
          name: localNodeName(key, entry)
        }));
      }).catch((error) => {
        this.localNodesPromise = null;
        throw error;
      });
    }
    return this.localNodesPromise;
  }

  private clearLookupCaches() {
    this.targetCache.clear();
    this.localNodesPromise = null;
  }

  private async saveBindings() {
    const scope = this.lifecycle.current;
    if (!scope) {
      return;
    }
    if (this.validateBindings().length > 0) {
      return;
    }
    const payload = this.serializePayload();
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

  private serializePayload() {
    const payload: Record<string, unknown> = cloneSchemaValue(this.sourceBindings);

    for (const section of this.state.sections) {
      const sourceSectionPresent = Object.prototype.hasOwnProperty.call(payload, section.kind);
      if (!sourceSectionPresent && !section.rows.some((row) => row.dirty)) continue;
      const sectionPayload: Record<string, unknown> = isRecordValue(payload[section.kind]) ? cloneSchemaValue(payload[section.kind]) as Record<string, unknown> : {};
      for (const row of section.rows) {
        if (!row.dirty && row.rowPresent) {
          continue;
        }
        if (!row.dirty) continue;
        const rowPayload: Record<string, unknown> = cloneSchemaValue(row.originalValue);
        if (row.nodeDirty) rowPayload.node = row.node;
        if (row.targetDirty) rowPayload[row.targetKey] = row.target;
        sectionPayload[row.alias] = rowPayload;
      }
      payload[section.kind] = sectionPayload;
    }

    return payload;
  }

  private validateBindings() {
    const issues = this.allRows().flatMap((row) => validateBindingRow(row));
    for (const row of this.allRows()) {
      const rowIssues = issues.filter((issue) => issue.fieldId === row.id || issue.fieldId.startsWith(`${row.id}/`));
      const nodeIssue = rowIssues.find((issue) => issue.pointer.endsWith('/node'));
      const targetIssue = rowIssues.find((issue) => issue.pointer.endsWith(`/${row.targetKey}`));
      getJQuery().observable(row).setProperty({
        nodeError: nodeIssue?.message ?? (!targetIssue && rowIssues.length > 0 ? rowIssues[0]?.message ?? '' : ''),
        targetError: targetIssue?.message ?? ''
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
