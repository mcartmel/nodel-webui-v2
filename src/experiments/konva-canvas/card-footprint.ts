import { CARD_HEADER_HEIGHT, PORTS_TOP, PORT_ROW_HEIGHT, cardHeightForPortCounts, cardHeight, type FixtureNode, type FixturePort, type PortSide } from './fixture';
import type { LocalGraphNode } from './local-graph';

export const MAX_PORT_ROWS = 16;
const MIN_ROW_BUDGET = 6;
const SPARE_ROWS = 2;
const BOTTOM_RAIL_EXTRA = 22;
// The header gap plus the first row's leading pad already forms a reserved
// top rail. Its region ends at the first label, so even late overflow does
// not move existing sockets or grow a mounted card.
export const TOP_RAIL_HEIGHT = PORTS_TOP - CARD_HEADER_HEIGHT + (PORT_ROW_HEIGHT / 2 - 7);
export const FOOTPRINT_GUTTER = 28;
export const PORT_SIDES = ['left', 'right'] as const;
export const OVERFLOW_DIRECTIONS = ['above', 'below'] as const;
export type OverflowDirection = typeof OVERFLOW_DIRECTIONS[number];
export type PortRows = Readonly<Record<PortSide, number>>;
export type TakeoffRole = 'alias' | 'local';
export type PortAttachment = { side: PortSide; row: number } | { side: PortSide; direction: OverflowDirection; role: TakeoffRole };

export const isFullyInspected = (node: LocalGraphNode): boolean =>
  node.origin === 'local' ? node.bindingsRead === 'read' : node.inspectionState === 'read';

export function visibleRowBudget(viewportHeight: number): number {
  const fit = Math.floor((0.6 * viewportHeight - cardHeightForPortCounts(0, 0)) / PORT_ROW_HEIGHT);
  return Math.min(MAX_PORT_ROWS, Math.max(MIN_ROW_BUDGET, Number.isFinite(fit) ? fit + 1 : MIN_ROW_BUDGET));
}

export function initialFootprintRows(known: PortRows, fullyInspected: boolean, viewportHeight: number): PortRows {
  const limit = visibleRowBudget(viewportHeight);
  const spare = fullyInspected ? 0 : SPARE_ROWS;
  return { left: Math.min(limit, known.left + spare), right: Math.min(limit, known.right + spare) };
}

export const footprintHeight = (rows: PortRows): number => cardHeightForPortCounts(rows.left, rows.right) + BOTTOM_RAIL_EXTRA;
export const takeoffRole = (port: FixturePort): TakeoffRole => port.localKind?.startsWith('local-') ? 'local' : 'alias';

interface RankedPort { port: FixturePort; rank: number }
const newSide = () => ({ ordered: [] as RankedPort[], localPrefix: [0], start: 0 });

/** Append-only ranks and independent side-local windows. No graph ID depends on a row. */
export class CardFootprint {
  private readonly known = new Map<string, RankedPort>();
  private readonly sides = { left: newSide(), right: newSide() };

  constructor(readonly rows: PortRows, private readonly compactRows: PortRows = rows) {}

  get height(): number { return footprintHeight(this.rows); }

  append(ports: Iterable<FixturePort>): void {
    for (const port of ports) {
      const prior = this.known.get(port.id);
      if (prior) {
        // IDs encode endpoint role/direction; enrichment can refresh its label.
        prior.port = port;
        continue;
      }
      const { ordered, localPrefix } = this.sides[port.side];
      const entry = { port, rank: ordered.length };
      this.known.set(port.id, entry);
      ordered.push(entry);
      localPrefix.push(localPrefix[entry.rank]! + Number(takeoffRole(port) === 'local'));
    }
  }

  attachment(portId: string): PortAttachment | undefined {
    const entry = this.known.get(portId);
    if (!entry) return;
    const { port, rank } = entry;
    const { side } = port;
    const row = rank - this.start(side);
    return row >= 0 && row < this.rows[side]
      ? { side, row }
      : { side, direction: row < 0 ? 'above' : 'below', role: takeoffRole(port) };
  }

  *visible(side: PortSide): IterableIterator<FixturePort> {
    const { ordered, start } = this.sides[side];
    const end = Math.min(start + this.rows[side], ordered.length);
    for (let rank = start; rank < end; rank++) yield ordered[rank]!.port;
  }

