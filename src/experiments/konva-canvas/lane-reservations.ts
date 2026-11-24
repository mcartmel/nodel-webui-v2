import { cardHeight, inspectRail, MIN_LANE_CLEARANCE, type FixtureEdge, type FixtureNode, type LaneOffset, type RailGeometry } from './fixture';

export type LaneFamily = RailGeometry['family'];
export interface LaneSegment {
  cardId: string;
  side: 'left' | 'right' | 'top' | 'bottom';
  offset: number;
  start: number;
  end: number;
}
type Axis = 'x' | 'entryX' | 'y';
export interface LaneRouteDescriptor {
  edgeId: string;
  family: LaneFamily;
  eligibleSegments: (LaneSegment & { axis: Axis })[];
  offset: LaneOffset;
  fan: string | undefined;
}
const PITCH = 12;
const CLEARANCE = 6;
export const LANE_LIMITS = { trialsPerGroup: 24, comparisonsPerGroup: 256, comparisonsPerSettlement: 2048, maxShift: 48 } as const;
const ZERO = { x: 0, entryX: 0, y: 0 };
const bucketKey = (s: LaneSegment) => `${s.cardId}\u0000${s.side}`;
export const laneSegmentsConflict = (a: LaneSegment, b: LaneSegment): boolean =>
  a.cardId === b.cardId && a.side === b.side && Math.abs(a.offset - b.offset) < PITCH &&
  a.start - CLEARANCE < b.end + CLEARANCE && b.start - CLEARANCE < a.end + CLEARANCE;

/** A budget is shared across all bucket probes and candidate trials of a group. */
export function probeLaneBucket(segment: LaneSegment, bucket: Iterable<LaneSegment>, budget: { remaining: number }) {
  for (const other of bucket) {
    if (budget.remaining === 0) return 'exhausted' as const;
    budget.remaining--;
    if (laneSegmentsConflict(segment, other)) return other;
  }
  return undefined;
}

type Nodes = ReadonlyMap<string, FixtureNode>;
function describe(edge: FixtureEdge, nodes: Nodes, r: RailGeometry): LaneRouteDescriptor {
  const source = nodes.get(edge.from.nodeId)!;
  const target = nodes.get(edge.to.nodeId)!;
  const segments: LaneRouteDescriptor['eligibleSegments'] = [];
  // The two socket stubs and four rounded elbows are never lanes. The two
  // vertical legs each belong to their socket card, not to every nearby card.
  if (r.start.y !== r.y) segments.push({ cardId: source.id, side: 'right', axis: 'x', offset: r.exitX - r.start.x,
    start: Math.min(r.start.y, r.y) - source.y, end: Math.max(r.start.y, r.y) - source.y });
  if (r.end.y !== r.y) segments.push({ cardId: target.id, side: 'left', axis: 'entryX', offset: r.end.x - r.entryX,
    start: Math.min(r.end.y, r.y) - target.y, end: Math.max(r.end.y, r.y) - target.y });
  for (const card of [source, target]) {
    const top = r.y <= card.y;
    const bottom = card.y + cardHeight(card);
    if (r.exitX !== r.entryX && (top || r.y >= bottom)) segments.push({ cardId: card.id, side: top ? 'top' : 'bottom', axis: 'y', offset: top ? card.y - r.y : r.y - bottom,
      start: Math.min(r.exitX, r.entryX) - card.x, end: Math.max(r.exitX, r.entryX) - card.x });
  }
  const fan = (edge.laneCount ?? 1) + (edge.oppositeLaneCount ?? 0) > 1 && edge.laneIndex !== undefined
    ? JSON.stringify([[source.id, target.id].sort(), r.family]) : undefined;
  return { edgeId: edge.id, family: r.family, eligibleSegments: segments, fan,
    offset: (!edge.routeOffsetFamily || edge.routeOffsetFamily === r.family) && edge.routeOffset || ZERO };
}

