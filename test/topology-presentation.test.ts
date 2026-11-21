import { describe, expect, it } from 'vitest';
import { clearTopologyLayout, defaultTopologyPosition, initialTopologyPositions, pruneTopologyLayoutPositions, readTopologyLayout, topologyLayoutStorageKey, topologyNodeHeight, topologyNodeSize, topologyPositionOverlaps, TOPOLOGY_NODE_BOUNDS, writeTopologyLayout } from '../src/features/topology/topology-layout';
import { presentTopology, summarizeTopology, topologyBindingExplanation, topologyEndpointDirection, topologyStatusCounts } from '../src/features/topology/topology-presentation';
import { reconstructTopology, type TopologyBinding, type TopologyEndpoint, type TopologyGraph, type TopologyNode, type TopologyNodeId, type TopologySnapshot } from '../src/features/topology/topology-model';

const nodeA = 'node:a' as TopologyNode['id'];
const nodeB = 'node:b' as TopologyNode['id'];
const endpointA = 'endpoint:a' as TopologyEndpoint['id'];
const endpointB = 'endpoint:b' as TopologyEndpoint['id'];
const endpointC = 'endpoint:c' as TopologyEndpoint['id'];
const binding = 'binding:a' as TopologyBinding['id'];
const nodes: TopologyNode[] = [
  { id: nodeA, name: 'Alpha', host: 'host-a', addresses: [], discovery: 'advertised', actionInventory: { status: 'success', source: 'test', value: [] }, eventInventory: { status: 'success', source: 'test', value: ['changed'] }, schemaEvidence: { status: 'success', source: 'test', value: { actions: ['go'], events: [] } }, assignmentEvidence: { status: 'success', source: 'test', value: { actions: {}, events: {} } } },
  { id: nodeB, name: 'Beta', addresses: [], discovery: 'advertised', actionInventory: { status: 'success', source: 'test', value: [] }, eventInventory: { status: 'success', source: 'test', value: [] }, schemaEvidence: { status: 'absent', source: 'test' }, assignmentEvidence: { status: 'absent', source: 'test' } },
  { id: 'node:placeholder' as TopologyNode['id'], name: 'Missing', addresses: [], discovery: 'placeholder', actionInventory: { status: 'absent', source: 'test' }, eventInventory: { status: 'absent', source: 'test' }, schemaEvidence: { status: 'absent', source: 'test' }, assignmentEvidence: { status: 'absent', source: 'test' } }
];
const endpoints: TopologyEndpoint[] = [
  { id: endpointA, nodeId: nodeA, kind: 'remote-action', name: 'go', evidence: 'declared' },
  { id: endpointB, nodeId: nodeA, kind: 'local-event', name: 'changed', evidence: 'declared' },
  { id: endpointC, nodeId: nodeB, kind: 'local-action', name: 'run', evidence: 'declared' }
];
const bindings: TopologyBinding[] = [{
  id: binding, ownerId: nodeA, kind: 'actions', alias: 'go', declared: 'yes', assignment: 'complete', assignmentRow: 'present', configuredNode: 'Beta', configuredEndpoint: 'run', targetNodeId: nodeB,
  sourceEndpointId: endpointA, targetEndpointId: endpointC, direction: 'source-to-target', referenceResolution: 'resolved'
}];
const graph: TopologyGraph = { nodes, endpoints, bindings, discoveryEvidence: { status: 'success', source: 'test', value: ['Alpha', 'Beta'] }, completeness: { discovery: 'complete', schema: 'complete', assignments: 'complete' } };

