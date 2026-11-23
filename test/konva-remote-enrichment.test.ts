import { describe, expect, it, vi } from 'vitest';
import { decodeNodeUrls } from '../src/api/codecs/nodel-codecs';
import type { NodelRemoteBindings } from '../src/api/nodel-types';
import { createEnrichmentLifetime } from '../src/experiments/konva-canvas/enrichment-lifetime';
import { applyRemoteEnrichmentResult, buildLocalGraph, prepareRemoteOwnerInspection, type LocalGraph } from '../src/experiments/konva-canvas/local-graph';
import {
  createRemoteEnrichmentReaders, startRemoteEnrichment,
  type RemoteEnrichmentBatch, type RemoteEnrichmentOwner, type RemoteEnrichmentReaders, type RemoteEnrichmentTiming
} from '../src/experiments/konva-canvas/remote-enrichment';

const owner = (name: string, key = name.toLowerCase()): RemoteEnrichmentOwner => ({ id: `id:${key}`, key: `simple:${key}`, name });
const alpha = owner('Alpha');
const page = 'https://serving.test';
const other = 'https://remote.test';
const bindingUrl = (origin: string, name = 'Alpha') => `${origin}/nodes/${name}/REST/remote`;
const json = (value: unknown) => new Response(JSON.stringify(value));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function clock() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { callback: () => void; due: number }>();
  const frames = new Map<number, () => void>();
  const timing: RemoteEnrichmentTiming = {
    now: () => now,
    setTimer(callback, delay) { timers.set(++next, { callback, due: now + delay }); return next; },
    clearTimer(handle) { timers.delete(handle); },
    requestFrame(callback) { frames.set(++next, callback); return next; },
    cancelFrame(handle) { frames.delete(handle); }
  };
  return {
    timing, timers, frames,
    jump(time: number) { now = time; },
    advance(time: number) {
      while (true) {
        const entry = [...timers].filter(([, timer]) => timer.due <= time).sort((a, b) => a[1].due - b[1].due)[0];
        if (!entry) break;
        timers.delete(entry[0]);
        now = entry[1].due;
        entry[1].callback();
      }
      now = time;
    },
    paint() {
      for (const [handle, callback] of [...frames]) { frames.delete(handle); callback(); }
    }
  };
}

