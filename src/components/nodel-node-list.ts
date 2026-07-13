import { checkHostReachable, getLocalRest, searchNodeUrls } from '../api/nodel-host-client';
import type { NodelLocalNodeEntry, NodelNodeUrlEntry } from '../api/nodel-types';
import { registerNodelPollSource, type NodelSourceState, type NodelSourceSubscription } from '../data/nodel-data-runtime';
import { bootstrapJsViews, getJQuery, linkTemplate, unlinkTemplate } from '../jsviews/jsviews-runtime';
import { getHostFromAddress, getSimpleName, getVerySimpleName } from '../utils/node-name';
import { escapeHtml } from '../utils/html';
import { renderFontAwesomeIcon, uiIcons } from '../icons/fontawesome';
import './nodel-host-icon';

type NodeListScope = 'local' | 'network';

interface NodeListStateItem {
  name: string;
  address: string;
  host: string;
  iconHost: string;
  reachable: boolean;
  highlightedName: string;
  sortKey: string;
}

interface NodeListState {
  scope: NodeListScope;
  flt: string;
  end: number;
  total: number;
  lst: NodeListStateItem[];
  loading: boolean;
  moreAvailable: boolean;
  error: string;
}

const pageSizes = [10, 20, 50, 100, 99999];
const refreshIntervalMs = 2000;
const searchDebounceMs = 200;
const rowAffordanceMarkup = renderFontAwesomeIcon(uiIcons.chevronRight, 'nodel-list-item-affordance');

const template = `
  <div class="nodel-node-list space-y-4">
    <form class="nodel-node-list-controls flex flex-wrap items-center gap-3">
      <input class="nodel-node-list-filter nodel-field flex-1" type="text" placeholder="Filter nodes" data-link="value{:flt}" />
      <select class="nodel-node-list-show nodel-field" aria-label="Rows per page" data-link="value{:end}">
        <option value="10">10</option>
        <option value="20">20</option>
        <option value="50">50</option>
        <option value="100">100</option>
        <option value="99999">All</option>
      </select>
      <p class="nodel-node-list-total text-sm text-nodel-muted">{^{:total === 1 ? '1 node' : total + ' nodes'}}</p>
    </form>

    {^{if loading}}
      <div class="nodel-alert nodel-alert-md">Loading nodes...</div>
    {{else}}
      {^{if error}}
        <div class="nodel-alert nodel-alert-danger nodel-alert-md">{^{:error}}</div>
      {{else}}
        <div class="nodel-node-list-results space-y-3">
          {^{if lst.length}}
            <ul class="nodel-node-list-items nodel-list">
              {^{for lst}}
                <li>
                  <a class="nodel-node-list-item nodel-list-item flex items-center gap-3 px-3 py-2 transition" data-link="href{:address} class{:reachable ? 'nodel-node-list-item nodel-list-item flex items-center gap-3 px-3 py-2 transition' : 'nodel-node-list-item nodel-list-item is-unreachable flex items-center gap-3 px-3 py-2 transition' }">
                    <nodel-host-icon class="nodel-node-icon shrink-0" data-link="host{:host} icon-host{:iconHost} alt{:host}"></nodel-host-icon>
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate text-sm font-medium">{^{:~highlight(name, ~root.flt)}}</span>
                      <span class="truncate text-xs text-nodel-muted">{^{:host}}</span>
                    </span>
                    ${rowAffordanceMarkup}
                  </a>
                </li>
              {{/for}}
            </ul>
            {^{if moreAvailable}}
              <button type="button" class="nodel-node-list-more nodel-button nodel-button-ghost" data-node-list-more>Load more</button>
            {{/if}}
          {{else flt}}
            <div class="nodel-node-list-empty text-sm text-nodel-muted" role="status">No nodes match this filter.</div>
          {{else}}
            <div class="nodel-node-list-empty text-sm text-nodel-muted" role="status">No nodes available.</div>
          {{/if}}
        </div>
      {{/if}}
    {{/if}}
  </div>
`;

function normalizeScope(value: string | null): NodeListScope {
  return value === 'network' ? 'network' : 'local';
}

function nextPageSize(current: number): number {
  const index = pageSizes.indexOf(current);
  if (index === -1 || index === pageSizes.length - 1) {
    return current;
  }
  return pageSizes[index + 1];
}

export class NodelNodeList extends HTMLElement {
  static observedAttributes = ['scope', 'poll-interval', 'page-size'];

  private static nextSourceId = 0;

  private connected = false;
  private debounceTimer: number | null = null;
  private linked = false;
  private lastAppliedUpdatedAt: number | null = null;
  private source: NodelSourceSubscription<NodeListStateItem[]> | null = null;
  private state: NodeListState = {
    scope: 'local',
    flt: '',
    end: 20,
    total: 0,
    lst: [],
    loading: true,
    moreAvailable: false,
    error: ''
  };

  connectedCallback() {
    this.connected = true;
    void this.initialize();
  }

  disconnectedCallback() {
    this.connected = false;
    this.clearDebounceTimer();
    this.disposeSource();
    this.removeEventListener('click', this.handleClick);
    void unlinkTemplate(this);
  }

  attributeChangedCallback() {
    if (this.connected) {
      void this.initialize();
    }
  }

