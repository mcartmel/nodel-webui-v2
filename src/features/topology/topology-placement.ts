import type { TopologyCanvasPoint } from './topology-canvas';
import type { TopologyNodeId } from './topology-model';

export interface TopologyPlacementNode {
  id: TopologyNodeId;
  width: number;
  height: number;
}

export interface TopologyPlacementWire {
  source: TopologyNodeId;
  target: TopologyNodeId;
}

export type TopologyPlacementMode = 'initial' | 'incremental' | 'auto';

export interface TopologyPlacementOptions {
  /** Initial and incremental modes preserve all supplied coordinates. */
  mode: TopologyPlacementMode;
  existingPositions?: ReadonlyMap<TopologyNodeId, TopologyCanvasPoint>;
  /** Auto layout preserves only these supplied coordinates (normally user-moved nodes). */
  pinnedNodeIds?: ReadonlySet<TopologyNodeId>;
}

const MAX_PERSISTED_COORDINATE = 1_000_000;
const RANK_SEPARATION = 112;
const NODE_SEPARATION = 40;
const COMPONENT_GAP = 88;
const ORIGIN = 36;
const MAX_ORDERED_NODES = 120;
const MAX_ORDERED_PAIRS = 800;
const MAX_ORDERED_PAIRS_PER_NODE = 8;
const FALLBACK_GRID_STEP = 512;
const FALLBACK_GRID_COLUMNS = Math.floor((MAX_PERSISTED_COORDINATE - ORIGIN) / FALLBACK_GRID_STEP);

function validPoint(point: TopologyCanvasPoint | undefined): point is TopologyCanvasPoint {
  return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y)
    && Math.abs(point.x) <= MAX_PERSISTED_COORDINATE && Math.abs(point.y) <= MAX_PERSISTED_COORDINATE;
}

function clampPoint(point: TopologyCanvasPoint): TopologyCanvasPoint {
  return {
    x: Math.max(-MAX_PERSISTED_COORDINATE, Math.min(MAX_PERSISTED_COORDINATE, point.x)),
    y: Math.max(-MAX_PERSISTED_COORDINATE, Math.min(MAX_PERSISTED_COORDINATE, point.y)),
  };
}

function nodeDimension(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(value, 10_000)) : fallback;
}

function idOrder(left: TopologyNodeId, right: TopologyNodeId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function connectedComponents(
  ids: readonly TopologyNodeId[],
  adjacency: ReadonlyMap<TopologyNodeId, ReadonlySet<TopologyNodeId>>
): TopologyNodeId[][] {
  const seen = new Set<TopologyNodeId>();
  const components: TopologyNodeId[][] = [];
  for (const start of ids) {
    if (seen.has(start)) continue;
    const component: TopologyNodeId[] = [];
    const queue = [start];
    seen.add(start);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component.sort(idOrder));
  }
  return components;
}

/** Sweep in alternating directions. Keep the best rank-pair crossing score;
 * this is a placement heuristic, not a router. */
