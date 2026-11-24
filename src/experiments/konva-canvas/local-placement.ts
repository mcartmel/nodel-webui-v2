import { cardHeight, cardHeightForPortCounts, curvePoint, edgeCurve, NODE_WIDTH, type Curve, type FixtureNode, type FixturePort, type Point } from './fixture';
import type { LocalGraph, LocalGraphNode, LocalGraphPort } from './local-graph';
import { fittedCameraScale } from './camera-selection';
import { createCardFootprint, footprintHeight, initialFootprintRows, isFullyInspected } from './card-footprint';
import { isSafeLayoutPoint, SESSION_LAYOUT_WORLD_LIMIT, type SessionCardPosition } from './session-layout';

export interface LocalPlacementOptions {
  columnGap?: number;
  rowGap?: number;
  componentGap?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}

export const LOCAL_GRAPH_INITIAL_CARD_LIMIT = 40;
export const LOCAL_GRAPH_FALLBACK_SAMPLE_SIZE = 8;

export interface LocalGraphMembership {
  readonly shown: ReadonlySet<string>;
  readonly deferred: ReadonlySet<string>;
  readonly discovered: number;
  readonly shouldOfferShowAll: boolean;
}

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

const BYPASS_CLEARANCE = 18;
const BYPASS_SWEEPS = 3;
const BYPASS_PAIR_LIMIT = 4_096;
const BYPASS_CHECK_LIMIT = 50_000;
const INVENTORY_GRID_COLUMNS = 10;
const INVENTORY_GRID_COLUMN_GAP = 44;
const INVENTORY_GRID_ROW_GAP = 32;
const INVENTORY_GRID_MINIMUM_ROWS = 4;
const INVENTORY_GROWTH_COLUMNS = 3;

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

/** Start disconnected inventory beyond a few typical peer-expansion columns. */
export function disconnectedInventoryAnchor(occupied: Iterable<FixtureNode>): Point {
  const cards = [...occupied];
  const right = cards.reduce((edge, card) => Math.max(edge, card.x + card.width), 0);
  const top = cards.length ? cards.reduce((edge, card) => Math.min(edge, card.y), cards[0]!.y) : 0;
  return { x: cards.length ? right + INVENTORY_GROWTH_COLUMNS * (NODE_WIDTH + 150) : 180, y: top };
}

/** Stable wrapping inventory grid; occupied cells are skipped, never reflowed. */
export function placeDisconnectedInventoryCard(
  card: FixtureNode,
  startSlot: number,
  anchor: Point,
  occupied: Iterable<FixtureNode>
): { readonly position: Point; readonly nextSlot: number } {
  const cards = [...occupied];
  const height = cardHeight(card);
  const rowPitch = disconnectedInventorySlotPitch(card);
  for (let slot = startSlot; slot < Number.MAX_SAFE_INTEGER; slot += 1) {
    const column = slot % INVENTORY_GRID_COLUMNS;
    const row = Math.floor(slot / INVENTORY_GRID_COLUMNS);
    const position = {
      x: anchor.x + column * (card.width + INVENTORY_GRID_COLUMN_GAP),
      y: anchor.y + row * rowPitch
    };
    const clear = cards.every((other) => {
      const otherHeight = cardHeight(other);
      return position.x + card.width + INVENTORY_GRID_ROW_GAP <= other.x ||
        other.x + other.width + INVENTORY_GRID_ROW_GAP <= position.x ||
        position.y + height + INVENTORY_GRID_ROW_GAP <= other.y ||
        other.y + otherHeight + INVENTORY_GRID_ROW_GAP <= position.y;
    });
    if (clear) return { position, nextSlot: slot + 1 };
  }
  throw new Error('No disconnected inventory grid slot is available.');
}

