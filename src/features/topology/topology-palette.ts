import type { TopologyNodeStatus } from './topology-controller';
import type { TopologyGraph, TopologyNode, TopologyNodeId } from './topology-model';

export type TopologyPaletteReadability = TopologyNodeStatus['readability'] | 'unknown';

export interface TopologyPaletteFilters {
  query?: string;
  host?: string;
  readability?: TopologyPaletteReadability | 'all';
  offset?: number;
  limit?: number;
}

export interface TopologyPaletteEntry {
  id: TopologyNodeId;
  name: string;
  host: string;
  addresses: readonly string[];
  readability: TopologyPaletteReadability;
  present: boolean;
}

export interface TopologyPalettePage {
  entries: readonly TopologyPaletteEntry[];
  total: number;
  offset: number;
  limit: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

function paletteText(node: TopologyNode): string {
  return [node.name, node.host, ...node.addresses.map((address) => address.displayAddress)].filter(Boolean).join(' ').toLocaleLowerCase();
}

/** A searchable, bounded page over the entire advertised graph inventory. */
export function topologyPalettePage(
  graph: TopologyGraph,
  statuses: ReadonlyMap<TopologyNodeId, TopologyNodeStatus>,
  displayedNodeIds: ReadonlySet<TopologyNodeId>,
  filters: TopologyPaletteFilters = {}
): TopologyPalettePage {
  const query = filters.query?.trim().toLocaleLowerCase() ?? '';
  const host = filters.host?.trim().toLocaleLowerCase();
  const readability = filters.readability ?? 'all';
  const matches = graph.nodes.filter((node) => {
    if (node.discovery !== 'advertised') return false;
    if (query && !paletteText(node).includes(query)) return false;
    if (host && (node.host ?? '').toLocaleLowerCase() !== host) return false;
    const status = statuses.get(node.id);
    const value: TopologyPaletteReadability = status?.readability ?? 'advertised-only';
    return readability === 'all' || value === readability;
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(filters.limit ?? DEFAULT_PAGE_SIZE)));
  const offset = Math.max(0, Math.min(matches.length, Math.floor(filters.offset ?? 0)));
  const entries = matches.slice(offset, offset + limit).map((node): TopologyPaletteEntry => ({
    id: node.id,
    name: node.name,
    host: node.host ?? '',
    addresses: node.addresses.map(({ displayAddress }) => displayAddress),
    readability: statuses.get(node.id)?.readability ?? 'advertised-only',
    present: displayedNodeIds.has(node.id)
  }));
  return { entries, total: matches.length, offset, limit, hasPrevious: offset > 0, hasNext: offset + entries.length < matches.length };
}

export type TopologyPaletteAction = 'add' | 'centre';

/** Invoke the Stage4 callback with an explicit presentation action. */
export function activateTopologyPaletteEntry(
  entry: Pick<TopologyPaletteEntry, 'id' | 'present'>,
  onAddOrCentre: (nodeId: TopologyNodeId, action: TopologyPaletteAction) => void
): void {
  onAddOrCentre(entry.id, entry.present ? 'centre' : 'add');
}