function orderRanks(ranks: TopologyNodeId[][], wires: readonly TopologyPlacementWire[]): TopologyNodeId[][] {
  const rankById = new Map(ranks.flatMap((members, rank) => members.map((id) => [id, rank] as const)));
  const ordinal = new Map<TopologyNodeId, number>();
  const left = new Map<TopologyNodeId, TopologyNodeId[]>();
  const right = new Map<TopologyNodeId, TopologyNodeId[]>();
  const edgesByRankPair = new Map<number, [TopologyNodeId, TopologyNodeId][]>();
  for (const { source, target } of wires) {
    const sourceRank = rankById.get(source)!;
    const targetRank = rankById.get(target)!;
    if (sourceRank === targetRank) continue;
    const [from, to] = sourceRank < targetRank ? [source, target] : [target, source];
    const pair = Math.min(sourceRank, targetRank) * ranks.length + Math.max(sourceRank, targetRank);
    const peers = edgesByRankPair.get(pair) ?? [];
    peers.push([from, to]);
    edgesByRankPair.set(pair, peers);
    const fromNeighbors = right.get(from) ?? [];
    const toNeighbors = left.get(to) ?? [];
    fromNeighbors.push(to);
    toNeighbors.push(from);
    right.set(from, fromNeighbors);
    left.set(to, toNeighbors);
  }
  // Exact integer sums make averaging invariant to wire input order. At most
  // 120 members means every slot has a distinct ordinal within its rank.
  const updateOrdinals = (members: TopologyNodeId[]) => members.forEach((id, index) => {
    ordinal.set(id, Math.round((index + 0.5) * 1024 / members.length));
  });
  const countCrossings = () => {
    let total = 0;
    for (const edges of edgesByRankPair.values()) {
      const slots = edges.map(([from, to]) => [ordinal.get(from)!, ordinal.get(to)!] as const);
      for (const [index, [a, b]] of slots.entries()) {
        for (let i = 0; i < index; i += 1) {
          const [c, d] = slots[i]!;
          if ((a - c) * (b - d) < 0) total += 1;
        }
      }
    }
    return total;
  };
  ranks.forEach(updateOrdinals);
  let best = ranks.map((members) => [...members]);
  let bestCrossings = countCrossings();
  for (let sweep = 0; sweep < 4 && bestCrossings > 0; sweep += 1) {
    const forward = sweep % 2 === 0;
    const neighbors = forward ? left : right;
    for (const members of forward ? ranks : [...ranks].reverse()) {
      const barycenters = new Map(members.map((id) => {
        const adjacent = neighbors.get(id);
        return [id, adjacent
          ? adjacent.reduce((sum, neighbor) => sum + ordinal.get(neighbor)!, 0) / adjacent.length
          : ordinal.get(id)!] as const;
      }));
      members.sort((a, b) => barycenters.get(a)! - barycenters.get(b)! || ordinal.get(a)! - ordinal.get(b)!);
      updateOrdinals(members);
    }
    const crossings = countCrossings();
    if (crossings < bestCrossings) {
      best = ranks.map((members) => [...members]);
      bestCrossings = crossings;
    }
  }
  return best;
}