export function disconnectedInventorySlotPitch(card: FixtureNode): number {
  return Math.max(cardHeight(card), cardHeightForPortCounts(INVENTORY_GRID_MINIMUM_ROWS, INVENTORY_GRID_MINIMUM_ROWS)) + INVENTORY_GRID_ROW_GAP;
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
      return { id: port.id, label: port.name, direction: side === 'right' ? 'out' : 'in', side, localKind: port.kind };
    });
    fixtureNodes.set(id, { id, name: node.name, x: positions.get(id)!.x, y: 0, width: NODE_WIDTH, ports,
      ...(geometry.viewportHeight !== undefined ? { footprint: createCardFootprint(ports, isFullyInspected(node), geometry.viewportHeight) } : {}) });
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
  viewportHeight?: number;
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
export function indexLocalGraphGeometry(graph: LocalGraph, viewportHeight?: number): LocalGraphGeometry {
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
  for (const [nodeId, count] of counts) {
    heightsByNode.set(nodeId, viewportHeight === undefined ? cardHeightForPortCounts(count.left, count.right)
      : footprintHeight(initialFootprintRows(count, isFullyInspected(graph.nodes.get(nodeId)!), viewportHeight)));
  }
  return { portsByNode: byNode, heightsByNode, ...(viewportHeight === undefined ? {} : { viewportHeight }) };
}

/** Select an initial display cut without changing discovery or inspection eligibility. */
export function selectLocalGraphMembership(
  graph: LocalGraph,
  options: { threshold?: number; fallbackSampleSize?: number } = {}
): LocalGraphMembership {
  const nodes = [...graph.nodes.values()].sort((a, b) => compare(a.key, b.key) || compare(a.id, b.id));
  const threshold = Math.max(0, options.threshold ?? LOCAL_GRAPH_INITIAL_CARD_LIMIT);
  const fallbackSampleSize = Math.max(1, options.fallbackSampleSize ?? LOCAL_GRAPH_FALLBACK_SAMPLE_SIZE);
  const terminals = new Set<string>();
  for (const connection of graph.connections.values()) {
    const from = graph.ports.get(connection.fromPortId)?.nodeId;
    const to = graph.ports.get(connection.toPortId)?.nodeId;
    if (from) terminals.add(from);
    if (to) terminals.add(to);
  }
  const isTerminal = (node: LocalGraphNode): boolean => {
    if (node.origin === 'local') return true;
    if (node.inspectionState === 'read' || node.inspectionState === 'partial' || node.inspectionState === 'failed' || node.inspectionState === 'cutoff') return true;
    return node.lookupState === 'no-route' || node.lookupState === 'invalid' || node.lookupState === 'failed' || node.lookupState === 'blocked';
  };
  const shown = new Set<string>();
  if (nodes.length <= threshold) {
    for (const node of nodes) shown.add(node.id);
  } else {
    for (const node of nodes) if (node.origin === 'local' || terminals.has(node.id) || isTerminal(node)) shown.add(node.id);
    // A no-data preview must still have bounded, deterministic content.
    if (!shown.size) for (const node of nodes.slice(0, fallbackSampleSize)) shown.add(node.id);
  }
  const deferred = new Set(nodes.filter(({ id }) => !shown.has(id)).map(({ id }) => id));
  return { shown, deferred, discovered: nodes.length, shouldOfferShowAll: deferred.size > 0 };
}

