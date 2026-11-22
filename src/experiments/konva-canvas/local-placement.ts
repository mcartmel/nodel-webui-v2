import { cardHeightForPortCounts, curvePoint, edgeCurve, NODE_WIDTH, type Curve, type FixtureNode, type FixturePort, type Point } from './fixture';
import type { LocalGraph, LocalGraphPort } from './local-graph';

export interface LocalPlacementOptions {
  columnGap?: number;
  rowGap?: number;
  componentGap?: number;
}

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

const BYPASS_CLEARANCE = 18;
const BYPASS_SWEEPS = 3;
const BYPASS_PAIR_LIMIT = 4_096;
const BYPASS_CHECK_LIMIT = 50_000;

function intervalsOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

type Band = { start: number; end: number };
const contains = (band: Band, y: number): boolean => y >= band.start && y <= band.end;

/** Select the closest y outside merged forbidden bands; lower y wins exact ties. */
export function closestFeasibleY(current: number, forbidden: Band[]): number {
  const merged = forbidden.filter((band) => band.end > band.start).sort((a, b) => a.start - b.start || a.end - b.end)
    .reduce<Band[]>((bands, band) => {
      const last = bands[bands.length - 1];
      if (last && band.start <= last.end) last.end = Math.max(last.end, band.end);
      else bands.push({ ...band });
      return bands;
    }, []);
  if (!merged.some((band) => contains(band, current))) return current;
  let closest = current;
  let distance = Infinity;
  const consider = (y: number) => {
    const delta = Math.abs(y - current);
    if (delta < distance || (delta === distance && y < closest)) {
      closest = y;
      distance = delta;
    }
  };
  for (const [i, band] of merged.entries()) {
    const above = band.start - 1;
    const below = band.end + 1;
    if (above > (merged[i - 1]?.end ?? -Infinity)) consider(above);
    if (below < (merged[i + 1]?.start ?? Infinity)) consider(below);
  }
  return closest;
}

/** Forward skip cubics are monotone in x. Bracket the padded card's span conservatively. */
function bracketX(curve: Curve, x: number): [number, number] {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 16; step += 1) {
    const mid = (low + high) / 2;
    if (curvePoint(curve, mid).x < x) low = mid;
    else high = mid;
  }
  return [low, high];
}

/** Placement-only refinement: move unrelated cards out of initial direct bypasses. */
function clearInitialBypasses(graph: LocalGraph, positions: Map<string, Point>, geometry: LocalGraphGeometry): void {
  const fixtureNodes = new Map<string, FixtureNode>();
  for (const [id, node] of graph.nodes) {
    const ports: FixturePort[] = (geometry.portsByNode.get(id) ?? []).map((port) => {
      const side = port.kind === 'remote-action' || port.kind === 'local-event' ? 'right' : 'left';
      return { id: port.id, label: port.name, direction: side === 'right' ? 'out' : 'in', side };
    });
    fixtureNodes.set(id, { id, name: node.name, x: positions.get(id)!.x, y: 0, width: NODE_WIDTH, ports });
  }

  // X and socket rows never change. Index each forward bypass/blocker pair once.
  const trial = new Map(positions);
  type Bypass = { blocker: FixtureNode; band: () => Band };
  const overCard = new Map([...fixtureNodes.keys()].map((id) => [id, [] as Bypass[]]));
  const bypasses: Bypass[] = [];
  let checks = 0;
  for (const connection of graph.connections.values()) {
    const from = graph.ports.get(connection.fromPortId)!;
    const to = graph.ports.get(connection.toPortId)!;
    const fromX = fixtureNodes.get(from.nodeId)!.x;
    const toX = fixtureNodes.get(to.nodeId)!.x;
    if (toX - fromX <= 2 * NODE_WIDTH) continue;
    const curve = edgeCurve({ id: connection.id, from: { nodeId: from.nodeId, portId: from.id },
      to: { nodeId: to.nodeId, portId: to.id } }, fixtureNodes);
    for (const blocker of fixtureNodes.values()) {
      // Decline dense inputs rather than refine against only a partial index.
      if (++checks > BYPASS_CHECK_LIMIT) return;
      if (blocker.x <= curve.start.x || blocker.x + blocker.width >= curve.end.x) continue;
      if (bypasses.length === BYPASS_PAIR_LIMIT) return;
      const [low] = bracketX(curve, blocker.x - BYPASS_CLEARANCE);
      const [, high] = bracketX(curve, blocker.x + blocker.width + BYPASS_CLEARANCE);
      // Horizontal endpoint tangents make y monotone as well. Moving a node
      // changes only its endpoint y, so reuse these two interpolation weights.
      const a = low * low * (3 - 2 * low);
      const b = high * high * (3 - 2 * high);
      const height = geometry.heightsByNode.get(blocker.id)!;
      const bypass: Bypass = { blocker, band: () => {
        const startY = curve.start.y + trial.get(from.nodeId)!.y;
        const endY = curve.end.y + trial.get(to.nodeId)!.y;
        const y1 = startY + (endY - startY) * a;
        const y2 = startY + (endY - startY) * b;
        return { start: Math.min(y1, y2) - BYPASS_CLEARANCE - height, end: Math.max(y1, y2) + BYPASS_CLEARANCE };
      } };
      overCard.get(blocker.id)!.push(bypass);
      bypasses.push(bypass);
    }
  }

  const collisions = () => new Set(bypasses.filter((bypass) => contains(bypass.band(), trial.get(bypass.blocker.id)!.y)));
  const candidates = [...fixtureNodes.values()].filter((card) => overCard.get(card.id)!.length > 0)
    .sort((a, b) => compare(a.id, b.id));
  let accepted = collisions();
  for (let sweep = 0; accepted.size && sweep < BYPASS_SWEEPS; sweep += 1) {
    let moved = false;
    for (const card of candidates) {
      const current = trial.get(card.id)!;
      const forbidden = overCard.get(card.id)!.map((bypass) => bypass.band());
      if (!forbidden.some((band) => contains(band, current.y))) continue;

      const height = geometry.heightsByNode.get(card.id)!;
      const cardRect = { start: card.x, end: card.x + card.width };
      for (const other of fixtureNodes.values()) {
        if (++checks > BYPASS_CHECK_LIMIT) return;
        if (other.id === card.id || !intervalsOverlap(cardRect, { start: other.x, end: other.x + other.width })) continue;
        const otherY = trial.get(other.id)!.y;
        forbidden.push({ start: otherY - height, end: otherY + geometry.heightsByNode.get(other.id)! });
      }

      const y = closestFeasibleY(current.y, forbidden);
      if (y !== current.y) {
        trial.set(card.id, { x: current.x, y });
        moved = true;
      }
    }
    if (!moved) break;
    // Guard the whole tentative sweep: a later endpoint move can swing a
    // curve back over an earlier card. Keep only a strict subset of the last
    // accepted collision set. A rejected sweep can still seed the next trial.
    const remaining = collisions();
    if (remaining.size >= accepted.size || [...remaining].some((bypass) => !accepted.has(bypass))) continue;
    for (const card of candidates) positions.set(card.id, trial.get(card.id)!);
    accepted = remaining;
  }
}