  private clearDebounceTimer() {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private get pollInterval() {
    const value = Number(this.getAttribute('poll-interval') ?? refreshIntervalMs);
    return Number.isFinite(value) && value > 0 ? value : refreshIntervalMs;
  }

  private get pageSize() {
    const value = Number(this.getAttribute('page-size') ?? this.state.end);
    return pageSizes.includes(value) ? value : this.state.end;
  }

  private async initialize() {
    this.state.scope = normalizeScope(this.getAttribute('scope'));
    this.state.end = this.pageSize;
    if (!this.linked) {
      this.innerHTML = `<div class="nodel-node-list-shell"></div>`;
      await bootstrapJsViews();
      await linkTemplate(this, template, this.state);
      this.linked = true;
      this.bindEvents();
    }

    this.syncStateFromAttributes();
    this.rebuildSource();
  }

  private bindEvents() {
    const filterInput = this.querySelector<HTMLInputElement>('.nodel-node-list-filter');
    const showSelect = this.querySelector<HTMLSelectElement>('.nodel-node-list-show');

    filterInput?.removeEventListener('input', this.handleFilterInput);
    filterInput?.addEventListener('input', this.handleFilterInput);
    showSelect?.removeEventListener('change', this.handleShowChange);
    showSelect?.addEventListener('change', this.handleShowChange);
    this.removeEventListener('click', this.handleClick);
    this.addEventListener('click', this.handleClick);
  }

  private syncStateFromAttributes() {
    const $ = getJQuery();
    $.observable(this.state).setProperty('scope', normalizeScope(this.getAttribute('scope')));
    $.observable(this.state).setProperty('end', this.pageSize);
  }

  private handleFilterInput = (event: Event) => {
    const value = (event.currentTarget as HTMLInputElement).value;
    this.state.flt = value;
    this.scheduleRefresh();
  };

  private handleShowChange = (event: Event) => {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    this.state.end = pageSizes.includes(value) ? value : 20;
    void this.source?.refresh();
  };

  private handleMoreClick = () => {
    this.state.end = nextPageSize(this.state.end);
    this.scheduleRefresh();
  };

  private handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest('[data-node-list-more]')) {
      event.preventDefault();
      this.handleMoreClick();
    }
  };

  private scheduleRefresh() {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.source?.refresh();
    }, searchDebounceMs);
  };

  private rebuildSource() {
    this.disposeSource();

    const source = registerNodelPollSource<NodeListStateItem[]>({
      key: `nodel-node-list-${NodelNodeList.nextSourceId += 1}`,
      intervalMs: this.pollInterval,
      visibleOnly: true,
      fetcher: async (signal) => {
        return this.state.scope === 'network' ? this.loadNetworkRows(signal) : this.loadLocalRows(signal);
      }
    });

    this.source = source.subscribe(this, (state: NodelSourceState<NodeListStateItem[]>) => {
      if (state.error) {
        this.setLoading(false);
        this.setError(state.error);
        this.applyRows([]);
        return;
      }

      this.setError('');
      this.setLoading(state.loading);
      if (state.updatedAt !== this.lastAppliedUpdatedAt) {
        this.lastAppliedUpdatedAt = state.updatedAt;
        this.applyRows(state.data ?? []);
      }
    });
  }

  private disposeSource() {
    this.source?.dispose();
    this.source = null;
    this.lastAppliedUpdatedAt = null;
  }

  private setLoading(loading: boolean) {
    const $ = getJQuery();
    $.observable(this.state).setProperty('loading', loading);
  }

  private setError(error: string) {
    const $ = getJQuery();
    $.observable(this.state).setProperty('error', error);
  }

  private applyRows(rows: NodeListStateItem[]) {
    const $ = getJQuery();
    const visibleRows = rows.slice(0, this.state.end);
    $.observable(this.state).setProperty('total', rows.length);
    $.observable(this.state.lst).refresh(visibleRows);
    $.observable(this.state).setProperty('moreAvailable', rows.length > this.state.end);
  }

  private async loadLocalRows(signal: AbortSignal): Promise<NodeListStateItem[]> {
    const rest = await getLocalRest({ signal });
    const entries = Object.values(rest.nodes ?? {});
    const filtered = entries.filter((entry) => this.matchesFilter(entry.name));
    const host = 'localhost';
    const iconHost = window.location.host;

    return filtered
      .map((entry) => this.toLocalRow(entry, host, iconHost))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey, undefined, { sensitivity: 'base' }));
  }

  private async loadNetworkRows(signal: AbortSignal): Promise<NodeListStateItem[]> {
    const entries = await searchNodeUrls(this.state.flt, { signal });
    const rows = entries
      .map((entry) => this.toNetworkRow(entry))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey, undefined, { sensitivity: 'base' }));

    const hostResults = await Promise.all(
      Array.from(new Set(rows.map((row) => row.host))).map(async (host) => [host, (await checkHostReachable(host, 3000, signal)).reachable] as const)
    );
    const reachableByHost = new Map(hostResults);

    for (const row of rows) {
      row.reachable = reachableByHost.get(row.host) ?? false;
    }

    return rows;
  }

  private matchesFilter(value: string) {
    if (!this.state.flt) {
      return true;
    }

    return value.toLocaleLowerCase().includes(this.state.flt.toLocaleLowerCase());
  }

  private toLocalRow(entry: NodelLocalNodeEntry, host: string, iconHost: string): NodeListStateItem {
    const name = entry.name || entry.node || '';
    const nodeName = getSimpleName(name);
    const address = entry.address || `/nodes/${encodeURIComponent(getVerySimpleName(name))}`;

    return {
      name,
      address,
      host,
      iconHost,
      reachable: true,
      highlightedName: escapeHtml(name),
      sortKey: nodeName,
    };
  }

  private toNetworkRow(entry: NodelNodeUrlEntry): NodeListStateItem {
    const address = entry.address;
    const host = entry.host || getHostFromAddress(address);
    const name = entry.name || entry.node || getSimpleName(address);

    return {
      name,
      address,
      host,
      iconHost: host,
      reachable: false,
      highlightedName: escapeHtml(name),
      sortKey: entry.node || getSimpleName(name),
    };
  }

}

if (!customElements.get('nodel-node-list')) {
  customElements.define('nodel-node-list', NodelNodeList);
}
