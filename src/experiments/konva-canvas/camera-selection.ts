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
  edgeId?: string | undefined;
}

export interface SelectionChanges {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  socketIds: Set<string>;
}

/** Return only cards, wires, and endpoint sockets whose selected appearance can change. */
export function selectionChanges(previous: Selection, next: Selection, edges: ReadonlyMap<string, FixtureEdge>): SelectionChanges {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const socketIds = new Set<string>();
  if (previous.nodeId !== next.nodeId) {
    if (previous.nodeId) nodeIds.add(previous.nodeId);
    if (next.nodeId) nodeIds.add(next.nodeId);
  }
  if (previous.edgeId !== next.edgeId) {
    for (const id of [previous.edgeId, next.edgeId]) {
      if (!id) continue;
      edgeIds.add(id);
      const edge = edges.get(id);
      if (!edge) continue;
      socketIds.add(`${edge.from.nodeId}:${edge.from.portId}`);
      socketIds.add(`${edge.to.nodeId}:${edge.to.portId}`);
    }
  }
  return { nodeIds, edgeIds, socketIds };
}
/** Same usable viewport for the early-release estimate and actual camera fit. */
export function fittedCameraScale(width: number, height: number, worldWidth: number, worldHeight: number): number {
  return Math.min(1, (width - 40) / worldWidth, (height - 36) / worldHeight);
}
