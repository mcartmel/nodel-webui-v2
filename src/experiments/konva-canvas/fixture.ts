export type PortSide = 'left' | 'right';
export type PortDirection = 'in' | 'out';

export interface FixturePort {
  id: string;
  label: string;
  direction: PortDirection;
  side: PortSide;
}

export interface FixtureNode {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  ports: readonly FixturePort[];
  status: 'online' | 'standby';
}

export interface FixtureEdge {
  id: string;
  from: { nodeId: string; portId: string };
  to: { nodeId: string; portId: string };
}

const port = (id: string, label: string, direction: PortDirection, side: PortSide): FixturePort => ({ id, label, direction, side });

export const NODE_WIDTH = 218;
export const CARD_HEADER_HEIGHT = 62;
export const PORT_ROW_HEIGHT = 26;
export const PORTS_TOP = 76;
export const ARROW_TIP_INSET = 15;

export const fixtureNodes: readonly FixtureNode[] = [
  { id: 'schedule', name: 'Schedule', x: 42, y: 120, width: NODE_WIDTH, status: 'online', ports: [port('scene', 'Scene call', 'out', 'right'), port('clock', 'Clock sync', 'out', 'right'), port('mode', 'Room mode', 'out', 'right')] },
  { id: 'touch-panel', name: 'Touch Panel', x: 640, y: 410, width: NODE_WIDTH, status: 'online', ports: [port('room', 'Room control', 'out', 'left'), port('status', 'Panel status', 'out', 'right')] },
  { id: 'media-player', name: 'Media Player', x: 340, y: 620, width: NODE_WIDTH, status: 'standby', ports: [port('audio', 'Audio feed', 'out', 'right'), port('playback', 'Playback', 'out', 'right')] },
  { id: 'room-controller', name: 'Room Controller', x: 340, y: 220, width: NODE_WIDTH, status: 'online', ports: [port('scene-in', 'Scene call', 'in', 'left'), port('clock-in', 'Clock sync', 'in', 'left'), port('mode-in', 'Room mode', 'in', 'left'), port('projector-a', 'Projector A', 'out', 'right'), port('projector-b', 'Projector B', 'out', 'right'), port('room-in', 'Room control', 'in', 'right'), port('lights', 'Lighting', 'out', 'right'), port('volume-out', 'Volume control', 'out', 'right')] },
  { id: 'audio-dsp', name: 'Audio DSP', x: 640, y: 700, width: NODE_WIDTH, status: 'online', ports: [port('volume', 'Volume control', 'in', 'left'), port('audio-in', 'Audio feed', 'in', 'left'), port('playback-in', 'Playback', 'in', 'left')] },
  { id: 'projector-a', name: 'Projector A', x: 640, y: 100, width: NODE_WIDTH, status: 'online', ports: [port('control', 'Control', 'in', 'left'), port('power', 'Power state', 'out', 'right')] },
  { id: 'projector-b', name: 'Projector B', x: 640, y: 250, width: NODE_WIDTH, status: 'online', ports: [port('control', 'Control', 'in', 'left'), port('power', 'Power state', 'out', 'right')] },
  { id: 'lighting', name: 'Lighting', x: 640, y: 560, width: NODE_WIDTH, status: 'online', ports: [port('control', 'Lighting control', 'in', 'left'), port('scene', 'Scene state', 'out', 'right')] },
  { id: 'room-status', name: 'Room Status', x: 950, y: 400, width: NODE_WIDTH, status: 'online', ports: [port('projector-a', 'Projector A', 'in', 'left'), port('projector-b', 'Projector B', 'in', 'left'), port('panel', 'Panel status', 'in', 'left'), port('lighting', 'Lighting', 'in', 'left')] }
];

