import { searchNodeUrlsDetailed } from '../../api/node-discovery';
import { getLocalRest } from '../../api/nodel-host-client';
import { startRequestDeadline, type NodelReadInit } from '../../api/request';
import {
  displayOnlyAddress, MAX_INVENTORY_ROUTES_PER_SOURCE, projectLocalInventory, projectNetworkInventory, TopologyDetailLimitError, topologyInterfaces, topologyReaders,
  type InterfaceValue, type Inventory, type InventoryRoute, type InventorySource, type TopologyDiagnostic, type TopologyInterface
} from './topology-discovery';
import {
  reconstructTopology, topologyInterfaceFingerprint, topologyNodeId,
  type TopologyEvidence, type TopologyGraph, type TopologyNodeId, type TopologyNodeSnapshot
} from './topology-model';

export type { TopologyDiagnostic } from './topology-discovery';

const CONCURRENCY = 4;
// Independent of advertised inventory size and the physical concurrency cap.
// Each attempt queues at most the four interface GETs for one route.
export const MAX_PRIMARY_DETAIL_NODES_PER_CYCLE = 32;
export const MAX_FALLBACK_DETAIL_NODES_PER_CYCLE = 8;
const EARLY_LOCAL_DETAIL_NODES = MAX_PRIMARY_DETAIL_NODES_PER_CYCLE / 2;
const MAX_RETAINED_DETAIL_ROUTES = 256;
const MAX_DISPUTED_NODES = 2 * MAX_INVENTORY_ROUTES_PER_SOURCE;
const MAX_DISPUTE_ROUTES = MAX_FALLBACK_DETAIL_NODES_PER_CYCLE + 1;
const REQUEST_DEADLINE_MS = 3_000;
const REFRESH_DELAY_MS = 30_000;
const DEFINITIONS_TTL_MS = 120_000;
const PROGRESS_INTERVAL_MS = 16;
const MAX_DIAGNOSTICS = 24;
const sources = ['local', 'network'] as const;

// The renderer can mount multiple viewers (including a replacement while an
// aborted fetch is still settling). Slots belong to physical reads, not views.
let physicalInFlight = 0;
let drainingSlots = false;
const physicalByOrigin = new Map<string, number>();
const slotWaiters = new Set<() => void>();

function drainSlots() {
  if (drainingSlots) return;
  drainingSlots = true;
  try {
    for (const dispatch of slotWaiters) {
      if (physicalInFlight >= CONCURRENCY) break;
      slotWaiters.delete(dispatch);
      dispatch(); // requeues at the back if this cycle still has ready work
    }
  } finally {
    drainingSlots = false;
  }
}

function releaseSlot(origin: string | undefined) {
  physicalInFlight -= 1;
  if (origin) {
    const remaining = physicalByOrigin.get(origin)! - 1;
    if (remaining === 0) physicalByOrigin.delete(origin);
    else physicalByOrigin.set(origin, remaining);
  }
  drainSlots();
}

export interface TopologyNodeStatus {
  readability: 'advertised-only' | 'pending' | 'readable' | 'partial' | 'unreadable';
  stale: boolean;
  /** The displayed assignments were verified on this exact route in an earlier cycle. */
  cached?: boolean;
}

export interface TopologyUpdate {
  graph: TopologyGraph;
  hostContext: string;
  phase: 'loading' | 'idle' | 'paused';
  coverage: 'unknown' | 'complete' | 'partial' | 'failed';
  progress: { completed: number; total: number };
  diagnostics: readonly TopologyDiagnostic[];
  diagnosticsOmitted: number;
  lastSuccessAt?: number;
  stale: boolean;
  nodeStatuses: ReadonlyMap<TopologyNodeId, TopologyNodeStatus>;
}

type InventoryRead =
  | { status: 'success'; inventory: Inventory }
  | { status: 'failure'; message: string; inventory?: Inventory }
  | { status: 'pending'; inventory?: Inventory };

interface RouteRead {
  route: InventoryRoute;
  nodeId: TopologyNodeId;
  current: boolean;
  exposeAddress: boolean;
  started: boolean;
  attempted: boolean;
  pending: number;
  evidenceScope: 'local' | 'remote' | undefined;
  lastAttempt: number;
  lastFallback: number;
  issue?: string;
  snapshot: TopologyNodeSnapshot;
}

interface DetailGroup {
  id: TopologyNodeId;
  routes: RouteRead[];
}

interface RouteDispute {
  // Only bounded address/authority identifiers are retained, never payloads.
  participants: Map<string, string>;
  overflow: boolean;
}

