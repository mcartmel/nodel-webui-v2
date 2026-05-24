import type { NodelActivityLogEntry } from '../api/nodel-types';
import { subscribeNodeActivity, type NodeActivityBatch } from '../data/node-activity-source';
import { logIcons, renderFontAwesomeIcon } from '../icons/fontawesome';
import { getJQuery, linkTemplate, unlinkTemplate } from '../jsviews/jsviews-runtime';
import { escapeHtml } from '../utils/html';

type RowLimit = '10' | '50' | '100' | 'all';

interface ActivityRowView {
  alias: string;
  argMarkup: string;
  argText: string;
  displayTime: string;
  entry: NodelActivityLogEntry;
  highlightArg: boolean;
  iconClass: string;
  iconMarkup: string;
  key: string;
  pulse: boolean;
  rowClass: string;
  showArg: boolean;
}

interface LogViewModel {
  filter: string;
  hold: boolean;
  limit: RowLimit;
  statusLabel: string;
  statusState: 'loading' | 'active' | 'paused' | 'error';
  visibleRows: ActivityRowView[];
}

const template = `
  <div class="nodel-log relative min-w-0" data-link="title{:statusLabel} aria-label{:statusLabel}">
    <div class="nodel-log-panel">
      <div class="nodel-log-toolbar">
        <label class="block min-w-0 text-sm font-medium text-nodel-fg">
          <input data-log-filter class="nodel-field w-full" type="search" placeholder="Alias" data-link="filter trigger=true" />
        </label>
        <div class="flex min-w-0 flex-wrap items-center gap-3 text-sm text-nodel-muted md:justify-end">
          <label class="inline-flex shrink-0 items-center gap-2">
            <input data-log-hold type="checkbox" data-link="hold" />
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
        {^{for visibleRows}}
          <div data-link="class{:rowClass}">
            <span data-link="class{:iconClass}" aria-hidden="true">{^{:iconMarkup}}</span>
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
      </div>
    </div>
  </div>
`;

function rowKey(entry: NodelActivityLogEntry) {
  return `${entry.source ?? ''}_${entry.type ?? ''}_${entry.alias ?? ''}`;
}

function formatTimestamp(timestamp: unknown) {
  const value = String(timestamp ?? '');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(timestamp ?? '') : date.toLocaleTimeString();
}

function formatArg(arg: unknown) {
  if (arg === undefined) {
    return '';
  }

  const text = JSON.stringify(arg, null, 2) ?? '';
  return text.length > 250 ? `${text.slice(0, 247)}...` : text;
}

function highlightJson(json: string) {
  const tokenPattern = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;
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

function logIcon(entry: NodelActivityLogEntry) {
  const icon = logIcons[entry.type] ?? logIcons.event;
  const baseIcon = renderFontAwesomeIcon(icon, 'h-3.5 w-3.5');
  const remoteIcon = entry.source === 'remote'
    ? renderFontAwesomeIcon(logIcons.remote, 'h-2.5 w-2.5')
    : '';

  return `${baseIcon}${remoteIcon}`;
}

function rowLimitCount(limit: RowLimit) {
  return limit === 'all' ? Number.POSITIVE_INFINITY : Number(limit);
}

export class NodelLog extends HTMLElement {
  private order: string[] = [];
  private pulseTimers = new Map<string, number>();
  private rows = new Map<string, ActivityRowView>();
  private source: ReturnType<typeof subscribeNodeActivity> | null = null;
  private linked = false;
  private state: LogViewModel = {
    filter: '',
    hold: false,
    limit: '10',
    statusLabel: 'Loading activity',
    statusState: 'loading',
    visibleRows: []
  };

  connectedCallback() {
    void this.initialize();
  }

  disconnectedCallback() {
    this.source?.dispose();
    this.source = null;
    this.unobserveControls();
    for (const timer of this.pulseTimers.values()) {
      window.clearTimeout(timer);
    }
    this.pulseTimers.clear();
    void unlinkTemplate(this);
    this.linked = false;
  }

  private async initialize() {
    if (!this.linked) {
      await linkTemplate(this, template, this.state);
      this.linked = true;
      this.observeControls();
    }

    if (this.source) {
      return;
    }

    this.source = subscribeNodeActivity(this, (state) => {
      if (state.batch) {
        this.applyBatch(state.batch);
      }
      this.updateStatus(state.loading, state.error, state.connected, state.batch?.transport);
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

  private updateStatus(loading: boolean, error: string, connected: boolean, transport?: string) {
    const label = error || (loading ? 'Loading activity' : connected ? 'Activity stream connected' : transport === 'poll' ? 'Activity polling active' : 'Activity stream paused');
    const statusState = error ? 'error' : loading ? 'loading' : connected || transport === 'poll' ? 'active' : 'paused';
    const $ = getJQuery();

    $.observable(this.state).setProperty({
      statusLabel: label,
      statusState
    });
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

    return {
      alias: String(entry.alias ?? ''),
      argMarkup: entry.arg === undefined ? '' : highlightArg ? highlightJson(argText) : escapeHtml(argText),
      argText,
      displayTime: formatTimestamp(entry.timestamp),
      entry,
      highlightArg,
      iconClass: `nodel-log-icon nodel-log-source-${escapeHtml(entry.source)} nodel-log-type-${escapeHtml(entry.type)}`,
      iconMarkup: logIcon(entry),
      key,
      pulse,
      rowClass: `nodel-log-row ${pulse ? 'is-pulsing' : ''}`,
      showArg: entry.arg !== undefined
    };
  }

  private updateRow(row: ActivityRowView, entry: NodelActivityLogEntry, pulse: boolean) {
    const next = this.createRow(row.key, entry, pulse);
    getJQuery().observable(row).setProperty({
      alias: next.alias,
      argMarkup: next.argMarkup,
      argText: next.argText,
      displayTime: next.displayTime,
      entry: next.entry,
      highlightArg: next.highlightArg,
      iconClass: next.iconClass,
      iconMarkup: next.iconMarkup,
      pulse: next.pulse,
      rowClass: next.rowClass,
      showArg: next.showArg
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
          rowClass: 'nodel-log-row'
        });
      }
    }, 700);
    this.pulseTimers.set(key, timer);
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

    getJQuery().observable(this.state.visibleRows).refresh(this.visibleRows());
  }
}

if (!customElements.get('nodel-log')) {
  customElements.define('nodel-log', NodelLog);
}