/** Deterministic SCC condensation and longest-path ranks, with finer order for small components. */
function directedPositions(
  ids: readonly TopologyNodeId[],
  nodeById: ReadonlyMap<TopologyNodeId, TopologyPlacementNode>,
  wires: readonly TopologyPlacementWire[]
): Map<TopologyNodeId, TopologyCanvasPoint> {
  const refine = ids.length <= MAX_ORDERED_NODES && wires.length <= MAX_ORDERED_PAIRS
    && wires.length <= ids.length * MAX_ORDERED_PAIRS_PER_NODE;
  const outgoing = new Map(ids.map((id) => [id, [] as TopologyNodeId[]]));
  for (const wire of wires) if (outgoing.has(wire.source) && outgoing.has(wire.target)) outgoing.get(wire.source)!.push(wire.target);
  for (const targets of outgoing.values()) targets.sort(idOrder);

  let nextIndex = 0;
  const indexById = new Map<TopologyNodeId, number>();
  const lowById = new Map<TopologyNodeId, number>();
  const stack: TopologyNodeId[] = [];
  const onStack = new Set<TopologyNodeId>();
  const groups: TopologyNodeId[][] = [];
  const finishOrder = new Map<TopologyNodeId, number>();
  const visit = (id: TopologyNodeId): void => {
    indexById.set(id, nextIndex);
    lowById.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);
    for (const target of outgoing.get(id) ?? []) {
      if (!indexById.has(target)) {
        visit(target);
        lowById.set(id, Math.min(lowById.get(id)!, lowById.get(target)!));
      } else if (onStack.has(target)) lowById.set(id, Math.min(lowById.get(id)!, indexById.get(target)!));
    }
    if (refine) finishOrder.set(id, finishOrder.size);
    if (lowById.get(id) !== indexById.get(id)) return;
    const group: TopologyNodeId[] = [];
    let member: TopologyNodeId;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      group.push(member);
    } while (member !== id);
    groups.push(group.sort(idOrder));
  };
  // Give fanout nodes a chance to become the head of a small feedback loop.
  const starts = refine ? [...ids].sort((a, b) => outgoing.get(b)!.length - outgoing.get(a)!.length || idOrder(a, b)) : ids;
  for (const id of starts) if (!indexById.has(id)) visit(id);

  // A DFS back edge is the only kind that points to a later finish time.
  // For small cycles ignore those constraints so nodes can still span ranks.
  // Wires themselves remain unchanged, including feedback edges and self-loops.
  const rankGroups = refine ? ids.map((id) => [id]) : groups;
  const groupById = new Map<TopologyNodeId, number>();
  rankGroups.forEach((group, index) => group.forEach((id) => groupById.set(id, index)));
  const groupEdges = rankGroups.map(() => new Set<number>());
  const indegree = rankGroups.map(() => 0);
  for (const wire of wires) {
    const source = groupById.get(wire.source);
    const target = groupById.get(wire.target);
    if (source === undefined || target === undefined || source === target || groupEdges[source]!.has(target)) continue;
    if (refine && finishOrder.get(wire.source)! < finishOrder.get(wire.target)!) continue;
    groupEdges[source]!.add(target);
    indegree[target] = indegree[target]! + 1;
  }
  const keyByGroup = rankGroups.map((group) => group[0]!);
  const ready = rankGroups.map((_, index) => index).filter((index) => indegree[index] === 0)
    .sort((a, b) => idOrder(keyByGroup[a]!, keyByGroup[b]!));
  const rank = rankGroups.map(() => 0);
  for (let cursor = 0; cursor < ready.length; cursor += 1) {
    const source = ready[cursor]!;
    for (const target of [...groupEdges[source]!].sort((a, b) => idOrder(keyByGroup[a]!, keyByGroup[b]!))) {
      rank[target] = Math.max(rank[target]!, rank[source]! + 1);
      indegree[target] = indegree[target]! - 1;
      if (indegree[target] === 0) ready.push(target);
    }
  }
  // Pull branches toward their first consumer without changing direction or
  // increasing the number of ranks. This shortens skipped-column spans.
  if (refine) {
    for (let i = ready.length - 1; i >= 0; i -= 1) {
      const source = ready[i]!;
      if (groupEdges[source]!.size) rank[source] = Math.min(...[...groupEdges[source]!].map((target) => rank[target]! - 1));
    }
  }

  const rankMembers = new Map<number, TopologyNodeId[]>();
  rankGroups.forEach((group, groupIndex) => {
    const nodes = rankMembers.get(rank[groupIndex]!) ?? [];
    nodes.push(...group);
    rankMembers.set(rank[groupIndex]!, nodes);
  });
  const stableRanks = [...rankMembers.keys()].sort((a, b) => a - b).map((value) => rankMembers.get(value)!.sort(idOrder));
  const orderedRanks = refine ? orderRanks(stableRanks, wires) : stableRanks;
  const heightOf = (id: TopologyNodeId) => nodeDimension(nodeById.get(id)!.height, 160);
  const rankHeights = refine ? orderedRanks.map((members) => members.reduce((sum, id) => sum + heightOf(id) + NODE_SEPARATION, -NODE_SEPARATION)) : [];
  const maxHeight = Math.max(0, ...rankHeights);
  let rankX = 0;
  const positions = new Map<TopologyNodeId, TopologyCanvasPoint>();
  for (const [rankIndex, members] of orderedRanks.entries()) {
    let rankY = refine ? (maxHeight - rankHeights[rankIndex]!) / 2 : 0;
    let width = 0;
    for (const id of members) {
      positions.set(id, { x: rankX, y: rankY });
      rankY += heightOf(id) + NODE_SEPARATION;
      width = Math.max(width, nodeDimension(nodeById.get(id)!.width, 248));
    }
    rankX += width + RANK_SEPARATION;
  }
  return positions;
}

