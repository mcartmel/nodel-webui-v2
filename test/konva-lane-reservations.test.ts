import { describe, expect, it } from 'vitest';
import { describeLaneRoute, LANE_LIMITS, laneSegmentsConflict, LocalLaneReservations, probeLaneBucket } from '../src/experiments/konva-canvas/lane-reservations';
import { edgeCurves, inspectRail, type FixtureEdge, type FixtureNode } from '../src/experiments/konva-canvas/fixture';

const card = (id: string, x: number, y: number, rows: number, side: 'left' | 'right'): FixtureNode => ({
  id, name: id, x, y, width: 218, ports: Array.from({ length: rows }, (_, i) => ({ id: String(i), label: String(i), side, direction: side === 'left' ? 'in' : 'out' }))
});
const wire = (id: string, source: string, target: string, fromRow = 0, toRow = 0): FixtureEdge => ({
  id, from: { nodeId: source, portId: String(fromRow) }, to: { nodeId: target, portId: String(toRow) }
});
const map = (...cards: FixtureNode[]) => new Map(cards.map(c => [c.id, c]));
function baseline(count = 2) {
  // Saved physical `overlapping-entry-legs` drop, world coordinates/DPR 1.
  const nodes = map(card('Development', 460, 100, 1, 'right'), card('Example 2', 400, 400, count + 1, 'left'), card('Frontend', 850, 400, count, 'right'));
  const moved = wire('event', 'Development', 'Example 2', 0, count);
  const fixed = Array.from({ length: count }, (_, i) => ({ ...wire(`rank-${count - i}`, 'Frontend', 'Example 2', i, i), laneIndex: i, laneCount: count }));
  return { nodes, moved, fixed };
}
const entering = (edge: FixtureEdge, nodes: Map<string, FixtureNode>) => describeLaneRoute(edge, nodes)!.eligibleSegments.find(s => s.axis === 'entryX')!.offset;

