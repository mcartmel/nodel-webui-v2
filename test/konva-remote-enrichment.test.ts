import { describe, expect, it, vi } from 'vitest';
import type { NodelRemoteBindings } from '../src/api/nodel-types';
import {
  createEnrichmentLimiter, createRemoteEnrichmentReaders, startRemoteEnrichment,
  type RemoteEnrichmentBatch, type RemoteEnrichmentMeasurement, type RemoteEnrichmentReaders, type RemoteEnrichmentTiming
} from '../src/experiments/konva-canvas/remote-enrichment';
import { maxEnrichmentOwners, maxEnrichmentResponseBytes, ownerFromName, type RemoteInventory, type RemoteLookup } from '../src/experiments/konva-canvas/enrichment-transport';
import { applyRemoteDiscovery, applyRemoteEnrichmentResult, buildLocalGraph, prepareRemoteOwnerInspection, type LocalGraph } from '../src/experiments/konva-canvas/local-graph';
import { localTopologyProgressSummary, projectLocalGraph } from '../src/experiments/konva-canvas/local-projection';
import { loadLocalSnapshot } from '../src/experiments/konva-canvas/local-snapshot';

const page = 'https://serving.test';
const other = 'https://remote.test';
const alpha = ownerFromName('Alpha');
const beta = ownerFromName('Beta');
const ad = (name: string, origin = other, path = name) => ({ node: name, address: `${origin}/nodes/${path}/` });
const signal = () => new AbortController().signal;
const json = (value: unknown) => Response.json(value);
const emptyInventory = { advertisements: [], rows: 0, discardedRows: 0 };
const noRoute: RemoteLookup = { advertised: false, routes: [], issues: [] };
const route = (url: string, origin = other) => ({ url, origin });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
};

const timing: RemoteEnrichmentTiming = {
  now: () => performance.now(), setTimer: (callback, delay) => window.setTimeout(callback, delay),
  clearTimer: (handle) => window.clearTimeout(handle),
  requestFrame: (callback) => window.setTimeout(callback, 16), cancelFrame: (handle) => window.clearTimeout(handle)
};

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function start(readers: Partial<RemoteEnrichmentReaders>, extras: Partial<Parameters<typeof startRemoteEnrichment<string>>[0]> = {}) {
  const batches: RemoteEnrichmentBatch<string>[] = [];
  const measures: RemoteEnrichmentMeasurement[] = [];
  const handle = startRemoteEnrichment<string>({
    owners: [], timing, readers: { inventory: async () => emptyInventory, lookup: async () => noRoute, read: async () => ({}), ...readers },
    prepare: (owner) => ({ outcome: 'read', prepared: owner.name }),
    apply: (batch) => { batches.push(batch); }, measure: (event) => { measures.push(event); }, ...extras
  });
  return { handle, batches, measures, results: () => batches.flatMap(({ results }) => results), discoveries: () => batches.flatMap(({ discoveries }) => discoveries) };
}

