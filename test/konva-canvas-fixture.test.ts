import { describe, expect, it } from 'vitest';
import {
  ARROW_TIP_INSET, cardHeight, createFixture, curveArrow, curvePoint, edgeCurve, edgeCurves, fixtureEdges, fixtureNodes, portPoint, validateFixture,
  type FixtureEdge, type FixtureNode, type Point
} from '../src/experiments/konva-canvas/fixture';
import { buildLocalGraph } from '../src/experiments/konva-canvas/local-graph';
import { projectLocalGraph } from '../src/experiments/konva-canvas/local-projection';

const byId = new Map(fixtureNodes.map((node) => [node.id, node]));
const frontendOwner = { name: 'Example Frontend', readState: 'read', actions: [{ alias: 'Preset', node: 'Example 2', endpoint: 'power' }] } as const;
const exampleOwner = { name: 'Example 2', readState: 'read', actions: [{ alias: 'LogLevel', node: 'Example Frontend', endpoint: 'Preset' }] } as const;
const reciprocal = projectLocalGraph(buildLocalGraph({ locals: [frontendOwner, exampleOwner] }));
const positionById = new Map(reciprocal.nodes.map((node) => [node.id, node]));
const frontend = reciprocal.nodes.find((node) => node.name === 'Example Frontend')!;
const example = reciprocal.nodes.find((node) => node.name === 'Example 2')!;

function expectEndpointClearance(curves: ReturnType<typeof edgeCurves>, cards: FixtureNode[]) {
  for (const curve of curves) {
    for (let i = 0; i <= 80; i += 1) {
      const { x, y } = curvePoint(curve, i / 80);
      for (const card of cards) {
        const inside = x > card.x + 1e-6 && x < card.x + card.width - 1e-6 && y > card.y + 1e-6 && y < card.y + cardHeight(card) - 1e-6;
        expect(inside, `${card.name} hides the route at (${x}, ${y})`).toBe(false);
      }
    }
  }
}

function expectSeparatePaths(routes: { edge: FixtureEdge; curves: ReturnType<typeof edgeCurves> }[], context = '') {
  const paths = routes.map(({ edge, curves }) => ({
    edge,
    points: [...curves.flatMap((curve) => Array.from({ length: 32 }, (_, index) => curvePoint(curve, index / 32))), curves.at(-1)!.end]
  }));
  const orientation = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const epsilon = 1e-7;
  const onSegment = (a: Point, b: Point, point: Point) =>
    point.x >= Math.min(a.x, b.x) - epsilon && point.x <= Math.max(a.x, b.x) + epsilon &&
    point.y >= Math.min(a.y, b.y) - epsilon && point.y <= Math.max(a.y, b.y) + epsilon;
  const touches = (a: Point, b: Point, c: Point, d: Point) => {
    const abC = orientation(a, b, c);
    const abD = orientation(a, b, d);
    const cdA = orientation(c, d, a);
    const cdB = orientation(c, d, b);
    const opposite = (x: number, y: number) => x > epsilon && y < -epsilon || x < -epsilon && y > epsilon;
    return opposite(abC, abD) && opposite(cdA, cdB) ||
      Math.abs(abC) <= epsilon && onSegment(a, b, c) || Math.abs(abD) <= epsilon && onSegment(a, b, d) ||
      Math.abs(cdA) <= epsilon && onSegment(c, d, a) || Math.abs(cdB) <= epsilon && onSegment(c, d, b);
  };

  for (const [first, a] of paths.entries()) {
    for (const b of paths.slice(first + 1)) {
      if ([a.edge.from, a.edge.to].some((p) => [b.edge.from, b.edge.to].some((q) => p.nodeId === q.nodeId && p.portId === q.portId))) continue;
      const intersects = a.points.some((point, i) => i + 1 < a.points.length &&
        b.points.some((other, j) => j + 1 < b.points.length && touches(point, a.points[i + 1]!, other, b.points[j + 1]!)));
      expect(intersects, `${context} ${a.edge.id} intersects ${b.edge.id}`).toBe(false);
    }
  }
}

