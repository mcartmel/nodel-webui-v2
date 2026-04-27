import type { NodelActivityLogEntry } from '../api/nodel-types';
import { subscribeNodeActivity, type NodeActivityBatch } from '../data/node-activity-source';
import { logIcons, renderFontAwesomeIcon } from '../icons/fontawesome';
import { escapeHtml } from '../utils/html';

type RowLimit = 10 | 50 | 100 | 'all';

interface ActivityRow {
  entry: NodelActivityLogEntry;
  pulse: boolean;
}

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
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
    let cls = 'jsonnumber';
    if (match.startsWith('"')) {
      cls = /:\s*$/.test(match) ? 'jsonkey' : 'jsonstring';
    } else if (/true|false/.test(match)) {
      cls = 'jsonboolean';
    } else if (/null/.test(match)) {
      cls = 'jsonnull';
    }

    return `<span class="${cls}">${match}</span>`;
  });
}

function logIcon(entry: NodelActivityLogEntry) {
  const icon = logIcons[entry.type] ?? logIcons.event;
  const baseIcon = renderFontAwesomeIcon(icon, 'h-3.5 w-3.5');
  const remoteIcon = entry.source === 'remote'
    ? renderFontAwesomeIcon(logIcons.remote, 'h-2.5 w-2.5')
    : '';

  return `${baseIcon}${remoteIcon}`;
}

export class NodelLog extends HTMLElement {
  private rows = new Map<string, ActivityRow>();
  private order: string[] = [];
  private rowElements = new Map<string, HTMLElement>();
  private source: ReturnType<typeof subscribeNodeActivity> | null = null;
  private filter = '';
  private hold = false;
  private limit: RowLimit = 50;
  private pulseTimers = new Map<string, number>();
  private shellReady = false;

  connectedCallback() {
    this.renderShell();
    this.bindEvents();
    this.source = subscribeNodeActivity(this, (state) => {
      if (state.batch) {
        this.applyBatch(state.batch);
      }
      this.updateStatus(state.loading, state.error, state.connected, state.batch?.transport);
    });
  }

  disconnectedCallback() {
    this.source?.dispose();
    this.source = null;
    this.removeEventListeners();
    for (const timer of this.pulseTimers.values()) {
      window.clearTimeout(timer);
    }
    this.pulseTimers.clear();
  }

  private renderShell() {
    if (this.shellReady) {
      return;
    }

    this.innerHTML = `
      <div class="nodel-log relative min-w-0 space-y-3">
        <div class="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label class="block min-w-0 text-sm font-medium text-[rgb(var(--nodel-fg))]">
            <input data-log-filter class="mt-1 block w-full min-w-0 rounded-xl border border-[rgb(var(--nodel-border))] bg-[rgb(var(--nodel-surface))] px-3 py-2 text-sm text-[rgb(var(--nodel-fg))] outline-none" type="search" placeholder="Alias" />
          </label>
          <div class="flex min-w-0 flex-wrap items-center gap-3 text-sm text-[rgb(var(--nodel-muted))] md:justify-end">
            <label class="inline-flex shrink-0 items-center gap-2">
              <input data-log-hold type="checkbox" />
              Hold
            </label>
            <label class="inline-flex shrink-0 items-center gap-2">
              Rows
              <select data-log-limit class="rounded-lg border border-[rgb(var(--nodel-border))] bg-[rgb(var(--nodel-surface))] px-2 py-1 text-[rgb(var(--nodel-fg))]">
                <option value="10">10</option>
                <option value="50" selected>50</option>
                <option value="100">100</option>
                <option value="all">All</option>
              </select>
            </label>
          </div>
        </div>
        <div data-log-output class="nodel-log-output space-y-1"></div>
      </div>
    `;
    this.shellReady = true;
  }

  private bindEvents() {
    this.querySelector('[data-log-filter]')?.addEventListener('input', this.handleFilter);
    this.querySelector('[data-log-hold]')?.addEventListener('change', this.handleHold);
    this.querySelector('[data-log-limit]')?.addEventListener('change', this.handleLimit);
  }

  private removeEventListeners() {
    this.querySelector('[data-log-filter]')?.removeEventListener('input', this.handleFilter);
    this.querySelector('[data-log-hold]')?.removeEventListener('change', this.handleHold);
    this.querySelector('[data-log-limit]')?.removeEventListener('change', this.handleLimit);
  }

  private handleFilter = (event: Event) => {
    this.filter = ((event.currentTarget as HTMLInputElement).value ?? '').trim().toLowerCase();
    this.renderRows();
  };

  private handleHold = (event: Event) => {
    this.hold = (event.currentTarget as HTMLInputElement).checked;
    this.renderRows();
  };

  private handleLimit = (event: Event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    this.limit = value === 'all' ? 'all' : Number(value) as RowLimit;
    this.renderRows();
  };