export function describeLaneRoute(edge: FixtureEdge, nodes: Nodes): LaneRouteDescriptor | undefined {
  if (edge.selfLoop) return;
  const result = inspectRail(edge, nodes);
  if (!result.rail) return;
  if (!result.safe && edge.routeOffset) return describeLaneRoute({ ...edge, routeOffset: undefined }, nodes);
  return describe(edge, nodes, result.rail);
}

export interface LaneSettlement {
  descriptors: Map<string, LaneRouteDescriptor>;
  bucketCount: number;
  candidateCount: number;
  comparisonCount: number;
  budgetFallbackCount: number;
  fallbackCount: number;
}

/** Reverse-indexed memberships. Buckets never get copied or flattened; a
 * crowded bucket exhausts a strict comparison budget and keeps the base route. */
export class LocalLaneReservations {
  private readonly buckets = new Map<string, Set<LaneSegment>>();
  private readonly reverse = new Map<string, LaneRouteDescriptor>();
  private readonly fans = new Map<string, Set<LaneRouteDescriptor>>();
  get size(): number { return this.reverse.size; }
  get bucketCount(): number { return this.buckets.size; }

  remove(edgeId: string): void {
    const prior = this.reverse.get(edgeId);
    if (!prior) return;
    for (const s of prior.eligibleSegments) {
      const key = bucketKey(s);
      const bucket = this.buckets.get(key)!;
      bucket.delete(s);
      if (!bucket.size) this.buckets.delete(key);
    }
    if (prior.fan) {
      const fan = this.fans.get(prior.fan)!;
      fan.delete(prior);
      if (!fan.size) this.fans.delete(prior.fan);
    }
    this.reverse.delete(edgeId);
  }

  private reserve(d: LaneRouteDescriptor): void {
    this.reverse.set(d.edgeId, d);
    if (d.fan) {
      const fan = this.fans.get(d.fan) ?? new Set();
      fan.add(d); this.fans.set(d.fan, fan);
    }
    for (const s of d.eligibleSegments) {
      const key = bucketKey(s);
      const bucket = this.buckets.get(key) ?? new Set();
      bucket.add(s); this.buckets.set(key, bucket);
    }
  }

  seed(edges: Iterable<FixtureEdge>, nodes: Nodes): void {
    this.clear();
    for (const edge of edges) {
      const d = describeLaneRoute(edge, nodes);
      if (d) this.reserve(d);
    }
  }

  /** Reindex changed socket spans without searching lanes again. The render
   * geometry was already checked and resolved against the retained offset. */
  replaceRenderedRail(edge: FixtureEdge, nodes: Nodes, rail: RailGeometry | undefined, offset: LaneOffset | undefined): void {
    this.remove(edge.id);
    if (rail) this.reserve(describe({ ...edge, routeOffset: offset }, nodes, rail));
  }