interface CollisionRect {
  id: TopologyNodeId;
  x: number;
  y: number;
  width: number;
  height: number;
}

class CollisionIndex {
  private readonly buckets = new Map<string, Set<CollisionRect>>();

  add(id: TopologyNodeId, point: TopologyCanvasPoint, node: TopologyPlacementNode): void {
    const rect = {
      id,
      x: point.x,
      y: point.y,
      width: nodeDimension(node.width, 248),
      height: nodeDimension(node.height, 160),
    };
    for (const key of this.bucketKeys(rect.x - 24, rect.y - 24, rect.width + 48, rect.height + 48)) {
      const bucket = this.buckets.get(key) ?? new Set<CollisionRect>();
      bucket.add(rect);
      this.buckets.set(key, bucket);
    }
  }

  overlaps(point: TopologyCanvasPoint, node: TopologyPlacementNode): boolean {
    const width = nodeDimension(node.width, 248);
    const height = nodeDimension(node.height, 160);
    const candidates = new Set<CollisionRect>();
    for (const key of this.bucketKeys(point.x - 24, point.y - 24, width + 48, height + 48)) {
      for (const rect of this.buckets.get(key) ?? []) candidates.add(rect);
    }
    for (const rect of candidates) {
      if (point.x < rect.x + rect.width + 24 && rect.x < point.x + width + 24
        && point.y < rect.y + rect.height + 24 && rect.y < point.y + height + 24) return true;
    }
    return false;
  }

  private bucketKeys(x: number, y: number, width: number, height: number): string[] {
    const firstX = Math.floor(x / FALLBACK_GRID_STEP);
    const lastX = Math.floor((x + width) / FALLBACK_GRID_STEP);
    const firstY = Math.floor(y / FALLBACK_GRID_STEP);
    const lastY = Math.floor((y + height) / FALLBACK_GRID_STEP);
    const keys: string[] = [];
    for (let bucketY = firstY; bucketY <= lastY; bucketY += 1) {
      for (let bucketX = firstX; bucketX <= lastX; bucketX += 1) keys.push(`${bucketX}:${bucketY}`);
    }
    return keys;
  }
}

function collisionFreePoint(
  preferred: TopologyCanvasPoint,
  node: TopologyPlacementNode,
  collisionIndex: CollisionIndex,
  fallbackCursor: { value: number }
): TopologyCanvasPoint {
  const candidate = clampPoint(preferred);
  if (!collisionIndex.overlaps(candidate, node)) return candidate;
  const columns = Math.max(1, FALLBACK_GRID_COLUMNS);
  const maxRows = Math.floor((MAX_PERSISTED_COORDINATE - ORIGIN) / FALLBACK_GRID_STEP);
  while (fallbackCursor.value < columns * maxRows) {
    const slot = fallbackCursor.value++;
    const point = { x: ORIGIN + (slot % columns) * FALLBACK_GRID_STEP, y: ORIGIN + Math.floor(slot / columns) * FALLBACK_GRID_STEP };
    if (!collisionIndex.overlaps(point, node)) return point;
  }
  // This bound is only reachable after exhausting almost the entire persisted
  // coordinate plane; preserve the ID and bounded point rather than dropping it.
  return candidate;
}

function componentBounds(
  ids: readonly TopologyNodeId[],
  positions: ReadonlyMap<TopologyNodeId, TopologyCanvasPoint>,
  nodeById: ReadonlyMap<TopologyNodeId, TopologyPlacementNode>
): { width: number; height: number } {
  let right = 0;
  let bottom = 0;
  for (const id of ids) {
    const point = positions.get(id)!;
    const node = nodeById.get(id)!;
    right = Math.max(right, point.x + nodeDimension(node.width, 248));
    bottom = Math.max(bottom, point.y + nodeDimension(node.height, 160));
  }
  return { width: right, height: bottom };
}

