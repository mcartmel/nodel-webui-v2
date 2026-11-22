import { describe, expect, it } from 'vitest';
import { graphBounds, selectionChanges } from '../src/experiments/konva-canvas/camera-selection';
import type { FixtureEdge, FixtureNode } from '../src/experiments/konva-canvas/fixture';

const node = (id: string, x = 0, ports?: FixtureNode['ports']): FixtureNode => ({
  id, name: id, x, y: 0, width: 100,
  ports: ports ?? [{ id: 'out', label: 'out', direction: 'out', side: 'right' }, { id: 'in', label: 'in', direction: 'in', side: 'left' }]
});

const edge = (id: string, from: string, to: string): FixtureEdge => ({
  id, from: { nodeId: from, portId: 'out' }, to: { nodeId: to, portId: 'in' }
});

describe('Konva camera and selection helpers', () => {
  it('streams graph bounds beyond the JavaScript argument limit and includes curve controls', () => {
    const manyRoutes = function* () {
      for (let index = 0; index < 140_000; index += 1) {
        const x = index === 139_999 ? 250_000 : index;
        yield [{ start: { x, y: index }, control1: { x: x + 1, y: -250_000 }, control2: { x: x + 2, y: index }, end: { x: x + 3, y: index } }];
      }
    };
    expect(graphBounds([node('authored')], manyRoutes())).toEqual({ left: 0, right: 250_003, top: -250_000, bottom: 139_999 });
  });

  it('updates only old/new cards and wire endpoints, deduplicating shared sockets', () => {
    const sharedSocket = { id: 'shared-in', label: 'in', direction: 'in' as const, side: 'left' as const };
    const sharedNode = node('shared', 0, [sharedSocket]);
    const shared = (id: string, from: string): FixtureEdge => ({ id, from: { nodeId: from, portId: 'out' }, to: { nodeId: 'shared', portId: sharedSocket.id } });
    const edges = new Map([
      ['first', shared('first', 'a')],
      ['second', shared('second', 'b')]
    ]);
    const transition = selectionChanges({ edgeId: 'first' }, { edgeId: 'second' }, edges);
    expect(transition).toEqual({
      nodeIds: new Set(), edgeIds: new Set(['first', 'second']),
      socketIds: new Set(['a:out', 'shared:shared-in', 'b:out'])
    });
    expect(sharedNode.ports).toEqual([sharedSocket]);
    expect([...transition.socketIds].filter((id) => id === `shared:${sharedSocket.id}`)).toHaveLength(1);
  });

  it('clears only the old node or self-loop wire endpoints on blank selection and skips unchanged state', () => {
    const loop: FixtureEdge = { ...edge('loop', 'self', 'self'), selfLoop: true };
    const edges = new Map([[loop.id, loop]]);
    expect(selectionChanges({ edgeId: 'loop' }, {}, edges)).toEqual({
      nodeIds: new Set(), edgeIds: new Set(['loop']), socketIds: new Set(['self:out', 'self:in'])
    });
    expect(selectionChanges({ nodeId: 'self' }, {}, edges)).toEqual({
      nodeIds: new Set(['self']), edgeIds: new Set(), socketIds: new Set()
    });
    expect(selectionChanges({}, {}, edges)).toEqual({ nodeIds: new Set(), edgeIds: new Set(), socketIds: new Set() });
    expect(selectionChanges({ edgeId: 'loop' }, { edgeId: 'loop' }, edges)).toEqual({ nodeIds: new Set(), edgeIds: new Set(), socketIds: new Set() });
  });
});
