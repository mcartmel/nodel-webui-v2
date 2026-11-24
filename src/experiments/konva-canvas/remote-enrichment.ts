import type { NodelRemoteBindings } from '../../api/nodel-types';
import { createEnrichmentLimiter, enrichmentClock, type EnrichmentClock, type EnrichmentLimiter } from './enrichment-limiter';
import {
  createRemoteEnrichmentReaders, enrichmentReadFailure, EnrichmentResponseLimit, maxEnrichmentOwners,
  ownerFromName, routeLimit, validOwner, type PolicyIssue, type RemoteAdvertisement,
  type RemoteEnrichmentOwner, type RemoteEnrichmentReaders, type RemoteHostEvidence, type RemoteInventory, type RemoteLookup
} from './enrichment-transport';
import { localSnapshotBudgetMs, unfinishedLocalReader, type LocalSnapshot, type LocalSnapshotOwner } from './local-snapshot';

export { createEnrichmentLimiter, createRemoteEnrichmentReaders };
export type { EnrichmentLimiter, RemoteEnrichmentOwner, RemoteEnrichmentReaders };

type AttemptFailure = 'timeout' | 'transport' | 'invalid-data';
export type RemoteEnrichmentFailure =
  | 'lookup-timeout' | 'lookup-transport' | 'lookup-invalid-data' | 'lookup-limited' | 'lookup-interrupted'
  | 'no-route' | 'policy-blocked' | AttemptFailure | 'prepare-failed';
export type RemoteEnrichmentLookupState = 'pending' | 'found' | 'no-route' | 'failed' | 'blocked' | 'invalid';

export interface RemoteEnrichmentTiming extends EnrichmentClock {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

export interface PreparedEnrichment<T> {
  readonly outcome: 'read' | 'partial';
  readonly prepared: T;
}

type OwnerOutcome<T> = PreparedEnrichment<T> | { readonly outcome: 'unsuccessful'; readonly reason: RemoteEnrichmentFailure };
export type RemoteEnrichmentResult<T> = {
  readonly owner: RemoteEnrichmentOwner;
  readonly lookupState: RemoteEnrichmentLookupState;
  readonly issues: readonly PolicyIssue[];
  readonly attempts: readonly AttemptFailure[];
  readonly hostEvidence?: RemoteHostEvidence;
} & ((OwnerOutcome<T> & { readonly source: 'local' | 'remote' }) | { readonly outcome: 'cutoff' });

export interface RemoteDiscovery {
  readonly owner: RemoteEnrichmentOwner;
  readonly lookupState: RemoteEnrichmentLookupState;
  readonly hostEvidence?: RemoteHostEvidence;
}

export interface RemoteInventoryProgress {
  readonly coverage: 'HTTP advertisements only';
  readonly state: 'pending' | 'complete' | 'limited' | 'failed';
  readonly local: 'known' | 'limited' | 'unknown';
  readonly rows: number;
  readonly discardedRows: number;
  readonly advertised: number;
  /** Rejected admissions, not a count of distinct otherwise invisible owners. */
  readonly omittedAdmissions: number;
  readonly reason?: 'rows' | 'bytes' | 'malformed-rows' | 'capacity' | 'interrupted' | AttemptFailure;
}

export interface RemoteEnrichmentCounts {
  readonly total: number;
  readonly pending: number;
  readonly read: number;
  readonly partial: number;
  readonly unsuccessful: number;
  readonly unreachable: number;
  readonly unresolved: number;
  readonly invalid: number;
  readonly lookupFailed: number;
  readonly noRoute: number;
}

export interface RemoteEnrichmentBatch<T> {
  /** Apply discoveries first. They can introduce isolated owners before their results. */
  readonly discoveries: readonly RemoteDiscovery[];
  readonly results: readonly RemoteEnrichmentResult<T>[];
  readonly inventory: RemoteInventoryProgress;
  readonly counts: RemoteEnrichmentCounts;
  readonly paused: boolean;
  /** Inventory names from the serving origin, published once before owner outcomes. */
  readonly localSnapshot?: LocalSnapshot;
  readonly preview?: {
    readonly localSettled: boolean;
    readonly localPrioritySettled: boolean;
    readonly prioritySettled: boolean;
  };
  readonly finish?: 'complete';
}

type OperationKind = 'local-inventory' | 'inventory' | 'lookup' | 'remote-read' | 'local-read';
export type RemoteEnrichmentMeasurement = {
  readonly event: 'start' | 'settle';
  readonly operation: OperationKind;
  readonly at: number;
  readonly physical: number;
  readonly ownerId?: string;
  readonly eligibleAgeMs?: number;
  readonly ownerAgeMs?: number;
  readonly referenceDistance?: number;
  readonly dispatch?: 'priority' | 'oldest' | 'reserved';
};

interface RemoteEnrichmentOptions<T> {
  owners: readonly RemoteEnrichmentOwner[];
  localSnapshot?: LocalSnapshot;
  /** Opt in to the shared initial discovery pass rather than a terminal snapshot handoff. */
  readLocalInventory?(this: void, signal: AbortSignal): Promise<LocalSnapshot>;
  prepare(this: void, owner: RemoteEnrichmentOwner, bindings: NodelRemoteBindings, collectFollowUps: boolean): PreparedEnrichment<T> & {
    followUpOwners?: readonly RemoteEnrichmentOwner[];
  };
  apply(this: void, batch: RemoteEnrichmentBatch<T>): void;
  /** Read current priority cheaply; never inspects an unvalidated URL or name. */
  priority?(this: void, owner: RemoteEnrichmentOwner): boolean;
  measure?(this: void, event: RemoteEnrichmentMeasurement): void;
  signal?: AbortSignal;
  limiter?: EnrichmentLimiter;
  readers?: RemoteEnrichmentReaders;
  timing?: RemoteEnrichmentTiming;
}

const requestBudget = 3_000;
const previewOwners = 8;
const previewHops = 3;
const sliceItems = 64;
const sliceMs = 4;
const browserTiming: RemoteEnrichmentTiming = {
  ...enrichmentClock,
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle)
};
let browserLimiter: EnrichmentLimiter | undefined;

