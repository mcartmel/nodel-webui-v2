import type { NodelActivityLogEntry } from '../api/nodel-types';
import { subscribeNodeActivity, type NodeActivityBatch, type NodeActivityTransport } from '../data/node-activity-source';
import { logIcons, renderFontAwesomeIcon } from '../icons/fontawesome';
import { getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { renderComponentError } from '../utils/render-component-error';
import { escapeHtml, safeText } from '../utils/html';

type RowLimit = '10' | '50' | '100' | 'all';

interface ActivityRowView {
  alias: string;
  argMarkup: string;
  argText: string;
  iconLabel: string;
  displayTime: string;
  entry: NodelActivityLogEntry;
  highlightArg: boolean;
  iconClass: string;
  iconMarkup: string;
  key: string;
  pulse: boolean;
  rowClass: string;
  source: string;
  showArg: boolean;
  type: string;
}

interface LogViewModel {
  empty: boolean;
  emptyLabel: string;
  filter: string;
  hold: boolean;
  limit: RowLimit;
  statusLabel: string;
  statusState: 'loading' | 'active' | 'paused' | 'error';
  visibleRows: ActivityRowView[];
}

const template = `
  <div class="nodel-log relative min-w-0" data-link="title{:statusLabel} aria-label{:statusLabel}">
    {^{if statusState === 'error'}}
      <div data-log-status class="nodel-alert nodel-alert-danger nodel-alert-md mb-3" role="alert">{^{>statusLabel}}</div>
    {{/if}}
    <div class="nodel-log-panel">
      <div class="nodel-log-toolbar">
        <label class="block min-w-0 text-sm font-medium text-nodel-fg">
          <input data-log-filter class="nodel-field w-full" type="search" placeholder="Filter activity" data-link="filter trigger=true" />
        </label>
        <div class="flex min-w-0 flex-wrap items-center gap-3 text-sm text-nodel-muted md:justify-end">
          <label class="inline-flex shrink-0 items-center gap-2">
            <input class="nodel-choice" data-log-hold type="checkbox" data-link="hold" />
            Hold
          </label>
          <label class="inline-flex shrink-0 items-center gap-2">
            Rows
            <select data-log-limit class="nodel-field nodel-field-compact" data-link="limit">
              <option value="10">10</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>
      </div>
      <div data-log-output class="nodel-log-output space-y-1">
        {^{if empty}}
          <div class="nodel-log-empty text-sm text-nodel-muted" role="status">{^{>emptyLabel}}</div>
        {{else}}
          {^{for visibleRows}}
            <div data-link="class{:rowClass} data-log-source{:source} data-log-type{:type}">
              <span data-link="class{:iconClass} data-log-source{:source} data-log-type{:type} aria-label{:iconLabel} title{:iconLabel}" role="img">{^{:iconMarkup}}</span>
              <span class="nodel-log-main">
                <span class="nodel-log-titleline">
                  <span class="nodel-log-alias">{^{>alias}}</span>
                  <span class="nodel-log-time"> - {^{>displayTime}}</span>
                </span>
                {^{if showArg}}
                  <span data-link="class{:highlightArg ? 'nodel-log-arg is-highlighted' : 'nodel-log-arg'}">{^{:argMarkup}}</span>
                {{/if}}
              </span>
            </div>
          {{/for}}
        {{/if}}
      </div>
    </div>
  </div>
`;

function rowKey(entry: NodelActivityLogEntry) {
  return `${entry.source ?? ''}_${entry.type ?? ''}_${entry.alias ?? ''}`;
}

function formatTimestamp(timestamp: unknown) {
  if (timestamp === undefined || timestamp === null) {
    return '';
  }
  if (typeof timestamp !== 'string') {
    return safeText(timestamp);
  }
  if (!timestamp.trim()) {
    return '';
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
}

function formatArg(arg: unknown) {
  if (arg === undefined) {
    return '';
  }

  const text = JSON.stringify(arg, null, 2) ?? '';
  return text.length > 250 ? `${text.slice(0, 247)}...` : text;
}

function highlightJson(json: string) {
  const tokenPattern = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;
  let markup = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(json)) !== null) {
    markup += escapeHtml(json.slice(lastIndex, match.index));

    let cls = 'jsonnumber';
    const value = match[0];
    if (value.startsWith('"')) {
      cls = /:\s*$/.test(value) ? 'jsonkey' : 'jsonstring';
    } else if (/true|false/.test(value)) {
      cls = 'jsonboolean';
    } else if (/null/.test(value)) {
      cls = 'jsonnull';
    }

    markup += `<span class="${cls}">${escapeHtml(value)}</span>`;
    lastIndex = match.index + value.length;
  }

  return `${markup}${escapeHtml(json.slice(lastIndex))}`;
}

interface LogIconDescriptor {
  badge: typeof logIcons.remote   | null;
  base: typeof logIcons.action  ;
  label: string;
}

