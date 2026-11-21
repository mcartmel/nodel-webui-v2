import { describe, expect, it } from 'vitest';
import { projectTopologyView, topologyFocusMembership, topologyViewBindingIds, topologyViewOwners } from '../src/features/topology/topology-view';
import type { TopologyBinding, TopologyEndpoint, TopologyGraph, TopologyNode, TopologyNodeId } from '../src/features/topology/topology-model';

const node = (id: string, name = id): TopologyNode => ({
  id: id as TopologyNodeId, name, addresses: [], discovery: 'advertised',
  actionInventory: { status: 'success', source: 'test', value: [] }, eventInventory: { status: 'success', source: 'test', value: [] },
  schemaEvidence: { status: 'success', source: 'test', value: { actions: [], events: [] } },
  assignmentEvidence: { status: 'success', source: 'test', value: { actions: {}, events: {} } }
});
const point = (id: string, nodeId: string, kind: TopologyEndpoint['kind'], name: string): TopologyEndpoint => ({
  id: id as TopologyEndpoint['id'], nodeId: nodeId as TopologyNodeId, kind, name, evidence: 'declared'
});
const binding = (id: string, owner: string, kind: TopologyBinding['kind'], source: string, target: string,
  targetNode: string, alias = id, resolution: TopologyBinding['referenceResolution'] = 'resolved'): TopologyBinding => ({
  id: id as TopologyBinding['id'], ownerId: owner as TopologyNodeId, kind, alias, declared: 'yes', assignment: 'complete', assignmentRow: 'present',
  configuredNode: targetNode, configuredEndpoint: 'point', targetNodeId: targetNode as TopologyNodeId,
  sourceEndpointId: source as TopologyEndpoint['id'], targetEndpointId: target as TopologyEndpoint['id'],
  direction: 'source-to-target', referenceResolution: resolution
});

const graph: TopologyGraph = {
  nodes: [node('A'), node('B'), node('C'), node('isolated')],
  endpoints: [
    point('a-call-1', 'A', 'remote-action', 'call1'), point('a-call-2', 'A', 'remote-action', 'call2'),
    point('b-action-1', 'B', 'local-action', 'point1'), point('b-action-2', 'B', 'local-action', 'point2'),
    point('c-action', 'C', 'local-action', 'point'),
    // Events travel from the target's local event to the owner's remote subscription.
    point('a-event', 'A', 'remote-event', 'subscribe'), point('c-event', 'C', 'local-event', 'changed'),
    point('b-event', 'B', 'local-event', 'changed')
  ],
  bindings: [
    binding('call-one', 'A', 'actions', 'a-call-1', 'b-action-1', 'B'),
    binding('call-two', 'A', 'actions', 'a-call-2', 'b-action-2', 'B'),
    binding('subscribe-c', 'A', 'events', 'c-event', 'a-event', 'C'),
    binding('subscribe-b', 'A', 'events', 'b-event', 'a-event', 'B')
  ],
  discoveryEvidence: { status: 'success', source: 'test', value: ['A', 'B', 'C', 'isolated'] },
  completeness: { discovery: 'complete', schema: 'complete', assignments: 'complete' }
};
const filters = { query: '', showCandidates: true, showPlaceholders: true, showUnresolved: true, showAmbiguous: true } as const;