describe('HTTP route inventory and narrow transport', () => {
  it('posts exactly one unfiltered discovery request; quarantines cross-owner claims without losing names', async () => {
    const rows = [
      ad('Alpha', page), ad('A lpha (alt)', page, '%41lpha'), ad('Beta', page, 'ALPHA'),
      ad('Alpha', other), ad('ALPHA', other), { node: 'No route' },
      { node: 'Quarantine Me', name: 'Forged', address: `${other}/nodes/QuarantineMe/` },
      { node: 'Unsafe', address: `https://@remote.test/nodes/Unsafe` },
      { node: 'Traversal', address: `${other}/wrong/../nodes/Traversal/` },
      { node: 'Scoped', address: 'http://[fe80::1%25eth0]:8085/nodes/Scoped/' },
      { node: 'Mixed', address: 'http://remote.test/nodes/Mixed/' },
      { node: 'HostConflict', address: `${other}/nodes/HostConflict/`, host: 'different.test' },
      { name: 'Name field', address: `${other}/nodes/Namefield/` },
      { node: false, name: 'Never infer from alias' }
    ];
    for (const payload of [rows, [...rows].reverse()]) {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => String(input).endsWith('/REST/nodeURLs') ? json(payload) : json({}));
      const readers = createRemoteEnrichmentReaders(page, fetcher);
      const inventory = await readers.inventory(signal());
      expect(inventory).toMatchObject({ rows: rows.length, limited: 'malformed-rows' });
      expect(inventory.advertisements.map(({ owner }) => owner.key)).toEqual([
        'simple:alpha', 'simple:beta', 'simple:hostconflict', 'simple:mixed', 'simple:namefield', 'simple:noroute',
        'simple:quarantineme', 'simple:scoped', 'simple:traversal', 'simple:unsafe'
      ]);
      const found = inventory.advertisements[0]!;
      expect(found).toMatchObject({ hostEvidence: 'remote.test', issues: ['identity-conflict'], routes: [{ url: `${other}/nodes/ALPHA/REST/remote` }] });
      expect(inventory.advertisements[1]).toMatchObject({ routes: [], issues: ['identity-conflict'] });
      expect(inventory.advertisements[5]).toMatchObject({ routes: [], issues: [] });
      await expect(readers.inventory(signal())).rejects.toThrow('already requested');
      const selected = found.routes[0]!;
      await expect(readers.read(beta, selected, signal())).rejects.toThrow('not authorised');
      await expect(readers.read(alpha, { ...selected }, signal())).rejects.toThrow('not authorised');
      await expect(readers.read(alpha, selected, signal())).resolves.toEqual({});
      expect(fetcher.mock.calls).toEqual([
        [`${page}/REST/nodeURLs`, { method: 'POST', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', body: '{"filter":""}', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, signal: expect.any(AbortSignal) }],
        [selected.url, { method: 'GET', credentials: 'omit', mode: 'cors', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal) }]
      ]);
    }
  });

  it('reuses validated Java variants, quarantines alternate owners in exact replies, and never passes a wrong name as discovery', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input).endsWith('/REST/nodeURLs')) return json([ad('Alpha', page)]);
      return json([ad('Alpha', page, '%41lpha'), ad('Beta', other)]);
    });
    const readers = createRemoteEnrichmentReaders(page, fetcher);
    const { advertisements: [known] } = await readers.inventory(signal());
    expect(known!.routes).toHaveLength(1);
    const lookup = await readers.lookup(beta, signal());
    expect(lookup).toMatchObject({ advertised: true, routes: [{ url: `${other}/nodes/Beta/REST/remote` }] });
    expect(readers.allows?.(alpha, known!.routes[0]!)).toBe(false);
    expect(fetcher.mock.lastCall).toMatchObject([`${page}/REST/nodeURLsForNode`, { body: '{"name":"Beta"}' }]);
    await expect(readers.lookup({ ...beta, name: 'unsafe\u0000' }, signal())).rejects.toBeInstanceOf(Error);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('quarantines exact claims regardless of reply order (conflict first: %s)', async (conflictFirst) => {
    const a = deferred<Response>();
    const b = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => String(init?.body).includes('Alpha') ? a.promise : b.promise);
    const readers = createRemoteEnrichmentReaders(page, fetcher);
    const valid = readers.lookup(alpha, signal());
    const conflicting = readers.lookup(beta, signal());
    const replyAlpha = () => a.resolve(json([ad('Alpha', page), ad('Alpha', other)]));
    const replyBeta = () => b.resolve(json([ad('Beta', page, '%41lpha')]));
    if (conflictFirst) {
      replyBeta();
      await conflicting;
      replyAlpha();
    } else {
      replyAlpha();
      expect((await valid).routes.map(({ origin }) => origin)).toEqual([page, other]);
      replyBeta();
      await conflicting;
    }
    const result = await valid;
    expect(result.routes.filter((route) => readers.allows?.(alpha, route)).map(({ origin }) => origin)).toEqual([other]);
    if (conflictFirst) expect(result).toMatchObject({ issues: ['identity-conflict'], routes: [{ origin: other }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fails closed for existing and future routes when the pass-wide conflict capacity is exceeded', async () => {
    const rows = Array.from({ length: maxEnrichmentOwners }, (_, i) => ad('Beta', page, `Conflict${i}`));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith('/REST/nodeURLs') ? json([ad('Alpha')]) : json([]));
    const readers = createRemoteEnrichmentReaders(page, fetcher);
    const inventory = await readers.inventory(signal());
    const openRoute = inventory.advertisements[0]!.routes[0]!;

    fetcher.mockResolvedValueOnce(json(rows));
    await readers.lookup(beta, signal());
    expect(readers.allows?.(alpha, openRoute)).toBe(true);
    fetcher.mockResolvedValueOnce(json([rows[0], rows.at(-1)]));
    await readers.lookup(beta, signal());
    expect(readers.allows?.(alpha, openRoute)).toBe(true); // repeated keys cost no additional capacity

    const held = deferred<Response>();
    fetcher.mockReturnValueOnce(held.promise);
    const inFlight = readers.read(alpha, openRoute, signal());
    fetcher.mockResolvedValueOnce(json([ad('Beta', page, 'OneMoreConflict')]));
    await readers.lookup(beta, signal());
    expect(readers.allows?.(alpha, openRoute)).toBe(false);
    await expect(readers.read(alpha, openRoute, signal())).rejects.toThrow('not authorised');
    held.resolve(json({}));
    await expect(inFlight).rejects.toThrow('revoked');
    fetcher.mockResolvedValueOnce(json([ad('Alpha', other)]));
    await expect(readers.lookup(alpha, signal())).resolves.toMatchObject({
      advertised: true, limited: true, routes: [], issues: ['identity-conflict']
    });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it.each([
    [() => json(new Array<null>(maxEnrichmentOwners + 1).fill(null)), 'limited', 'rows'],
    [() => new Response('wrong', { headers: { 'Content-Length': String(maxEnrichmentResponseBytes + 1) } }), 'limited', 'bytes'],
    [() => new Response(' '.repeat(maxEnrichmentResponseBytes + 1)), 'limited', 'bytes'],
    [() => json({ wrong: 'shape' }), 'failed', 'invalid-data'],
    [() => new Response('denied', { status: 401 }), 'failed', 'transport']
  ] as const)('qualifies a limited/failed inventory, but still tries exact known references (%s)', async (reply, state, reason) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) => String(input).endsWith('/REST/nodeURLs') ? reply() : json([]));
    const run = start(createRemoteEnrichmentReaders(page, fetcher), { owners: [alpha] });
    await vi.runAllTimersAsync();
    expect(run.batches.at(-1)).toMatchObject({ finish: 'complete', inventory: { coverage: 'HTTP advertisements only', state, reason, local: 'unknown' } });
    expect(run.results()).toMatchObject([{ owner: alpha, reason: 'no-route' }]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`${page}/REST/nodeURLs`, `${page}/REST/nodeURLsForNode`]);
    expect(run.discoveries()).toEqual([]);
  });
});

