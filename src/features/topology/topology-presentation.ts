import type { TopologyCanvasNode, TopologyCanvasPoint, TopologyCanvasProjection } from './topology-canvas';
import type { TopologyBinding, TopologyEndpoint, TopologyGraph, TopologyNode, TopologyNodeId } from './topology-model';
import type { TopologyNodeStatus } from './topology-controller';
import { topologyNodeSize } from './topology-layout';

export type TopologyPortReveal = 'connected' | 'compact' | 'expanded';
export type TopologyScopedReveal = { bindingId?: TopologyBinding['id']; nodeIds?: ReadonlySet<TopologyNodeId>; endpointIds?: ReadonlySet<string> };
export type TopologyStatusFacet = 'discovered' | 'partial' | 'stale' | 'unresolved';
export interface TopologyFilters {
  query: string;
  showCandidates: boolean;
  showPlaceholders: boolean;
  /** Selected facets are ORed together; facet selection intersects other filters. */
  statuses?: readonly TopologyStatusFacet[];
  showConnections?: boolean;
  showLabels?: boolean;
  showUnresolved?: boolean;
  showAmbiguous?: boolean;
}

export interface TopologyPresentation {
  projection: TopologyCanvasProjection;
  visibleNodes: readonly TopologyNode[];
  visibleBindings: readonly TopologyBinding[];
  connectedEndpointIds: ReadonlySet<string>;
  matchingNodeIds: ReadonlySet<TopologyNodeId>;
  matchingBindingIds: ReadonlySet<string>;
}

function textForNode(node: TopologyNode, endpoints: readonly TopologyEndpoint[], bindings: readonly TopologyBinding[]): string {
  const endpointNames = endpoints.map((endpoint) => endpoint.name);
  const aliases = bindings.map((binding) => binding.alias);
  return [node.name, node.host, ...node.addresses.map((address) => address.displayAddress), ...endpointNames, ...aliases]
    .filter(Boolean).join(' ').toLocaleLowerCase();
}

export function topologyEndpointDirection(endpoint: TopologyEndpoint): 'input' | 'output' {
  return endpoint.kind === 'local-action' || endpoint.kind === 'remote-event' ? 'input' : 'output';
}

function countText(count: number, complete: boolean) {
  return complete ? String(count) : count ? `${count} known` : 'unknown';
}

function countLabel(count: number, complete: boolean, noun: 'node' | 'binding' | 'endpoint') {
  return !complete && count === 0 ? `${noun[0]!.toUpperCase()}${noun.slice(1)}s unknown`
    : `${countText(count, complete)} ${noun}${count === 1 ? '' : 's'}`;
}

function hasStaleEvidence(node: TopologyNode, status?: TopologyNodeStatus): boolean {
  return Boolean(status?.stale) || [node.actionInventory, node.eventInventory, node.schemaEvidence, node.assignmentEvidence]
    .some((evidence) => evidence.status === 'failure' && evidence.value !== undefined);
}

function unresolvedOwners(graph: TopologyGraph) {
  return new Set(graph.bindings.filter(binding => binding.configuredNode && binding.configuredEndpoint
    && binding.referenceResolution !== 'resolved').map(binding => binding.ownerId));
}

function nodeHasFacet(node: TopologyNode, facet: TopologyStatusFacet, status: TopologyNodeStatus | undefined, unresolved: ReadonlySet<TopologyNodeId>): boolean {
  switch (facet) {
    case 'discovered': return node.discovery !== 'placeholder';
    case 'partial': return Boolean(status && (status.readability === 'partial' || status.readability === 'unreadable'))
      || node.discovery === 'placeholder'
      || [node.actionInventory, node.eventInventory, node.schemaEvidence, node.assignmentEvidence].some((item) => item.status === 'failure' || item.status === 'absent');
    case 'stale': return hasStaleEvidence(node, status);
    case 'unresolved': return node.discovery === 'placeholder' || unresolved.has(node.id);
  }
}

/** Evidence facets with overlapping status categories, suitable for a filter/count UI. */
export function topologyStatusCounts(
  graph: TopologyGraph,
  nodeStatuses: ReadonlyMap<TopologyNodeId, TopologyNodeStatus> = new Map()
): Record<TopologyStatusFacet, number> {
  const counts: Record<TopologyStatusFacet, number> = { discovered: 0, partial: 0, stale: 0, unresolved: 0 };
  const unresolved = unresolvedOwners(graph);
  for (const node of graph.nodes) for (const facet of Object.keys(counts) as TopologyStatusFacet[]) {
    if (nodeHasFacet(node, facet, nodeStatuses.get(node.id), unresolved)) counts[facet] += 1;
  }
  return counts;
}

