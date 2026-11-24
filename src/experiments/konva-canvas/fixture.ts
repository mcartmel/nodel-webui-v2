import type { CardFootprint, OverflowDirection, PortAttachment, TakeoffRole } from './card-footprint';

export type PortSide = 'left' | 'right';
export type PortDirection = 'in' | 'out';

export interface FixturePort {
  id: string;
  label: string;
  direction: PortDirection;
  side: PortSide;
  /** Local-graph endpoint role; intentionally absent on synthetic fixtures. */
  localKind?: 'remote-action' | 'remote-event' | 'local-action' | 'local-event';
}

export interface FixtureNode {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  ports: readonly FixturePort[];
  /** Screen-derived reservation fixed at first real-card placement. */
  footprint?: CardFootprint;
  status?: 'online' | 'standby';
  /** Real-data presentation; intentionally separate from synthetic health. */
  displayStatus?: string;
  /** Compact real-card subtitle; no clean-state counts or redundant locality text. */
  displayQualifier?: string;
  statusKind?: 'local' | 'partial' | 'referenced';
  /** Real-data host evidence only; omitted for synthetic fixtures. */
  hostKind?: 'local' | 'remote' | 'unknown';
  /** Origin provenance; omitted for synthetic fixtures. */
  origin?: 'local' | 'referenced';
  /** Exact unambiguous hosted-name evidence from the local snapshot. */
  localPathName?: string;
  hostDescription?: string;
  /** Safe host + binding evidence for native/accessibility descriptions. */
  tooltip?: string;
}