export const fixtureEdges: readonly FixtureEdge[] = [
  { id: 'schedule-scene', from: { nodeId: 'schedule', portId: 'scene' }, to: { nodeId: 'room-controller', portId: 'scene-in' } },
  { id: 'schedule-clock', from: { nodeId: 'schedule', portId: 'clock' }, to: { nodeId: 'room-controller', portId: 'clock-in' } },
  { id: 'schedule-mode', from: { nodeId: 'schedule', portId: 'mode' }, to: { nodeId: 'room-controller', portId: 'mode-in' } },
  { id: 'panel-control', from: { nodeId: 'touch-panel', portId: 'room' }, to: { nodeId: 'room-controller', portId: 'room-in' } },
  { id: 'controller-projector-a', from: { nodeId: 'room-controller', portId: 'projector-a' }, to: { nodeId: 'projector-a', portId: 'control' } },
  { id: 'controller-projector-b', from: { nodeId: 'room-controller', portId: 'projector-b' }, to: { nodeId: 'projector-b', portId: 'control' } },
  { id: 'controller-volume', from: { nodeId: 'room-controller', portId: 'volume-out' }, to: { nodeId: 'audio-dsp', portId: 'volume' } },
  { id: 'controller-lighting', from: { nodeId: 'room-controller', portId: 'lights' }, to: { nodeId: 'lighting', portId: 'control' } },
  { id: 'projector-a-status', from: { nodeId: 'projector-a', portId: 'power' }, to: { nodeId: 'room-status', portId: 'projector-a' } },
  { id: 'projector-b-status', from: { nodeId: 'projector-b', portId: 'power' }, to: { nodeId: 'room-status', portId: 'projector-b' } },
  { id: 'lighting-status', from: { nodeId: 'lighting', portId: 'scene' }, to: { nodeId: 'room-status', portId: 'lighting' } },
  { id: 'media-audio', from: { nodeId: 'media-player', portId: 'audio' }, to: { nodeId: 'audio-dsp', portId: 'audio-in' } },
  { id: 'media-playback', from: { nodeId: 'media-player', portId: 'playback' }, to: { nodeId: 'audio-dsp', portId: 'playback-in' } },
  { id: 'panel-status', from: { nodeId: 'touch-panel', portId: 'status' }, to: { nodeId: 'room-status', portId: 'panel' } }
];

export function cardHeight(node: FixtureNode): number {
  const rowCount = Math.max(...(['left', 'right'] as const).map((side) => node.ports.filter((item) => item.side === side).length));
  return PORTS_TOP + rowCount * PORT_ROW_HEIGHT + 14;
}

export interface Point { x: number; y: number }
export interface Curve { start: Point; control1: Point; control2: Point; end: Point }

export function portPoint(node: FixtureNode, portId: string, position: Point = node): Point {
  const sidePorts = node.ports.filter((item) => item.side === node.ports.find((candidate) => candidate.id === portId)?.side);
  const index = sidePorts.findIndex((item) => item.id === portId);
  const item = sidePorts[index];
  if (!item) throw new Error(`Unknown port ${portId} on ${node.id}`);
  return {
    x: position.x + (item.side === 'left' ? 0 : node.width),
    y: position.y + PORTS_TOP + index * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2
  };
}

export function edgeCurve(edge: FixtureEdge, nodes: ReadonlyMap<string, FixtureNode>, positions?: ReadonlyMap<string, Point>): Curve {
  const source = nodes.get(edge.from.nodeId);
  const target = nodes.get(edge.to.nodeId);
  if (!source || !target) throw new Error(`Unknown endpoint for edge ${edge.id}`);
  const sourcePort = source.ports.find((item) => item.id === edge.from.portId);
  const targetPort = target.ports.find((item) => item.id === edge.to.portId);
  if (!sourcePort || !targetPort) throw new Error(`Unknown port on edge ${edge.id}`);
  const start = portPoint(source, edge.from.portId, positions?.get(source.id));
  const end = portPoint(target, edge.to.portId, positions?.get(target.id));
  const handle = Math.max(44, Math.min(128, Math.abs(end.x - start.x) * 0.42));
  const sourceTangent = sourcePort.side === 'right' ? 1 : -1;
  const targetTangent = targetPort.side === 'left' ? 1 : -1;
  return {
    start, end,
    control1: { x: start.x + sourceTangent * handle, y: start.y },
    control2: { x: end.x - targetTangent * handle, y: end.y }
  };
}

