// @vitest-environment node

import {
  javaNodeNameEquals,
  javaSimpleNameKey,
  reconstructTopology,
  topologyBindingId,
  topologyEndpointId,
  topologyNodeId
} from '../src/features/topology/topology-model';
import type { TopologyAssignments, TopologyEvidence, TopologyNodeSnapshot, TopologySnapshot } from '../src/features/topology/topology-model';
import javaApi from './fixtures/java-nodel-api.json';

const absent = <T>(source: string): TopologyEvidence<T> => ({ status: 'absent', source });
const success = <T>(source: string, value: T): TopologyEvidence<T> => ({ status: 'success', source, value, lastSuccessAt: 100 });

function observation(observationId: string, name: string, overrides: Partial<TopologyNodeSnapshot> = {}): TopologyNodeSnapshot {
  return {
    observationId,
    name,
    addresses: [],
    actions: absent('local-actions'),
    events: absent('local-events'),
    schema: absent('binding-schema'),
    assignments: absent('binding-values'),
    ...overrides
  };
}

function snapshot(nodes: TopologyNodeSnapshot[], discovery: TopologySnapshot['discovery'] = success('discovery', nodes.map((node) => node.name ?? ''))): TopologySnapshot {
  return { hostContext: 'installation-a', discovery, nodes };
}