  start(side: PortSide): number { return this.sides[side].start; }
  maxStart(side: PortSide): number { return Math.max(0, this.sides[side].ordered.length - this.rows[side]); }
  canScroll(side: PortSide): boolean { return this.rows[side] > 0 && this.maxStart(side) > 0; }

  overflowCount(side: PortSide, direction?: OverflowDirection, role?: TakeoffRole): number {
    const { ordered, localPrefix, start } = this.sides[side];
    const end = Math.min(start + this.rows[side], ordered.length);
    const above = direction === 'below' ? 0 : start;
    const below = direction === 'above' ? 0 : ordered.length - end;
    if (!role) return above + below;
    const local = (direction === 'below' ? 0 : localPrefix[start]!) +
      (direction === 'above' ? 0 : localPrefix[ordered.length]! - localPrefix[end]!);
    return role === 'local' ? local : above + below - local;
  }

  railTop(direction: OverflowDirection): number {
    return direction === 'above' ? CARD_HEADER_HEIGHT : PORTS_TOP + Math.max(this.rows.left, this.rows.right) * PORT_ROW_HEIGHT;
  }

  /** Only ranks in the symmetric sweep of the windows change physical seats.
   * A tall jump includes the ranks that cross directly between rails. */
  move(side: PortSide, next: number): readonly string[] {
    if (!this.canScroll(side) || !Number.isFinite(next)) return [];
    const state = this.sides[side];
    next = Math.max(0, Math.min(this.maxStart(side), Math.trunc(next)));
    if (next === state.start) return [];
    const firstChanged = Math.min(state.start, next);
    const pastLastChanged = Math.max(state.start, next) + this.rows[side];
    state.start = next;
    const changed: string[] = [];
    for (let rank = firstChanged; rank < pastLastChanged; rank++) changed.push(state.ordered[rank]!.port.id);
    return changed;
  }

  reveal(portId: string): readonly string[] {
    const entry = this.known.get(portId);
    if (!entry) return [];
    const { port: { side }, rank } = entry;
    const start = this.start(side);
    if (rank < start) return this.move(side, rank);
    if (rank >= start + this.rows[side]) return this.move(side, rank - this.rows[side] + 1);
    return [];
  }

  get canExpand(): boolean { return PORT_SIDES.some(side => this.rows[side] < MAX_PORT_ROWS && this.overflowCount(side) > 0); }
  get canCompact(): boolean { return PORT_SIDES.some(side => this.rows[side] > this.compactRows[side]); }

  resize(mode: 'expand' | 'compact', keepVisible: Iterable<string> = []): CardFootprint | undefined {
    if (mode === 'expand' ? !this.canExpand : !this.canCompact) return;
    const expandedRows = (side: PortSide) => Math.min(MAX_PORT_ROWS, this.rows[side] + this.overflowCount(side));
    const next = new CardFootprint(mode === 'compact' ? this.compactRows : { left: expandedRows('left'), right: expandedRows('right') }, this.compactRows);
    next.append(Array.from(this.known.values(), ({ port }) => port));
    for (const side of PORT_SIDES) {
      if (next.canScroll(side)) next.sides[side].start = Math.min(this.start(side), next.maxStart(side));
    }
    for (const id of keepVisible) next.reveal(id);
    return next;
  }
}

export function createCardFootprint(ports: readonly FixturePort[], fullyInspected: boolean, viewportHeight: number): CardFootprint {
  const known = { left: 0, right: 0 };
  for (const { side } of ports) known[side] += 1;
  const footprint = new CardFootprint(initialFootprintRows(known, fullyInspected, viewportHeight));
  footprint.append(ports);
  return footprint;
}

/** Includes the reserved rail; callers supply live positions and reserved drag origins. */
export function canExpandFootprint(card: FixtureNode, proposed: CardFootprint, occupied: Iterable<FixtureNode>, gutter = FOOTPRINT_GUTTER): boolean {
  for (const other of occupied) {
    if (other.id === card.id) continue;
    if (card.x + card.width + gutter <= other.x || other.x + other.width + gutter <= card.x ||
      card.y + proposed.height + gutter <= other.y || other.y + cardHeight(other) + gutter <= card.y) continue;
    return false;
  }
  return true;
}
