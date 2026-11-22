import { NODE_WIDTH, portPoint, type FixtureEdge, type FixtureNode, type FixturePort, type Point } from './fixture';
import type { LocalGraph, LocalGraphConnection, LocalGraphNode, LocalGraphPort, LocalPortKind } from './local-graph';
import { indexLocalGraphGeometry, localGraphGeometryForPositions, localPortsForNode, placeLocalGraph, type LocalGraphGeometry } from './local-placement';

export type LocalStatusKind = NonNullable<FixtureNode['statusKind']>;

export interface ProjectedLocalNode extends Omit<FixtureNode, 'status' | 'displayStatus' | 'statusKind' | 'displayQualifier'> {
  /** Legacy evidence status retained for graph/test consumers, not shown as the subtitle. */
  displayStatus: string;
  /** Plain-text qualifier for configured evidence; empty on clean complete reads. */
  displayQualifier: string;
  statusKind: LocalStatusKind;
  hostKind: NonNullable<FixtureNode['hostKind']>;
  hostDescription: string;
}

export interface ProjectedLocalEdge extends FixtureEdge {
  selfLoop: boolean;
  reciprocal: boolean;
}

export interface LocalGraphProjection {
  nodes: ProjectedLocalNode[];
  edges: ProjectedLocalEdge[];
  /** Renderer socket index; opaque safe IDs, never label-derived. */
  socketIds: ReadonlyMap<string, string>;
  wirePairs: LocalWirePairs;
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

export const localCardId = (id: string): string => safeRendererId('n', id);

const portDirection = (kind: LocalPortKind): FixturePort['direction'] =>
  kind === 'remote-action' || kind === 'local-event' ? 'out' : 'in';

export function projectLocalPort(port: LocalGraphPort): FixturePort {
  const direction = portDirection(port.kind);
  return { id: safeRendererId('p', port.id), label: port.name, direction, side: direction === 'out' ? 'right' : 'left', localKind: port.kind };
}

export function projectLocalCardStatus(node: LocalGraphNode): Pick<ProjectedLocalNode, 'displayStatus' | 'displayQualifier' | 'statusKind' | 'hostKind' | 'hostDescription' | 'tooltip'> {
  let status: Pick<ProjectedLocalNode, 'displayStatus' | 'displayQualifier' | 'statusKind'>;
  if (node.origin === 'referenced') {
    switch (node.inspectionState) {
      case 'read': status = { displayStatus: '', displayQualifier: '', statusKind: 'referenced' }; break;
      case 'partial': status = { displayStatus: 'Bindings partially loaded', displayQualifier: 'Bindings partially loaded', statusKind: 'partial' }; break;
      case 'failed': {
        const failureText = failureStatus(node);
        status = { displayStatus: failureText, displayQualifier: failureText, statusKind: 'partial' };
        break;
      }
      case 'cutoff': status = { displayStatus: 'Inspection stopped at cutoff', displayQualifier: 'Inspection stopped at cutoff', statusKind: 'referenced' }; break;
      default: status = { displayStatus: 'Not inspected', displayQualifier: 'Not inspected', statusKind: 'referenced' }; break;
    }
  } else if (node.bindingsRead === 'unread' || node.bindingsRead === 'not-requested') status = { displayStatus: 'Not inspected', displayQualifier: 'Not inspected', statusKind: 'partial' };
  else if (node.bindingsRead === 'partial') status = { displayStatus: 'Bindings partially loaded', displayQualifier: 'Bindings partially loaded', statusKind: 'partial' };
  else status = { displayStatus: '', displayQualifier: '', statusKind: 'local' };
  return { ...status, ...hostPresentation(node), tooltip: cardTooltip(node) };
}

function hostPresentation(node: LocalGraphNode): Pick<ProjectedLocalNode, 'hostKind' | 'hostDescription'> {
  if (node.origin === 'local') return { hostKind: 'local', hostDescription: 'Hosted on this page’s Nodel server.' };
  if (node.hostEvidence) return { hostKind: 'remote', hostDescription: `Advertised host: ${node.hostEvidence}.` };
  return { hostKind: 'unknown', hostDescription: 'Host location is unknown; no unambiguous distinct host was established.' };
}

function cardTooltip(node: LocalGraphNode): string {
  const host = hostPresentation(node).hostDescription;
  const complete = node.origin === 'local' ? node.bindingsRead === 'read' : node.inspectionState === 'read';
  if (!complete) {
    return boundTooltip(`${host} ${inspectionDescription(node)}.`);
  }
  if (!node.bindingCounts) return boundTooltip(`${host} Inspection succeeded; binding count is unavailable.`);
  const { set, total } = node.bindingCounts;
  const unassigned = total - set;
  const unassignedText = unassigned === 0 ? 'none unassigned' : `${unassigned} unassigned binding${unassigned === 1 ? '' : 's'}`;
  return boundTooltip(`${host} Inspection succeeded; ${total} configured ${total === 1 ? 'binding' : 'bindings'}, ${unassignedText}.`);
}

function inspectionDescription(node: LocalGraphNode): string {
  if (node.origin === 'local') {
    if (node.bindingsRead === 'partial') return 'Bindings partially loaded';
    return 'Not inspected';
  }
  if (node.inspectionState === 'not-inspected' || node.inspectionState === undefined) {
    if (node.lookupState === 'invalid') return 'Invalid discovery response';
    if (node.lookupState === 'failed') return 'Discovery failed';
    if (node.lookupState === 'blocked') return 'Remote route blocked';
    if (node.lookupState === 'no-route') return 'No usable remote route';
  }
  switch (node.inspectionState) {
    case 'read': return 'Inspection succeeded';
    case 'partial': return 'Bindings partially loaded';
    case 'failed': return failureStatus(node);
    case 'cutoff': return 'Inspection stopped at cutoff';
    default:
      return 'Not inspected';
  }
}

function failureStatus(node: LocalGraphNode): string {
  if (node.lookupState === 'invalid' && node.displayFailure?.includes('lookup')) return 'Invalid discovery response';
  return node.displayFailure ?? 'Remote inspection failed';
}

function boundTooltip(text: string): string {
  const characters = Array.from(text);
  return characters.length <= 320 ? text : `${characters.slice(0, 317).join('')}…`;
}

export function projectLocalCard(node: LocalGraphNode, ports: FixturePort[], point: Point): ProjectedLocalNode {
  return { id: localCardId(node.id), name: node.name, x: point.x, y: point.y, width: NODE_WIDTH, ports,
    ...projectLocalCardStatus(node) };
}

export function projectLocalWire(graph: LocalGraph, connection: LocalGraphConnection, portIds: ReadonlyMap<string, string>): ProjectedLocalEdge {
  const from = graph.ports.get(connection.fromPortId)!;
  const to = graph.ports.get(connection.toPortId)!;
  return {
    id: safeRendererId('e', connection.id),
    from: { nodeId: localCardId(from.nodeId), portId: portIds.get(from.id)! },
    to: { nodeId: localCardId(to.nodeId), portId: portIds.get(to.id)! },
    selfLoop: from.nodeId === to.nodeId,
    reciprocal: false,
    bindingKind: connection.kind,
    ownerId: localCardId(connection.ownerId)
  };
}

interface DirectedPair { wires: ProjectedLocalEdge[] }
type NodePair = readonly [DirectedPair, DirectedPair];

/** Key by unordered pair; each slot retains the wires in one direction. */
export class LocalWirePairs {
  private readonly pairs = new Map<string, NodePair>();
  private readonly pairByWire = new Map<string, NodePair>();