function logIconDescriptor(entry: NodelActivityLogEntry): LogIconDescriptor {
  if (entry.type === 'actionBinding') {
    return { base: logIcons.action, badge: logIcons.actionBinding, label: 'Remote action binding status' };
  }

  if (entry.type === 'eventBinding') {
    return { base: logIcons.event, badge: logIcons.eventBinding, label: 'Remote signal binding status' };
  }

  if (entry.type === 'action' && entry.source === 'local') {
    return { base: logIcons.action, badge: null, label: 'Local action' };
  }

  if (entry.type === 'action' && entry.source === 'remote') {
    return { base: logIcons.action, badge: logIcons.remote, label: 'Remote action' };
  }

  if (entry.type === 'action' && entry.source === 'unbound') {
    return { base: logIcons.action, badge: null, label: 'Unbound action' };
  }

  if (entry.type === 'event' && entry.source === 'local') {
    return { base: logIcons.event, badge: null, label: 'Local signal' };
  }

  if (entry.type === 'event' && entry.source === 'remote') {
    return { base: logIcons.event, badge: logIcons.remote, label: 'Remote signal' };
  }

  if (entry.type === 'event' && entry.source === 'unbound') {
    return { base: logIcons.event, badge: null, label: 'Unbound signal' };
  }

  return {
    base: logIcons.event,
    badge: entry.source === 'remote' ? logIcons.remote : null,
    label: 'Activity'
  };
}

function logIconMarkup(entry: NodelActivityLogEntry) {
  const descriptor = logIconDescriptor(entry);
  const baseIcon = renderFontAwesomeIcon(descriptor.base, 'nodel-log-icon-primary');
  const badgeIcon = descriptor.badge
    ? renderFontAwesomeIcon(descriptor.badge, 'nodel-log-icon-badge')
    : '';

  return { markup: `${baseIcon}${badgeIcon}`, label: descriptor.label };
}

function rowClass(pulse: boolean) {
  return `nodel-log-row${pulse ? ' is-pulsing' : ''}`;
}

function rowLimitCount(limit: RowLimit) {
  return limit === 'all' ? Number.POSITIVE_INFINITY : Number(limit);
}

export class NodelLog extends HTMLElement {
  private order: string[] = [];
  private pulseTimers = new Map<string, number>();
  private rows = new Map<string, ActivityRowView>();
  private lifecycle = new ComponentLifecycle();
  private linkController = new JsViewsLinkController(this);
  private source: ReturnType<typeof subscribeNodeActivity> | null = null;
  private linked = false;
  private state: LogViewModel = {
    empty: false,
    emptyLabel: 'No activity entries yet.',
    filter: '',
    hold: false,
    limit: '10',
    statusLabel: 'Loading activity',
    statusState: 'loading',
    visibleRows: []
  };

  connectedCallback() {
    const scope = this.lifecycle.connect();
    if (scope) {
      void scope.run(() => this.initialize(scope), (error) => this.handleInitializationError(error));
    }
  }

  disconnectedCallback() {
    this.lifecycle.disconnect();
    for (const timer of this.pulseTimers.values()) {
      window.clearTimeout(timer);
    }
    this.pulseTimers.clear();
    for (const row of this.rows.values()) {
      row.pulse = false;
      row.rowClass = rowClass(false);
    }
    this.linked = false;
  }

  private async initialize(scope: ConnectionScope) {
    const linked = await this.linkController.link(scope, template, this.state);
    if (!linked || !scope.isCurrent()) {
      return;
    }
    this.linked = true;
    this.observeControls();
    scope.own(() => this.unobserveControls());

    const source = subscribeNodeActivity(this, scope.guard((state) => {
      if (state.batch) {
        this.applyBatch(state.batch);
      }
      this.updateStatus(state.loading, state.error, state.connected, state.transport);
    }));
    this.source = source;
    scope.own(() => {
      source.dispose();
      if (this.source === source) {
        this.source = null;
      }
    });
  }

  private observeControls() {
    const $ = getJQuery() as ReturnType<typeof getJQuery> & {
      observe: (object: unknown, paths: string, handler: () => void) => void;
    };
    $.observe(this.state, 'filter', this.handleControlChange);
    $.observe(this.state, 'hold', this.handleControlChange);
    $.observe(this.state, 'limit', this.handleControlChange);
  }

  private unobserveControls() {
    const $ = getJQuery() as ReturnType<typeof getJQuery> & {
      unobserve: (object: unknown, paths: string, handler: () => void) => void;
    };
    $.unobserve?.(this.state, 'filter', this.handleControlChange);
    $.unobserve?.(this.state, 'hold', this.handleControlChange);
    $.unobserve?.(this.state, 'limit', this.handleControlChange);
  }

  private handleControlChange = () => {
    this.refreshVisibleRows();
  };

  private updateStatus(loading: boolean, error: string, connected: boolean, transport: NodeActivityTransport | null) {
    const label = error || (loading ? 'Loading activity' : connected ? 'Activity stream connected' : transport === 'poll' ? 'Activity polling active' : 'Activity stream paused');
    const statusState = error ? 'error' : loading ? 'loading' : connected || transport === 'poll' ? 'active' : 'paused';
    const $ = getJQuery();

    $.observable(this.state).setProperty({
      statusLabel: label,
      statusState
    });
    this.syncEmptyState(statusState);
    this.dataset.state = statusState;
    this.setAttribute('aria-label', label);
    this.title = label;
  }

