import { describe, expect, it } from 'vitest';
import { CardFootprint, canExpandFootprint, createCardFootprint, footprintHeight, initialFootprintRows, visibleRowBudget } from '../src/experiments/konva-canvas/card-footprint';
import { NODE_WIDTH, cardHeight, edgeCurves, overflowSocketOffset, portPoint, type FixtureEdge, type FixtureNode, type FixturePort } from '../src/experiments/konva-canvas/fixture';
import { portWheelStep } from '../src/experiments/konva-canvas/port-wheel';
import { buildLocalGraph } from '../src/experiments/konva-canvas/local-graph';
import { placeLocalGraph } from '../src/experiments/konva-canvas/local-placement';
import { projectLocalGraph } from '../src/experiments/konva-canvas/local-projection';

const port = (id: string, localKind: NonNullable<FixturePort['localKind']> = 'remote-action'): FixturePort => {
  const direction = localKind === 'remote-action' || localKind === 'local-event' ? 'out' : 'in';
  return { id, label: id, side: direction === 'out' ? 'right' : 'left', direction, localKind };
};
const many = (count: number, prefix: string, kind?: FixturePort['localKind']) => Array.from({ length: count }, (_, i) => port(`${prefix}-${i}`, kind));
const card = (id: string, ports: FixturePort[], complete: boolean, x = 0, y = 0): FixtureNode => ({
  id, name: id, x, y, width: NODE_WIDTH, ports, footprint: createCardFootprint(ports, complete, 650)
});

