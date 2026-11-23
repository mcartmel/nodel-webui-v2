import { describe, expect, it, vi } from 'vitest';
import type { NodelRemoteBindings } from '../src/api/nodel-types';
import { createEnrichmentLifetime, createLocalSnapshotLifetime, localInspectionDepth } from '../src/experiments/konva-canvas/enrichment-lifetime';
import { placeEnrichedPeer } from '../src/experiments/konva-canvas/enrichment-placement';
import { cardHeight, edgeCurves, type FixtureNode } from '../src/experiments/konva-canvas/fixture';
import { LocalEnrichmentProjection, type LocalCardPatch } from '../src/experiments/konva-canvas/local-enrichment-projection';
import { LocalFraming } from '../src/experiments/konva-canvas/local-framing';
import { buildLocalGraph, localNodeKey, prepareRemoteOwnerInspection, type LocalGraph } from '../src/experiments/konva-canvas/local-graph';
import { localCardId, projectLocalGraph, type ProjectedLocalEdge } from '../src/experiments/konva-canvas/local-projection';
import { createRemoteEnrichmentReaders, startRemoteEnrichment, type RemoteEnrichmentBatch, type RemoteEnrichmentResult } from '../src/experiments/konva-canvas/remote-enrichment';

function harness() {
  const graph = buildLocalGraph({ locals: [
    { name: 'Owner', readState: 'read', actions: [{ alias: 'one', node: 'Alpha', endpoint: 'Zulu' }, { alias: 'two', node: 'Beta', endpoint: 'Go' }] },
    { name: 'Independent', readState: 'read', actions: [{ alias: 'other', node: 'Self', endpoint: 'go' }] },
    { name: 'Unread Local', readState: 'unread', localPathName: null }
  ] });
  const initial = projectLocalGraph(graph);
  const projection = new LocalEnrichmentProjection(graph, initial);
  const nodes = new Map(initial.nodes.map((node): [string, FixtureNode] => [node.id, node]));
  const edges = new Map(initial.edges.map((wire) => [wire.id, wire]));
  const patchCard = vi.fn((patch: LocalCardPatch) => {
    Object.assign(nodes.get(patch.id)!, patch);
    return patch.ports ? [...edges.values()].filter((wire) => wire.from.nodeId === patch.id || wire.to.nodeId === patch.id).map((wire) => wire.id) : [];
  });
  const addWire = vi.fn((wire: ProjectedLocalEdge) => { edges.set(wire.id, wire); });
  const addCard = vi.fn((node: FixtureNode) => { nodes.set(node.id, node); });
  const scene = { nodes, patchCard, addWire, addCard };
  const owner = (name: string) => graph.eligibleRemoteOwners.find((item) => item.key === localNodeKey(name))!;
  const node = (name: string) => nodes.get(localCardId(JSON.stringify(['node', localNodeKey(name)])))!;
  const accept = (name: string, bindings: NodelRemoteBindings) => {
    const source = owner(name);
    return projection.apply({ owner: source, lookupState: 'found', issues: [], attempts: [], ...prepareRemoteOwnerInspection(source, bindings) }, scene);
  };
  return { graph, initial, projection, nodes, edges, owner, node, accept, scene };
}