interface Cycle {
  abort: AbortController;
  generation: number;
  bypassCache: boolean;
  inventory: Record<InventorySource, InventoryRead>;
  routes: Map<string, RouteRead>;
  primaries: Map<TopologyNodeId, RouteRead>;
  cursors: Partial<Record<InventorySource, TopologyNodeId>>;
  fallbackScheduled: boolean;
  queue: Job[];
  next: number;
  active: number;
  completed: number;
  publicationPending: boolean;
  publicationTimer?: number;
  slotTimer?: number;
  dispatch: () => void;
}

interface Job {
  origin?: string;
  run: (signal: AbortSignal) => Promise<void>;
  settle?: (message?: string, skipped?: boolean) => void;
}

function failureMessage(error: unknown): string {
  if (error instanceof TopologyDetailLimitError) return 'Interface response exceeded the topology detail limit.';
  return error instanceof Error && error.name === 'TimeoutError'
    ? 'Request timed out.'
    : 'Read unavailable in this browser (network, access, or response error).';
}

function retained<T>(evidence: TopologyEvidence<T> | undefined, source: string, error?: string): TopologyEvidence<T> {
  // Status describes the current attempt, even if older values remain usable
  // for display. A successful empty array/object remains evidence.
  return Object.freeze({
    status: error ? 'failure' : 'absent', source,
    ...(error ? { error } : {}),
    ...(evidence?.value !== undefined ? { value: evidence.value } : {}),
    ...(evidence?.lastSuccessAt !== undefined ? { lastSuccessAt: evidence.lastSuccessAt } : {})
  });
}

function currentSnapshot(route: InventoryRoute, previous?: TopologyNodeSnapshot): TopologyNodeSnapshot {
  return {
    observationId: route.id, name: route.name, addresses: route.address ? [route.address] : [],
    ...(route.host ? { host: route.host } : {}),
    actions: retained(previous?.actions, 'actions'), events: retained(previous?.events, 'events'),
    schema: retained(previous?.schema, 'schema'), assignments: retained(previous?.assignments, 'assignments')
  };
}

function carryCachedEvidence(route: InventoryRoute, previous: TopologyNodeSnapshot): TopologyNodeSnapshot {
  const snapshot = currentSnapshot(route, previous);
  for (const key of topologyInterfaces) {
    const evidence = previous[key];
    if (evidence.status === 'success' || evidence.status === 'failure') {
      // Carried failures are historical; neither status nor the timestamp of
      // the last actual successful value changes when a page is deferred.
      setEvidence(snapshot, key, Object.freeze({ ...evidence, cached: true }) as TopologyEvidence<InterfaceValue<typeof key>>);
    }
  }
  return snapshot;
}

function maskInterfaces(snapshot: TopologyNodeSnapshot, keys: Iterable<TopologyInterface>): TopologyNodeSnapshot {
  const masked = { ...snapshot };
  for (const key of keys) masked[key] = { status: 'absent', source: key };
  return masked;
}

function displayBaseline(route: InventoryRoute, previous: RouteRead | undefined, localInventory: InventoryRead) {
  if (!previous || route.target?.fetchBase !== previous.route.target?.fetchBase) return undefined;
  if (route.target?.scope === previous.evidenceScope) return previous;
  // The exact same route can lose its authorization when local inventory is
  // unavailable. Preserve prior evidence for display only; a successful local
  // listing that no longer contains the node does not authorize this fallback.
  if (localInventory.status !== 'success' && route.target?.scope === 'remote'
    && previous.evidenceScope === 'local') return previous;
  return undefined;
}

const compareKeys = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

function rotate(groups: DetailGroup[], after: TopologyNodeId | undefined) {
  const ordered = groups.sort((left, right) => compareKeys(left.id, right.id));
  if (after === undefined) return ordered;
  const index = ordered.findIndex(({ id }) => id > after);
  return index > 0 ? [...ordered.slice(index), ...ordered.slice(0, index)] : ordered;
}

function routePriority({ route }: RouteRead) {
  return route.target?.scope === 'local' ? 0 : route.target?.fetchBase.startsWith('https:') ? 1 : 2;
}

function authorityKey({ scope, fetchBase }: NonNullable<InventoryRoute['target']>): string {
  return `${scope}:${fetchBase}`;
}

/** One read-only refresh lifecycle. Wire the containing view's visibility to start/stop. */
export class TopologyController {
  private readonly hostContext = window.location.origin;
  private running = false;
  private disposed = false;
  private bypassNext = false;
  private timer: number | undefined;
  private cycle: Cycle | undefined;
  // The last completed bounded snapshot doubles as a cache. No partially
  // completed or superseded generation may publish into it.
  private committed: Cycle | undefined;
  private readonly disputes = new Map<TopologyNodeId, Map<TopologyInterface, RouteDispute>>();
  private readonly disputeCapacityExceeded = new Set<TopologyInterface>();
  private lastSuccessAt: number | undefined;
  private phase: TopologyUpdate['phase'] | undefined;

