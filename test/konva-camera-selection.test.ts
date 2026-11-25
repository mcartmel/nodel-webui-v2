import { describe, expect, it } from 'vitest';
import { graphBounds, traceChanges, traceConnections, type SocketId } from '../src/experiments/konva-canvas/camera-selection';
import { PORT_ROW_HEIGHT } from '../src/experiments/konva-canvas/fixture';
import { hitsSocket, SocketGesture, socketHitRadius } from '../src/experiments/konva-canvas/socket-gesture';
import type { FixtureEdge, FixtureNode } from '../src/experiments/konva-canvas/fixture';

const node = (id: string, x = 0, ports?: FixtureNode['ports']): FixtureNode => ({
  id, name: id, x, y: 0, width: 100,
  ports: ports ?? [{ id: 'out', label: 'out', direction: 'out', side: 'right' }, { id: 'in', label: 'in', direction: 'in', side: 'left' }]
});

const edge = (id: string, from: string, to: string): FixtureEdge => ({
  id, from: { nodeId: from, portId: 'out' }, to: { nodeId: to, portId: 'in' }
});
const socket = (nodeId: string, portId: string): SocketId => ({ nodeId, portId });
const indexed = (edges: FixtureEdge[]) => {
  const byPort = new Map<string, Map<string, Set<string>>>();
  function add(edge: FixtureEdge) {
    for (const { nodeId, portId } of [edge.from, edge.to]) {
      const ports = byPort.get(nodeId) ?? new Map<string, Set<string>>();
      const ids = ports.get(portId) ?? new Set<string>();
      ids.add(edge.id); ports.set(portId, ids); byPort.set(nodeId, ports);
    }
  }
  edges.forEach(add);
  const byId = new Map(edges.map(item => [item.id, item]));
  // Only random lookup is supplied: a graph-wide iteration is not permitted.
  const lookup = { get: (id: string) => byId.get(id) } as ReadonlyMap<string, FixtureEdge>;
  return { byPort, lookup, append: (edge: FixtureEdge) => { byId.set(edge.id, edge); add(edge); } };
};

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

  it('traces exact fan-out and fan-in, without following another port, a peer or a parallel binding on exact selection', () => {
    const { byPort, lookup } = indexed([
      edge('first', 'gate', 'switch'), edge('parallel', 'gate', 'switch'), edge('second', 'gate', 'preset'),
      edge('upstream', 'motion', 'gate'), edge('timer', 'timer', 'gate'), edge('downstream', 'switch', 'other')
    ]);
    const trace = (portId: string) => traceConnections({ port: socket('gate', portId), label: portId }, lookup, byPort);
    const outgoing = trace('out');
    expect(outgoing.edgeIds).toEqual(new Set(['first', 'parallel', 'second']));
    expect(trace('in').edgeIds).toEqual(new Set(['upstream', 'timer']));
    const single = traceConnections({ edgeId: 'first' }, lookup, byPort);
    expect(single.edgeIds).toEqual(new Set(['first']));
    expect(traceChanges(outgoing, single)).toEqual({ wiresChanged: true, sockets: [socket('preset', 'in')] });
    expect(traceChanges(outgoing, outgoing)).toEqual({ wiresChanged: false, sockets: [] });
  });

  it('deduplicates self-loops and keeps exact tuple identity even when IDs contain punctuation', () => {
    const a = socket('a:b', 'c'), b = socket('a', 'b:c');
    const { byPort, lookup } = indexed([
      { id: 'loop', from: a, to: a, selfLoop: true }, { id: 'other', from: b, to: socket('peer', 'port') }
    ]);
    const trace = traceConnections({ port: a, label: 'c' }, lookup, byPort);
    expect(trace.edgeIds).toEqual(new Set(['loop']));
    expect(traceChanges(trace, traceConnections(undefined, lookup, byPort))).toEqual({ wiresChanged: true, sockets: [a] });
  });

  it('re-resolves only the logical port against appended inventory, without depending on visibility', () => {
    const { byPort, lookup, append } = indexed([]);
    const target = { port: socket('gate', 'out'), label: 'Gate Output' };
    const before = traceConnections(target, lookup, byPort);
    append({ ...edge('first', 'gate', 'preset'), bindingKind: 'event' });
    append(edge('upstream', 'motion', 'gate'));
    const after = traceConnections(target, lookup, byPort);
    expect(before.edgeIds.size).toBe(0);
    expect(after.edgeIds).toEqual(new Set(['first']));
    expect(after.kinds).toEqual(new Set(['event']));
    expect(traceChanges(before, after).sockets).toEqual([socket('gate', 'out'), socket('preset', 'in')]);
  });
});

describe('socket gesture', () => {
  const hit = { ...socket('gate', 'out'), slot: {} };
  const press = (clientX = 0, pointerId = 4, pointerType = 'mouse') => ({ pointerId, clientX, clientY: 0, pointerType });

  it('hits the outside half of the circle at both zoom levels without using the whole row', () => {
    const center = { x: 0, y: 30 };
    for (const scale of [1, 0.35]) {
      const radius = socketHitRadius(scale);
      expect(hitsSocket({ x: -4, y: 30 }, center, radius)).toBe(true);
      expect(hitsSocket({ x: 4, y: 30 }, center, radius)).toBe(true);
      expect(hitsSocket({ x: 15, y: 30 }, center, radius)).toBe(false);
      expect(hitsSocket({ x: 0, y: 30 + PORT_ROW_HEIGHT / 2 }, center, radius)).toBe(false);
    }
  });

  it('activates one mouse/touch tap on the same logical socket and ignores another pointer', () => {
    const gesture = new SocketGesture();
    for (const [type, slop] of [['mouse', 5], ['touch', 8]] as const) {
      gesture.begin(press(0, 4, type), hit);
      expect(gesture.finish(press(0, 5), () => hit)).toBeUndefined();
      expect(gesture.finish(press(slop), () => ({ ...hit }))).toEqual(hit);
      expect(gesture.finish(press(), () => hit)).toBeUndefined();
      expect(gesture.ownsClick).toBe(true);
      gesture.begin(press());
      expect(gesture.ownsClick).toBe(false);
    }
  });

  it('does not activate after leaving slop, cancellation, a slot rebind, or release on another socket', () => {
    const gesture = new SocketGesture();
    gesture.begin(press(), hit);
    gesture.move(press(6));
    expect(gesture.finish(press(), () => hit)).toBeUndefined();
    gesture.begin(press(), hit);
    gesture.cancel(4);
    expect(gesture.finish(press(), () => hit)).toBeUndefined();
    gesture.begin(press(), hit);
    gesture.cancelSlot(hit.slot);
    expect(gesture.finish(press(), () => hit)).toBeUndefined();
    gesture.begin(press(), hit);
    expect(gesture.finish(press(), () => ({ ...hit, portId: 'in' }))).toBeUndefined();
    gesture.begin(press(), hit);
    expect(gesture.finish(press(), () => ({ ...hit, slot: {} }))).toBeUndefined();
    expect(gesture.ownsClick).toBe(true);
  });
});
