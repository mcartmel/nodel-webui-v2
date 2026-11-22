import { NODE_WIDTH, portPoint, type FixtureEdge, type FixtureNode, type FixturePort } from './fixture';
import { type LocalGraph, type LocalGraphConnection, type LocalPortKind, type LocalReadState } from './local-graph';
import { indexLocalGraphGeometry, localGraphGeometryForPositions, localPortsForNode, placeLocalGraph, type LocalGraphGeometry } from './local-placement';

export type LocalStatusKind = 'local' | 'partial' | 'referenced';

export interface ProjectedLocalNode extends Omit<FixtureNode, 'status'> {
  /** Plain-text wording for the real-data renderer; synthetic online/standby is not reused. */
  displayStatus: 'Local' | 'Local · bindings unread' | 'Local · bindings partial' | 'Referenced · not inspected';
  statusKind: LocalStatusKind;
}

export interface ProjectedLocalEdge extends FixtureEdge {
  /** Renderer hint: ordinary same-card action/event bindings need an exterior loop. */
  selfLoop: boolean;
}

export interface LocalGraphProjection {
  nodes: ProjectedLocalNode[];
  edges: ProjectedLocalEdge[];
  /** Renderer socket index; opaque safe IDs, never label-derived. */
  socketIds: ReadonlyMap<string, string>;
  summary: string;
  conflicts: LocalGraph['conflicts'];
  incompleteAssignments: number;
}

const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function safeRendererId(prefix: string, value: string): string {
  // Encode UTF-16 code units, including unmatched surrogates, with an ASCII-only alphabet.
  let encoded = '';
  for (let i = 0; i < value.length; i += 1) encoded += value.charCodeAt(i).toString(16).padStart(4, '0');
  return `${prefix}-${encoded || 'empty'}`;
}

const portDirection = (kind: LocalPortKind): FixturePort['direction'] =>
  kind === 'remote-action' || kind === 'local-event' ? 'out' : 'in';
const portSide = (kind: LocalPortKind): FixturePort['side'] => portDirection(kind) === 'out' ? 'right' : 'left';

function nodeStatus(origin: 'local' | 'referenced', read: LocalReadState): ProjectedLocalNode['displayStatus'] {
  if (origin === 'referenced') return 'Referenced · not inspected';
  if (read === 'unread' || read === 'not-requested') return 'Local · bindings unread';
  if (read === 'partial') return 'Local · bindings partial';
  return 'Local';
}

