import { cardHeight, type Curve, type FixtureEdge, type FixtureNode } from './fixture';

export interface GraphBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Find authored extents without creating a flattened point list or spreading a large graph. */
export function graphBounds(nodes: Iterable<FixtureNode>, curves: Iterable<readonly Curve[]>): GraphBounds | undefined {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.x);
    right = Math.max(right, node.x + node.width);
    top = Math.min(top, node.y);
    bottom = Math.max(bottom, node.y + cardHeight(node));
  }
  for (const route of curves) {
    for (const curve of route) {
      for (const point of [curve.start, curve.control1, curve.control2, curve.end]) {
        left = Math.min(left, point.x);
        right = Math.max(right, point.x);
        top = Math.min(top, point.y);
        bottom = Math.max(bottom, point.y);
      }
    }
  }
  return left === Infinity ? undefined : { left, right, top, bottom };
}

export interface Selection {
  nodeId?: string | undefined;
  trace?: TraceTarget | undefined;
}

export type SocketId = FixtureEdge['from'];
export type TraceTarget = { edgeId: string } | { port: SocketId; label: string };
type PortIndex = ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>;

export interface Trace {
  target: TraceTarget | undefined;
  edgeIds: ReadonlySet<string>;
  ports: ReadonlyMap<string, ReadonlySet<string>>;
  kinds: ReadonlySet<FixtureEdge['bindingKind']>;
}

export function sameSocket(a: SocketId, b: SocketId): boolean {
  return a.nodeId === b.nodeId && a.portId === b.portId;
}

export function traceConnections(target: TraceTarget | undefined, edges: ReadonlyMap<string, FixtureEdge>, index: PortIndex): Trace {
  const candidates = !target ? [] : 'edgeId' in target ? [target.edgeId] : index.get(target.port.nodeId)?.get(target.port.portId) ?? [];
  const edgeIds = new Set<string>();
  const ports = new Map<string, Set<string>>();
  const kinds = new Set<FixtureEdge['bindingKind']>();
  for (const id of candidates) {
    const edge = edges.get(id);
    if (!edge) continue;
    edgeIds.add(id);
    kinds.add(edge.bindingKind);
    for (const { nodeId, portId } of [edge.from, edge.to]) {
      let points = ports.get(nodeId);
      if (!points) ports.set(nodeId, points = new Set());
      points.add(portId);
    }
  }
  return { target, edgeIds, ports, kinds };
}

export function traceChanges(previous: Trace, next: Trace): { wiresChanged: boolean; sockets: SocketId[] } {
  const sockets: SocketId[] = [];
  for (const [a, b] of [[previous.ports, next.ports], [next.ports, previous.ports]] as const) {
    for (const [nodeId, ports] of a) {
      const other = b.get(nodeId);
      for (const portId of ports) if (!other?.has(portId)) sockets.push({ nodeId, portId });
    }
  }
  if (previous.edgeIds.size !== next.edgeIds.size) return { wiresChanged: true, sockets };
  for (const id of previous.edgeIds) if (!next.edgeIds.has(id)) return { wiresChanged: true, sockets };
  return { wiresChanged: false, sockets };
}
/** Same usable viewport for the early-release estimate and actual camera fit. */
export function fittedCameraScale(width: number, height: number, worldWidth: number, worldHeight: number): number {
  return Math.min(1, (width - 40) / worldWidth, (height - 36) / worldHeight);
}