export function presentTopology(
  graph: TopologyGraph,
  positions: ReadonlyMap<TopologyNodeId, TopologyCanvasPoint>,
  filters: TopologyFilters,
  reveal: TopologyPortReveal,
  revealedEndpointIds: ReadonlySet<string> = new Set(),
  nodeStatuses: ReadonlyMap<TopologyNodeId, TopologyNodeStatus> = new Map(),
  scopedReveal?: TopologyScopedReveal
): TopologyPresentation {
  const endpointsByNode = new Map<string, TopologyEndpoint[]>();
  for (const endpoint of graph.endpoints) {
    const points = endpointsByNode.get(endpoint.nodeId) ?? [];
    points.push(endpoint);
    endpointsByNode.set(endpoint.nodeId, points);
  }
  const query = filters.query.trim().toLocaleLowerCase();
  const selectedFacets = filters.statuses ?? [];
  const unresolved = unresolvedOwners(graph);
  const endpointById = new Map(graph.endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const scopedBinding = scopedReveal?.bindingId ? graph.bindings.find(({ id }) => id === scopedReveal.bindingId) : undefined;
  const scopedNodeIds = new Set(scopedReveal?.nodeIds ?? []);
  const scopedEndpointIds = new Set(scopedReveal?.endpointIds ?? []);
  if (scopedBinding) {
    scopedNodeIds.add(scopedBinding.ownerId);
    if (scopedBinding.targetNodeId) scopedNodeIds.add(scopedBinding.targetNodeId);
    for (const endpointId of [scopedBinding.sourceEndpointId, scopedBinding.targetEndpointId]) {
      const nodeId = endpointId ? endpointById.get(endpointId)?.nodeId : undefined;
      if (endpointId) scopedEndpointIds.add(endpointId);
      if (nodeId) scopedNodeIds.add(nodeId);
    }
  }
  const facetFiltered = (node: TopologyNode) => filters.statuses === undefined
    || selectedFacets.some((facet) => nodeHasFacet(node, facet, nodeStatuses.get(node.id), unresolved));
  const baseEligibleIds = new Set(graph.nodes.filter((node) => {
    if (node.discovery === 'placeholder' && (!filters.showPlaceholders || filters.showUnresolved === false)) return false;
    return facetFiltered(node);
  }).map(({ id }) => id));
  const eligibleNodes = graph.nodes.filter((node) => baseEligibleIds.has(node.id) || scopedNodeIds.has(node.id));
  const eligibleIds = new Set(eligibleNodes.map((node) => node.id));
  const scopeOnlyNodeIds = new Set(eligibleNodes.filter(({ id }) => scopedNodeIds.has(id) && !baseEligibleIds.has(id)).map(({ id }) => id));
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
  const owned = new Map<TopologyNodeId, TopologyBinding[]>();
  for (const binding of graph.bindings) {
    const rows = owned.get(binding.ownerId);
    if (rows) rows.push(binding); else owned.set(binding.ownerId, [binding]);
  }
  const bindingText = (binding: TopologyBinding) => {
    const sourceNode = nodeById.get(binding.ownerId);
    const targetNode = binding.targetNodeId && nodeById.get(binding.targetNodeId);
    return `${binding.alias} ${binding.configuredNode ?? ''} ${binding.configuredEndpoint ?? ''} ${sourceNode?.name ?? ''} ${targetNode?.name ?? ''}`.toLocaleLowerCase();
  };
  const matchingNodeIds = new Set(eligibleNodes.filter((node) => !query || textForNode(node, endpointsByNode.get(node.id) ?? [], owned.get(node.id) ?? []).includes(query)).map((node) => node.id));
  const matchingBindingIds = new Set(graph.bindings.filter((binding) => query && bindingText(binding).includes(query)).map((binding) => binding.id));
  // A matching wire keeps its peer in view, so searching one side never erases the relationship.
  const neighborIds = new Set<TopologyNodeId>();
  for (const binding of graph.bindings) {
    if (!matchingBindingIds.has(binding.id) && !matchingNodeIds.has(binding.ownerId) && !matchingNodeIds.has(binding.targetNodeId as TopologyNodeId)) continue;
    if (eligibleIds.has(binding.ownerId)) neighborIds.add(binding.ownerId);
    if (binding.targetNodeId && eligibleIds.has(binding.targetNodeId)) neighborIds.add(binding.targetNodeId);
    for (const endpointId of [binding.sourceEndpointId, binding.targetEndpointId]) {
      const nodeId = endpointId ? endpointById.get(endpointId)?.nodeId : undefined;
      if (nodeId && eligibleIds.has(nodeId)) neighborIds.add(nodeId);
    }
  }
  const visibleNodeIds = !query ? eligibleIds : new Set([...matchingNodeIds, ...neighborIds]);
  const visibleNodes = eligibleNodes.filter((node) => visibleNodeIds.has(node.id));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleBindings = graph.bindings.filter((binding) => visibleIds.has(binding.ownerId)
    && (binding.id === scopedReveal?.bindingId || !query || matchingBindingIds.has(binding.id) || matchingNodeIds.has(binding.ownerId) || (binding.targetNodeId && matchingNodeIds.has(binding.targetNodeId)))
    && (binding.id === scopedReveal?.bindingId || ![binding.sourceEndpointId, binding.targetEndpointId]
      .some((id) => id && scopeOnlyNodeIds.has(endpointById.get(id)?.nodeId as TopologyNodeId))));
  const renderableBindings = visibleBindings.flatMap((binding) => {
    // Declared-but-unbound and incomplete/conflicting assignments remain
    // inspectable rows, never speculative or self-looping wires.
    if (binding.assignment !== 'complete' || binding.assignmentRow !== 'present'
      || binding.assignmentFreshness === 'unknown'
      || !binding.configuredNode?.trim() || !binding.configuredEndpoint?.trim()
      || !binding.sourceEndpointId || !binding.targetEndpointId) return [];
    const source = endpointById.get(binding.sourceEndpointId);
    const target = endpointById.get(binding.targetEndpointId);
    if (!source || !target || !visibleIds.has(source.nodeId) || !visibleIds.has(target.nodeId)) return [];
    return [{ binding, source, target }];
  });
  const drawableBindings = renderableBindings.filter(({ binding }) => {
    const scoped = binding.id === scopedReveal?.bindingId;
    const unresolvedBinding = binding.referenceResolution !== 'resolved' || binding.assignment !== 'complete';
    const ambiguousBinding = binding.referenceResolution === 'ambiguous';
    return scoped || (!unresolvedBinding || filters.showUnresolved !== false)
      && (!ambiguousBinding || filters.showAmbiguous !== false);
  });
  const connectedEndpointIds = new Set(drawableBindings.flatMap(({ source, target }) => [source.id, target.id]));
  const nodes: TopologyCanvasNode[] = visibleNodes.map((node, index) => {
    const endpoints = endpointsByNode.get(node.id) ?? [];
    const active = endpoints.filter((endpoint) => connectedEndpointIds.has(endpoint.id) || revealedEndpointIds.has(endpoint.id) || scopedEndpointIds.has(endpoint.id));
    const bindingsComplete = node.schemaEvidence.status === 'success' && node.assignmentEvidence.status === 'success';
    const actionsComplete = node.actionInventory.status === 'success';
    const eventsComplete = node.eventInventory.status === 'success';
    const actions = new Set(node.actionInventory.value);
    const events = new Set(node.eventInventory.value);
    let inputs = actions.size;
    let outputs = events.size;
    for (const endpoint of endpoints) {
      if (endpoint.kind === 'remote-event') inputs += 1;
      else if (endpoint.kind === 'remote-action') outputs += 1;
    }
    const diagnostics = node.actionInventory.status === 'failure' || node.eventInventory.status === 'failure' ? ' • partial data' : '';
    const status = nodeStatuses.get(node.id);
    const readability = status ? `${status.readability}${status.stale ? ' · stale' : ''}` : 'advertised only';
    return {
      id: node.id,
      title: node.name,
      status: `${node.discovery === 'placeholder' ? 'Unresolved reference' : 'Discovered'} · ${readability}${diagnostics}`,
      summary: `${countLabel(owned.get(node.id)?.length ?? 0, bindingsComplete, 'binding')} • ${countLabel(inputs + outputs, bindingsComplete && actionsComplete && eventsComplete, 'endpoint')}`,
      position: positions.get(node.id) ?? { x: 36 + (index % 4) * 310, y: 36 + Math.floor(index / 4) * 164 },
      height: topologyNodeSize(reveal === 'compact' ? 2 : Math.max(
        active.filter((endpoint) => topologyEndpointDirection(endpoint) === 'input').length,
        active.filter((endpoint) => topologyEndpointDirection(endpoint) === 'output').length
      )).height,
      ports: reveal === 'compact'
        ? (['input', 'output'] as const).map((direction) => {
          const label = direction === 'input' ? `Inputs (${countText(inputs, bindingsComplete && actionsComplete)})`
            : `Outputs (${countText(outputs, bindingsComplete && eventsComplete)})`;
          return { id: aggregatePortId(node.id, direction), label, direction };
        })
        : active.map((endpoint) => ({ id: endpoint.id, label: endpoint.name, direction: topologyEndpointDirection(endpoint) }))
    };
  });
  const wires = drawableBindings.filter(({ binding }) => binding.id === scopedReveal?.bindingId || filters.showConnections !== false)
    .map(({ binding, source, target }) => {
    const resolution = binding.referenceResolution;
    const configuredEndpoint = binding.kind === 'actions' ? target : source;
    const missingEndpoint = resolution === 'endpoint-missing' || configuredEndpoint.evidence === 'missing';
    const unresolved = resolution !== 'resolved' || missingEndpoint;
    const issue = referenceIssue(binding, missingEndpoint ? { referenceResolution: 'endpoint-missing' } : binding);
    return {
      id: binding.id,
      source: { nodeId: source.nodeId, portId: reveal === 'compact' ? aggregatePortId(source.nodeId, topologyEndpointDirection(source)) : source.id },
      target: { nodeId: target.nodeId, portId: reveal === 'compact' ? aggregatePortId(target.nodeId, topologyEndpointDirection(target)) : target.id },
      ...(filters.showLabels === false ? {} : { label: `${binding.kind === 'actions' ? 'Action call' : 'Event subscription'} · ${binding.alias}${issue ? ` · ${issue}` : ''}` }),
      ...(binding.assignmentFreshness === 'stale' ? { status: 'stale' as const }
        : binding.assignmentFreshness === 'cached' ? { status: 'pending' as const }
          : unresolved ? { status: 'unresolved' as const } : {})
    };
  });
  return { projection: { nodes, wires }, visibleNodes, visibleBindings, connectedEndpointIds, matchingNodeIds, matchingBindingIds };
}

export function topologyBindingExplanation(binding: TopologyBinding): string {
  const resolution = binding.referenceResolution;
  const targetKind = binding.kind === 'events' ? 'event' : 'action';
  const ownerRole = binding.kind === 'events' ? 'subscription' : 'alias';
  if (binding.assignment === 'conflicting') {
    if (binding.assignmentFreshness === 'stale') return 'The owner assignment read failed, and its last-known assignment is conflicting. No connection is shown.';
    return 'Conflicting assignment evidence prevents a reliable connection.';
  }
  if (binding.assignmentFreshness === 'unknown') return 'The owner assignment is unavailable or has not been read. No configured connection can be shown.';
  if (binding.assignment !== 'complete') {
    const prefix = binding.assignmentFreshness === 'stale' ? 'The owner assignment read failed. In the last-known configuration: '
      : binding.assignmentFreshness === 'cached' ? 'From the cached owner assignment read: ' : '';
    if (binding.assignment === 'unbound') return `${prefix}This declared alias has no configured assignment.`;
    if (binding.assignment === 'partial') return `${prefix}The assignment has only part of its required target.`;
    if (binding.assignmentRow === 'absent') return `${prefix}No assignment row was returned for this alias.`;
    return 'The owner assignment is unavailable or has not been read. No configured connection can be shown.';
  }
  const routeDispute = resolution === 'ambiguous' && binding.ambiguity === 'routes'
    ? `Routes for node “${binding.configuredNode ?? 'unknown'}” disagree about its ${targetKind} inventory. The configured wire is shown, but the target could not be validated.`
    : '';
  if (binding.assignmentFreshness === 'stale') return `The owner assignment read failed; this wire uses the owner's last-known configuration. ${routeDispute || `Target validation is ${resolution}.`}`;
  if (binding.assignmentFreshness === 'cached') return `This wire uses a cached owner assignment. ${routeDispute || `Target validation is ${resolution}.`}`;
  if (routeDispute) return routeDispute;
  if (resolution === 'endpoint-missing') return `Configured target ${targetKind} “${binding.configuredEndpoint ?? 'unknown'}” on node “${binding.configuredNode ?? 'unknown'}” was not found; it is the target of ${ownerRole} “${binding.alias}”.`;
  if (resolution === 'ambiguous') return binding.ambiguity === 'endpoint'
    ? `Multiple ${targetKind} endpoints on node “${binding.configuredNode ?? 'unknown'}” match “${binding.configuredEndpoint ?? 'unknown'}” for ${ownerRole} “${binding.alias}”; the viewer does not choose among them.`
    : `Multiple discovered nodes match configured target “${binding.configuredNode ?? 'unknown'}” for ${targetKind} ${ownerRole} “${binding.alias}”; the viewer does not choose among them.`;
  if (resolution === 'not-discovered') return `No discovered node matches configured target “${binding.configuredNode ?? 'unknown'}” for ${targetKind} ${ownerRole} “${binding.alias}”.`;
  if (resolution === 'unknown') return 'The owner assignment is configured, but the target could not be validated.';
  return 'The configured assignment resolves to a discovered endpoint.';
}

function referenceIssue(binding: TopologyBinding, reference: Pick<TopologyBinding, 'referenceResolution' | 'ambiguity'>): string {
  const targetKind = binding.kind === 'events' ? 'event' : 'action';
  if (reference.referenceResolution === 'endpoint-missing') return `target ${targetKind} “${binding.configuredEndpoint}” missing on node “${binding.configuredNode}”`;
  if (reference.referenceResolution === 'ambiguous' && reference.ambiguity === 'routes') return `routes disagree on ${targetKind} inventory for “${binding.configuredNode}”`;
  if (reference.referenceResolution === 'ambiguous') return reference.ambiguity === 'endpoint'
    ? `multiple ${targetKind} endpoints match “${binding.configuredEndpoint}” on node “${binding.configuredNode}”`
    : `multiple nodes match target “${binding.configuredNode}”`;
  if (reference.referenceResolution === 'not-discovered') return `target node “${binding.configuredNode}” not discovered`;
  return reference.referenceResolution === 'unknown' ? 'target resolution unknown' : '';
}

function aggregatePortId(nodeId: string, direction: 'input' | 'output') {
  return `aggregate:${nodeId.length}:${nodeId}:${direction}`;
}

export interface TopologySummary {
  heading: string;
  detail: string;
  tone: 'neutral' | 'warning' | 'danger';
}

export function summarizeTopology(update: {
  graph?: Pick<TopologyGraph, 'completeness'>;
  phase: 'loading' | 'idle' | 'paused';
  coverage: 'unknown' | 'complete' | 'partial' | 'failed';
  progress: { completed: number; total: number };
  diagnostics: readonly { source: string; message: string; nodeName?: string }[];
  diagnosticsOmitted: number;
  stale: boolean;
  lastSuccessAt?: number;
}, nodeCount: number, bindingCount: number): TopologySummary {
  const diagnostics = update.diagnostics.slice(0, 3).map((item) => `${item.source}${item.nodeName ? ` · ${item.nodeName}` : ''}: ${item.message}`);
  if (update.diagnosticsOmitted > 0) diagnostics.push(`${update.diagnosticsOmitted} additional diagnostic${update.diagnosticsOmitted === 1 ? '' : 's'} omitted.`);
  const state = update.phase === 'loading' ? `Reading topology (${update.progress.completed}/${update.progress.total || '…'} checks).`
    : update.phase === 'paused' ? 'Topology reading is paused while this view is inactive or unavailable.'
      : update.coverage === 'failed' ? 'Topology could not be read.'
        : update.coverage === 'partial' ? 'Topology is incomplete; some node data could not be read.'
          : update.coverage === 'unknown' ? 'Topology coverage is not yet known.' : 'Topology read complete.';
  const stale = update.stale ? 'Some data is pending confirmation or retained from older reads.' : '';
  const completeness = update.graph?.completeness;
  const nodesComplete = !completeness || completeness.discovery === 'complete';
  const bindingsComplete = !completeness || (nodesComplete && completeness.schema === 'complete' && completeness.assignments === 'complete');
  const counts = `${countLabel(nodeCount, nodesComplete, 'node')}${bindingsComplete ? ' and ' : ' • '}${countLabel(bindingCount, bindingsComplete, 'binding')}.`;
  return {
    heading: state,
    detail: [counts, stale, ...(update.lastSuccessAt !== undefined ? [`Last complete refresh: ${new Date(update.lastSuccessAt).toLocaleString()}.`] : []), ...diagnostics].filter(Boolean).join(' '),
    tone: update.coverage === 'failed' ? 'danger' : update.coverage === 'partial' || update.stale ? 'warning' : 'neutral'
  };
}