describe('Konva synthetic fixture geometry', () => {
  it('contains nine named cards and fourteen directed links with valid ports', () => {
    expect(validateFixture()).toEqual([]);
    expect(fixtureNodes.map((node) => node.name)).toEqual([
      'Schedule', 'Touch Panel', 'Media Player', 'Room Controller', 'Audio DSP',
      'Projector A', 'Projector B', 'Lighting', 'Room Status'
    ]);
    expect(fixtureEdges).toHaveLength(14);
  });

  it.each([
    [9, 14], [50, 77], [150, 232], [450, 700]
  ] as const)('builds a deterministic %i-card fixture with %i fully-connected edges', (nodeCount, edgeCount) => {
    const graph = createFixture(nodeCount);
    expect(graph).toEqual(createFixture(nodeCount));
    expect(graph.nodes).toHaveLength(nodeCount);
    expect(graph.edges).toHaveLength(edgeCount);
    expect(graph.nodes.slice(0, 9).map(({ id }) => id)).toEqual(fixtureNodes.map(({ id }) => id));
    expect(graph.edges.slice(0, 14).map(({ id }) => id)).toEqual(fixtureEdges.map(({ id }) => id));
    const ids = new Set(graph.nodes.map(({ id }) => id));
    expect(new Set(graph.nodes.map(({ id }) => id)).size).toBe(nodeCount);
    for (const edge of graph.edges) {
      expect(ids.has(edge.from.nodeId), edge.id).toBe(true);
      expect(ids.has(edge.to.nodeId), edge.id).toBe(true);
    }
    expect(graph.edges.length / nodeCount).toBeGreaterThan(1.5);
  });

  it('keeps cached socket rows stable across hundreds of aliases and live position updates', () => {
    const graph = createFixture(450);
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const moved = new Map(graph.nodes.map((node) => [node.id, { x: node.x + 0.5, y: node.y + 1 }]));

    for (const edge of graph.edges) {
      const source = nodes.get(edge.from.nodeId)!;
      const target = nodes.get(edge.to.nodeId)!;
      const original = edgeCurve(edge, nodes);
      const translated = edgeCurve(edge, nodes, moved);
      expect(original.start).toEqual(portPoint(source, edge.from.portId));
      expect(original.end).toEqual(portPoint(target, edge.to.portId));
      expect(translated.start).toEqual(portPoint(source, edge.from.portId, moved.get(source.id)));
      expect(translated.end).toEqual(portPoint(target, edge.to.portId, moved.get(target.id)));
      for (const key of ['start', 'control1', 'control2', 'end'] as const) {
        expect(translated[key].x - original[key].x, `${edge.id} ${key} x`).toBeCloseTo(0.5);
        expect(translated[key].y - original[key].y, `${edge.id} ${key} y`).toBeCloseTo(1);
      }
    }
  });

  it('keeps the authored cards separated in a compact 1126px-wide composition', () => {
    const left = Math.min(...fixtureNodes.map((node) => node.x));
    const right = Math.max(...fixtureNodes.map((node) => node.x + node.width));
    expect(right - left).toBeLessThanOrEqual(1250);
    for (let first = 0; first < fixtureNodes.length; first += 1) {
      const a = fixtureNodes[first]!;
      for (let second = first + 1; second < fixtureNodes.length; second += 1) {
        const b = fixtureNodes[second]!;
        const separated = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + cardHeight(a) <= b.y || b.y + cardHeight(b) <= a.y;
        expect(separated, `${a.name} overlaps ${b.name}`).toBe(true);
      }
    }
  });

  it('uses the same socket coordinates for card rows and directed curve terminals', () => {
    for (const edge of fixtureEdges) {
      const curve = edgeCurve(edge, byId);
      const source = byId.get(edge.from.nodeId)!;
      const target = byId.get(edge.to.nodeId)!;
      const sourcePort = source.ports.find((port) => port.id === edge.from.portId)!;
      const targetPort = target.ports.find((port) => port.id === edge.to.portId)!;
      expect(curve.start).toEqual(portPoint(byId.get(edge.from.nodeId)!, edge.from.portId));
      expect(curve.end).toEqual(portPoint(byId.get(edge.to.nodeId)!, edge.to.portId));
      expect(curve.control1.y).toBe(curve.start.y);
      expect(curve.control2.y).toBe(curve.end.y);
      expect(Math.sign(curve.control1.x - curve.start.x)).toBe(sourcePort.side === 'right' ? 1 : -1);
      expect(Math.sign(curve.end.x - curve.control2.x)).toBe(targetPort.side === 'left' ? 1 : -1);
      expect(edgeCurves(edge, byId)).toEqual([curve]);
    }
  });

  it('keeps every initial bezier outside all source, target, and unrelated card interiors', () => {
    for (const edge of fixtureEdges) {
      for (const curve of edgeCurves(edge, byId)) {
        for (let sample = 1; sample < 80; sample += 1) {
          const point = curvePoint(curve, sample / 80);
          for (const node of fixtureNodes) {
            const inside = point.x > node.x && point.x < node.x + node.width && point.y > node.y && point.y < node.y + cardHeight(node);
            expect(inside, `${edge.id} enters ${node.name} card interior`).toBe(false);
          }
        }
      }
    }
  });

  it('places each arrow on its cubic, pointing along the local derivative even on a steep approach', () => {
    for (const edge of fixtureEdges) {
      const target = byId.get(edge.to.nodeId)!;
      for (const dy of [0, 150]) {
        const curve = edgeCurve(edge, byId, new Map([[target.id, { x: target.x, y: target.y + dy }]]));
        const arrow = curveArrow(curve)!;
        expect(arrow.t, edge.id).toBeGreaterThan(0.7);
        expect(arrow.t, edge.id).toBeLessThan(1);
        expect(arrow.tip).toEqual(curvePoint(curve, arrow.t));
        expect(Math.hypot(arrow.tip.x - curve.end.x, arrow.tip.y - curve.end.y)).toBeCloseTo(ARROW_TIP_INSET, 2);

        const before = curvePoint(curve, arrow.t - 0.0001);
        const after = curvePoint(curve, arrow.t + 0.0001);
        const axisX = arrow.tip.x - (arrow.left.x + arrow.right.x) / 2;
        const axisY = arrow.tip.y - (arrow.left.y + arrow.right.y) / 2;
        expect(Math.atan2(axisY, axisX)).toBeCloseTo(Math.atan2(after.y - before.y, after.x - before.x), 5);
        if (edge.id === 'controller-volume' && dy === 0) expect(Math.abs(axisY)).toBeGreaterThan(2);
      }
    }
  });

  it('keeps initial wire paths separate except where links share a socket', () => {
    expectSeparatePaths(fixtureEdges.map((edge) => ({ edge, curves: edgeCurves(edge, byId) })));
  });

  it('separates the two projected Example Frontend ↔ Example 2 actions when card X ranges overlap', () => {
    const positions = new Map([[frontend.id, { x: 0, y: 0 }], [example.id, { x: 120, y: 140 }]]);
    expect(reciprocal.edges.map(({ id, from }) => [id.length % 2, positionById.get(from.nodeId)!.name])).toEqual([[0, 'Example 2'], [0, 'Example Frontend']]);
    const rails = reciprocal.edges.map((edge) => {
      const curves = edgeCurves(edge, positionById, positions);
      expect(curves[0]!.start).toEqual(portPoint(positionById.get(edge.from.nodeId)!, edge.from.portId, positions.get(edge.from.nodeId)));
      expect(curves.at(-1)!.end).toEqual(portPoint(positionById.get(edge.to.nodeId)!, edge.to.portId, positions.get(edge.to.nodeId)));
      expect(curveArrow(curves.at(-1)!)).toBeDefined();
      expectEndpointClearance(curves, reciprocal.nodes.map((card) => ({ ...card, ...positions.get(card.id) })));
      return curvePoint(curves[Math.floor(curves.length / 2)]!, 0.5).y;
    });
    expect(Math.max(...rails) - Math.min(...rails)).toBeGreaterThan(2);
    expect(Math.min(...rails)).toBeGreaterThan(0);
    expect(Math.max(...rails)).toBeLessThan(140);
  });

  it('keeps rendered reciprocal edgeCurves continuous at the x217→218 threshold', () => {
    const graph = reciprocal;
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const edge = graph.edges.find((item) => item.from.nodeId === frontend.id)!;
    expect(edge.reciprocal).toBe(true);
    const routes = [216, 217, 218, 219].map((x) => {
      const positions = new Map([[frontend.id, { x: 0, y: 0 }], [example.id, { x, y: 140 }]]);
      const curves = edgeCurves(edge, nodes, positions);
      expectEndpointClearance(curves, graph.nodes.map((card) => ({ ...card, ...positions.get(card.id) })));
      return curves;
    });
    for (let i = 1; i < routes.length; i += 1) {
      const before = routes[i - 1]!;
      const after = routes[i]!;
      const pointAt = (curves: ReturnType<typeof edgeCurves>, t: number) => {
        const scaled = Math.min(t * curves.length, curves.length - 1e-9);
        return curvePoint(curves[Math.floor(scaled)]!, scaled % 1);
      };
      for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const a = pointAt(before, t);
        const b = pointAt(after, t);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(8);
      }
    }
  });

  it('keeps a clear forward reciprocal edge direct despite a small socket Y offset', () => {
    const source: FixtureNode = { id: 'source', name: 'Source', x: 0, y: 0, width: 218,
      ports: [{ id: 'out', label: 'out', direction: 'out', side: 'right' }] };
    const target: FixtureNode = { id: 'target', name: 'Target', x: 300, y: 8, width: 218,
      ports: [{ id: 'in', label: 'in', direction: 'in', side: 'left' }] };
    const nodes = new Map([[source.id, source], [target.id, target]]);
    const edge = { id: 'forward', from: { nodeId: source.id, portId: 'out' }, to: { nodeId: target.id, portId: 'in' }, reciprocal: true };
    const curves = edgeCurves(edge, nodes);

    expect(curves).toHaveLength(1);
    const [curve] = curves;
    expect(curve!.start).toEqual(portPoint(source, 'out'));
    expect(curve!.end).toEqual(portPoint(target, 'in'));
    expect(curve!.start.y).not.toBe(curve!.end.y);
    expect(curve!.control1.x).toBeLessThanOrEqual(curve!.control2.x);
    expectEndpointClearance(curves, [source, target]);
  });

  it('gives a single backward non-reciprocal corridor route a visible socket stub', () => {
    const source: FixtureNode = { id: 'source', name: 'Source', x: 500, y: 0, width: 218,
      ports: [{ id: 'out', label: 'out', direction: 'out', side: 'right' }] };
    const target: FixtureNode = { id: 'target', name: 'Target', x: 0, y: 200, width: 218,
      ports: [{ id: 'in', label: 'in', direction: 'in', side: 'left' }] };
    const nodes = new Map([[source.id, source], [target.id, target]]);
    const edge = { id: 'single-backward', from: { nodeId: source.id, portId: 'out' }, to: { nodeId: target.id, portId: 'in' } };
    const curves = edgeCurves(edge, nodes);

    expect(curves[0]!.start).toEqual(portPoint(source, 'out'));
    expect(curves.at(-1)!.end).toEqual(portPoint(target, 'in'));
    expect(curves[0]!.end.x - curves[0]!.start.x).toBeGreaterThanOrEqual(12);
    expect(curves.at(-1)!.end.x - curves.at(-1)!.start.x).toBeGreaterThan(15);
    expectEndpointClearance(curves, [source, target]);
  });

  it.each([140, -140])('keeps both routes clear and continuous from X overlap through the 40px gap (targetY=%i)', (targetY) => {
    const source: FixtureNode = { id: 'corridor-source', name: 'Source', x: 0, y: 0, width: 218,
      ports: [
        { id: 'out', label: 'out', direction: 'out', side: 'right' },
        { id: 'in', label: 'in', direction: 'in', side: 'left' }
      ] };
    const target: FixtureNode = { id: 'corridor-target', name: 'Target', x: 258, y: targetY, width: 218,
      ports: [
        { id: 'out', label: 'out', direction: 'out', side: 'right' },
        { id: 'in', label: 'in', direction: 'in', side: 'left' }
      ] };
    const nodes = new Map([[source.id, source], [target.id, target]]);
    const edge = { id: 'vertical-corridor', from: { nodeId: source.id, portId: 'out' }, to: { nodeId: target.id, portId: 'in' }, reciprocal: true };
    const reverse = { id: 'vertical-return', from: { nodeId: target.id, portId: 'out' }, to: { nodeId: source.id, portId: 'in' }, reciprocal: true };
    const gaps = Array.from({ length: 69 }, (_, index) => index - 4);
    const routes = gaps.map((gap) => {
      const targetPosition = { x: source.width + gap, y: targetY };
      const positions = new Map([[target.id, targetPosition]]);
      const curves = edgeCurves(edge, nodes, positions);
      const cards = [source, { ...target, ...targetPosition }];
      const returnCurves = edgeCurves(reverse, nodes, positions);
      expectEndpointClearance(returnCurves, cards);
      // Interior-only checks miss a reverse lead drawn exactly over the card
      // border. Require visible clearance along both socket-side legs.
      expect(returnCurves[0]!.end.x - returnCurves[0]!.start.x).toBeGreaterThan(15);
      expect(returnCurves.at(-1)!.end.x - returnCurves.at(-1)!.start.x).toBeGreaterThan(15);
      for (const route of [curves, returnCurves]) {
        for (let index = 1; index < route.length; index += 1) expect(route[index]!.start).toEqual(route[index - 1]!.end);
      }
      const laneY = (route: ReturnType<typeof edgeCurves>) => curvePoint(route[Math.floor(route.length / 2)]!, 0.5).y;
      expect(Math.abs(laneY(curves) - laneY(returnCurves))).toBeGreaterThan(2);
      expect(returnCurves[0]!.start).toEqual(portPoint(target, 'out', targetPosition));
      expect(returnCurves.at(-1)!.end).toEqual(portPoint(source, 'in'));

      for (const curve of curves) {
        for (let sample = 0; sample <= 300; sample += 1) {
          const point = curvePoint(curve, sample / 300);
          for (const card of cards) {
            const inside = point.x > card.x + 1e-6 && point.x < card.x + card.width - 1e-6 &&
              point.y > card.y + 1e-6 && point.y < card.y + cardHeight(card) - 1e-6;
            expect(inside, `gap ${gap} enters ${card.name} at (${point.x}, ${point.y})`).toBe(false);
          }
        }
      }
      const coords = curves.flatMap((curve) => [curve.start, curve.control1, curve.control2, curve.end]);
      expect(coords.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
      if (gap >= 40) {
        expect(curves, `gap ${gap} is a single facing cubic`).toHaveLength(1);
        expect(curves[0]!.control1.x).toBeLessThanOrEqual(curves[0]!.control2.x);
        expect(Math.min(...coords.map(({ x }) => x))).toBe(source.width);
        expect(Math.max(...coords.map(({ x }) => x))).toBe(targetPosition.x);
      } else {
        expect(Math.min(...coords.map(({ x }) => x))).toBeGreaterThanOrEqual(Math.min(source.width, targetPosition.x) - 32);
        expect(Math.max(...coords.map(({ x }) => x))).toBeLessThanOrEqual(Math.max(source.width, targetPosition.x) + 32);
      }
      const sourceSocket = portPoint(source, 'out');
      const targetSocket = portPoint(target, 'in', targetPosition);
      expect(Math.min(...coords.map(({ y }) => y))).toBeGreaterThanOrEqual(Math.min(sourceSocket.y, targetSocket.y) - 1);
      expect(Math.max(...coords.map(({ y }) => y))).toBeLessThanOrEqual(Math.max(sourceSocket.y, targetSocket.y) + 1);
      expect(curves[0]!.start).toEqual(portPoint(source, 'out'));
      expect(curves.at(-1)!.end).toEqual(targetSocket);
      return curves;
    });

    const pathPoint = (curves: ReturnType<typeof edgeCurves>, t: number) => {
      const scaled = Math.min(t * curves.length, curves.length - 1e-9);
      return curvePoint(curves[Math.floor(scaled)]!, scaled % 1);
    };
    for (let index = 1; index < routes.length; index += 1) {
      for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const before = pathPoint(routes[index - 1]!, t);
        const after = pathPoint(routes[index]!, t);
        expect(Math.hypot(after.x - before.x, after.y - before.y), `gap ${gaps[index - 1]}→${gaps[index]} at ${t}`).toBeLessThan(12);
      }
    }
  });

  it('takes a bounded lower exterior route backward and stays attached through reversal', () => {
    const source: FixtureNode = { id: 'source', name: 'Source', x: 0, y: 0, width: 218,
      ports: [{ id: 'out', label: 'out', direction: 'out', side: 'right' }] };
    const target: FixtureNode = { id: 'target', name: 'Target', x: 150, y: 200, width: 218,
      ports: [{ id: 'in', label: 'in', direction: 'in', side: 'left' }] };
    const nodes = new Map([[source.id, source], [target.id, target]]);
    const edge = { id: 'backward', from: { nodeId: source.id, portId: 'out' }, to: { nodeId: target.id, portId: 'in' }, reciprocal: true };
    const backward = edgeCurves(edge, nodes);
    const coords = backward.flatMap((curve) => [curve.start, curve.control1, curve.control2, curve.end]);

    expectEndpointClearance(backward, [source, target]);
    expect(Math.max(...coords.map(({ y }) => y))).toBeGreaterThan(source.y + cardHeight(source));
    expect(Math.min(...coords.map(({ x }) => x))).toBeGreaterThanOrEqual(-52);
    expect(Math.max(...coords.map(({ x }) => x))).toBeLessThanOrEqual(target.x + target.width + 52);

    const routeAt = (gap: number) => edgeCurves(edge, nodes, new Map([[target.id, { x: source.width + gap, y: target.y }]]));
    const pointAt = (curves: ReturnType<typeof edgeCurves>, t: number) => {
      const scaled = Math.min(t * curves.length, curves.length - 1e-9);
      return curvePoint(curves[Math.floor(scaled)]!, scaled % 1);
    };
    const gaps = Array.from({ length: 99 }, (_, index) => 65 - index);
    const routes = gaps.map((gap) => ({ gap, curves: routeAt(gap) }));
    for (let i = 1; i < routes.length; i += 1) {
      const before = routes[i - 1]!.curves;
      const after = routes[i]!.curves;
      for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const a = pointAt(before, t);
        const b = pointAt(after, t);
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${routes[i - 1]!.gap}→${routes[i]!.gap} at ${t}`).toBeLessThan(20);
      }
    }
    for (const route of routes) {
      expect(route.curves[0]!.start).toEqual(portPoint(source, 'out'));
      expect(route.curves.at(-1)!.end).toEqual(portPoint(target, 'in', { x: source.width + route.gap, y: target.y }));
    }
  });

  it('keeps deterministic binding lanes distinct outside overlapping cards and while moving through reversal', () => {
    const source: FixtureNode = { id: 'lane-source', name: 'Source', x: 300, y: 100, width: 218, ports: [
      { id: 'out-a', label: 'A', direction: 'out', side: 'right' },
      { id: 'out-b', label: 'B', direction: 'out', side: 'right' }
    ] };
    const target: FixtureNode = { id: 'lane-target', name: 'Target', x: 100, y: 120, width: 218, ports: [
      { id: 'in-a', label: 'A', direction: 'in', side: 'left' },
      { id: 'in-b', label: 'B', direction: 'in', side: 'left' }
    ] };
    const nodes = new Map([[source.id, source], [target.id, target]]);
    const edges = [
      { id: 'binding-a', from: { nodeId: source.id, portId: 'out-a' }, to: { nodeId: target.id, portId: 'in-a' }, laneIndex: 0, laneCount: 2 },
      { id: 'binding-b', from: { nodeId: source.id, portId: 'out-b' }, to: { nodeId: target.id, portId: 'in-b' }, laneIndex: 1, laneCount: 2 }
    ];
    const routes = edges.map((edge) => edgeCurves(edge, nodes));
    const railY = (route: ReturnType<typeof edgeCurves>) => {
      const values = route.flatMap((curve) => [curve.start.y, curve.control1.y, curve.control2.y, curve.end.y]);
      return Math.min(...values) < 100 ? Math.min(...values) : Math.max(...values);
    };

    expect(Math.abs(railY(routes[0]!) - railY(routes[1]!))).toBeCloseTo(12);
    for (let targetX = 100; targetX <= 600; targetX += 10) {
      const positions = new Map([[target.id, { x: targetX, y: target.y }]]);
      for (const edge of edges) {
        const curves = edgeCurves(edge, nodes, positions);
        expect(curves[0]!.start).toEqual(portPoint(source, edge.from.portId));
        expect(curves.at(-1)!.end).toEqual(portPoint(target, edge.to.portId, positions.get(target.id)));
      }
    }
    const forward = edges[0]!;
    const forwardPositions = new Map([[target.id, { x: 600, y: target.y }]]);
    expect(edgeCurves(forward, nodes, forwardPositions)).toEqual([edgeCurve(forward, nodes, forwardPositions)]);
  });

  it('bounds lane spacing to the available vertical corridor and respects different card heights', () => {
    const source: FixtureNode = { id: 'short', name: 'Short', x: 0, y: 0, width: 218, ports: [
      { id: 'out-a', label: 'A', direction: 'out', side: 'right' },
      { id: 'out-b', label: 'B', direction: 'out', side: 'right' }
    ] };
    const target: FixtureNode = { id: 'tall', name: 'Tall', x: 150, y: 190, width: 218, ports: [
      { id: 'in-a', label: 'A', direction: 'in', side: 'left' },
      { id: 'in-b', label: 'B', direction: 'in', side: 'left' },
      { id: 'extra', label: 'Extra', direction: 'in', side: 'left' },
      { id: 'extra-2', label: 'Extra 2', direction: 'in', side: 'left' }
    ] };
    const nodes = new Map([[source.id, source], [target.id, target]]);
    const edges = [
      { id: 'corridor-a', from: { nodeId: source.id, portId: 'out-a' }, to: { nodeId: target.id, portId: 'in-a' }, laneIndex: 0, laneCount: 2 },
      { id: 'corridor-b', from: { nodeId: source.id, portId: 'out-b' }, to: { nodeId: target.id, portId: 'in-b' }, laneIndex: 1, laneCount: 2 }
    ];
    const routes = edges.map((edge) => edgeCurves(edge, nodes));
    const railY = (route: ReturnType<typeof edgeCurves>) => route
      .filter((curve) => curve.start.y === curve.end.y && curve.start.x !== curve.end.x)
      .sort((a, b) => Math.abs(b.end.x - b.start.x) - Math.abs(a.end.x - a.start.x))[0]!.start.y;
    const laneA = railY(routes[0]!);
    const laneB = railY(routes[1]!);

    expect(cardHeight(target)).toBeGreaterThan(cardHeight(source));
    expect(laneA).toBeGreaterThanOrEqual(source.y + cardHeight(source));
    expect(laneB).toBeLessThanOrEqual(target.y);
    expect(Math.abs(laneB - laneA)).toBeLessThanOrEqual(12);
    for (const route of routes) {
      expect(route[0]!.start.y).toBeGreaterThan(source.y);
      expect(route.at(-1)!.end.y).toBeGreaterThan(target.y);
    }
  });

  it('keeps eight backward exterior rails moving outward and clear of both cards', () => {
    const ports = Array.from({ length: 8 }, (_, index) => ({
      id: `p${index}`, label: `P${index}`, direction: 'out' as const, side: 'right' as const
    }));
    const inputs = Array.from({ length: 8 }, (_, index) => ({
      id: `p${index}`, label: `P${index}`, direction: 'in' as const, side: 'left' as const
    }));
    const source: FixtureNode = { id: 'Z', name: 'Z', x: 300, y: 0, width: 218, ports };
    const target: FixtureNode = { id: 'A', name: 'A', x: 0, y: 0, width: 218, ports: inputs };
    const nodes = new Map([[source.id, source], [target.id, target]]);
    const edges = ports.map((item, laneIndex) => ({
      id: `wire-${laneIndex}`, from: { nodeId: source.id, portId: item.id }, to: { nodeId: target.id, portId: item.id }, laneIndex, laneCount: 8
    }));
    const railY = (edge: typeof edges[number]) => {
      const route = edgeCurves(edge, nodes);
      expectEndpointClearance(route, [source, target]);
      return route.filter((curve) => curve.start.y === curve.end.y && curve.start.x !== curve.end.x)
        .sort((a, b) => Math.abs(b.end.x - b.start.x) - Math.abs(a.end.x - a.start.x))[0]!.start.y;
    };
    const rails = edges.map(railY);

    for (let index = 1; index < rails.length; index += 1) expect(rails[index - 1]! - rails[index]!).toBeCloseTo(12);
    expect(rails[0]).toBeLessThan(source.y);
  });

  it('aligns mixed independent corridor and parallel-return legs on a 12px pitch', () => {
    const upper: FixtureNode = { id: 'upper', name: 'Upper', x: 0, y: 0, width: 218,
      ports: [{ id: 'out', label: 'out', direction: 'out', side: 'right' }] };
    const lower: FixtureNode = { id: 'lower', name: 'Lower', x: 0, y: 300, width: 218,
      ports: [
        { id: 'in', label: 'in', direction: 'in', side: 'left' },
        { id: 'return-a', label: 'return A', direction: 'out', side: 'right' },
        { id: 'return-b', label: 'return B', direction: 'out', side: 'right' }
      ] };
    const peer: FixtureNode = { id: 'peer', name: 'Peer', x: -400, y: 300, width: 218,
      ports: [
        { id: 'return-a', label: 'return A', direction: 'in', side: 'left' },
        { id: 'return-b', label: 'return B', direction: 'in', side: 'left' }
      ] };
    const nodes = new Map([[upper.id, upper], [lower.id, lower], [peer.id, peer]]);
    const edges = [
      { id: 'upper-to-lower', from: { nodeId: upper.id, portId: 'out' }, to: { nodeId: lower.id, portId: 'in' } },
      { id: 'lower-return-a', from: { nodeId: lower.id, portId: 'return-a' }, to: { nodeId: peer.id, portId: 'return-a' }, laneIndex: 0, laneCount: 2 },
      { id: 'lower-return-b', from: { nodeId: lower.id, portId: 'return-b' }, to: { nodeId: peer.id, portId: 'return-b' }, laneIndex: 1, laneCount: 2 }
    ];
    const routes = edges.map((edge) => ({ edge, curves: edgeCurves(edge, nodes) }));
    const verticalLanes = routes.map(({ curves }) => {
      const lines = curves.filter((curve) => curve.start.x === curve.end.x && curve.start.y !== curve.end.y);
      return Math.max(...lines.map(({ start }) => start.x));
    }).sort((a, b) => a - b);

    // The corridor stub is 24px from the card; exterior returns start at
    // 36px and their parallel rank adds exactly one 12px lane.
    expect(verticalLanes).toEqual([242, 254, 266]);
    for (const { edge, curves } of routes) {
      expect(curves[0]!.start).toEqual(portPoint(nodes.get(edge.from.nodeId)!, edge.from.portId));
      expect(curves.at(-1)!.end).toEqual(portPoint(nodes.get(edge.to.nodeId)!, edge.to.portId));
      expectEndpointClearance(curves, [upper, lower, peer]);
    }
    // The parallel return's origin is shared only by its card, not its socket;
    // the three turn lanes remain distinct even when routes use mixed branches.
    expectSeparatePaths(routes, 'mixed independent corridor and returns:');
  });

  it('uses disjoint 12px ranks for opposed corridor groups and falls back when two lanes cannot fit', () => {
    const sidePorts = (prefix: string, direction: 'in' | 'out', side: 'left' | 'right') =>
      Array.from({ length: 7 }, (_, index) => ({ id: `${prefix}${index}`, label: `${prefix}${index}`, direction, side }));
    const a: FixtureNode = { id: 'A', name: 'A', x: 0, y: 0, width: 218, ports: [
      ...sidePorts('ai', 'in', 'left'), ...sidePorts('ao', 'out', 'right')
    ] };
    const z: FixtureNode = { id: 'Z', name: 'Z', x: 100, y: 392, width: 218, ports: [
      ...sidePorts('zi', 'in', 'left'), ...sidePorts('zo', 'out', 'right')
    ] };
    const nodes = new Map([[a.id, a], [z.id, z]]);
    const edges = [
      ...Array.from({ length: 4 }, (_, laneIndex) => ({
        id: `az-${laneIndex}`, from: { nodeId: a.id, portId: `ao${laneIndex}` }, to: { nodeId: z.id, portId: `zi${laneIndex}` }, laneIndex, laneCount: 4, oppositeLaneCount: 3, reciprocal: true
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `za-${index}`, from: { nodeId: z.id, portId: `zo${index}` }, to: { nodeId: a.id, portId: `ai${index}` }, laneIndex: index, laneCount: 3, oppositeLaneCount: 4, reciprocal: true
      }))
    ];
    const corridorRailY = (edge: typeof edges[number]) => {
      const route = edgeCurves(edge, nodes);
      expectEndpointClearance(route, [a, z]);
      return route.filter((curve) => curve.start.y === curve.end.y && curve.start.x !== curve.end.x)
        .sort((first, second) => Math.abs(second.end.x - second.start.x) - Math.abs(first.end.x - first.start.x))[0]!.start.y;
    };
    const corridorRails = edges.map(corridorRailY).sort((first, second) => first - second);

    expect(corridorRails).toEqual(Array.from({ length: 7 }, (_, index) => a.y + cardHeight(a) + 12 + index * 12));
    for (const source of [a, z]) {
      expectSeparatePaths(edges.filter((edge) => edge.from.nodeId === source.id).map((edge) => ({ edge, curves: edgeCurves(edge, nodes) })));
    }

    const shortSource: FixtureNode = { id: 'short-source', name: 'Short source', x: 0, y: 0, width: 218,
      ports: [{ id: 'out-a', label: 'A', direction: 'out', side: 'right' }, { id: 'out-b', label: 'B', direction: 'out', side: 'right' }] };
    const shortTarget: FixtureNode = { id: 'short-target', name: 'Short target', x: 100, y: cardHeight(shortSource) + 12, width: 218,
      ports: [{ id: 'in-a', label: 'A', direction: 'in', side: 'left' }, { id: 'in-b', label: 'B', direction: 'in', side: 'left' }] };
    const shortNodes = new Map([[shortSource.id, shortSource], [shortTarget.id, shortTarget]]);
    const shortEdges = [0, 1].map((laneIndex) => ({
      id: `short-${laneIndex}`, from: { nodeId: shortSource.id, portId: `out-${laneIndex ? 'b' : 'a'}` },
      to: { nodeId: shortTarget.id, portId: `in-${laneIndex ? 'b' : 'a'}` }, laneIndex, laneCount: 2
    }));
    const shortRails = shortEdges.map((edge) => {
      const route = edgeCurves(edge, shortNodes);
      expectEndpointClearance(route, [shortSource, shortTarget]);
      return route.filter((curve) => curve.start.y === curve.end.y && curve.start.x !== curve.end.x)
        .sort((first, second) => Math.abs(second.end.x - second.start.x) - Math.abs(first.end.x - first.start.x))[0]!.start.y;
    });
    expect(shortRails[0]! - shortRails[1]!).toBeCloseTo(12);
    expect(shortRails[1]).toBeGreaterThan(shortTarget.y + cardHeight(shortTarget));
  });

  it.each([2, 3, 4])('keeps %i aligned parallel routes disjoint above, below and in both corridor orientations', (count) => {
    const ports = (prefix: string, direction: 'in' | 'out', side: 'left' | 'right') =>
      Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}`, label: `${prefix}${index}`, direction, side }));
    const makeEdges = (sourceId: string, targetId: string) => Array.from({ length: count }, (_, laneIndex) => ({
      id: `fan-${laneIndex}`,
      from: { nodeId: sourceId, portId: `out${laneIndex}` },
      to: { nodeId: targetId, portId: `in${laneIndex}` },
      laneIndex,
      laneCount: count,
      reciprocal: true
    }));

    for (const [sourceId, targetId, targetY] of [['Z', 'A', 0], ['A', 'Z', 0], ['Z', 'A', 420], ['Z', 'A', -420]] as const) {
      const source: FixtureNode = { id: sourceId, name: 'Source', x: 300, y: 0, width: 218, ports: ports('out', 'out', 'right') };
      const target: FixtureNode = { id: targetId, name: 'Target', x: 0, y: targetY, width: 218, ports: ports('in', 'in', 'left') };
      const cards = new Map([[source.id, source], [target.id, target]]);
      for (const reciprocal of [true, false]) {
        const routes = makeEdges(source.id, target.id).map((edge) => ({ edge, curves: edgeCurves({ ...edge, reciprocal }, cards) }));
        expectSeparatePaths(routes, `${sourceId}→${targetId}, y=${targetY}, reciprocal=${reciprocal}:`);
        for (const { edge, curves } of routes) {
          expect(curves[0]!.start).toEqual(portPoint(source, edge.from.portId));
          expect(curves.at(-1)!.end).toEqual(portPoint(target, edge.to.portId));
          expect(curveArrow(curves.at(-1)!)).toBeDefined();
          expectEndpointClearance(curves, [source, target]);
          for (let i = 1; i < curves.length; i += 1) expect(curves[i]!.start).toEqual(curves[i - 1]!.end);
        }
      }
    }
  });

  it('keeps a vertically separated forward edge direct at a 50px gap despite lane ranks', () => {
    const source: FixtureNode = { id: 'forward-source', name: 'Source', x: 0, y: 0, width: 218,
      ports: [{ id: 'out', label: 'out', direction: 'out', side: 'right' }] };
    const target: FixtureNode = { id: 'forward-target', name: 'Target', x: 268, y: cardHeight(source) + 120, width: 218,
      ports: [{ id: 'in', label: 'in', direction: 'in', side: 'left' }] };
    const nodes = new Map([[source.id, source], [target.id, target]]);
    const edge = { id: 'forward', from: { nodeId: source.id, portId: 'out' }, to: { nodeId: target.id, portId: 'in' }, reciprocal: true, laneIndex: 3, laneCount: 5, oppositeLaneCount: 2 };
    const curves = edgeCurves(edge, nodes);
    const ordinary = edgeCurves({ id: edge.id, from: edge.from, to: edge.to, reciprocal: false }, nodes);

    expect(curves).toHaveLength(1);
    expect(curves).toEqual(ordinary);
    expect(curves[0]!.control1.x - curves[0]!.start.x).toBe(25);
    expect(curves[0]!.control2.x).toBe(curves[0]!.control1.x);
    expect(curves[0]!.end.x - curves[0]!.control2.x).toBe(25);
  });

  it('keeps the Controller/Projector/Scheduler Power State return out of the endpoint at (213,132)', () => {
    const graph = projectLocalGraph(buildLocalGraph({ locals: [
      { name: 'Controller', readState: 'read', actions: [
        { alias: 'Power On', node: 'Projector', endpoint: 'Power On' },
        { alias: 'Self Call', node: 'Controller', endpoint: 'Self Call' }
      ], events: [{ alias: 'Power State', node: 'Projector', endpoint: 'Power State' }] },
      { name: 'Projector', readState: 'read' },
      { name: 'Scheduler', readState: 'read', events: [{ alias: 'Controller Ready', node: 'Controller', endpoint: 'Ready' }] }
    ] }));
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const projector = graph.nodes.find((node) => node.name === 'Projector')!;
    const controller = graph.nodes.find((node) => node.name === 'Controller')!;
    const edge = graph.edges.find(({ from, to }) => from.nodeId === projector.id && to.nodeId === controller.id)!;
    expect(controller).toMatchObject({ x: 0, y: 0 });
    expect(cardHeight(controller)).toBeGreaterThan(132);
    const curves = edgeCurves(edge, nodes);
    expectEndpointClearance(curves, graph.nodes);
    expect(curvePoint(curves[Math.floor(curves.length / 2)]!, 0.5).y).toBeLessThan(0);
  });

  it('keeps a compact one-way route and live sockets as cards cross', () => {
    const source = { id: 'source', name: 'Example Frontend', x: 300, y: 180, width: 218,
      ports: [{ id: 'preset', label: 'Preset', direction: 'out' as const, side: 'right' as const }] };
    const target = { id: 'target', name: 'Example 2', x: 420, y: 320, width: 218,
      ports: [{ id: 'power', label: 'power', direction: 'in' as const, side: 'left' as const }] };
    const blocker = { id: 'blocker', name: 'Third card', x: 540, y: 460, width: 218,
      ports: [{ id: 'other', label: 'other', direction: 'in' as const, side: 'left' as const }] };
    const nodes = new Map<string, FixtureNode>([[source.id, source], [target.id, target], [blocker.id, blocker]]);
    const edge = { id: 'crossing', from: { nodeId: source.id, portId: 'preset' }, to: { nodeId: target.id, portId: 'power' } };
    const positions = new Map([[source.id, { x: 300, y: 180 }], [target.id, { x: 420, y: 320 }], [blocker.id, { x: 540, y: 460 }]]);
    const routed = edgeCurves(edge, nodes, positions);
    expect(Math.max(...routed.flatMap((curve) => [curve.start.y, curve.control1.y, curve.control2.y, curve.end.y]))).toBeLessThan(460);
    expect(Math.max(...routed.flatMap((curve) => [curve.start.x, curve.control1.x, curve.control2.x, curve.end.x])) - Math.min(...routed.flatMap((curve) => [curve.start.x, curve.control1.x, curve.control2.x, curve.end.x]))).toBeLessThan(500);

    for (let x = 400; x <= 540; x += 1) {
      const live = new Map(positions).set(target.id, { x, y: 320 });
      const curves = edgeCurves(edge, nodes, live);
      expect(curves[0]!.start).toEqual(portPoint(source, 'preset', live.get(source.id)));
      expect(curves.at(-1)!.end).toEqual(portPoint(target, 'power', live.get(target.id)));
      expect(curveArrow(curves.at(-1)!)).toBeDefined();
    }
  });

  it('routes self-bindings outside the card and keeps the moved sockets attached', () => {
    const node = {
      id: 'untrusted:name/with spaces', name: 'self', x: 20, y: 30, width: 218, status: 'online' as const,
      ports: [
        { id: 'out', label: 'out', direction: 'out' as const, side: 'right' as const },
        { id: 'in', label: 'in', direction: 'in' as const, side: 'left' as const }
      ]
    };
    const moved = { x: 140, y: 80 };
    const map = new Map([[node.id, node]]);
    const edge = { id: 'safe-edge', from: { nodeId: node.id, portId: 'out' }, to: { nodeId: node.id, portId: 'in' }, selfLoop: true };
    const curves = edgeCurves(edge, map);
    const shiftedCurves = edgeCurves(edge, map, new Map([[node.id, moved]]));
    expect(curves).toHaveLength(3);
    expect(curves[0]!.start).toEqual(portPoint(node, 'out'));
    expect(curves[2]!.end).toEqual(portPoint(node, 'in'));
    expect(Math.sign(curves[0]!.control1.x - curves[0]!.start.x)).toBe(1);
    expect(Math.sign(curves[2]!.end.x - curves[2]!.control2.x)).toBe(1);
    expect(shiftedCurves[0]!.start).toEqual(portPoint(node, 'out', moved));
    expect(shiftedCurves[2]!.end).toEqual(portPoint(node, 'in', moved));
    expect(shiftedCurves[1]!.start.x).toBeGreaterThan(moved.x + node.width);
    expect(shiftedCurves[1]!.end.x).toBeLessThan(moved.x);
    expect(curveArrow(curves.at(-1)!)).toBeDefined();
    for (const curve of curves) {
      for (let sample = 1; sample < 40; sample += 1) {
        const point = curvePoint(curve, sample / 40);
        expect(point.x > node.x && point.x < node.x + node.width && point.y > node.y && point.y < node.y + cardHeight(node)).toBe(false);
      }
    }
  });
});