interface Work {
  owner: RemoteEnrichmentOwner;
  local?: (signal: AbortSignal) => Promise<NodelRemoteBindings>;
  readonly admittedAt: number;
  eligibleAt: number;
  direct: boolean;
  distance: number;
  references?: Set<Work>;
  referenced: boolean;
  discovery?: RemoteLookup;
  lookupState: RemoteEnrichmentLookupState;
  lookupStarted: boolean;
  earlyLookupFailure?: RemoteEnrichmentFailure;
  routeIndex: number;
  terminal: boolean;
  attempts: AttemptFailure[];
}

interface Operation {
  readonly kind: OperationKind;
  readonly controller: AbortController;
  readonly item?: Work;
  abandon(): void;
}

function localIdentity(owner: LocalSnapshotOwner) {
  return owner.key ? `simple:${owner.key}` : `opaque:${owner.name}`;
}

/** A single expanding pass. Logical deadlines never release physical request leases. */
export function startRemoteEnrichment<T>(options: RemoteEnrichmentOptions<T>) {
  const { signal, prepare, apply, priority, measure, readLocalInventory, timing = browserTiming } = options;
  const concurrent = readLocalInventory !== undefined;
  const limiter = options.limiter ?? (timing === browserTiming ? browserLimiter ??= createEnrichmentLimiter() : createEnrichmentLimiter(timing));
  const readers = options.readers ?? createRemoteEnrichmentReaders(window.location.origin);
  const locals = new Set(options.localSnapshot?.owners.map(localIdentity));
  const work = new Map<string, Work>();
  const ready = new Set<Work>();
  // These already have discovery evidence but may become uncovered references
  // before the rest of the queue settles. Publish just one terminal outcome.
  const withoutRoute = new Set<Work>();
  const active = new Set<Operation>();
  const busy = new Set<Work>();
  const discoveries = new Map<string, RemoteDiscovery>();
  const results = new Map<string, RemoteEnrichmentResult<T>>();
  const intake: Array<{ item: Work; prepared: PreparedEnrichment<T>; candidates: readonly RemoteEnrichmentOwner[]; next: number }> = [];
  const priorityStarted = new Set<Work>();
  const promotions = new Map<Work, Iterator<Work>>();
  const counts = { total: 0, pending: 0, read: 0, partial: 0, unsuccessful: 0, unreachable: 0, unresolved: 0, invalid: 0, lookupFailed: 0, noRoute: 0 };
  let inventory: RemoteInventoryProgress = {
    state: 'pending', coverage: 'HTTP advertisements only',
    local: options.localSnapshot ? options.localSnapshot.inventory?.state === 'limited' ? 'limited' : 'known' : 'unknown',
    rows: 0, discardedRows: 0, advertised: 0, omittedAdmissions: 0
  };
  let incoming: RemoteInventory['advertisements'] = [];
  let cursor = 0;
  let inventoryStarted = false;
  let localInventoryStarted = false;
  let localAccepted = !concurrent;
  let localInventoryDelta: LocalSnapshot | undefined;
  let localDeadline = Infinity;
  let localPending = 0;
  let inventoryAccepted = false;
  let inventoryRowsLimited = false;
  let seedCursor: Iterator<Work> | undefined;
  let dispatches = 0;
  let state: 'running' | 'paused' | 'retired' = 'running';
  let task: { handle: number } | undefined;
  let frame: { handle: number } | undefined;
  let unsubscribe: (() => void) | undefined;
  let resolveIdle!: () => void;
  const idle = new Promise<void>((resolve) => { resolveIdle = resolve; });

  function observe(event: RemoteEnrichmentMeasurement) {
    try { measure?.(event); } catch { /* Measurements cannot interrupt work. */ }
  }

  function reportOmission() {
    inventory = { ...inventory, omittedAdmissions: inventory.omittedAdmissions + 1 };
    if (inventory.state === 'complete') inventory = { ...inventory, state: 'limited', reason: 'capacity' };
    publish();
  }

  function admit(candidate: RemoteEnrichmentOwner, direct: boolean, referenced: boolean, local?: Work['local']) {
    if ((!local && !validOwner(candidate)) || (!local && locals.has(candidate.key))) return;
    const current = work.get(candidate.key);
    if (current) {
      current.referenced ||= referenced;
      if (local && !current.local) {
        current.local = local;
        current.owner = Object.freeze({ ...candidate });
        delete current.discovery;
        current.lookupState = 'pending';
        withoutRoute.delete(current);
        discoveries.delete(candidate.key);
      }
      return current;
    }
    if (work.size + locals.size - localWork >= maxEnrichmentOwners && !local) { reportOmission(); return; }
    const now = timing.now();
    const item: Work = {
      owner: Object.freeze({ ...candidate }), ...(local ? { local } : {}), admittedAt: now, eligibleAt: now,
      direct, referenced, distance: local ? 0 : direct ? 1 : Infinity,
      lookupState: 'pending', lookupStarted: false, routeIndex: 0, terminal: false, attempts: []
    };
    work.set(candidate.key, item);
    counts.total += 1;
    counts.pending += 1;
    return item;
  }

  function promote(item: Work, distance: number) {
    if (distance > previewHops || distance >= item.distance) return;
    item.distance = distance;
    // A shorter route can traverse already-inspected owners without re-reading them.
    if (item.references?.size) promotions.set(item, item.references.values());
  }

  function preferred(item: Work) {
    return concurrent ? item.distance <= previewHops && (priorityStarted.has(item) || priorityStarted.size < previewOwners)
      : item.local || item.direct || priority?.(item.owner);
  }

  function finishLocal(snapshot?: LocalSnapshot) {
    localAccepted = true;
    localInventoryDelta = snapshot;
    if (snapshot) {
      inventory = { ...inventory, local: snapshot.inventory?.state === 'limited' ? 'limited' : 'known' };
      for (const local of snapshot.owners) locals.add(localIdentity(local));
      for (const local of snapshot.owners) {
        const key = localIdentity(local);
        const reader = unfinishedLocalReader(snapshot, local);
        if (reader) {
          const item = admit(ownerFromName(local.name, key), true, false, reader);
          if (item) {
            localWork += 1;
            localPending += 1;
            promote(item, 0);
            enqueue(item);
          }
        } else {
          // A local identity still wins even if ambiguous or unreadable.
          const item = work.get(key);
          if (item) {
            work.delete(key);
            ready.delete(item);
            withoutRoute.delete(item);
            counts.total -= 1;
            counts.pending -= 1;
          }
          discoveries.delete(key);
        }
      }
    }
    publish();
  }

  function enqueue(item: Work) {
    if (item.terminal || ready.has(item)) return;
    if (!item.local && !item.referenced && !item.discovery?.routes.length) {
      withoutRoute.add(item);
      return;
    }
    withoutRoute.delete(item);
    item.eligibleAt = timing.now();
    ready.add(item);
  }

  function applyDiscovery(item: Work) {
    const evidence = item.discovery;
    if (!evidence?.advertised) return;
    const advertised = evidence.advertisedName ? ownerFromName(evidence.advertisedName, item.owner.key) : item.owner;
    discoveries.set(item.owner.key, { owner: validOwner(advertised) ? advertised : item.owner, lookupState: item.lookupState,
      ...(evidence.hostEvidence !== undefined ? { hostEvidence: evidence.hostEvidence } : {}) });
    publish();
  }

  function acceptAdvertisement(advertisement: RemoteAdvertisement) {
    const item = admit(advertisement.owner, false, false);
    if (!item) return;
    item.discovery = concurrent && item.lookupStarted ? combineEvidence(advertisement, item.discovery) : advertisement;
    if (!item.terminal) item.lookupState = routeState(item.discovery.routes.length, item.discovery.issues, inventoryRowsLimited || advertisement.limited);
    applyDiscovery(item);
    enqueue(item);
  }

  function record(item: Work, outcome: OwnerOutcome<T>) {
    if (state === 'retired' || item.terminal) return;
    item.terminal = true;
    if (concurrent && item.local) localPending -= 1;
    counts.pending -= 1;
    counts[outcome.outcome] += 1;
    if (outcome.outcome === 'unsuccessful') {
      switch (outcome.reason) {
        case 'transport': case 'timeout': counts.unreachable += 1; break;
        case 'invalid-data': case 'prepare-failed': counts.invalid += 1; break;
        case 'no-route': counts.noRoute += 1; break;
        case 'policy-blocked': counts.unresolved += 1; break;
        default: counts.lookupFailed += 1;
      }
    }
    const hostEvidence = item.discovery?.hostEvidence;
    results.set(item.owner.key, { owner: item.owner, source: item.local ? 'local' : 'remote', lookupState: item.lookupState,
      issues: item.discovery?.issues ?? [], attempts: [...item.attempts],
      ...(hostEvidence !== undefined ? { hostEvidence } : {}), ...outcome });
    publish();
  }

  function unsuccessful(item: Work, reason: RemoteEnrichmentFailure) { record(item, { outcome: 'unsuccessful', reason }); }

  function routeState(routeCount: number, issues?: readonly PolicyIssue[], limited?: boolean): RemoteEnrichmentLookupState {
    return routeCount ? 'found' : issues?.length ? 'blocked' : limited ? 'invalid' : 'no-route';
  }

  function settleWithoutRoute(item: Work) {
    unsuccessful(item, item.lookupState === 'blocked' ? 'policy-blocked' : item.earlyLookupFailure ??
      (item.lookupState === 'invalid' ? 'lookup-limited' : 'no-route'));
  }

  function combineEvidence(primary: RemoteLookup, other?: RemoteLookup): RemoteLookup {
    if (!other) return primary;
    const routes = new Map(primary.routes.map((route) => [route.url, route]));
    for (const route of other.routes) if (!routes.has(route.url)) routes.set(route.url, route);
    const hosts = new Set([...routes.values()].map((route) => new URL(route.url).host));
    const { hostEvidence: _host, ...fields } = primary;
    const host = hosts.size > 1 || primary.hostEvidence === null || other.hostEvidence === null ? null
      : hosts.size === 1 ? primary.hostEvidence ?? other.hostEvidence : undefined;
    return { ...fields, routes: [...routes.values()], issues: [...new Set([...primary.issues, ...other.issues])].sort(),
      ...(host !== undefined ? { hostEvidence: host } : {}) };
  }

  function settleLookup(item: Work, evidence: RemoteLookup) {
    const previous = item.discovery;
    if (concurrent && item.distance === 1) {
      if (evidence.advertised) item.discovery = previous ? combineEvidence(previous, evidence) : evidence;
      const routes = item.discovery?.routes ?? [];
      item.lookupState = routeState(routes.length, item.discovery?.issues, evidence.limited);
      if (evidence.advertised && (!previous || previous.hostEvidence !== item.discovery?.hostEvidence)) applyDiscovery(item);
      // The exact request can start early, but the bulk response can still
      // supply fallback routes or quarantine the exact route before any GET.
      enqueue(item);
      return;
    }
    if (evidence.advertised) item.discovery = {
      ...evidence, issues: [...new Set([...(previous?.issues ?? []), ...evidence.issues])].sort()
    };
    item.lookupState = routeState(evidence.routes.length, item.discovery?.issues, evidence.limited);
    if (evidence.advertised && !previous) applyDiscovery(item);
    if (evidence.routes.length) enqueue(item);
    else settleWithoutRoute(item);
  }

  function settleBindings(item: Work, bindings: NodelRemoteBindings) {
    let prepared: ReturnType<RemoteEnrichmentOptions<T>['prepare']>;
    try { prepared = prepare(item.owner, bindings, true); }
    catch { unsuccessful(item, 'prepare-failed'); return; }
    if (state === 'retired') return;
    const { followUpOwners = [], ...result } = prepared;
    if (followUpOwners.length) intake.push({ item, prepared: result, candidates: followUpOwners, next: 0 });
    else record(item, result);
  }

  function finishInventory(result?: RemoteInventory, failure?: RemoteInventoryProgress['reason']) {
    inventoryAccepted = true;
    if (result) {
      incoming = result.advertisements;
      const responseLimit = result.limited ?? (result.discardedRows ? 'malformed-rows' : undefined);
      inventoryRowsLimited = Boolean(responseLimit);
      const reason = responseLimit ?? (inventory.omittedAdmissions ? 'capacity' : undefined);
      inventory = { ...inventory, rows: result.rows, discardedRows: result.discardedRows, advertised: result.advertisements.length,
        state: reason ? 'limited' : 'complete', ...(reason ? { reason } : {}) };
    } else {
      inventory = { ...inventory, state: failure === 'bytes' ? 'limited' : 'failed', ...(failure ? { reason: failure } : {}) };
    }
    publish();
  }

  function alive() { return state !== 'retired' && !signal?.aborted; }
  function runnable() { return state === 'running' && !signal?.aborted; }

  function start<V>(kind: OperationKind, release: () => void, run: (signal: AbortSignal) => Promise<V>, success: (value: V) => void,
    failure: (reason: AttemptFailure | 'bytes') => void, item?: Work, dispatch?: RemoteEnrichmentMeasurement['dispatch']) {
    const controller = new AbortController();
    const startedAt = timing.now();
    // Keep the original local I/O guard for inspections already underway near
    // the boundary. Unstarted local work continues in the same background queue.
    const budget = kind === 'local-read' && startedAt < localDeadline ? Math.min(requestBudget, localDeadline - startedAt) : requestBudget;
    const expires = startedAt + budget;
    let handled = false;
    const operation: Operation = { controller, kind, ...(item ? { item } : {}), abandon() {
      handled = true;
      timing.clearTimer(timer);
    } };
    const timer = timing.setTimer(expire, budget);
    active.add(operation);
    if (item) busy.add(item);

    function expire() {
      if (handled || !alive()) return;
      handled = true;
      controller.abort();
      if (state !== 'retired' && !signal?.aborted) failure('timeout');
      schedule();
    }

    async function execute() {
      try {
        observe({ event: 'start', operation: kind, at: startedAt, physical: limiter.active,
          ...(item ? { ownerId: item.owner.id, eligibleAgeMs: startedAt - item.eligibleAt, ownerAgeMs: startedAt - item.admittedAt } : {}),
          ...(concurrent && item && Number.isFinite(item.distance) ? { referenceDistance: item.distance } : {}),
          ...(dispatch ? { dispatch } : {}) });
        if (!alive() || controller.signal.aborted) return;
        const value = await run(controller.signal);
        if (handled || !alive()) return;
        if (timing.now() >= expires) { expire(); return; }
        handled = true;
        success(value);
      } catch (error) {
        if (handled || !alive()) return;
        if (timing.now() >= expires) { expire(); return; }
        handled = true;
        failure(error instanceof EnrichmentResponseLimit && (kind === 'inventory' || kind === 'lookup') ? 'bytes' : enrichmentReadFailure(error));
      } finally {
        timing.clearTimer(timer);
        active.delete(operation);
        if (item) busy.delete(item);
        release();
        observe({ event: 'settle', operation: kind, at: timing.now(), physical: limiter.active, ...(item ? { ownerId: item.owner.id } : {}) });
        if (state === 'retired' && !active.size) resolveIdle();
        schedule();
      }
    }
    void execute();
  }

  function nextRoute(item: Work) {
    const routes = item.discovery?.routes ?? [];
    while (item.routeIndex < Math.min(routeLimit, routes.length)) {
      const route = routes[item.routeIndex]!;
      if (readers.allows?.(item.owner, route) !== false) {
        item.lookupState = 'found';
        return route;
      }
      item.routeIndex += 1;
      item.lookupState = 'blocked';
      if (item.discovery) item.discovery = { ...item.discovery, issues: [...new Set<PolicyIssue>([...item.discovery.issues, 'identity-conflict'])] };
    }
    return undefined;
  }

  function pick() {
    type Lane = { oldest?: Work; preferred?: Work; oldestNormal?: Work };
    const reserve = dispatches % 4 === 3;
    const open: Lane = {};
    const capped: Lane = {};
    let cappedOrigin: string | undefined;
    let contested = false;
    for (const item of ready) {
      if (busy.has(item)) continue;
      if (concurrent && !item.local) {
        if (!localAccepted) continue;
        if (!inventoryAccepted || cursor < incoming.length) {
          if (!item.referenced || item.distance !== 1 || item.lookupStarted || item.discovery?.routes.length) continue;
        }
      }
      const origin = nextRoute(item)?.origin;
      let lane = open;
      if (origin && limiter.remoteActive(origin) >= 2) {
        if (cappedOrigin && cappedOrigin !== origin) contested = true;
        cappedOrigin ??= origin;
        lane = capped;
      }
      lane.oldest ??= item;
      const prioritized = preferred(item);
      if (reserve && !prioritized) lane.oldestNormal ??= item;
      if (prioritized && (!lane.preferred || (concurrent && (item.distance < lane.preferred.distance ||
        (item.distance === lane.preferred.distance && item.owner.key < lane.preferred.owner.key))))) {
        lane.preferred = item;
      }
      if (reserve ? open.oldestNormal : !concurrent && open.preferred) break;
    }
    // A sole busy origin may use spare physical slots, but only after applying
    // the same priority and every-fourth oldest-normal reservation to its jobs.
    const lane = open.oldest ? open : !contested ? capped : undefined;
    const item = lane?.oldestNormal ?? lane?.preferred ?? lane?.oldest;
    return item ? { item, dispatch: reserve ? 'reserved' as const : lane?.preferred ? 'priority' as const : 'oldest' as const } : undefined;
  }

  function dispatch(item: Work, lane: RemoteEnrichmentMeasurement['dispatch']) {
    const route = nextRoute(item);
    const lookup = !item.local && !route && item.referenced && !item.lookupStarted && !item.attempts.length;
    if (!item.local && !route && !lookup) {
      ready.delete(item);
      if (!item.referenced && !item.lookupStarted) withoutRoute.add(item);
      else settleWithoutRoute(item);
      return true;
    }
    const release = limiter.tryStart(route?.origin);
    if (!release) return false;
    ready.delete(item);
    dispatches += 1;
    if (concurrent && preferred(item)) priorityStarted.add(item);
    if (lookup) {
      item.lookupStarted = true;
      start('lookup', release, (signal) => readers.lookup(item.owner, signal), (result) => settleLookup(item, result), (reason) => {
        item.lookupState = reason === 'invalid-data' || reason === 'bytes' ? 'invalid' : 'failed';
        const outcome = reason === 'bytes' ? 'lookup-limited' : `lookup-${reason}` as const;
        if (concurrent && item.distance === 1) {
          item.earlyLookupFailure = outcome;
          enqueue(item);
        } else unsuccessful(item, outcome);
      }, item, lane);
    } else {
      const revoked = () => route !== undefined && readers.allows?.(item.owner, route) === false;
      const failed = (failure: AttemptFailure | 'bytes') => {
        const reason = failure === 'bytes' ? 'invalid-data' : failure;
        const routeRevoked = revoked();
        if (!routeRevoked) {
          item.attempts.push(reason);
          if (route) item.routeIndex += 1;
        }
        // Recheck queued/active route authority after an exact reply quarantines a path.
        if (nextRoute(item) || (routeRevoked && item.referenced && !item.lookupStarted && !item.attempts.length)) enqueue(item);
        else unsuccessful(item, item.attempts.includes('invalid-data') ? 'invalid-data' : routeRevoked ? 'policy-blocked' : reason);
      };
      start(item.local ? 'local-read' : 'remote-read', release, (signal) => item.local ? item.local(signal) : readers.read(item.owner, route!, signal),
        (bindings) => {
          // The reader may have settled one microtask before a conflicting reply.
          if (revoked()) failed('transport');
          else settleBindings(item, bindings);
        }, failed, item, lane);
    }
    return true;
  }

  function pump() {
    if (!runnable()) return;
    if (readLocalInventory && !localInventoryStarted) {
      const release = limiter.tryStart();
      if (!release) return;
      localInventoryStarted = true;
      localDeadline = timing.now() + localSnapshotBudgetMs;
      start('local-inventory', release, readLocalInventory, finishLocal, () => finishLocal());
    }
    if (!inventoryStarted) {
      const release = limiter.tryStart();
      if (!release) return;
      inventoryStarted = true;
      start('inventory', release, (signal) => readers.inventory(signal), (result) => finishInventory(result), (reason) => finishInventory(undefined, reason));
    }
    if (!concurrent && !inventoryAccepted) return;
    const expires = timing.now() + sliceMs;
    let left = sliceItems;
    // Starting local inspections never depends on a held POST or the size of
    // its ready-to-admit advertisement payload.
    if (concurrent && (!inventoryAccepted || cursor < incoming.length) && localPending) {
      while (limiter.active < 4 && left > 0 && timing.now() < expires) {
        const next = pick();
        if (!next || !dispatch(next.item, next.dispatch)) break;
        left -= 1;
      }
    }
    while (cursor < incoming.length && left > 0 && timing.now() < expires && discoveries.size < sliceItems) {
      acceptAdvertisement(incoming[cursor++]!);
      left -= 1;
    }
    if (cursor < incoming.length && discoveries.size < sliceItems) schedule();
    if (incoming.length && cursor === incoming.length) { incoming = []; cursor = 0; }
    if (seedCursor) {
      while (left > 0 && timing.now() < expires) {
        const next = seedCursor.next();
        if (next.done) { seedCursor = undefined; break; }
        enqueue(next.value);
        left -= 1;
      }
      if (seedCursor) { schedule(); return; }
    }
    while (promotions.size && left > 0 && timing.now() < expires) {
      const [item, linked] = promotions.entries().next().value!;
      const next = linked.next();
      if (next.done) promotions.delete(item);
      else promote(next.value, item.distance + 1);
      left -= 1;
    }
    // Resume large positive binding deltas without holding up a single event-loop turn.
    // Publish the prepared owner only after all its known follow-ups have been admitted.
    while (intake.length && left > 0 && timing.now() < expires && results.size < sliceItems) {
      const entry = intake[0]!;
      const candidate = entry.candidates[entry.next++];
      if (candidate) {
        const existing = work.get(candidate.key);
        const target = admit(candidate, false, true);
        if (target) {
          if (concurrent) {
            (entry.item.references ??= new Set()).add(target);
            promote(target, entry.item.distance + 1);
          }
          if (!existing || withoutRoute.delete(target)) enqueue(target);
        }
      }
      if (entry.next >= entry.candidates.length) {
        intake.shift();
        record(entry.item, entry.prepared);
      }
      left -= 1;
    }
    if (intake.length || promotions.size) { if (results.size < sliceItems) schedule(); return; }
    while (left > 0 && timing.now() < expires && runnable() && limiter.active < 4 && results.size < sliceItems && discoveries.size < sliceItems) {
      const next = pick();
      if (!next || !dispatch(next.item, next.dispatch)) break;
      left -= 1;
    }
    if (inventoryAccepted && localAccepted && cursor >= incoming.length && !ready.size && !active.size) {
      for (const item of withoutRoute) {
        if (!runnable() || left <= 0 || timing.now() >= expires || results.size >= sliceItems) break;
        withoutRoute.delete(item);
        settleWithoutRoute(item);
        left -= 1;
      }
    }
    if (left === 0 || timing.now() >= expires) schedule();
  }

  function schedule() {
    if (!runnable() || task) return;
    const token = { handle: timing.setTimer(() => {
      if (task !== token) return;
      task = undefined;
      pump();
      if (isComplete()) publish();
    }, 0) };
    task = token;
  }

  function isComplete() { return inventoryAccepted && localAccepted && cursor >= incoming.length && !seedCursor && !counts.pending && !active.size; }

  function prioritySettled() {
    if (!localAccepted || !inventoryAccepted) return false;
    if (priorityStarted.size === previewOwners) return [...priorityStarted].every(({ terminal }) => terminal);
    if (cursor < incoming.length || promotions.size) return false;
    for (const item of work.values()) if (!item.terminal && preferred(item)) return false;
    return true;
  }

  function retire() {
    state = 'retired';
    if (task) timing.clearTimer(task.handle);
    if (frame) timing.cancelFrame(frame.handle);
    task = undefined;
    frame = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    signal?.removeEventListener('abort', cancel);
    discoveries.clear();
    results.clear();
    intake.length = 0;
    ready.clear();
    withoutRoute.clear();
    promotions.clear();
    priorityStarted.clear();
    work.clear();
    locals.clear();
    incoming = [];
    localInventoryDelta = undefined;
    seedCursor = undefined;
    if (!active.size) resolveIdle();
  }

  function flush() {
    if (state === 'retired' || signal?.aborted) return;
    const settled = state === 'running' && isComplete();
    const batch: RemoteEnrichmentBatch<T> = {
      discoveries: [...discoveries.values()], results: [...results.values()], inventory: { ...inventory },
      ...(localInventoryDelta ? { localSnapshot: localInventoryDelta } : {}),
      ...(concurrent ? { preview: { localSettled: localAccepted,
        localPrioritySettled: localAccepted && (!localPending || (priorityStarted.size === previewOwners &&
          [...priorityStarted].every((item) => !item.local || item.terminal))),
        prioritySettled: prioritySettled() } } : {}),
      counts: { ...counts }, paused: state === 'paused', ...(settled ? { finish: 'complete' } : {})
    };
    localInventoryDelta = undefined;
    discoveries.clear();
    results.clear();
    if (settled) retire();
    try { apply(batch); }
    catch (error) { cancel(); throw error; }
    schedule();
  }

  function publish() {
    if (!runnable() || frame) return;
    const token = { handle: timing.requestFrame(() => {
      if (frame !== token || !runnable()) return;
      frame = undefined;
      flush();
    }) };
    frame = token;
  }

  function cancel() {
    if (state === 'retired') return;
    retire();
    for (const operation of active) { operation.abandon(); operation.controller.abort(); }
  }

  function freeze() {
    if (!runnable()) return;
    state = 'paused';
    unsubscribe?.();
    unsubscribe = undefined;
    if (task) timing.clearTimer(task.handle);
    if (frame) timing.cancelFrame(frame.handle);
    task = undefined;
    frame = undefined;
    // Retained documents have the same generation and request authority. Do
    // not issue duplicate inventory or owner operations on restoration.
    if (concurrent) return;
    for (const operation of active) {
      const { item, kind, controller } = operation;
      // Do not undo an already accepted timeout or put an exact POST back on the wire.
      if (controller.signal.aborted) continue;
      operation.abandon();
      controller.abort();
      if (signal?.aborted) return;
      if (item && kind === 'lookup') {
        item.lookupState = 'failed';
        unsuccessful(item, 'lookup-interrupted');
      } else if (item) enqueue(item);
      else finishInventory(undefined, 'interrupted');
    }
    flush();
  }

  function resume() {
    if (state !== 'paused' || signal?.aborted) return;
    state = 'running';
    unsubscribe = limiter.subscribe(schedule);
    publish();
    schedule();
  }

  let localWork = 0;
  if (signal?.aborted) cancel();
  else {
    for (const local of options.localSnapshot?.owners ?? []) {
      const reader = unfinishedLocalReader(options.localSnapshot!, local);
      if (reader && admit(ownerFromName(local.name, localIdentity(local)), true, false, reader)) localWork += 1;
    }
    for (const owner of options.owners) admit(owner, true, true);
    seedCursor = work.values();
    signal?.addEventListener('abort', cancel, { once: true });
    unsubscribe = limiter.subscribe(schedule);
    publish();
    schedule();
  }
  return { cancel, freeze, resume, idle };
}
