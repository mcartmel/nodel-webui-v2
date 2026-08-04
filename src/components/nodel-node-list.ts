import { checkHostReachable, getLocalRest, searchNodeUrls } from '../api/nodel-host-client';
import type { NodelLocalNodeEntry, NodelNodeUrlEntry } from '../api/nodel-types';
import { registerNodelPollSource, type NodelSourceState, type NodelSourceSubscription } from '../data/nodel-data-runtime';
import { bootstrapJsViews, getJQuery } from '../jsviews/jsviews-runtime';
import { JsViewsLinkController } from '../jsviews/jsviews-link-controller';
import { ComponentLifecycle, type ConnectionScope } from '../utils/component-lifecycle';
import { isAbortError } from '../utils/errors';
import { renderComponentError } from '../utils/render-component-error';
import { getHostFromAddress, getSimpleName, isUsableNodeName } from '../utils/node-name';
import { renderFontAwesomeIcon, uiIcons } from '../icons/fontawesome';
import { canonicalRemoteNodeHref, localNodePath, remoteNodeDisplayHost, safeNavigationHref, safeRemoteNodeUrl } from '../utils/urls';
import './nodel-host-icon';

type NodeListScope = 'local' | 'network';
type NodeReachability = 'unknown' | 'reachable' | 'unreachable';

interface NodeListStateItem {
  name: string;
  address: string;
  host: string;
  iconHost: string;
  navigable: boolean;
  fetchable: boolean;
  reachable: boolean;
  reachability: NodeReachability;
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
const localRefreshIntervalMs = 2000;
const networkRefreshIntervalMs = 10_000;
const searchDebounceMs = 200;
const reachabilityConcurrency = 4;
const maxRetainedNodeRows = 1000;
const rowAffordanceMarkup = renderFontAwesomeIcon(uiIcons.chevronRight, 'nodel-list-item-affordance');

interface ReachabilityJob {
  host: string;
  controller: AbortController;
  isCurrent: () => boolean;
  apply: (reachable: boolean) => void;
}

/** One queue per element keeps unresolved probes bounded across refresh generations. */
class ReachabilityScheduler {
  private active = new Set<ReachabilityJob>();
  private queued: ReachabilityJob[] = [];

  submit(jobs: ReachabilityJob[]) {
    this.queued.push(...jobs);
    this.drain();
  }

  cancel(predicate: (job: ReachabilityJob) => boolean) {
    this.queued = this.queued.filter((job) => !predicate(job));
    for (const job of this.active) {
      if (predicate(job)) {
        job.controller.abort();
      }
    }
  }

  private drain() {
    while (this.active.size < reachabilityConcurrency && this.queued.length > 0) {
      const job = this.queued.shift()!;
      if (!job.isCurrent()) {
        continue;
      }
      this.active.add(job);
      void Promise.resolve()
        .then(() => checkHostReachable(job.host, 3000, job.controller.signal))
        .then((result) => {
          if (job.isCurrent()) {
            job.apply(result.reachable);
          }
        })
        .catch((error) => {
          if (!isAbortError(error) && job.isCurrent()) {
            job.apply(false);
          }
        })
        .finally(() => {
          this.active.delete(job);
          this.drain();
        });
    }
  }
}

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
        <div class="nodel-alert nodel-alert-danger nodel-alert-md" role="alert" data-link="text{:error}"></div>
      {{else}}
        <div class="nodel-node-list-results space-y-3">
          {^{if lst.length}}
            <ul class="nodel-node-list-items nodel-list">
              {^{for lst}}
                <li>
                  <a class="nodel-node-list-item nodel-list-item flex items-center gap-3 px-3 py-2 transition" data-link="href{:navigable ? address : null} aria-disabled{:navigable ? null : 'true'} tabindex{:navigable ? null : '0'} data-reachability{:reachability} class{:!navigable ? 'nodel-node-list-item nodel-list-item is-disabled flex items-center gap-3 px-3 py-2 transition' : reachability === 'unreachable' ? 'nodel-node-list-item nodel-list-item is-unreachable flex items-center gap-3 px-3 py-2 transition' : 'nodel-node-list-item nodel-list-item flex items-center gap-3 px-3 py-2 transition' }">
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
  static observedAttributes = ['scope', 'poll-interval', 'page-size', 'query-param'];

  private static nextSourceId = 0;