  constructor(private readonly onUpdate: (update: TopologyUpdate) => void) {}

  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    document.addEventListener('visibilitychange', this.syncAvailability);
    window.addEventListener('online', this.syncAvailability);
    window.addEventListener('offline', this.syncAvailability);
    this.syncAvailability();
  }

  stop() {
    if (!this.running) return;
    this.detach();
    this.pause();
  }

  refresh() {
    if (!this.running || this.disposed) return;
    this.bypassNext = true;
    this.cancel();
    this.syncAvailability();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.cancel();
    this.committed = undefined;
    this.disputes.clear();
    this.disputeCapacityExceeded.clear();
  }

  private detach() {
    this.running = false;
    document.removeEventListener('visibilitychange', this.syncAvailability);
    window.removeEventListener('online', this.syncAvailability);
    window.removeEventListener('offline', this.syncAvailability);
  }

  private available() {
    return this.running && !this.disposed && !document.hidden && navigator.onLine !== false;
  }

  private readonly syncAvailability = () => {
    if (!this.available()) this.pause();
    else if (!this.cycle && this.timer === undefined) this.begin();
  };

  private cancel() {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    const cycle = this.cycle;
    this.cycle = undefined;
    if (cycle?.publicationTimer !== undefined) window.clearTimeout(cycle.publicationTimer);
    if (cycle?.slotTimer !== undefined) window.clearTimeout(cycle.slotTimer);
    if (cycle) {
      slotWaiters.delete(cycle.dispatch);
      cycle.queue.length = 0;
    }
    cycle?.abort.abort();
  }

  private pause() {
    this.cancel();
    if (this.phase !== 'paused' && !this.disposed) this.publish('paused', this.committed);
  }

  private isCurrent(cycle: Cycle) {
    return this.cycle === cycle && !cycle.abort.signal.aborted && this.available();
  }

  private begin() {
    const pending = (source: InventorySource): InventoryRead => {
      const inventory = this.committed?.inventory[source].inventory;
      return { status: 'pending', ...(inventory ? { inventory } : {}) };
    };
    const cycle: Cycle = {
      abort: new AbortController(), generation: (this.committed?.generation ?? 0) + 1, bypassCache: this.bypassNext,
      inventory: { local: pending('local'), network: pending('network') },
      routes: new Map(), primaries: new Map(), cursors: { ...this.committed?.cursors }, fallbackScheduled: false,
      queue: [], next: 0, active: 0, completed: 0, publicationPending: false,
      dispatch: () => this.dispatch(cycle)
    };
    this.bypassNext = false;
    this.cycle = cycle;
    for (const source of sources) cycle.queue.push({
      run: (signal) => this.readInventory(cycle, source, signal),
      settle: (message) => {
        if (message) {
          this.failInventory(cycle, source, message);
          this.reconcile(cycle);
        }
      }
    });
    this.reconcile(cycle);
    this.publish('loading', cycle);
    this.pump(cycle);
  }

  private async readInventory(cycle: Cycle, source: InventorySource, signal: AbortSignal) {
    const options: NodelReadInit = { signal, waitForSettlement: true, credentials: 'same-origin', redirect: 'error', cache: 'no-store' };
    const inventory = source === 'local'
      ? projectLocalInventory(await getLocalRest(options))
      : projectNetworkInventory(await searchNodeUrlsDetailed('', options));
    if (!this.isCurrent(cycle) || signal.aborted) return;
    cycle.inventory[source] = { status: 'success', inventory };
    this.reconcile(cycle);
  }

  private failInventory(cycle: Cycle, source: InventorySource, message: string) {
    const inventory = cycle.inventory[source].inventory;
    cycle.inventory[source] = { status: 'failure', message, ...(inventory ? { inventory } : {}) };
  }

  private reconcile(cycle: Cycle) {
    const candidates = new Map<string, { route: InventoryRoute; current: boolean }>();
    for (const source of sources) {
      const read = cycle.inventory[source];
      const current = read.status === 'success';
      for (const route of read.inventory?.routes ?? []) {
        const existing = candidates.get(route.id);
        // Prefer active local inventory on exact overlap. Never transfer the
        // authority to send credentials from a stale local list to an ad.
        if (!existing || (current && !existing.current)) candidates.set(route.id, { route, current });
      }
    }
    const claims = new Map<string, { local: number; network: number }>();
    for (const { route, current } of candidates.values()) {
      if (!current || !route.target) continue;
      const claim = claims.get(route.target.fetchBase) ?? { local: 0, network: 0 };
      claim[route.source] += 1;
      claims.set(route.target.fetchBase, claim);
    }
    for (const id of cycle.routes.keys()) {
      if (!candidates.has(id)) cycle.routes.delete(id);
    }
    for (const [id, { route, current }] of candidates) {
      let read = cycle.routes.get(id);
      const previous = this.committed?.routes.get(id);
      if (!read || read.route !== route || read.current !== current) {
        const baseline = displayBaseline(route, previous, cycle.inventory.local);
        read = {
          route, nodeId: topologyNodeId(this.hostContext, route.name), current, exposeAddress: false, started: false, attempted: false, pending: 0,
          evidenceScope: baseline?.evidenceScope, lastAttempt: previous?.lastAttempt ?? 0, lastFallback: previous?.lastFallback ?? 0,
          snapshot: currentSnapshot(route, this.cacheableSnapshot(baseline))
        };
        cycle.routes.set(id, read);
      } else if (!read.started && read.evidenceScope === 'local' && route.target?.scope === 'remote'
        && cycle.inventory.local.status === 'success') {
        // A network response can arrive first; drop the provisional baseline
        // once the local response definitively removes its read authority.
        read.evidenceScope = undefined;
        read.snapshot = currentSnapshot(route);
      }
      const target = route.target;
      if (read.started) continue;
      if (!target) {
        read.issue = 'No browser-fetchable node address.';
        continue;
      }
      const url = new URL(target.fetchBase);
      const claim = claims.get(target.fetchBase);
      const differentCurrentOwner = claim && (claim.local + claim.network > 1 || (!current && claim.local > 0));
      if ((claim?.local ?? 0) > 1 || (target.scope !== 'local' && differentCurrentOwner)) {
        read.issue = 'Different advertised node names claim this address.';
        read.exposeAddress = false;
        read.evidenceScope = undefined;
        read.snapshot = currentSnapshot(route);
        continue;
      }
      // An advertisement that arrived before /REST cannot grant authority to
      // navigate to a URL that verified local inventory might already own.
      read.exposeAddress = current && (target.scope === 'local' || cycle.inventory.local.status !== 'pending');
      if (!current) continue;
      if (window.location.protocol === 'https:' && url.protocol === 'http:') {
        read.issue = 'HTTP node reads are not attempted from an HTTPS page.';
        continue;
      }
      delete read.issue;
      // Confirmation of an exact, currently usable route allows a coherent
      // cached bundle to stay on screen while the detail page rotates. An
      // anonymous advertisement cannot promote old authenticated evidence.
      if ((target.scope === 'local' || cycle.inventory.local.status !== 'pending')
        && previous?.evidenceScope === target.scope && previous.route.target?.fetchBase === target.fetchBase) {
        read.snapshot = carryCachedEvidence(route, this.cacheableSnapshot(previous)!);
      }
    }
    this.schedulePrimaries(cycle);
  }

  private cacheableSnapshot(read: RouteRead | undefined): TopologyNodeSnapshot | undefined {
    if (!read) return undefined;
    const disputed = this.disputes.get(read.nodeId);
    const masked = topologyInterfaces.filter((key) => disputed?.has(key) || this.disputeCapacityExceeded.has(key));
    return masked.length ? maskInterfaces(read.snapshot, masked) : read.snapshot;
  }

  private detailGroups(cycle: Cycle): DetailGroup[] {
    const groups = new Map<TopologyNodeId, DetailGroup>();
    for (const read of cycle.routes.values()) {
      if (!read.current || !read.route.target || read.issue) continue;
      const id = read.nodeId;
      const group = groups.get(id) ?? { id, routes: [] };
      group.routes.push(read);
      groups.set(id, group);
    }
    return [...groups.values()];
  }

  private schedulePrimaries(cycle: Cycle) {
    if (cycle.inventory.local.status === 'pending') return;
    const groups = this.detailGroups(cycle);
    const hasLocalRoute = (group: DetailGroup) => group.routes.some(({ route }) => route.target?.scope === 'local');
    const locals = groups.filter(hasLocalRoute);
    const startPage = (groups: DetailGroup[], lane: InventorySource, limit: number) => {
      if (cycle.primaries.size >= limit) return;
      const remaining = groups.filter(({ id }) => !cycle.primaries.has(id));
      for (const group of rotate(remaining, cycle.cursors[lane])) {
        const best = group.routes.sort((a, b) => routePriority(a) - routePriority(b)
          || compareKeys(a.route.id, b.route.id))[0]!;
        cycle.primaries.set(group.id, best);
        cycle.cursors[lane] = group.id;
        this.enqueueRoute(cycle, best);
        if (cycle.primaries.size >= limit) break;
      }
    };
    // Fast verified local reads can begin without waiting for the network
    // response. Never dispatch anonymous detail until local authority is known,
    // including when an alternate to a local node uses a different origin.
    startPage(locals, 'local', EARLY_LOCAL_DETAIL_NODES);
    if (cycle.inventory.network.status === 'pending') return;
    startPage(groups.filter((group) => !hasLocalRoute(group)), 'network', MAX_PRIMARY_DETAIL_NODES_PER_CYCLE);
    startPage(locals, 'local', MAX_PRIMARY_DETAIL_NODES_PER_CYCLE);
  }

  private scheduleFallbacks(cycle: Cycle) {
    if (cycle.fallbackScheduled) return false;
    cycle.fallbackScheduled = true;
    const page = this.detailGroups(cycle).flatMap(({ id, routes }) => {
      const primary = cycle.primaries.get(id);
      if (!primary?.attempted) return [];
      const alternates = routes.filter(({ started }) => !started);
      const disputes = this.disputes.get(id);
      const rechecks = alternates.filter(({ route }) => disputes && [...disputes.values()]
        .some((dispute) => !dispute.overflow && dispute.participants.has(authorityKey(route.target!))));
      if (rechecks.length) return [{ id, routes: rechecks, served: Math.max(...routes.map(({ lastFallback }) => lastFallback)) }];
      if (!alternates.length || topologyInterfaces.every((key) => primary.snapshot[key].status === 'success')) return [];
      const alternate = alternates.sort((a, b) =>
        Number(b.route.target?.scope === 'local') - Number(a.route.target?.scope === 'local')
        || a.lastAttempt - b.lastAttempt || routePriority(a) - routePriority(b) || compareKeys(a.route.id, b.route.id))[0]!;
      return [{ id, routes: [alternate], served: Math.max(...routes.map(({ lastFallback }) => lastFallback)) }];
    }).sort((a, b) => a.served - b.served || compareKeys(a.id, b.id));
    // A separate least-recently-served fallback page prevents the first few
    // failed nodes of each primary page from monopolizing retries. Ordinary
    // failures get one alternate; only a known dispute can need several.
    const attempts = page.flatMap(({ routes }) => routes).slice(0, MAX_FALLBACK_DETAIL_NODES_PER_CYCLE);
    for (const alternate of attempts) {
      alternate.lastFallback = cycle.generation;
      this.enqueueRoute(cycle, alternate);
    }
    return attempts.length > 0;
  }

  private enqueueRoute(cycle: Cycle, read: RouteRead) {
    read.started = true;
    const origin = new URL(read.route.target!.fetchBase).origin;
    const previous = this.committed?.routes.get(read.route.id);
    for (const key of topologyInterfaces) this.enqueueInterface(cycle, read, key, origin, previous);
  }

  private enqueueInterface<K extends TopologyInterface>(cycle: Cycle, read: RouteRead, key: K, origin: string, previous?: RouteRead) {
    const target = read.route.target!;
    const previousEvidence = previous && !this.disputes.get(read.nodeId)?.has(key) && !this.disputeCapacityExceeded.has(key)
      && previous.evidenceScope === target.scope
      && previous.route.target?.fetchBase === target.fetchBase ? previous.snapshot[key] : undefined;
    const cached = previousEvidence as TopologyEvidence<InterfaceValue<K>> | undefined;
    const time = cached?.lastSuccessAt;
    const age = time === undefined ? Infinity : Date.now() - time;
    if (!cycle.bypassCache && key !== 'assignments' && cached?.status === 'success' && age >= 0 && age < DEFINITIONS_TTL_MS) {
      setEvidence(read.snapshot, key, Object.freeze({ ...cached, cached: true }));
      return;
    }
    read.pending += 1;
    cycle.queue.push({
      origin,
      run: async (signal) => {
        read.attempted = true;
        read.lastAttempt = cycle.generation;
        const options: NodelReadInit = { signal, waitForSettlement: true };
        const value = await topologyReaders[key](target, options);
        if (!this.isCurrent(cycle) || signal.aborted || cycle.routes.get(read.route.id) !== read) return;
        // A successful anonymous read supersedes a previously retained
        // authenticated snapshot; never combine private stale fields with it.
        if (read.evidenceScope !== target.scope) {
          for (const field of topologyInterfaces) {
            const { status, source, error } = read.snapshot[field];
            read.snapshot[field] = { status, source, ...(error ? { error } : {}) };
          }
          read.evidenceScope = target.scope;
        }
        setEvidence(read.snapshot, key, Object.freeze({ status: 'success', source: key, value, lastSuccessAt: Date.now() }));
      },
      settle: (message, skipped) => {
        read.pending -= 1;
        if (message) {
          const stale = read.snapshot[key] as TopologyEvidence<InterfaceValue<K>>;
          setEvidence(read.snapshot, key, skipped ? { ...stale, error: message } : retained(stale, key, message));
        }
      }
    });
  }

  private pump(cycle: Cycle) {
    if (!this.isCurrent(cycle) || cycle.next >= cycle.queue.length) return;
    slotWaiters.add(cycle.dispatch);
    drainSlots();
    if (cycle.active === 0 && physicalInFlight === CONCURRENCY && cycle.next < cycle.queue.length && cycle.slotTimer === undefined) {
      // Some transports may ignore abort indefinitely. Keep the physical cap,
      // but complete the stalled cycle as partial instead of loading forever.
      cycle.slotTimer = window.setTimeout(() => {
        delete cycle.slotTimer;
        if (!this.isCurrent(cycle)) return;
        slotWaiters.delete(cycle.dispatch);
        while (cycle.next < cycle.queue.length) {
          cycle.queue[cycle.next++]!.settle?.('Read skipped: earlier requests have not released their slots.', true);
          cycle.completed += 1;
        }
        this.complete(cycle);
      }, REQUEST_DEADLINE_MS);
    }
  }

  private dispatch(cycle: Cycle) {
    if (!this.isCurrent(cycle) || cycle.next >= cycle.queue.length) return;
    if (cycle.slotTimer !== undefined) window.clearTimeout(cycle.slotTimer);
    delete cycle.slotTimer;
    let job = cycle.queue[cycle.next]!;
    // When another origin is ready, don't dedicate the whole queue to one
    // possibly unreachable host. Use spare slots when no alternative is ready.
    if (job.origin && (physicalByOrigin.get(job.origin) ?? 0) >= 2) {
      const alternative = cycle.queue.findIndex(({ origin }, index) => index > cycle.next && origin !== undefined
        && (physicalByOrigin.get(origin) ?? 0) < 2);
      if (alternative !== -1) {
        const [preferred] = cycle.queue.splice(alternative, 1);
        cycle.queue.splice(cycle.next, 0, preferred!);
        job = preferred!;
      }
    }
    cycle.next += 1;
    cycle.active += 1;
    physicalInFlight += 1;
    const { origin } = job;
    if (origin) physicalByOrigin.set(origin, (physicalByOrigin.get(origin) ?? 0) + 1);
    const operation = startRequestDeadline(job.run, cycle.abort.signal, REQUEST_DEADLINE_MS);
    void operation.result.then(
      () => this.settle(cycle, job),
      (error: unknown) => this.settle(cycle, job, failureMessage(error))
    );
    void operation.settled.then(() => releaseSlot(origin));
    this.pump(cycle);
  }

  private settle(cycle: Cycle, job: Job, message?: string) {
    if (!this.isCurrent(cycle)) return;
    job.settle?.(message);
    cycle.active -= 1;
    cycle.completed += 1;
    if (!cycle.publicationPending) {
      cycle.publicationPending = true;
      queueMicrotask(() => {
        cycle.publicationPending = false;
        if (!this.isCurrent(cycle)) return;
        if (cycle.completed === cycle.queue.length) {
          if (this.scheduleFallbacks(cycle)) this.pump(cycle);
          else this.complete(cycle);
        } else if (cycle.publicationTimer === undefined) {
          // Responses often settle in separate browser tasks. Batch the graph
          // rebuild rather than reconstructing a large topology for each read.
          cycle.publicationTimer = window.setTimeout(() => {
            delete cycle.publicationTimer;
            if (this.isCurrent(cycle)) this.publish('loading', cycle);
          }, PROGRESS_INTERVAL_MS);
        }
      });
    }
    this.pump(cycle);
  }

  private complete(cycle: Cycle) {
    if (cycle.publicationTimer !== undefined) window.clearTimeout(cycle.publicationTimer);
    delete cycle.publicationTimer;
    slotWaiters.delete(cycle.dispatch);
    // Pagination can accumulate large historical endpoint sets. Bound their
    // retention independently, without dropping any advertised node or route.
    const retainedReads = [...cycle.routes.values()].filter(({ snapshot }) => topologyInterfaces.some((key) => snapshot[key].value !== undefined));
    retainedReads.sort((a, b) => b.lastAttempt - a.lastAttempt);
    for (const read of retainedReads.slice(MAX_RETAINED_DETAIL_ROUTES)) {
      read.snapshot = currentSnapshot(read.route);
      read.evidenceScope = undefined;
    }
    cycle.queue.length = 0; // retain the projection, not jobs and their closures
    cycle.primaries.clear();
    this.committed = cycle;
    this.cycle = undefined;
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.syncAvailability();
    }, REFRESH_DELAY_MS);
    this.publish('idle', cycle);
  }

  private coverage(nodeStatuses: ReadonlyMap<TopologyNodeId, TopologyNodeStatus>, cycle?: Cycle): TopologyUpdate['coverage'] {
    if (!cycle) return 'unknown';
    const inventories = sources.map((source) => cycle.inventory[source]);
    if (inventories.every(({ status }) => status === 'pending')) return 'unknown';
    if (inventories.every(({ status }) => status === 'failure')) return 'failed';
    if (this.disputeCapacityExceeded.size || !inventories.every((read) => read.status === 'success' && read.inventory.exhaustive)
      || [...nodeStatuses.values()].some(({ readability, cached }) => readability !== 'readable' || cached)) return 'partial';
    return 'complete';
  }

  private observeRouteDisputes(reads: readonly RouteRead[], settled: boolean, exhaustive: boolean) {
    const active = new Map<TopologyNodeId, RouteRead[]>();
    for (const read of reads) {
      const group = active.get(read.nodeId) ?? [];
      group.push(read);
      active.set(read.nodeId, group);
    }
    if (settled && exhaustive) {
      // Only positive, complete inventory evidence of the whole node's
      // removal retires its history. A missing route, by itself, proves no agreement.
      for (const id of this.disputes.keys()) if (!active.has(id)) this.disputes.delete(id);
      if (!active.size) this.disputeCapacityExceeded.clear();
    }
    for (const [id, group] of active) {
      const candidates = group.filter((read) => read.current && read.attempted && read.route.target);
      if (candidates.length < 2) continue;
      let interfaces = this.disputes.get(id);
      for (const key of topologyInterfaces) {
        const fresh = candidates.filter(({ snapshot }) => snapshot[key].status === 'success' && !snapshot[key].cached);
        if (fresh.length < 2) continue;
        const fingerprints = new Set(fresh.map(({ snapshot }) => topologyInterfaceFingerprint(snapshot, key)));
        const dispute = interfaces?.get(key);
        if (fingerprints.size === 1) {
          if (settled && dispute && !dispute.overflow) {
            const authorities = new Set(fresh.map(({ route }) => authorityKey(route.target!)));
            if ([...dispute.participants.keys()].every((authority) => authorities.has(authority))) interfaces?.delete(key);
          }
          continue;
        }
        if (!interfaces) {
          if (this.disputes.size >= MAX_DISPUTED_NODES) {
            // Never evict a live dispute and silently promote its evidence.
            // On saturation this interface is withheld, not called disputed,
            // for nodes whose exact participants cannot be recorded.
            this.disputeCapacityExceeded.add(key);
            continue;
          }
          interfaces = new Map();
          this.disputes.set(id, interfaces);
        }
        const next = dispute ?? { participants: new Map<string, string>(), overflow: false };
        for (const { route } of fresh) {
          const authority = authorityKey(route.target!);
          if (next.participants.has(authority)) continue;
          if (next.participants.size >= MAX_DISPUTE_ROUTES) { next.overflow = true; break; }
          next.participants.set(authority, route.address!.displayAddress);
        }
        interfaces.set(key, next);
      }
      if (!interfaces?.size) this.disputes.delete(id);
    }
  }

  private publish(phase: TopologyUpdate['phase'], cycle?: Cycle) {
    this.phase = phase;
    const reads = [...(cycle?.routes.values() ?? [])].sort((a, b) => a.route.id < b.route.id ? -1 : a.route.id > b.route.id ? 1 : 0);
    const discoveryComplete = phase !== 'paused' && cycle && sources.every((source) => {
      const read = cycle.inventory[source];
      return read.status === 'success' && read.inventory.exhaustive;
    });
    const inventorySettled = cycle && sources.every((source) => cycle.inventory[source].status !== 'pending');
    if (phase !== 'paused') this.observeRouteDisputes(reads, phase === 'idle', Boolean(discoveryComplete));
    const recordedDisputes = new Map<TopologyNodeId, readonly TopologyInterface[]>();
    const snapshot = reads.map((read) => {
      const disputes = this.disputes.get(read.nodeId);
      if (disputes && !recordedDisputes.has(read.nodeId)) recordedDisputes.set(read.nodeId, [...disputes.keys()]);
      const evidence = phase === 'paused' ? currentSnapshot(read.route, read.snapshot) : read.snapshot;
      const visible = read.exposeAddress ? evidence : { ...evidence, addresses: evidence.addresses.map(displayOnlyAddress) };
      return this.disputeCapacityExceeded.size ? maskInterfaces(visible, this.disputeCapacityExceeded) : visible;
    });
    const graph = reconstructTopology({ hostContext: this.hostContext, nodes: snapshot,
      routeDisputes: recordedDisputes,
      discovery: {
        status: discoveryComplete ? 'success' : inventorySettled && phase !== 'paused' ? 'failure' : 'absent',
        source: 'inventory', value: reads.map(({ route }) => route.name)
      }
    });
    const diagnostics: TopologyDiagnostic[] = [];
    let diagnosticsOmitted = 0;
    const report = (item: TopologyDiagnostic) => {
      if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(item);
      else diagnosticsOmitted += 1;
    };
    for (const source of sources) {
      const read = cycle?.inventory[source];
      if (read?.status === 'failure') report({ source, message: read.message });
      if (read?.status === 'success') for (const item of read.inventory.diagnostics) report(item);
    }
    for (const key of this.disputeCapacityExceeded) report({ source: key, message: 'Route comparison history limit reached; interface evidence is withheld.' });
    for (const node of graph.nodes) {
      if (node.discovery !== 'advertised') continue;
      for (const [key, { participants, overflow }] of this.disputes.get(node.id) ?? []) {
        if (overflow) report({ source: key, nodeName: node.name, message: 'Disputed interface exceeded the route history limit; evidence remains withheld.' });
        for (const routeAddress of participants.values()) report({ source: key, nodeName: node.name, routeAddress,
          message: 'This route’s response disagreed with another route; fresh matching responses are required.' });
      }
    }
    const nodeStatuses = new Map<TopologyNodeId, TopologyNodeStatus>();
    const readStates = new Map<TopologyNodeId, { current: boolean; pending: boolean; attempted: boolean }>();
    for (const read of reads) {
      const { route } = read;
      const id = read.nodeId;
      const state = readStates.get(id) ?? { current: false, pending: false, attempted: false };
      state.current ||= read.current;
      state.pending ||= read.pending > 0;
      state.attempted ||= read.attempted;
      readStates.set(id, state);
      const context = { nodeName: route.name, ...(route.source === 'network' && route.address ? { routeAddress: route.address.displayAddress } : {}) };
      if (read.issue) report({ source: route.source, ...context, message: read.issue });
      for (const key of topologyInterfaces) {
        const error = read.snapshot[key].error;
        if (error && read.started) report({ source: key, ...context, message: error });
      }
    }
    for (const node of graph.nodes) {
      const state = readStates.get(node.id);
      if (node.discovery !== 'advertised' || !state) continue;
      const evidence = [node.actionInventory, node.eventInventory, node.schemaEvidence, node.assignmentEvidence];
      nodeStatuses.set(node.id, {
        readability: node.conflicts?.length ? 'partial' : readability(evidence, state.pending, state.attempted),
        stale: phase === 'paused' || !state.current || evidence.some((item) => item.value !== undefined && item.status !== 'success'),
        ...(node.assignmentEvidence.status === 'success' && node.assignmentEvidence.cached ? { cached: true } : {})
      });
    }
    const coverage = this.coverage(nodeStatuses, cycle);
    if (phase === 'idle' && coverage === 'complete') this.lastSuccessAt = Date.now();
    this.onUpdate({
      graph, hostContext: this.hostContext, phase, coverage,
      progress: { completed: cycle?.completed ?? 0, total: Math.max(cycle?.queue.length ?? 0, cycle?.completed ?? 0) },
      diagnostics, diagnosticsOmitted, ...(this.lastSuccessAt !== undefined ? { lastSuccessAt: this.lastSuccessAt } : {}),
      stale: graph.bindings.some(({ assignmentFreshness }) => assignmentFreshness === 'stale')
        || [...nodeStatuses.values()].some(({ stale }) => stale), nodeStatuses
    });
  }

}

function readability(evidence: readonly TopologyEvidence<unknown>[], pending: boolean, attempted: boolean): TopologyNodeStatus['readability'] {
  const count = evidence.filter(({ status }) => status === 'success').length;
  return count === topologyInterfaces.length ? 'readable' : count > 0 ? 'partial'
    : pending ? 'pending' : attempted ? 'unreadable' : 'advertised-only';
}

function setEvidence<K extends TopologyInterface>(snapshot: TopologyNodeSnapshot, key: K, value: TopologyEvidence<InterfaceValue<K>>) {
  // K selects both the interface and its projected value type.
  snapshot[key] = value as TopologyNodeSnapshot[K];
}
