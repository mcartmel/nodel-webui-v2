import { describe, expect, it } from 'vitest';
import { placeTopologyNodes, repairTopologyPlacementCollisions, type TopologyPlacementNode, type TopologyPlacementWire } from '../src/features/topology/topology-placement';
import type { TopologyNodeId } from '../src/features/topology/topology-model';

function node(id: string, height = 160, width = 248): TopologyPlacementNode {
  return { id: id as TopologyNodeId, width, height };
}

function wire(source: string, target: string): TopologyPlacementWire {
  return { source: source as TopologyNodeId, target: target as TopologyNodeId };
}

function assertDisjoint(nodes: readonly TopologyPlacementNode[], positions: ReadonlyMap<TopologyNodeId, { x: number; y: number }>): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const left = nodes[index]!;
    const leftPoint = positions.get(left.id)!;
    for (const right of nodes.slice(index + 1)) {
      const rightPoint = positions.get(right.id)!;
      const separated = leftPoint.x + left.width + 23 <= rightPoint.x
        || rightPoint.x + right.width + 23 <= leftPoint.x
        || leftPoint.y + left.height + 23 <= rightPoint.y
        || rightPoint.y + right.height + 23 <= leftPoint.y;
      expect(separated, `${left.id} overlaps ${right.id}`).toBe(true);
    }
  }
}

function measureGeometry(nodes: readonly TopologyPlacementNode[], wires: readonly TopologyPlacementWire[]) {
  const positions = placeTopologyNodes(nodes, wires, { mode: 'auto' });
  assertDisjoint(nodes, positions);
  const rectangles = nodes.map((node) => ({ ...node, ...positions.get(node.id)! }));
  const centers = new Map(rectangles.map(({ id, x, y, width, height }) => [id, { x: x + width / 2, y: y + height / 2 }]));
  type Point = { x: number; y: number };
  const area = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const segments = wires.map(({ source, target }) => [centers.get(source)!, centers.get(target)!] as const);
  // Straight center lines are a reproducible placement-only proxy, not X6 wire routes.
  const crossings = segments.reduce((count, [a, b], index) => count + segments.slice(0, index)
    .filter(([c, d]) => area(a, b, c) * area(a, b, d) < 0 && area(c, d, a) * area(c, d, b) < 0).length, 0);
  return {
    width: Math.max(...rectangles.map(({ x, width }) => x + width)) - Math.min(...rectangles.map(({ x }) => x)),
    height: Math.max(...rectangles.map(({ y, height }) => y + height)) - Math.min(...rectangles.map(({ y }) => y)),
    crossings,
    forward: segments.filter(([source, target]) => source.x < target.x).length,
  };
}