describe('Konva local endpoint projection', () => {
  it('retains endpoint roles and binding kind/owner metadata with invoked and subscriber socket directions', () => {
    const graph = buildLocalGraph({ locals: [
      { name: 'Local A', readState: 'read', actions: [{ alias: 'Call B', node: 'Local B', endpoint: 'Do' }],
        events: [{ alias: 'Watch B', node: 'Local B', endpoint: 'Changed' }] },
      { name: 'Local B', readState: 'read', actions: [{ alias: 'Call A', node: 'Local A', endpoint: 'Do Local' }],
        events: [{ alias: 'Watch A', node: 'Local A', endpoint: 'Changed Local' }] }
    ] });
    const projection = projectLocalGraph(graph);
    const ports = projection.nodes.flatMap((node) => node.ports);

    expect(new Set(ports.map(({ localKind }) => localKind))).toEqual(new Set([
      'remote-action', 'remote-event', 'local-action', 'local-event'
    ]));
    for (const port of ports) {
      const outgoing = port.localKind === 'remote-action' || port.localKind === 'local-event';
      expect(port.direction).toBe(outgoing ? 'out' : 'in');
      expect(port.side).toBe(outgoing ? 'right' : 'left');
    }
    expect(projection.edges).toHaveLength(4);
    for (const edge of projection.edges) {
      expect(edge.bindingKind).toMatch(/^(action|event)$/);
      expect(projection.nodes.some(({ id }) => id === edge.ownerId)).toBe(true);
      const source = ports.find(({ id }) => id === edge.from.portId)!;
      const target = ports.find(({ id }) => id === edge.to.portId)!;
      if (edge.bindingKind === 'action') {
        expect(edge.ownerId).toBe(edge.from.nodeId);
        expect(source.localKind).toBe('remote-action');
        expect(target.localKind).toBe('local-action');
      } else {
        expect(edge.ownerId).toBe(edge.to.nodeId);
        expect(source.localKind).toBe('local-event');
        expect(target.localKind).toBe('remote-event');
      }
    }
    expect(fixtureNodes.flatMap((node) => node.ports).every(({ localKind }) => localKind === undefined)).toBe(true);
    expect(fixtureEdges.every(({ bindingKind, ownerId }) => bindingKind === undefined && ownerId === undefined)).toBe(true);
  });
});
