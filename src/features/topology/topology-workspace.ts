import type { TopologyGraph, TopologyNodeId } from './topology-model';
import type { TopologyWorkspaceMode } from './topology-layout';

/** Membership inputs stay distinct: discovery is evidence, display is a user choice, connectivity is configured wiring. */
export interface TopologyWorkspaceMembership {
  discoveredNodeIds: ReadonlySet<TopologyNodeId>;
  /** Full inventory selection minus explicit presentation omissions. */
  allNodeIds: ReadonlySet<TopologyNodeId>;
  displayedNodeIds: ReadonlySet<TopologyNodeId>;
  connectedNodeIds: ReadonlySet<TopologyNodeId>;
}

export interface TopologyWorkspaceSelection {
  mode: TopologyWorkspaceMode;
  pinnedNodeIds: ReadonlySet<TopologyNodeId>;
  omittedNodeIds: ReadonlySet<TopologyNodeId>;
}

/**
 * Derive only from the graph and persisted user membership. Missing nodes in a
 * partial/failed read do not erase pins. Configured terminal nodes are visible
 * in the custom workspace even before a user pins anything; unconnected
 * inventory nodes remain searchable in the palette.
 */
export function topologyWorkspaceMembership(
  graph: TopologyGraph,
  selection: TopologyWorkspaceSelection
): TopologyWorkspaceMembership {
  const discoveredNodeIds = new Set(graph.nodes.filter((node) => node.discovery === 'advertised').map(({ id }) => id));
  const allNodeIds = new Set([...graph.nodes.map(({ id }) => id), ...selection.pinnedNodeIds]);
  for (const id of selection.omittedNodeIds) allNodeIds.delete(id);
  const displayedNodeIds = new Set<TopologyNodeId>();
  if (selection.mode === 'all') {
    for (const id of discoveredNodeIds) if (!selection.omittedNodeIds.has(id)) displayedNodeIds.add(id);
  }
  for (const id of selection.pinnedNodeIds) if (!selection.omittedNodeIds.has(id)) displayedNodeIds.add(id);

  const endpoints = new Map(graph.endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const connectedNodeIds = new Set<TopologyNodeId>();
  for (const binding of graph.bindings) {
    if (binding.assignment !== 'complete' || binding.assignmentRow !== 'present') continue;
    const source = binding.sourceEndpointId ? endpoints.get(binding.sourceEndpointId) : undefined;
    const target = binding.targetEndpointId ? endpoints.get(binding.targetEndpointId) : undefined;
    const sourceNodeId = source?.nodeId ?? binding.ownerId;
    const targetNodeId = target?.nodeId ?? binding.targetNodeId;
    connectedNodeIds.add(sourceNodeId);
    if (targetNodeId && sourceNodeId !== targetNodeId) connectedNodeIds.add(targetNodeId);
  }
  for (const id of [...connectedNodeIds]) if (selection.omittedNodeIds.has(id)) connectedNodeIds.delete(id);
  if (selection.mode === 'custom') for (const id of connectedNodeIds) displayedNodeIds.add(id);
  for (const id of selection.omittedNodeIds) displayedNodeIds.delete(id);
  return { discoveredNodeIds, allNodeIds, displayedNodeIds, connectedNodeIds };
}

export function addTopologyWorkspaceNode(
  selection: TopologyWorkspaceSelection,
  nodeId: TopologyNodeId
): TopologyWorkspaceSelection {
  const pinnedNodeIds = new Set(selection.pinnedNodeIds).add(nodeId);
  const omittedNodeIds = new Set(selection.omittedNodeIds);
  omittedNodeIds.delete(nodeId);
  return { ...selection, pinnedNodeIds, omittedNodeIds };
}

/** Remove is a presentation exclusion only; it never alters graph evidence. */
export function removeTopologyWorkspaceNode(
  selection: TopologyWorkspaceSelection,
  nodeId: TopologyNodeId
): TopologyWorkspaceSelection {
  const pinnedNodeIds = new Set(selection.pinnedNodeIds);
  pinnedNodeIds.delete(nodeId);
  const omittedNodeIds = new Set(selection.omittedNodeIds);
  omittedNodeIds.add(nodeId);
  return { ...selection, pinnedNodeIds, omittedNodeIds };
}

/** Reset is presentation-only and restores the relationship-first default. */
export function resetTopologyWorkspace(): TopologyWorkspaceSelection {
  return { mode: 'custom', pinnedNodeIds: new Set(), omittedNodeIds: new Set() };
}

export function connectedTopologyNodeIds(graph: TopologyGraph): ReadonlySet<TopologyNodeId> {
  return topologyWorkspaceMembership(graph, { mode: 'custom', pinnedNodeIds: new Set(), omittedNodeIds: new Set() }).connectedNodeIds;
}