describe('topology presentation', () => {
  it('renders a complete owner assignment as an unresolved wire when target discovery or inventory is unknown', () => {
    const source: TopologySnapshot['nodes'][number] = {
      observationId: 'owner-route', name: 'Owner', addresses: [],
      actions: { status: 'absent', source: 'actions' }, events: { status: 'absent', source: 'events' },
      schema: { status: 'absent', source: 'schema' },
      assignments: { status: 'success', source: 'assignments', value: { actions: { Call: { node: 'Offline', action: 'Run' } }, events: {} } }
    };
    const reconstructed = reconstructTopology({ hostContext: 'test', discovery: { status: 'absent', source: 'discovery' }, nodes: [source] });
    const connection = presentTopology(reconstructed, new Map(), {
      query: '', showCandidates: true, showPlaceholders: true, showUnresolved: true
    }, 'connected');
    expect(reconstructed.bindings[0]).toMatchObject({ assignment: 'complete', referenceResolution: 'unknown' });
    expect(connection.projection.wires).toEqual([expect.objectContaining({ id: reconstructed.bindings[0]?.id, status: 'unresolved' })]);
    expect(connection.visibleNodes.some(({ discovery }) => discovery === 'placeholder')).toBe(true);
  });

  it.each([['actions', 'action'], ['events', 'event']] as const)('keeps a configured wire visible and explains disputed %s inventories', (kind, field) => {
    const owner: TopologySnapshot['nodes'][number] = {
      observationId: 'owner-route', name: 'Owner', addresses: [],
      actions: { status: 'absent', source: 'actions' }, events: { status: 'absent', source: 'events' },
      schema: { status: 'absent', source: 'schema' },
      assignments: { status: 'success', source: 'assignments', value: {
        actions: {}, events: {}, [kind]: { Alias: { node: 'Target', [field]: 'On' } }
      } }
    };
    const target = (observationId: string, inventory: string[]): TopologySnapshot['nodes'][number] => ({
      observationId, name: 'Target', addresses: [],
      actions: { status: 'absent', source: 'actions' }, events: { status: 'absent', source: 'events' },
      [kind]: { status: 'success', source: kind, value: inventory },
      schema: { status: 'absent', source: 'schema' }, assignments: { status: 'absent', source: 'assignments' }
    });
    const reconstructed = reconstructTopology({ hostContext: 'test', discovery: { status: 'absent', source: 'discovery' }, nodes: [owner, target('route-a', ['On']), target('route-b', [])] });
    const binding = reconstructed.bindings[0]!;
    expect(binding).toMatchObject({ referenceResolution: 'ambiguous', ambiguity: 'routes' });
    const connection = presentTopology(reconstructed, new Map(), {
      query: '', showCandidates: true, showPlaceholders: true, showUnresolved: true, showAmbiguous: true
    }, 'connected');
    expect(connection.projection.wires).toEqual([expect.objectContaining({ id: binding.id, status: 'unresolved',
      label: expect.stringContaining(`routes disagree on ${field} inventory`) })]);
    expect(topologyBindingExplanation(binding)).toContain(`Routes for node “Target” disagree about its ${field} inventory`);
    expect(topologyBindingExplanation({ ...binding, assignmentFreshness: 'cached' })).toContain('Routes for node');
    expect(topologyBindingExplanation(binding)).not.toMatch(/multiple/i);
  });

  it('does not draw a failed owner row whose retained configuration is itself conflicting', () => {
    const owner: TopologySnapshot['nodes'][number] = {
      observationId: 'owner-route', name: 'Owner', addresses: [],
      actions: { status: 'absent', source: 'actions' }, events: { status: 'absent', source: 'events' },
      schema: { status: 'absent', source: 'schema' },
      assignments: { status: 'failure', source: 'assignments', value: {
        actions: { Call: { node: 'Target', action: 'Run', event: 'WrongKind' } }, events: {}
      } }
    };
    const graph = reconstructTopology({ hostContext: 'test', discovery: { status: 'absent', source: 'discovery' }, nodes: [owner] });
    expect(graph.bindings[0]).toMatchObject({ assignment: 'conflicting', assignmentFreshness: 'stale' });
    expect(topologyBindingExplanation(graph.bindings[0]!)).toContain('last-known assignment is conflicting. No connection is shown.');
    const result = presentTopology(graph, new Map(), {
      query: '', showCandidates: true, showPlaceholders: true, showUnresolved: true, showAmbiguous: true
    }, 'connected');
    expect(result.projection.wires).toEqual([]);
  });

  it.each(['absent', 'failure'] as const)('keeps declared aliases inspectable without drawing wires from %s owner evidence', (status) => {
    const graph = reconstructTopology({
      hostContext: 'test', discovery: { status: 'absent', source: 'discovery' }, nodes: [{
        observationId: 'owner', name: 'Owner', addresses: [],
        actions: { status: 'absent', source: 'actions' }, events: { status: 'absent', source: 'events' },
        schema: { status: 'success', source: 'schema', value: { actions: ['Call'], events: ['Listen'] } },
        assignments: { status, source: 'assignments' }
      }]
    });
    const result = presentTopology(graph, new Map(), { query: '', showCandidates: true, showPlaceholders: true }, 'connected');
    expect(result.visibleBindings).toHaveLength(2);
    for (const row of result.visibleBindings) {
      expect(row).toMatchObject({ assignment: 'unknown', assignmentRow: 'unknown', assignmentFreshness: 'unknown' });
      expect(topologyBindingExplanation(row)).toBe('The owner assignment is unavailable or has not been read. No configured connection can be shown.');
    }
    expect(result.projection.wires).toEqual([]);
  });

  it('requires known freshness and nonblank terminals before drawing a complete-looking row', () => {
    for (const override of [{ assignmentFreshness: 'unknown' }, { configuredEndpoint: '   ' }] as const) {
      const evidence = { ...graph, bindings: [{ ...bindings[0]!, ...override }] };
      const result = presentTopology(evidence, new Map(), { query: '', showCandidates: true, showPlaceholders: true }, 'connected');
      expect(result.visibleBindings).toHaveLength(1);
      expect(result.projection.wires).toEqual([]);
    }
  });

  it('filters by node and binding text, toggles candidates/placeholders and reveals endpoint sets', () => {
    const compact = presentTopology(graph, new Map(), { query: 'go', showCandidates: false, showPlaceholders: false }, 'compact');
    expect(compact.visibleNodes.map((node) => node.id)).toEqual([nodeA, nodeB]);
    expect(compact.visibleBindings).toHaveLength(1);
    expect(compact.projection.nodes[0]?.ports.map((port) => port.label)).toContain('Outputs (2)');
    expect(compact.projection.wires).toHaveLength(1); // Search keeps a connected peer in view.

    const connected = presentTopology(graph, new Map(), { query: '', showCandidates: false, showPlaceholders: false }, 'connected');
    expect(connected.projection.nodes.find((node) => node.id === nodeA)?.ports.map((port) => port.id)).toEqual([endpointA]);
    expect(connected.projection.wires).toHaveLength(1);
    const compactGraph = presentTopology(graph, new Map(), { query: '', showCandidates: false, showPlaceholders: false }, 'compact');
    expect(compactGraph.projection.nodes.find((node) => node.id === nodeA)?.ports.map((port) => port.label)).toEqual(['Inputs (0)', 'Outputs (2)']);
    expect(compactGraph.projection.wires[0]?.label).toContain('Action call');
    const expanded = presentTopology(graph, new Map(), { query: '', showCandidates: false, showPlaceholders: true }, 'expanded', new Set([endpointB]));
    expect(expanded.visibleNodes).toHaveLength(3);
    expect(expanded.projection.nodes.find((node) => node.id === nodeA)?.ports).toHaveLength(2);
  });

  it('summarizes coverage, stale snapshots, and bounded diagnostic detail', () => {
    const summary = summarizeTopology({
      phase: 'idle', coverage: 'partial', progress: { completed: 4, total: 4 },
      diagnostics: [{ source: 'events', nodeName: 'Alpha', message: 'Could not read events.' }], diagnosticsOmitted: 2,
      stale: true, lastSuccessAt: 1_700_000_000_000
    }, 3, 2);
    expect(summary.tone).toBe('warning');
    expect(summary.heading).toContain('incomplete');
    expect(summary.detail).toContain('Alpha: Could not read events.');
    expect(summary.detail).toContain('2 additional diagnostics omitted.');
    expect(summary.detail).toContain('3 nodes and 2 bindings.');
  });

  it('labels unreadable and partially known counts without counting inferred or missing terminals', () => {
    const evidence = {
      ...graph,
      nodes: [
        { ...nodes[0]!, eventInventory: { status: 'failure' as const, source: 'events', value: ['changed'] } },
        nodes[1]!, nodes[2]!,
        { ...nodes[1]!, id: 'node:empty' as TopologyNode['id'], assignmentEvidence: nodes[0]!.assignmentEvidence,
          schemaEvidence: { status: 'success' as const, source: 'schema', value: { actions: [], events: [] } } }
      ]
    };
    const compact = presentTopology(evidence, new Map(), { query: '', showCandidates: true, showPlaceholders: true }, 'compact');
    expect(compact.projection.nodes.map(({ summary, ports }) => [summary, ...ports.map(({ label }) => label)])).toEqual([
      ['1 binding • 2 known endpoints', 'Inputs (0)', 'Outputs (2 known)'],
      ['Bindings unknown • Endpoints unknown', 'Inputs (unknown)', 'Outputs (unknown)'],
      ['Bindings unknown • Endpoints unknown', 'Inputs (unknown)', 'Outputs (unknown)'],
      ['0 bindings • 0 endpoints', 'Inputs (0)', 'Outputs (0)']
    ]);
  });

  it('maps local and remote action/event endpoints to their actual graph sides', () => {
    expect(topologyEndpointDirection({ ...endpoints[0]!, kind: 'local-action' })).toBe('input');
    expect(topologyEndpointDirection({ ...endpoints[1]!, kind: 'local-event' })).toBe('output');
    expect(topologyEndpointDirection({ ...endpoints[0]!, kind: 'remote-action' })).toBe('output');
    expect(topologyEndpointDirection({ ...endpoints[1]!, kind: 'remote-event' })).toBe('input');
  });

  it('keeps wire and label visibility independent from endpoint reveal and exposes overlapping evidence facets', () => {
    const hidden = presentTopology(graph, new Map(), {
      query: '', showCandidates: true, showPlaceholders: true, showConnections: false, showLabels: false
    }, 'connected');
    expect(hidden.projection.wires).toEqual([]);
    expect(hidden.connectedEndpointIds).toEqual(new Set([endpointA, endpointC]));
    expect(hidden.projection.nodes.find((node) => node.id === nodeA)?.ports.map((port) => port.id)).toContain(endpointA);
    const noLabels = presentTopology(graph, new Map(), {
      query: '', showCandidates: true, showPlaceholders: true, showLabels: false
    }, 'compact');
    expect(noLabels.projection.wires[0]).not.toHaveProperty('label');
    const staleGraph = { ...graph, nodes: [{ ...nodes[0]!, actionInventory: { status: 'failure' as const, source: 'test', value: ['old'] } }, ...nodes.slice(1)] };
    expect(topologyStatusCounts(staleGraph, new Map([[nodeA, { readability: 'partial', stale: true }]]))).toEqual({
      discovered: 2, partial: 3, stale: 1, unresolved: 1
    });
    const partial = presentTopology(graph, new Map(), {
      query: '', showCandidates: true, showPlaceholders: false, statuses: ['partial']
    }, 'connected');
    expect(partial.visibleNodes.map(({ id }) => id)).toEqual([nodeB]);
    const noStatuses = presentTopology(graph, new Map(), {
      query: '', showCandidates: true, showPlaceholders: true, statuses: []
    }, 'connected');
    expect(noStatuses.visibleNodes).toEqual([]);
    const defaultStatuses = presentTopology(graph, new Map(), {
      query: '', showCandidates: true, showPlaceholders: true
    }, 'connected');
    expect(defaultStatuses.visibleNodes).toHaveLength(graph.nodes.length);
  });

  it('hides unresolved sibling terminals when unresolved wires are filtered but preserves terminals when all wires are hidden', () => {
    const missingSource: TopologyEndpoint = { id: 'endpoint:missing-source' as TopologyEndpoint['id'], nodeId: nodeA, kind: 'remote-action', name: 'missing-call', evidence: 'declared' };
    const missingTarget: TopologyEndpoint = { id: 'endpoint:missing-target' as TopologyEndpoint['id'], nodeId: nodeB, kind: 'local-action', name: 'gone', evidence: 'missing' };
    const missingBinding: TopologyBinding = {
      ...bindings[0]!, id: 'binding:missing-sibling' as TopologyBinding['id'], alias: 'missing-call',
      sourceEndpointId: missingSource.id, targetEndpointId: missingTarget.id, configuredEndpoint: 'gone',
      referenceResolution: 'endpoint-missing'
    };
    const evidence = { ...graph, endpoints: [...endpoints, missingSource, missingTarget], bindings: [...bindings, missingBinding] };
    const unresolvedHidden = presentTopology(evidence, new Map(), {
      query: '', showCandidates: true, showPlaceholders: true, showUnresolved: false
    }, 'connected');
    expect(unresolvedHidden.projection.wires.map(({ id }) => id)).toEqual([binding]);
    expect(unresolvedHidden.projection.nodes.find(({ id }) => id === nodeA)?.ports.map(({ id }) => id)).toEqual([endpointA]);
    expect(unresolvedHidden.projection.nodes.find(({ id }) => id === nodeB)?.ports.map(({ id }) => id)).toEqual([endpointC]);

    const allWiresHidden = presentTopology(evidence, new Map(), {
      query: '', showCandidates: true, showPlaceholders: true, showUnresolved: false, showConnections: false
    }, 'connected');
    expect(allWiresHidden.projection.wires).toEqual([]);
    expect(allWiresHidden.projection.nodes.find(({ id }) => id === nodeA)?.ports.map(({ id }) => id)).toEqual([endpointA]);
    expect(allWiresHidden.connectedEndpointIds).toEqual(new Set([endpointA, endpointC]));
  });

  it('keeps every revealed endpoint named and assigned to its semantic socket side, with height for dense nodes', () => {
    const many: TopologyEndpoint[] = Array.from({ length: 24 }, (_, index) => ({
      id: `endpoint:dense:${index}` as TopologyEndpoint['id'], nodeId: nodeA,
      kind: index % 2 ? 'local-event' : 'local-action', name: `endpoint ${index}`, evidence: 'declared'
    }));
    const result = presentTopology({ ...graph, endpoints: [...endpoints, ...many] }, new Map(),
      { query: '', showCandidates: true, showPlaceholders: true }, 'expanded', new Set(many.map((endpoint) => endpoint.id)));
    const dense = result.projection.nodes.find((node) => node.id === nodeA)!;
    expect(dense.ports).toHaveLength(many.length + 1);
    expect(dense.ports.find((port) => port.id === many[0]!.id)).toMatchObject({ label: 'endpoint 0', direction: 'input' });
    expect(dense.ports.find((port) => port.id === many[1]!.id)).toMatchObject({ label: 'endpoint 1', direction: 'output' });
    expect(dense.height).toBe(topologyNodeHeight(13));
    expect(dense.height).toBeGreaterThan(350);
    expect(topologyNodeSize(13)).toEqual({ width: 248, height: dense.height });
  });

  it('omits speculative assignment wires and explains dashed missing-target evidence', () => {
    const completeBinding = bindings[0]!;
    const makeIncomplete = (id: string, assignment: TopologyBinding['assignment'], row: TopologyBinding['assignmentRow']) => {
      const result: TopologyBinding = { ...completeBinding, id: id as TopologyBinding['id'], assignment, assignmentRow: row };
      delete result.targetEndpointId;
      delete result.configuredEndpoint;
      return result;
    };
    const missingId = 'endpoint:missing' as TopologyEndpoint['id'];
    const missingEventId = 'endpoint:missing-event' as TopologyEndpoint['id'];
    const remoteEventId = 'endpoint:remote-event' as TopologyEndpoint['id'];
    const missingTarget: TopologyBinding = {
      ...completeBinding,
      id: 'binding:missing-target' as TopologyBinding['id'],
      configuredEndpoint: 'notThere',
      targetEndpointId: missingId,
      referenceResolution: 'endpoint-missing'
    };
    const missingEventTarget: TopologyBinding = {
      ...completeBinding,
      id: 'binding:missing-event' as TopologyBinding['id'],
      kind: 'events',
      alias: 'subscribeState',
      sourceEndpointId: missingEventId,
      targetEndpointId: remoteEventId,
      configuredNode: 'Beta',
      configuredEndpoint: 'changed',
      referenceResolution: 'endpoint-missing'
    };
    const incompleteBindings = [
      makeIncomplete('binding:unbound', 'unbound', 'absent'),
      makeIncomplete('binding:partial', 'partial', 'present'),
      makeIncomplete('binding:conflicting', 'conflicting', 'present'),
      missingTarget,
      missingEventTarget
    ];
    const incompleteGraph: TopologyGraph = {
      ...graph,
      endpoints: [
        ...endpoints,
        { id: missingId, nodeId: nodeB, kind: 'local-action', name: 'notThere', evidence: 'missing' },
        { id: missingEventId, nodeId: nodeB, kind: 'local-event', name: 'changed', evidence: 'missing' },
        { id: remoteEventId, nodeId: nodeA, kind: 'remote-event', name: 'subscribeState', evidence: 'inferred' },
      ],
      bindings: incompleteBindings
    };
    const result = presentTopology(incompleteGraph, new Map(), { query: '', showCandidates: true, showPlaceholders: true }, 'connected');
    expect(result.projection.wires).toHaveLength(2);
    expect(result.projection.wires[0]?.id).toBe(missingTarget.id);
    expect(result.projection.wires[0]?.status).toBe('unresolved');
    expect(result.projection.wires[0]?.label).toContain('target action “notThere” missing on node “Beta”');
    expect(result.projection.wires[1]?.label).toContain('target event “changed” missing on node “Beta”');
    const hiddenUnresolved = presentTopology(incompleteGraph, new Map(), {
      query: '', showCandidates: true, showPlaceholders: true, showUnresolved: false
    }, 'connected');
    expect(hiddenUnresolved.projection.wires).toHaveLength(0);
    expect(topologyBindingExplanation(missingTarget)).toContain('target of alias “go”');
    expect(topologyBindingExplanation(missingEventTarget)).toContain('target of subscription “subscribeState”');
    const ambiguous: TopologyBinding = { ...completeBinding, configuredNode: 'Twins', referenceResolution: 'ambiguous' };
    expect(topologyBindingExplanation(ambiguous)).toContain('Multiple discovered nodes');
    const endpointAmbiguous = { ...ambiguous, configuredNode: 'Beta', ambiguity: 'endpoint' as const };
    expect(topologyBindingExplanation(endpointAmbiguous)).toContain('Multiple action endpoints on node “Beta”');
    expect(topologyBindingExplanation(incompleteBindings[0]!)).toContain('no configured assignment');
    expect(topologyBindingExplanation(incompleteBindings[1]!)).toContain('only part');
    expect(topologyBindingExplanation(incompleteBindings[2]!)).toContain('Conflicting');
  });

  it('scopes a reveal to one evidenced binding without overriding filters for unrelated missing references', () => {
    const owner = { ...nodes[0]!, id: 'node:scope-owner' as TopologyNode['id'] };
    const candidateA = { ...nodes[1]!, id: 'node:candidate-a' as TopologyNode['id'] };
    const candidateB = { ...nodes[1]!, id: 'node:candidate-b' as TopologyNode['id'] };
    const source = { ...endpoints[0]!, id: 'endpoint:scope-source' as TopologyEndpoint['id'], nodeId: owner.id };
    const target = { ...endpoints[2]!, id: 'endpoint:scope-target' as TopologyEndpoint['id'], nodeId: candidateA.id };
    const selected: TopologyBinding = { ...bindings[0]!, id: 'binding:selected' as TopologyBinding['id'], ownerId: owner.id,
      targetNodeId: candidateA.id, sourceEndpointId: source.id, targetEndpointId: target.id,
      configuredNode: candidateA.name, configuredEndpoint: target.name, referenceResolution: 'ambiguous' };
    const unrelated: TopologyBinding[] = ['missing-one', 'missing-two', 'ambiguous-one', 'ambiguous-two'].map((name, index) => {
      const row: TopologyBinding = { ...selected, id: `binding:${name}` as TopologyBinding['id'], alias: name,
        referenceResolution: index < 2 ? 'not-discovered' : 'ambiguous' };
      if (index < 2) delete row.targetNodeId;
      else row.targetNodeId = candidateB.id;
      return row;
    });
    const evidence: TopologyGraph = { ...graph, nodes: [owner, candidateA, candidateB], endpoints: [source, target], bindings: [selected, ...unrelated] };
    const hidden = presentTopology(evidence, new Map(), {
      query: '', showCandidates: false, showPlaceholders: false, statuses: [], showConnections: false,
      showUnresolved: false, showAmbiguous: false
    }, 'connected');
    expect(hidden.projection.nodes).toEqual([]);
    expect(hidden.projection.wires).toEqual([]);

    const revealed = presentTopology(evidence, new Map(), {
      query: '', showCandidates: false, showPlaceholders: false, statuses: [], showConnections: false,
      showUnresolved: false, showAmbiguous: false
    }, 'connected', new Set(), new Map(), { bindingId: selected.id });
    expect(revealed.projection.nodes.map(({ id }) => id)).toEqual([owner.id, candidateA.id]);
    expect(revealed.projection.nodes.map(({ ports }) => ports.map(({ id }) => id))).toEqual([[source.id], [target.id]]);
    expect(revealed.projection.wires.map(({ id }) => id)).toEqual([selected.id]);
    expect(revealed.visibleBindings.map(({ id }) => id)).toEqual([selected.id]);
  });

  it.each([
    { resolution: 'endpoint-missing', receiverActions: [], reason: 'target action “Run” missing on node “Beta”' },
    { resolution: 'resolved', receiverActions: ['Run'], reason: '' }
  ])('keeps owner assignment freshness separate from $resolution target validation', ({ resolution, receiverActions, reason }) => {
    const owner: TopologySnapshot['nodes'][number] = {
      observationId: 'alpha', name: 'Alpha', addresses: [], actions: nodes[0]!.actionInventory,
      events: nodes[0]!.eventInventory, schema: nodes[0]!.schemaEvidence,
      assignments: { status: 'success', source: 'assignments', value: { actions: { go: { node: 'Beta', action: 'Run' } }, events: {} } }
    };
    const receiver: TopologySnapshot['nodes'][number] = {
      ...owner, observationId: 'beta', name: 'Beta', actions: { status: 'success', source: 'actions', value: receiverActions },
      schema: nodes[1]!.schemaEvidence, assignments: nodes[0]!.assignmentEvidence
    };
    const snapshot: TopologySnapshot = {
      hostContext: 'test', discovery: { status: 'success', source: 'discovery', value: ['Alpha', 'Beta'] }, nodes: [owner, receiver]
    };
    const project = (value: TopologyGraph) => presentTopology(value, new Map(), { query: '', showCandidates: true, showPlaceholders: true }, 'connected').projection.wires;
    const initial = reconstructTopology(snapshot);
    expect(initial.bindings[0]?.referenceResolution).toBe(resolution);
    const originalWire = project(initial)[0]!;
    const stale = reconstructTopology({ ...snapshot, nodes: [{ ...owner, assignments: { ...owner.assignments, status: 'failure' as const } }, receiver] });
    const cached = reconstructTopology({ ...snapshot, nodes: [{ ...owner, assignments: { ...owner.assignments, cached: true } }, receiver] });
    for (const [observed, freshness] of [[stale, 'stale'], [cached, 'cached']] as const) {
      const row = observed.bindings[0]!;
      expect(row).toMatchObject({ referenceResolution: resolution, assignmentFreshness: freshness });
      const wires = project(observed);
      expect(wires).toEqual([expect.objectContaining({ id: originalWire.id, source: originalWire.source, target: originalWire.target, status: freshness === 'stale' ? 'stale' : 'pending' })]);
      expect(topologyBindingExplanation(row)).toContain(freshness === 'stale' ? 'owner assignment read failed' : 'cached owner assignment');
      if (reason) expect(wires[0]?.label).toContain(reason);
    }
  });
});

