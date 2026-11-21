import { describe, expect, it } from 'vitest';
import {
  ARROW_TIP_INSET, cardHeight, createFixture, curveArrow, curvePoint, edgeCurve, edgeCurves, fixtureEdges, fixtureNodes, portPoint, validateFixture
} from '../src/experiments/konva-canvas/fixture';

const byId = new Map(fixtureNodes.map((node) => [node.id, node]));

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
      expect(edgeCurves(edge, byId)).toHaveLength(1);
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
    const paths = fixtureEdges.map((edge) => ({ edge, points: edgeCurves(edge, byId).flatMap((curve) => Array.from({ length: 33 }, (_, index) => curvePoint(curve, index / 32))) }));
    const orientation = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) =>
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const onSegment = (a: { x: number; y: number }, b: { x: number; y: number }, point: { x: number; y: number }) =>
      point.x >= Math.min(a.x, b.x) - 1e-7 && point.x <= Math.max(a.x, b.x) + 1e-7 &&
      point.y >= Math.min(a.y, b.y) - 1e-7 && point.y <= Math.max(a.y, b.y) + 1e-7;
    const touches = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) => {
      const abC = orientation(a, b, c);
      const abD = orientation(a, b, d);
      const cdA = orientation(c, d, a);
      const cdB = orientation(c, d, b);
      if ((abC > 1e-7 && abD < -1e-7 || abC < -1e-7 && abD > 1e-7) &&
          (cdA > 1e-7 && cdB < -1e-7 || cdA < -1e-7 && cdB > 1e-7)) return true;
      return Math.abs(abC) <= 1e-7 && onSegment(a, b, c) || Math.abs(abD) <= 1e-7 && onSegment(a, b, d) ||
        Math.abs(cdA) <= 1e-7 && onSegment(c, d, a) || Math.abs(cdB) <= 1e-7 && onSegment(c, d, b);
    };
    const sharesSocket = (a: typeof fixtureEdges[number], b: typeof fixtureEdges[number]) =>
      a.from.nodeId === b.from.nodeId && a.from.portId === b.from.portId ||
      a.to.nodeId === b.to.nodeId && a.to.portId === b.to.portId ||
      a.from.nodeId === b.to.nodeId && a.from.portId === b.to.portId ||
      a.to.nodeId === b.from.nodeId && a.to.portId === b.from.portId;

    for (let first = 0; first < paths.length; first += 1) {
      for (let second = first + 1; second < paths.length; second += 1) {
        const a = paths[first]!;
        const b = paths[second]!;
        if (sharesSocket(a.edge, b.edge)) continue;
        for (let aPoint = 0; aPoint < a.points.length - 1; aPoint += 1) {
          for (let bPoint = 0; bPoint < b.points.length - 1; bPoint += 1) {
            expect(touches(a.points[aPoint]!, a.points[aPoint + 1]!, b.points[bPoint]!, b.points[bPoint + 1]!)).toBe(false);
          }
        }
      }
    }
  });

  it('keeps socket-facing tangents and continuous coordinates when a target crosses its source', () => {
    const edge = fixtureEdges.find((item) => item.id === 'panel-status')!;
    const touchPanel = byId.get('touch-panel')!;
    const roomStatus = byId.get('room-status')!;
    const before = edgeCurve(edge, byId, new Map([[roomStatus.id, { x: touchPanel.x + touchPanel.width - 1, y: 650 }]]));
    const after = edgeCurve(edge, byId, new Map([[roomStatus.id, { x: touchPanel.x + touchPanel.width, y: 650 }]]));
    const source = touchPanel.ports.find((port) => port.id === edge.from.portId)!;
    const target = roomStatus.ports.find((port) => port.id === edge.to.portId)!;
    expect(Math.sign(before.control1.x - before.start.x)).toBe(source.side === 'right' ? 1 : -1);
    expect(Math.sign(after.control1.x - after.start.x)).toBe(source.side === 'right' ? 1 : -1);
    expect(Math.sign(before.end.x - before.control2.x)).toBe(target.side === 'left' ? 1 : -1);
    expect(Math.sign(after.end.x - after.control2.x)).toBe(target.side === 'left' ? 1 : -1);
    for (let index = 0; index <= 20; index += 1) {
      const t = index / 20;
      const a = curvePoint(before, t);
      const b = curvePoint(after, t);
      expect(Math.hypot(a.x - b.x, a.y - b.y), `one-pixel drag at t=${t}`).toBeLessThanOrEqual(1.01);
    }
  });
});