describe('Konva enrichment projection', () => {
  it.each([
    ['source=local', 1], ['source=local&depth=2', 2], ['source=local&depth=1', 1],
    ['source=local&depth=3', 1], ['source=local&depth=02', 1], ['source=local&depth=+2', 1],
    ['source=local&depth=2&depth=1', 1], ['source=local&depth=', 1], ['depth=2', 1], ['source=synthetic&depth=2', 1]
  ] as const)('selects inspection depth from %s', (query, depth) => {
    expect(localInspectionDepth(new URLSearchParams(query))).toBe(depth);
  });

  it.each([1, 2] as const)('applies only disclosed configured targets at depth %d', async (depth) => {
    const h = harness();
    const origin = 'https://topology.test';
    const peer = 'https://peer.test';
    const bindings: Record<string, unknown> = {
      Alpha: { actions: {
        'Power On': { node: 'Gamma', action: 'Run' },
        'Power-On': { node: 'Gamma', action: 'Run' },
        Loop: { node: 'A-lpha', action: 'Echo' },
        Cycle: { node: 'Beta', action: 'Echo' },
        Local: { node: 'Unread-Local', action: 'Set' },
        Half: { node: 'HalfTarget' },
        'Conflicted Alias': { node: 'ConflictOne', action: 'Run' },
        'Conflicted-Alias': { node: 'ConflictTwo', action: 'Run' },
        'Invalid Alias\n': { node: 'InvalidAliasTarget', action: 'Run' },
        InvalidEndpoint: { node: 'InvalidEndpointTarget', action: 'Go\n' },
        InvalidNode: { node: 'InvalidNode\n', action: 'Run' },
        '---': { node: 'NoAliasTarget', action: 'Run' }
      } },
      Beta: { events: { Listen: { node: 'GAMMA', event: 'Ready' }, Denied: { node: 'Denied', event: 'Ready' } } },
      // A rejected whole response cannot disclose even syntactically valid siblings.
      Self: { actions: { LooksGood: { node: 'FailedTarget', action: 'Run' }, Bad: { node: 7 } } },
      GAMMA: { actions: { Back: { node: 'Alpha', action: 'Run' }, Forward: { node: 'ThirdHop', action: 'Run' } },
        events: { Listen: { node: 'ThirdHop', event: 'Ready' } } }
    };
    const lookupNames: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${origin}/REST/nodeURLsForNode` && init?.method === 'POST') {
        const { name } = JSON.parse(String(init.body)) as { name: string };
        lookupNames.push(name);
        return Response.json([{ node: name, address: `${peer}/nodes/${name}/` }]);
      }
      if (url === `${peer}/nodes/Denied/REST/remote`) return new Response(null, { status: 403 });
      const name = /^https:\/\/peer\.test\/nodes\/([^/]+)\/REST\/remote$/.exec(url)?.[1];
      if (!name || !Object.hasOwn(bindings, name)) throw new Error(`Unexpected request: ${url}`);
      return Response.json(bindings[name]);
    });
    const batches: RemoteEnrichmentBatch<LocalGraph>[] = [];
    const run = startRemoteEnrichment({
      depth, owners: h.graph.eligibleRemoteOwners, readers: createRemoteEnrichmentReaders(origin, fetcher),
      prepare: (owner, body, collect) => prepareRemoteOwnerInspection(owner, body, collect ? h.graph.nodes : undefined),
      apply(batch) {
        batches.push(batch);
        for (const result of batch.results) h.projection.apply(result, h.scene);
      }
    });
    await run.idle;

    expect(lookupNames.slice(0, 3)).toEqual(['Alpha', 'Beta', 'Self']);
    expect(lookupNames.slice(3).sort()).toEqual(depth === 2 ? ['Denied', 'GAMMA'] : []);
    expect(fetcher).toHaveBeenCalledTimes(depth === 2 ? 10 : 6);
    for (const [, init] of fetcher.mock.calls.filter(([, init]) => init?.method === 'GET')) {
      expect(init).toMatchObject({ credentials: 'omit', mode: 'cors', redirect: 'error', referrerPolicy: 'no-referrer' });
    }
    expect(batches.filter(({ finish }) => finish).map(({ finish }) => finish)).toEqual(['complete']);
    const final = batches.at(-1)!;
    expect(final.counts).toEqual(depth === 2 ? { total: 5, read: 2, partial: 1, unsuccessful: 2, cutoff: 0 }
      : { total: 3, read: 1, partial: 1, unsuccessful: 1, cutoff: 0 });
    expect(h.projection.summary(final)).not.toContain('awaiting inspection');
    expect(h.projection.summary(final)).toContain('1 invalid binding response');
    expect(h.node('Alpha').displayStatus).toBe('Bindings partially loaded');
    expect(h.node('Unread Local')).toMatchObject({ origin: 'local', displayStatus: 'Not inspected' });
    expect(h.node('Denied').displayStatus).toBe(depth === 2 ? 'Remote binding read failed' : 'Not inspected');
    expect(h.node('Gamma').displayStatus).toBe(depth === 2 ? '' : 'Not inspected');
    expect(h.scene.addCard.mock.calls.filter(([node]) => localNodeKey(node.name) === localNodeKey('Gamma'))).toHaveLength(1);
    expect(h.graph.eligibleRemoteOwners.map(({ name }) => name)).toEqual(['Alpha', 'Beta', 'Self']);
    const wireCount = (owner: string, kind: 'action' | 'event', from: string, to: string) => [...h.edges.values()].filter((wire) =>
      wire.ownerId === h.node(owner).id && wire.bindingKind === kind && wire.from.nodeId === h.node(from).id && wire.to.nodeId === h.node(to).id).length;
    expect(wireCount('Alpha', 'action', 'Alpha', 'Gamma')).toBe(1);
    expect(wireCount('Beta', 'event', 'Gamma', 'Beta')).toBe(1);
    if (depth === 2) {
      expect(h.node('ThirdHop').displayStatus).toBe('Not inspected');
      expect(wireCount('Gamma', 'action', 'Gamma', 'ThirdHop')).toBe(1);
      expect(wireCount('Gamma', 'event', 'ThirdHop', 'Gamma')).toBe(1);
    } else expect(h.node('ThirdHop')).toBeUndefined();
  });

  it('updates status and summary for empty, failed and cutoff reads without port or wire work', () => {
    const h = harness();
    const alphaPorts = h.node('Alpha').ports;
    const alphaWire = [...h.edges.values()].find((wire) => wire.to.nodeId === h.node('Alpha').id)!;
    expect(h.accept('Alpha', { actions: { unbound: {} } })).toEqual(new Set());
    expect(h.scene.patchCard.mock.calls[0]![0]).not.toHaveProperty('ports');
    expect(h.node('Alpha').ports).toBe(alphaPorts);
    expect(h.edges.get(alphaWire.id)).toBe(alphaWire);
    expect(h.node('Alpha').displayQualifier).toBe('');
    expect(h.node('Alpha').tooltip).toContain('Inspection succeeded; 1 configured binding, 1 unassigned binding.');
    expect(h.scene.patchCard.mock.calls[0]?.[0]).toMatchObject({ hostKind: 'unknown', displayQualifier: '' });

    const oneSetGraph = buildLocalGraph({ locals: [{ name: 'One Set', readState: 'read', actions: [{ alias: 'call', node: 'Peer', endpoint: 'Run' }] }] });
    const oneSetCard = projectLocalGraph(oneSetGraph).nodes.find(({ name }) => name === 'One Set')!;
    expect(oneSetCard.displayQualifier).toBe('');
    expect(oneSetCard.tooltip).toContain('Inspection succeeded; 1 configured binding, none unassigned.');

    const results: RemoteEnrichmentResult<LocalGraph>[] = [
      { owner: h.owner('Beta'), outcome: 'unsuccessful', lookupState: 'found', reason: 'invalid-data', issues: [], attempts: ['invalid-data'] },
      { owner: h.owner('Self'), outcome: 'cutoff', lookupState: 'pending', issues: [], attempts: [] }
    ];
    for (const result of results) expect(h.projection.apply(result, h.scene)).toEqual(new Set());
    expect(h.scene.patchCard.mock.calls.every(([patch]) => patch.ports === undefined)).toBe(true);
    expect(h.scene.addCard).not.toHaveBeenCalled();
    expect(h.scene.addWire).not.toHaveBeenCalled();
    expect(h.node('Beta').displayStatus).toBe('Invalid binding response');
    expect(h.node('Beta').displayQualifier).toBe('Invalid binding response');
    expect(h.node('Beta').tooltip).toContain('Invalid binding response.');
    expect(h.node('Self').displayQualifier).toBe('Inspection stopped at cutoff');
    expect(h.node('Self').tooltip).toContain('Inspection stopped at cutoff.');
    expect(h.projection.summary({ counts: { total: 3, read: 1, partial: 0, unsuccessful: 1, cutoff: 1 }, results })).toContain('1 inspected · 1 invalid binding response · 1 not inspected before cutoff');
  });

  it('keeps clean complete cards subtitle-free and describes successful empty inspection in the tooltip', () => {
    const graph = buildLocalGraph({ locals: [
      { name: 'Owner', readState: 'read', actions: [{ alias: 'one', node: 'Empty', endpoint: 'Run' }] }
    ] });
    const projection = new LocalEnrichmentProjection(graph, projectLocalGraph(graph));
    const initial = projectLocalGraph(graph);
    const emptyId = localCardId(JSON.stringify(['node', localNodeKey('Empty')]));
    const empty = initial.nodes.find(({ id }) => id === emptyId)!;
    const nodes = new Map(initial.nodes.map((node) => [node.id, node]));
    const patchCard = vi.fn((patch: LocalCardPatch) => { Object.assign(nodes.get(patch.id)!, patch); return []; });
    const scene = { nodes, patchCard, addWire: vi.fn(), addCard: vi.fn() };
    const remote = graph.eligibleRemoteOwners[0]!;
    projection.apply({ owner: remote, lookupState: 'found', hostEvidence: 'remote.example:7443', issues: [], attempts: [], ...prepareRemoteOwnerInspection(remote, {}) }, scene);
    expect(patchCard.mock.calls[0]?.[0]).toMatchObject({ hostKind: 'remote', displayQualifier: '' });
    expect(nodes.get(empty.id)?.tooltip).toContain('Advertised host: remote.example:7443.');
    expect(nodes.get(empty.id)?.displayQualifier).toBe('');
    expect(nodes.get(empty.id)?.tooltip).toContain('Inspection succeeded; 0 configured bindings, none unassigned.');
  });

  it('does not claim exact counts or empty bindings for malformed partial local evidence', () => {
    const graph = buildLocalGraph({ locals: [{
      name: 'Partial', readState: 'read', actions: [{ alias: 'Broken', node: 'Target', endpoint: 'Run', malformed: true }]
    }] });
    const card = projectLocalGraph(graph).nodes.find(({ name }) => name === 'Partial')!;
    expect(card.displayQualifier).toBe('Bindings partially loaded');
    expect(card.tooltip).toContain('Bindings partially loaded.');
    expect(card.tooltip).not.toMatch(/\b\d+ set, \d+ unset of \d+ bindings/);
    expect(card.tooltip).not.toContain('none unassigned');
  });

  it('bounds long native tooltips after including sanitized host and binding evidence', () => {
    const graph = buildLocalGraph({ locals: [{ name: 'Owner', readState: 'read', actions: [{ alias: 'Call', node: 'Remote', endpoint: 'Run' }] }] });
    const remote = [...graph.nodes.values()].find(({ origin }) => origin === 'referenced')!;
    remote.hostEvidence = 'remote-host.'.repeat(40);
    remote.inspectionState = 'read';
    remote.bindingCounts = { set: 0, total: 0 };
    const card = projectLocalGraph(graph).nodes.find(({ name }) => name === 'Remote')!;
    const tooltip = card.tooltip!;
    expect(tooltip.length).toBeLessThanOrEqual(320);
    expect(tooltip.endsWith('…')).toBe(true);
  });

  it('reranks both directed groups without changing the unrelated wire or existing card positions', () => {
    const h = harness();
    const alpha = h.node('Alpha');
    const owner = h.node('Owner');
    alpha.x += 58;
    alpha.y += 107;
    const start = { x: alpha.x, y: alpha.y };
    const oldForward = [...h.edges.values()].find((wire) => wire.to.nodeId === alpha.id)!;
    const unrelated = [...h.edges.values()].find((wire) => wire.from.nodeId === h.node('Independent').id)!;
    const oldPorts = alpha.ports;

    const dirtied = h.accept('Alpha', { actions: { forward: { node: 'Owner', action: 'On' }, second: { node: 'Owner', action: 'Off' } }, events: { subs: { node: 'Owner', event: 'Ready' } } });
    expect(h.node('Alpha')).toBe(alpha);
    expect(h.node('Alpha')).toMatchObject(start);
    expect(alpha.ports).not.toBe(oldPorts);
    expect(h.edges.get(oldForward.id)).toBe(oldForward);
    expect(oldForward).toMatchObject({ reciprocal: true, laneIndex: 0, laneCount: 2, oppositeLaneCount: 2 });
    const reverse = [...h.edges.values()].filter((wire) => wire.from.nodeId === alpha.id && wire.to.nodeId === owner.id);
    expect(reverse.map((wire) => wire.laneIndex).sort()).toEqual([0, 1]);
    expect(reverse.every((wire) => wire.oppositeLaneCount === 2 && wire.reciprocal)).toBe(true);
    expect(dirtied).toContain(oldForward.id);
    expect(dirtied).not.toContain(unrelated.id);
    expect(h.edges.get(unrelated.id)).toBe(unrelated);

    // Incremental lanes and IDs must agree with a full hypothetical projection.
    const full = projectLocalGraph(h.graph);
    expect([...h.edges.values()].sort((a, b) => a.id.localeCompare(b.id))).toEqual(full.edges);
  });

  it('places a shared peer once at the first owner’s live position, retaining canonical names across arrival orders', () => {
    const alpha = { actions: { next: { node: 'Gamma', action: 'Run' } } };
    const beta = { events: { next: { node: 'GAMMA', event: 'Ready' } } };
    // Compare the full records by stable logical ID, not by arrival order in each Map.
    const byId = <T>(entries: ReadonlyMap<string, T>) => [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    function run(order: 'Alpha' | 'Beta') {
      const h = harness();
      Object.assign(h.node('Alpha'), { x: 3_000, y: 2_000 });
      Object.assign(h.node('Beta'), { x: -3_000, y: -2_000 });
      const before = [...h.nodes].map(([id, { x, y }]) => [id, { x, y }] as const);
      h.accept(order, order === 'Alpha' ? alpha : beta);
      const peer = h.node('Gamma');
      const point = { x: peer.x, y: peer.y };
      const first = h.node(order);
      expect(peer.y).toBe(first.y);
      if (order === 'Alpha') expect(peer.x).toBeGreaterThan(first.x + first.width);
      else expect(peer.x + peer.width).toBeLessThan(first.x);
      h.accept(order === 'Alpha' ? 'Beta' : 'Alpha', order === 'Alpha' ? beta : alpha);
      expect(h.node('Gamma')).toBe(peer);
      expect(peer).toMatchObject(point);
      expect(peer.name).toBe('GAMMA');
      expect(h.scene.addCard).toHaveBeenCalledTimes(1);
      expect(h.graph.eligibleRemoteOwners.some((owner) => owner.name === 'GAMMA')).toBe(false);
      for (const [id, original] of before) expect(h.nodes.get(id)).toMatchObject(original);
      return { nodes: byId(h.graph.nodes), ports: byId(h.graph.ports), wires: byId(h.graph.connections) };
    }
    expect(run('Alpha')).toStrictEqual(run('Beta'));
  });

  it('uses actual occupied card bounds when trying adjacent slots', () => {
    const h = harness();
    const owner = h.node('Alpha');
    const peer = h.node('Beta');
    const blockedY = owner.y;
    const blocker = { ...h.node('Owner'), x: owner.x + owner.width + 150, y: blockedY };
    const point = placeEnrichedPeer(peer, owner, 1, [owner, blocker]);
    expect(point.x).toBe(blocker.x);
    expect(point.y >= blocker.y + cardHeight(blocker) || point.y + cardHeight(peer) <= blocker.y).toBe(true);
  });
});

describe('local Reset framing', () => {
  it('replaces card and loop extents and reduces again when the outermost objects move inward', () => {
    const graph = buildLocalGraph({ locals: [{ name: 'Owner', readState: 'read', actions: [{ alias: 'loop', node: 'Owner', endpoint: 'Echo' }] }] });
    const { nodes: [owner], edges: [loop] } = projectLocalGraph(graph);
    const framing = new LocalFraming();
    const nodes = new Map([[owner!.id, owner!]]);
    framing.updateCard(owner!);
    framing.updateRoute(loop!.id, edgeCurves(loop!, nodes));
    const before = framing.bounds()!;
    expect(before.left).toBeLessThan(owner!.x);
    expect(before.top).toBeLessThan(owner!.y);
    expect(framing.bounds()).toBe(before);
    Object.assign(owner!, { x: owner!.x + 250, y: owner!.y + 100 });
    framing.updateCard(owner!);
    framing.updateRoute(loop!.id, edgeCurves(loop!, nodes));
    const moved = framing.bounds()!;
    expect(moved.left).toBe(before.left + 250);
    expect(moved.right).toBe(before.right + 250);
    expect(moved.top).toBe(before.top + 100);
    expect(moved.bottom).toBe(before.bottom + 100);
  });
});

describe('Stage A paint and document lifetime', () => {
  function frames() {
    const queue = new Map<number, () => void>();
    let id = 0;
    return {
      queue,
      request: (callback: () => void) => { queue.set(++id, callback); return id; },
      cancel: (handle: number) => { queue.delete(handle); },
      fire() {
        const tasks = [...queue.values()];
        queue.clear();
        for (const task of tasks) task();
      }
    };
  }

  it('waits for nonzero size and an intervening frame; BFCache freeze flushes while authorised', () => {
    const paint = frames();
    const lifetime = createEnrichmentLifetime(paint);
    const freeze = vi.fn(() => expect(lifetime.signal.aborted).toBe(false));
    const start = vi.fn(() => lifetime.attach({ freeze }));
    lifetime.afterPaint(start);
    paint.fire();
    expect(start).not.toHaveBeenCalled();
    lifetime.sized();
    paint.fire();
    expect(start).not.toHaveBeenCalled();
    paint.fire();
    expect(start).toHaveBeenCalledTimes(1);
    lifetime.afterPaint(start);
    expect(paint.queue.size).toBe(0);
    lifetime.freeze();
    expect(freeze).toHaveBeenCalledTimes(1);
    lifetime.sized();
    lifetime.afterPaint(start);
    paint.fire();
    paint.fire();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('skips an obsolete frame and cancels a started run without freezing it', () => {
    const paint = frames();
    const lifetime = createEnrichmentLifetime(paint);
    const start = vi.fn();
    lifetime.sized();
    lifetime.afterPaint(start);
    paint.fire();
    const obsoleteFrame = [...paint.queue.values()][0]!;
    lifetime.cancel();
    expect(lifetime.signal.aborted).toBe(true);
    obsoleteFrame();
    expect(start).not.toHaveBeenCalled();

    const activeLifetime = createEnrichmentLifetime(paint);
    const freeze = vi.fn();
    activeLifetime.attach({ freeze });
    const aborted = vi.fn(() => expect(activeLifetime.canStart).toBe(false));
    activeLifetime.signal.addEventListener('abort', aborted);
    activeLifetime.cancel();
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(freeze).not.toHaveBeenCalled();
  });

  it('recovers only interrupted Stage A on a persisted source-selector navigation', async () => {
    const paint = frames();
    const enrichment = createEnrichmentLifetime(paint);
    const startEnrichment = vi.fn();
    const mount = vi.fn();
    const attempts: { signal: AbortSignal; deliver: (source: string) => void }[] = [];
    const snapshot = createLocalSnapshotLifetime(async (signal) => {
      const source = await new Promise<string>((deliver) => { attempts.push({ signal, deliver }); });
      if (signal.aborted) return;
      mount(source);
      enrichment.afterPaint(startEnrichment);
    });

    snapshot.start();
    // Selector has intent to change source before it knows the pagehide verdict.
    enrichment.cancel();
    snapshot.suspend();
    expect(attempts[0]?.signal.aborted).toBe(true);
    snapshot.suspend(); // Retained pagehide; Stage A is already suspended.
    enrichment.freeze();
    snapshot.restore();
    snapshot.restore();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.signal.aborted).toBe(false);

    attempts[0]!.deliver('obsolete snapshot');
    attempts[1]!.deliver('recovered local snapshot');
    await Promise.resolve();
    await Promise.resolve();
    expect(mount.mock.calls).toEqual([['recovered local snapshot']]);
    enrichment.sized();
    paint.fire();
    paint.fire();
    expect(startEnrichment).not.toHaveBeenCalled();

    snapshot.suspend();
    snapshot.restore();
    expect(attempts).toHaveLength(2); // A mounted scene is retained, not remounted.
  });

  it('never restores Stage A after a true unload, including a prior selector cancellation', () => {
    const load = vi.fn(async (_signal: AbortSignal) => {});
    for (const selectedSource of [false, true]) {
      const snapshot = createLocalSnapshotLifetime(load);
      snapshot.start();
      if (selectedSource) snapshot.suspend();
      snapshot.dispose();
      expect(load.mock.lastCall?.[0].aborted).toBe(true);
      snapshot.restore();
      snapshot.start();
    }
    expect(load).toHaveBeenCalledTimes(2);
  });
});
