import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodelRemoteBindings } from '../src/api/nodel-types';
import {
  mergePreviewLocalInventory, startLocalPreview, type PreviewCallbacks, type PreviewRelease, type PreviewRenderer
} from '../src/experiments/konva-canvas/preview-coordinator';
import { applyRemoteDiscovery, applyRemoteEnrichmentResult, type LocalGraph } from '../src/experiments/konva-canvas/local-graph';
import { createEnrichmentLimiter, type RemoteEnrichmentMeasurement, type RemoteEnrichmentTiming } from '../src/experiments/konva-canvas/remote-enrichment';
import { ownerFromName } from '../src/experiments/konva-canvas/enrichment-transport';

const timing: RemoteEnrichmentTiming = {
  now: () => performance.now(), setTimer: (fn, delay) => window.setTimeout(fn, delay), clearTimer: window.clearTimeout.bind(window),
  requestFrame: (fn) => window.setTimeout(fn, 16), cancelFrame: (id) => window.clearTimeout(id)
};
const origin = 'https://remote.test';
const listing = (names: readonly string[]) => names.map((name) => ({ node: name, address: `${origin}/nodes/${name}/` }));
const localListing = (names: readonly string[]) => ({ nodes: Object.fromEntries(names.map((name) => [name, { name }])) });
const id = (name: string) => ownerFromName(name).id;
const response = (data: unknown) => Response.json(data);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// Comparison-build latch; production's synchronous zero fallback is tested in the shell suite.
function makeLatch(budget = 1_500) {
  const listeners = new Set<() => void>();
  let reason: PreviewRelease | undefined;
  const released = vi.fn();
  const timer = window.setTimeout(() => latch.release('deadline'), budget);
  const latch = {
    get releaseReason() { return reason; },
    release(value: PreviewRelease) {
      if (reason) return;
      reason = value;
      window.clearTimeout(timer);
      released(value);
      for (const listener of listeners) listener();
    },
    onRelease(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
  };
  return { latch, released };
}

function harness(budget?: number, shouldAttach = true) {
  const { latch, released } = makeLatch(budget);
  const limiter = createEnrichmentLimiter(timing);
  const measures: RemoteEnrichmentMeasurement[] = [];
  const callbacks = {
    progress: vi.fn<PreviewCallbacks['progress']>(), painted: vi.fn(), settled: vi.fn(), failed: vi.fn()
  };
  const run = startLocalPreview(latch, callbacks, { timing, limiter, measure: (item) => { measures.push(item); } });
  let graph: LocalGraph | undefined;
  let onDraw: (() => void) | undefined;
  const mount = vi.fn<PreviewRenderer['mount']>((accepted, drawn) => { graph = accepted; onDraw = drawn; return true; });
  const patch = vi.fn<PreviewRenderer['patch']>((batch) => {
    if (batch.localSnapshot) mergePreviewLocalInventory(graph!, batch.localSnapshot);
    for (const discovery of batch.discoveries) applyRemoteDiscovery(graph!, discovery);
    for (const result of batch.results) applyRemoteEnrichmentResult(graph!, result);
  });
  const attach = () => run.attach({ connected: ({ connections }) => connections.size > 0, mount, patch });
  if (shouldAttach) attach();
  return { latch, released, run, measures, limiter, callbacks, mount, patch, attach,
    graph: () => graph!, draw: () => onDraw?.(), starts: () => measures.filter(({ event }) => event === 'start') };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('single-generation local preview', () => {
  it('starts GET and POST together and first mounts a local event wire while only POST is held', async () => {
    const http = deferred<Response>();
    const local = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url) === '/REST') return local.promise;
      if (String(url).endsWith('/REST/nodeURLs')) return http.promise;
      if (String(url).includes('/Subscriber/')) return response({ events: { ready: { node: 'Publisher', event: 'ready' } } });
      return response({});
    });
    vi.stubGlobal('fetch', fetcher);
    const test = harness();
    await advance(1);
    expect(test.starts().map(({ operation }) => operation)).toEqual(['local-inventory', 'inventory']);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST']);
    local.resolve(response(localListing(['Subscriber', 'Publisher'])));
    await advance(100);
    expect(test.released).toHaveBeenCalledExactlyOnceWith('local-connected');
    expect(test.mount).toHaveBeenCalledTimes(1);
    expect(test.graph().ports.get([...test.graph().connections.values()][0]!.fromPortId)?.nodeId).toBe(id('Publisher'));
    expect(test.callbacks.painted).not.toHaveBeenCalled();
    expect(test.callbacks.settled).not.toHaveBeenCalled();
    expect(test.limiter.active).toBe(1);
    test.draw();
    expect(test.callbacks.painted).toHaveBeenCalledTimes(1);
    http.resolve(response(listing(['Subscriber', 'New'])));
    await advance(1_000);
    expect(test.graph().nodes.get(id('Subscriber'))?.origin).toBe('local');
    expect(test.graph().nodes.has(id('New'))).toBe(true);
    expect(test.patch.mock.calls.flatMap(([batch]) => batch.results).map(({ owner }) => owner.id)).toEqual([id('New')]);
    expect(test.callbacks.settled).toHaveBeenCalledExactlyOnceWith(false);
    expect(test.mount).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/Subscriber/'))).toHaveLength(1);
  });

  it.each(['show-now', 'deadline'] as const)('latches %s before data and before asynchronous renderer attachment', async (reason) => {
    const http = deferred<Response>();
    const local = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (url) => String(url) === '/REST' ? local.promise : http.promise));
    const test = harness(1_500, false);
    if (reason === 'show-now') test.latch.release('show-now');
    await advance(1_500);
    expect(test.released).toHaveBeenCalledExactlyOnceWith(reason);
    expect(test.mount).not.toHaveBeenCalled();
    local.resolve(response(localListing([])));
    http.resolve(response([{ node: 'NoRoute' }]));
    await advance(20);
    expect(test.mount).not.toHaveBeenCalled();
    test.attach();
    test.attach();
    expect(test.mount).toHaveBeenCalledTimes(1);
    expect(test.graph().nodes.has(id('NoRoute'))).toBe(true);
    test.draw();
    test.draw();
    expect(test.callbacks.painted).toHaveBeenCalledTimes(1);
    expect(test.callbacks.settled).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('publishes advertisement names while local membership is pending but only reads from the verified authority', async () => {
    const local = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url) === '/REST') return local.promise;
      if (String(url).endsWith('/REST/nodeURLs')) return response(listing(['Studio', 'Remote']));
      return response({});
    });
    vi.stubGlobal('fetch', fetcher);
    const test = harness(0);
    await advance(40);
    const studio = test.graph().nodes.get(id('Studio'));
    expect(studio?.origin).toBe('referenced');
    expect(fetcher).toHaveBeenCalledTimes(2);
    local.resolve(response(localListing(['Studio'])));
    await advance(600);
    expect(test.graph().nodes.get(id('Studio'))).toBe(studio);
    expect(studio).toMatchObject({ origin: 'local', localPathName: 'Studio', bindingsRead: 'read' });
    expect(fetcher.mock.calls.slice(2).map(([url, init]) => [String(url), init?.credentials])).toEqual([
      [`${window.location.origin}/nodes/Studio/REST/remote`, 'same-origin'], [`${origin}/nodes/Remote/REST/remote`, 'omit']
    ]);
    expect(test.released).toHaveBeenCalledExactlyOnceWith('deadline');
    expect(test.mount).toHaveBeenCalledTimes(1);
  });

  it('does not use local-connected while another local priority owner is outstanding', async () => {
    const pendingLocal = deferred<Response>();
    const http = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/REST') return response(localListing(['Root', 'Other']));
      if (url.endsWith('/REST/nodeURLs')) return http.promise;
      if (url.includes('/Other/')) return pendingLocal.promise;
      return response({ actions: { start: { node: 'Other', action: 'start' } } });
    }));
    const test = harness();
    await advance(100);
    expect(test.callbacks.progress.mock.lastCall?.[0].connections.size).toBe(1);
    expect(test.released).not.toHaveBeenCalled();
    pendingLocal.resolve(response({}));
    await advance(40);
    expect(test.released).toHaveBeenCalledExactlyOnceWith('local-connected');
    expect(test.limiter.active).toBe(1);
  });

  it('revokes exact-first host provenance when bulk discovery adds a second host, before the owner read settles', async () => {
    const bulk = deferred<Response>();
    const read = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/REST') return response(localListing(['Root']));
      if (url.endsWith('/REST/nodeURLs')) return bulk.promise;
      if (url.includes('/Root/')) return response({ events: { ready: { node: 'Target', event: 'ready' } } });
      if (url.endsWith('/REST/nodeURLsForNode')) return response(listing(['Target']));
      return read.promise;
    });
    vi.stubGlobal('fetch', fetcher);
    const test = harness(0);
    await advance(150);
    const target = test.graph().nodes.get(id('Target'));
    expect(target?.hostEvidence).toBe('remote.test');
    expect(test.starts().filter(({ operation }) => operation === 'remote-read')).toHaveLength(0);

    bulk.resolve(response([{ node: 'Target', address: 'https://second.test/nodes/Target/' }]));
    await advance(150);
    expect(test.patch.mock.calls.flatMap(([batch]) => batch.discoveries)).toContainEqual(expect.objectContaining({ hostEvidence: null }));
    expect(target).not.toHaveProperty('hostEvidence');
    expect(test.starts().filter(({ operation }) => operation === 'remote-read')).toHaveLength(1);

    read.resolve(response({}));
    await advance(150);
    expect(target).not.toHaveProperty('hostEvidence');
    expect(test.patch.mock.calls.flatMap(([batch]) => batch.results).filter(({ owner }) => owner.id === id('Target'))).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it.each([false, true])('looks up a direct event owner while POST is held and honors subsequent path conflicts (%s)', async (conflict) => {
    const bulk = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, request) => {
      const url = String(input);
      if (url === '/REST') return response(localListing(['Root']));
      if (url.endsWith('/REST/nodeURLs')) return bulk.promise;
      if (url.includes('/Root/')) return response({ events: { ready: { node: 'Target', event: 'ready' } } });
      if (url.endsWith('/REST/nodeURLsForNode')) {
        expect(JSON.parse(String(request?.body))).toEqual({ name: 'Target' });
        return response(listing(['Target']));
      }
      return response({});
    });
    vi.stubGlobal('fetch', fetcher);
    const test = harness(0);
    await advance(150);
    expect(test.starts().filter(({ operation }) => operation === 'lookup')).toHaveLength(1);
    expect(test.starts().filter(({ operation }) => operation === 'remote-read')).toHaveLength(0);
    bulk.resolve(response(conflict ? [...listing(['Target']), { node: 'Different', address: `${origin}/nodes/Target/` }] : listing(['Target'])));
    await advance(300);
    expect(test.starts().filter(({ operation }) => operation === 'lookup')).toHaveLength(1);
    expect(test.starts().filter(({ operation }) => operation === 'remote-read')).toHaveLength(conflict ? 0 : 1);
    expect(test.patch.mock.calls.flatMap(([batch]) => batch.results).filter(({ owner }) => owner.id === id('Target'))).toHaveLength(1);
    expect(test.graph().nodes.get(id('Target'))?.lookupState).toBe(conflict ? 'blocked' : 'found');
  });

  it.each([
    [localListing([]), [], 'confirmed'],
    [null, null, 'unavailable'],
    [{ nodes: { bad: false } }, [], 'incomplete']
  ] as const)('distinguishes terminal empty evidence (%s)', async (local, remote, status) => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (url) => response(String(url) === '/REST' ? local : remote)));
    const test = harness();
    await advance(100);
    expect(test.released).toHaveBeenCalledExactlyOnceWith('priority-settled');
    expect(test.callbacks.settled).toHaveBeenCalledExactlyOnceWith(status);
    expect(test.mount).not.toHaveBeenCalled();
    expect(test.callbacks.painted).not.toHaveBeenCalled();
  });

  it('retains all physical reservations and never replans or replays an accepted result across BFCache', async () => {
    const http = deferred<Response>();
    const bob = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url) === '/REST') return response(localListing(['Alice', 'Bob']));
      if (String(url).endsWith('/REST/nodeURLs')) return http.promise;
      if (String(url).includes('/Bob/')) return bob.promise;
      return response({ actions: { start: { node: 'Bob', action: 'start' } } });
    });
    vi.stubGlobal('fetch', fetcher);
    const test = harness(0);
    await advance(20);
    test.draw();
    const original = test.graph();
    test.run.freeze();
    expect(test.limiter.active).toBe(2);
    http.resolve(response(listing(['New'])));
    bob.resolve(response({}));
    await advance(50);
    expect(test.limiter.active).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(4);
    test.run.resume();
    await advance(500);
    expect(test.graph()).toBe(original);
    expect(test.mount).toHaveBeenCalledTimes(1);
    expect(test.callbacks.painted).toHaveBeenCalledTimes(1);
    expect(test.callbacks.settled).toHaveBeenCalledExactlyOnceWith(false);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/Bob/'))).toHaveLength(1);
    expect(test.patch.mock.calls.flatMap(([batch]) => batch.results).filter(({ owner }) => owner.id === id('Bob'))).toHaveLength(1);
  });

  it('prioritizes configured event owners by shortest hop, caps the priority window at eight, and keeps normal work draining', async () => {
    const names = ['AOld', ...Array.from({ length: 10 }, (_, i) => `Normal${i}`), 'P1', 'P2', 'P3', 'P4', 'Large'];
    const http = deferred<Response>();
    const bindings: Record<string, NodelRemoteBindings> = {
      Root: { events: { listening: { node: 'P1', event: 'ready' } }, actions: { chain: { node: 'Large', action: 'go' } } },
      P1: { events: { late: { node: 'P2', event: 'ready' }, cycle: { node: 'Root', event: 'ready' } } },
      P2: { actions: { hop: { node: 'P3', action: 'go' } } }, P3: { actions: { hop: { node: 'P4', action: 'go' } } },
      Large: { actions: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`n${i}`, { node: `Normal${i}`, action: 'go' }])) }
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/REST') return response(localListing(['Root']));
      if (url.endsWith('/REST/nodeURLs')) return http.promise;
      return response(bindings[url.split('/').at(-3)!] ?? {});
    });
    vi.stubGlobal('fetch', fetcher);
    const test = harness();
    await advance(100);
    http.resolve(response(listing(names)));
    await advance(5_000);
    await test.run.idle;
    const reads = test.starts().filter(({ operation }) => operation.endsWith('-read'));
    const ids = reads.map(({ ownerId }) => ownerId);
    expect(ids.slice(0, 4)).toEqual([id('Root'), id('Large'), id('AOld'), id('P1')]);
    expect(test.starts().find(({ ownerId }) => ownerId === id('AOld'))?.dispatch).toBe('reserved');
    expect(ids.indexOf(id('P2'))).toBeLessThan(ids.indexOf(id('P4')));
    expect(new Set(test.starts().filter(({ dispatch }) => dispatch === 'priority').map(({ ownerId }) => ownerId)).size).toBe(8);
    expect(new Set(ids).size).toBe(names.length + 1);
    expect(reads).toHaveLength(names.length + 1);
  });

  it('propagates a shorter incoming event reference through an inspected owner without reading it again', async () => {
    const http = deferred<Response>();
    const heldB = deferred<Response>();
    const bindings: Record<string, NodelRemoteBindings> = {
      Root: { actions: { toA: { node: 'A', action: 'go' }, toB: { node: 'B', action: 'go' } } },
      A: { actions: { next: { node: 'C', action: 'go' } } },
      C: { actions: { next: { node: 'D', action: 'go' } } },
      D: { actions: { next: { node: 'E', action: 'go' } } }
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input, request) => {
      const url = String(input);
      if (url === '/REST') return response(localListing(['Root']));
      if (url.endsWith('/REST/nodeURLs')) return http.promise;
      if (url.endsWith('/REST/nodeURLsForNode')) return response(listing([JSON.parse(String(request?.body)).name as string]));
      const name = url.split('/').at(-3)!;
      return name === 'B' ? heldB.promise : response(bindings[name] ?? {});
    });
    vi.stubGlobal('fetch', fetcher);
    const test = harness();
    await advance(100);
    http.resolve(response(listing(['A', 'B', 'C'])));
    for (let i = 0; i < 80 && !test.measures.some(({ event, operation, ownerId }) =>
      event === 'settle' && operation === 'remote-read' && ownerId === id('D')); i += 1) await advance(25);
    expect(test.starts().find(({ ownerId }) => ownerId === id('D'))).toMatchObject({ operation: 'lookup', referenceDistance: 3 });
    expect(test.starts().some(({ ownerId }) => ownerId === id('E'))).toBe(false);
    heldB.resolve(response({ events: { closer: { node: 'D', event: 'ready' } } }));
    await advance(1_000);
    expect(test.starts().find(({ ownerId }) => ownerId === id('E'))).toMatchObject({ referenceDistance: 3 });
    expect(test.starts().filter(({ ownerId, operation }) => ownerId === id('D') && operation === 'remote-read')).toHaveLength(1);
  });

  it('allows eligible anonymous reads after a local inventory timeout without releasing its physical slot', async () => {
    const stalledLocal = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/REST') return stalledLocal.promise;
      if (url.endsWith('/REST/nodeURLs')) return response(listing(['Remote']));
      return response({});
    });
    vi.stubGlobal('fetch', fetcher);
    const test = harness(0);
    await advance(2_999);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await advance(40);
    expect(fetcher.mock.calls[2]).toMatchObject([`${origin}/nodes/Remote/REST/remote`, { credentials: 'omit' }]);
    expect(test.limiter.active).toBe(1);
    expect(test.callbacks.settled).not.toHaveBeenCalled();
    stalledLocal.resolve(response(localListing(['Remote'])));
    await advance(50);
    test.draw();
    expect(test.graph().nodes.get(id('Remote'))?.origin).toBe('referenced');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(test.callbacks.settled).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('invalidates renderer and model callbacks on true source exit without returning physical leases early', async () => {
    const http = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/REST') return response(localListing(['Root']));
      if (url.endsWith('/REST/nodeURLs')) return http.promise;
      return response({});
    }));
    const test = harness(0);
    await advance(40);
    expect(test.mount).toHaveBeenCalledTimes(1);
    const accepted = test.callbacks.progress.mock.calls.length;
    test.run.cancel();
    test.draw();
    test.run.resume();
    expect(test.limiter.active).toBe(1);
    expect(test.callbacks.painted).not.toHaveBeenCalled();
    http.resolve(response(listing(['NeverPainted'])));
    await advance(50);
    await test.run.idle;
    expect(test.limiter.active).toBe(0);
    expect(test.callbacks.progress).toHaveBeenCalledTimes(accepted);
    expect(test.graph().nodes.has(id('NeverPainted'))).toBe(false);
  });
});
