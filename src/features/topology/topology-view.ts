import type { TopologyCanvasPoint, TopologyCanvasProjection, TopologyCanvasWire } from './topology-canvas';
import type { TopologyBinding, TopologyBindingId, TopologyGraph, TopologyNode, TopologyNodeId } from './topology-model';
import type { TopologyNodeStatus } from './topology-controller';
import { presentTopology, type TopologyFilters, type TopologyPortReveal, type TopologyPresentation, type TopologyScopedReveal } from './topology-presentation';
import type { TopologyWorkspaceMembership } from './topology-workspace';

export type TopologyDisplayMode = 'detailed' | 'overview' | 'compact' | 'focus' | 'all-nodes';
export type TopologyFocusDirection = 'upstream' | 'downstream' | 'both';

export interface TopologyViewOptions {
  mode: TopologyDisplayMode;
  /** Results of workspace membership/visibility filtering; omitted means no additional restriction. */
  memberNodeIds?: ReadonlySet<TopologyNodeId>;
  /** Stage-3 membership output. All-Nodes deliberately bypasses this display-only subset. */
  workspaceMembership?: TopologyWorkspaceMembership;
  selectedNodeId?: TopologyNodeId;
  focusDirection?: TopologyFocusDirection;
  /** Focus is intentionally capped at two hops. */
  focusHops?: 1 | 2;
  showCompactCounts?: boolean;
  /** Port projection is an independent toolbar preference from node-card mode. */
  portReveal?: TopologyPortReveal;
}

export interface TopologyOverviewWire extends TopologyCanvasWire {
  kind: 'actions' | 'events';
  /** Original rows remain available for binding selection and owner-aware inspection. */
  memberBindingIds: readonly TopologyBindingId[];
  ownerIds: readonly TopologyNodeId[];
  count: number;
}

