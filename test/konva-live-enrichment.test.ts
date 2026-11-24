import { describe, expect, it, vi } from 'vitest';
import type { NodelRemoteBindings } from '../src/api/nodel-types';
import { createEnrichmentLifetime, createLocalSnapshotLifetime, localInspectionDepth } from '../src/experiments/konva-canvas/enrichment-lifetime';
import { getPageEnrichmentLimiter } from '../src/experiments/konva-canvas/enrichment-limiter';
import { placeEnrichedPeer } from '../src/experiments/konva-canvas/enrichment-placement';
import { cardHeight, edgeCurves, NODE_WIDTH, portPoint, type FixtureNode } from '../src/experiments/konva-canvas/fixture';
import { LocalEnrichmentProjection, restrictLocalGraphProjection, type LocalCardPatch } from '../src/experiments/konva-canvas/local-enrichment-projection';
import { LocalFraming } from '../src/experiments/konva-canvas/local-framing';
import { applyRemoteDiscovery, buildLocalGraph, localNodeKey, prepareRemoteOwnerInspection, type LocalGraph } from '../src/experiments/konva-canvas/local-graph';
import { disconnectedInventoryAnchor, disconnectedInventorySlotPitch, selectLocalGraphMembership } from '../src/experiments/konva-canvas/local-placement';
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
  const scene = { nodes, occupiedNodes: () => [...nodes.values()], patchCard, addWire, addCard };
  const owner = (name: string) => graph.eligibleRemoteOwners.find((item) => item.key === localNodeKey(name))!;
  const node = (name: string) => nodes.get(localCardId(JSON.stringify(['node', localNodeKey(name)])))!;
  const accept = (name: string, bindings: NodelRemoteBindings) => {
    const source = owner(name);
    return projection.apply({ owner: source, lookupState: 'found', source: 'remote', issues: [], attempts: [], ...prepareRemoteOwnerInspection(source, bindings) }, scene);
  };
  return { graph, initial, projection, nodes, edges, owner, node, accept, scene };
}