async function drainMicrotasks() {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

function tracked(readers: RemoteEnrichmentReaders, names: RemoteEnrichmentOwner[], scheduler = clock(), signal?: AbortSignal) {
  const batches: RemoteEnrichmentBatch<string>[] = [];
  const prepare = vi.fn((item: RemoteEnrichmentOwner, bindings: NodelRemoteBindings, _collectFollowUps: boolean) => ({
    outcome: bindings.events?.incomplete ? 'partial' as const : 'read' as const,
    prepared: item.name
  }));
  const handle = startRemoteEnrichment({
    owners: names, timing: scheduler.timing, readers, prepare,
    ...(signal ? { signal } : {}), apply: (batch) => batches.push(batch)
  });
  return { handle, batches, prepare };
}

describe('remote enrichment transport — no host operations', () => {
  it('publishes only an unambiguous distinct URL.host from validated lookup advertisements', async () => {
    const readHost = async (addresses: string[]) => {
      const fetcher = vi.fn(async () => json(addresses.map((address) => ({ node: 'Alpha', address }))));
      return createRemoteEnrichmentReaders('http://serving.test', fetcher).lookup(alpha, new AbortController().signal);
    };
    const sameHost = await readHost(['http://remote.test/nodes/Alpha/', 'https://remote.test/nodes/Alpha/']);
    expect(sameHost.hostEvidence).toBe('remote.test');
    const aliases = await readHost(['http://remote.test/nodes/Alpha/', 'http://alias.test/nodes/Alpha/']);
    expect(aliases).not.toHaveProperty('hostEvidence');
    const currentHost = await readHost(['http://serving.test/nodes/Alpha/']);
    expect(currentHost).not.toHaveProperty('hostEvidence');
    expect(sameHost.hostEvidence).toBe('remote.test');
    expect(sameHost.hostEvidence).not.toContain('/');
  });

  it('uses one exact POST per frozen key and prefers anonymous same-origin reads over HTTPS then HTTP', async () => {
    const origin = 'http://serving.test';
    const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
      if (String(url) === `${origin}/REST/nodeURLsForNode`) {
        return json([
          { node: 'Alpha', name: 'A lpha (comment)', address: 'http://alternate.test/nodes/Alpha/' },
          { name: 'Alpha', address: `${other}/nodes/Alpha/` },
          { node: 'Alpha', address: `${origin}/nodes/Alpha` },
          { node: 'Alpha', address: 'http://SERVING.test:80/nodes/Alpha/' },
          { node: 'Alpha', address: 'https://zzz.test/nodes/Alpha/' }
        ]);
      }
      if (String(url) === bindingUrl(origin)) return new Response('denied', { status: 401 });
      return json({ actions: { Accepted: { node: 'Gamma', action: 'Run' } } });
    });
    const run = tracked(createRemoteEnrichmentReaders(origin, fetcher), [alpha, owner('A lpha', 'alpha'), owner('!!!', '')]);
    await run.handle.idle;
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`${origin}/REST/nodeURLsForNode`, bindingUrl(origin), bindingUrl(other)]);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
      body: '{"name":"Alpha"}'
    });
    for (const [, init] of fetcher.mock.calls.slice(1)) {
      expect(init).toEqual({
        method: 'GET', credentials: 'omit', mode: 'cors', redirect: 'error', referrerPolicy: 'no-referrer',
        cache: 'no-store', headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal)
      });
    }
    expect(run.batches[0]).toMatchObject({ finish: 'complete', results: [{ outcome: 'read', attempts: ['transport'] }] });
  });

  it('blocks original-path aliases that the shared decoder normalizes, including traversal and empty userinfo', async () => {
    const raw = [
      'https://remote.test/wrong/../nodes/Alpha/',
      'https://remote.test/nodes/erased/%2e%2e/Alpha/',
      'https://@remote.test/nodes/Alpha/',
      'https://remote.test/nodes/Alpha/?',
      'https://remote.test/nodes/Alpha/#',
      'https://remote.test/nodes/Alpha%2fREST/',
      'https://remote.test/nodes/%2541lpha/',
      'https://remote.test/nodes/Alpha%zz/',
      'https://remote.test/nodes/Alpha/REST/',
      'http://[fe80::1%25eth0]:8085/nodes/Alpha/'
    ].map((address) => ({ node: 'Alpha', address }));
    expect(decodeNodeUrls(raw.slice(0, 3), 'fixture').map((row) => row.address)).toEqual(Array(3).fill(`${other}/nodes/Alpha/`));
    const fetcher = vi.fn(async () => json(raw));
    const run = tracked(createRemoteEnrichmentReaders(page, fetcher), [alpha]);
    await run.handle.idle;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(run.batches[0]?.results[0]).toMatchObject({ outcome: 'unsuccessful', reason: 'policy-blocked', issues: ['unsafe-route'] });
  });

  it.each([
    ['%41lpha', { node: 'Alpha', name: 'Beta' }],
    ['ALPHA', { node: 'Beta' }],
    ['%C3%81lpha', { node: 'Beta' }]
  ] as const)('quarantines a contradictory Java-equivalent %s path on the same origin only', async (equivalentPath, claim) => {
    const ads = [
      { node: 'Alpha', address: `${page}/nodes/Alpha/` },
      { ...claim, address: `${page}/nodes/${equivalentPath}` },
      { node: 'Alpha', address: 'https://wrong.test/nodes/Beta/' },
      { node: 'Álpha (kiosk)', name: 'A lpha', address: `${other}/nodes/%C3%81lpha/` },
      { node: 'Alpha', address: 'http://mixed.test/nodes/Alpha/' },
      { node: false, address: 'https://bad.test/nodes/Alpha/' }
    ];
    for (const entries of [ads, [...ads].reverse()]) {
      const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes('/REST/nodeURLsForNode') ? json(entries) : json({}));
      const run = tracked(createRemoteEnrichmentReaders(page, fetcher), [alpha]);
      await run.handle.idle;
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`${page}/REST/nodeURLsForNode`, bindingUrl(other, '%C3%81lpha')]);
      expect(run.batches[0]?.results[0]).toMatchObject({ outcome: 'read', lookupState: 'found', issues: ['identity-conflict', 'mixed-content'] });
    }
  });

  it('deduplicates agreeing Java-equivalent paths without collapsing the independent alternate origin', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/REST/nodeURLsForNode')) return json([
        { node: 'ALPHA', address: `${page}/nodes/ALPHA/` },
        { node: 'Alpha', address: `${page}/nodes/Alpha/` },
        { node: 'Alpha', address: `${other}/nodes/Alpha/` }
      ]);
      if (String(url).startsWith(page)) return new Response(null, { status: 401 });
      return json({});
    });
    const run = tracked(createRemoteEnrichmentReaders(page, fetcher), [alpha]);
    await run.handle.idle;
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`${page}/REST/nodeURLsForNode`, bindingUrl(page, 'ALPHA'), bindingUrl(other)]);
    expect(run.batches[0]?.results[0]).toMatchObject({ outcome: 'read', lookupState: 'found', issues: [], attempts: ['transport'] });
  });

  it('separates empty discovery, mixed content, invalid discovery, and blocked lookup statuses', async () => {
    const fixtures = [
      [json([]), 'no-route', 'no-route'],
      [json([{ node: 'Alpha', address: 'http://remote.test/nodes/Alpha/' }]), 'policy-blocked', 'blocked'],
      [json([{ node: 'Alpha', address: 'https://user:secret@remote.test/nodes/Alpha/' }]), 'lookup-invalid-data', 'invalid'],
      [json({ wrong: 'shape' }), 'lookup-invalid-data', 'invalid'],
      [new Response('blocked', { status: 403 }), 'lookup-transport', 'failed'],
      [new Response(null, { status: 302, headers: { Location: 'https://elsewhere.test/' } }), 'lookup-transport', 'failed']
    ] as const;
    for (const [response, reason, lookupState] of fixtures) {
      const fetcher = vi.fn(async () => response);
      const run = tracked(createRemoteEnrichmentReaders(page, fetcher), [alpha]);
      await run.handle.idle;
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(run.batches[0]?.results[0]).toMatchObject({ outcome: 'unsuccessful', reason, lookupState });
    }
  });

  it('applies no rows from a rejected whole binding response, tries at most two distinct routes, and passes only the decoded fallback to prepare', async () => {
    const good = { events: { incomplete: { node: 'Gamma' } } };
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === `${page}/REST/nodeURLsForNode`) return json([
        { node: 'Alpha', address: `${other}/nodes/Alpha/` },
        { node: 'Alpha', address: `${page}/nodes/Alpha/` },
        { node: 'Alpha', address: 'https://zzz.test/nodes/Alpha/' }
      ]);
      if (String(url) === bindingUrl(page)) return json({ actions: { LooksGood: { node: 'Other', action: 'Run' }, Bad: { node: 1 } } });
      return json(good);
    });
    const readers = createRemoteEnrichmentReaders(page, fetcher);
    await expect(readers.read(bindingUrl(other), new AbortController().signal)).rejects.toThrow('not authorised');
    const run = tracked(readers, [alpha]);
    await run.handle.idle;
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(run.prepare.mock.calls).toEqual([[alpha, good, false]]);
    expect(run.batches[0]?.results[0]).toMatchObject({ outcome: 'partial', attempts: ['invalid-data'] });
  });

  it('does not confuse opaque, redirects, denied status, or broken JSON with an empty decoded config', async () => {
    const cases: Array<[() => Response | never, string]> = [
      [() => new Response('{broken json'), 'invalid-data'],
      [() => new Response(null, { status: 204 }), 'invalid-data'],
      [() => new Response('denied', { status: 401 }), 'transport'],
      [() => new Response(null, { status: 302 }), 'transport'],
      [() => Object.defineProperty(json({}), 'type', { value: 'opaque' }), 'transport'],
      [() => Object.defineProperty(json({}), 'redirected', { value: true }), 'transport'],
      [() => { throw new TypeError('CORS'); }, 'transport']
    ];
    for (const [response, reason] of cases) {
      const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/REST/nodeURLsForNode')
        ? json([{ node: 'Alpha', address: `${other}/nodes/Alpha/` }]) : response());
      const run = tracked(createRemoteEnrichmentReaders(page, fetcher), [alpha]);
      await run.handle.idle;
      expect(run.prepare).not.toHaveBeenCalled();
      expect(run.batches[0]?.results[0]).toMatchObject({ outcome: 'unsuccessful', reason, attempts: [reason] });
    }
  });
});