describe('topology layout persistence', () => {
  const storageMap = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); }
    };
  };

  it('persists finite positions and viewport per host context and clears them', () => {
    const storage = storageMap();
    const positions = new Map([['node:a' as TopologyNode['id'], { x: 12, y: 34 }]]);
    expect(writeTopologyLayout('https://host.example', { positions, viewport: { x: 4, y: 5, scale: 1.25 } }, storage)).toBe(true);
    expect(storage.getItem(topologyLayoutStorageKey('https://elsewhere.example'))).toBeNull();
    const read = readTopologyLayout('https://host.example', storage);
    expect(read.positions.get('node:a' as TopologyNode['id'])).toEqual({ x: 12, y: 34 });
    expect(read.viewport).toEqual({ x: 4, y: 5, scale: 1.25 });
    clearTopologyLayout('https://host.example', storage);
    expect(readTopologyLayout('https://host.example', storage).positions.size).toBe(0);
  });

  it('rejects malformed persisted coordinates and unavailable storage safely', () => {
    const storage = storageMap();
    storage.setItem(topologyLayoutStorageKey('x'), JSON.stringify({ positions: { safe: { x: 4, y: 5 }, invalid: { x: Infinity, y: 0 } }, viewport: { x: 0, y: 0, scale: 10 } }));
    expect(readTopologyLayout('x', storage).positions.size).toBe(1);
    expect(readTopologyLayout('x', storage).viewport).toBeUndefined();
    expect(readTopologyLayout('x', { getItem: () => { throw new Error('denied'); } }).positions.size).toBe(0);
  });

  it('round-trips common long identities and bounds the 2048-position layout', () => {
    const storage = storageMap();
    const ids = Array.from({ length: 451 }, (_, index) => `${String(index).padStart(4, '0')}:${'identity'.repeat(5)}` as TopologyNodeId);
    const positions = new Map(ids.map((id, index) => [id, { x: index, y: index * 2 }] as const));
    const automatic = new Set(ids.slice(1));
    expect(writeTopologyLayout('large', { positions, autoPositionedNodeIds: automatic, pinnedNodeIds: new Set(ids), viewport: { x: 10, y: 20, scale: 1.2 }, workspaceMode: 'custom', omittedNodeIds: new Set([ids[0]!]) }, storage)).toBe(true);
    const raw = storage.getItem(topologyLayoutStorageKey('large'))!;
    expect(raw.length).toBeLessThanOrEqual(190_000);
    const read = readTopologyLayout('large', storage);
    expect(read.positions.size).toBe(451);
    expect(read.autoPositionedNodeIds?.size).toBe(450);
    expect(read.pinnedNodeIds).toEqual(new Set(ids));
    expect(read.omittedNodeIds).toEqual(new Set([ids[0]! ]));
    expect(read.viewport).toEqual({ x: 10, y: 20, scale: 1.2 });
    expect(read.workspaceMode).toBe('custom');
  });

  it('keeps manual state before automatic positions when the storage budget is tight', () => {
    const storage = storageMap();
    const ids = Array.from({ length: 2048 }, (_, index) => `${String(index).padStart(4, '0')}:${'long-node-identity-'.repeat(2)}` as TopologyNodeId);
    const positions = new Map(ids.map((id, index) => [id, { x: index, y: index }] as const));
    const automatic = new Set(ids);
    automatic.delete(ids[0]!);
    const layout = { positions, autoPositionedNodeIds: automatic, pinnedNodeIds: new Set([ids[0]!]), omittedNodeIds: new Set([ids[1]!]), viewport: { x: 3, y: 4, scale: 1 }, workspaceMode: 'all' as const };
    expect(writeTopologyLayout('tight', layout, storage)).toBe(true);
    const read = readTopologyLayout('tight', storage);
    expect(read.positions.get(ids[0]!)).toEqual({ x: 0, y: 0 });
    expect(read.pinnedNodeIds).toEqual(new Set([ids[0]! ]));
    expect(read.omittedNodeIds).toEqual(new Set([ids[1]! ]));
    expect(read.viewport).toEqual(layout.viewport);
    expect(read.workspaceMode).toBe('all');
    expect(read.positions.size).toBeLessThan(2048);
  });

  it('refuses to report success when protected state cannot fit the reader limit', () => {
    const storage = storageMap();
    const ids = Array.from({ length: 2048 }, (_, index) => `${index}:${'x'.repeat(90)}` as TopologyNodeId);
    expect(writeTopologyLayout('too-large', { positions: new Map(), pinnedNodeIds: new Set(ids), omittedNodeIds: new Set(ids) }, storage)).toBe(false);
    expect(storage.getItem(topologyLayoutStorageKey('too-large'))).toBeNull();
  });

  it('prunes positions for identities removed by a complete discovery generation', () => {
    const positions = new Map([
      [nodeA, { x: 25, y: 30 }],
      [nodeB, { x: 90, y: 125 }],
      ['node:churned' as TopologyNode['id'], { x: 140, y: 170 }]
    ]);
    const pruned = pruneTopologyLayoutPositions(positions, new Set([nodeA, nodeB]));
    expect([...pruned.keys()]).toEqual([nodeA, nodeB]);
    expect(pruned.get(nodeA)).toEqual({ x: 25, y: 30 });
    expect(positions.size).toBe(3); // Pruning returns an independent map.
  });

  it('places new blocks using their actual canvas bounds rather than undersized collision estimates', () => {
    const first = defaultTopologyPosition(0);
    expect(TOPOLOGY_NODE_BOUNDS).toEqual({ width: 248, height: 160 });
    expect(topologyPositionOverlaps({ x: first.x + 120, y: first.y + 20 }, [first])).toBe(true);
    expect(topologyPositionOverlaps({ x: first.x + 272, y: first.y + 20 }, [first])).toBe(false);
    expect(topologyPositionOverlaps(defaultTopologyPosition(1), [first])).toBe(false);
    const tallProjection = { point: first, height: 500 };
    expect(topologyPositionOverlaps({ x: first.x, y: first.y + 200 }, [tallProjection], 24, 120)).toBe(true);
    expect(topologyPositionOverlaps({ x: first.x, y: first.y + 530 }, [tallProjection], 24, 120)).toBe(false);
  });

  it('lays connected groups first deterministically, keeps manual positions, and appends isolated nodes', () => {
    const projectedNodes = [nodeA, nodeB, 'node:isolated' as TopologyNodeId].map((id) => ({ id, height: 160 }));
    const positions = initialTopologyPositions(projectedNodes, [{ source: { nodeId: nodeA, portId: 'a' }, target: { nodeId: nodeB, portId: 'b' } }]);
    expect(positions.get(nodeA)).toBeDefined();
    expect(positions.get(nodeB)).toBeDefined();
    expect(positions.get('node:isolated' as TopologyNodeId)!.y).toBeGreaterThan(positions.get(nodeB)!.y);
    const reordered = initialTopologyPositions([...projectedNodes].reverse(), [{ source: { nodeId: nodeA, portId: 'a' }, target: { nodeId: nodeB, portId: 'b' } }]);
    expect([...positions]).toEqual([...reordered]);
    const handPlaced = new Map([[nodeA, { x: 400, y: 600 }]]);
    const refreshed = initialTopologyPositions(projectedNodes, [{ source: { nodeId: nodeA, portId: 'a' }, target: { nodeId: nodeB, portId: 'b' } }], handPlaced);
    expect(refreshed.get(nodeA)).toEqual({ x: 400, y: 600 });
    expect(refreshed.get(nodeB)!.x).toBeGreaterThan(400);
  });
});