export function edgeCurves(edge: FixtureEdge, nodes: ReadonlyMap<string, FixtureNode>, positions?: ReadonlyMap<string, Point>): Curve[] {
  return [edgeCurve(edge, nodes, positions)];
}

export function curvePoint(curve: Curve, t: number): Point {
  const inverse = 1 - t;
  const a = inverse ** 3;
  const b = 3 * inverse ** 2 * t;
  const c = 3 * inverse * t ** 2;
  const d = t ** 3;
  return {
    x: a * curve.start.x + b * curve.control1.x + c * curve.control2.x + d * curve.end.x,
    y: a * curve.start.y + b * curve.control1.y + c * curve.control2.y + d * curve.end.y
  };
}

export function curveArrow(curve: Curve): { t: number; tip: Point; left: Point; right: Point } | undefined {
  const distanceToSocket = (t: number) => {
    const point = curvePoint(curve, t);
    return Math.hypot(point.x - curve.end.x, point.y - curve.end.y);
  };
  // Find the inset on the final approach, not on an extension of the socket tangent.
  // Search backwards first so a bend further up the wire doesn't pick the bracket.
  let near = 1;
  let far = 31 / 32;
  while (far > 0 && distanceToSocket(far) < ARROW_TIP_INSET) {
    near = far;
    far -= 1 / 32;
  }
  if (far === 0 && distanceToSocket(far) < ARROW_TIP_INSET) return;
  for (let i = 0; i < 12; i += 1) {
    const middle = (near + far) / 2;
    if (distanceToSocket(middle) < ARROW_TIP_INSET) near = middle;
    else far = middle;
  }
  const t = (near + far) / 2;
  const tip = curvePoint(curve, t);
  const u = 1 - t;
  const derivative = (start: number, c1: number, c2: number, end: number) =>
    3 * (u * u * (c1 - start) + 2 * u * t * (c2 - c1) + t * t * (end - c2));
  const angle = Math.atan2(
    derivative(curve.start.y, curve.control1.y, curve.control2.y, curve.end.y),
    derivative(curve.start.x, curve.control1.x, curve.control2.x, curve.end.x)
  );
  const baseCorner = (offset: number) => ({ x: tip.x - 7 * Math.cos(angle + offset), y: tip.y - 7 * Math.sin(angle + offset) });
  return { t, tip, left: baseCorner(-Math.PI / 6), right: baseCorner(Math.PI / 6) };
}

export function validateFixture(): string[] {
  const issues: string[] = [];
  const nodes = new Map(fixtureNodes.map((node) => [node.id, node]));
  if (nodes.size !== 9) issues.push(`Expected nine unique nodes, got ${nodes.size}`);
  if (fixtureEdges.length !== 14 || new Set(fixtureEdges.map((edge) => edge.id)).size !== fixtureEdges.length) issues.push('Expected fourteen uniquely identified edges');
  for (const node of fixtureNodes) {
    if (new Set(node.ports.map((item) => item.id)).size !== node.ports.length) issues.push(`Duplicate port on ${node.id}`);
    for (const item of node.ports) if (!item.id || !item.label.trim()) issues.push(`Invalid port on ${node.id}`);
  }
  for (const edge of fixtureEdges) {
    const source = nodes.get(edge.from.nodeId);
    const target = nodes.get(edge.to.nodeId);
    if (!source || !target) { issues.push(`Unknown node on ${edge.id}`); continue; }
    const sourcePort = source.ports.find((item) => item.id === edge.from.portId);
    const targetPort = target.ports.find((item) => item.id === edge.to.portId);
    if (!sourcePort || sourcePort.direction !== 'out') issues.push(`Invalid output on ${edge.id}`);
    if (!targetPort || targetPort.direction !== 'in') issues.push(`Invalid input on ${edge.id}`);
  }
  return issues;
}