describe('expanding initial inspection', () => {
  it('admits disconnected advertisements and expands past second hop, caching lookups and bound fallbacks', async () => {
    const more = ownerFromName('More');
    const leaf = ownerFromName('Leaf');
    const byName = new Map([
      ['Alpha', [beta, more, ownerFromName('A lpha (cycle)')]], ['Beta', [more, ownerFromName('unsafe\u0000')]],
      ['More', [leaf]], ['Leaf', [alpha]]
    ]);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === '/REST/nodeURLs') return json([ad('Alpha', page), ad('Alpha', other), ad('Alpha', 'https://unused.test'), ad('Isolated'), { node: 'Later' }]);
      if (path === '/REST/nodeURLsForNode') {
        const { name } = JSON.parse(String(init?.body)) as { name: string };
        return json([ad(name)]);
      }
      if (String(url) === `${page}/nodes/Alpha/REST/remote`) return json({ actions: { Bad: { node: 1 } } });
      if (path === '/nodes/Leaf/REST/remote') return json({ actions: { Incomplete: { node: 'Alpha' } } });
      return json({});
    });
    byName.set('Leaf', [alpha, ownerFromName('Later')]);
    const prepare = vi.fn((owner: typeof alpha, bindings: NodelRemoteBindings, collect: boolean) => ({
      outcome: bindings.actions ? 'partial' as const : 'read' as const, prepared: owner.name,
      ...(collect ? { followUpOwners: byName.get(owner.name) ?? [] } : {})
    }));
    const run = start(createRemoteEnrichmentReaders(page, fetcher), { owners: [alpha], prepare });
    await vi.runAllTimersAsync();
    expect(run.results().map(({ owner }) => owner.name).sort()).toEqual(['Alpha', 'Beta', 'Isolated', 'Later', 'Leaf', 'More']);
    expect(run.results().find(({ owner }) => owner.key === alpha.key)).toMatchObject({ outcome: 'read', attempts: ['invalid-data'] });
    expect(run.results().find(({ owner }) => owner.key === leaf.key)).toMatchObject({ outcome: 'partial' });
    const exact = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/REST/nodeURLsForNode')).map(([, init]) => init!.body);
    expect(exact).toEqual(['{"name":"Beta"}', '{"name":"More"}', '{"name":"Leaf"}', '{"name":"Later"}']);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('unused.test'))).toBe(false);
    expect(prepare.mock.calls.every(([, , collect]) => collect)).toBe(true);
    const seen = new Set<string>();
    for (const batch of run.batches) {
      for (const discovery of batch.discoveries) { expect(seen.has(discovery.owner.key)).toBe(false); seen.add(discovery.owner.key); }
      for (const result of batch.results) expect(seen.has(result.owner.key)).toBe(true);
    }
    expect(run.batches.at(-1)).toMatchObject({ finish: 'complete', counts: { total: 6, pending: 0, read: 5, partial: 1 } });
  });

  it('does not mislabel separate route-policy, no-route, failed exact, and invalid/failed bindings evidence', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/REST/nodeURLs') return json([{ node: 'Empty' }, ad('Mixed', 'http://remote.test'), ad('Denied'), ad('Broken')]);
      if (path === '/REST/nodeURLsForNode' || path === '/nodes/Denied/REST/remote') return new Response('denied', { status: 403 });
      return new Response('{broken');
    });
    const run = start(createRemoteEnrichmentReaders(page, fetcher), { owners: [ownerFromName('Lookup')] });
    await vi.runAllTimersAsync();
    expect(Object.fromEntries(run.results().map((result) => [result.owner.name, result]))).toMatchObject({
      Empty: { reason: 'no-route', lookupState: 'no-route' }, Mixed: { reason: 'policy-blocked', lookupState: 'blocked' },
      Lookup: { reason: 'lookup-transport', lookupState: 'failed' }, Denied: { reason: 'transport', lookupState: 'found' },
      Broken: { reason: 'invalid-data', lookupState: 'found' }
    });
    expect(run.batches.at(-1)?.counts).toMatchObject({ lookupFailed: 1, noRoute: 1, invalid: 1, unreachable: 1, unresolved: 1 });
  });

  it('keeps good bulk names and routes without publishing a definitive no-route result from dirty siblings', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith('/REST/nodeURLs')
      ? json([{ node: 'Alpha', address: null }, null, ad('Beta'), ad('Blocked', 'http://remote.test')]) : json({}));
    const run = start(createRemoteEnrichmentReaders(page, fetcher));
    await vi.runAllTimersAsync();
    expect(run.discoveries()).toMatchObject([
      { owner: alpha, lookupState: 'invalid' }, { owner: beta, lookupState: 'found' }, { owner: { name: 'Blocked' }, lookupState: 'blocked' }
    ]);
    expect(Object.fromEntries(run.results().map((result) => [result.owner.name, result]))).toMatchObject({
      Alpha: { lookupState: 'invalid', reason: 'lookup-limited' }, Beta: { outcome: 'read' },
      Blocked: { lookupState: 'blocked', reason: 'policy-blocked', issues: ['mixed-content'] }
    });
    expect(run.batches.at(-1)).toMatchObject({ finish: 'complete', inventory: { state: 'limited', reason: 'malformed-rows', discardedRows: 1 }, counts: { noRoute: 0 } });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`${page}/REST/nodeURLs`, `${other}/nodes/Beta/REST/remote`]);
  });

  it.each([
    [[{ node: 'Alpha', address: null }, null], 'invalid', 'lookup-limited'],
    [[{ node: 'Alpha', address: null }, { node: 'DifferentOwner' }], 'invalid', 'lookup-limited'],
    [[{ node: 'Alpha', address: null }], 'no-route', 'no-route'],
    [[ad('Alpha', 'http://remote.test')], 'blocked', 'policy-blocked']
  ] as const)('qualifies exact no-route evidence independently of the bulk response (%j)', async (exact, lookupState, reason) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith('/REST/nodeURLs') ? json([null]) : json(exact));
    const run = start(createRemoteEnrichmentReaders(page, fetcher), { owners: [alpha] });
    await vi.runAllTimersAsync();
    expect(run.discoveries()).toMatchObject([{ owner: alpha, lookupState }]);
    expect(run.results()).toMatchObject([{ owner: alpha, lookupState, reason }]);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`${page}/REST/nodeURLs`, `${page}/REST/nodeURLsForNode`]);
  });

  it('still inspects a positive route from an otherwise dirty exact response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/REST/nodeURLs') return json([]);
      if (path === '/REST/nodeURLsForNode') return json([null, ad('Alpha')]);
      return json({});
    });
    const run = start(createRemoteEnrichmentReaders(page, fetcher), { owners: [alpha] });
    await vi.runAllTimersAsync();
    expect(run.discoveries()).toMatchObject([{ owner: alpha, lookupState: 'found' }]);
    expect(run.results()).toMatchObject([{ owner: alpha, lookupState: 'found', outcome: 'read' }]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('reports high-water capacity and does not restart or evict earlier known owners', async () => {
    const known = Array.from({ length: maxEnrichmentOwners }, (_, i) => ({ ...noRoute, advertised: true, owner: ownerFromName(`Owner${i}`) }));
    const lookup = vi.fn(async () => noRoute);
    const run = start({ inventory: async () => ({ advertisements: known, rows: known.length, discardedRows: 0 }), lookup }, { owners: [alpha] });
    await vi.runAllTimersAsync();
    expect(run.batches.at(-1)).toMatchObject({ finish: 'complete', inventory: { state: 'limited', reason: 'capacity', omittedAdmissions: 1 }, counts: { total: maxEnrichmentOwners, pending: 0 } });
    expect(run.discoveries()).toHaveLength(maxEnrichmentOwners - 1);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(alpha, expect.any(AbortSignal));
  });
});