  private appliedQueryParam: string | undefined;
  private debounceTimer: number | null = null;
  private connectionLifecycle = new ComponentLifecycle();
  private initializeToken = 0;
  private lifecycle = Promise.resolve();
  private linked = false;
  private linkController = new JsViewsLinkController(this);
  private acceptedSnapshotUpdatedAt: number | null = null;
  private lastSourceUpdatedAt: number | null = null;
  private lastSourceActive: boolean | null = null;
  private reachabilityGeneration = 0;
  private reachabilityScheduler = new ReachabilityScheduler();
  private currentReachabilityGeneration: number | null = null;
  private discoveryRows: readonly NodeListStateItem[] = [];
  private displayRows: readonly NodeListStateItem[] = [];
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
    const scope = this.connectionLifecycle.connect();
    if (!scope) {
      return;
    }
    this.appliedQueryParam = undefined;
    this.queueInitialize();
  }

  disconnectedCallback() {
    this.initializeToken += 1;
    this.appliedQueryParam = undefined;
    this.clearDebounceTimer();
    this.disposeSource();
    this.connectionLifecycle.disconnect();
    this.linked = false;
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.cancelReachability();
      this.queueInitialize();
    }
  }

  private clearDebounceTimer() {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private get pollInterval() {
    const fallback = normalizeScope(this.getAttribute('scope')) === 'network' ? networkRefreshIntervalMs : localRefreshIntervalMs;
    const value = Number(this.getAttribute('poll-interval') ?? fallback);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private get pageSize() {
    const value = Number(this.getAttribute('page-size') ?? this.state.end);
    return pageSizes.includes(value) ? value : this.state.end;
  }

  private queueInitialize() {
    const token = ++this.initializeToken;
    const scope = this.connectionLifecycle.current;
    if (!scope) {
      return;
    }
    this.lifecycle = this.lifecycle.catch(() => undefined).then(() => scope.run(
      () => this.initialize(token, scope),
      (error) => {
        const message = error instanceof Error ? error.message : 'Failed to initialize node list';
        if (this.linked) {
          this.setError(message);
        } else {
          this.dataset.state = 'error';
          renderComponentError(this, message);
        }
      }
    ));
  }

  private async initialize(token: number, scope: ConnectionScope) {
    if (!scope.isCurrent() || token !== this.initializeToken) {
      return;
    }
    this.state.scope = normalizeScope(this.getAttribute('scope'));
    this.state.end = this.pageSize;
    this.applyQueryFilter();
    if (!this.linked) {
      this.innerHTML = `<div class="nodel-node-list-shell"></div>`;
      await bootstrapJsViews();
      if (!scope.isCurrent() || token !== this.initializeToken) {
        return;
      }
      const linked = await this.linkController.link(scope, template, this.state);
      if (!linked || !scope.isCurrent() || token !== this.initializeToken) {
        return;
      }
      this.linked = true;
      this.bindEvents();
    }

    if (!scope.isCurrent() || token !== this.initializeToken) {
      return;
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

  private applyQueryFilter() {
    const queryParam = this.getAttribute('query-param')?.trim() ?? '';
    if (this.appliedQueryParam === queryParam) {
      return;
    }
    this.appliedQueryParam = queryParam;
    if (!queryParam) {
      return;
    }
    const value = new URLSearchParams(window.location.search).get(queryParam) ?? '';
    this.state.flt = value;
    if (this.linked) {
      getJQuery().observable(this.state).setProperty('flt', value);
    }
  }

  private handleFilterInput = (event: Event) => {
    const value = (event.currentTarget as HTMLInputElement).value;
    this.state.flt = value;
    this.cancelReachability();
    this.scheduleRefresh();
  };

  private handleShowChange = (event: Event) => {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    this.state.end = pageSizes.includes(value) ? value : 20;
    this.restartReachability();
    void this.source?.refresh();
  };

  private handleMoreClick = () => {
    this.state.end = nextPageSize(this.state.end);
    this.restartReachability();
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
      // A source becoming inactive invalidates component-owned asynchronous work immediately.
      const becameActive = state.active && this.lastSourceActive === false;
      const freshnessChanged = state.updatedAt !== this.lastSourceUpdatedAt || state.active !== this.lastSourceActive;
      this.lastSourceUpdatedAt = state.updatedAt;
      this.lastSourceActive = state.active;

      if (!state.active) {
        this.cancelReachability();
        return;
      }

      if (state.error) {
        this.cancelReachability();
        this.setLoading(false);
        this.setError(state.error);
        this.applyRows([]);
        return;
      }

      this.setError('');
      this.setLoading(state.loading);
      if (state.updatedAt !== this.acceptedSnapshotUpdatedAt) {
        this.acceptedSnapshotUpdatedAt = state.updatedAt;
        this.acceptDiscoveryRows(state.data ?? []);
      } else if (freshnessChanged && becameActive && this.acceptedSnapshotUpdatedAt !== null) {
        this.restartReachability();
      }
    });
  }

  private disposeSource() {
    this.cancelReachability();
    this.source?.dispose();
    this.source = null;
    this.lastSourceUpdatedAt = null;
    this.lastSourceActive = null;
    this.acceptedSnapshotUpdatedAt = null;
  }

  private setLoading(loading: boolean) {
    const $ = getJQuery();
    $.observable(this.state).setProperty('loading', loading);
  }

  private setError(error: string) {
    const $ = getJQuery();
    $.observable(this.state).setProperty('error', error);
  }

  private applyRows(rows: readonly NodeListStateItem[] = this.displayRows) {
    const $ = getJQuery();
    // JsViews annotates bound view models, so expose copies rather than our frozen snapshot rows.
    const visibleRows = rows.slice(0, this.state.end).map((row) => ({ ...row }));
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
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey, undefined, { sensitivity: 'base' }))
      .slice(0, maxRetainedNodeRows);
  }

  private async loadNetworkRows(signal: AbortSignal): Promise<NodeListStateItem[]> {
    const filter = this.state.flt;
    const entries = await searchNodeUrls(filter, { signal });
    if (signal.aborted || this.state.scope !== 'network' || this.state.flt !== filter) {
      throw new DOMException('The network discovery snapshot was superseded', 'AbortError');
    }
    return entries
      .map((entry) => this.toNetworkRow(entry))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey, undefined, { sensitivity: 'base' }))
      .slice(0, maxRetainedNodeRows);
  }

  private hostsForRows(rows: readonly NodeListStateItem[]) {
    return Array.from(new Set(rows.filter((row) => row.fetchable).map((row) => row.host).filter(Boolean)));
  }

  private freezeRows(rows: readonly NodeListStateItem[]) {
    return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
  }

  private acceptDiscoveryRows(rows: readonly NodeListStateItem[]) {
    this.cancelReachability();
    this.discoveryRows = rows;
    this.displayRows = this.freezeRows(rows);
    this.applyRows();
    if (this.state.scope === 'network') {
      this.startReachability();
    }
  }

  private restartReachability() {
    if (!this.lastSourceActive || this.state.scope !== 'network' || this.discoveryRows.length === 0) {
      return;
    }
    this.cancelReachability();
    this.displayRows = this.freezeRows(this.discoveryRows);
    this.applyRows();
    this.startReachability();
  }

  private cancelReachability() {
    if (this.currentReachabilityGeneration !== null) {
      this.reachabilityScheduler.cancel(() => true);
    }
    this.currentReachabilityGeneration = null;
  }

  private startReachability() {
    const scope = this.connectionLifecycle.current;
    if (!scope || !this.isConnected || !this.lastSourceActive) {
      return;
    }
    const generation = ++this.reachabilityGeneration;
    const filter = this.state.flt;
    const nodeListScope = this.state.scope;
    const controller = new AbortController();
    this.currentReachabilityGeneration = generation;
    const isCurrent = () => this.currentReachabilityGeneration === generation
      && !controller.signal.aborted
      && scope.isCurrent()
      && this.isConnected
      && this.state.scope === nodeListScope
      && this.state.flt === filter;
    const visibleHosts = this.hostsForRows(this.displayRows.slice(0, this.state.end));
    const remainingHosts = this.hostsForRows(this.displayRows).filter((host) => !visibleHosts.includes(host));
    this.reachabilityScheduler.submit([...visibleHosts, ...remainingHosts].map((host) => ({
      host,
      controller,
      isCurrent,
      apply: (reachable) => this.applyReachabilityResult(generation, host, reachable)
    })));
  }

  private applyReachabilityResult(generation: number, host: string, reachable: boolean) {
    if (generation !== this.currentReachabilityGeneration) {
      return;
    }
    const reachability = reachable ? 'reachable' : 'unreachable';
    const rows = this.displayRows.map((row) => row.host === host
      ? Object.freeze({ ...row, reachable, reachability })
      : row);
    this.displayRows = Object.freeze(rows);
    this.applyRows();
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
    const address = safeNavigationHref(entry.address ?? '')
      ?? (isUsableNodeName(name) ? safeNavigationHref(localNodePath(name)) : null);

    return {
      name,
      address: address ?? '',
      host,
      iconHost,
      navigable: address !== null,
      fetchable: address !== null,
      reachable: true,
      reachability: 'reachable',
      sortKey: nodeName,
    };
  }

  private toNetworkRow(entry: NodelNodeUrlEntry): NodeListStateItem {
    const url = safeRemoteNodeUrl(entry.address);
    const address = url?.href ?? canonicalRemoteNodeHref(entry.address);
    if (!address) {
      throw new Error('Network node address is invalid');
    }
    const host = entry.host || remoteNodeDisplayHost(address) || url?.host || getHostFromAddress(address);
    const name = entry.name || entry.node || getSimpleName(address);

    return {
      name,
      address,
      host,
      iconHost: host,
      navigable: url !== null,
      fetchable: url !== null,
      reachable: false,
      reachability: 'unknown',
      sortKey: entry.node || getSimpleName(name),
    };
  }

}

if (!customElements.get('nodel-node-list')) {
  customElements.define('nodel-node-list', NodelNodeList);
}