describe('side-local drop settlement', () => {
  it('repairs a short exit at gap 30 before moving the occupied 32-unit entry', () => {
    const nodes = map(card('moving', 152, 100, 1, 'right'), card('fixed', 600, 0, 1, 'right'), card('target', 400, 400, 2, 'left'));
    const moved = wire('m', 'moving', 'target', 0, 1);
    const stationary = wire('s', 'fixed', 'target');
    const before = edgeCurves(stationary, nodes);
    const raw = inspectRail(moved, nodes).rail!;
    expect(raw.end.x - raw.start.x).toBe(30);
    expect([raw.exitX - raw.start.x, raw.end.x - raw.entryX, entering(stationary, nodes)]).toEqual([10, 32, 32]);
    const r = new LocalLaneReservations(); r.seed([stationary], nodes);
    expect(r.settle([moved], nodes).fallbackCount).toBe(0);
    const { safe, rail } = inspectRail(moved, nodes);
    expect(safe).toBe(true);
    expect([rail!.exitX - raw.start.x, raw.end.x - rail!.entryX]).toEqual([12, 20]);
    expect(edgeCurves(stationary, nodes)).toEqual(before);
  });

  it.each([true, false])('drops a common cached shift for both ranks as a corridor shrinks (source above: %s)', sourceAbove => {
    // Two rows give the upper card a height of 142. Change only the live
    // position override, just as the paint/hit path can do during movement.
    const nodes = map(card('source', 500, sourceAbove ? 0 : 202, 2, 'right'), card('target', 400, sourceAbove ? 202 : 0, 2, 'left'));
    const fan = [0, 1].map(i => ({ ...wire(`rank${i}`, 'source', 'target', i, i), laneIndex: i, laneCount: 2,
      routeOffsetFamily: 'corridor' as const, routeOffset: { x: 0, y: 12 } }));
    const lower = nodes.get(sourceAbove ? 'target' : 'source')!;
    for (const [height, expected] of [[60, [36, 24]], [36, [24, 12]], [60, [36, 24]]] as const) {
      const positions = new Map([[lower.id, { x: lower.x, y: 142 + height }]]);
      expect(fan.map(e => edgeCurves(e, nodes, positions)[4]!.start.y - 142)).toEqual(expected);
      expect(fan.map(e => inspectRail(e, nodes, positions).safe)).toEqual([height === 60, height === 60]);
    }
  });

  it('moves only the true 32 entry leg to 24 against fixed exterior 36/48', () => {
    const { nodes, moved, fixed } = baseline();
    const originals = fixed.map(e => edgeCurves(e, nodes));
    const before = edgeCurves(moved, nodes);
    const cards = structuredClone(nodes);
    const r = new LocalLaneReservations(); r.seed(fixed, nodes);
    expect([entering(moved, nodes), ...fixed.map(e => entering(e, nodes))]).toEqual([32, 36, 48]);
    const result = r.settle([moved], nodes);
    expect(result.fallbackCount).toBe(0);
    expect(entering(moved, nodes)).toBe(24);
    expect(edgeCurves(moved, nodes)[2]).toEqual(before[2]);
    expect(edgeCurves(moved, nodes)[6]!.start.x).toBe(376);
    expect(fixed.map(e => edgeCurves(e, nodes))).toEqual(originals);
    expect(nodes).toEqual(cards);
    const again = r.settle([moved], nodes);
    expect(again.candidateCount).toBe(1);
    expect(again.descriptors).toEqual(result.descriptors);
  });

  it('settles the two physical exterior cases: entry 36 → 24 and top rail 32 → 20', () => {
    const { nodes, moved, fixed } = baseline();
    nodes.set('Telemetry', card('Telemetry', 460, 320, 1, 'right'));
    moved.from = { nodeId: 'Telemetry', portId: '0' };
    const r = new LocalLaneReservations(); r.seed(fixed, nodes);
    const result = r.settle([moved], nodes);
    const d = result.descriptors.get(moved.id)!;
    expect(result.fallbackCount).toBe(0);
    // Both legs end at the exterior rail. Here its natural Y is based on
    // Telemetry's top, so separation from the fixed rail is already legal.
    expect(d.family).toBe('exterior'); expect(entering(moved, nodes)).toBe(24);
    nodes.get('Telemetry')!.x = 300; nodes.get('Telemetry')!.y = 548;
    // At the second physical drop the legs are disjoint but both top rails coincide.
    const next = r.settle([moved], nodes).descriptors.get(moved.id)!;
    expect(next.eligibleSegments.find(s => s.cardId === 'Example 2' && s.side === 'top')?.offset).toBe(20);
    expect(inspectRail(moved, nodes).safe).toBe(true);
  });

  it.each(['source', 'target'])('solves a joint leg and rail conflict at shared %s, keeping the opposite leg natural', shared => {
    const nodes = map(card('s', 400, 100, 1, 'right'), card('ss', 440, 100, 1, 'right'), card('t', 420, 400, 1, 'left'), card('tt', 380, 400, 1, 'left'));
    const stationary = wire('fixed', 's', 't');
    const moving = wire('moving', shared === 'source' ? 's' : 'ss', shared === 'target' ? 't' : 'tt');
    const r = new LocalLaneReservations(); r.seed([stationary], nodes);
    const natural = describeLaneRoute(moving, nodes)!;
    const result = r.settle([moving], nodes);
    const d = result.descriptors.get(moving.id)!;
    expect(d.family).toBe('corridor'); // actual branch, even though leg exceeds both cards' right bounds
    expect(d.eligibleSegments.map(s => s.axis)).toEqual(['x', 'entryX', 'y', 'y']);
    expect(d.eligibleSegments.filter(s => s.axis === 'y').map(s => s.side)).toEqual(['bottom', 'top']);
    for (let i = 0; i < 4; i++) {
      const seg = d.eligibleSegments[i]!;
      const unsharedLeg = seg.axis === (shared === 'source' ? 'entryX' : 'x');
      expect(Math.abs(seg.offset - natural.eligibleSegments[i]!.offset)).toBe(unsharedLeg ? 0 : 12);
    }
    expect(result.fallbackCount).toBe(0);
    expect(inspectRail(moving, nodes).safe).toBe(true);
  });

  it.each([2, 3, 4])('translates all %i nested ranks together despite reverse stable IDs and pins a partial drop', count => {
    const { nodes, moved, fixed: fan } = baseline(count);
    const r = new LocalLaneReservations(); r.seed([moved], nodes);
    const initial = fan.map(e => entering(e, nodes));
    const result = r.settle([...fan].reverse(), nodes);
    expect(result.fallbackCount).toBe(0);
    expect(fan.map(e => entering(e, nodes))).toEqual(initial.map(x => x + 8));
    expect(fan.map(e => edgeCurves(e, nodes)[4]!.start.y)).toEqual(initial.map((_, i) => 368 - 12 * i));
    const rest = fan.slice(1).map(e => edgeCurves(e, nodes));
    r.settle([fan[0]!], nodes);
    expect(entering(fan[0]!, nodes)).toBe(44);
    expect(fan.slice(1).map(e => edgeCurves(e, nodes))).toEqual(rest);
  });

  it('never reserves direct, morph or self paths and drops obsolete family adjustments', () => {
    const { nodes, moved } = baseline();
    moved.routeOffset = { x: 24, y: 24 }; moved.routeOffsetFamily = 'corridor';
    const r = new LocalLaneReservations(); r.seed([moved], nodes);
    for (const gap of [34, 50, 100]) {
      nodes.get('Example 2')!.x = 678 + gap;
      const e = { ...moved, reciprocal: gap === 34 };
      expect(describeLaneRoute(e, nodes)).toBeUndefined();
      expect(edgeCurves(e, nodes)).toEqual(edgeCurves({ ...e, routeOffset: undefined }, nodes));
    }
    r.settle([moved], nodes);
    expect(r.size).toBe(0); expect(moved.routeOffset).toBeUndefined();
    expect(describeLaneRoute({ ...moved, selfLoop: true }, nodes)).toBeUndefined();
  });

  it('refuses cached legs inside the stroke or rails grazing the card even between samples', () => {
    const { nodes, moved } = baseline();
    for (const offset of [{ x: -23.8, y: 0 }, { x: 0, entryX: -33, y: 0 }, { x: 0, y: -91.8 }]) {
      const unsafe = { ...moved, routeOffset: offset, routeOffsetFamily: 'corridor' as const };
      expect(inspectRail(unsafe, nodes).safe).toBe(false);
      expect(edgeCurves(unsafe, nodes)).toEqual(edgeCurves(moved, nodes));
      new LocalLaneReservations().settle([unsafe], nodes);
      expect(inspectRail(unsafe, nodes).safe).toBe(true);
    }
  });

  it('enforces a strict comparison budget when 600 endpoints share a crowded side', () => {
    const nodes = map(card('common', 0, 0, 1, 'right'));
    const wires = Array.from({ length: 600 }, (_, i) => {
      const target = card(`target${i}`, -200, 400 + 100 * i, 1, 'left'); nodes.set(target.id, target);
      return wire(`w${i}`, 'common', target.id);
    });
    const r = new LocalLaneReservations(); r.seed(wires, nodes);
    const trial = { ...wires[599]!, id: 'new' };
    const result = r.settle([trial], nodes);
    expect(result.comparisonCount).toBe(LANE_LIMITS.comparisonsPerGroup);
    expect(result.budgetFallbackCount).toBe(1); expect(result.fallbackCount).toBe(1);
    expect(result.candidateCount).toBeLessThanOrEqual(LANE_LIMITS.trialsPerGroup);
    expect(inspectRail(trial, nodes).safe).toBe(true);
    expect(r.size).toBe(601); r.remove(trial.id); expect(r.size).toBe(600);
    const crowdedDrop = r.settle(wires.slice(0, 60), nodes);
    expect(crowdedDrop.comparisonCount).toBe(LANE_LIMITS.comparisonsPerSettlement);
    expect(crowdedDrop.budgetFallbackCount).toBeGreaterThan(1);
    r.clear(); expect(r.bucketCount).toBe(0);
  });
  it('allows disjoint longitudinal spans at identical offsets, but protects nearby bends', () => {
    const a = { cardId: 'c', side: 'left' as const, offset: 24, start: 0, end: 60 };
    expect(laneSegmentsConflict(a, { ...a, start: 75, end: 120 })).toBe(false);
    expect(laneSegmentsConflict(a, { ...a, start: 68, end: 120 })).toBe(true);
    const disjoint = Array.from({ length: 600 }, (_, i) => ({ ...a, start: 75 + i * 100, end: 120 + i * 100 }));
    const budget = { remaining: LANE_LIMITS.comparisonsPerGroup };
    expect(probeLaneBucket(a, disjoint, budget)).toBe('exhausted');
    expect(budget.remaining).toBe(0);
  });
});