describe('Konva enrichment projection', () => {
  it('selects connected terminals and all local cards while deferring pending name-only inventory above 40', () => {
    const graph = buildLocalGraph({ locals: [{ name: 'Local', readState: 'read', actions: [{ alias: 'call', node: 'Connected', endpoint: 'Run' }] }] });
    for (let index = 0; index < 45; index += 1) {
      const name = `Inventory ${String(index).padStart(2, '0')}`;
      const key = localNodeKey(name);
      applyRemoteDiscovery(graph, { owner: { id: JSON.stringify(['node', key]), key, name }, lookupState: 'found' });
    }
    const membership = selectLocalGraphMembership(graph);
    const local = [...graph.nodes.values()].find(({ origin }) => origin === 'local')!;
    const connected = [...graph.nodes.values()].find(({ name }) => name === 'Connected')!;
    expect(membership.discovered).toBe(47);
    expect(membership.shown).toEqual(new Set([local.id, connected.id]));
    expect(membership.deferred).toHaveLength(45);
    expect(membership.shouldOfferShowAll).toBe(true);
    const full = projectLocalGraph(graph);
    const initial = restrictLocalGraphProjection(graph, full, membership.shown);
    expect(initial.nodes.map(({ name }) => name).sort()).toEqual(['Connected', 'Local']);
    expect(initial.edges).toHaveLength(1);
    const displayedCardIds = new Set(initial.nodes.map(({ id }) => id));
    expect(initial.edges.every(({ from, to }) => displayedCardIds.has(from.nodeId) && displayedCardIds.has(to.nodeId))).toBe(true);
    expect(graph.nodes.size).toBe(membership.discovered); // Display policy leaves model membership authoritative.
  });

  it('uses a bounded stable fallback sample when a large graph has no terminal evidence', () => {
    const graph = buildLocalGraph({ locals: [] });
    for (let index = 49; index >= 0; index -= 1) {
      const name = `Inventory ${String(index).padStart(2, '0')}`;
      const key = localNodeKey(name);
      applyRemoteDiscovery(graph, { owner: { id: JSON.stringify(['node', key]), key, name }, lookupState: 'pending' });
    }
    const membership = selectLocalGraphMembership(graph);
    expect(membership.discovered).toBe(50);
    expect(membership.shown.size).toBe(8);
    expect([...membership.shown].map((id) => graph.nodes.get(id)!.name)).toEqual(Array.from({ length: 8 }, (_, index) => `Inventory ${String(index).padStart(2, '0')}`));
    expect(membership.deferred.size).toBe(42);
  });

  it('drains Show all in bounded stable frame batches and updates shown counts', () => {
    const graph = buildLocalGraph({ locals: [] });
    for (let index = 0; index < 21; index += 1) {
      const name = `Inventory ${String(index).padStart(2, '0')}`;
      const key = localNodeKey(name);
      applyRemoteDiscovery(graph, { owner: { id: JSON.stringify(['node', key]), key, name }, lookupState: 'pending' });
    }
    const initial = projectLocalGraph(graph);
    const projection = new LocalEnrichmentProjection(graph, initial, {
      displayedNodeIds: [], deferredNodeIds: graph.nodes.keys(), frameBatchSize: 5
    });
    const nodes = new Map<string, FixtureNode>();
    const scene = { nodes, patchCard: vi.fn(() => []), addWire: vi.fn(), addCard: vi.fn((card: FixtureNode) => { nodes.set(card.id, card); }) };
    expect(projection.shouldOfferShowAll()).toBe(true);
    expect(projection.revealAll()).toBe(true);
    expect(projection.drainFrame(scene, 99)).toBe(true);
    expect(nodes.size).toBe(5);
    expect(projection.counts()).toMatchObject({ discovered: 21, shown: 5, deferred: 16 });
    expect(projection.drainFrame(scene, 5)).toBe(true);
    expect(nodes.size).toBe(10);
    expect(projection.drainFrame(scene, 5)).toBe(true);
    expect(projection.drainFrame(scene, 5)).toBe(true);
    expect(projection.drainFrame(scene, 5)).toBe(false);
    expect(nodes.size).toBe(21);
    expect(projection.shouldOfferShowAll()).toBe(false);
  });

  it('promotes an already displayed advertisement to verified local authority in place', () => {
    const graph = buildLocalGraph({ locals: [] });
    const name = 'Promoted Owner';
    const key = localNodeKey(name);
    const owner = { id: JSON.stringify(['node', key]), key, name };
    applyRemoteDiscovery(graph, { owner, lookupState: 'pending' });
    const initial = projectLocalGraph(graph);
    const node = initial.nodes[0]!;
    const nodes = new Map([[node.id, node]]);
    const patchCard = vi.fn((patch: LocalCardPatch) => { Object.assign(nodes.get(patch.id)!, patch); return []; });
    const scene = { nodes, patchCard, addWire: vi.fn(), addCard: vi.fn() };
    const projection = new LocalEnrichmentProjection(graph, initial);

    projection.applyLocalInventory({ owners: [{ key, name, status: 'unread', reason: 'unfinished' }] }, scene);
    expect(nodes.get(node.id)).toMatchObject({ origin: 'local', hostKind: 'local' });
    expect(nodes.get(node.id)).toBe(node);
    expect(patchCard).toHaveBeenCalledTimes(1);
    expect(graph.nodes.get(owner.id)?.origin).toBe('local');
  });

  it('promotes deferred isolated local names without overlapping or losing local origin', () => {
    const graph = buildLocalGraph({ locals: [] });
    const names = Array.from({ length: 9 }, (_, index) => `Late owner ${index}`);
    const owners = names.map((name) => {
      const key = localNodeKey(name);
      const owner = { id: JSON.stringify(['node', key]), key, name };
      applyRemoteDiscovery(graph, { owner, lookupState: 'pending' });
      return { id: owner.id, name, key };
    });
    const projection = new LocalEnrichmentProjection(graph, projectLocalGraph(graph), {
      displayedNodeIds: [], deferredNodeIds: owners.map(({ id }) => id)
    });
    const nodes = new Map<string, FixtureNode>();
    const scene = {
      nodes,
      patchCard: vi.fn(() => []),
      addCard: vi.fn((card: FixtureNode) => nodes.set(card.id, card)),
      addWire: vi.fn()
    };
    projection.applyLocalInventory({ owners: owners.map(({ name, key }) => ({ name, key, localPathName: name, status: 'unread' as const, reason: 'unfinished' as const })) }, scene);

    expect(nodes.size).toBe(9);
    expect([...nodes.values()].every(({ origin }) => origin === 'local')).toBe(true);
    const cards = [...nodes.values()];
    for (let first = 0; first < cards.length; first += 1) {
      const a = cards[first]!;
      for (let second = first + 1; second < cards.length; second += 1) {
        const b = cards[second]!;
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x ||
          a.y + cardHeight(a) <= b.y || b.y + cardHeight(b) <= a.y).toBe(true);
      }
    }
  });

  it('places 450 newly settled isolated results in persistent wrapping slots without moving prior groups', () => {
    const graph = buildLocalGraph({ locals: [{ name: 'Stable owner', readState: 'read', actions: [{ alias: 'next', node: 'Stable peer', endpoint: 'Run' }] }] });
    const initial = projectLocalGraph(graph);
    const existing = new Map(initial.nodes.map((card) => [card.id, { x: card.x, y: card.y }]));
    const owners = Array.from({ length: 450 }, (_, index) => {
      const name = `Settled ${String(index).padStart(3, '0')}`;
      const key = localNodeKey(name);
      const owner = { id: JSON.stringify(['node', key]), key, name };
      applyRemoteDiscovery(graph, { owner, lookupState: 'pending' });
      return owner;
    });
    const initiallyShownIds = [...graph.nodes.keys()].filter((id) => initial.nodes.some(({ id: cardId }) => cardId === localCardId(id)));
    const projection = new LocalEnrichmentProjection(graph, initial, {
      displayedNodeIds: initiallyShownIds,
      deferredNodeIds: owners.map(({ id }) => id)
    });
    const nodes = new Map(initial.nodes.map((node): [string, FixtureNode] => [node.id, node]));
    const scene = {
      nodes,
      occupiedNodes: () => [...nodes.values()],
      patchCard: vi.fn((patch: LocalCardPatch) => { Object.assign(nodes.get(patch.id)!, patch); return []; }),
      addCard: vi.fn((card: FixtureNode) => nodes.set(card.id, card)),
      addWire: vi.fn()
    };
    for (const owner of owners) projection.apply({ owner, lookupState: 'no-route', outcome: 'unsuccessful', reason: 'no-route',
      source: 'remote', issues: [], attempts: [] }, scene);

    const settled = [...nodes.values()].filter(({ name }) => name.startsWith('Settled '));
    expect(settled).toHaveLength(450);
    for (const [id, point] of existing) expect(nodes.get(id)).toMatchObject(point);
    const xSpan = Math.max(...settled.map(({ x }) => x)) - Math.min(...settled.map(({ x }) => x));
    const ySpan = Math.max(...settled.map(({ y }) => y)) - Math.min(...settled.map(({ y }) => y));
    expect(xSpan).toBeLessThanOrEqual(9 * (settled[0]!.width + 44));
    expect(ySpan).toBeLessThanOrEqual(44 * disconnectedInventorySlotPitch(settled[0]!));
    expect(projection.counts()).toMatchObject({ discovered: 452, shown: 452, deferred: 0 });
  });

  it('keeps inventory membership names-only and projects the late local binding result', () => {
    const graph = buildLocalGraph({ locals: [] });
    const name = 'Late Local';
    const key = localNodeKey(name);
    const owner = { id: JSON.stringify(['node', key]), key, name };
    const initial = projectLocalGraph(graph);
    const nodes = new Map<string, FixtureNode>();
    const wires = new Map<string, ProjectedLocalEdge>();
    const scene = {
      nodes,
      occupiedNodes: () => [...nodes.values()],
      patchCard: vi.fn((patch: LocalCardPatch) => { Object.assign(nodes.get(patch.id)!, patch); return []; }),
      addCard: vi.fn((card: FixtureNode) => nodes.set(card.id, card)),
      addWire: vi.fn((wire: ProjectedLocalEdge) => wires.set(wire.id, wire))
    };
    const projection = new LocalEnrichmentProjection(graph, initial, { displayedNodeIds: [] });
    projection.applyLocalInventory({ owners: [{ name, key, localPathName: name, status: 'unread', reason: 'unfinished' }] }, scene);
    const cardId = localCardId(owner.id);
    expect(nodes.get(cardId)).toMatchObject({ origin: 'local', ports: [] });

    const promoted = graph.nodes.get(owner.id)!;
    projection.apply({ owner: promoted, lookupState: 'found', source: 'local', issues: [], attempts: [],
      ...prepareRemoteOwnerInspection(promoted, { actions: { start: { node: 'Late peer', action: 'Run' } } }) }, scene);
    expect(nodes.get(cardId)?.ports).toHaveLength(1);
    expect(wires.size).toBe(1);
    const peer = [...nodes.values()].find(({ name: nodeName }) => nodeName === 'Late peer')!;
    const local = nodes.get(cardId)!;
    expect(Math.abs(peer.x - local.x) + Math.abs(peer.y - local.y)).toBeGreaterThan(0);
    expect(peer.x >= local.x + local.width || local.x >= peer.x + peer.width ||
      peer.y >= local.y + cardHeight(local) || local.y >= peer.y + cardHeight(peer)).toBe(true);
    expect(() => projection.applyLocalInventory({ owners: [{ name, key, status: 'read', bindings: {} }] }, scene))
      .toThrow('Local inventory membership must not include binding results.');
  });

  it('lays out a connected result batch when no owner card has mounted yet', () => {
    const graph = buildLocalGraph({ locals: [] });
    const name = 'Unmounted owner';
    const key = localNodeKey(name);
    const owner = { id: JSON.stringify(['node', key]), key, name };
    applyRemoteDiscovery(graph, { owner, lookupState: 'found' });
    const initial = projectLocalGraph(graph);
    const nodes = new Map<string, FixtureNode>();
    const wires = new Map<string, ProjectedLocalEdge>();
    const scene = {
      nodes,
      occupiedNodes: () => [...nodes.values()],
      patchCard: vi.fn(() => []),
      addCard: vi.fn((card: FixtureNode) => nodes.set(card.id, card)),
      addWire: vi.fn((wire: ProjectedLocalEdge) => wires.set(wire.id, wire))
    };
    const projection = new LocalEnrichmentProjection(graph, initial, { displayedNodeIds: [], deferredNodeIds: [owner.id] });
    projection.apply({ owner, lookupState: 'found', source: 'remote', issues: [], attempts: [],
      ...prepareRemoteOwnerInspection(owner, { actions: {
        first: { node: 'Connected A', action: 'Run' },
        second: { node: 'Connected B', action: 'Run' }
      } }) }, scene);

    expect(nodes.size).toBe(3);
    expect(wires.size).toBe(2);
    const cards = [...nodes.values()];
    for (let first = 0; first < cards.length; first += 1) {
      const a = cards[first]!;
      for (let second = first + 1; second < cards.length; second += 1) {
        const b = cards[second]!;
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x ||
          a.y + cardHeight(a) <= b.y || b.y + cardHeight(b) <= a.y).toBe(true);
      }
    }
    const xs = cards.map(({ x }) => x);
    const ys = cards.map(({ y }) => y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1_200);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1_200);
  });

  it.each([0, Number.NaN, undefined])('bounds late dense cards without a usable viewport (%s)', initialHeight => {
    const graph = buildLocalGraph({ locals: [] });
    const name = 'Late dense owner';
    const key = localNodeKey(name);
    const owner = { id: JSON.stringify(['node', key]), key, name };
    applyRemoteDiscovery(graph, { owner, lookupState: 'found' });
    let viewportHeight = initialHeight ?? 0;
    const projection = new LocalEnrichmentProjection(graph, projectLocalGraph(graph), {
      displayedNodeIds: [], deferredNodeIds: [owner.id], ...(initialHeight === undefined ? {} : { viewportHeight: () => viewportHeight })
    });
    const nodes = new Map<string, FixtureNode>();
    const wires: ProjectedLocalEdge[] = [];
    const scene = { nodes, patchCard: vi.fn(() => []), addCard: (card: FixtureNode) => { nodes.set(card.id, card); },
      addWire: (wire: ProjectedLocalEdge) => { wires.push(wire); } };
    const actions = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [
      `Call ${String(index).padStart(2, '0')}`, { node: `Peer ${index % 2}`, action: `Run ${index}` }
    ]));
    projection.apply({ owner, lookupState: 'found', source: 'remote', issues: [], attempts: [], ...prepareRemoteOwnerInspection(owner, { actions }) }, scene);

    const dense = nodes.get(localCardId(owner.id))!;
    const footprint = dense.footprint!;
    expect(dense.ports).toHaveLength(32);
    expect(footprint.rows.right).toBe(6);
    expect(footprint.overflowCount('right', 'below')).toBe(26);
    expect([...nodes.values()].every(node => node.footprint !== undefined)).toBe(true);
    const [a, b, c] = [...nodes.values()];
    for (const [one, other] of [[a!, b!], [a!, c!], [b!, c!]] as const) {
      expect(one.x + one.width <= other.x || other.x + other.width <= one.x ||
        one.y + cardHeight(one) <= other.y || other.y + cardHeight(other) <= one.y).toBe(true);
    }

    if (initialHeight !== undefined) {
      viewportHeight = 1600;
      const nextName = 'Dense after viewport';
      const nextKey = localNodeKey(nextName);
      const nextOwner = { id: JSON.stringify(['node', nextKey]), key: nextKey, name: nextName };
      applyRemoteDiscovery(graph, { owner: nextOwner, lookupState: 'found' });
      projection.apply({ owner: nextOwner, lookupState: 'found', source: 'remote', issues: [], attempts: [],
        ...prepareRemoteOwnerInspection(nextOwner, { actions }) }, scene);
      expect(nodes.get(localCardId(nextOwner.id))?.footprint?.rows.right).toBe(16);
      expect(dense.footprint).toBe(footprint);
    }
    const height = cardHeight(dense);
    const wire = wires.find(({ from }) => footprint.attachment(from.portId) && 'role' in footprint.attachment(from.portId)!)!;
    const before = portPoint(dense, wire.from.portId);
    expect(footprint.reveal(wire.from.portId).length).toBeGreaterThan(0);
    const after = portPoint(dense, wire.from.portId);
    expect(after.y).toBeLessThan(before.y);
    expect(edgeCurves(wire, nodes)[0]?.start).toEqual(after);
    expect(cardHeight(dense)).toBe(height);
    expect(footprint.resize('expand', [wire.from.portId])?.rows.right).toBe(16);
    expect(footprint.rows.right).toBe(6);
  });

  it.each([
    ['source=local', 1], ['source=local&depth=2', 2], ['source=local&depth=1', 1],
    ['source=local&depth=3', 1], ['source=local&depth=02', 1], ['source=local&depth=+2', 1],
    ['source=local&depth=2&depth=1', 1], ['source=local&depth=', 1], ['depth=2', 1], ['source=synthetic&depth=2', 1]
  ] as const)('selects inspection depth from %s', (query, depth) => {
    expect(localInspectionDepth(new URLSearchParams(query))).toBe(depth);
  });

  it('mounts disconnected inventory in a stable wrapping grid and preserves existing card positions', () => {
    const h = harness();
    const before = new Map([...h.nodes].map(([id, node]) => [id, { x: node.x, y: node.y }]));
    const discoveries = Array.from({ length: 12 }, (_, index) => {
      const name = `Inventory ${String(index).padStart(2, '0')}`;
      const key = localNodeKey(name);
      return { owner: { id: JSON.stringify(['node', key]), key, name }, lookupState: 'found' as const };
    }).reverse();
    const anchor = disconnectedInventoryAnchor(h.nodes.values());
    const draggedOrigin: FixtureNode = { ...h.nodes.values().next().value!, id: 'active-drag-origin', name: 'Active drag origin', x: anchor.x, y: anchor.y, ports: [] };
    h.scene.occupiedNodes = () => [...h.nodes.values(), draggedOrigin];
    h.projection.applyDiscoveries(discoveries, h.scene);
    const added = [...h.nodes.values()].filter(({ name }) => name.startsWith('Inventory '));
    expect(added.map(({ name }) => name)).toEqual(Array.from({ length: 12 }, (_, index) => `Inventory ${String(index).padStart(2, '0')}`));
    expect(added.slice(0, 9).every(({ y }) => y === added[0]!.y)).toBe(true);
    expect(added[9]!.y).toBeGreaterThan(added[0]!.y);
    expect(added[0]!.x).toBeGreaterThan(anchor.x); // Slot zero is reserved by the active drag origin.
    const previousRight = Math.max(...[...before].map(([, point]) => point.x + NODE_WIDTH));
    expect(added[0]!.x).toBeGreaterThanOrEqual(previousRight + 3 * (NODE_WIDTH + 150));
    for (const [id, point] of before) expect(h.nodes.get(id)).toMatchObject(point);
    const firstPositions = added.map(({ id, x, y }) => [id, x, y]);
    h.projection.applyDiscoveries([{ owner: { id: JSON.stringify(['node', localNodeKey('Inventory later')]), key: localNodeKey('Inventory later'), name: 'Inventory later' }, lookupState: 'no-route' }], h.scene);
    expect(added.map(({ id }) => h.nodes.get(id)).map((node) => [node!.id, node!.x, node!.y])).toEqual(firstPositions);
    expect(h.node('Inventory later').displayStatus).toBe('No advertised route');

    const gridPositions = added.map(({ id, x, y }) => [id, x, y]);
    const firstRow = added.find(({ name }) => name === 'Inventory 00')!;
    const nextRow = added.find(({ y }) => y > firstRow.y)!;
    h.accept('Inventory 00', { actions: {
      Child: { node: 'Growth child', action: 'Run' },
      Child2: { node: 'Growth child 2', action: 'Run 2' }
    } });
    expect(firstRow.ports).toHaveLength(2);
    expect(nextRow.y).toBeGreaterThanOrEqual(firstRow.y + disconnectedInventorySlotPitch(firstRow));
    const child = h.node('Growth child');
    const overlaps = (card: FixtureNode, other: FixtureNode) => card.x < other.x + other.width && card.x + card.width > other.x &&
      card.y < other.y + cardHeight(other) && card.y + cardHeight(card) > other.y;
    expect(added.every((card) => !overlaps(card, child))).toBe(true);
    expect(added.every((card) => !overlaps(card, h.node('Growth child 2')))).toBe(true);
    expect(added.map(({ id }) => h.nodes.get(id)).map((node) => [node!.id, node!.x, node!.y])).toEqual(gridPositions);
  });

  it.each([1, 2] as const)('inspects configured references recursively (legacy depth fixture %d)', async (_depth) => {
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
      Gamma: { actions: { Back: { node: 'Alpha', action: 'Run' }, Forward: { node: 'ThirdHop', action: 'Run' } },
        events: { Listen: { node: 'ThirdHop', event: 'Ready' } } },
      ThirdHop: {}
    };
    const lookupNames: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${origin}/REST/nodeURLs` && init?.method === 'POST') return Response.json([]);
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
      owners: h.graph.eligibleRemoteOwners, readers: createRemoteEnrichmentReaders(origin, fetcher),
      prepare: (owner, body, collect) => prepareRemoteOwnerInspection(owner, body, collect ? h.graph.nodes : undefined),
      apply(batch) {
        batches.push(batch);
        h.projection.applyDiscoveries(batch.discoveries, h.scene);
        for (const result of batch.results) h.projection.apply(result, h.scene);
      }
    });
    await run.idle;

    expect(lookupNames.slice(0, 3)).toEqual(['Alpha', 'Beta', 'Self']);
    expect(lookupNames.slice(3).sort()).toEqual(['Denied', 'Gamma', 'ThirdHop']);
    expect(fetcher).toHaveBeenCalledTimes(13);
    for (const [, init] of fetcher.mock.calls.filter(([, init]) => init?.method === 'GET')) {
      expect(init).toMatchObject({ credentials: 'omit', mode: 'cors', redirect: 'error', referrerPolicy: 'no-referrer' });
    }
    expect(batches.filter(({ finish }) => finish).map(({ finish }) => finish)).toEqual(['complete']);
    const final = batches.at(-1)!;
    expect(final.counts).toEqual({ total: 6, pending: 0, read: 3, partial: 1, unsuccessful: 2, unreachable: 1, unresolved: 0, invalid: 1, lookupFailed: 0, noRoute: 0 });
    expect(h.projection.summary(final)).toContain('0 queued');
    expect(h.projection.summary(final)).toContain('4 terminal not inspected');
    expect(h.projection.summary(final)).toContain('scheduler settled');
    expect(h.projection.summary(final)).toContain('coverage limited');
    expect(h.projection.summary(final)).toContain('1 invalid');
    expect(h.node('Alpha').displayStatus).toBe('Bindings partially loaded');
    expect(h.node('Unread Local')).toMatchObject({ origin: 'local', displayStatus: 'Not inspected' });
    expect(h.node('Denied').displayStatus).toBe('Unreachable');
    expect(h.node('Gamma').displayStatus).toBe('');
    expect(h.scene.addCard.mock.calls.filter(([node]) => localNodeKey(node.name) === localNodeKey('Gamma'))).toHaveLength(1);
    expect(h.graph.eligibleRemoteOwners.map(({ name }) => name)).toEqual(['Alpha', 'Beta', 'Denied', 'Gamma', 'Self', 'ThirdHop']);
    const wireCount = (owner: string, kind: 'action' | 'event', from: string, to: string) => [...h.edges.values()].filter((wire) =>
      wire.ownerId === h.node(owner).id && wire.bindingKind === kind && wire.from.nodeId === h.node(from).id && wire.to.nodeId === h.node(to).id).length;
    expect(wireCount('Alpha', 'action', 'Alpha', 'Gamma')).toBe(1);
    expect(wireCount('Beta', 'event', 'Gamma', 'Beta')).toBe(1);
    expect(h.node('ThirdHop').displayStatus).toBe('');
    expect(wireCount('Gamma', 'action', 'Gamma', 'ThirdHop')).toBe(1);
    expect(wireCount('Gamma', 'event', 'ThirdHop', 'Gamma')).toBe(1);
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
      { owner: h.owner('Beta'), outcome: 'unsuccessful', source: 'remote', lookupState: 'found', reason: 'invalid-data', issues: [], attempts: ['invalid-data'] },
      { owner: h.owner('Self'), outcome: 'unsuccessful', source: 'remote', lookupState: 'pending', reason: 'lookup-interrupted', issues: [], attempts: [] }
    ];
    for (const result of results) expect(h.projection.apply(result, h.scene)).toEqual(new Set());
    expect(h.scene.patchCard.mock.calls.every(([patch]) => patch.ports === undefined)).toBe(true);
    expect(h.scene.addCard).not.toHaveBeenCalled();
    expect(h.scene.addWire).not.toHaveBeenCalled();
    expect(h.node('Beta').displayStatus).toBe('Invalid response');
    expect(h.node('Beta').displayQualifier).toBe('Invalid response');
    expect(h.node('Beta').tooltip).toContain('Invalid response.');
    expect(h.node('Self').displayQualifier).toBe('Not inspected');
    expect(h.node('Self').tooltip).toContain('Not inspected.');
    const progress = h.projection.summary({ discoveries: [], inventory: { coverage: 'HTTP advertisements only', state: 'pending', local: 'known', rows: 0, discardedRows: 0, advertised: 0, omittedAdmissions: 0 }, paused: true, counts: { total: 3, pending: 1, read: 1, partial: 0, unsuccessful: 1, unreachable: 0, unresolved: 0, invalid: 1, lookupFailed: 0, noRoute: 0 }, results });
    expect(progress).toContain('3 complete');
    expect(progress).toContain('1 queued');
    expect(progress).toContain('1 terminal not inspected');
    expect(progress).toContain('1 invalid');
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
    projection.apply({ owner: remote, lookupState: 'found', source: 'remote', hostEvidence: 'remote.example:7443', issues: [], attempts: [], ...prepareRemoteOwnerInspection(remote, {}) }, scene);
    expect(patchCard.mock.calls[0]?.[0]).toMatchObject({ hostKind: 'remote', displayQualifier: '' });
    expect(nodes.get(empty.id)?.tooltip).toContain('Advertised host: remote.example:7443.');
    expect(nodes.get(empty.id)?.displayQualifier).toBe('');
    expect(nodes.get(empty.id)?.tooltip).toContain('Inspection succeeded; 0 configured bindings, none unassigned.');
  });

  it('clears the existing card host only on explicit ambiguity, not on a failed read without host evidence', () => {
    const h = harness();
    const owner = h.owner('Alpha');
    const card = h.node('Alpha');
    const discovery = { owner, lookupState: 'found' } as const;
    h.projection.applyDiscoveries([{ ...discovery, hostEvidence: 'remote.example' }], h.scene);
    expect(card.hostKind).toBe('remote');
    expect(card.tooltip).toContain('Advertised host: remote.example.');

    h.projection.applyDiscoveries([discovery], h.scene);
    h.projection.apply({ ...discovery, source: 'remote', outcome: 'unsuccessful', reason: 'transport', issues: [], attempts: ['transport'] }, h.scene);
    expect(h.graph.nodes.get(owner.id)?.hostEvidence).toBe('remote.example');
    expect(card.hostKind).toBe('remote');
    expect(card.tooltip).toContain('Advertised host: remote.example.');

    h.projection.applyDiscoveries([{ ...discovery, hostEvidence: null }], h.scene);
    expect(h.graph.nodes.get(owner.id)).not.toHaveProperty('hostEvidence');
    expect(h.node('Alpha')).toBe(card);
    expect(card.hostKind).toBe('unknown');
    expect(card.tooltip).not.toContain('remote.example');
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

  it('reserves all 100 sibling insertions before mounting them, without moving the owner', () => {
    const h = harness();
    const owner = h.node('Alpha');
    const before = { x: owner.x, y: owner.y };
    const names = Array.from({ length: 100 }, (_, i) => `Target${i}`);
    h.accept('Alpha', { actions: Object.fromEntries(names.map(name => [name, { node: name, action: 'Run' }])) });
    const peers = names.map(name => h.node(name)).sort((a, b) => a.y - b.y);
    expect(owner).toMatchObject(before);
    for (const [i, peer] of peers.entries()) {
      expect(peer.x).toBe(owner.x + owner.width + 150);
      if (i > 0) expect(peer.y).toBeGreaterThanOrEqual(peers[i - 1]!.y + cardHeight(peers[i - 1]!));
    }
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

  it('reuses physical limiter reservations across page generations', () => {
    const pageScope = {};
    const firstGeneration = getPageEnrichmentLimiter(pageScope);
    const oldRead = firstGeneration.tryStart();
    const restoredGeneration = getPageEnrichmentLimiter(pageScope);
    expect(restoredGeneration).toBe(firstGeneration);
    expect(restoredGeneration.active).toBe(1);
    oldRead?.();
    expect(restoredGeneration.active).toBe(0);
  });

  it('waits for nonzero size and an intervening frame; BFCache freeze flushes while authorised', () => {
    const paint = frames();
    const lifetime = createEnrichmentLifetime(paint);
    const freeze = vi.fn(() => expect(lifetime.signal.aborted).toBe(false));
    const resume = vi.fn();
    const start = vi.fn(() => lifetime.attach({ freeze, resume }));
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
    lifetime.resume();
    expect(resume).toHaveBeenCalledTimes(1);
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
    const resume = vi.fn();
    activeLifetime.attach({ freeze, resume });
    const aborted = vi.fn(() => expect(activeLifetime.canStart).toBe(false));
    activeLifetime.signal.addEventListener('abort', aborted);
    activeLifetime.cancel();
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(freeze).not.toHaveBeenCalled();
  });

  it('recovers interrupted Stage A and Stage B after persisted source-selector navigation', async () => {
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
    enrichment.freeze();
    snapshot.suspend();
    expect(attempts[0]?.signal.aborted).toBe(true);
    snapshot.suspend(); // Retained pagehide; Stage A is already suspended.
    enrichment.freeze();
    enrichment.resume();
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
    expect(startEnrichment).toHaveBeenCalledTimes(1);

    snapshot.suspend();
    snapshot.restore();
    expect(attempts).toHaveLength(2); // A mounted scene is retained, not remounted.
  });

  it('resumes the pending post-paint Stage B start after BFCache interrupts Stage A', async () => {
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
    snapshot.suspend();
    enrichment.freeze();
    expect(attempts[0]!.signal.aborted).toBe(true);
    enrichment.resume();
    snapshot.restore();
    expect(attempts).toHaveLength(2);
    attempts[0]!.deliver('stale stage A');
    attempts[1]!.deliver('restored stage A');
    await Promise.resolve();
    await Promise.resolve();
    expect(mount.mock.calls).toEqual([['restored stage A']]);
    enrichment.sized();
    paint.fire();
    enrichment.freeze(); // Interrupt before the callback's second frame.
    expect(paint.queue.size).toBe(0);
    enrichment.resume();
    paint.fire();
    paint.fire();
    expect(startEnrichment).toHaveBeenCalledTimes(1);
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