  private applyBatch(batch: NodeActivityBatch) {
    if (batch.replace) {
      this.rows.clear();
      this.order = [];
      for (const timer of this.pulseTimers.values()) {
        window.clearTimeout(timer);
      }
      this.pulseTimers.clear();
    }

    if (batch.replace && batch.items.length > 100 && !this.state.hold) {
      getJQuery().observable(this.state).setProperty('hold', true);
    }

    if (!batch.replace && batch.items.length === 0) {
      return;
    }

    let orderChanged = batch.replace;
    for (const item of batch.items) {
      const key = rowKey(item.entry);
      const existing = this.rows.get(key);

      if (existing) {
        this.updateRow(existing, item.entry, item.live && item.changed);
      } else {
        this.rows.set(key, this.createRow(key, item.entry, item.live && item.changed));
        this.order.unshift(key);
        orderChanged = true;
      }

      if (existing && item.live && !this.state.hold && this.order[0] !== key) {
        this.order = [key, ...this.order.filter((value) => value !== key)];
        orderChanged = true;
      }

      if (item.live && item.changed) {
        this.schedulePulseClear(key);
      }
    }

    if (orderChanged || batch.items.length > 0) {
      this.refreshVisibleRows();
    }
  }

  private createRow(key: string, entry: NodelActivityLogEntry, pulse: boolean): ActivityRowView {
    const argText = formatArg(entry.arg);
    const highlightArg = Boolean(this.state.hold || this.state.filter);
    const icon = logIconMarkup(entry);

    return {
      alias: String(entry.alias ?? ''),
      argMarkup: entry.arg === undefined ? '' : highlightArg ? highlightJson(argText) : escapeHtml(argText),
      argText,
      iconLabel: icon.label,
      displayTime: formatTimestamp(entry.timestamp),
      entry,
      highlightArg,
      iconClass: 'nodel-log-icon',
      iconMarkup: icon.markup,
      key,
      pulse,
      rowClass: rowClass(pulse),
      source: entry.source,
      showArg: entry.arg !== undefined,
      type: entry.type
    };
  }

  private updateRow(row: ActivityRowView, entry: NodelActivityLogEntry, pulse: boolean) {
    const next = this.createRow(row.key, entry, pulse);
    getJQuery().observable(row).setProperty({
      alias: next.alias,
      argMarkup: next.argMarkup,
      argText: next.argText,
      iconLabel: next.iconLabel,
      displayTime: next.displayTime,
      entry: next.entry,
      highlightArg: next.highlightArg,
      iconClass: next.iconClass,
      iconMarkup: next.iconMarkup,
      pulse: next.pulse,
      rowClass: next.rowClass,
      source: next.source,
      showArg: next.showArg,
      type: next.type
    });
  }

  private schedulePulseClear(key: string) {
    const current = this.pulseTimers.get(key);
    if (current !== undefined) {
      window.clearTimeout(current);
    }

    const timer = window.setTimeout(() => {
      this.pulseTimers.delete(key);
      const row = this.rows.get(key);
      if (row) {
        getJQuery().observable(row).setProperty({
          pulse: false,
          rowClass: rowClass(false)
        });
      }
    }, 700);
    this.pulseTimers.set(key, timer);
  }

  private handleInitializationError(error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to initialize activity log';
    this.dataset.state = 'error';
    if (this.linked) {
      this.updateStatus(false, message, false, null);
    } else {
      renderComponentError(this, message);
    }
  }

  private visibleRows() {
    const filter = this.state.filter.trim().toLowerCase();
    const filtered = filter
      ? this.order.filter((key) => String(this.rows.get(key)?.entry.alias ?? '').toLowerCase().includes(filter))
      : this.order;
    const visible = filtered.filter((key) => this.rows.get(key)?.entry.seq !== 0);

    return visible.slice(0, rowLimitCount(this.state.limit)).map((key) => this.rows.get(key)).filter((row): row is ActivityRowView => Boolean(row));
  }

  private refreshVisibleRows() {
    for (const row of this.rows.values()) {
      this.updateRow(row, row.entry, row.pulse);
    }

    const visibleRows = this.visibleRows();
    getJQuery().observable(this.state.visibleRows).refresh(visibleRows);
    this.syncEmptyState(this.state.statusState, visibleRows);
  }

  private syncEmptyState(statusState: LogViewModel['statusState'], visibleRows = this.visibleRows()) {
    const filter = this.state.filter.trim();
    const empty = statusState !== 'loading' && statusState !== 'error' && visibleRows.length === 0;
    getJQuery().observable(this.state).setProperty({
      empty,
      emptyLabel: filter ? 'No activity matches this filter.' : 'No activity entries yet.'
    });
  }
}

if (!customElements.get('nodel-log')) {
  customElements.define('nodel-log', NodelLog);
}