describe('topology model identity', () => {
  const address = (hostname: string) => ({ canonicalAddress: `http://${hostname}/`, displayAddress: hostname, source: 'discovery' });

  it('uses the shared Java key for nodes, aliases and endpoints without conflating empty keys', () => {
    expect(javaSimpleNameKey('Δ')).toBe('dj');
    expect(javaNodeNameEquals('Café (Rack A)', 'Cafe')).toBe(true);
    const node = topologyNodeId('host', 'Café (Rack A)');
    expect(node).toBe(topologyNodeId('host', 'CAFE'));
    expect(node).not.toBe(topologyNodeId('other host', 'CAFE'));
    expect(topologyBindingId(node, 'actions', 'Power-On')).toBe(topologyBindingId(node, 'actions', 'power on'));
    expect(topologyBindingId(node, 'actions', 'Power-On')).not.toBe(topologyBindingId(node, 'events', 'power on'));
    expect(topologyEndpointId(node, 'local-action', 'Power-On')).toBe(topologyEndpointId(node, 'local-action', 'power on'));
    expect(topologyEndpointId(node, 'local-action', 'Power-On')).not.toBe(topologyEndpointId(node, 'remote-action', 'power on'));
    expect(topologyNodeId('host', '(first)')).not.toBe(topologyNodeId('host', '(second)'));
  });

  it('groups ordered route evidence without composing disjoint unverified responses', () => {
    const one = observation('a', 'Living Room', { addresses: [address('one')], actions: success('actions', ['On']) });
    const two = observation('b', 'livingroom', { addresses: [address('two'), address('one')], events: success('events', ['State']) });
    const graph = reconstructTopology(snapshot([one, two, one]));
    expect(graph).toEqual(reconstructTopology(snapshot([two, one, one])));
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]).toMatchObject({ id: topologyNodeId('installation-a', 'LivingRoom'),
      duplicate: { routeCount: 2, names: ['Living Room', 'livingroom'] }, actionInventory: { value: ['On'] }, eventInventory: { status: 'absent' } });
    expect(graph.nodes[0]?.addresses).toEqual([address('one'), address('two')]);
    expect(graph.endpoints.map(({ name }) => name)).toEqual(['On']);
  });

  it('uses only the selected route administration link and suppresses it when route evidence conflicts', () => {
    const route = (observationId: string, action: string) => observation(observationId, 'Projector', {
      addresses: [{ canonicalAddress: `https://${observationId}/`, displayAddress: observationId,
        adminHref: `https://${observationId}/admin`, source: 'discovery' }],
      actions: success('actions', [action])
    });
    const selected = reconstructTopology(snapshot([route('route-a', 'On'), route('route-b', 'On')])).nodes[0]!;
    expect(selected).toMatchObject({ evidenceRouteId: 'route-a', adminHref: 'https://route-a/admin' });
    const disputed = reconstructTopology(snapshot([route('route-a', 'On'), route('route-b', 'Off')])).nodes[0]!;
    expect(disputed.conflicts).toContain('actions');
    expect(disputed.adminHref).toBeUndefined();
  });

  it.each(['responses', 'identities'] as const)('suppresses contradictory %s without suppressing independent incoming assignments', (conflict) => {
    const incoming = observation('incoming', 'Sender', {
      assignments: success('assignments', { actions: { Start: { node: 'duplicate', action: 'Run' } }, events: {} })
    });
    const duplicate = (id: string, target: string, listing: string[]) => observation(id, 'Duplicate', {
      addresses: [address(id)],
      ...(conflict === 'identities' ? { verifiedIdentity: { hostId: id, nodeId: 'node' } } : {}),
      actions: success('actions', listing), events: success('events', ['State']),
      schema: success('schema', { actions: ['Outgoing'], events: [] }),
      assignments: success('assignments', { actions: { Outgoing: { node: target, action: 'On' } }, events: {} })
    });
    const a = duplicate('route-a', 'A', ['Run']);
    const b = duplicate('route-b', conflict === 'identities' ? 'A' : 'B', conflict === 'identities' ? ['Run'] : ['Other']);
    const graph = reconstructTopology(snapshot([incoming, a, b]));
    for (const permuted of [[incoming, b, a], [b, a, incoming], [a, incoming, b]]) {
      expect(reconstructTopology(snapshot(permuted))).toEqual(graph);
    }
    const block = graph.nodes.find(({ name }) => name === 'Duplicate')!;
    expect(block).toMatchObject({ duplicate: { routeCount: 2 }, assignmentEvidence: { status: 'absent' }, actionInventory: { status: 'absent' } });
    expect(block.conflicts).toEqual(conflict === 'identities' ? ['identity'] : ['actions', 'assignments']);
    expect(block.assignmentEvidence.value).toBeUndefined();
    expect(block.actionInventory.value).toBeUndefined();
    const edges = graph.bindings.filter(({ sourceEndpointId, targetEndpointId }) => sourceEndpointId && targetEndpointId);
    expect(edges).toEqual([expect.objectContaining({ alias: 'Start', targetNodeId: block.id, assignment: 'complete',
      referenceResolution: 'ambiguous', ambiguity: conflict === 'identities' ? 'node' : 'routes' })]);
    expect(graph.nodes.some(({ discovery }) => discovery === 'placeholder')).toBe(false);
  });

  it('compares successful response contents independent of order and equivalent spelling, not timestamps', () => {
    const route = (id: string, names: string[], actions: TopologyAssignments['actions'], lastSuccessAt: number) => observation(id, 'Owner', {
      actions: success('actions', names), assignments: { ...success('assignments', { actions, events: {} }), lastSuccessAt }
    });
    const one = route('a', ['A', 'b'], { One: { node: 'Target', action: 'On' }, Two: {} }, 100);
    const two = route('b', ['B', 'a'], { TWO: {}, ONE: { action: 'On', node: 'Target (exhibit)' } }, 200);
    const agree = reconstructTopology(snapshot([one, two]));
    expect(agree.nodes.find(({ name }) => name === 'Owner')?.conflicts).toBeUndefined();
    expect(agree.bindings.filter(({ targetNodeId }) => targetNodeId)).toHaveLength(1);
    const emptied = route('b', ['B', 'a'], {}, 200);
    const disagree = reconstructTopology(snapshot([one, emptied]));
    expect(disagree.nodes[0]?.conflicts).toEqual(['assignments']);
    expect(disagree.bindings).toEqual([]);
  });

  it('keeps earlier disputed interfaces unusable even when a single route succeeds in a later cycle', () => {
    const sender = observation('sender', 'Sender', {
      assignments: success('assignments', { actions: { Incoming: { node: 'Owner', action: 'Run' } }, events: {} })
    });
    const owner = observation('one-route', 'Owner', {
      actions: success('actions', ['Run']),
      schema: success('schema', { actions: ['Outgoing'], events: [] }),
      assignments: success('assignments', { actions: { Outgoing: { node: 'Peer', action: 'Start' } }, events: {} })
    });
    const input = snapshot([sender, owner]);
    const ownerId = topologyNodeId(input.hostContext, 'Owner');
    const graph = reconstructTopology({ ...input, routeDisputes: new Map([[ownerId, ['assignments', 'actions']]]) });
    expect(graph.nodes.find(({ id }) => id === ownerId)).toMatchObject({
      conflicts: ['actions', 'assignments'], actionInventory: { status: 'absent' }, assignmentEvidence: { status: 'absent' }
    });
    expect(graph.bindings.find(({ alias }) => alias === 'Outgoing')).toMatchObject({
      assignment: 'conflicting', assignmentRow: 'unknown', assignmentFreshness: 'unknown'
    });
    expect(graph.bindings.find(({ alias }) => alias === 'Outgoing')?.targetEndpointId).toBeUndefined();
    expect(graph.bindings.find(({ alias }) => alias === 'Incoming')).toMatchObject({
      targetNodeId: ownerId, targetEndpointId: expect.any(String), referenceResolution: 'ambiguous', ambiguity: 'routes', assignmentFreshness: 'current'
    });
    expect(reconstructTopology(input).bindings.find(({ alias }) => alias === 'Outgoing')).toMatchObject({
      assignmentFreshness: 'current', targetEndpointId: expect.any(String)
    });
  });

  it('keeps deferred cached owner edges without mistaking cached replies for current disagreements', () => {
    const values = { actions: { Start: { node: 'Device', action: 'On' } }, events: {} };
    const cached = observation('old-route', 'Owner', { assignments: { ...success('assignments', values), cached: true } });
    const target = observation('device', 'Device', { actions: { ...success('actions', ['On']), cached: true } });
    const deferred = reconstructTopology(snapshot([cached, target]));
    expect(deferred.bindings[0]).toMatchObject({ assignment: 'complete', referenceResolution: 'resolved', targetEndpointId: expect.any(String) });
    expect(deferred.bindings[0]?.assignmentFreshness).toBe('cached');

    const finished = observation('new-route', 'OWNER', { assignments: success('assignments', { actions: {}, events: {} }) });
    const graph = reconstructTopology(snapshot([cached, target, finished]));
    expect(graph.nodes.find(({ id }) => id === topologyNodeId('installation-a', 'Owner'))).toMatchObject({
      evidenceRouteId: 'new-route', assignmentEvidence: { value: { actions: {}, events: {} } }
    });
    expect(graph.nodes.every(({ conflicts }) => conflicts === undefined)).toBe(true);
    expect(graph.bindings).toEqual([]);

    const failed = { ...finished, assignments: { status: 'failure', source: 'assignments', value: values, lastSuccessAt: 100 } as const };
    const stale = reconstructTopology(snapshot([cached, target, failed]));
    expect(stale.bindings[0]).toMatchObject({ id: deferred.bindings[0]?.id, assignment: 'complete', assignmentRow: 'present', assignmentFreshness: 'stale' });
  });

  it('orders retained owner values by successful read time, including a newer empty fallback', () => {
    const primary = observation('local', 'Owner', {
      assignments: { status: 'failure', cached: true, source: 'assignments', lastSuccessAt: 50,
        value: { actions: { Start: { node: 'Device', action: 'On' } }, events: {} } }
    });
    const fallback = observation('remote', 'Owner', {
      assignments: { ...success('assignments', { actions: {}, events: {} }), cached: true, lastSuccessAt: 100 }
    });
    const removed = reconstructTopology(snapshot([primary, fallback]));
    expect(removed.nodes[0]?.evidenceRouteId).toBe('remote');
    expect(removed.bindings).toEqual([]);
    const latestFailed = { ...primary, assignments: { ...primary.assignments, cached: false, lastSuccessAt: 150 } };
    const stale = reconstructTopology(snapshot([fallback, latestFailed]));
    expect(stale.bindings[0]).toMatchObject({ assignment: 'complete', assignmentFreshness: 'stale' });
  });
});

