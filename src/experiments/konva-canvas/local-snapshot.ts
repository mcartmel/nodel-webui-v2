import { decodeLocalRest, decodeRemoteBindings, MAX_API_COLLECTION_ITEMS, NodelApiDecodeError } from '../../api/codecs/nodel-codecs';
import type { NodelRemoteBindings } from '../../api/nodel-types';
import { hasOwn, isRecord } from '../../utils/records';
import { localNodeUrl, remoteNodeEndpoint } from '../../utils/urls';
import { isUsableNodeName } from '../../utils/node-name';
import { javaSimpleNameKey } from './local-simple-name';
import type { EnrichmentLimiter } from './enrichment-limiter';
import { enrichmentReadFailure, EnrichmentResponseLimit, fetchEnrichmentJson, InvalidEnrichmentJson } from './enrichment-transport';

export const localSnapshotBudgetMs = 10_000;
const ownerBudgetMs = 3_000;
const maxOwnerReads = 4;

type UnreadReason = 'unaddressable' | 'ambiguous' | 'invalid-data' | 'transport' | 'timed-out' | 'unfinished';

export type LocalSnapshotOwner = {
  readonly key: string | null;
  readonly name: string;
  /** The exact inventory spelling is linkable only when this canonical owner is unambiguous. */
  readonly localPathName?: string | null;
} & (
  | { readonly status: 'read'; readonly bindings: Readonly<NodelRemoteBindings> }
  | { readonly status: 'unread'; readonly reason: UnreadReason }
);

export interface LocalSnapshot {
  readonly owners: readonly LocalSnapshotOwner[];
  readonly inventory?: LocalInventoryEvidence;
}

/** Inventory-only membership snapshot; owner bindings arrive as scheduler results. */
export type LocalInventoryMembership = Omit<LocalSnapshot, 'owners'> & {
  readonly owners: readonly Extract<LocalSnapshotOwner, { status: 'unread' }>[];
};

/** Enforce the inventory/result boundary so names-only promotion cannot drop bindings. */
export function assertLocalInventoryMembership(snapshot: LocalSnapshot): asserts snapshot is LocalInventoryMembership {
  if (snapshot.owners.some((owner) => owner.status !== 'unread' || 'bindings' in owner)) {
    throw new Error('Local inventory membership must not include binding results.');
  }
}

interface LocalInventoryEvidence {
  readonly state: 'complete' | 'limited';
  readonly discardedRows: number;
}

interface LocalSnapshotOptions { readonly limiter?: EnrichmentLimiter }
const deferredReads = new WeakMap<LocalSnapshot, ReadonlyMap<LocalSnapshotOwner, (signal: AbortSignal) => Promise<NodelRemoteBindings>>>();

/** No credentialed request may be built from an advertisement, reference, or fabricated snapshot. */
export function unfinishedLocalReader(snapshot: LocalSnapshot, owner: LocalSnapshotOwner) {
  return deferredReads.get(snapshot)?.get(owner);
}

export class LocalSnapshotInventoryError extends Error {
  constructor(readonly timedOut: boolean) {
    super(timedOut ? 'Local inventory read timed out' : 'Local inventory could not be loaded');
    this.name = 'LocalSnapshotInventoryError';
  }
}

/** Check bounds before isolating row decode failures; no malformed row grants a local path. */
function decodeInventory(value: unknown) {
  if (!isRecord(value) || !hasOwn(value, 'nodes') || !isRecord(value.nodes)) throw new InvalidEnrichmentJson();
  const entries = Object.entries(value.nodes);
  if (entries.length > MAX_API_COLLECTION_ITEMS) throw new EnrichmentResponseLimit();
  const names: string[] = [];
  let discardedRows = 0;
  for (const [key, row] of entries) {
    try {
      const decoded = decodeLocalRest({ nodes: { [key]: row } }, 'GET /REST');
      names.push(decoded.nodes![key]!.name);
    } catch (error) {
      if (!(error instanceof NodelApiDecodeError)) throw error;
      discardedRows += 1;
    }
  }
  const evidence: LocalInventoryEvidence = Object.freeze({ state: discardedRows ? 'limited' : 'complete', discardedRows });
  return { names, evidence };
}

function assignmentUrl(name: string, origin: string) {
  try {
    const url = new URL(remoteNodeEndpoint(localNodeUrl(name, origin), 'REST/remote'));
    return url.origin === origin && /^\/nodes\/[^/]+\/REST\/remote$/.test(url.pathname) && !url.search && !url.hash
      ? url.href : null;
  } catch {
    return null;
  }
}

interface OwnerGroup {
  key: string | null;
  name: string;
  names: Set<string>;
  routes: Set<string | null>;
}

interface OwnerRead {
  index: number;
  url: string;
}