/** Project graph records into the renderer's existing lightweight card/edge vocabulary. */
export function projectLocalGraph(
  graph: LocalGraph,
  positions?: ReadonlyMap<string, { x: number; y: number }>,
  geometry: LocalGraphGeometry = positions
    ? localGraphGeometryForPositions(graph, positions) ?? indexLocalGraphGeometry(graph)
    : indexLocalGraphGeometry(graph)
): LocalGraphProjection {
  const placed = positions ?? placeLocalGraph(graph, {}, geometry);
  const portIds = new Map<string, string>();
  const nodes: ProjectedLocalNode[] = [...graph.nodes.values()].sort((a, b) => compareText(a.key, b.key)).map((node) => {
    const graphPorts = localPortsForNode(graph, node.id, geometry);
    const ports: FixturePort[] = graphPorts.map((port) => {
      const id = safeRendererId('p', port.id);
      portIds.set(port.id, id);
      return { id, label: port.name, direction: portDirection(port.kind), side: portSide(port.kind), localKind: port.kind };
    });
    const point = placed.get(node.id) ?? { x: 0, y: 0 };
    const displayStatus = nodeStatus(node.origin, node.bindingsRead);
    return {
      id: safeRendererId('n', node.id), name: node.name, x: point.x, y: point.y, width: NODE_WIDTH,
      ports, displayStatus,
      statusKind: node.origin === 'referenced' ? 'referenced'
        : node.bindingsRead === 'partial' || node.bindingsRead === 'unread' || node.bindingsRead === 'not-requested' ? 'partial' : 'local'
    };
  });
  const socketY = new Map<string, number>();
  const origin = { x: 0, y: 0 };
  for (const node of nodes) {
    for (const port of node.ports) socketY.set(port.id, portPoint(node, port.id, origin).y);
  }
  const rowY = (portId: string) => socketY.get(portIds.get(portId)!)!;
  const graphPortById = graph.ports;
  const directions = new Map<string, Set<string>>();
  const pairConnections = new Map<string, { from: string; to: string; connections: LocalGraphConnection[] }>();
  for (const connection of graph.connections.values()) {
    const from = graphPortById.get(connection.fromPortId)!.nodeId;
    const to = graphPortById.get(connection.toPortId)!.nodeId;
    if (!directions.has(from)) directions.set(from, new Set());
    directions.get(from)!.add(to);
    const pairKey = JSON.stringify([from, to]);
    const pair = pairConnections.get(pairKey) ?? { from, to, connections: [] };
    pair.connections.push(connection);
    pairConnections.set(pairKey, pair);
  }
  const lanes = new Map<string, Pick<FixtureEdge, 'laneIndex' | 'laneCount' | 'oppositeLaneCount'>>();
  for (const pair of pairConnections.values()) {
    if (pair.from === pair.to) continue;
    const laneCount = pair.connections.length;
    const oppositeLaneCount = pairConnections.get(JSON.stringify([pair.to, pair.from]))?.connections.length ?? 0;
    const sharedCorridor = oppositeLaneCount > 0 && laneCount + oppositeLaneCount > 2;
    if (laneCount < 2 && !sharedCorridor) continue;
    // Follow rendered destination rows, not connection IDs. If distinct
    // source rows are inverted, the chosen common rail/fan order necessarily
    // leaves a crossing at the source; don't move it to the destination too.
    pair.connections.sort((a, b) => rowY(a.toPortId) - rowY(b.toPortId) ||
      rowY(a.fromPortId) - rowY(b.fromPortId) || compareText(a.id, b.id));
    pair.connections.forEach((connection, laneIndex) => lanes.set(connection.id, {
      laneIndex, laneCount, ...(sharedCorridor ? { oppositeLaneCount } : {})
    }));
  }
  const edges: ProjectedLocalEdge[] = [...graph.connections.values()].sort((a, b) => compareText(a.id, b.id)).map((connection) => {
    const from = graphPortById.get(connection.fromPortId)!;
    const to = graphPortById.get(connection.toPortId)!;
    return {
      id: safeRendererId('e', connection.id),
      from: { nodeId: safeRendererId('n', from.nodeId), portId: portIds.get(from.id)! },
      to: { nodeId: safeRendererId('n', to.nodeId), portId: portIds.get(to.id)! },
      selfLoop: from.nodeId === to.nodeId,
      reciprocal: from.nodeId !== to.nodeId && directions.get(to.nodeId)?.has(from.nodeId) === true,
      bindingKind: connection.kind,
      ownerId: safeRendererId('n', connection.ownerId),
      ...lanes.get(connection.id)
    };
  });
  const locals = [...graph.nodes.values()].filter((node) => node.origin === 'local').length;
  const referenced = graph.nodes.size - locals;
  const unread = [...graph.nodes.values()].filter((node) => node.origin === 'local' && (node.bindingsRead === 'unread' || node.bindingsRead === 'not-requested')).length;
  const partial = [...graph.nodes.values()].filter((node) => node.origin === 'local' && node.bindingsRead === 'partial').length;
  const statusCounts = [unread ? `${unread} local unread` : '', partial ? `${partial} local partial` : ''].filter(Boolean);
  const parts = [`${locals} local`, `${referenced} referenced`, `${edges.length} configured`];
  if (statusCounts.length) parts.push(...statusCounts);
  if (graph.incompleteAssignments) parts.push(`${graph.incompleteAssignments} incomplete`);
  if (graph.conflicts.length) parts.push(`${graph.conflicts.length} conflicts`);
  return { nodes, edges, socketIds: portIds, summary: parts.join(' · '), conflicts: graph.conflicts, incompleteAssignments: graph.incompleteAssignments };
}
