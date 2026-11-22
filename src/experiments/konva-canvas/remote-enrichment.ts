import { decodeNodeUrls, decodeRemoteBindings, MAX_API_COLLECTION_ITEMS, NodelApiDecodeError } from '../../api/codecs/nodel-codecs';
import type { NodelRemoteBindings } from '../../api/nodel-types';
import { getVerySimpleName, isUsableNodeName } from '../../utils/node-name';
import { remoteNodeEndpoint, safeRemoteNodeUrl } from '../../utils/urls';
import { REMOTE_ENRICHMENT_BUDGET_MS } from './enrichment-lifetime';
import { javaSimpleNameKey } from './local-simple-name';

export interface RemoteEnrichmentOwner {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

type PolicyIssue = 'unsafe-route' | 'identity-conflict' | 'mixed-content';
type AttemptFailure = 'timeout' | 'transport' | 'invalid-data';
export type RemoteEnrichmentFailure =
  | 'lookup-timeout' | 'lookup-transport' | 'lookup-invalid-data' | 'no-route' | 'policy-blocked'
  | AttemptFailure | 'prepare-failed';
export type RemoteEnrichmentLookupState = 'pending' | 'found' | 'no-route' | 'failed' | 'blocked' | 'invalid';

export interface RemoteLookup {
  /** Canonical, vetted REST/remote endpoints; never published to the scene. */
  readonly routes: readonly string[];
  /** Sanitized hostname evidence only when every validated candidate agrees and differs from the page host. */
  readonly hostEvidence?: string;
  readonly issues?: readonly PolicyIssue[];
}

/** Reader promises must represent physical settlement, not race abort against I/O. */
export interface RemoteEnrichmentReaders {
  lookup(owner: RemoteEnrichmentOwner, signal: AbortSignal): Promise<RemoteLookup>;
  read(route: string, signal: AbortSignal): Promise<NodelRemoteBindings>;
}

export interface RemoteEnrichmentTiming {
  now(): number;
  setTimer(callback: () => void, delay: number): number;
  clearTimer(handle: number): void;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

export interface PreparedEnrichment<T> {
  readonly outcome: 'read' | 'partial';
  readonly prepared: T;
}

export type RemoteEnrichmentResult<T> = {
  readonly owner: RemoteEnrichmentOwner;
  /** Discovery evidence only: pending means no lookup outcome was available at settlement. */
  readonly lookupState: RemoteEnrichmentLookupState;
  readonly issues: readonly PolicyIssue[];
  readonly attempts: readonly AttemptFailure[];
  /** Sanitized URL.host, never an address/path/credential. */
  readonly hostEvidence?: string;
} & (PreparedEnrichment<T>
  | { readonly outcome: 'unsuccessful'; readonly reason: RemoteEnrichmentFailure }
  | { readonly outcome: 'cutoff' });

export interface RemoteEnrichmentBatch<T> {
  readonly results: readonly RemoteEnrichmentResult<T>[];
  readonly counts: Readonly<Record<RemoteEnrichmentResult<T>['outcome'] | 'total', number>>;
  readonly finish?: 'complete' | 'cutoff' | 'freeze';
}

interface RemoteEnrichmentOptions<T> {
  owners: readonly RemoteEnrichmentOwner[];
  /** Reconstruct assignment evidence without mutating the graph. */
  prepare(this: void, owner: RemoteEnrichmentOwner, bindings: NodelRemoteBindings): PreparedEnrichment<T>;
  /** Commit one batch synchronously, including any scene/summary/final-draw updates. */
  apply(this: void, batch: RemoteEnrichmentBatch<T>): void;
  signal?: AbortSignal;
  /** Absolute deadline in the timing clock's monotonic domain; the page captures it at first paint. */
  deadline?: number;
  readers?: RemoteEnrichmentReaders;
  timing?: RemoteEnrichmentTiming;
}

const requestBudget = 3_000;
const routeLimit = 2;
const physicalLimit = 4;
const exactLookupPath = '/REST/nodeURLsForNode';
const rawAddress = Symbol('raw advertisement address');

const byCodeUnit = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function ownerKey(name: string) {
  const key = isUsableNodeName(name) ? javaSimpleNameKey(name) : '';
  return key ? `simple:${key}` : '';
}

function validOwner(owner: RemoteEnrichmentOwner) {
  return owner.id && owner.key && owner.key === ownerKey(owner.name);
}

class InvalidJson extends Error {}

// Unlike the shared fetchJson, this does not report connectivity or start probes.
// Its promise remains in flight until fetch and body handling have settled.
async function fetchJson(fetcher: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetcher(url, init);
  if (!response.ok || response.redirected || response.type === 'opaque' || response.type === 'opaqueredirect' || init.signal?.aborted) {
    await response.body?.cancel();
    throw new Error('The response is not readable');
  }
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new InvalidJson();
    throw error;
  }
}

/** Check the wire spelling before WHATWG parsing can erase traversal or empty userinfo. */
function advertisedPath(address: string): string | undefined {
  // eslint-disable-next-line no-control-regex -- URL parsing can otherwise strip raw control bytes.
  if (/[\\?#\u0000-\u0020\u007f]/.test(address)) return;
  const path = /^[Hh][Tt][Tt][Pp][Ss]?:\/\/([^/]+)\/nodes\/([^/]+)\/?$/.exec(address);
  if (!path || path[1]!.includes('@')) return;
  try {
    const segment = decodeURIComponent(path[2]!);
    // eslint-disable-next-line no-control-regex -- This also disallows encoded control bytes.
    if (segment !== '.' && segment !== '..' && !/[%/\\?#\u0000-\u0020\u007f-\u009f]/.test(segment)) return segment;
  } catch {
    // Invalid percent escape, or an invalid UTF-8 sequence.
  }
  return undefined;
}

function selectRoutes(value: unknown, owner: RemoteEnrichmentOwner, page: URL): RemoteLookup {
  // The exact helper's codec canonicalizes and removes unsafe original spellings
  // (e.g. /wrong/../nodes/Alpha/). Keep the wire address alongside each row through
  // the same bounded decoder so those cannot pass validation after normalization.
  const rows = Array.isArray(value) && value.length <= MAX_API_COLLECTION_ITEMS
    ? value.map((row: unknown) => row && typeof row === 'object' && !Array.isArray(row)
      ? { ...row, [rawAddress]: (row as Record<string, unknown>).address }
      : row)
    : value;
  const advertisements = decodeNodeUrls(rows, `POST ${exactLookupPath}`);
  const choices = new Map<string, { route: string; priority: number }>();
  const conflicts = new Set<string>();
  const issues = new Set<PolicyIssue>();
  for (const row of advertisements) {
    const original = (row as { [rawAddress]?: string })[rawAddress];
    const nameInPath = typeof original === 'string' ? advertisedPath(original) : undefined;
    const base = safeRemoteNodeUrl(row.address);
    if (!nameInPath || !base || !/^\/nodes\/[^/]+\/$/.test(base.pathname)) {
      issues.add('unsafe-route');
      continue;
    }
    const route = remoteNodeEndpoint(base.href, 'REST/remote');
    // The Java host resolves path segments as SimpleNames. Equivalent decoded
    // segments on the same origin must share a quarantine/deduplication key,
    // but a usable advertisement must still match its own exact path below.
    const routeKey = `${base.origin}/${javaSimpleNameKey(nameInPath)}`;
    const name = row.node ?? row.name;
    if (name === undefined || ownerKey(name) !== owner.key || getVerySimpleName(name) !== nameInPath
      || (row.node !== undefined && row.name !== undefined && ownerKey(row.name) !== owner.key)) {
      // Quarantine this route even when another sibling makes a conflicting
      // claim to it. Distinct validated addresses alone are not a contradiction.
      conflicts.add(routeKey);
      issues.add('identity-conflict');
      continue;
    }
    if (page.protocol === 'https:' && base.protocol === 'http:') {
      issues.add('mixed-content');
      continue;
    }
    const old = choices.get(routeKey);
    const priority = base.origin === page.origin ? 0 : base.protocol === 'https:' ? 1 : 2;
    if (old === undefined || route < old.route) choices.set(routeKey, { route, priority });
  }
  const routes = [...choices].filter(([key]) => !conflicts.has(key)).map(([, candidate]) => candidate)
    .sort((a, b) => a.priority - b.priority || byCodeUnit(a.route, b.route))
    .slice(0, routeLimit).map(({ route }) => route);
  // Keep only URL.host after every non-conflicting validated route agrees; differing aliases stay unknown.
  // The graph receives this sanitized label, never the route (path, query, credentials, etc.).
  const candidateHosts = new Set([...choices].filter(([key]) => !conflicts.has(key)).map(([, candidate]) => new URL(candidate.route).host));
  const hostEvidence = candidateHosts.size === 1 ? [...candidateHosts][0] : undefined;
  return {
    routes,
    ...(hostEvidence && hostEvidence !== page.host ? { hostEvidence } : {}),
    issues: [...issues].sort(byCodeUnit)
  };
}

/** The experiment-local transports intentionally do not affect host connectivity state. */
export function createRemoteEnrichmentReaders(origin: string, fetcher: typeof fetch = fetch): RemoteEnrichmentReaders {
  const page = new URL(origin);
  const lookupUrl = new URL(exactLookupPath, page.origin).href;
  const eligibleRoutes = new Set<string>();
  return {
    async lookup(owner, signal) {
      if (!validOwner(owner)) throw new InvalidJson();
      signal.throwIfAborted();
      const value = await fetchJson(fetcher, lookupUrl, {
        method: 'POST', mode: 'same-origin', credentials: 'same-origin', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer', signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: owner.name })
      });
      signal.throwIfAborted();
      const lookup = selectRoutes(value, owner, page);
      for (const route of lookup.routes) eligibleRoutes.add(route);
      return lookup;
    },
    async read(route, signal) {
      if (!eligibleRoutes.delete(route)) throw new Error('Remote route was not authorised by the exact lookup');
      signal.throwIfAborted();
      const value = await fetchJson(fetcher, route, {
        method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer', signal, headers: { Accept: 'application/json' }
      });
      signal.throwIfAborted();
      return decodeRemoteBindings(value, 'GET remote REST/remote');
    }
  };
}

const browserTiming: RemoteEnrichmentTiming = {
  now: () => performance.now(),
  setTimer: (callback, delay) => window.setTimeout(callback, delay),
  clearTimer: (handle) => window.clearTimeout(handle),
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle)
};

// The page can replace a generation while old abort-insensitive work is still
// running. All generations share physical slots, released only by settlement.
let physical = 0;
const waiting = new Set<() => void>();

interface Work {
  owner: RemoteEnrichmentOwner;
  lookupState: RemoteEnrichmentLookupState;
  routes: string[];
  issues: readonly PolicyIssue[];
  attempts: AttemptFailure[];
  hostEvidence?: string;
}

interface Operation {
  controller: AbortController;
  timer?: number;
  settled?: boolean;
}

function failureOf(error: unknown): AttemptFailure {
  return error instanceof NodelApiDecodeError || error instanceof InvalidJson ? 'invalid-data' : 'transport';
}

/** Start once after local paint. Graph/scene changes are exclusively through apply. */
export function startRemoteEnrichment<T>(options: RemoteEnrichmentOptions<T>) {
  const { signal, prepare, apply, timing = browserTiming } = options;
  const deadline = options.deadline ?? timing.now() + REMOTE_ENRICHMENT_BUDGET_MS;
  const work = new Map<string, Work>();
  const ids = new Set<string>();
  for (const candidate of options.owners) {
    if (!validOwner(candidate) || work.has(candidate.key) || ids.has(candidate.id)) continue;
    const { id, key, name } = candidate;
    work.set(key, { owner: Object.freeze({ id, key, name }), lookupState: 'pending', routes: [], issues: [], attempts: [] });
    ids.add(id);
  }
  const owners = work.values();
  const ready: Work[] = [];
  const pending = new Map<string, RemoteEnrichmentResult<T>>();
  const active = new Set<Operation>();
  const counts = { read: 0, partial: 0, unsuccessful: 0, cutoff: 0, total: work.size };
  let readers = options.readers;
  let state: 'open' | 'sealing' | 'retired' = 'open';
  let deadlineTimer: number | undefined;
  let frame: { handle: number } | undefined;
  let resolveIdle!: () => void;
  const idle = new Promise<void>((resolve) => { resolveIdle = resolve; });

  function stopOperation(operation: Operation) {
    if (operation.timer !== undefined) {
      timing.clearTimer(operation.timer);
      delete operation.timer;
    }
    if (!operation.settled) operation.controller.abort();
  }

  function retire() {
    state = 'retired';
    waiting.delete(pump);
    ready.length = 0;
    work.clear();
    pending.clear();
    if (frame !== undefined) {
      timing.cancelFrame(frame.handle);
      frame = undefined;
    }
    if (deadlineTimer !== undefined) timing.clearTimer(deadlineTimer);
    signal?.removeEventListener('abort', cancel);
    if (active.size === 0) resolveIdle();
  }

  function cancel() {
    if (state === 'retired') return;
    // Revoke before abort events; even a synchronous callback cannot flush.
    retire();
    for (const operation of active) stopOperation(operation);
  }

  function flush(finish?: RemoteEnrichmentBatch<T>['finish']) {
    if (state === 'retired' || (signal?.aborted ?? false)) return;
    const results = [...pending.values()];
    pending.clear();
    if (results.length || finish) apply({ results, counts: { ...counts }, ...(finish ? { finish } : {}) });
  }

  function record(item: Work, outcome: PreparedEnrichment<T> | { outcome: 'unsuccessful'; reason: RemoteEnrichmentFailure } | { outcome: 'cutoff' }) {
    // Deleting from unfinished marks it accepted before any frame is requested.
    if (!work.delete(item.owner.key)) return;
    counts[outcome.outcome] += 1;
    pending.set(item.owner.key, { owner: item.owner, lookupState: item.lookupState, issues: item.issues, attempts: [...item.attempts], ...(item.hostEvidence ? { hostEvidence: item.hostEvidence } : {}), ...outcome });
  }

  function finish(cause: NonNullable<RemoteEnrichmentBatch<T>['finish']>) {
    if (state !== 'open') return;
    state = 'sealing';
    waiting.delete(pump);
    try {
      for (const operation of active) stopOperation(operation);
      // Abort handlers can revoke the scene synchronously.
      if (signal?.aborted) return;
      for (const item of work.values()) record(item, { outcome: 'cutoff' });
      flush(cause);
    } finally {
      // Never cancel a draw requested by apply; this is only our pending frame.
      retire();
    }
  }

  function isOpen() {
    if (signal?.aborted) cancel();
    if (state === 'open' && timing.now() >= deadline) finish('cutoff');
    return state === 'open';
  }

  function accept(item: Work, outcome: PreparedEnrichment<T> | { outcome: 'unsuccessful'; reason: RemoteEnrichmentFailure }) {
    if (!isOpen()) return;
    record(item, outcome);
    if (work.size === 0) {
      finish('complete');
    } else if (frame === undefined) {
      const token = { handle: timing.requestFrame(() => {
        if (frame !== token || !isOpen()) return;
        frame = undefined;
        flush();
      }) };
      frame = token;
    }
  }

  function inspect(item: Work, route: string | undefined) {
    const controller = new AbortController();
    const operation: Operation = { controller };
    const expires = timing.now() + requestBudget;
    let handled = false;
    active.add(operation);
    physical += 1;

    function fail(reason: AttemptFailure) {
      if (route === undefined) {
        item.lookupState = reason === 'invalid-data' ? 'invalid' : 'failed';
        accept(item, { outcome: 'unsuccessful', reason: `lookup-${reason}` });
        return;
      }
      item.attempts.push(reason);
      if (item.routes.length) ready.push(item);
      else accept(item, { outcome: 'unsuccessful', reason });
    }

    function expire() {
      if (handled || !isOpen()) return;
      handled = true;
      stopOperation(operation);
      if (!isOpen()) return;
      fail('timeout');
      pump();
    }
    if (expires < deadline) operation.timer = timing.setTimer(expire, requestBudget);

    async function run() {
      try {
        if (route === undefined) {
          const lookup = await readers!.lookup(item.owner, controller.signal);
          operation.settled = true;
          if (handled || !isOpen()) return;
          if (timing.now() >= expires) { expire(); return; }
          handled = true;
          item.issues = [...(lookup.issues ?? [])];
          if (lookup.hostEvidence !== undefined) item.hostEvidence = lookup.hostEvidence;
          item.routes = [...new Set(lookup.routes)].slice(0, routeLimit);
          if (item.routes.length) {
            item.lookupState = 'found';
            ready.push(item);
          } else {
            item.lookupState = item.issues.length ? 'blocked' : 'no-route';
            accept(item, { outcome: 'unsuccessful', reason: item.lookupState === 'blocked' ? 'policy-blocked' : 'no-route' });
          }
        } else {
          const bindings = await readers!.read(route, controller.signal);
          operation.settled = true;
          if (handled || !isOpen()) return;
          if (timing.now() >= expires) { expire(); return; }
          handled = true;
          let outcome: PreparedEnrichment<T> | { outcome: 'unsuccessful'; reason: 'prepare-failed' };
          try {
            outcome = prepare(item.owner, bindings);
          } catch {
            outcome = { outcome: 'unsuccessful', reason: 'prepare-failed' };
          }
          accept(item, outcome);
        }
      } catch (error) {
        operation.settled = true;
        if (handled || !isOpen()) return;
        if (timing.now() >= expires) expire();
        else {
          handled = true;
          fail(failureOf(error));
        }
      } finally {
        if (operation.timer !== undefined) timing.clearTimer(operation.timer);
        active.delete(operation);
        physical -= 1;
        if (state === 'retired' && active.size === 0) resolveIdle();
        // Give already waiting generations the newly freed slot first.
        for (const waiter of [...waiting]) waiter();
        pump();
      }
    }
    void run();
  }

  let pumping = false;
  function pump() {
    if (pumping) return;
    pumping = true;
    try {
      waiting.delete(pump);
      while (isOpen() && physical < physicalLimit) {
        const continuation = ready.shift();
        if (continuation) inspect(continuation, continuation.routes.shift());
        else {
          const next = owners.next();
          if (next.done) return;
          inspect(next.value, undefined);
        }
      }
      if (state === 'open') waiting.add(pump);
    } finally {
      pumping = false;
    }
  }

  if (signal?.aborted || !work.size) cancel();
  else if (isOpen()) {
    readers ??= createRemoteEnrichmentReaders(window.location.origin);
    signal?.addEventListener('abort', cancel, { once: true });
    deadlineTimer = timing.setTimer(() => finish('cutoff'), Math.max(0, deadline - timing.now()));
    pump();
  }
  // Network quiescence is separate from scene retirement: callers must not
  // wait for idle before changing source, freezing, or disposing the scene.
  return { cancel, freeze: () => { if (isOpen()) finish('freeze'); }, idle };
}