describe('real Konva card footprint', () => {
  it('packs dense and pending cards using exactly the reservation the first scene projects', () => {
    const graph = buildLocalGraph({ locals: [
      { name: 'Anchor', readState: 'read', events: ['Dense', 'Pending', 'Sparse'].map(name => ({ alias: name, node: name, endpoint: 'Report' })) },
      { name: 'Dense', readState: 'read', actions: Array.from({ length: 24 }, (_, i) => ({ alias: `Act ${i}`, node: 'Anchor', endpoint: 'Receive' })) },
      { name: 'Pending', readState: 'unread' },
      { name: 'Sparse', readState: 'read' }
    ] });
    const positions = placeLocalGraph(graph, { viewportHeight: 650 });
    const { nodes, edges } = projectLocalGraph(graph, positions);
    const [dense, pending, sparse] = ['Dense', 'Pending', 'Sparse'].map(name => nodes.find(node => node.name === name)!);
    expect(dense!.footprint?.rows.right).toBe(12);
    expect(pending!.footprint?.rows.right).toBe(3);
    expect(dense!.x).toBe(pending!.x);
    expect(pending!.x).toBe(sparse!.x);
    expect(pending!.y - dense!.y - cardHeight(dense!)).toBe(28);
    expect(sparse!.y - pending!.y - cardHeight(pending!)).toBe(28);
    expect(edges).toHaveLength(27);
  });

  it('uses a side-local row budget, tolerates twelve rows at 650 and reserves a dormant rail even on empty cards', () => {
    expect(visibleRowBudget(300)).toBe(6);
    expect(visibleRowBudget(650)).toBe(12);
    expect(visibleRowBudget(1600)).toBe(16);
    expect(initialFootprintRows({ left: 6, right: 6 }, true, 650)).toEqual({ left: 6, right: 6 });
    expect(initialFootprintRows({ left: 12, right: 1 }, false, 650)).toEqual({ left: 12, right: 3 });
    const empty = card('empty', [], true);
    expect(cardHeight(empty)).toBeGreaterThan(90);
    expect(empty.footprint!.overflowCount('left') + empty.footprint!.overflowCount('right')).toBe(0);
    expect(cardHeight(card('normal', many(12, 'right'), true))).toBe(footprintHeight({ left: 0, right: 12 }));
    const dense = card('dense', many(25, 'right'), true);
    expect(dense.footprint!.overflowCount('right')).toBe(13);
  });

  it('retains old sockets and size across reordered enrichment, shared takeoffs and drag', () => {
    const source = card('source', [port('old-b'), port('old-c')], false);
    const peer = card('peer', [port('target', 'local-action')], true, 400, 320);
    const occupied = card('neighbour', [], true, 0, cardHeight(source) + 28);
    const reservedHeight = cardHeight(source);
    const startingSockets = ['old-b', 'old-c'].map(id => portPoint(source, id));
    const late = [port('a-fills-first'), port('a-fills-second'), ...many(20, 'late'), port('published', 'local-event')];
    source.ports = [...late, ...source.ports];
    source.footprint!.append(source.ports);
    expect(cardHeight(source)).toBe(reservedHeight);
    expect(occupied.y - cardHeight(source)).toBe(28);
    expect(['old-b', 'old-c'].map(id => portPoint(source, id))).toEqual(startingSockets);
    expect(source.footprint!.overflowCount('left')).toBe(0);
    expect(source.footprint!.overflowCount('right')).toBe(21);
    expect(portPoint(source, 'late-0')).toEqual(portPoint(source, 'late-1'));
    expect(portPoint(source, 'published').y).toBeGreaterThan(portPoint(source, 'late-0').y);
    expect(portPoint(source, 'published').y).toBeLessThan(source.y + cardHeight(source));

    const edges: FixtureEdge[] = ['late-0', 'late-1'].map(id => ({ id, from: { nodeId: source.id, portId: id }, to: { nodeId: peer.id, portId: 'target' } }));
    const nodes = new Map([[source.id, source], [peer.id, peer]]);
    const drag = new Map([[source.id, { x: 100, y: 150 }]]);
    for (const edge of edges) {
      const route = edgeCurves(edge, nodes, drag);
      expect(route[0]?.start).toEqual(portPoint(source, edge.from.portId, drag.get(source.id)));
      expect(route.at(-1)?.end).toEqual(portPoint(peer, 'target'));
    }
  });

  it('previews expansion without mutations, checks live/reserved drag rectangles and restores compact slots explicitly', () => {
    const origin = card('origin', [port('first')], false);
    const late = many(23, 'later');
    origin.ports = [...origin.ports, ...late];
    origin.footprint!.append(late);
    const compactHeight = cardHeight(origin);
    const latePoint = portPoint(origin, 'later-4');
    const proposed = origin.footprint!.resize('expand')!;
    expect(proposed.rows.right).toBe(16);
    expect(proposed.overflowCount('right')).toBe(8);
    const dragOrigin = card('drag-origin:peer', [], true, 0, compactHeight + 28);
    const dragLive = card('peer', [], true, 600, 0);
    expect(canExpandFootprint(origin, proposed, [origin, dragOrigin, dragLive])).toBe(false);
    expect(canExpandFootprint(origin, proposed, [origin, dragLive])).toBe(true);
    expect(cardHeight(origin)).toBe(compactHeight);
    expect(portPoint(origin, 'later-4')).toEqual(latePoint);
    origin.footprint = proposed;
    expect(portPoint(origin, 'later-4')).not.toEqual(latePoint);
    origin.footprint = proposed.resize('compact')!;
    expect(cardHeight(origin)).toBe(compactHeight);
    expect(portPoint(origin, 'later-4')).toEqual(latePoint);
  });

  it.each([0, 1, 16, 17, 244])('allocates a capped window for %i ports', count => {
    const footprint = createCardFootprint(many(count, 'port'), true, 1600);
    expect([...footprint.visible('right')]).toHaveLength(Math.min(16, count));
    expect(footprint.overflowCount('right', 'above')).toBe(0);
    expect(footprint.overflowCount('right', 'below')).toBe(Math.max(0, count - 16));
    footprint.move('right', Number.MAX_SAFE_INTEGER);
    expect(footprint.overflowCount('right', 'above')).toBe(Math.max(0, count - 16));
    expect(footprint.overflowCount('right', 'below')).toBe(0);
    expect(footprint.move('right', Number.MAX_SAFE_INTEGER)).toEqual([]);
    footprint.move('right', -100);
    expect(footprint.start('right')).toBe(0);
  });

  it('reports exactly the ports whose seats change, including rail-to-rail jumps, while retaining the other side', () => {
    const right = Array.from({ length: 244 }, (_, i) => port(`out-${i}`, i % 2 ? 'local-event' : 'remote-action'));
    const left = many(17, 'in', 'local-action');
    const footprint = new CardFootprint({ right: 16, left: 8 });
    footprint.append([...right, ...left]);
    footprint.move('left', 4);
    const before = new Map(right.map(({ id }) => [id, footprint.attachment(id)]));
    const leftBefore = [...footprint.visible('left')];
    expect(footprint.move('right', 124)).toEqual(right.filter(({ id, side }, rank) => {
      const prior = before.get(id)!;
      const next = footprint.attachment(id)!;
      expect(next.side).toBe(side);
      if (rank >= 16 && rank < 124) expect(next).toMatchObject({ direction: 'above' });
      return JSON.stringify(prior) !== JSON.stringify(next);
    }).map(({ id }) => id));
    expect([...footprint.visible('left')]).toEqual(leftBefore);
    expect(footprint.overflowCount('right', 'above', 'local')).toBe(62);
    expect(footprint.overflowCount('right', 'above', 'alias')).toBe(62);
    expect(footprint.overflowCount('right', 'below')).toBe(104);
    const source: FixtureNode = { id: 'source', name: '', width: 218, x: 12, y: 35, ports: right, footprint };
    expect(portPoint(source, 'out-1').y).toBe(source.y + footprint.railTop('above') + overflowSocketOffset('above', 'local'));
    expect(portPoint(source, 'out-243').y).toBe(source.y + footprint.railTop('below') + overflowSocketOffset('below', 'local'));
    expect(portPoint(source, 'out-0').y).toBeLessThan(portPoint(source, 'out-1').y);
    expect(footprint.move('right', 125)).toHaveLength(17); // 15 retained seats plus the leaving and entering ranks.
    footprint.append([port('late'), { ...right[126]!, label: 'Exact late label' }]);
    expect(footprint.start('right')).toBe(125);
    expect([...footprint.visible('right')][1]?.label).toBe('Exact late label');
    expect(footprint.overflowCount('right', 'below')).toBe(104);
  });

  it('keeps a late zero-row side on chooser fallback until a safe expansion and preserves the revealed port through resize', () => {
    const footprint = new CardFootprint({ right: 0, left: 4 });
    footprint.append([...many(30, 'left', 'local-action'), ...many(24, 'late')]);
    expect(footprint.canScroll('right')).toBe(false);
    expect(footprint.reveal('late-23')).toEqual([]);
    expect(footprint.attachment('late-23')).toEqual({ side: 'right', direction: 'below', role: 'alias' });
    footprint.reveal('left-29');
    const expanded = footprint.resize('expand', ['left-29', 'late-23'])!;
    expect(expanded.attachment('late-23')).toEqual({ side: 'right', row: 15 });
    expect(expanded.start('left')).toBe(14);
    const compact = expanded.resize('compact', ['left-29', 'late-23'])!;
    expect(compact.attachment('left-29')).toEqual({ side: 'left', row: 3 });
    expect(compact.attachment('late-23')).toEqual({ side: 'right', direction: 'below', role: 'alias' });
    expect(compact.height).toBe(footprint.height);
  });

  it('normalizes pixel, line and page deltas for equal travel with B rows and C windows', () => {
    expect(portWheelStep(7, 0, 12, 0, 'B')).toEqual({ rows: 0, remainder: 7 });
    expect(portWheelStep(1, 1, 12, 9, 'B')).toEqual({ rows: 1, remainder: 1 });
    expect(portWheelStep(-5, 0, 12, 7, 'B')).toEqual({ rows: 0, remainder: 2 });
    expect(portWheelStep(-1, 2, 12, 0, 'B')).toEqual({ rows: -12, remainder: 0 });
    expect(portWheelStep(-1, 2, 12, 0, 'C')).toEqual({ rows: -12, remainder: 0 });
    expect(portWheelStep(24, 0, 12, 0, 'C')).toEqual({ rows: 0, remainder: 24 });
    expect(portWheelStep(264, 0, 12, 24, 'C')).toEqual({ rows: 12, remainder: 0 });
    expect(portWheelStep(264, 0, 12, 24, 'D')).toEqual({ rows: 12, remainder: 0 });
  });
});