function planOwnerReads(names: string[], origin: string) {
  const groups = new Map<string, OwnerGroup>();
  const routeUseCounts = new Map<string, number>();
  // Compare original spellings by code unit, not the user's locale or wire order.
  for (const name of names.sort()) {
    const key = javaSimpleNameKey(name) || null;
    const id = key === null ? `unusable:${name}` : `key:${key}`;
    let group = groups.get(id);
    if (!group) {
      group = { key, name, names: new Set(), routes: new Set() };
      groups.set(id, group);
    }
    group.names.add(name);
    const url = key === null ? null : assignmentUrl(name, origin);
    if (url !== null && !group.routes.has(url)) {
      routeUseCounts.set(url, (routeUseCounts.get(url) ?? 0) + 1);
    }
    group.routes.add(url);
  }

  const reads: OwnerRead[] = [];
  const owners: LocalSnapshotOwner[] = [];
  for (const { name, key, names, routes } of groups.values()) {
    const [url] = routes;
    // Require a single proven URL for this owner, and do not ascribe the
    // response from one path to different logical owners either.
    const ambiguous = routes.size > 1 || (url != null && routeUseCounts.get(url) !== 1);
    const reason = ambiguous ? 'ambiguous' : url == null ? 'unaddressable' : 'unfinished';
    if (!ambiguous && url != null) reads.push({ index: owners.length, url });
    const localPathName = names.size === 1 && !ambiguous && key !== null && isUsableNodeName(name) ? name : null;
    owners.push(Object.freeze({ name, key, localPathName, status: 'unread', reason }));
  }
  return { owners, reads };
}

// The codec guarantees bounded, acyclic JSON data. Freeze its descendants too,
// so the model cannot accidentally mutate an assignment after publication.
function freezeJson(value: unknown) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
}

function cancelled() {
  return new DOMException('Local snapshot cancelled', 'AbortError');
}

const localReadInit: RequestInit = {
  method: 'GET', cache: 'no-store', credentials: 'same-origin', mode: 'same-origin', redirect: 'error',
  headers: { Accept: 'application/json' }
};

function inventoryAt(signal: AbortSignal) {
  return fetchEnrichmentJson(fetch, '/REST', { ...localReadInit, signal });
}

function planInventory(value: unknown) {
  const { names, evidence } = decodeInventory(value);
  return { ...planOwnerReads(names, window.location.origin), evidence };
}

async function bindingsAt(url: string, signal: AbortSignal) {
  const value = await fetchEnrichmentJson(fetch, url, { ...localReadInit, signal });
  signal.throwIfAborted();
  const bindings = decodeRemoteBindings(value, 'GET local REST/remote');
  freezeJson(bindings);
  return bindings;
}

/** One inventory operation; the shared scheduler owns timeouts and assignment dispatch. */
export async function readLocalInventory(signal: AbortSignal): Promise<LocalSnapshot> {
  const value = await inventoryAt(signal);
  signal.throwIfAborted();
  const { owners, reads, evidence } = planInventory(value);
  const snapshot = Object.freeze({ owners: Object.freeze(owners), inventory: evidence });
  deferredReads.set(snapshot, new Map(reads.map(({ index, url }) => [owners[index]!, (signal) => bindingsAt(url, signal)])));
  return snapshot;
}