  private updateStatus(loading: boolean, error: string, connected: boolean, transport?: string) {
    const label = error || (loading ? 'Loading activity' : connected ? 'Activity stream connected' : transport === 'poll' ? 'Activity polling active' : 'Activity stream paused');
    this.dataset.state = error ? 'error' : loading ? 'loading' : connected || transport === 'poll' ? 'active' : 'paused';
    this.setAttribute('aria-label', label);
    this.title = label;
  }

  private applyBatch(batch: NodeActivityBatch) {
    if (batch.replace) {
      this.rows.clear();
      this.order = [];
      for (const element of this.rowElements.values()) {
        element.remove();
      }
      this.rowElements.clear();
      for (const timer of this.pulseTimers.values()) {
        window.clearTimeout(timer);
      }
      this.pulseTimers.clear();
    }

    if (batch.replace && batch.items.length > 100 && !this.hold) {
      this.hold = true;
      const holdInput = this.querySelector<HTMLInputElement>('[data-log-hold]');
      if (holdInput) {
        holdInput.checked = true;
      }
    }

    if (!batch.replace && batch.items.length === 0) {
      return;
    }

    const dirtyKeys = new Set<string>();
    let orderChanged = batch.replace;

    for (const item of batch.items) {
      const key = rowKey(item.entry);
      const existing = this.rows.get(key);
      this.rows.set(key, { entry: item.entry, pulse: item.live && item.changed });
      dirtyKeys.add(key);

      if (!existing) {
        this.order.unshift(key);
        orderChanged = true;
      } else if (item.live && !this.hold) {
        if (this.order[0] !== key) {
          this.order = [key, ...this.order.filter((value) => value !== key)];
          orderChanged = true;
        }
      }

      if (item.live && item.changed) {
        this.schedulePulseClear(key);
      }
    }

    this.reconcileRows(dirtyKeys, orderChanged);
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
        row.pulse = false;
        this.rowElements.get(key)?.classList.remove('is-pulsing');
      }
    }, 700);
    this.pulseTimers.set(key, timer);
  }

  private visibleKeys() {
    const filtered = this.filter
      ? this.order.filter((key) => String(this.rows.get(key)?.entry.alias ?? '').toLowerCase().includes(this.filter))
      : this.order;
    const visible = filtered.filter((key) => this.rows.get(key)?.entry.seq !== 0);

    return this.limit === 'all' ? visible : visible.slice(0, this.limit);
  }

  private renderRows() {
    this.reconcileRows(new Set(this.visibleKeys()), true);
  }

  private reconcileRows(dirtyKeys = new Set<string>(), orderChanged = false) {
    const output = this.querySelector<HTMLElement>('[data-log-output]');
    if (!output) {
      return;
    }

    const keys = this.visibleKeys();
    if (keys.length === 0) {
      for (const element of this.rowElements.values()) {
        element.remove();
      }
      this.rowElements.clear();
      output.textContent = '';
      return;
    }

    const visible = new Set(keys);
    for (const [key, element] of this.rowElements) {
      if (!visible.has(key)) {
        element.remove();
        this.rowElements.delete(key);
      }
    }

    keys.forEach((key, index) => {
      let element = this.rowElements.get(key);
      if (!element) {
        element = document.createElement('div');
        element.dataset.logKey = key;
        this.rowElements.set(key, element);
        dirtyKeys.add(key);
      }

      if (dirtyKeys.has(key)) {
        this.updateRowElement(key, element);
      }

      if (orderChanged || element.parentElement !== output || output.children[index] !== element) {
        output.insertBefore(element, output.children[index] ?? null);
      }
    });
  }

  private updateRowElement(key: string, element: HTMLElement) {
    const row = this.rows.get(key);
    if (!row) {
      return;
    }

    const { entry } = row;
    const arg = formatArg(entry.arg);
    const shouldHighlightJson = Boolean(this.hold || this.filter);
    const argMarkup = entry.arg === undefined
      ? ''
      : `<span class="nodel-log-arg ${shouldHighlightJson ? 'is-highlighted' : ''}">${shouldHighlightJson ? highlightJson(arg) : escapeHtml(arg)}</span>`;
    element.className = `nodel-log-row ${row.pulse ? 'is-pulsing' : ''}`;
    element.dataset.logKey = key;
    element.innerHTML = `
      <span class="nodel-log-icon nodel-log-source-${escapeHtml(entry.source)} nodel-log-type-${escapeHtml(entry.type)}" aria-hidden="true">${logIcon(entry)}</span>
      <span class="nodel-log-main">
        <span class="nodel-log-titleline">
          <span class="nodel-log-alias">${escapeHtml(entry.alias)}</span>
          <span class="nodel-log-time"> - ${escapeHtml(formatTimestamp(entry.timestamp))}</span>
        </span>
        ${argMarkup}
      </span>
    `;
  }
}

if (!customElements.get('nodel-log')) {
  customElements.define('nodel-log', NodelLog);
}