export interface TopologyViewProjection extends Omit<TopologyPresentation, 'projection'> {
  projection: TopologyCanvasProjection & { wires: readonly (TopologyCanvasWire | TopologyOverviewWire)[] };
  mode: TopologyDisplayMode;
  /** Full discovery data remains available to search and selection irrespective of canvas filtering. */
  discoveryNodes: readonly TopologyNode[];
  discoveryBindings: readonly TopologyBinding[];
  /** Each aggregate or ordinary rendered wire maps to its original binding rows. */
  bindingIdsByWire: ReadonlyMap<string, readonly TopologyBindingId[]>;
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const wirePair = (wire: TopologyCanvasWire) => [wire.source.nodeId, wire.target.nodeId] as const;

function encoded(parts: readonly string[]): string {
  return parts.map(part => `${part.length}:${part}`).join('|');
}

/** Compute a bounded, directed focus set from the currently drawable wires only. */
export function topologyFocusMembership(
  graph: TopologyGraph,
  visibleWires: readonly TopologyCanvasWire[],
  selectedNodeId: TopologyNodeId | undefined,
  direction: TopologyFocusDirection = 'both',
  hops: 1 | 2 = 1
): ReadonlySet<TopologyNodeId> {
  const members = new Set<TopologyNodeId>();
  if (!selectedNodeId) return members;
  members.add(selectedNodeId);
  const nodes = new Set(graph.nodes.map(node => node.id));
  if (!nodes.has(selectedNodeId)) return members;
  let frontier = new Set([selectedNodeId]);
  for (let depth = 0; depth < hops; depth += 1) {
    const next = new Set<TopologyNodeId>();
    for (const wire of visibleWires) {
      const [source, target] = wirePair(wire);
      if (direction !== 'upstream' && frontier.has(source as TopologyNodeId) && nodes.has(target as TopologyNodeId)) next.add(target as TopologyNodeId);
      if (direction !== 'downstream' && frontier.has(target as TopologyNodeId) && nodes.has(source as TopologyNodeId)) next.add(source as TopologyNodeId);
    }
    for (const nodeId of next) members.add(nodeId);
    frontier = next;
  }
  return members;
}

function edgeKindById(graph: TopologyGraph): Map<string, 'actions' | 'events'> {
  return new Map(graph.bindings.map(binding => [binding.id, binding.kind]));
}

function aggregateOverviewWires(graph: TopologyGraph, wires: readonly TopologyCanvasWire[]): { wires: TopologyOverviewWire[]; bindingIdsByWire: Map<string, readonly TopologyBindingId[]> } {
  const kinds = edgeKindById(graph);
  const bindingsById = new Map(graph.bindings.map(binding => [binding.id, binding]));
  const groups = new Map<string, { kind: 'actions' | 'events'; status: TopologyCanvasWire['status']; first: TopologyCanvasWire; ids: TopologyBindingId[]; owners: Set<TopologyNodeId> }>();
  for (const wire of wires) {
    const kind = kinds.get(wire.id);
    if (!kind) continue;
    // Status equality is deliberately exact: pending/stale/unresolved/normal evidence cannot be collapsed together.
    const key = encoded([wire.source.nodeId, wire.target.nodeId, kind, wire.status ?? 'normal']);
    const group = groups.get(key);
    const binding = bindingsById.get(wire.id as TopologyBindingId);
    if (group) {
      group.ids.push(wire.id as TopologyBindingId);
      if (binding) group.owners.add(binding.ownerId);
    } else groups.set(key, { kind, status: wire.status, first: wire, ids: [wire.id as TopologyBindingId], owners: new Set(binding ? [binding.ownerId] : []) });
  }
  const output: TopologyOverviewWire[] = [];
  const bindingIdsByWire = new Map<string, readonly TopologyBindingId[]>();
  for (const [key, group] of groups) {
    const ids = group.ids.slice().sort(compare);
    const ownerIds = [...group.owners].sort(compare);
    // One member remains an ordinary binding wire; only real bundles receive
    // a synthetic visual identity.
    const id = ids.length === 1 ? ids[0]! : `overview:${key}`;
    output.push({ id, source: group.first.source, target: group.first.target, kind: group.kind,
      memberBindingIds: ids, ownerIds, count: ids.length,
      label: `${group.kind === 'actions' ? 'Actions' : 'Events'}${ids.length > 1 ? ` (${ids.length})` : ''}`,
      ...(group.status ? { status: group.status } : {}) });
    bindingIdsByWire.set(id, ids);
  }
  return { wires: output, bindingIdsByWire };
}

/**
 * Project a graph for one display mode. Workspace membership is applied before
 * focus traversal; search/scoped reveals remain delegated to `presentTopology`.
 */
export function projectTopologyView(
  graph: TopologyGraph,
  positions: ReadonlyMap<TopologyNodeId, TopologyCanvasPoint>,
  filters: TopologyFilters,
  options: TopologyViewOptions,
  revealedEndpointIds: ReadonlySet<string> = new Set(),
  nodeStatuses: ReadonlyMap<TopologyNodeId, TopologyNodeStatus> = new Map(),
  scopedReveal?: TopologyScopedReveal
): TopologyViewProjection {
  const mode = options.mode;
  const reveal: TopologyPortReveal = options.portReveal ?? (mode === 'compact' ? 'compact' : mode === 'detailed' ? 'expanded' : 'connected');
  const projectionFilters: TopologyFilters = { ...filters };
  if (mode === 'all-nodes') {
    projectionFilters.query = '';
  }
  const base = presentTopology(graph, positions, projectionFilters, reveal, revealedEndpointIds, nodeStatuses, scopedReveal);
  let memberLimit = mode === 'all-nodes' ? options.workspaceMembership?.allNodeIds : options.workspaceMembership?.displayedNodeIds ?? options.memberNodeIds;
  if (memberLimit && scopedReveal) {
    const revealed = new Set(memberLimit);
    for (const id of scopedReveal.nodeIds ?? []) revealed.add(id);
    if (scopedReveal.bindingId) {
      const binding = graph.bindings.find(item => item.id === scopedReveal.bindingId);
      if (binding) {
        revealed.add(binding.ownerId);
        if (binding.targetNodeId) revealed.add(binding.targetNodeId);
        for (const endpointId of [binding.sourceEndpointId, binding.targetEndpointId]) {
          const endpoint = endpointId ? graph.endpoints.find(item => item.id === endpointId) : undefined;
          if (endpoint) revealed.add(endpoint.nodeId);
        }
      }
    }
    memberLimit = revealed;
  }
  let membership: ReadonlySet<TopologyNodeId> = new Set(base.visibleNodes.filter(node => !memberLimit || memberLimit.has(node.id)).map(node => node.id));
  if (mode === 'all-nodes') membership = new Set(base.visibleNodes.filter(node => !memberLimit || memberLimit.has(node.id)).map(node => node.id));
  if (mode === 'focus') {
    const eligibleWires = base.projection.wires.filter(wire => memberLimit === undefined
      || memberLimit.has(wire.source.nodeId as TopologyNodeId) && memberLimit.has(wire.target.nodeId as TopologyNodeId));
    const focus = topologyFocusMembership(graph, eligibleWires, options.selectedNodeId, options.focusDirection, options.focusHops);
    membership = new Set([...membership].filter(id => focus.has(id)));
  } else if (mode === 'detailed' || mode === 'overview') {
    const connected = new Set<TopologyNodeId>(options.workspaceMembership?.connectedNodeIds ?? []);
    for (const wire of base.projection.wires) {
      connected.add(wire.source.nodeId as TopologyNodeId);
      connected.add(wire.target.nodeId as TopologyNodeId);
    }
    const manuallyDisplayed = memberLimit;
    membership = new Set([...membership].filter(id => connected.has(id) || (manuallyDisplayed?.has(id) ?? false)));
  }
  const visibleNodes = base.visibleNodes.filter(node => membership.has(node.id));
  const visibleBindings = base.visibleBindings.filter(binding => membership.has(binding.ownerId)
    && (!binding.targetNodeId || membership.has(binding.targetNodeId)));
  const projectionNodes = base.projection.nodes.filter(node => membership.has(node.id as TopologyNodeId));
  let wires = base.projection.wires.filter(wire => membership.has(wire.source.nodeId as TopologyNodeId)
    && membership.has(wire.target.nodeId as TopologyNodeId));
  let bindingIdsByWire: Map<string, readonly TopologyBindingId[]> = new Map(wires.map(wire => [wire.id, [wire.id as TopologyBindingId]]));
  if (mode === 'overview') {
    const aggregate = aggregateOverviewWires(graph, wires);
    wires = aggregate.wires;
    bindingIdsByWire = new Map(aggregate.bindingIdsByWire);
  }
  if (mode === 'compact') {
    const counts = options.showCompactCounts === true;
    const compactNodes = projectionNodes.map(node => ({ ...node,
      title: '', status: '', summary: '',
      ports: node.ports.map(port => ({ ...port, label: counts ? port.label.replace(/^Inputs?\s*\((.*)\)$/u, '$1').replace(/^Outputs?\s*\((.*)\)$/u, '$1') : '' }))
    }));
    return { ...base, visibleNodes, visibleBindings, projection: { nodes: compactNodes, wires: wires.map(({ label: _label, ...wire }) => wire) }, mode, discoveryNodes: graph.nodes, discoveryBindings: graph.bindings, bindingIdsByWire };
  }
  return { ...base, visibleNodes, visibleBindings, projection: { nodes: projectionNodes, wires }, mode, discoveryNodes: graph.nodes, discoveryBindings: graph.bindings, bindingIdsByWire };
}

/** Resolve any ordinary or aggregate wire ID to its original owner bindings. */
export function topologyViewBindingIds(view: TopologyViewProjection, wireId: string): readonly TopologyBindingId[] {
  return view.bindingIdsByWire.get(wireId) ?? [];
}

/** Find the nodes represented by an aggregate edge for selection/inspection. */
export function topologyViewOwners(view: TopologyViewProjection, wireId: string): readonly TopologyNodeId[] {
  const wire = view.projection.wires.find(item => item.id === wireId);
  if (wire && 'ownerIds' in wire) return (wire as TopologyOverviewWire).ownerIds;
  const ids = topologyViewBindingIds(view, wireId);
  return view.visibleBindings.filter(binding => ids.includes(binding.id)).map(binding => binding.ownerId);
}

export function topologyViewNode(view: TopologyViewProjection, id: TopologyNodeId): TopologyNode | undefined {
  return view.visibleNodes.find(node => node.id === id);
}