describe('topology directed placement', () => {
  it('places source ranks to the left of target ranks and respects port-row heights', () => {
    const nodes = [node('source', 208), node('middle', 256), node('target', 160)];
    const positions = placeTopologyNodes(nodes, [wire('source', 'middle'), wire('middle', 'target')], { mode: 'initial' });
    expect(positions.get('source' as TopologyNodeId)!.x).toBeLessThan(positions.get('middle' as TopologyNodeId)!.x);
    expect(positions.get('middle' as TopologyNodeId)!.x).toBeLessThan(positions.get('target' as TopologyNodeId)!.x);
    assertDisjoint(nodes, positions);
  });

  it('layers bipartite fanout without letting parallel edges dominate ranks', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d'), node('e')];
    const wires = [wire('a', 'c'), wire('a', 'c'), wire('a', 'd'), wire('b', 'd'), wire('b', 'e')];
    const positions = placeTopologyNodes(nodes, wires, { mode: 'initial' });
    expect(positions.get('a' as TopologyNodeId)!.x).toBeLessThan(positions.get('c' as TopologyNodeId)!.x);
    expect(positions.get('b' as TopologyNodeId)!.x).toBeLessThan(positions.get('e' as TopologyNodeId)!.x);
    expect(new Map(placeTopologyNodes(nodes, wires, { mode: 'initial' }))).toEqual(positions);
    assertDisjoint(nodes, positions);
  });

  it('removes crossed fan-in/out order without depending on node or wire enumeration', () => {
    const nodes = ['a', 'b', 'x', 'y', 'z'].map((id) => node(id, 118));
    const wires = [wire('a', 'y'), wire('a', 'z'), wire('b', 'x'), wire('b', 'y')];
    expect(measureGeometry(nodes, wires)).toEqual({ width: 608, height: 434, crossings: 0, forward: 4 });
    const initial = placeTopologyNodes(nodes, wires, { mode: 'auto' });
    const shuffled = placeTopologyNodes([...nodes].reverse(), [...wires, wires[0]!, wire('b', 'b')].reverse(), { mode: 'auto' });
    expect([...initial]).toEqual([...shuffled]);
  });

  it('keeps fanout centered on the actual-height ranks and a reconvergent diamond compact', () => {
    const fanout = [node('drive', 166), node('a', 118), node('b', 142), node('c', 118)];
    const fanoutWires = [wire('drive', 'a'), wire('drive', 'b'), wire('drive', 'c')];
    expect(measureGeometry(fanout, fanoutWires)).toEqual({ width: 608, height: 458, crossings: 0, forward: 3 });
    const positions = placeTopologyNodes(fanout, fanoutWires, { mode: 'auto' });
    const y = (id: string) => positions.get(id as TopologyNodeId)!.y;
    expect(y('drive') + 166 / 2).toBe((y('a') + y('c') + 118) / 2);

    const diamond = [node('source', 118), node('branch-a', 142), node('branch-b', 118), node('target', 166)];
    const diamondWires = [wire('source', 'branch-a'), wire('source', 'branch-b'), wire('branch-a', 'target'), wire('branch-b', 'target'), wire('source', 'target')];
    expect(measureGeometry(diamond, diamondWires)).toEqual({ width: 968, height: 300, crossings: 0, forward: 5 });
  });

  it('keeps useful forward flow through the seven-node workspace feedback graph', () => {
    const nodes = [node('Hub', 166), node('RelayA', 118), node('RelayB', 142), node('Collector', 142),
      node('SensorA', 118), node('SensorB', 118), node('Controller', 118)];
    const wires = [wire('Hub', 'RelayA'), wire('Hub', 'RelayB'), wire('RelayA', 'Collector'), wire('RelayA', 'Hub'),
      wire('RelayB', 'Collector'), wire('RelayB', 'Hub'), wire('Collector', 'Hub'), wire('SensorA', 'Collector'),
      wire('SensorB', 'Collector'), wire('Controller', 'Hub')];
    expect(measureGeometry(nodes, wires)).toEqual({ width: 1328, height: 616, crossings: 0, forward: 7 });
    expect(placeTopologyNodes([...nodes].reverse(), [...wires].reverse(), { mode: 'auto' }))
      .toEqual(placeTopologyNodes(nodes, wires, { mode: 'auto' }));
  });

  it('handles cycles and self-loops deterministically while leaving route terminals to X6', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const positions = placeTopologyNodes(nodes, [wire('a', 'b'), wire('b', 'c'), wire('c', 'a'), wire('b', 'b')], { mode: 'initial' });
    expect(positions.size).toBe(3);
    expect([...positions]).toEqual([...placeTopologyNodes(nodes, [wire('a', 'b'), wire('b', 'c'), wire('c', 'a'), wire('b', 'b')], { mode: 'initial' })]);
    assertDisjoint(nodes, positions);
  });

  it('retains all nodes and uses distinct directed pairs after many parallel input rows', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const wires = [...Array.from({ length: 5000 }, () => wire('a', 'b')), wire('b', 'c')];
    const positions = placeTopologyNodes(nodes, wires, { mode: 'initial' });
    expect(positions.size).toBe(3);
    expect(positions.get('a' as TopologyNodeId)!.x).toBeLessThan(positions.get('b' as TopologyNodeId)!.x);
    expect(positions.get('b' as TopologyNodeId)!.x).toBeLessThan(positions.get('c' as TopologyNodeId)!.x);
  });

  it('does not truncate inventories above 1000 nodes', () => {
    const nodes = Array.from({ length: 1001 }, (_, index) => node(`node-${String(index).padStart(4, '0')}`));
    const positions = placeTopologyNodes(nodes, [], { mode: 'initial' });
    expect(positions.size).toBe(1001);
    expect(new Set([...positions.values()].map(({ x, y }) => `${x}:${y}`)).size).toBe(1001);
    for (const point of positions.values()) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(1_000_000);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(1_000_000);
    }
  });

  it('lays out connected inventories above 1000 nodes without requiring crossing sweeps', () => {
    const nodes = Array.from({ length: 1001 }, (_, index) => node(`chain-${String(index).padStart(4, '0')}`));
    const wires = nodes.slice(1).map(({ id }, index) => wire(nodes[index]!.id, id));
    const positions = placeTopologyNodes(nodes, wires, { mode: 'auto' });
    expect(positions.size).toBe(1001);
    expect(positions.get(nodes[0]!.id)!.x).toBeLessThan(positions.get(nodes[1000]!.id)!.x);
  });

  it('keeps generated points collision-free around hundreds of overlapping retained anchors', () => {
    const nodes = [...Array.from({ length: 400 }, (_, index) => node(`anchor-${String(index).padStart(3, '0')}`)), node('new-node')];
    const anchors = new Map<TopologyNodeId, { x: number; y: number }>(nodes.slice(0, 400).map(({ id }) => [id, { x: 0, y: 0 }]));
    const positions = placeTopologyNodes(nodes, [], { mode: 'incremental', existingPositions: anchors });
    const generated = positions.get('new-node' as TopologyNodeId)!;
    expect(generated).not.toEqual({ x: 0, y: 0 });
    for (const [, point] of anchors) {
      expect(generated.x < point.x + 248 + 24 && point.x < generated.x + 248 + 24
        && generated.y < point.y + 160 + 24 && point.y < generated.y + 160 + 24).toBe(false);
    }
  });

  it('nudges only colliding auto-positioned cards after local card growth', () => {
    const fixed = node('manual', 200);
    const automatic = node('auto', 100);
    const untouched = node('untouched', 100);
    const positions = new Map<TopologyNodeId, { x: number; y: number }>([
      [fixed.id, { x: 0, y: 0 }], [automatic.id, { x: 0, y: 120 }], [untouched.id, { x: 600, y: 0 }]
    ]);
    const repaired = repairTopologyPlacementCollisions([fixed, automatic, untouched], positions, new Set([automatic.id, untouched.id]));
    expect(repaired.get(fixed.id)).toEqual({ x: 0, y: 0 });
    expect(repaired.get(untouched.id)).toEqual({ x: 600, y: 0 });
    expect(repaired.get(automatic.id)!.y).toBeGreaterThanOrEqual(224);
    expect(positions.get(automatic.id)).toEqual({ x: 0, y: 120 });
  });

  it('clamps oversized generated layouts to the persistence coordinate range', () => {
    const nodes = Array.from({ length: 120 }, (_, index) => node(`wide-${String(index).padStart(3, '0')}`, 160, 10_000));
    const wires = nodes.slice(1).map(({ id }, index) => wire(nodes[index]!.id, id));
    const positions = placeTopologyNodes(nodes, wires, { mode: 'initial' });
    expect(positions.size).toBe(nodes.length);
    assertDisjoint(nodes, positions);
    for (const point of positions.values()) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(1_000_000);
      expect(Math.abs(point.y)).toBeLessThanOrEqual(1_000_000);
    }
  });

  it('packs isolates in a grid and gives disconnected components space', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d'), node('e'), node('f')];
    const positions = placeTopologyNodes(nodes, [wire('a', 'b'), wire('c', 'd')], { mode: 'initial' });
    expect(positions.get('e' as TopologyNodeId)!.x).not.toBe(positions.get('f' as TopologyNodeId)!.x);
    assertDisjoint(nodes, positions);
  });

  it('preserves saved/manual coordinates in initial and incremental modes', () => {
    const anchor = 'anchor' as TopologyNodeId;
    const saved = new Map([[anchor, { x: 910, y: 430 }]]);
    const nodes = [node('anchor'), node('new')];
    const first = placeTopologyNodes(nodes, [wire('anchor', 'new')], { mode: 'initial', existingPositions: saved });
    expect(first.get(anchor)).toEqual({ x: 910, y: 430 });
    expect(first.get('new' as TopologyNodeId)!.x).toBeGreaterThan(910);
    const next = placeTopologyNodes([...nodes, node('later')], [wire('anchor', 'new'), wire('new', 'later')], { mode: 'incremental', existingPositions: first });
    expect(next.get(anchor)).toEqual({ x: 910, y: 430 });
    expect(next.get('new' as TopologyNodeId)).toEqual(first.get('new' as TopologyNodeId));
    expect(next.has('later' as TopologyNodeId)).toBe(true);
  });

  it('auto layout recomputes ordinary coordinates but honors explicit manual pins', () => {
    const a = 'a' as TopologyNodeId;
    const saved = new Map<TopologyNodeId, { x: number; y: number }>([[a, { x: 700, y: 700 }]]);
    const nodes = [node('a'), node('b')];
    const unpinned = placeTopologyNodes(nodes, [wire('a', 'b')], { mode: 'auto', existingPositions: saved });
    expect(unpinned.get(a)).not.toEqual(saved.get(a));
    const pinned = placeTopologyNodes(nodes, [wire('a', 'b')], { mode: 'auto', existingPositions: saved, pinnedNodeIds: new Set([a]) });
    expect(pinned.get(a)).toEqual(saved.get(a));
    expect(pinned.get('b' as TopologyNodeId)!.x).toBeGreaterThan(700);
  });
});