/**
 * Place topology nodes left-to-right using only configured directed wires.
 * Directed ranks and bounded barycentric sweeps place nodes; X6 routes wires.
 * Self-loops are ignored for ranks, parallel edges are deduplicated for the
 * layout calculation, cycles are handled during ranking, and isolated nodes are
 * packed into a grid. All input nodes and eligible distinct wire pairs are
 * retained; generated coordinates and dimensions are bounded and deterministic.
 */
export function placeTopologyNodes(
  inputNodes: readonly TopologyPlacementNode[],
  inputWires: readonly TopologyPlacementWire[],
  options: TopologyPlacementOptions
): Map<TopologyNodeId, TopologyCanvasPoint> {
  const nodes = [...new Map(inputNodes.map((node) => [node.id, node])).values()]
    .sort((a, b) => idOrder(a.id, b.id));
  const ids = nodes.map(({ id }) => id);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const known = new Set(ids);
  const existing = options.existingPositions ?? new Map<TopologyNodeId, TopologyCanvasPoint>();
  const retained = new Map<TopologyNodeId, TopologyCanvasPoint>();
  if (options.mode !== 'auto') {
    for (const [id, point] of existing) if (known.has(id) && validPoint(point)) retained.set(id, { ...point });
  } else {
    for (const id of options.pinnedNodeIds ?? []) {
      const point = existing.get(id);
      if (known.has(id) && validPoint(point)) retained.set(id, { ...point });
    }
  }
  // Incremental updates where every current node already has coordinates must
  // not scan potentially huge edge snapshots or invoke a graph layout engine.
  if (retained.size === nodes.length) return retained;

  // Scan the real input once. Deduplication is on eligible directed pairs, so
  // thousands of parallel rows cannot hide a later distinct connection.
  const uniqueWires = new Map<string, TopologyPlacementWire>();
  for (const wire of inputWires) {
    if (wire.source === wire.target || !known.has(wire.source) || !known.has(wire.target)) continue;
    const key = JSON.stringify([wire.source, wire.target]);
    if (!uniqueWires.has(key)) uniqueWires.set(key, wire);
  }
  const wires = [...uniqueWires.values()];
  const adjacency = new Map(ids.map((id) => [id, new Set<TopologyNodeId>()]));
  for (const wire of wires) {
    adjacency.get(wire.source)!.add(wire.target);
    adjacency.get(wire.target)!.add(wire.source);
  }

  const components = connectedComponents(ids, adjacency);
  const connected = components.filter((component) => component.length > 1);
  const isolates = components.filter((component) => component.length === 1).flat();
  const result = new Map(retained);
  const collisionIndex = new CollisionIndex();
  for (const [id, point] of retained) collisionIndex.add(id, point, nodeById.get(id)!);
  const fallbackCursor = { value: 0 };
  let nextComponentY = ORIGIN;
  let isolateIndex = 0;

  const componentIndex = new Map<TopologyNodeId, number>();
  connected.forEach((component, index) => component.forEach((id) => componentIndex.set(id, index)));
  const wiresByComponent = connected.map(() => [] as TopologyPlacementWire[]);
  for (const wire of wires) {
    const index = componentIndex.get(wire.source);
    if (index !== undefined && index === componentIndex.get(wire.target)) wiresByComponent[index]!.push(wire);
  }

  for (const [componentNumber, component] of connected.entries()) {
    const anchors = component.filter((id) => retained.has(id));
    const unplaced = component.filter((id) => !retained.has(id));
    if (unplaced.length === 0) continue;
    const componentLayout = directedPositions(component, nodeById, wiresByComponent[componentNumber]!);

    let offsetX = ORIGIN;
    let offsetY = nextComponentY;
    if (anchors.length > 0) {
      const anchorId = anchors[0]!;
      const anchor = retained.get(anchorId)!;
      const relative = componentLayout.get(anchorId)!;
      offsetX = anchor.x - relative.x;
      offsetY = anchor.y - relative.y;
    }
    for (const id of component) {
      if (result.has(id)) continue;
      const proposed = componentLayout.get(id)!;
      const size = nodeById.get(id)!;
      const point = collisionFreePoint({ x: proposed.x + offsetX, y: proposed.y + offsetY }, size, collisionIndex, fallbackCursor);
      result.set(id, point);
      collisionIndex.add(id, point, size);
    }
    const bounds = componentBounds(component, result, nodeById);
    nextComponentY = Math.max(nextComponentY, bounds.height + COMPONENT_GAP);
  }

  // Disconnected nodes do not form a chain of one-node components. Grid them
  // together so an inventory with no bindings is compact and readable.
  const columns = Math.min(4, Math.max(1, isolates.length));
  const isolateHeights = isolates.map((id) => nodeDimension(nodeById.get(id)!.height, 160));
  const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(1, ...isolates
    .filter((_, index) => index % columns === column)
    .map((id) => nodeDimension(nodeById.get(id)!.width, 248))));
  const columnLefts = columnWidths.map((_, column) => ORIGIN + columnWidths.slice(0, column).reduce((sum, width) => sum + width + NODE_SEPARATION, 0));
  const rowHeights: number[] = [];
  for (let index = 0; index < isolates.length; index += columns) {
    rowHeights.push(Math.max(...isolateHeights.slice(index, index + columns)));
  }
  const rowTops = rowHeights.map((_, row) => ORIGIN + rowHeights.slice(0, row).reduce((sum, height) => sum + height + NODE_SEPARATION, 0));
  for (const id of isolates) {
    if (result.has(id)) continue;
    const column = isolateIndex % columns;
    const row = Math.floor(isolateIndex / columns);
    const node = nodeById.get(id)!;
    const point = collisionFreePoint({ x: columnLefts[column] ?? ORIGIN, y: rowTops[row] ?? ORIGIN }, node, collisionIndex, fallbackCursor);
    result.set(id, point);
    collisionIndex.add(id, point, node);
    isolateIndex += 1;
  }
  return result;
}