describe('dispatch limits, age fairness and lifetime', () => {
  it('finishes a 457-owner inventory progressively beyond 15 seconds while reserving every fourth eligible dispatch', async () => {
    const names = Array.from({ length: 457 }, (_, i) => `Node${String(i).padStart(3, '0')}`);
    const inventory = { advertisements: names.map((name, index) => ({ owner: ownerFromName(name), advertised: true, issues: [], routes: [route(name, `https://remote${index % 4}.test`)] })), rows: names.length, discardedRows: 0 };
    const lookup = vi.fn(async () => noRoute);
    const run = start({ inventory: async () => inventory, lookup, read: async () => ({}) }, { priority: ({ name }) => Number(name.slice(4)) >= 30 });
    await vi.advanceTimersByTimeAsync(15_500);
    expect(run.batches.some(({ finish }) => finish)).toBe(false);
    expect(run.batches.filter(({ results }) => results.length > 0).length).toBeGreaterThan(1);
    expect(run.discoveries()).toHaveLength(names.length);
    await vi.runAllTimersAsync();
    const starts = run.measures.filter(({ event }) => event === 'start');
    const reads = starts.slice(1);
    for (let i = 0; i < 30; i += 1) {
      expect(reads[i * 4 + 3]).toMatchObject({ dispatch: 'reserved', ownerId: ownerFromName(names[i]!).id });
    }
    const latestStart = starts.at(-1)!.at;
    expect(latestStart).toBeGreaterThanOrEqual((starts.length - 4) * 250);
    for (const [i, item] of starts.entries()) {
      expect(item.physical).toBeLessThanOrEqual(4);
      if (i >= 4) expect(item.at - starts[i - 4]!.at).toBeGreaterThanOrEqual(250);
    }
    expect(reads.at(-1)?.eligibleAgeMs).toBeGreaterThan(100_000);
    expect(lookup).not.toHaveBeenCalled();
    expect(run.batches.at(-1)).toMatchObject({ finish: 'complete', counts: { total: 457, pending: 0, read: 457 } });
    await run.handle.idle;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps physical work across timed-out bodies and a replacement generation', async () => {
    const limiter = createEnrichmentLimiter(timing);
    const names = ['Alpha', 'Beta', 'Gamma', 'Delta'];
    const gates = names.map(() => deferred<NodelRemoteBindings>());
    const read = vi.fn<RemoteEnrichmentReaders['read']>((owner) => gates[names.indexOf(owner.name)]!.promise);
    const old = start({
      inventory: async () => ({ advertisements: names.map((name) => ({ owner: ownerFromName(name), advertised: true, issues: [], routes: [route(name)] })), rows: names.length, discardedRows: 0 }), read
    }, { limiter });
    await vi.advanceTimersByTimeAsync(251);
    expect(read).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(3_020);
    expect(read.mock.calls.every(([, , signal]) => signal.aborted)).toBe(true);
    expect(old.results()).toHaveLength(4);
    expect(old.batches.at(-1)?.finish).toBeUndefined();
    old.handle.cancel();
    const inventory = vi.fn(async () => emptyInventory);
    const replacement = start({ inventory }, { limiter });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(inventory).not.toHaveBeenCalled();
    gates[0]!.resolve({ actions: { Late: { node: 'Never', action: 'Run' } } });
    await vi.advanceTimersByTimeAsync(50);
    expect(inventory).toHaveBeenCalledTimes(1);
    for (const gate of gates) gate.resolve({});
    await vi.runAllTimersAsync();
    await Promise.all([old.handle.idle, replacement.handle.idle]);
    expect(old.results()).toHaveLength(4);
    expect(replacement.batches.at(-1)?.finish).toBe('complete');
  });

  it('caps a busy remote origin at two when another origin has ready owners', async () => {
    const gate = deferred<NodelRemoteBindings>();
    const names = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2'];
    const read = vi.fn<RemoteEnrichmentReaders['read']>(() => gate.promise);
    const run = start({
      inventory: async () => ({ advertisements: names.map((name) => ({ owner: ownerFromName(name), advertised: true, issues: [], routes: [route(name, name.startsWith('A') ? other : page)] })), rows: names.length, discardedRows: 0 }), read
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(read.mock.calls.map(([owner]) => owner.name)).toEqual(['A1', 'A2', 'B1', 'B2']);
    gate.resolve({});
    await vi.runAllTimersAsync();
    expect(run.results()).toHaveLength(6);
  });

  it.each([true, false])('applies both priority lanes while a sole busy origin can fill spare slots (normal first: %s)', async (normalFirst) => {
    const limiter = createEnrichmentLimiter(timing);
    const gate = deferred<NodelRemoteBindings>();
    const priorities = ['Priority1', 'Priority2', 'Priority3', 'Priority4'];
    const normals = ['NormalOld', 'NormalNew'];
    const names = normalFirst ? [...normals, ...priorities] : [...priorities, ...normals];
    const read = vi.fn<RemoteEnrichmentReaders['read']>(() => gate.promise);
    const run = start({
      inventory: async () => ({ advertisements: names.map((name) => ({ owner: ownerFromName(name), advertised: true, issues: [], routes: [route(name)] })), rows: names.length, discardedRows: 0 }), read
    }, { limiter, priority: ({ name }) => name.startsWith('Priority') });

    await vi.advanceTimersByTimeAsync(100);
    expect(limiter.remoteActive(other)).toBe(3);
    expect(read.mock.calls.map(([owner]) => owner.name)).toEqual(priorities.slice(0, 3));
    await vi.advanceTimersByTimeAsync(200);
    expect(limiter.remoteActive(other)).toBe(4);
    expect(read.mock.calls.map(([owner]) => owner.name)).toEqual([...priorities.slice(0, 3), normals[0]]);
    expect(run.measures.filter(({ event, operation }) => event === 'start' && operation === 'remote-read').at(-1))
      .toMatchObject({ dispatch: 'reserved', ownerId: ownerFromName(normals[0]!).id, physical: 4 });

    gate.resolve({});
    await vi.runAllTimersAsync();
    expect(run.batches.at(-1)).toMatchObject({ finish: 'complete', counts: { pending: 0, read: 6 } });
  });

  it('publishes and tallies a successful authorized alternate when the first route is revoked in flight', async () => {
    const primary = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/REST/nodeURLs') return json([ad('Alpha', page), ad('Alpha', other)]);
      if (path === '/REST/nodeURLsForNode') return json([ad('Alpha', page, '%41lpha'), ad('Beta', other)]);
      if (String(url) === `${page}/nodes/Alpha/REST/remote`) return primary.promise;
      if (path === '/nodes/Alpha/REST/remote') return json({ actions: { Alternate: { node: 'Beta', action: 'Run' } } });
      return json({});
    });
    const graph = buildLocalGraph({ locals: [] });
    const batches: RemoteEnrichmentBatch<LocalGraph>[] = [];
    const scheduler = startRemoteEnrichment({
      owners: [alpha, beta], localSnapshot: { owners: [] }, timing, readers: createRemoteEnrichmentReaders(page, fetcher),
      prepare: (owner, bindings) => prepareRemoteOwnerInspection(owner, bindings, graph.nodes),
      apply: (batch) => {
        for (const discovery of batch.discoveries) applyRemoteDiscovery(graph, discovery);
        for (const result of batch.results) applyRemoteEnrichmentResult(graph, result);
        batches.push(batch);
      }
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(fetcher.mock.calls.map(([url]) => url)).toContain(`${page}/nodes/Alpha/REST/remote`);
    expect(fetcher.mock.calls.map(([url]) => url)).not.toContain(`${other}/nodes/Alpha/REST/remote`);
    primary.resolve(json({ actions: { RevokedReply: { node: 'Never', action: 'Run' } } }));
    await vi.runAllTimersAsync();
    await scheduler.idle;

    expect(batches.flatMap(({ results }) => results).find(({ owner }) => owner.key === alpha.key)).toMatchObject({
      lookupState: 'found', outcome: 'read', issues: ['identity-conflict'], attempts: []
    });
    expect(batches.at(-1)).toMatchObject({ finish: 'complete', counts: { total: 2, pending: 0, read: 2, unresolved: 0 } });
    const projection = projectLocalGraph(graph);
    expect(projection.nodes.find(({ name }) => name === 'Alpha')).toMatchObject({ displayStatus: '', ports: [{ label: 'Alternate' }] });
    expect(projection.nodes.some(({ name }) => name === 'Never')).toBe(false);
    expect(localTopologyProgressSummary(graph, batches.at(-1)!)).toBe('2 nodes · 2 complete · 0 partial · 0 queued · 0 terminal not inspected · inventory coverage complete · scheduler settled');
    expect(localTopologyProgressSummary(graph, batches.at(-1)!)).toContain('0 terminal not inspected');
    expect(localTopologyProgressSummary(graph, batches.at(-1)!)).toContain('scheduler settled');
  });

  it('rechecks authority when consuming a successful reader promise', async () => {
    let revoked = false;
    const read = vi.fn<RemoteEnrichmentReaders['read']>(async (_owner, route) => {
      if (route.url === 'primary') queueMicrotask(() => { revoked = true; });
      return {};
    });
    const run = start({
      lookup: async () => ({ advertised: true, issues: [], routes: [route('primary'), route('alternate')] }),
      allows: (_owner, route) => route.url !== 'primary' || !revoked,
      read
    }, { owners: [alpha] });
    await vi.runAllTimersAsync();
    expect(read.mock.calls.map(([, route]) => route.url)).toEqual(['primary', 'alternate']);
    expect(run.results()).toMatchObject([{ outcome: 'read', lookupState: 'found', issues: ['identity-conflict'] }]);
  });

  it('keeps owner fallback serial: a body timeout does not free its slot or overlap that owner', async () => {
    const gate = deferred<NodelRemoteBindings>();
    const read = vi.fn<RemoteEnrichmentReaders['read']>((_owner, route) => route.url === 'first' ? gate.promise : Promise.resolve({}));
    const run = start({ lookup: async () => ({ advertised: true, issues: [], routes: [route('first'), route('fallback', page), route('never')] }), read }, { owners: [alpha] });
    await vi.advanceTimersByTimeAsync(3_500);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[2].aborted).toBe(true);
    expect(run.results()).toEqual([]);
    gate.resolve({});
    await vi.runAllTimersAsync();
    expect(read.mock.calls.map(([, route]) => route.url)).toEqual(['first', 'fallback']);
    expect(run.results()).toMatchObject([{ owner: alpha, outcome: 'read', attempts: ['timeout'] }]);
  });

  it('pauses accepted publication, resumes pending GETs, and discards pre-pause late body results', async () => {
    const gate = deferred<NodelRemoteBindings>();
    const lookup = vi.fn(async () => ({ advertised: true, issues: [], routes: [route('first')] }));
    const read = vi.fn<RemoteEnrichmentReaders['read']>().mockReturnValueOnce(gate.promise).mockResolvedValueOnce({});
    const run = start({ lookup, read }, { owners: [alpha] });
    await vi.advanceTimersByTimeAsync(12);
    expect(read).toHaveBeenCalledTimes(1);
    run.handle.freeze();
    expect(run.batches.at(-1)).toMatchObject({ paused: true, discoveries: [{ owner: alpha }], results: [] });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[2].aborted).toBe(true);
    run.handle.resume();
    gate.resolve({ events: { Late: { node: 'Never', event: 'Run' } } });
    await vi.runAllTimersAsync();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(run.results()).toMatchObject([{ outcome: 'read' }]);
    expect(run.batches.at(-1)).toMatchObject({ paused: false, finish: 'complete' });
  });

  it('never retries interrupted inventory or publishes its late answer', async () => {
    const gate = deferred<RemoteInventory>();
    const inventory = vi.fn(() => gate.promise);
    const run = start({ inventory });
    await vi.advanceTimersByTimeAsync(0);
    run.handle.freeze();
    expect(run.batches.at(-1)).toMatchObject({ paused: true, inventory: { state: 'failed', reason: 'interrupted' } });
    run.handle.resume();
    gate.resolve({ advertisements: [{ owner: alpha, ...noRoute, advertised: true }], rows: 1, discardedRows: 0 });
    await vi.runAllTimersAsync();
    expect(inventory).toHaveBeenCalledTimes(1);
    expect(run.discoveries()).toEqual([]);
    expect(run.batches.at(-1)).toMatchObject({ finish: 'complete', inventory: { state: 'failed' } });
  });

  it('revokes unpainted accepted results and cancels scheduled work', async () => {
    const source = new AbortController();
    const prepare = vi.fn((owner: typeof alpha) => ({ outcome: 'read' as const, prepared: owner.name }));
    const run = start({ lookup: async () => ({ advertised: true, issues: [], routes: [route('alpha')] }) }, { owners: [alpha], signal: source.signal, prepare });
    await vi.advanceTimersByTimeAsync(12);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(run.batches).toEqual([]);
    source.abort();
    await vi.runAllTimersAsync();
    await run.handle.idle;
    expect(run.batches).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares starts with Stage A, resumes only unattempted verified local paths, and keeps role credentials separate', async () => {
    const limiter = createEnrichmentLimiter(timing);
    const names = Array.from({ length: 45 }, (_, i) => `Local${i}`);
    const starts: Array<[number, string, RequestCredentials | undefined]> = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const path = new URL(String(url), location.origin).pathname;
      starts.push([performance.now(), path, init?.credentials]);
      if (path === '/REST') return json({ nodes: { Peer: null, ...Object.fromEntries(names.map((name) => [name, {}])) } });
      if (path === '/REST/nodeURLs') return json([ad('Local7', location.origin), ad('Peer', location.origin)]);
      return json({});
    });
    vi.stubGlobal('fetch', fetcher);
    const pending = loadLocalSnapshot(undefined, { limiter });
    await vi.advanceTimersByTimeAsync(10_000);
    const snapshot = await pending;
    expect(snapshot.inventory).toEqual({ state: 'limited', discardedRows: 1 });
    const unfinished = snapshot.owners.filter((owner) => owner.status === 'unread' && owner.reason === 'unfinished');
    expect(unfinished.length).toBeGreaterThan(0);
    expect(starts.map(([, path]) => path)).not.toContain('/REST/nodeURLs');
    const run = start(createRemoteEnrichmentReaders(location.origin, fetcher), { limiter, localSnapshot: snapshot });
    await vi.runAllTimersAsync();
    expect(run.results().filter((result) => result.outcome !== 'cutoff' && result.source === 'local')).toHaveLength(unfinished.length);
    expect(run.batches.at(-1)).toMatchObject({ finish: 'complete', inventory: { local: 'limited' } });
    expect(starts).toContainEqual([expect.any(Number), '/nodes/Peer/REST/remote', 'omit']);
    expect(starts.filter(([, path]) => path.includes('/nodes/Local'))).toHaveLength(names.length);
    expect(starts.filter(([, path]) => path.includes('/nodes/Local')).every(([, , credentials]) => credentials === 'same-origin')).toBe(true);
    expect(starts.at(-1)![0]).toBeGreaterThanOrEqual((starts.length - 4) * 250);
  });

  it('does not release Stage A physical stream leases at timeout or first paint', async () => {
    const limiter = createEnrichmentLimiter(timing);
    const gates = Array.from({ length: 4 }, () => deferred<void>());
    const startSignals: AbortSignal[] = [];
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      const path = new URL(String(url), location.origin).pathname;
      if (path === '/REST') return json({ nodes: { A: {}, B: {}, C: {}, D: {}, E: {}, F: {} } });
      if (path === '/REST/nodeURLs') return json([]);
      const gate = gates[startSignals.length];
      if (!gate) return json({});
      startSignals.push(init!.signal!);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          void gate.promise.then(() => {
            controller.enqueue(new TextEncoder().encode('{}'));
            controller.close();
          });
        }
      }));
    });
    vi.stubGlobal('fetch', fetcher);
    const pending = loadLocalSnapshot(undefined, { limiter });
    await vi.advanceTimersByTimeAsync(10_000);
    const localSnapshot = await pending;
    expect(startSignals).toHaveLength(4);
    expect(startSignals.every((signal) => signal.aborted)).toBe(true);
    expect(localSnapshot.owners.map((owner) => owner.status === 'unread' && owner.reason)).toEqual([
      'timed-out', 'timed-out', 'timed-out', 'timed-out', 'unfinished', 'unfinished'
    ]);
    const run = start(createRemoteEnrichmentReaders(location.origin, fetcher), { limiter, localSnapshot });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetcher).toHaveBeenCalledTimes(5);
    gates[0]!.resolve();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetcher.mock.calls[5]?.[0]).toBe(`${location.origin}/REST/nodeURLs`);
    for (const gate of gates) gate.resolve();
    await vi.runAllTimersAsync();
    expect(run.results().map(({ owner }) => owner.name)).toEqual(['E', 'F']);
  });
});