export interface FixtureEdge {
  id: string;
  from: { nodeId: string; portId: string };
  to: { nodeId: string; portId: string };
  selfLoop?: boolean;
  /** Local projection found a connection in the opposite direction. */
  reciprocal?: boolean;
  /** Top-to-bottom target socket rank among bindings with the same ordered node pair. */
  laneIndex?: number;
  laneCount?: number;
  /** Reserve a separate band for the other direction in a shared vertical corridor. */
  oppositeLaneCount?: number;
  /** Scene-local lane adjustment. Omitted for authored and direct routes. */
  routeOffset?: LaneOffset | undefined;
  /** Route family owning the cached adjustment; mismatched families ignore it. */
  routeOffsetFamily?: 'corridor' | 'exterior';
  /** Binding identity metadata; intentionally absent on synthetic fixtures. */
  bindingKind?: 'action' | 'event';
  ownerId?: string;
  bindingAlias?: string;
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

export const FIXTURE_NODE_COUNTS = [9, 50, 150, 450] as const;
export type FixtureNodeCount = typeof FIXTURE_NODE_COUNTS[number];

/** Repeats the authored nine-card motif on a deterministic grid; partial motifs retain only fully-connected edges. */
export function createFixture(nodeCount: FixtureNodeCount): { nodes: FixtureNode[]; edges: FixtureEdge[] } {
  const motifCount = Math.ceil(nodeCount / fixtureNodes.length);
  const columns = Math.ceil(Math.sqrt(motifCount));
  const tileWidth = 1320;
  const tileHeight = 1100;
  const nodes: FixtureNode[] = [];
  const edges: FixtureEdge[] = [];

  for (let tile = 0; tile < motifCount; tile += 1) {
    const prefix = tile === 0 ? '' : `tile-${String(tile + 1).padStart(2, '0')}-`;
    const dx = (tile % columns) * tileWidth;
    const dy = Math.floor(tile / columns) * tileHeight;
    const included = Math.min(fixtureNodes.length, nodeCount - nodes.length);
    const nodeIds = new Set(fixtureNodes.slice(0, included).map((node) => node.id));

    for (const node of fixtureNodes.slice(0, included)) {
      nodes.push({ ...node, id: `${prefix}${node.id}`, x: node.x + dx, y: node.y + dy, ports: [...node.ports] });
    }
    for (const edge of fixtureEdges) {
      if (!nodeIds.has(edge.from.nodeId) || !nodeIds.has(edge.to.nodeId)) continue;
      edges.push({
        ...edge,
        id: `${prefix}${edge.id}`,
        from: { ...edge.from, nodeId: `${prefix}${edge.from.nodeId}` },
        to: { ...edge.to, nodeId: `${prefix}${edge.to.nodeId}` }
      });
    }
  }
  return { nodes, edges };
}

export function cardHeight(node: FixtureNode): number {
  if (node.footprint) return node.footprint.height;
  const { rowCounts } = portLayout(node.ports);
  return cardHeightForPortCounts(rowCounts.left, rowCounts.right);
}

/** Card height when only the number of rows per side is known. */
export function cardHeightForPortCounts(left: number, right: number): number {
  const rowCount = Math.max(left, right);
  return PORTS_TOP + rowCount * PORT_ROW_HEIGHT + 14;
}

export interface Point { x: number; y: number }
export interface LaneOffset extends Point { entryX?: number }
export interface RailGeometry {
  family: 'exterior' | 'corridor';
  start: Point;
  end: Point;
  exitX: number;
  entryX: number;
  y: number;
  /** All translated ranks, including the reciprocal band, fit the current corridor. */
  fanFits?: boolean;
}
type RailObserver = (rail: RailGeometry) => void;
export interface Curve { start: Point; control1: Point; control2: Point; end: Point }

interface PortLayoutEntry {
  port: FixturePort;
  row: number;
}

interface PortLayout {
  byId: ReadonlyMap<string, PortLayoutEntry>;
  rowCounts: Readonly<Record<PortSide, number>>;
}

// Port arrays are treated as immutable after node creation, so their row layout
// remains stable while node positions continue to be read live during drags.
const portLayouts = new WeakMap<readonly FixturePort[], PortLayout>();

function portLayout(ports: readonly FixturePort[]): PortLayout {
  const cached = portLayouts.get(ports);
  if (cached) return cached;

  const byId = new Map<string, PortLayoutEntry>();
  const rowCounts: Record<PortSide, number> = { left: 0, right: 0 };
  for (const item of ports) {
    const row = rowCounts[item.side];
    byId.set(item.id, { port: item, row });
    rowCounts[item.side] = row + 1;
  }
  const layout = { byId, rowCounts };
  portLayouts.set(ports, layout);
  return layout;
}

function portEntry(node: FixtureNode, portId: string): PortLayoutEntry | PortAttachment {
  const entry = node.footprint ? node.footprint.attachment(portId) : portLayout(node.ports).byId.get(portId);
  if (!entry) throw new Error(`Unknown port ${portId} on ${node.id}`);
  return entry;
}

const entrySide = (entry: PortLayoutEntry | PortAttachment) => 'port' in entry ? entry.port.side : entry.side;

export const portRowCenter = (row: number): number => PORTS_TOP + (row + 0.5) * PORT_ROW_HEIGHT;

export const overflowSocketOffset = (direction: OverflowDirection, role: TakeoffRole): number =>
  direction === 'above' ? (role === 'alias' ? 5 : 15) : (role === 'alias' ? 8 : 23);

function portPointAt(node: FixtureNode, entry: PortLayoutEntry | PortAttachment, position: Point): Point {
  return {
    x: position.x + (entrySide(entry) === 'left' ? 0 : node.width),
    y: position.y + ('role' in entry
      ? node.footprint!.railTop(entry.direction) + overflowSocketOffset(entry.direction, entry.role)
      : portRowCenter(entry.row))
  };
}

export function portPoint(node: FixtureNode, portId: string, position: Point = node): Point {
  return portPointAt(node, portEntry(node, portId), position);
}

export function edgeCurve(edge: FixtureEdge, nodes: ReadonlyMap<string, FixtureNode>, positions?: ReadonlyMap<string, Point>): Curve {
  const source = nodes.get(edge.from.nodeId);
  const target = nodes.get(edge.to.nodeId);
  if (!source || !target) throw new Error(`Unknown endpoint for edge ${edge.id}`);
  const sourcePort = portEntry(source, edge.from.portId);
  const targetPort = portEntry(target, edge.to.portId);
  const sourcePosition = positions?.get(source.id) ?? source;
  const targetPosition = positions?.get(target.id) ?? target;
  const start = portPointAt(source, sourcePort, sourcePosition);
  const end = portPointAt(target, targetPort, targetPosition);
  const handle = Math.max(44, Math.min(128, Math.abs(end.x - start.x) * 0.42));
  const sourceTangent = entrySide(sourcePort) === 'right' ? 1 : -1;
  const targetTangent = entrySide(targetPort) === 'left' ? 1 : -1;
  return {
    start, end,
    control1: { x: start.x + sourceTangent * handle, y: start.y },
    control2: { x: end.x - targetTangent * handle, y: end.y }
  };
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const lineCurve = (start: Point, end: Point): Curve => ({ start, control1: lerp(start, end, 1 / 3), control2: lerp(start, end, 2 / 3), end });

/** Round the elbows of an orthogonal rail without overshooting its clearances. */
function roundedRail(start: Point, end: Point, exitX: number, entryX: number, y: number, maxRadius = 12): Curve[] {
  const points = [start, { x: exitX, y: start.y }, { x: exitX, y }, { x: entryX, y }, { x: entryX, y: end.y }, end];
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const curves: Curve[] = [];
  let tail = start;
  for (let i = 1; i < points.length - 1; i += 1) {
    const corner = points[i]!;
    const prev = points[i - 1]!;
    const next = points[i + 1]!;
    const incoming = distance(corner, prev);
    const outgoing = distance(corner, next);
    const radius = Math.min(maxRadius, incoming / 2, outgoing / 2);
    const before = lerp(corner, prev, incoming ? radius / incoming : 0);
    const after = lerp(corner, next, outgoing ? radius / outgoing : 0);
    curves.push(lineCurve(tail, before), { start: before, control1: lerp(before, corner, 2 / 3), control2: lerp(after, corner, 2 / 3), end: after });
    tail = after;
  }
  curves.push(lineCurve(tail, end));
  return curves;
}

/** Subdivide the direct cubic to blend into a rail while still in a clear horizontal gap. */
function blendRail(direct: Curve, rail: Curve[], weight: number): Curve[] {
  let rest = direct;
  return rail.map((part, index) => {
    const t = 1 / (rail.length - index);
    const a = lerp(rest.start, rest.control1, t);
    const b = lerp(rest.control1, rest.control2, t);
    const c = lerp(rest.control2, rest.end, t);
    const d = lerp(a, b, t);
    const e = lerp(b, c, t);
    const split = lerp(d, e, t);
    const result = { start: lerp(rest.start, part.start, weight), control1: lerp(a, part.control1, weight), control2: lerp(d, part.control2, weight), end: lerp(split, part.end, weight) };
    rest = { start: split, control1: e, control2: c, end: rest.end };
    return result;
  });
}

function facingCurve(direct: Curve, gap: number): Curve {
  // Keep the controls ordered in X, even when edgeCurve's minimum handle is
  // wider than half the gap. Neither card can then cover the cubic.
  const handle = Math.min(direct.control1.x - direct.start.x, gap / 2);
  return { ...direct, control1: { x: direct.start.x + handle, y: direct.start.y }, control2: { x: direct.end.x - handle, y: direct.end.y } };
}

const RECIPROCAL_RAIL_HALF_OFFSET = 8;

function reciprocalCorridor(direct: Curve, upperBottom: number, lowerTop: number, above: boolean, laneOffset: LaneOffset, observe?: RailObserver): Curve[] {
  const { start, end } = direct;
  const gap = end.x - start.x;
  const directGap = 40;
  if (gap >= directGap) return [facingCurve(direct, gap)];

  const lead = 24;
  const halfLaneSpacing = Math.min(RECIPROCAL_RAIL_HALF_OFFSET, (lowerTop - upperBottom) / 3);
  const appliedOffset = gap <= lead ? laneOffset : { x: 0, y: 0 };
  const y = (upperBottom + lowerTop) / 2 + (above ? -halfLaneSpacing : halfLaneSpacing) + appliedOffset.y;
  const radius = Math.max(0, Math.min(8, y - upperBottom - 1, lowerTop - y - 1));
  // Leave each socket on its own side, with room for the card's stroke and
  // the arrow. The legs stop in the Y corridor: extending them past it (or
  // trying to reach the far side of both cards first) can cross the peer.
  const exitX = start.x + lead + appliedOffset.x;
  const entryX = end.x - lead - (appliedOffset.entryX ?? appliedOffset.x);
  if (gap <= lead) observe?.({ family: 'corridor', start, end, exitX, entryX, y });
  const rail = roundedRail(start, end, exitX, entryX, y, radius);
  if (gap <= lead) return rail;

  // Both paths' control hulls now fit in the horizontal gap, so the morph
  // remains clear and converges to exactly the direct cubic during a drag.
  const t = (directGap - gap) / (directGap - lead);
  return blendRail(facingCurve(direct, gap), rail, t * t * (3 - 2 * t));
}

const LANE_SPACING = 12;
export const MIN_LANE_CLEARANCE = 12;
const MIN_RECIPROCAL_CORRIDOR = 2 * (MIN_LANE_CLEARANCE + RECIPROCAL_RAIL_HALF_OFFSET);

function exteriorRoute(
  edge: FixtureEdge,
  start: Point,
  end: Point,
  target: FixtureNode,
  sourcePosition: Point,
  targetPosition: Point,
  sourceBottom: number,
  targetBottom: number,
  above: boolean,
  direct: Curve,
  gap: number,
  laneOffset: LaneOffset, observe?: RailObserver, extraClearance = 0
): Curve[] {
  const margin = 32;
  // Keep the exterior turns on the same 12px pitch as corridor lanes. The
  // routing margin above is deliberately distinct from this visual clearance.
  const clearance = 36 + extraClearance;
  const appliedOffset = edge.reciprocal || gap < -margin ? laneOffset : { x: 0, y: 0 };
  const index = edge.laneIndex ?? 0;
  // From above, the bottom rows need the outermost rails; from below, it's
  // the top rows. Outer legs also have to reach farther out in X to wrap
  // around both ends of the inner rail rather than crossing it.
  const offset = (above ? index : (edge.laneCount ?? 1) - 1 - index) * LANE_SPACING;
  const y = (above ? Math.min(sourcePosition.y, targetPosition.y) - margin : Math.max(sourceBottom, targetBottom) + margin + 20)
    + (above ? -offset : offset) + appliedOffset.y;
  const exitX = Math.max(start.x, targetPosition.x + target.width) + clearance + offset + appliedOffset.x;
  const entryX = Math.min(sourcePosition.x, end.x) - clearance - offset - (appliedOffset.entryX ?? appliedOffset.x);
  if (edge.reciprocal || gap < -margin) observe?.({ family: 'exterior', start, end, exitX, entryX, y });
  const rail = roundedRail(start, end, exitX, entryX, y, (edge.laneCount ?? 1) > 1 ? 5 : 12);
  return edge.reciprocal ? rail : gap >= -margin ? blendRail(direct, rail, -gap / margin) : rail;
}

function routeCurves(edge: FixtureEdge, nodes: ReadonlyMap<string, FixtureNode>, positions?: ReadonlyMap<string, Point>, observe?: RailObserver): Curve[] {
  if (edge.selfLoop) {
    const node = nodes.get(edge.from.nodeId);
    if (!node) throw new Error(`Unknown endpoint for edge ${edge.id}`);
    const position = positions?.get(node.id);
    const start = portPoint(node, edge.from.portId, position);
    const end = portPoint(node, edge.to.portId, position);
    const left = position?.x ?? node.x;
    const right = left + node.width;
    const outerLeft = left - 76;
    const outerRight = right + 76;
    const top = (position?.y ?? node.y) - 42;
    const acrossY = top - 24;
    const apexRight = { x: outerRight, y: acrossY };
    const apexLeft = { x: outerLeft, y: acrossY };
    return [
      { start, control1: { x: start.x + 64, y: start.y }, control2: { x: outerRight, y: acrossY }, end: apexRight },
      { start: apexRight, control1: { x: outerRight, y: acrossY - 32 }, control2: { x: outerLeft, y: acrossY - 32 }, end: apexLeft },
      { start: apexLeft, control1: { x: outerLeft, y: end.y }, control2: { x: end.x - 64, y: end.y }, end }
    ];
  }
  const source = nodes.get(edge.from.nodeId);
  const target = nodes.get(edge.to.nodeId);
  if (!source || !target) throw new Error(`Unknown endpoint for edge ${edge.id}`);
  const sourcePort = portEntry(source, edge.from.portId);
  const targetPort = portEntry(target, edge.to.portId);
  const sourcePosition = positions?.get(source.id) ?? source;
  const targetPosition = positions?.get(target.id) ?? target;
  const start = portPointAt(source, sourcePort, sourcePosition);
  const end = portPointAt(target, targetPort, targetPosition);
  const direct = () => edgeCurve(edge, nodes, positions);
  const gap = end.x - start.x;
  const laneOffsetFor = (family: 'corridor' | 'exterior'): LaneOffset =>
    !edge.routeOffsetFamily || edge.routeOffsetFamily === family ? edge.routeOffset ?? { x: 0, y: 0 } : { x: 0, y: 0 };
  const margin = 32;
  if (entrySide(sourcePort) !== 'right' || entrySide(targetPort) !== 'left') return [direct()];

  const sourceBottom = sourcePosition.y + cardHeight(source);
  const targetBottom = targetPosition.y + cardHeight(target);
  const upperBottom = Math.min(sourceBottom, targetBottom);
  const lowerTop = Math.max(sourcePosition.y, targetPosition.y);
  const verticallySeparated = upperBottom <= lowerTop;
  const above = source.id > target.id;
  if (verticallySeparated && gap >= 40 && gap < 2 * margin) return [facingCurve(direct(), gap)];
  const count = edge.laneCount ?? 1;
  const oppositeCount = edge.oppositeLaneCount ?? 0;
  const corridorCount = count + oppositeCount;
  if (!edge.reciprocal && verticallySeparated && gap < 0 && gap >= -margin && corridorCount === 1) {
    const lead = Math.min(16, Math.max(12, Math.abs(gap)));
    const curve = direct();
    return [{ ...curve, control1: { x: start.x + lead, y: start.y }, control2: { x: end.x - lead, y: end.y } }];
  }
  if (verticallySeparated && gap < 40 && corridorCount > 1 && edge.laneIndex !== undefined) {
    // Keep selectable rails 12px apart and at least 12px from both cards.
    if (lowerTop - upperBottom < (corridorCount + 1) * LANE_SPACING) {
      return exteriorRoute(edge, start, end, target, sourcePosition, targetPosition, sourceBottom, targetBottom, above, direct(), gap, laneOffsetFor('exterior'), observe);
    }
    const sourceAbove = sourceBottom <= targetPosition.y;
    // The top rows wrap around the bottom of the upper card's fan and come
    // into the top of the lower card's fan, regardless of wire direction.
    const rank = count - 1 - edge.laneIndex;
    const laneOffset = laneOffsetFor('corridor');
    const y = upperBottom + (1 + (above ? oppositeCount : 0) + rank) * LANE_SPACING + laneOffset.y;
    // Downward legs run farther out for lower rails; upward legs do the
    // reverse. A common fan order on both sides would cross at one end.
    const downLead = 24 + rank * LANE_SPACING;
    const upLead = 24 + (count - 1 - rank) * LANE_SPACING;
    const exitX = start.x + (sourceAbove ? downLead : upLead) + laneOffset.x;
    const entryX = end.x - (sourceAbove ? upLead : downLead) - (laneOffset.entryX ?? laneOffset.x);
    // A cached translation belongs to the whole fan. The bands (including
    // the reverse direction) span ranks 1..corridorCount from upperBottom;
    // both leg orders have an innermost lead of 24, regardless of direction.
    // Evaluate the extreme ranks analytically, not by finding sibling edges.
    observe?.({ family: 'corridor', start, end, exitX, entryX, y,
      fanFits: LANE_SPACING + laneOffset.y >= MIN_LANE_CLEARANCE &&
        lowerTop - upperBottom - corridorCount * LANE_SPACING - laneOffset.y >= MIN_LANE_CLEARANCE &&
        24 + laneOffset.x >= MIN_LANE_CLEARANCE && 24 + (laneOffset.entryX ?? laneOffset.x) >= MIN_LANE_CLEARANCE });
    return roundedRail(start, end, exitX, entryX, y, 5);
  }
  if (edge.reciprocal) {
    if ((source.footprint || target.footprint) && lowerTop - upperBottom < MIN_RECIPROCAL_CORRIDOR) {
      // Disjoint reserved rectangles can still leave too little room for two
      // hit paths. Prefer a clear facing strip; otherwise use exterior rails.
      // If cards actually overlap, a socket buried by its peer cannot be shown.
      if (gap >= 2 * MIN_LANE_CLEARANCE) return [facingCurve(direct(), gap)];
      // Opposed wraps can share a long vertical leg even on different Y
      // rails. Stagger their turns so each stays independently hittable.
      return exteriorRoute(edge, start, end, target, sourcePosition, targetPosition, sourceBottom, targetBottom, above, direct(), gap, laneOffsetFor('exterior'), observe, above ? LANE_SPACING : 0);
    }
    if (verticallySeparated) return reciprocalCorridor(direct(), upperBottom, lowerTop, above, laneOffsetFor('corridor'), observe);
    if (gap >= 0) return [facingCurve(direct(), gap)];
  }
  if (gap >= 2 * margin) return [direct()];
  if (verticallySeparated) {
    const appliedOffset = gap > margin ? { x: 0, y: 0 } : laneOffsetFor('corridor');
    const corridorY = (upperBottom + lowerTop) / 2 + appliedOffset.y;
    // A backward route still needs a short horizontal socket stub before
    // turning into the corridor, otherwise its vertical leg hugs the card.
    const backwardGap = gap < 0 && gap >= -margin;
    const exitLead = gap > 0 ? Math.min(margin, gap / 3) : Math.min(24, Math.max(12, Math.abs(gap)));
    const entryLead = backwardGap ? Math.min(16, Math.max(12, Math.abs(gap))) : margin;
    const radius = Math.max(0, Math.min(12, corridorY - upperBottom - 1, lowerTop - corridorY - 1));
    const exitX = start.x + exitLead + appliedOffset.x;
    const entryX = end.x - entryLead - (appliedOffset.entryX ?? appliedOffset.x);
    if (gap <= margin) observe?.({ family: 'corridor', start, end, exitX, entryX, y: corridorY });
    const rail = roundedRail(start, end, exitX, entryX, corridorY, radius);
    return gap > margin ? blendRail(direct(), rail, (2 * margin - gap) / margin) : rail;
  }
  if (gap >= 0) return [direct()];

  // If there is no vertical corridor, use the stable exterior lane instead.
  // Subdivide/blend near the reversal so dragging through the cards doesn't
  // abruptly introduce a loop or detach the rendered path from its sockets.
  return exteriorRoute(edge, start, end, target, sourcePosition, targetPosition, sourceBottom, targetBottom, above, direct(), gap, laneOffsetFor('exterior'), observe);
}

/** Conservative continuous clearance: a cubic stays inside its control hull.
 * Only the straight socket stub may touch its own endpoint's outline. */
function clearRail(edge: FixtureEdge, nodes: ReadonlyMap<string, FixtureNode>, positions: ReadonlyMap<string, Point> | undefined, rail: RailGeometry, curves: Curve[]): boolean {
  if (rail.fanFits === false || rail.exitX - rail.start.x < MIN_LANE_CLEARANCE || rail.end.x - rail.entryX < MIN_LANE_CLEARANCE) return false;
  return [edge.from, edge.to].every(({ nodeId }, index) => {
    const node = nodes.get(nodeId)!;
    const { x, y } = positions?.get(nodeId) ?? node;
    const bottom = y + cardHeight(node);
    if (rail.y > y - MIN_LANE_CLEARANCE && rail.y < bottom + MIN_LANE_CLEARANCE) return false;
    return curves.every((curve, i) => {
      if (i === (index === 0 ? 0 : curves.length - 1)) return true;
      const hull = [curve.start, curve.control1, curve.control2, curve.end];
      return hull.every(p => p.x <= x - 1) || hull.every(p => p.x >= x + node.width + 1) ||
        hull.every(p => p.y <= y - 1) || hull.every(p => p.y >= bottom + 1);
    });
  });
}

export function inspectRail(edge: FixtureEdge, nodes: ReadonlyMap<string, FixtureNode>, positions?: ReadonlyMap<string, Point>) {
  let rail: RailGeometry | undefined;
  const curves = routeCurves(edge, nodes, positions, value => { rail = value; });
  return { curves, rail, safe: !rail || clearRail(edge, nodes, positions, rail, curves) };
}

/** Port-window movement changes socket rows, not card clearance or lane rank.
 * Share the actual rendered rail with the reservation index; if a retained
 * translation is no longer safe, index the same base rail that gets drawn. */
export function portWindowEdgeRoute(edge: FixtureEdge, nodes: ReadonlyMap<string, FixtureNode>) {
  const result = inspectRail(edge, nodes);
  const offset = edge.routeOffset;
  if (!result.safe && (offset?.x || offset?.y || offset?.entryX)) {
    return { ...inspectRail({ ...edge, routeOffset: undefined }, nodes), offset: undefined };
  }
  return { ...result, offset: edge.routeOffsetFamily && edge.routeOffsetFamily !== result.rail?.family ? undefined : offset };
}

export function edgeCurves(edge: FixtureEdge, nodes: ReadonlyMap<string, FixtureNode>, positions?: ReadonlyMap<string, Point>): Curve[] {
  const offset = edge.routeOffset;
  if (!offset || !(offset.x || offset.y || offset.entryX)) return routeCurves(edge, nodes, positions);
  // A formerly legal cached offset may no longer fit a shrinking corridor during a drag.
  const result = inspectRail(edge, nodes, positions);
  return result.safe ? result.curves : routeCurves({ ...edge, routeOffset: undefined }, nodes, positions);
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

export function curveArrow(curve: Curve, socket = curve.end): { t: number; tip: Point; left: Point; right: Point } | undefined {
  const distanceToSocket = (t: number) => {
    const point = curvePoint(curve, t);
    return Math.hypot(point.x - socket.x, point.y - socket.y);
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