  settle(edges: readonly FixtureEdge[], nodes: Nodes): LaneSettlement {
    const result: LaneSettlement = { descriptors: new Map(), bucketCount: 0, candidateCount: 0, comparisonCount: 0, budgetFallbackCount: 0, fallbackCount: 0 };
    const groups = new Map<string, { edge: FixtureEdge; base: LaneRouteDescriptor }[]>();
    for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
      this.remove(edge.id);
      const base = describeLaneRoute({ ...edge, routeOffset: undefined }, nodes);
      if (!base) { delete edge.routeOffset; delete edge.routeOffsetFamily; continue; }
      const key = base.fan ?? `single:${edge.id}`;
      const group = groups.get(key) ?? [];
      group.push({ edge, base }); groups.set(key, group);
    }
    // Preserve authored row nesting by translating every rank in a fan by
    // the same three deltas. A fixed sibling pins that translation.
    for (const group of [...groups.values()].sort((a, b) => b.length - a.length)) {
      const { edge, base } = group[0]!;
      const pinned = base.fan ? this.fans.get(base.fan)?.values().next().value?.offset : undefined;
      const previous = edge.routeOffsetFamily === base.family && edge.routeOffset;
      const normalize = (o: LaneOffset) => ({ x: o.x, entryX: o.entryX ?? o.x, y: o.y });
      const queue = [normalize(pinned ?? (previous || ZERO))];
      const seen = new Set(queue.map(o => JSON.stringify(o)));
      const cost = (o: typeof ZERO) => Math.abs(o.x) + Math.abs(o.entryX) + Math.abs(o.y);
      const enqueue = (o: typeof ZERO) => {
        const key = JSON.stringify(o);
        if (Math.max(Math.abs(o.x), Math.abs(o.entryX), Math.abs(o.y)) > LANE_LIMITS.maxShift || seen.has(key)) return;
        seen.add(key); queue.push(o);
      };
      if (!pinned) enqueue(ZERO);
      const allowance = Math.min(LANE_LIMITS.comparisonsPerGroup, LANE_LIMITS.comparisonsPerSettlement - result.comparisonCount);
      const budget = { remaining: allowance };
      let chosen: LaneRouteDescriptor[] | undefined;
      trials: for (let n = 0; n < LANE_LIMITS.trialsPerGroup && queue.length; n++) {
        const offset = queue.shift()!;
        const batch: LaneRouteDescriptor[] = [];
        for (const member of group) {
          result.candidateCount++;
          const trial = { ...member.edge, routeOffset: offset, routeOffsetFamily: member.base.family };
          const { safe, rail } = inspectRail(trial, nodes);
          if (!rail) break;
          if (!safe) {
            // The unadjusted positive-gap route can have a deliberately short
            // socket lead (gap / 3). Try the nearest admissible leads before
            // checking occupancy; do not give up on the other leg or rail.
            if (!pinned) enqueue({ ...offset,
              x: offset.x + Math.max(0, MIN_LANE_CLEARANCE - (rail.exitX - rail.start.x)),
              entryX: offset.entryX + Math.max(0, MIN_LANE_CLEARANCE - (rail.end.x - rail.entryX)) });
            break;
          }
          const d = describe(trial, nodes, rail);
          let conflict = false;
          for (const s of d.eligibleSegments) {
            const bucket = this.buckets.get(bucketKey(s));
            if (!bucket) continue;
            const other = probeLaneBucket(s, bucket, budget);
            if (other === 'exhausted') { result.budgetFallbackCount++; break trials; }
            if (other) {
              conflict = true;
              // Branch at the actual neighbour's lane boundaries (e.g. 32 →
              // 24 around 36). Re-query the entire path after each change,
              // allowing another dimension to change in the same solution.
              if (!pinned) for (const dir of [-1, 1]) {
                const change = (other.offset + dir * PITCH - s.offset) * (s.side === 'top' ? -1 : 1);
                enqueue({ ...offset, [s.axis]: offset[s.axis] + change });
              }
            }
            if (conflict) break;
          }
          if (conflict) break;
          batch.push(d);
        }
        if (batch.length === group.length) { chosen = batch; break; }
        queue.sort((a, b) => cost(a) - cost(b));
      }
      result.comparisonCount += allowance - budget.remaining;
      if (!chosen) result.fallbackCount++;
      group.forEach(({ edge: member, base: natural }, i) => {
        let d = chosen?.[i] ?? natural;
        // Even if a different pair occupies this lane, never invert a fixed
        // sibling's rank. Safety still wins if card geometry became impossible.
        if (!chosen && pinned) {
          const trial = { ...member, routeOffset: pinned, routeOffsetFamily: natural.family };
          const { safe, rail } = inspectRail(trial, nodes);
          if (safe && rail) d = describe(trial, nodes, rail);
        }
        member.routeOffset = d.offset;
        member.routeOffsetFamily = d.family;
        this.reserve(d); result.descriptors.set(member.id, d);
      });
    }
    result.bucketCount = this.bucketCount;
    return result;
  }

  clear(): void { this.buckets.clear(); this.reverse.clear(); this.fans.clear(); }
}