/**
 * Repair collisions caused by local card growth without reranking the graph.
 * Existing manual coordinates are hard anchors; only overlapping automatic
 * nodes are nudged, and non-overlapping coordinates remain byte-for-byte stable.
 */
export function repairTopologyPlacementCollisions(
  inputNodes: readonly TopologyPlacementNode[],
  positions: ReadonlyMap<TopologyNodeId, TopologyCanvasPoint>,
  autoPositionedNodeIds: ReadonlySet<TopologyNodeId>
): Map<TopologyNodeId, TopologyCanvasPoint> {
  const nodes = new Map(inputNodes.map(node => [node.id, node]));
  const result = new Map([...positions].filter(([id]) => nodes.has(id)).map(([id, point]) => [id, { ...point }]));
  const placed: CollisionRect[] = [];
  const order = [...result.keys()].sort((a, b) => Number(autoPositionedNodeIds.has(a)) - Number(autoPositionedNodeIds.has(b))
    || result.get(a)!.y - result.get(b)!.y || result.get(a)!.x - result.get(b)!.x || idOrder(a, b));
  for (const id of order) {
    const node = nodes.get(id)!;
    const width = nodeDimension(node.width, 248);
    const height = nodeDimension(node.height, 160);
    let point = result.get(id)!;
    if (autoPositionedNodeIds.has(id)) {
      let attempts = 0;
      while (placed.some(rect => point.x < rect.x + rect.width + 24 && rect.x < point.x + width + 24
        && point.y < rect.y + rect.height + 24 && rect.y < point.y + height + 24) && attempts < 4096) {
        const collisions = placed.filter(rect => point.x < rect.x + rect.width + 24 && rect.x < point.x + width + 24
          && point.y < rect.y + rect.height + 24 && rect.y < point.y + height + 24);
        point = clampPoint({ x: point.x, y: Math.max(...collisions.map(rect => rect.y + rect.height + 24)) });
        attempts += 1;
      }
      result.set(id, point);
    }
    placed.push({ id, x: point.x, y: point.y, width, height });
  }
  return result;
}