  add(edge: ProjectedLocalEdge): void {
    const { from: { nodeId: from }, to: { nodeId: to } } = edge;
    if (from === to) return;
    const forward = from < to;
    const key = forward ? `${from}:${to}` : `${to}:${from}`;
    const pair = this.pairs.get(key) ?? [{ wires: [] }, { wires: [] }];
    this.pairs.set(key, pair);
    this.pairByWire.set(edge.id, pair);
    pair[forward ? 0 : 1].wires.push(edge);
  }

  /** Update both directions of affected pairs; report only wires with changed lane geometry. */
  update(wireIds: Iterable<string>, nodes: ReadonlyMap<string, FixtureNode>): Set<string> {
    const pairs = new Set<NodePair>();
    const changed = new Set<string>();
    for (const id of wireIds) {
      const pair = this.pairByWire.get(id);
      if (pair) pairs.add(pair);
    }
    const origin = { x: 0, y: 0 };
    const rowY = ({ nodeId, portId }: FixtureEdge['from']) => portPoint(nodes.get(nodeId)!, portId, origin).y;
    for (const [forward, reverse] of pairs) {
      const reciprocal = forward.wires.length > 0 && reverse.wires.length > 0;
      const sharedCorridor = reciprocal && forward.wires.length + reverse.wires.length > 2;
      for (const [direction, opposite] of [[forward, reverse], [reverse, forward]] as const) {
        const laneCount = direction.wires.length;
        const hasLanes = sharedCorridor || laneCount > 1;
        // Prefer rendered destination rows so an inverted fan crosses at only the source.
        if (hasLanes) direction.wires.sort((a, b) => rowY(a.to) - rowY(b.to) || rowY(a.from) - rowY(b.from) || compareText(a.id, b.id));
        direction.wires.forEach((wire, index) => {
          const laneIndex = hasLanes ? index : undefined;
          const count = hasLanes ? laneCount : undefined;
          const oppositeCount = sharedCorridor ? opposite.wires.length : undefined;
          if (wire.reciprocal === reciprocal && wire.laneIndex === laneIndex && wire.laneCount === count && wire.oppositeLaneCount === oppositeCount) return;
          wire.reciprocal = reciprocal;
          if (laneIndex === undefined || count === undefined) {
            delete wire.laneIndex;
            delete wire.laneCount;
          } else {
            wire.laneIndex = laneIndex;
            wire.laneCount = count;
          }
          if (oppositeCount === undefined) delete wire.oppositeLaneCount;
          else wire.oppositeLaneCount = oppositeCount;
          changed.add(wire.id);
        });
      }
    }
    return changed;
  }
}

export function createLocalSummary(graph: LocalGraph): () => string {
  let locals = 0;
  let unread = 0;
  let partial = 0;
  for (const node of graph.nodes.values()) {
    if (node.origin !== 'local') continue;
    locals += 1;
    if (node.bindingsRead === 'unread' || node.bindingsRead === 'not-requested') unread += 1;
    if (node.bindingsRead === 'partial') partial += 1;
  }
  return () => {
    const parts = [`${locals} local`, `${graph.nodes.size - locals} referenced`, `${graph.connections.size} configured`];
    if (unread) parts.push(`${unread} local unread`);
    if (partial) parts.push(`${partial} local partial`);
    if (graph.incompleteAssignments) parts.push(`${graph.incompleteAssignments} incomplete`);
    if (graph.conflicts.length) parts.push(`${graph.conflicts.length} conflicts`);
    return parts.join(' · ');
  };
}

/** Initial projection; enrichment uses the same keyed helpers without visiting the whole graph. */
export function projectLocalGraph(
  graph: LocalGraph,
  positions?: ReadonlyMap<string, Point>,
  geometry: LocalGraphGeometry = positions
    ? localGraphGeometryForPositions(graph, positions) ?? indexLocalGraphGeometry(graph)
    : indexLocalGraphGeometry(graph)
): LocalGraphProjection {
  const placed = positions ?? placeLocalGraph(graph, {}, geometry);
  const portIds = new Map<string, string>();
  const nodes = [...graph.nodes.values()].sort((a, b) => compareText(a.key, b.key)).map((node) => {
    const ports = localPortsForNode(graph, node.id, geometry).map((port) => {
      const projected = projectLocalPort(port);
      portIds.set(port.id, projected.id);
      return projected;
    });
    return projectLocalCard(node, ports, placed.get(node.id) ?? { x: 0, y: 0 });
  });
  const pairs = new LocalWirePairs();
  const edges = [...graph.connections.values()].sort((a, b) => compareText(a.id, b.id)).map((connection) => {
    const wire = projectLocalWire(graph, connection, portIds);
    pairs.add(wire);
    return wire;
  });
  pairs.update(edges.map(({ id }) => id), new Map(nodes.map((node) => [node.id, node])));
  return { nodes, edges, socketIds: portIds, wirePairs: pairs, summary: createLocalSummary(graph)(), conflicts: graph.conflicts, incompleteAssignments: graph.incompleteAssignments };
}