describe('topology workspace view projections', () => {
  it('keeps detailed connected nodes and exposes all isolated nodes in All Nodes mode', () => {
    const detailed = projectTopologyView(graph, new Map(), filters, { mode: 'detailed' });
    expect(detailed.visibleNodes.map(({ id }) => id)).toEqual(['A', 'B', 'C']);
    expect(detailed.projection.nodes.find(({ id }) => id === 'A')?.ports.map(({ id }) => id)).toContain('a-call-1');
    const all = projectTopologyView(graph, new Map(), filters, { mode: 'all-nodes' });
    expect(all.visibleNodes.map(({ id }) => id)).toContain('isolated');
    const discovery = projectTopologyView(graph, new Map(), { ...filters, query: 'not a node' }, {
      mode: 'all-nodes', memberNodeIds: new Set(['A'] as TopologyNodeId[])
    });
    expect(discovery.visibleNodes).toHaveLength(graph.nodes.length);
    expect(discovery.discoveryNodes).toEqual(graph.nodes);
    expect(discovery.discoveryBindings).toEqual(graph.bindings);
    const statusFiltered = projectTopologyView(graph, new Map(), { ...filters, statuses: [] }, { mode: 'all-nodes' });
    expect(statusFiltered.visibleNodes).toHaveLength(0);
  });

  it('aggregates only identical ordered endpoints, kind, and status while retaining owners and member aliases', () => {
    const view = projectTopologyView(graph, new Map(), filters, { mode: 'overview' });
    const action = view.projection.wires.find(wire => 'kind' in wire && wire.kind === 'actions');
    expect(action).toMatchObject({ kind: 'actions', count: 2, ownerIds: ['A'], memberBindingIds: ['call-one', 'call-two'] });
    expect(topologyViewBindingIds(view, action!.id)).toEqual(['call-one', 'call-two']);
    expect(topologyViewOwners(view, action!.id)).toEqual(['A']);
    const singletons = view.projection.wires.filter(wire => view.bindingIdsByWire.get(wire.id)?.length === 1 && !wire.id.startsWith('overview:'));
    expect(singletons.map(wire => wire.id)).toEqual(['subscribe-c', 'subscribe-b']);
    expect(singletons.map(wire => topologyViewBindingIds(view, wire.id))).toEqual([['subscribe-c'], ['subscribe-b']]);
    const eventEdges = view.projection.wires.filter(wire => 'kind' in wire && wire.kind === 'events');
    expect(eventEdges).toHaveLength(2);
    expect(eventEdges.map(wire => [wire.source.nodeId, wire.target.nodeId])).toEqual([['C', 'A'], ['B', 'A']]);

    const statusSplit: TopologyGraph = { ...graph, bindings: graph.bindings.map(row => row.id === 'call-two'
      ? { ...row, assignmentFreshness: 'stale' as const } : row) };
    const separated = projectTopologyView(statusSplit, new Map(), filters, { mode: 'overview' });
    expect(separated.projection.wires.filter(wire => 'kind' in wire && wire.kind === 'actions')).toHaveLength(2);
  });

  it('excludes hidden unresolved wires from focus neighbors', () => {
    const broken = binding('unresolved', 'A', 'actions', 'a-call-1', 'c-action', 'C', 'broken', 'endpoint-missing');
    const evidence = { ...graph, bindings: [...graph.bindings, broken] };
    const hidden = projectTopologyView(evidence, new Map(), { ...filters, showUnresolved: false }, {
      mode: 'focus', selectedNodeId: 'C' as TopologyNodeId, focusDirection: 'upstream', focusHops: 1
    });
    expect(hidden.visibleNodes.map(({ id }) => id)).toEqual(['C']);
    const visible = projectTopologyView(evidence, new Map(), filters, {
      mode: 'focus', selectedNodeId: 'C' as TopologyNodeId, focusDirection: 'upstream', focusHops: 1
    });
    expect(visible.visibleNodes.map(({ id }) => id)).toContain('C');
    expect(visible.visibleNodes.map(({ id }) => id)).toContain('A');
  });

  it('supports bounded upstream/downstream traversals, event direction, and membership-scoped reveal', () => {
    const all = projectTopologyView(graph, new Map(), filters, { mode: 'all-nodes' });
    expect([...topologyFocusMembership(graph, all.projection.wires, 'B' as TopologyNodeId, 'upstream', 1)]).toEqual(['B', 'A']);
    expect([...topologyFocusMembership(graph, all.projection.wires, 'A' as TopologyNodeId, 'downstream', 1)]).toEqual(['A', 'B']);
    // Event edge is C -> A: upstream from A includes C, not the subscriber as a false forward neighbor.
    expect([...topologyFocusMembership(graph, all.projection.wires, 'A' as TopologyNodeId, 'upstream', 1)]).toContain('C');
    const scoped = projectTopologyView(graph, new Map(), filters, {
      mode: 'focus', memberNodeIds: new Set(['A', 'B'] as TopologyNodeId[]), selectedNodeId: 'A' as TopologyNodeId,
      focusDirection: 'both', focusHops: 2
    });
    expect(scoped.visibleNodes.map(({ id }) => id)).toEqual(['A', 'B']);

    const hidden = projectTopologyView(graph, new Map(), { ...filters, statuses: [], showConnections: false }, {
      mode: 'focus', selectedNodeId: 'A' as TopologyNodeId, focusDirection: 'both', focusHops: 1
    }, new Set(), new Map(), { bindingId: 'call-one' as TopologyBinding['id'] });
    expect(hidden.visibleBindings.map(({ id }) => id)).toContain('call-one');
    expect(hidden.projection.wires.length).toBeGreaterThan(0);
  });

  it('renders compact labels only when counts are requested', () => {
    const compact = projectTopologyView(graph, new Map(), filters, { mode: 'compact' });
    expect(compact.projection.nodes.every(node => !node.title && !node.status && !node.summary && node.ports.every(port => !port.label))).toBe(true);
    expect(compact.projection.wires.every(wire => !('label' in wire))).toBe(true);
    const counted = projectTopologyView(graph, new Map(), filters, { mode: 'compact', showCompactCounts: true });
    expect(counted.projection.nodes.find(({ id }) => id === 'A')?.ports.some(port => port.label.length > 0)).toBe(true);
  });

  it('uses the explicit port reveal preference independently of Relationships mode', () => {
    const compactPorts = projectTopologyView(graph, new Map(), filters, { mode: 'detailed', portReveal: 'compact' });
    expect(compactPorts.projection.nodes.find(({ id }) => id === 'A')?.ports).toHaveLength(2);
    const expandedPorts = projectTopologyView(graph, new Map(), filters, { mode: 'compact', portReveal: 'expanded' });
    expect(expandedPorts.projection.nodes.find(({ id }) => id === 'A')?.ports.length).toBeGreaterThan(2);
  });
});