export interface LocalGraphGeometry {
  portsByNode: ReadonlyMap<string, readonly LocalGraphPort[]>;
  heightsByNode: ReadonlyMap<string, number>;
}

export function compareLocalPorts(a: LocalGraphPort, b: LocalGraphPort): number {
  return compare(a.kind, b.kind) || compare(a.name, b.name) || compare(a.id, b.id);
}

const geometryByPositions = new WeakMap<ReadonlyMap<string, Point>, { graph: LocalGraph; geometry: LocalGraphGeometry }>();

/** Reuse layout's geometry index when the projection receives its positions. */
export function localGraphGeometryForPositions(graph: LocalGraph, positions: ReadonlyMap<string, Point>): LocalGraphGeometry | undefined {
  const entry = geometryByPositions.get(positions);
  return entry?.graph === graph ? entry.geometry : undefined;
}

/** Build the shared, stable row-order and height index in one port pass. */
export function indexLocalGraphGeometry(graph: LocalGraph): LocalGraphGeometry {
  const byNode = new Map<string, LocalGraphPort[]>();
  const counts = new Map<string, { left: number; right: number }>();
  for (const nodeId of graph.nodes.keys()) {
    byNode.set(nodeId, []);
    counts.set(nodeId, { left: 0, right: 0 });
  }
  for (const port of graph.ports.values()) {
    const rows = byNode.get(port.nodeId);
    if (!rows) continue;
    rows.push(port);
    const count = counts.get(port.nodeId)!;
    if (port.kind === 'local-action' || port.kind === 'remote-event') count.left += 1;
    else count.right += 1;
  }
  for (const rows of byNode.values()) rows.sort(compareLocalPorts);
  const heightsByNode = new Map<string, number>();
  for (const [nodeId, count] of counts) heightsByNode.set(nodeId, cardHeightForPortCounts(count.left, count.right));
  return { portsByNode: byNode, heightsByNode };
}

