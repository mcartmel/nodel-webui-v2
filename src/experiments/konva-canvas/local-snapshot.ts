import { decodeRemoteBindings } from '../../api/codecs/nodel-codecs';
import { fetchJson } from '../../api/http-transport';
import { getLocalRest } from '../../api/nodel-host-client';
import type { NodelRemoteBindings } from '../../api/nodel-types';
import { hasOwn, isRecord } from '../../utils/records';
import { localNodeUrl, remoteNodeEndpoint } from '../../utils/urls';
import { javaSimpleNameKey } from './local-simple-name';

const snapshotBudgetMs = 10_000;
const ownerBudgetMs = 3_000;
const maxOwnerReads = 4;

type UnreadReason = 'unaddressable' | 'ambiguous' | 'failed' | 'timed-out' | 'unfinished';

export type LocalSnapshotOwner = {
  readonly key: string | null;
  readonly name: string;
} & (
  | { readonly status: 'read'; readonly bindings: Readonly<NodelRemoteBindings> }
  | { readonly status: 'unread'; readonly reason: UnreadReason }
);

export interface LocalSnapshot {
  readonly owners: readonly LocalSnapshotOwner[];
}

export class LocalSnapshotInventoryError extends Error {
  constructor(readonly timedOut: boolean) {
    super(timedOut ? 'Local inventory read timed out' : 'Local inventory could not be loaded');
    this.name = 'LocalSnapshotInventoryError';
  }
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
      group = { key, name, routes: new Set() };
      groups.set(id, group);
    }
    const url = key === null ? null : assignmentUrl(name, origin);
    if (url !== null && !group.routes.has(url)) {
      routeUseCounts.set(url, (routeUseCounts.get(url) ?? 0) + 1);
    }
    group.routes.add(url);
  }

  const reads: OwnerRead[] = [];
  const owners: LocalSnapshotOwner[] = [];
  for (const { name, key, routes } of groups.values()) {
    const [url] = routes;
    // Require a single proven URL for this owner, and do not ascribe the
    // response from one path to different logical owners either.
    const ambiguous = routes.size > 1 || (url != null && routeUseCounts.get(url) !== 1);
    const reason = ambiguous ? 'ambiguous' : url == null ? 'unaddressable' : 'unfinished';
    if (!ambiguous && url != null) reads.push({ index: owners.length, url });
    owners.push(Object.freeze({ name, key, status: 'unread', reason }));
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

/** Resolve exactly one terminal snapshot, or reject without one on cancellation or inventory failure. */
export function loadLocalSnapshot(signal?: AbortSignal): Promise<LocalSnapshot> {
  if (signal?.aborted) return Promise.reject(cancelled());

  const deadline = performance.now() + snapshotBudgetMs;
  const origin = window.location.origin;
  const inventoryController = new AbortController();
  const init: RequestInit = {
    method: 'GET', cache: 'no-store', credentials: 'same-origin', mode: 'same-origin', redirect: 'error',
    headers: { Accept: 'application/json' }
  };

  return new Promise((resolve, reject) => {
    let owners: LocalSnapshotOwner[] | undefined;
    let reads: OwnerRead[] = [];
    let nextRead = 0;
    // Keep a slot until fetch and body handling actually settle, even if the
    // owner has timed out and its signal has already been aborted.
    const activeReads = new Map<AbortController, number | undefined>();
    let sealed = false;

    function finish(outcome: 'complete' | 'cutoff' | 'cancelled' | 'invalid-inventory') {
      if (sealed) return;
      sealed = true;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      const result = owners;
      owners = undefined;
      reads = [];

      for (const [controller, ownerTimer] of activeReads) {
        window.clearTimeout(ownerTimer);
        controller.abort();
      }
      activeReads.clear();
      if (outcome === 'cutoff' || outcome === 'cancelled') inventoryController.abort();
      if (outcome === 'cancelled') {
        reject(cancelled());
      } else if (result === undefined || outcome === 'invalid-inventory') {
        reject(new LocalSnapshotInventoryError(outcome === 'cutoff'));
      } else {
        resolve(Object.freeze({ owners: Object.freeze(result) }));
      }
    }

    function cancel() {
      finish('cancelled');
    }

    function isOpen() {
      if (!sealed && performance.now() >= deadline) finish('cutoff');
      return !sealed;
    }

    async function readOwner({ index, url }: OwnerRead) {
      const controller = new AbortController();
      const ownerDeadline = performance.now() + ownerBudgetMs;
      const { name, key } = owners![index]!;
      const expire = () => {
        if (!isOpen() || !owners || controller.signal.aborted) return;
        owners[index] = Object.freeze({ name, key, status: 'unread', reason: 'timed-out' });
        controller.abort();
      };
      const ownerTimer = ownerDeadline < deadline
        ? window.setTimeout(expire, Math.max(0, Math.ceil(ownerDeadline - performance.now())))
        : undefined;
      activeReads.set(controller, ownerTimer);

      let bindings: NodelRemoteBindings | undefined;
      try {
        // These timers are owned by the snapshot, not the cooperative
        // transport, so sealing can clear them without awaiting this read.
        const value = await fetchJson(url, { ...init, signal: controller.signal }, 0);
        if (isOpen() && !controller.signal.aborted && performance.now() < ownerDeadline) {
          bindings = decodeRemoteBindings(value, 'GET local REST/remote');
          freezeJson(bindings);
        }
      } catch {
        // A bad owner must not turn into a successful empty configuration.
        bindings = undefined;
      }

      window.clearTimeout(activeReads.get(controller));
      activeReads.delete(controller);
      if (!isOpen() || !owners) return;
      if (performance.now() >= ownerDeadline) expire();
      else if (!controller.signal.aborted) {
        owners[index] = Object.freeze(bindings === undefined
          ? { key, name, status: 'unread', reason: 'failed' }
          : { key, name, status: 'read', bindings });
      }
      pump();
    }

    function pump() {
      while (isOpen() && activeReads.size < maxOwnerReads && nextRead < reads.length) {
        const read = reads[nextRead++]!;
        void readOwner(read);
      }
      if (isOpen() && activeReads.size === 0) finish('complete');
    }

    async function start() {
      const inventory = await getLocalRest({ ...init, signal: inventoryController.signal }, 0);
      if (!isOpen()) return;
      const nodes = inventory.nodes;
      if (!hasOwn(inventory, 'nodes') || !isRecord(nodes)) {
        finish('invalid-inventory');
        return;
      }
      const plan = planOwnerReads(Object.values(nodes).map((node) => node.name), origin);
      if (sealed) return;
      // Inventory arrived in time. Keep its cards even if synchronous route
      // planning crossed the cutoff; pump checks the deadline before any GET.
      owners = plan.owners;
      reads = plan.reads;
      pump();
    }

    // Terminal handling is independent of the in-flight promises and is wired
    // before touching transport. A suspended task cannot reopen the queue.
    const timer = window.setTimeout(() => finish('cutoff'), Math.max(0, deadline - performance.now()));
    signal?.addEventListener('abort', cancel, { once: true });
    void start().catch(() => {
      if (isOpen()) finish('invalid-inventory');
    });
  });
}