describe('topology graph reconstruction', () => {
  it('resolves ASCII variants on both sides of the pinned action and event assignment shapes', () => {
    const pinned = javaApi.responses;
    const nodeName = `${pinned.remoteBindings.actions.SetPower.node} (Rack A) Cafe`;
    const owner = observation('owner', pinned.nodeDetails.name, {
      schema: success('schema', {
        actions: Object.keys(pinned.remoteSchema.properties.actions.properties),
        events: Object.keys(pinned.remoteSchema.properties.events.properties)
      }),
      assignments: success('assignments', {
        actions: { ...pinned.remoteBindings.actions, SetPower: { node: 'DISPLAY CAFE', action: 'POWER' } },
        events: { SourceStatus: { ...pinned.remoteBindings.events.SourceStatus, node: 'display cafe', event: 'status' } }
      })
    });
    const graph = reconstructTopology(snapshot([owner, observation('display', nodeName, {
      actions: success('actions', [pinned.remoteBindings.actions.SetPower.action]),
      events: success('events', [pinned.events.Status.name])
    })]));
    const display = graph.nodes.find((node) => node.name === nodeName)!;
    const action = graph.bindings.find((binding) => binding.alias === 'SetPower')!;
    const event = graph.bindings.find((binding) => binding.alias === 'SourceStatus')!;
    expect(action).toMatchObject({ referenceResolution: 'resolved', targetNodeId: display.id, configuredNode: 'DISPLAY CAFE', configuredEndpoint: 'POWER' });
    expect(action.targetEndpointId).toBe(topologyEndpointId(display.id, 'local-action', 'Power'));
    expect(event).toMatchObject({ referenceResolution: 'resolved', targetNodeId: display.id });
    expect(event.sourceEndpointId).toBe(topologyEndpointId(display.id, 'local-event', 'Status'));
    const unbound = graph.bindings.find((binding) => binding.alias === 'UnboundAction')!;
    expect(unbound).toMatchObject({ assignment: 'unbound', declared: 'yes', assignmentRow: 'present', referenceResolution: 'unknown' });
    expect(unbound.targetEndpointId).toBeUndefined();
  });

  it('keeps declared unbound aliases, preserves assignment identity, and reverses event flow', () => {
    const controller = observation('controller', 'Controller', {
      schema: success('schema', { actions: ['ProjectorPower'], events: ['LampState'] }),
      assignments: success('assignments', {
        actions: { ProjectorPower: { node: 'Projector', action: 'On' } },
        events: { LampState: { node: 'Projector', event: 'State' } }
      })
    });
    const projector = observation('projector', 'Projector', {
      actions: success('local-actions', ['On']), events: success('local-events', ['State'])
    });
    const graph = reconstructTopology(snapshot([controller, projector]));
    const action = graph.bindings.find((binding) => binding.kind === 'actions')!;
    const event = graph.bindings.find((binding) => binding.kind === 'events')!;
    const point = (id: string | undefined) => graph.endpoints.find((endpoint) => endpoint.id === id);

    expect(action).toMatchObject({ declared: 'yes', assignment: 'complete', referenceResolution: 'resolved' });
    expect(point(action.sourceEndpointId)).toMatchObject({ name: 'ProjectorPower', kind: 'remote-action' });
    expect(point(action.targetEndpointId)).toMatchObject({ name: 'On', kind: 'local-action' });
    expect(event).toMatchObject({ declared: 'yes', assignment: 'complete', referenceResolution: 'resolved' });
    expect(point(event.sourceEndpointId)).toMatchObject({ name: 'State', kind: 'local-event' });
    expect(point(event.targetEndpointId)).toMatchObject({ name: 'LampState', kind: 'remote-event' });
    expect(graph.bindings.find((binding) => binding.alias === 'LampState')?.ownerId).toBe(event.ownerId);
  });

  it('promotes both directed terminals in place through discovery, detail caps, and target read failure', () => {
    const owner = (id: string, alias: string) => observation(id, 'Control Panel', {
      assignments: success('assignments', {
        actions: { [alias]: { node: 'Café (rack A)', action: 'Power On' } },
        events: { [alias]: { node: 'CAFE', event: 'Power On' } }
      })
    });
    const device = observation('advertised', 'Cafe', {
      actions: success('actions', ['PowerOn']), events: success('events', ['power-on'])
    });
    const omitted = reconstructTopology(snapshot([owner('first route', 'Power control')], {
      status: 'failure', source: 'inventory cap', value: ['Control Panel']
    }));
    const advertisedOnly = reconstructTopology(snapshot([owner('next route', 'power-control')], success('discovery', ['Control Panel', 'Cafe'])));
    const validated = reconstructTopology(snapshot([owner('next route', 'POWERCONTROL'), device]));
    const failed = reconstructTopology(snapshot([owner('next route', 'Power control'), {
      ...device, actions: { status: 'failure', source: 'actions', value: ['PowerOn'] }, events: { status: 'failure', source: 'events' }
    }]));

    const identity = ({ bindings }: typeof omitted) => bindings.map(({ id, ownerId, sourceEndpointId, targetEndpointId, targetNodeId }) =>
      ({ id, ownerId, sourceEndpointId, targetEndpointId, targetNodeId }));
    const targetId = topologyNodeId('installation-a', 'Cafe');
    for (const [graph, state] of [[omitted, 'unknown'], [advertisedOnly, 'unknown'], [validated, 'resolved'], [failed, 'unknown']] as const) {
      expect(identity(graph)).toEqual(identity(omitted));
      expect(graph.bindings).toHaveLength(2);
      for (const binding of graph.bindings) {
        expect(binding).toMatchObject({ assignment: 'complete', assignmentRow: 'present', declared: 'unknown',
          targetNodeId: targetId, referenceResolution: state, sourceEndpointId: expect.any(String), targetEndpointId: expect.any(String) });
        expect(binding.assignmentFreshness).toBe('current');
      }
      expect(graph.nodes.filter(({ id }) => id === targetId)).toEqual([expect.objectContaining({
        discovery: graph === omitted ? 'placeholder' : 'advertised'
      })]);
    }
    const action = validated.bindings.find(({ kind }) => kind === 'actions')!;
    const event = validated.bindings.find(({ kind }) => kind === 'events')!;
    expect(action.targetEndpointId).toBe(topologyEndpointId(targetId, 'local-action', 'Power On'));
    expect(event.sourceEndpointId).toBe(topologyEndpointId(targetId, 'local-event', 'Power On'));
  });

  it('keeps assignment evidence separate from schema and tracks reassignment and clear without changing binding IDs', () => {
    const owner = (target: string | undefined) => observation('owner', 'Controller', {
      schema: success('schema', { actions: ['Power'], events: [] }),
      assignments: success('assignments', { actions: { Power: target ? { node: target, action: 'On' } : {} }, events: {} })
    });
    const display = observation('display', 'Display', { actions: success('local-actions', ['On']) });
    const projector = observation('projector', 'Projector', { actions: success('local-actions', ['On']) });
    const graphs = [
      reconstructTopology(snapshot([owner('Display'), display])),
      reconstructTopology(snapshot([owner('Projector'), display, projector])),
      reconstructTopology(snapshot([owner(undefined), display, projector]))
    ];
    const bindings = graphs.map((graph) => graph.bindings[0]!);

    expect(bindings.map((binding) => binding.id)).toEqual([bindings[0]!.id, bindings[0]!.id, bindings[0]!.id]);
    expect(bindings.map((binding) => binding.configuredNode)).toEqual(['Display', 'Projector', undefined]);
    expect(bindings.map((binding) => binding.assignment)).toEqual(['complete', 'complete', 'unbound']);
    expect(bindings[2]).toMatchObject({ declared: 'yes', ownerId: bindings[0]!.ownerId });
    expect(bindings.map((binding) => binding.sourceEndpointId)).toEqual(Array(3).fill(bindings[0]!.sourceEndpointId));
    expect(bindings[2]!.targetEndpointId).toBeUndefined();
  });

  it('distinguishes successful empty inventories, failures, missing endpoints, and unknown declarations', () => {
    const owner = observation('owner', 'Controller', {
      schema: absent('schema'),
      assignments: success('assignments', { actions: { Call: { node: 'Device', action: 'On' }, Broken: { node: 'Device', action: 'Gone' } }, events: {} })
    });
    const device = observation('device', 'Device', {
      actions: success('local-actions', []), events: { status: 'failure', source: 'local-events', error: 'offline', lastSuccessAt: 50 }
    });
    const graph = reconstructTopology(snapshot([owner, device]));
    expect(graph.bindings.map((binding) => binding.declared)).toEqual(['unknown', 'unknown']);
    const advertisedDevice = graph.nodes.find((node) => node.name === 'Device')!;
    expect(graph.bindings.every((binding) => binding.referenceResolution === 'endpoint-missing' && binding.targetNodeId === advertisedDevice.id)).toBe(true);
    expect(graph.nodes.filter((node) => node.discovery === 'placeholder')).toHaveLength(0);
    expect(graph.endpoints.filter((endpoint) => endpoint.kind === 'local-action')).toEqual([
      expect.objectContaining({ name: 'On', evidence: 'missing' }),
      expect.objectContaining({ name: 'Gone', evidence: 'missing' })
    ]);

    const failedInventory = reconstructTopology(snapshot([owner], { status: 'failure', source: 'discovery', error: 'timeout' }));
    expect(failedInventory.bindings.every((binding) => binding.referenceResolution === 'unknown')).toBe(true);
    expect(failedInventory.nodes.some((node) => node.discovery === 'placeholder')).toBe(true);
    expect(failedInventory.discoveryEvidence).toMatchObject({ status: 'failure', source: 'discovery' });
    expect(failedInventory.completeness).toMatchObject({ discovery: 'partial', schema: 'unknown', assignments: 'complete' });
  });

  it('validates only the correct inventory and still terminates unreadable or empty-key references', () => {
    const owner = observation('owner', 'Controller', {
      assignments: success('assignments', { actions: {
        Absent: { node: 'Device', action: 'Gone' },
        Opaque: { node: 'Device', action: '(retired)' }
      }, events: { Listen: { node: 'Device', event: 'State' } } })
    });
    const device = observation('device', 'Device', {
      actions: success('actions', ['Δ', 'State']), events: { status: 'failure', source: 'events' }
    });
    const graph = reconstructTopology(snapshot([owner, device]));
    const missingAction = graph.bindings.find((binding) => binding.alias === 'Absent')!;
    expect(missingAction).toMatchObject({ referenceResolution: 'endpoint-missing', targetEndpointId: expect.any(String) });
    const opaque = graph.bindings.find((binding) => binding.alias === 'Opaque')!;
    expect(opaque).toMatchObject({ referenceResolution: 'unknown', targetEndpointId: expect.any(String) });
    const event = graph.bindings.find((binding) => binding.kind === 'events')!;
    expect(graph.endpoints.find((point) => point.id === event.sourceEndpointId)).toMatchObject({ name: 'State', kind: 'local-event', evidence: 'unknown' });

    const refreshed = reconstructTopology(snapshot([owner, { ...device, events: success('events', []) }]));
    const missing = refreshed.bindings.find((binding) => binding.kind === 'events')!;
    expect(missing).toMatchObject({ id: event.id, referenceResolution: 'endpoint-missing', sourceEndpointId: event.sourceEndpointId });
    expect(refreshed.endpoints.find((point) => point.id === missing.sourceEndpointId)).toMatchObject({ name: 'State', kind: 'local-event', evidence: 'missing' });
  });

  it('keeps empty-key target validation unknown and only reports not-discovered after a conclusive inventory', () => {
    const owner = observation('owner', 'Controller', {
      assignments: success('assignments', { actions: { Go: { node: 'Device', action: 'Run' }, Unknown: { node: '(comment only)', action: 'Run' } }, events: {} })
    });
    const complete = reconstructTopology(snapshot([owner]));
    expect(complete.bindings.find((binding) => binding.alias === 'Go')?.referenceResolution).toBe('not-discovered');
    const opaque = complete.bindings.find(({ alias }) => alias === 'Unknown')!;
    expect(opaque).toMatchObject({ referenceResolution: 'unknown', targetEndpointId: expect.any(String) });
    expect(complete.nodes.find(({ id }) => id === opaque.targetNodeId)).toMatchObject({ discovery: 'placeholder' });
  });

  it('validates a known node without a network-wide uniqueness gate', () => {
    const owner = observation('owner', 'Controller', {
      assignments: success('assignments', { actions: { Call: { node: 'Cafe', action: 'On' } }, events: {} })
    });
    const device = observation('device', 'Cafe', { actions: success('actions', ['On']) });
    const known = ['Controller', 'Cafe'];
    for (const input of [
      snapshot([owner, device, observation('opaque', 'Café')], success('discovery', known)),
      snapshot([owner, device, observation('unnamed', '')], success('discovery', known)),
      snapshot([owner, device], success('discovery', [...known, 'Café'])),
      snapshot([owner, device], success('discovery', [...known, 'C A F E'])),
      snapshot([owner, device], success('discovery', ['Controller'])),
      snapshot([owner, device], { status: 'failure', source: 'discovery', value: known }),
      snapshot([owner, device], absent('discovery'))
    ]) {
      const graph = reconstructTopology(input);
      const binding = graph.bindings[0]!;
      expect(binding.referenceResolution).toBe('resolved');
      expect(graph.nodes.find(({ id }) => id === binding.targetNodeId)?.discovery).toBe('advertised');
    }
  });

  it('shows a configured terminal even when that endpoint key is ambiguous', () => {
    const owner = observation('owner', 'Controller', {
      assignments: success('assignments', { actions: { Call: { node: 'Device', action: 'On' } },
        events: { Listen: { node: 'Device', event: 'On' } } })
    });
    const graph = reconstructTopology(snapshot([owner, observation('device', 'Device', {
      actions: success('actions', ['On', 'O n']), events: success('events', ['On'])
    })]));
    const action = graph.bindings.find(({ kind }) => kind === 'actions')!;
    expect(action).toMatchObject({ referenceResolution: 'ambiguous', ambiguity: 'endpoint', targetEndpointId: expect.any(String) });
    expect(graph.bindings.find(({ kind }) => kind === 'events')?.referenceResolution).toBe('resolved');
  });

  it('retains assignment values only after an owner failure; target evidence validates independently', () => {
    const owner = observation('owner', 'Controller', {
      schema: success('schema', { actions: ['OldTarget'], events: [] }),
      assignments: {
        status: 'failure', source: 'assignments', error: 'offline', lastSuccessAt: 50,
        value: { actions: { OldTarget: { node: 'Old Device', action: 'Run' } }, events: {} } as TopologyAssignments
      }
    });
    const graph = reconstructTopology(snapshot([owner], { status: 'failure', source: 'discovery', error: 'failed' }));
    expect(graph.bindings[0]).toMatchObject({
      alias: 'OldTarget', assignment: 'complete', assignmentRow: 'present',
      configuredNode: 'Old Device', configuredEndpoint: 'Run', referenceResolution: 'unknown', assignmentFreshness: 'stale'
    });
    expect(graph.nodes.find((node) => node.name === 'Controller')).toMatchObject({
      schemaEvidence: { status: 'success' }, assignmentEvidence: { status: 'failure', lastSuccessAt: 50 }
    });
    expect(graph.nodes.some((node) => node.name === 'Old Device' && node.discovery === 'placeholder')).toBe(true);
    expect(graph.completeness).toEqual({ discovery: 'partial', schema: 'complete', assignments: 'unknown' });
    const refreshedDiscovery = reconstructTopology(snapshot([owner, observation('device', 'Old Device', {
      actions: success('actions', ['Run'])
    })]));
    const retained = refreshedDiscovery.bindings[0]!;
    expect(retained).toMatchObject({ configuredNode: 'Old Device', referenceResolution: 'resolved', assignmentFreshness: 'stale',
      targetNodeId: graph.bindings[0]?.targetNodeId, targetEndpointId: graph.bindings[0]?.targetEndpointId });
    expect(refreshedDiscovery.nodes.find(({ id }) => id === retained.targetNodeId)?.discovery).toBe('advertised');
    for (const [assignments, assignmentFreshness, assignmentRow] of [
      [success('assignments', { actions: {}, events: {} }), 'current', 'absent'],
      [{ ...owner.assignments, status: 'absent' }, 'unknown', 'unknown'],
      [{ status: 'failure', source: 'assignments', error: 'offline' }, 'unknown', 'unknown'],
      [{ status: 'success', source: 'assignments' }, 'unknown', 'unknown']
    ] as const) {
      const removed = reconstructTopology(snapshot([{ ...owner, assignments }]));
      expect(removed.bindings[0]).toMatchObject({ id: retained.id, assignment: 'unknown', assignmentFreshness, assignmentRow });
      expect(removed.bindings[0]?.targetEndpointId).toBeUndefined();
      expect(removed.bindings[0]?.targetNodeId).toBeUndefined();
      expect(removed.nodes).toHaveLength(1);
    }
  });

  it('distinguishes an absent alias row from an explicitly empty binding object', () => {
    const owner = (actions: TopologyAssignments['actions']) => observation('owner', 'Controller', {
      schema: success('schema', { actions: ['Declared'], events: [] }),
      assignments: success('assignments', { actions, events: {} })
    });
    const absentRow = reconstructTopology(snapshot([owner({})])).bindings[0]!;
    const explicitEmpty = reconstructTopology(snapshot([owner({ Declared: {} })])).bindings[0]!;
    expect(absentRow).toMatchObject({ assignment: 'unknown', assignmentRow: 'absent' });
    expect(explicitEmpty).toMatchObject({ assignment: 'unbound', assignmentRow: 'present' });
    expect(absentRow.id).toBe(explicitEmpty.id);
    expect(absentRow.sourceEndpointId).toBe(explicitEmpty.sourceEndpointId);
    expect(absentRow.targetEndpointId).toBeUndefined();
    expect(explicitEmpty.targetEndpointId).toBeUndefined();
  });

  it('folds canonical schema and assignment spelling, but never wires competing owner rows', () => {
    const owner = (actions: TopologyAssignments['actions']) => observation('owner', 'Control', {
      schema: success('schema', { actions: ['Power Control'], events: [] }),
      assignments: success('assignments', { actions, events: {} })
    });
    const single = { 'power-control': { node: 'Screen', action: 'On' } };
    const coherent = reconstructTopology(snapshot([owner(single)]));
    expect(coherent.bindings).toEqual([expect.objectContaining({ alias: 'Power Control', declared: 'yes', assignment: 'complete' })]);
    const conflict = reconstructTopology(snapshot([owner({ ...single, POWERCONTROL: { node: 'Screen', action: 'Off' } })]));
    expect(conflict.bindings).toEqual([expect.objectContaining({ id: coherent.bindings[0]?.id, alias: 'Power Control',
      declared: 'yes', assignment: 'conflicting', sourceEndpointId: coherent.bindings[0]?.sourceEndpointId })]);
    expect(conflict.bindings[0]?.targetEndpointId).toBeUndefined();
    expect(conflict.nodes).toHaveLength(1);
  });

  it('keeps only the owner port for partial, conflicting, or unbound rows in either direction', () => {
    const aliases = ['Partial', 'Conflict', 'Blank', 'Unbound', 'Malformed'];
    const controller = observation('owner', 'Controller', {
      schema: success('schema', { actions: aliases, events: aliases }),
      assignments: success('assignments', {
        actions: {
          Partial: { node: 'Display' }, Conflict: { node: 'Display', action: 'On', event: 'State' },
          Blank: { node: 'Display', action: ' ' }, Unbound: {}, Malformed: null
        },
        events: {
          Partial: { event: 'State' }, Conflict: { node: 'Display', action: 'On', event: 'State' },
          Blank: { node: ' ', event: 'State' }, Unbound: {}, Malformed: [] as unknown as TopologyAssignments['events'][string]
        }
      })
    });
    const graph = reconstructTopology(snapshot([controller, observation('display', 'Display', {
      actions: success('actions', ['On']), events: success('events', ['State'])
    })]));
    expect(graph.nodes.every((node) => node.discovery === 'advertised')).toBe(true);
    expect(graph.bindings).toHaveLength(10);
    for (const binding of graph.bindings) {
      const expected = binding.alias === 'Unbound' ? 'unbound' : ['Conflict', 'Malformed'].includes(binding.alias) ? 'conflicting' : 'partial';
      expect(binding).toMatchObject({ assignment: expected, assignmentRow: 'present', referenceResolution: 'unknown' });
      expect(binding.targetNodeId).toBeUndefined();
      const ownerPort = topologyEndpointId(binding.ownerId, binding.kind === 'actions' ? 'remote-action' : 'remote-event', binding.alias);
      expect(binding.sourceEndpointId).toBe(binding.kind === 'actions' ? ownerPort : undefined);
      expect(binding.targetEndpointId).toBe(binding.kind === 'events' ? ownerPort : undefined);
      if (binding.alias === 'Conflict') expect(binding).toMatchObject({ configuredNode: 'Display', configuredEndpoint: binding.kind === 'actions' ? 'On' : 'State' });
    }
  });

  it('retains parallel aliases and owner fan-out to a grouped target with malformed rows unwired', () => {
    const owner = observation('owner', 'Controller', {
      schema: success('schema', { actions: ['A', 'B', 'C', 'D'], events: [] }),
      assignments: success('assignments', { actions: {
        A: { node: 'Display', action: 'On' }, B: { node: 'Display', action: 'On' },
        C: { node: 'Display' }, D: { node: 4, action: 'On' }
      }, events: {} })
    });
    const graph = reconstructTopology(snapshot([
      owner,
      observation('one', 'Display', { actions: success('actions', ['On']) }),
      observation('two', 'Display', { actions: success('actions', ['On']) })
    ]));
    expect(graph.bindings).toHaveLength(4);
    const [first, second] = graph.bindings.filter((binding) => binding.alias === 'A' || binding.alias === 'B');
    expect(first).toMatchObject({ referenceResolution: 'resolved', targetEndpointId: second?.targetEndpointId });
    expect(second).toMatchObject({ referenceResolution: 'resolved', targetEndpointId: expect.any(String) });
    expect(first?.sourceEndpointId).not.toBe(second?.sourceEndpointId);
    expect(graph.bindings.find((binding) => binding.alias === 'C')?.assignment).toBe('partial');
    expect(graph.bindings.find((binding) => binding.alias === 'D')?.assignment).toBe('conflicting');
    expect(graph.nodes.find(({ name }) => name === 'Display')?.duplicate?.routeCount).toBe(2);
    expect(graph.nodes.filter((node) => node.discovery === 'placeholder')).toHaveLength(0);
  });

  it('scales to 100 nodes, 20,000 local points and 300 bindings deterministically', () => {
    const nodes: TopologyNodeSnapshot[] = [];
    for (let index = 0; index < 100; index += 1) {
      const name = `Node-${index}`;
      const assignments = index === 0
        ? { actions: Object.fromEntries(Array.from({ length: 300 }, (_, binding) => [`Alias-${binding}`, { node: 'Node-1', action: `Action-${binding % 200}` }])), events: {} }
        : { actions: {}, events: {} };
      nodes.push(observation(`observation-${index}`, name, {
        addresses: [{ canonicalAddress: `http://${name}/`, displayAddress: name, source: 'fixture' }],
        actions: success('actions', Array.from({ length: 200 }, (_, point) => `Action-${point}`)),
        events: success('events', Array.from({ length: 200 }, (_, point) => `Event-${point}`)),
        schema: success('schema', { actions: index === 0 ? Object.keys(assignments.actions) : [], events: [] }),
        assignments: success('assignments', assignments)
      }));
    }
    const first = reconstructTopology(snapshot(nodes));
    const second = reconstructTopology(snapshot(nodes));
    expect(first.nodes).toHaveLength(100);
    expect(first.endpoints).toHaveLength(40_300);
    expect(first.bindings).toHaveLength(300);
    expect(first.bindings.every(({ referenceResolution }) => referenceResolution === 'resolved')).toBe(true);
    expect(first).toEqual(second);
    expect(reconstructTopology(snapshot(nodes.slice().reverse()))).toEqual(first);
  });
});