/** Deterministic one-shot directed placement. Coordinates are world-space top-lefts. */
export function placeLocalGraph(graph: LocalGraph, options: LocalPlacementOptions = {}, geometry = indexLocalGraphGeometry(graph, options.viewportHeight)): Map<string, Point> {
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
  const components: { id: string; local: boolean; width: number; height: number; points: Map<string, Point> }[] = [];
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
    // In a large star keep a hosted peer (then the first named peers) near
    // the hub, not a screenful containing only shared overflow takeoffs.
    for (const [column, fan] of buckets) {
      if (fan.length < 8) continue;
      const adjacentHub = [column - 1, column + 1].some(other => {
        const bucket = buckets.get(other);
        return bucket?.length === 1 && fan.every(id => adjacency.get(bucket[0]!)!.has(id));
      });
      if (!adjacentHub) continue;
      const ordered = [...fan].sort((a, b) => Number(graph.nodes.get(b)?.origin === 'local') - Number(graph.nodes.get(a)?.origin === 'local') || compare(a, b));
      const center = Math.floor((fan.length - 1) / 2);
      ordered.forEach((id, i) => { fan[center + (i % 2 ? (i + 1) / 2 : -i / 2)] = id; });
    }
    let minColumn = Infinity;
    let maxColumn = -Infinity;
    for (const column of buckets.keys()) {
      minColumn = Math.min(minColumn, column);
      maxColumn = Math.max(maxColumn, column);
    }
    const localPositions = new Map<string, Point>();
    let minX = Infinity;
    let minY = Infinity;
    // A fan-out hub aligned with the top of a tall peer column makes most
    // links needlessly traverse its entire height. Center only a singleton
    // hub against a directly adjacent fan; retain the normal small layout.
    for (const [column, items] of [...buckets].sort(([a], [b]) => a - b)) {
      let y = 0;
      if (items.length === 1 && adjacency.get(items[0]!)!.size >= 8) {
        const hub = items[0]!;
        for (const adjacent of [column - 1, column + 1]) {
          const fan = buckets.get(adjacent);
          if (!fan || fan.length < 8 || !fan.every(id => adjacency.get(hub)!.has(id))) continue;
          const height = fan.reduce((sum, id) => sum + rowGap + geometry.heightsByNode.get(id)!, -rowGap);
          y = Math.max(y, (height - geometry.heightsByNode.get(hub)!) / 2);
        }
      }
      for (const id of items) {
        const x = (column - minColumn) * (NODE_WIDTH + columnGap);
        localPositions.set(id, { x, y });
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        y += geometry.heightsByNode.get(id)! + rowGap;
      }
    }
    const componentWidth = (maxColumn - minColumn + 1) * (NODE_WIDTH + columnGap) - columnGap;
    let componentHeight = 0;
    for (const [id, point] of localPositions) componentHeight = Math.max(componentHeight, point.y + geometry.heightsByNode.get(id)! - minY);
    components.push({ id: [...peers].sort(compare)[0]!, local: localPeers.length > 0, width: componentWidth, height: componentHeight, points: localPositions });
  }

  // Stable shelf packing keeps unrelated groups near one another rather than
  // extending the canvas indefinitely along X. Local groups lead the first shelf.
  components.sort((a, b) => Number(b.local) - Number(a.local) || b.width * b.height - a.width * a.height || compare(a.id, b.id));
  const aspect = Math.max(0.5, Math.min(3, (options.viewportWidth ?? 16) / (options.viewportHeight ?? 9)));
  const totalArea = components.reduce((sum, component) => sum + (component.width + componentGap) * (component.height + componentGap), 0);
  const shelfWidth = Math.max(components[0]?.width ?? 0, Math.sqrt(totalArea * aspect));
  let shelfX = 0;
  let shelfY = 0;
  let shelfHeight = 0;
  let connectedBottom = 0;
  for (const component of components) {
    if (shelfX > 0 && shelfX + component.width > shelfWidth) {
      shelfX = 0;
      shelfY += shelfHeight + componentGap;
      shelfHeight = 0;
    }
    for (const [id, point] of component.points) result.set(id, { x: shelfX + point.x, y: shelfY + point.y });
    shelfX += component.width + componentGap;
    shelfHeight = Math.max(shelfHeight, component.height);
    connectedBottom = Math.max(connectedBottom, shelfY + component.height);
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
    let nextY = connectedBottom + (components.length ? componentGap : 0);
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

export interface LocalCardFootprint { readonly width: number; readonly height: number }

export interface LocalCardRectangle extends Point, LocalCardFootprint { readonly id: string }

export function localCardRectangle(card: FixtureNode): LocalCardRectangle {
  return { id: card.id, x: card.x, y: card.y, width: card.width, height: cardHeight(card) };
}

const UNKNOWN_SAVED_HEIGHT = footprintHeight({ left: 0, right: 0 });

/** Geometry only: absent saved anchors never enter the graph or projection. */
export function* pendingLocalCardReservations(
  pending: ReadonlyMap<string, SessionCardPosition>, heights?: ReadonlyMap<string, number>
): IterableIterator<LocalCardRectangle> {
  for (const [id, { x, y }] of pending) {
    if (isSafeLayoutPoint(x, y)) yield { id, x, y, width: NODE_WIDTH, height: heights?.get(id) ?? UNKNOWN_SAVED_HEIGHT };
  }
}

export function localCardRectanglesOverlap(a: LocalCardRectangle, b: LocalCardRectangle): boolean {
  return a.id !== b.id && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Nearest Euclidean top-left outside all expanded obstacles. Touching edges are legal. */
function closestClearPosition(card: LocalCardRectangle, target: Point, occupied: readonly LocalCardRectangle[]): Point {
  const { x, y } = isSafeLayoutPoint(target.x, target.y) ? target : { x: 0, y: 0 };
  const candidate = { ...card, x, y };
  if (!occupied.some(other => localCardRectanglesOverlap(candidate, other))) return { x, y };
  const obstacles = occupied.filter(other => other.id !== card.id).map(other => ({
    left: other.x - card.width, right: other.x + other.width, start: other.y - card.height, end: other.y + other.height
  })).sort((a, b) => a.start - b.start);
  const columns = new Set([x, -SESSION_LAYOUT_WORLD_LIMIT, SESSION_LAYOUT_WORLD_LIMIT]);
  for (const { left, right } of obstacles) {
    if (isSafeLayoutPoint(left, y)) columns.add(left);
    if (isSafeLayoutPoint(right, y)) columns.add(right);
  }
  let best: Point | undefined;
  let bestDistance = Infinity;
  const consider = (candidateX: number, candidateY: number) => {
    if (!isSafeLayoutPoint(candidateX, candidateY)) return;
    const distance = (candidateX - x) ** 2 + (candidateY - y) ** 2;
    if (!best || distance < bestDistance || (distance === bestDistance &&
      (candidateX < best.x || (candidateX === best.x && candidateY < best.y)))) {
      best = { x: candidateX, y: candidateY };
      bestDistance = distance;
    }
  };
  // With x fixed, merge overlapping bands at that x and find the open
  // interval containing the target. The optimum is on one of its boundaries.
  for (const candidateX of [...columns].sort((a, b) => Math.abs(a - x) - Math.abs(b - x) || a - b)) {
    if ((candidateX - x) ** 2 > bestDistance) break;
    let start = -Infinity;
    let end = -Infinity;
    for (const obstacle of obstacles) {
      if (obstacle.start >= Math.max(y, end)) break;
      if (candidateX <= obstacle.left || candidateX >= obstacle.right) continue;
      if (obstacle.start < end) end = Math.max(end, obstacle.end);
      else { start = obstacle.start; end = obstacle.end; }
    }
    if (start < y && y < end) {
      consider(candidateX, start);
      consider(candidateX, end);
    } else consider(candidateX, y);
  }
  return best ?? { x, y };
}

/** Cold restore reserves unmounted anchors, then uses pins, saved autos, and new positions in that order. */
export function restoreInitialLocalCards(
  cards: FixtureNode[], pending: Map<string, SessionCardPosition>, pinned: Set<string>, heights?: ReadonlyMap<string, number>
): boolean {
  const candidates = cards.flatMap((card) => {
    const saved = pending.get(card.id);
    if (!saved) return [];
    pending.delete(card.id);
    return isSafeLayoutPoint(saved.x, saved.y) ? [{ card, saved }] : [];
  }).sort((a, b) => Number(b.saved.pinned) - Number(a.saved.pinned) || compare(a.card.id, b.card.id));
  if (!candidates.length && !pending.size) return false;
  const occupied = [...pendingLocalCardReservations(pending, heights)];
  const restored = new Set<string>();
  const displaced: typeof candidates = [];
  for (const { card, saved } of candidates) {
    card.x = saved.x;
    card.y = saved.y;
    const rect = localCardRectangle(card);
    if (!saved.pinned && occupied.some(other => localCardRectanglesOverlap(rect, other))) {
      displaced.push({ card, saved });
      continue;
    }
    occupied.push(rect);
    restored.add(card.id);
    if (saved.pinned) pinned.add(card.id);
  }
  for (const { card, saved } of displaced) {
    Object.assign(card, closestClearPosition(localCardRectangle(card), saved, occupied));
    occupied.push(localCardRectangle(card));
    restored.add(card.id);
  }
  for (const card of cards) {
    if (restored.has(card.id)) continue;
    Object.assign(card, closestClearPosition(localCardRectangle(card), card, occupied));
    occupied.push(localCardRectangle(card));
  }
  return true;
}

/** Restore a late pin exactly; a larger than expected footprint may displace only colliding auto cards. */
export function restoreLateLocalCard(
  card: FixtureNode, saved: SessionCardPosition | undefined, occupied: FixtureNode[], pinned: Set<string>,
  reservations: Iterable<LocalCardRectangle> = [], movable: (id: string) => boolean = () => true
): Map<string, Point> | undefined {
  if (saved?.pinned && isSafeLayoutPoint(saved.x, saved.y)) {
    card.x = saved.x;
    card.y = saved.y;
    pinned.add(card.id);
    const placed = localCardRectangle(card);
    const displaced: LocalCardRectangle[] = [];
    const obstacles = [placed];
    for (const node of occupied) {
      const rectangle = localCardRectangle(node);
      if (!pinned.has(node.id) && movable(node.id) && localCardRectanglesOverlap(placed, rectangle)) displaced.push(rectangle);
      else obstacles.push(rectangle);
    }
    if (!displaced.length) return;
    for (const reservation of reservations) obstacles.push(reservation);
    const changes = new Map<string, Point>();
    for (const rectangle of displaced.sort((a, b) => compare(a.id, b.id))) {
      const position = closestClearPosition(rectangle, rectangle, obstacles);
      changes.set(rectangle.id, position);
      obstacles.push({ ...rectangle, ...position });
    }
    return changes;
  } else {
    Object.assign(card, closestClearPosition(localCardRectangle(card), saved ?? card, [...occupied.map(localCardRectangle), ...reservations]));
    return undefined;
  }
}

export interface InitialLocalGroupFrame {
  readonly nodeIds: readonly [string, string];
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly center: Point;
  readonly scale: number;
}

export interface InitialLocalPlacement {
  readonly membership: LocalGraphMembership;
  readonly graph: LocalGraph;
  readonly positions: ReadonlyMap<string, Point>;
  /** The best directly wired pair containing a local owner, sized for the viewport. */
  readonly initialGroup?: InitialLocalGroupFrame;
}

/** Compute the first real membership/layout plus a coherent, legible camera target. */
export function placeInitialLocalGraph(
  graph: LocalGraph,
  viewport: { readonly width: number; readonly height: number },
  minimumScale = 0.35
): InitialLocalPlacement {
  const membership = selectLocalGraphMembership(graph);
  const visibleGraph: LocalGraph = {
    ...graph,
    nodes: new Map([...graph.nodes].filter(([id]) => membership.shown.has(id))),
    ports: new Map([...graph.ports].filter(([, port]) => membership.shown.has(port.nodeId))),
    connections: new Map([...graph.connections].filter(([, connection]) => {
      const from = graph.ports.get(connection.fromPortId)?.nodeId;
      const to = graph.ports.get(connection.toPortId)?.nodeId;
      return !!from && !!to && membership.shown.has(from) && membership.shown.has(to);
    }))
  };
  const positions = placeLocalGraph(visibleGraph, { viewportWidth: viewport.width, viewportHeight: viewport.height });
  const geometry = localGraphGeometryForPositions(visibleGraph, positions) ?? indexLocalGraphGeometry(visibleGraph, viewport.height);
  const candidates = [...visibleGraph.connections.values()].flatMap((connection) => {
    const from = visibleGraph.ports.get(connection.fromPortId)?.nodeId;
    const to = visibleGraph.ports.get(connection.toPortId)?.nodeId;
    if (!from || !to || from === to || (visibleGraph.nodes.get(from)?.origin !== 'local' && visibleGraph.nodes.get(to)?.origin !== 'local')) return [];
    const a = positions.get(from);
    const b = positions.get(to);
    if (!a || !b) return [];
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const width = Math.max(a.x + NODE_WIDTH, b.x + NODE_WIDTH) - x;
    const height = Math.max(a.y + geometry.heightsByNode.get(from)!, b.y + geometry.heightsByNode.get(to)!) - y;
    const scale = fittedCameraScale(viewport.width, viewport.height, width, height);
    return [{ id: connection.id, frame: { nodeIds: [from, to] as const, bounds: { x, y, width, height },
      center: { x: x + width / 2, y: y + height / 2 }, scale } }];
  }).filter(({ frame }) => frame.scale >= minimumScale).sort((a, b) => b.frame.scale - a.frame.scale || compare(a.id, b.id));
  return { membership, graph: visibleGraph, positions, ...(candidates[0] ? { initialGroup: candidates[0].frame } : {}) };
}

/** Arrange without moving dragged anchors; return only auto-card coordinates. */
export function arrangeLocalGraph(
  graph: LocalGraph,
  currentPositions: ReadonlyMap<string, Point>,
  draggedAnchors: ReadonlySet<string>,
  options: LocalPlacementOptions = {},
  geometry = indexLocalGraphGeometry(graph, options.viewportHeight),
  footprints: ReadonlyMap<string, LocalCardFootprint> = new Map(),
  reservations: Iterable<LocalCardRectangle> = []
): Map<string, Point> {
  const heightsByNode = new Map(geometry.heightsByNode);
  for (const [id, footprint] of footprints) heightsByNode.set(id, footprint.height);
  const proposed = placeLocalGraph(graph, options, { ...geometry, heightsByNode });
  // Preserve each connected component relative to its moved anchor instead of
  // leaving its related cards behind at the canonical origin.
  const adjacency = new Map([...graph.nodes.keys()].map((id) => [id, new Set<string>()]));
  for (const connection of graph.connections.values()) {
    const from = graph.ports.get(connection.fromPortId)?.nodeId;
    const to = graph.ports.get(connection.toPortId)?.nodeId;
    if (!from || !to || from === to) continue;
    adjacency.get(from)?.add(to);
    adjacency.get(to)?.add(from);
  }
  const visited = new Set<string>();
  for (const seed of graph.nodes.keys()) {
    if (visited.has(seed)) continue;
    const component: string[] = [];
    const queue = [seed];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const id = queue[cursor]!;
      if (visited.has(id)) continue;
      visited.add(id);
      component.push(id);
      for (const peer of adjacency.get(id) ?? []) if (!visited.has(peer)) queue.push(peer);
    }
    const anchorId = component.filter((id) => draggedAnchors.has(id) && currentPositions.has(id)).sort(compare)[0];
    if (!anchorId) continue;
    const canonical = proposed.get(anchorId);
    const anchored = currentPositions.get(anchorId);
    if (!canonical || !anchored) continue;
    const dx = anchored.x - canonical.x;
    const dy = anchored.y - canonical.y;
    for (const id of component) {
      if (draggedAnchors.has(id)) continue;
      const point = proposed.get(id);
      if (point) proposed.set(id, { x: point.x + dx, y: point.y + dy });
    }
  }
  const gap = options.componentGap ?? 180;
  const footprint = (id: string): LocalCardFootprint => footprints.get(id) ?? { width: NODE_WIDTH, height: geometry.heightsByNode.get(id) ?? 90 };
  const result = new Map<string, Point>();
  const occupied: { id: string; point: Point; bounds: LocalCardFootprint }[] = [];
  for (const id of [...graph.nodes.keys()].sort(compare)) {
    const point = draggedAnchors.has(id) ? currentPositions.get(id) : undefined;
    if (point) occupied.push({ id, point, bounds: footprint(id) });
  }
  for (const { id, x, y, width, height } of reservations) occupied.push({ id, point: { x, y }, bounds: { width, height } });
  const intersects = (point: Point, bounds: LocalCardFootprint, other: typeof occupied[number]): boolean =>
    point.x < other.point.x + other.bounds.width + gap && point.x + bounds.width + gap > other.point.x &&
    point.y < other.point.y + other.bounds.height + gap && point.y + bounds.height + gap > other.point.y;
  for (const id of [...graph.nodes.keys()].filter((nodeId) => !draggedAnchors.has(nodeId)).sort(compare)) {
    const bounds = footprint(id);
    const preferred = proposed.get(id) ?? { x: 0, y: 0 };
    let point = { ...preferred };
    let attempts = 0;
    while (occupied.some((other) => intersects(point, bounds, other)) && attempts < 10_000) {
      const blocking = occupied.find((other) => intersects(point, bounds, other))!;
      point.y = blocking.point.y + blocking.bounds.height + gap;
      attempts += 1;
    }
    if (!isSafeLayoutPoint(point.x, point.y) || attempts === 10_000) {
      point = closestClearPosition({ id, ...preferred, ...bounds },
        isSafeLayoutPoint(preferred.x, preferred.y) ? preferred : (currentPositions.get(id) ?? { x: 0, y: 0 }),
        occupied.map(({ id: occupiedId, point, bounds }) => ({ id: occupiedId, ...point, ...bounds })));
    }
    result.set(id, point);
    occupied.push({ id, point, bounds });
  }
  return result;
}

function projectedCardId(id: string): string {
  let encoded = '';
  for (let index = 0; index < id.length; index += 1) encoded += id.charCodeAt(index).toString(16).padStart(4, '0');
  return `n-${encoded || 'empty'}`;
}

/** Renderer-ID adapter for Arrange; hidden/deferred graph nodes are excluded. */
export function arrangeDisplayedLocalGraph(
  graph: LocalGraph,
  current: ReadonlyMap<string, Point>,
  pinned: ReadonlySet<string>,
  footprints: ReadonlyMap<string, LocalCardFootprint>,
  options: LocalPlacementOptions = {},
  reservations?: Iterable<LocalCardRectangle>
): Map<string, Point> {
  const logicalIdByCard = new Map([...graph.nodes.keys()].map((id) => [projectedCardId(id), id]));
  const visibleIds = new Set([...current.keys()].map((id) => logicalIdByCard.get(id)).filter((id): id is string => id !== undefined));
  const visibleNodes = new Map([...graph.nodes].filter(([id]) => visibleIds.has(id)));
  const visiblePorts = new Map([...graph.ports].filter(([, port]) => visibleIds.has(port.nodeId)));
  const visibleConnections = new Map([...graph.connections].filter(([, connection]) => {
    const from = graph.ports.get(connection.fromPortId)?.nodeId;
    const to = graph.ports.get(connection.toPortId)?.nodeId;
    return !!from && !!to && visibleIds.has(from) && visibleIds.has(to);
  }));
  const visibleGraph: LocalGraph = { ...graph, nodes: visibleNodes, ports: visiblePorts, connections: visibleConnections };
  const logicalPositions = new Map<string, Point>();
  for (const [id, point] of current) {
    const logicalId = logicalIdByCard.get(id);
    if (logicalId) logicalPositions.set(logicalId, point);
  }
  const logicalPinned = new Set([...pinned].map((id) => logicalIdByCard.get(id)).filter((id): id is string => id !== undefined));
  const logicalFootprints = new Map<string, LocalCardFootprint>();
  for (const [id, footprint] of footprints) {
    const logicalId = logicalIdByCard.get(id);
    if (logicalId) logicalFootprints.set(logicalId, footprint);
  }
  const arranged = arrangeLocalGraph(visibleGraph, logicalPositions, logicalPinned, options, indexLocalGraphGeometry(visibleGraph, options.viewportHeight), logicalFootprints,
    reservations);
  return new Map([...arranged].map(([id, point]) => [projectedCardId(id), point]));
}

/** True when a real local component contains a readable two-card configured link. */
export function hasReadableLocalConnection(
  graph: LocalGraph,
  viewport: { readonly width: number; readonly height: number },
  minimumZoom = 0.35
): boolean {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) return false;
  const geometry = indexLocalGraphGeometry(graph, viewport.height);
  for (const connection of graph.connections.values()) {
    const from = graph.ports.get(connection.fromPortId);
    const to = graph.ports.get(connection.toPortId);
    if (!from || !to || from.nodeId === to.nodeId) continue;
    if (graph.nodes.get(from.nodeId)?.origin !== 'local' && graph.nodes.get(to.nodeId)?.origin !== 'local') continue;
    // A configured pair can be placed in adjacent flow columns. Estimate only
    // this pair's footprint; do not speculate by running a candidate layout.
    const bounds = { width: NODE_WIDTH * 2 + 150, height: geometry.heightsByNode.get(from.nodeId)! + geometry.heightsByNode.get(to.nodeId)! + 28 };
    if (fittedCameraScale(viewport.width, viewport.height, bounds.width, bounds.height) >= minimumZoom) return true;
  }
  return false;
}

/** Row order is stable by endpoint kind and then label, independent of input order. */
export function localPortsForNode(graph: LocalGraph, nodeId: string, geometry = indexLocalGraphGeometry(graph)): LocalGraphPort[] {
  return [...(geometry.portsByNode.get(nodeId) ?? [])];
}