describe('remote enrichment physical slots and generation settlement', () => {
  it.each(['cutoff', 'freeze', 'revoke'] as const)('settles both waves at %s without late model mutation or a stale draw', async (stop) => {
    const time = clock();
    const source = new AbortController();
    const graph = buildLocalGraph({ locals: [{ name: 'Local', readState: 'read', actions: [{ alias: 'Call', node: 'Alpha', endpoint: 'Go' }] }] });
    const gate = deferred<NodelRemoteBindings>();
    const lookup = vi.fn(async ({ name }: RemoteEnrichmentOwner) => ({ routes: [name] }));
    const read = vi.fn((route: string, _signal: AbortSignal) => route === 'Alpha'
      ? Promise.resolve({ actions: { next: { node: 'Beta', action: 'Run' } } }) : gate.promise);
    const prepare = vi.fn((owner: RemoteEnrichmentOwner, bindings: NodelRemoteBindings, collect: boolean) =>
      prepareRemoteOwnerInspection(owner, bindings, collect ? graph.nodes : undefined));
    const batches: RemoteEnrichmentBatch<LocalGraph>[] = [];
    time.jump(13_000); // Startup already spent part of the original paint budget.
    const handle = startRemoteEnrichment({ depth: 2, owners: graph.eligibleRemoteOwners, deadline: 15_000,
      signal: source.signal, timing: time.timing, readers: { lookup, read }, prepare,
      apply(batch) {
        batches.push(batch);
        for (const result of batch.results) applyRemoteEnrichmentResult(graph, result);
      }
    });
    await drainMicrotasks();
    expect(lookup.mock.calls.map(([item]) => item.name)).toEqual(['Alpha', 'Beta']);
    expect(read.mock.calls.map(([route]) => route)).toEqual(['Alpha', 'Beta']);
    expect(batches).toEqual([]);
    const saved = [...time.frames.values()][0]!;
    expect(saved).toBeTypeOf('function');
    if (stop === 'cutoff') time.advance(15_000);
    else if (stop === 'freeze') handle.freeze();
    else source.abort();

    expect(read.mock.lastCall?.[1].aborted).toBe(true);
    if (stop === 'revoke') {
      expect(batches).toEqual([]);
      expect(graph.connections.size).toBe(1);
    } else {
      expect(batches).toMatchObject([{ finish: stop, counts: { total: 2, read: 1, partial: 0, unsuccessful: 0, cutoff: 1 },
        results: [{ owner: { name: 'Alpha' }, outcome: 'read' }, { owner: { name: 'Beta' }, lookupState: 'found', outcome: 'cutoff' }] }]);
      expect([...graph.nodes.values()].find(({ name }) => name === 'Beta')?.inspectionState).toBe('cutoff');
      expect(graph.connections.size).toBe(2);
    }
    saved();
    gate.resolve({ actions: { late: { node: 'MustNotAppear', action: 'Run' } } });
    await handle.idle;
    handle.freeze();
    expect(batches).toHaveLength(stop === 'revoke' ? 0 : 1);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect([...graph.nodes.values()].some(({ name }) => name === 'MustNotAppear')).toBe(false);
    expect(time.timers.size + time.frames.size).toBe(0);
  });

  it('admits known follow-ups before a freeze while the first wave is unsettled, without starting their lookup', async () => {
    const time = clock();
    const gate = deferred<NodelRemoteBindings>();
    const lookup = vi.fn(async ({ name }: RemoteEnrichmentOwner) => ({ routes: [name] }));
    const batches: RemoteEnrichmentBatch<string>[] = [];
    const handle = startRemoteEnrichment({ depth: 2, owners: [alpha, owner('Beta')], timing: time.timing,
      readers: { lookup, read: (route) => route === 'Alpha' ? Promise.resolve({}) : gate.promise },
      prepare: ({ name }) => ({ outcome: 'read', prepared: name, followUpOwners: [owner('Gamma')] }), apply: (batch) => batches.push(batch)
    });
    await drainMicrotasks();
    expect(lookup.mock.calls.map(([item]) => item.name)).toEqual(['Alpha', 'Beta']);
    handle.freeze();
    expect(batches).toMatchObject([{ finish: 'freeze', counts: { total: 3, read: 1, cutoff: 2 }, results: [
      { owner: alpha, outcome: 'read' }, { owner: owner('Beta'), outcome: 'cutoff' }, { owner: owner('Gamma'), lookupState: 'pending', outcome: 'cutoff' }
    ] }]);
    gate.resolve({});
    await handle.idle;
    expect(batches).toHaveLength(1);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('gives the second wave only the physical slots freed by abort-insensitive first-wave reads', async () => {
    const time = clock();
    const firstWave = [alpha, owner('Beta'), owner('Gamma'), owner('Delta')];
    const secondWave = [owner('Echo'), owner('Foxtrot'), owner('Golf'), owner('Hotel')];
    const gates = firstWave.slice(1).map(() => deferred<NodelRemoteBindings>());
    const held = deferred<NodelRemoteBindings>();
    const lookup = vi.fn(async ({ name }: RemoteEnrichmentOwner) => ({ routes: [name] }));
    const read = vi.fn((route: string, _signal: AbortSignal) => {
      const index = firstWave.findIndex(({ name }) => name === route);
      if (index === 0) return Promise.resolve({});
      return index > 0 ? gates[index - 1]!.promise : held.promise;
    });
    const batches: RemoteEnrichmentBatch<string>[] = [];
    const handle = startRemoteEnrichment({ depth: 2, owners: firstWave, timing: time.timing, readers: { lookup, read },
      prepare: ({ name }, _bindings, collectFollowUps) => ({ outcome: 'read', prepared: name, ...(collectFollowUps ? { followUpOwners: secondWave } : {}) }),
      apply: (batch) => batches.push(batch)
    });
    await drainMicrotasks();
    expect(lookup).toHaveBeenCalledTimes(4);
    time.advance(3_000);
    await drainMicrotasks();
    expect(read.mock.calls.slice(1, 4).every(([, signal]) => signal.aborted)).toBe(true);
    expect(lookup.mock.calls.slice(4).map(([item]) => item.name)).toEqual(['Echo']);
    gates[0]!.resolve({});
    await drainMicrotasks();
    expect(lookup.mock.calls.slice(4).map(([item]) => item.name)).toEqual(['Echo', 'Foxtrot']);
    expect(read.mock.calls.slice(4).map(([route]) => route)).toEqual(['Echo', 'Foxtrot']);
    for (const gate of gates) gate.resolve({});
    held.resolve({});
    await handle.idle;
    expect(batches).toMatchObject([{ finish: 'complete', counts: { total: 8, read: 5, unsuccessful: 3, cutoff: 0 } }]);
  });

  it.each([15_010, 15_011])('seals a startup at t=%d from the first paint with zero network operations', async (startup) => {
    const time = clock();
    const lifetime = createEnrichmentLifetime({ request: time.timing.requestFrame, cancel: time.timing.cancelFrame }, time.timing.now);
    const lookup = vi.fn(async () => ({ routes: ['eligible'] }));
    const read = vi.fn(async () => ({}));
    const prepare = vi.fn(() => ({ outcome: 'read' as const, prepared: null }));
    const apply = vi.fn(() => lifetime.finish());
    const names = [alpha, owner('Beta')];
    lifetime.sized();
    let launch: ((startupTime: number) => ReturnType<typeof startRemoteEnrichment>) | undefined;
    lifetime.afterPaint((deadline) => {
      launch = (startupTime) => {
        time.jump(startupTime); // Delayed module load and projector creation.
        const handle = startRemoteEnrichment({ owners: names, deadline, signal: lifetime.signal, timing: time.timing, readers: { lookup, read }, prepare, apply });
        lifetime.attach(handle);
        return handle;
      };
    });
    time.jump(9);
    time.paint();
    expect(launch).toBeUndefined();
    time.jump(10);
    time.paint();
    const handle = launch!(startup);
    expect(apply).toHaveBeenCalledTimes(1); // Synchronous final settlement, no timer or paint waits.
    expect(apply.mock.lastCall).toEqual([{
      finish: 'cutoff', counts: { total: 2, cutoff: 2, partial: 0, read: 0, unsuccessful: 0 },
      results: names.map((item) => ({ owner: item, lookupState: 'pending', issues: [], attempts: [], outcome: 'cutoff' }))
    }]);
    expect(lookup).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(time.timers.size + time.frames.size).toBe(0);
    expect(lifetime.canStart).toBe(false);
    lifetime.freeze();
    expect(apply).toHaveBeenCalledTimes(1);
    await handle.idle;
  });

  it('gives delayed startup only the remaining time before the original paint deadline', async () => {
    const time = clock();
    const pending = deferred<{ routes: string[] }>();
    const batches: RemoteEnrichmentBatch<null>[] = [];
    const lookup = vi.fn(() => pending.promise);
    const read = vi.fn(async () => ({}));
    time.jump(14_999);
    const handle = startRemoteEnrichment({
      owners: [alpha], deadline: 15_000, timing: time.timing, readers: { lookup, read },
      prepare: () => ({ outcome: 'read', prepared: null }), apply: (batch) => batches.push(batch)
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    time.advance(15_000);
    expect(batches).toMatchObject([{ finish: 'cutoff', results: [{ owner: alpha, outcome: 'cutoff' }] }]);
    pending.resolve({ routes: ['late'] });
    await handle.idle;
    expect(read).not.toHaveBeenCalled();
    expect(time.timers.size + time.frames.size).toBe(0);
  });

  it('applies a painted owner once and drains a coalesced pending batch synchronously on completion', async () => {
    const time = clock();
    const names = [alpha, owner('Beta'), owner('Gamma'), owner('Delta')];
    const reads = new Map(names.map(({ name }) => [name, deferred<NodelRemoteBindings>()]));
    const run = tracked({ lookup: async ({ name }) => ({ routes: [name] }), read: (route) => reads.get(route)!.promise }, names, time);
    await drainMicrotasks();
    reads.get('Alpha')!.resolve({});
    await drainMicrotasks();
    expect(run.batches).toHaveLength(0);
    expect(run.prepare).toHaveBeenCalledTimes(1);
    const first = [...time.frames.values()][0]!;
    time.paint();
    reads.get('Gamma')!.resolve({});
    reads.get('Beta')!.resolve({});
    await drainMicrotasks();
    expect(time.frames.size).toBe(1);
    const saved = [...time.frames.values()][0]!;
    first();
    expect(run.batches).toHaveLength(1);
    reads.get('Delta')!.resolve({});
    await run.handle.idle;
    saved();
    expect(run.batches.map(({ results, finish }) => [results.map((result) => result.owner.name), finish])).toEqual([
      [['Alpha'], undefined], [['Gamma', 'Beta', 'Delta'], 'complete']
    ]);
    expect(time.timers.size + time.frames.size).toBe(0);
  });

  it('drains accepted work at cutoff, keeps timed-out slots physical, and does not replay a saved frame', async () => {
    const time = clock();
    const held = deferred<NodelRemoteBindings>();
    const names = [alpha, ...['Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'].map((name) => owner(name))];
    const started: string[] = [];
    const run = tracked({
      lookup: async ({ name }) => ({ routes: [`${name}-first`, `${name}-second`] }),
      read: (route) => {
        started.push(route);
        return route === 'Alpha-first' || route === 'Alpha-second' ? Promise.reject(new TypeError()) : held.promise;
      }
    }, names, time);
    // Throttled timers: Alpha arrives just before its per-request deadline and
    // its accepted frame is postponed until the overall deadline.
    time.jump(2_999);
    await drainMicrotasks();
    expect(started).toEqual(['Alpha-first', 'Beta-first', 'Gamma-first', 'Delta-first', 'Alpha-second', 'Epsilon-first']);
    const saved = [...time.frames.values()][0]!;
    time.advance(15_000);
    expect(run.batches).toHaveLength(1);
    expect(run.batches[0]).toMatchObject({
      finish: 'cutoff', counts: { unsuccessful: 1, cutoff: 5 },
      results: [{ owner: alpha, outcome: 'unsuccessful' }, ...names.slice(1).map((item) => ({ owner: item, outcome: 'cutoff' }))]
    });
    expect(run.batches[0]?.results.at(-1)?.attempts).toEqual([]);
    expect(run.batches[0]?.results[1]?.attempts).toEqual(['timeout']);
    held.resolve({});
    await run.handle.idle;
    saved();
    expect(run.batches).toHaveLength(1);
    expect(started).toHaveLength(6);
    expect(time.timers.size + time.frames.size).toBe(0);
  });

  it('accepts a prepared success at t=14999, but not at t=15000 or when preparation crosses the cutoff', async () => {
    for (const [arrival, reconstructed, expected] of [[14_999, 14_999, 'read'], [15_000, 15_000, 'cutoff'], [14_999, 15_000, 'cutoff']] as const) {
      const time = clock();
      const gates = Array.from({ length: 4 }, () => deferred<NodelRemoteBindings>());
      const run = deferred<NodelRemoteBindings>();
      const late = deferred<NodelRemoteBindings>();
      const batches: RemoteEnrichmentBatch<null>[] = [];
      const names = [...['Beta', 'Gamma', 'Delta', 'Epsilon'].map((name) => owner(name)), alpha, owner('Zeta')];
      const started: string[] = [];
      const handle = startRemoteEnrichment({
        owners: names, timing: time.timing,
        readers: {
          lookup: async ({ name }) => ({ routes: [name] }),
          read: (route) => {
            started.push(route);
            if (route === 'Alpha') return run.promise;
            if (route === 'Zeta') return late.promise;
            return gates[started.length - 1]!.promise;
          }
        },
        prepare: () => { time.jump(reconstructed); return { outcome: 'read', prepared: null }; },
        apply: (batch) => batches.push(batch)
      });
      await drainMicrotasks();
      time.advance(12_500);
      time.paint();
      gates[0]!.resolve({}); // Release an abort-insensitive slot for Alpha.
      await drainMicrotasks();
      expect(started.at(-1)).toBe('Alpha');
      time.jump(arrival);
      run.resolve({});
      await drainMicrotasks();
      const frame = [...time.frames.values()][0];
      time.advance(15_000);
      frame?.();
      for (const gate of gates) gate.resolve({});
      late.resolve({});
      await handle.idle;
      expect(batches).toHaveLength(2);
      expect(Boolean(frame)).toBe(expected === 'read');
      expect(batches[1]?.results.filter((result) => result.owner.key === alpha.key)).toMatchObject([{ outcome: expected }]);
    }
  });

  it.each(['cutoff', 'freeze'] as const)('retains successful lookup evidence without addresses on %s', async (finish) => {
    const time = clock();
    const lookupGate = deferred<{ routes: string[] }>();
    const readGate = deferred<NodelRemoteBindings>();
    const names = [alpha, ...['Beta', 'Gamma', 'Delta', 'Epsilon'].map((name) => owner(name))];
    const lookup = vi.fn(async ({ name }: RemoteEnrichmentOwner) => name === 'Alpha'
      ? { routes: [bindingUrl(other)] } : lookupGate.promise);
    const read = vi.fn(() => readGate.promise);
    const run = tracked({ lookup, read }, names, time);
    await drainMicrotasks();
    expect(lookup.mock.calls.map(([item]) => item.name)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
    expect(read).toHaveBeenCalledTimes(1);
    if (finish === 'freeze') run.handle.freeze();
    else {
      // Simulate delayed timers: the overall deadline fires first, before any
      // overdue request callback can classify a pending discovery.
      time.jump(15_000);
      [...time.timers.values()].find((timer) => timer.due === 15_000)!.callback();
    }
    expect(run.batches).toHaveLength(1);
    expect(run.batches[0]).toMatchObject({ finish, counts: { cutoff: 5 } });
    expect(run.batches[0]!.results).toEqual(names.map((item) => ({
      owner: item, outcome: 'cutoff', lookupState: item === alpha ? 'found' : 'pending', issues: [], attempts: []
    })));
    lookupGate.resolve({ routes: ['late'] });
    readGate.resolve({});
    await run.handle.idle;
    expect(run.batches).toHaveLength(1);
  });

  it.each(['cancel', 'source-abort', 'freeze'] as const)('settles %s exactly once and never lets a saved old frame mutate a new generation', async (kind) => {
    const time = clock();
    const gate = deferred<NodelRemoteBindings>();
    const ctrl = new AbortController();
    const old = tracked({ lookup: async ({ name }) => ({ routes: [name] }), read: (route) => route === 'Alpha' ? Promise.resolve({}) : gate.promise },
      [alpha, owner('Beta')], time, ctrl.signal);
    await drainMicrotasks();
    const saved = [...time.frames.values()][0]!;
    if (kind === 'source-abort') ctrl.abort();
    else old.handle[kind]();
    const next = tracked({ lookup: async () => ({ routes: ['new'] }), read: async () => ({}) }, [alpha], time);
    await next.handle.idle;
    saved();
    gate.resolve({});
    await old.handle.idle;
    old.handle.freeze();
    old.handle.cancel();
    expect(next.batches).toHaveLength(1);
    if (kind === 'freeze') {
      expect(old.batches).toHaveLength(1);
      expect(old.batches[0]).toMatchObject({ finish: 'freeze', counts: { read: 1, cutoff: 1 } });
    } else expect(old.batches).toEqual([]);
  });

  it('holds all four slots during abort-insensitive body reads across source replacement', async () => {
    const time = clock();
    const bodies = Array.from({ length: 4 }, () => deferred<unknown>());
    const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map((name) => owner(name));
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const { name } = JSON.parse(init.body as string) as { name: string };
        return json([{ node: name, address: `${other}/nodes/${name}/` }]);
      }
      const name = new URL(String(url)).pathname.split('/')[2];
      const index = names.findIndex((item) => item.name === name);
      if (index < 0 || index >= bodies.length) throw new Error('Unexpected request');
      signals.push(init!.signal!);
      return Object.defineProperty(json({}), 'json', { value: () => bodies[index]!.promise });
    });
    const first = tracked(createRemoteEnrichmentReaders(page, fetcher), names, time);
    await drainMicrotasks();
    expect(fetcher).toHaveBeenCalledTimes(8);
    time.advance(3_000);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(8);
    first.handle.cancel();
    const lookup = vi.fn(async () => ({ routes: [] }));
    const next = tracked({ lookup, read: async () => ({}) }, [owner('Next')], time);
    expect(lookup).not.toHaveBeenCalled();
    let idle = false;
    void first.handle.idle.then(() => { idle = true; });
    bodies[0]!.resolve({});
    await next.handle.idle;
    expect(idle).toBe(false);
    expect(lookup).toHaveBeenCalledTimes(1);
    for (const body of bodies) body.resolve({});
    await first.handle.idle;
    expect(idle).toBe(true);
    expect(first.prepare).not.toHaveBeenCalled();
    expect(first.batches).toEqual([]);
  });

  it('settles a definitive lookup or final-route timeout without waiting for abort-insensitive promises', async () => {
    const time = clock();
    const heldLookup = deferred<{ routes: string[] }>();
    const heldRead = deferred<NodelRemoteBindings>();
    const run = tracked({
      lookup: async ({ name }) => name === 'Alpha' ? heldLookup.promise : { routes: ['only'] },
      read: () => heldRead.promise
    }, [alpha, owner('Beta')], time);
    await drainMicrotasks();
    time.advance(3_000);
    expect(run.batches[0]).toMatchObject({ finish: 'complete', results: [
      { outcome: 'unsuccessful', reason: 'lookup-timeout', lookupState: 'failed' },
      { outcome: 'unsuccessful', reason: 'timeout', lookupState: 'found', attempts: ['timeout'] }
    ] });
    heldLookup.resolve({ routes: ['never'] });
    heldRead.resolve({});
    await run.handle.idle;
    expect(run.batches).toHaveLength(1);
    expect(run.prepare).not.toHaveBeenCalled();
  });

  it('can try the one alternate while the timed-out request still occupies a physical slot', async () => {
    const time = clock();
    const first = deferred<NodelRemoteBindings>();
    const read = vi.fn((route: string) => route === 'first' ? first.promise : Promise.resolve({}));
    const run = tracked({ lookup: async () => ({ routes: ['first', 'first', 'alternate', 'never'] }), read }, [alpha], time);
    await drainMicrotasks();
    time.advance(3_000);
    await drainMicrotasks();
    expect(read.mock.calls.map(([route]) => route)).toEqual(['first', 'alternate']);
    expect(run.batches[0]).toMatchObject({ finish: 'complete', results: [{ outcome: 'read', attempts: ['timeout'] }] });
    first.resolve({ events: { incomplete: { node: 'Late' } } });
    await run.handle.idle;
    expect(run.prepare.mock.calls).toEqual([[alpha, {}, false]]);
    expect(run.batches).toHaveLength(1);
  });

  it('discards a pending patch if an abort handler revokes the source while freeze seals intake', async () => {
    const time = clock();
    const held = deferred<NodelRemoteBindings>();
    const source = new AbortController();
    const run = tracked({
      lookup: async ({ name }) => ({ routes: [name] }),
      read: (route, signal) => {
        if (route === 'Alpha') return Promise.resolve({});
        signal.addEventListener('abort', () => source.abort(), { once: true });
        return held.promise;
      }
    }, [alpha, owner('Beta')], time, source.signal);
    await drainMicrotasks();
    const saved = [...time.frames.values()][0]!;
    run.handle.freeze();
    saved();
    held.resolve({});
    await run.handle.idle;
    expect(run.prepare).toHaveBeenCalledTimes(1);
    expect(run.batches).toEqual([]);
    expect(time.timers.size + time.frames.size).toBe(0);
  });
});