/** Resolve exactly one terminal snapshot, or reject without one on cancellation or inventory failure. */
export function loadLocalSnapshot(signal?: AbortSignal, { limiter }: LocalSnapshotOptions = {}): Promise<LocalSnapshot> {
  if (signal?.aborted) return Promise.reject(cancelled());

  const deadline = performance.now() + localSnapshotBudgetMs;
  const inventoryController = new AbortController();

  return new Promise((resolve, reject) => {
    let owners: LocalSnapshotOwner[] | undefined;
    let inventoryEvidence: LocalInventoryEvidence | undefined;
    let reads: OwnerRead[] = [];
    let nextRead = 0;
    // Keep a slot until fetch and body handling actually settle, even if the
    // owner has timed out and its signal has already been aborted.
    const activeReads = new Map<AbortController, { timer: number | undefined; index: number }>();
    let sealed = false;
    let inventoryStarted = false;
    let inventoryTimer: number | undefined;

    function finish(outcome: 'complete' | 'cutoff' | 'cancelled' | 'invalid-inventory') {
      if (sealed) return;
      sealed = true;
      window.clearTimeout(timer);
      window.clearTimeout(inventoryTimer);
      unsubscribe?.();
      signal?.removeEventListener('abort', cancel);
      const result = owners;
      const resultReads = reads;
      const next = nextRead;
      owners = undefined;
      reads = [];

      for (const [controller, { timer: ownerTimer, index }] of activeReads) {
        window.clearTimeout(ownerTimer);
        const owner = result?.[index];
        if (outcome === 'cutoff' && owner?.status === 'unread' && owner.reason === 'unfinished') {
          result![index] = Object.freeze({ ...owner, reason: 'timed-out' });
        }
        controller.abort();
      }
      activeReads.clear();
      if (outcome === 'cutoff' || outcome === 'cancelled') inventoryController.abort();
      if (outcome === 'cancelled') {
        reject(cancelled());
      } else if (result === undefined || outcome === 'invalid-inventory') {
        reject(new LocalSnapshotInventoryError(outcome === 'cutoff'));
      } else {
        const snapshot = Object.freeze({ owners: Object.freeze(result), inventory: inventoryEvidence! });
        deferredReads.set(snapshot, new Map(resultReads.slice(next).map(({ index, url }) => [result[index]!, (signal) => bindingsAt(url, signal)])));
        resolve(snapshot);
      }
    }

    function cancel() {
      finish('cancelled');
    }

    function isOpen() {
      if (!sealed && performance.now() >= deadline) finish('cutoff');
      return !sealed;
    }

    async function readOwner({ index, url }: OwnerRead, release?: () => void) {
      const controller = new AbortController();
      const ownerDeadline = performance.now() + ownerBudgetMs;
      const { name, key, localPathName } = owners![index]!;
      const pathEvidence = localPathName === undefined ? {} : { localPathName };
      const expire = () => {
        if (!isOpen() || !owners || controller.signal.aborted) return;
        owners[index] = Object.freeze({ name, key, ...pathEvidence, status: 'unread', reason: 'timed-out' });
        controller.abort();
      };
      const ownerTimer = ownerDeadline < deadline
        ? window.setTimeout(expire, Math.max(0, Math.ceil(ownerDeadline - performance.now())))
        : undefined;
      activeReads.set(controller, { timer: ownerTimer, index });

      let bindings: NodelRemoteBindings | undefined;
      let failure: 'invalid-data' | 'transport' = 'transport';
      try {
        // These timers are owned by the snapshot, not the cooperative
        // transport, so sealing can clear them without awaiting this read.
        const value = await bindingsAt(url, controller.signal);
        if (isOpen() && !controller.signal.aborted && performance.now() < ownerDeadline) {
          bindings = value;
        }
      } catch (error) {
        // A bad owner must not turn into a successful empty configuration.
        bindings = undefined;
        failure = enrichmentReadFailure(error);
      }

      try {
        if (!isOpen() || !owners) return;
        if (performance.now() >= ownerDeadline) expire();
        else if (!controller.signal.aborted) {
          owners[index] = Object.freeze(bindings === undefined
            ? { key, name, ...pathEvidence, status: 'unread', reason: failure }
            : { key, name, ...pathEvidence, status: 'read', bindings });
        }
      } finally {
        window.clearTimeout(activeReads.get(controller)?.timer);
        activeReads.delete(controller);
        release?.();
        pump();
      }
    }

    function pump() {
      if (!owners) {
        if (!isOpen() || inventoryStarted) return;
        const release = limiter?.tryStart();
        if (limiter && !release) return;
        inventoryStarted = true;
        if (limiter && performance.now() + ownerBudgetMs < deadline) inventoryTimer = window.setTimeout(() => finish('cutoff'), ownerBudgetMs);
        void start(release);
        return;
      }
      while (isOpen() && activeReads.size < maxOwnerReads && nextRead < reads.length) {
        const release = limiter?.tryStart();
        if (limiter && !release) return;
        const read = reads[nextRead++]!;
        void readOwner(read, release);
      }
      if (isOpen() && activeReads.size === 0) finish('complete');
    }

    async function start(release?: () => void) {
      const expires = Math.min(deadline, performance.now() + (limiter ? ownerBudgetMs : localSnapshotBudgetMs));
      try {
        const value = await inventoryAt(inventoryController.signal);
        if (!isOpen()) return;
        if (performance.now() >= expires) { finish('cutoff'); return; }
        const plan = planInventory(value);
        if (sealed) return;
        // Keep known names even if route planning crossed the first-paint cutoff.
        owners = plan.owners;
        reads = plan.reads;
        inventoryEvidence = plan.evidence;
      } catch {
        if (isOpen()) finish(performance.now() >= expires ? 'cutoff' : 'invalid-inventory');
      } finally {
        window.clearTimeout(inventoryTimer);
        release?.();
      }
      pump();
    }

    // Terminal handling is independent of the in-flight promises and is wired
    // before touching transport. A suspended task cannot reopen the queue.
    const timer = window.setTimeout(() => finish('cutoff'), Math.max(0, deadline - performance.now()));
    signal?.addEventListener('abort', cancel, { once: true });
    const unsubscribe = limiter?.subscribe(pump);
    pump();
  });
}
