import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LocalLaneReservations } from '../src/experiments/konva-canvas/lane-reservations';
import type { FixtureEdge, FixtureNode } from '../src/experiments/konva-canvas/fixture';

const mainSource = readFileSync(resolve(process.cwd(), 'src/experiments/konva-canvas/main.ts'), 'utf8');
const handler = (name: 'dragstart' | 'dragmove' | 'dragend') => {
  const start = mainSource.indexOf(`group.on('${name}'`);
  const next = name === 'dragstart' ? 'group.on(\'dragmove\'' : name === 'dragmove' ? 'group.on(\'dragend\'' : 'return group;';
  const end = mainSource.indexOf(next, start + 1);
  return mainSource.slice(start, end < 0 ? undefined : end);
};

const node: FixtureNode = { id: 'moving', name: 'Moving', x: 0, y: 0, width: 218,
  ports: [{ id: 'out', label: 'out', direction: 'out', side: 'right' }] };
const peer: FixtureNode = { id: 'peer', name: 'Peer', x: 100, y: 220, width: 218,
  ports: [{ id: 'in', label: 'in', direction: 'in', side: 'left' }] };
const nodes = new Map([[node.id, node], [peer.id, peer]]);
const edge: FixtureEdge = { id: 'incident', from: { nodeId: node.id, portId: 'out' }, to: { nodeId: peer.id, portId: 'in' } };

describe('Konva lane lifecycle integration', () => {
  it('releases at dragstart, does not allocate on dragmove, and restores once after enrichment and return-to-origin', () => {
    const reservations = new LocalLaneReservations();
    reservations.seed([edge], nodes);
    const settle = vi.spyOn(reservations, 'settle');

    // Mirrors Konva's ordered start → move → enrichment → move-back → end sequence.
    reservations.remove(edge.id);
    expect(reservations.size).toBe(0);
    expect(settle).not.toHaveBeenCalled();
    node.x = 36;
    expect(settle).not.toHaveBeenCalled();

    // A geometry-changing enrichment for the active endpoint invalidates its old slot;
    // the active drag records it for release instead of settling against stale geometry.
    reservations.remove(edge.id);
    node.x = 0;
    expect(settle).not.toHaveBeenCalled();
    reservations.settle([edge], nodes);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(reservations.size).toBe(1);
  });

  it('wires release, movement and end as distinct handlers; synthetic and camera paths cannot settle', () => {
    const start = handler('dragstart');
    const move = handler('dragmove');
    const end = handler('dragend');
    expect(mainSource.indexOf("group.on('dragstart'")).toBeLessThan(mainSource.indexOf("group.on('dragmove'"));
    expect(mainSource.indexOf("group.on('dragmove'")).toBeLessThan(mainSource.indexOf("group.on('dragend'"));
    expect(start).toContain('if (!localMode) return;');
    expect(start).toContain('releaseCardLaneReservations(node)');
    expect(start).not.toContain('laneReservations.settle');
    expect(move).toContain('moveCard(node, group)');
    expect(move).not.toContain('laneReservations.settle');
    expect(end).toContain('drag.didMove');
    expect(end).toContain('drag?.deferredEdgeIds.size');
    expect(end).toContain('settleCardLanes(node, drag?.deferredEdgeIds)');
    expect(end).toContain('if (!localMode)');
    const panZoomAndReset = mainSource.slice(mainSource.indexOf('function setZoom'), mainSource.indexOf('function initialize'));
    expect(panZoomAndReset).not.toContain('settleCardLanes');
  });

  it('defers and removes enrichment reservations on active edges, then batches their release with incident edges', () => {
    const source = mainSource.slice(mainSource.indexOf('const eligibleForSettlement'), mainSource.indexOf('if (localFraming.revision'));
    expect(source).toContain('sourceDrag?.deferredEdgeIds.add(id)');
    expect(source).toContain('targetDrag?.deferredEdgeIds.add(id)');
    expect(source).toContain('for (const id of deferred)');
    expect(source).toContain('laneReservations.remove(id)');
    expect(source).toContain('filter((id) => !deferred.has(id))');
  });

  it('waits for both active endpoints and enrichment to finish before reserving their shared edge', () => {
    const reservations = new LocalLaneReservations();
    reservations.seed([edge], nodes);
    const settle = vi.spyOn(reservations, 'settle');
    const firstDeferred = new Set<string>();
    const secondDeferred = new Set<string>();
    const active = new Map([[node.id, firstDeferred], [peer.id, secondDeferred]]);
    reservations.remove(edge.id); // Each dragstart releases its own incident set; repeated removal is safe.
    reservations.remove(edge.id);

    // Active-edge enrichment defers into both endpoint lifetimes.
    firstDeferred.add(edge.id);
    secondDeferred.add(edge.id);
    reservations.remove(edge.id);

    active.delete(node.id);
    if (active.has(peer.id)) secondDeferred.add(edge.id);
    expect(settle).not.toHaveBeenCalled();
    expect(reservations.size).toBe(0);

    active.delete(peer.id);
    reservations.settle([edge], nodes);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(reservations.size).toBe(1);

    const settlement = mainSource.slice(mainSource.indexOf('function settleCardLanes'), mainSource.indexOf('function updateHostGlyphKind'));
    expect(settlement).toContain('activeDrags.get(edge.from.nodeId)');
    expect(settlement).toContain('activeDrags.get(edge.to.nodeId)');
    expect(settlement).toContain('sourceDrag?.deferredEdgeIds.add(edgeId)');
    expect(settlement).toContain('targetDrag?.deferredEdgeIds.add(edgeId)');
  });

  it('seeds lane reservations only for the local read-only scene', () => {
    const install = mainSource.slice(mainSource.indexOf('function installGraph'), mainSource.indexOf('async function loadLocalGraph'));
    expect(install).toContain('if (localMode) laneReservations.seed(edges, nodeById)');
  });
});