/** Deterministic one-shot directed placement. Coordinates are world-space top-lefts. */
export function placeLocalGraph(graph: LocalGraph, options: LocalPlacementOptions = {}, geometry = indexLocalGraphGeometry(graph)): Map<string, Point> {
  const columnGap = options.columnGap ?? 150;
  const rowGap = options.rowGap ?? 28;
  const componentGap = options.componentGap ?? 180;
  const nodeIds = [...graph.nodes.keys()].sort(compare);
  const adjacency = new Map(nodeIds.map((id) => [id, new Set<string>()]));
  const outgoing = new Map(nodeIds.map((id) => [id, new Set<string>()]));
  const incoming = new Map(nodeIds.map((id) => [id, new Set<string>()]));
  const portOwner = new Map([...graph.ports].map(([id, port]) => [id, port.nodeId]));
  for (const edge of graph.connections.values()) {
    const from = portOwner.get(edge.fromPortId);
    const to = portOwner.get(edge.toPortId);
    if (!from || !to) continue;
    adjacency.get(from)?.add(to);
    adjacency.get(to)?.add(from);
    outgoing.get(from)?.add(to);
    incoming.get(to)?.add(from);
  }

  const result = new Map<string, Point>();
  const visited = new Set<string>();
  let componentX = 0;
  let componentBottom = 0;
  for (const seed of nodeIds) {
    if ((adjacency.get(seed)?.size ?? 0) === 0) continue;
    if (visited.has(seed)) continue;
    const peers = new Set<string>();
    const queue = [seed];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const id = queue[cursor]!;
      if (peers.has(id)) continue;
      peers.add(id);
      for (const peer of adjacency.get(id) ?? []) if (!peers.has(peer)) queue.push(peer);
    }
    for (const id of peers) visited.add(id);
    const localPeers = [...peers].filter((id) => graph.nodes.get(id)?.origin === 'local');
    const anchorCandidates = localPeers.length ? localPeers : [...peers];
    const anchor = anchorCandidates.sort((a, b) => (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0) || compare(a, b))[0]!;
    const columns = new Map<string, number>([[anchor, 0]]);
    const walk = [anchor];
    for (let cursor = 0; cursor < walk.length; cursor += 1) {
      const id = walk[cursor]!;
      const column = columns.get(id)!;
      const neighbors = [...(adjacency.get(id) ?? [])].filter((peer) => peers.has(peer) && !columns.has(peer)).sort(compare);
      const right = neighbors.filter((peer) => outgoing.get(id)?.has(peer));
      const left = neighbors.filter((peer) => incoming.get(id)?.has(peer) && !outgoing.get(id)?.has(peer));
      const other = neighbors.filter((peer) => !right.includes(peer) && !left.includes(peer));
      for (const peer of [...right, ...left, ...other]) {
        columns.set(peer, column + (right.includes(peer) ? 1 : left.includes(peer) ? -1 : 1));
        walk.push(peer);
      }
    }

    const buckets = new Map<number, string[]>();
    for (const id of peers) {
      const column = columns.get(id) ?? 0;
      const items = buckets.get(column) ?? [];
      items.push(id);
      buckets.set(column, items);
    }
    for (const items of buckets.values()) items.sort(compare);
    let minColumn = Infinity;
    let maxColumn = -Infinity;
    for (const column of buckets.keys()) {
      minColumn = Math.min(minColumn, column);
      maxColumn = Math.max(maxColumn, column);
    }
    const localPositions = new Map<string, Point>();
    let minX = Infinity;
    let minY = Infinity;
    for (const [column, items] of [...buckets].sort(([a], [b]) => a - b)) {
      let y = 0;
      for (const id of items) {
        const x = (column - minColumn) * (NODE_WIDTH + columnGap);
        localPositions.set(id, { x, y });
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
         y += geometry.heightsByNode.get(id)! + rowGap;
      }
    }
    const componentWidth = (maxColumn - minColumn + 1) * (NODE_WIDTH + columnGap) - columnGap;
  for (const [id, point] of localPositions) {
      const placed = { x: componentX + point.x - minX, y: point.y - minY };
      result.set(id, placed);
    componentBottom = Math.max(componentBottom, placed.y + geometry.heightsByNode.get(id)!);
  }
    componentX += componentWidth + componentGap;
  }

  // Keep isolated local cards compact instead of placing one full card-width per item.
  const isolated = nodeIds.filter((id) => (adjacency.get(id)?.size ?? 0) === 0);
  if (isolated.length) {
    const columns = Math.ceil(Math.sqrt(isolated.length));
    const rowHeights: number[] = [];
    isolated.forEach((id, index) => {
      const row = Math.floor(index / columns);
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, geometry.heightsByNode.get(id)!);
    });
    const rowOffsets: number[] = [];
    let nextY = componentBottom + (componentX > 0 ? componentGap : 0);
    rowHeights.forEach((height, row) => {
      rowOffsets[row] = nextY;
      nextY += height + rowGap;
    });
    isolated.forEach((id, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      result.set(id, { x: column * (NODE_WIDTH + componentGap), y: rowOffsets[row]! });
    });
  }
  clearInitialBypasses(graph, result, geometry);
  geometryByPositions.set(result, { graph, geometry });
  return result;
}

/** Row order is stable by endpoint kind and then label, independent of input order. */
export function localPortsForNode(graph: LocalGraph, nodeId: string, geometry = indexLocalGraphGeometry(graph)): LocalGraphPort[] {
  return [...(geometry.portsByNode.get(nodeId) ?? [])];
}
