import { buildLocalGraph, graphInputFromLocalSnapshot, type LocalSnapshot } from '../src/experiments/konva-canvas/local-graph';
import { closestFeasibleY, indexLocalGraphGeometry, localGraphGeometryForPositions, localPortsForNode, placeLocalGraph } from '../src/experiments/konva-canvas/local-placement';
import { projectLocalGraph } from '../src/experiments/konva-canvas/local-projection';
import { cardHeight, curvePoint, edgeCurve, edgeCurves, portPoint } from '../src/experiments/konva-canvas/fixture';

function sample(): LocalSnapshot {
  return {
    locals: [
      { name: 'Controller', readState: 'read', actions: [
        { alias: 'Power On', node: 'Projector Left', endpoint: 'Power On' },
        { alias: 'Power On duplicate', node: 'Projector Left', endpoint: 'Power On' },
        { alias: 'self', node: 'Controller', endpoint: 'Loop' },
        { alias: 'incomplete', node: 'Spare' },
        { alias: 'conflict', node: 'Projector Left', endpoint: 'A' },
        { alias: 'conflict', node: 'Projector Left', endpoint: 'B' }
      ], events: [{ alias: 'power state', node: 'Projector Left', endpoint: 'Power State' }] },
      { name: 'Projector Left', readState: 'unread' },
      { name: 'Idle Node', readState: 'read', actions: [], events: [] },
      { name: 'Unread Owner', readState: 'unread' }
    ]
  };
}

describe('local topology graph, layout, and renderer projection', () => {
  it('chooses the nearest free gap between occupied wire bands', () => {
    expect(closestFeasibleY(38, [{ start: 0, end: 40 }, { start: 80, end: 120 }])).toBe(41);
  });

  it('moves only an unrelated intermediate card out of all initial bypass paths', () => {
    const graph = buildLocalGraph({ locals: [
      { name: 'Example 1', readState: 'read', events: [{ alias: 'Gate2Input1', node: 'Example 2', endpoint: 'LogLevel' }] },
      { name: 'Example Frontend', readState: 'read', events: [
        { alias: 'Preset', node: 'Example 2', endpoint: 'LogLevel' },
        { alias: 'Switch', node: 'Example 1', endpoint: 'Gate1Output' }
      ] },
      { name: 'Example 2', readState: 'read' }
    ] });
    const positions = placeLocalGraph(graph);
    const projection = projectLocalGraph(graph, positions);
    const byName = (name: string) => [...graph.nodes.values()].find((node) => node.name === name)!;
    const point = (name: string) => positions.get(byName(name).id)!;
    expect(point('Example 1').x).toBe(368);
    expect(point('Example 1').y).toBeCloseTo(-46);
    expect(point('Example 2')).toEqual({ x: 0, y: 0 });
    expect(point('Example Frontend')).toEqual({ x: 736, y: 0 });

    const nodeById = new Map(projection.nodes.map((node) => [node.id, node]));
    // Identify each subscription by its semantic owner/alias and referenced event.
    const subscription = (owner: string, alias: string, endpoint: string) => projection.edges.find((edge) => {
      const from = nodeById.get(edge.from.nodeId)!;
      const to = nodeById.get(edge.to.nodeId)!;
      return edge.ownerId === projection.nodes.find((node) => node.name === owner)!.id && from.name !== owner && to.name === owner &&
        from.ports.some((port) => port.id === edge.from.portId && port.label === endpoint) &&
        to.ports.some((port) => port.id === edge.to.portId && port.label === alias);
    })!;
    const upstream = subscription('Example 1', 'Gate2Input1', 'LogLevel');
    const skip = subscription('Example Frontend', 'Preset', 'LogLevel');
    const adjacent = subscription('Example Frontend', 'Switch', 'Gate1Output');
    expect(skip.from).toMatchObject({ nodeId: projection.nodes.find((node) => node.name === 'Example 2')!.id });
    expect(skip.to).toMatchObject({ nodeId: projection.nodes.find((node) => node.name === 'Example Frontend')!.id });
    expect(projection.edges).toHaveLength(3);
    expect(projection.edges.every((edge) => edge.bindingKind === 'event')).toBe(true);

    const obstruction = projection.nodes.find((node) => node.name === 'Example 1')!;
    const routed = edgeCurves(skip, nodeById);
    for (const curve of edgeCurves(skip, nodeById)) for (let step = 1; step < 96; step += 1) {
      const sample = curvePoint(curve, step / 96);
      expect(sample.x < obstruction.x - 18 || sample.x > obstruction.x + obstruction.width + 18 ||
        sample.y < obstruction.y - 18 || sample.y > obstruction.y + cardHeight(obstruction) + 18).toBe(true);
    }
    expect(edgeCurves(skip, nodeById)[0]?.start).toEqual(portPoint(nodeById.get(skip.from.nodeId)!, skip.from.portId));
    expect(edgeCurves(skip, nodeById)[0]?.end).toEqual(portPoint(nodeById.get(skip.to.nodeId)!, skip.to.portId));
    expect(edgeCurves(upstream, nodeById)[0]?.end).toEqual(portPoint(nodeById.get(upstream.to.nodeId)!, upstream.to.portId));
    expect(routed).toEqual([edgeCurve(skip, nodeById)]);
    expect(edgeCurves(upstream, nodeById)).toEqual([edgeCurve(upstream, nodeById)]);
    expect(edgeCurves(adjacent, nodeById)).toEqual([edgeCurve(adjacent, nodeById)]);
    expect(point('Example Frontend')).toEqual({ x: 736, y: 0 });
  });

  it('keeps intersecting bypass dependencies clear when an intermediate card is also a wire endpoint', () => {
    const actions = (...bindings: [alias: string, node: string][]) =>
      bindings.map(([alias, node]) => ({ alias, node, endpoint: `p${alias}` }));
    const locals: LocalSnapshot['locals'] = [
      { name: 'A', readState: 'read', actions: actions(['a12', 'F']) },
      { name: 'B', readState: 'read', actions: actions(['a2', 'D'], ['a3', 'E'], ['a5', 'D']) },
      { name: 'C', readState: 'read', actions: actions(['a11', 'F'], ['a14', 'D'], ['a16', 'G']) },
      { name: 'D', readState: 'read' },
      { name: 'E', readState: 'read', actions: actions(['a4', 'F']) },
      { name: 'F', readState: 'read', actions: actions(['a8', 'G']) },
      { name: 'G', readState: 'read' }
    ];
    const graph = buildLocalGraph({ locals });
    const positions = placeLocalGraph(graph);
    const { nodes, edges } = projectLocalGraph(graph, positions);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const a = nodes.find((node) => node.name === 'A')!;
    const bypass = edges.find((edge) => nodeById.get(edge.from.nodeId)!.name === 'B' &&
      nodeById.get(edge.to.nodeId)!.name === 'D' &&
      nodeById.get(edge.from.nodeId)!.ports.some((port) => port.id === edge.from.portId && port.label === 'a2'))!;

    // The old single pass moved A first, then moved D and swung this midpoint back inside A.
    const midpoint = curvePoint(edgeCurve(bypass, nodeById), 0.5);
    expect(midpoint.x).toBeGreaterThan(a.x);
    expect(midpoint.x).toBeLessThan(a.x + a.width);
    expect(midpoint.y < a.y || midpoint.y > a.y + cardHeight(a)).toBe(true);

    const checked: string[] = [];
    for (const edge of edges) {
      const direct = edgeCurve(edge, nodeById);
      const blockers = nodes.filter((node) => node.x > direct.start.x && node.x + node.width < direct.end.x);
      if (!blockers.length) continue;
      expect(edgeCurves(edge, nodeById)).toEqual([direct]);
      const alias = nodeById.get(edge.from.nodeId)!.ports.find((port) => port.id === edge.from.portId)!.label;
      checked.push(alias);
      for (const card of blockers) {
        const hit = Array.from({ length: 191 }, (_, index) => curvePoint(direct, (index + 1) / 192)).some((point) =>
          point.x >= card.x - 18 && point.x <= card.x + card.width + 18 &&
          point.y >= card.y - 18 && point.y <= card.y + cardHeight(card) + 18);
        expect(hit, `${alias} crosses ${card.name}`).toBe(false);
      }
    }
    expect(checked.sort()).toEqual(['a16', 'a2', 'a5']);
    const reordered = [...locals].reverse().map((node) => node.actions ? { ...node, actions: [...node.actions].reverse() } : node);
    expect(placeLocalGraph(buildLocalGraph({ locals: reordered }))).toEqual(positions);
  });

  it('preserves local nodes, emits correctly directed action and event wires, and shares targets', () => {
    const graph = buildLocalGraph(sample());
    const projector = [...graph.nodes.values()].find((node) => node.name === 'Projector Left')!;
    const controller = [...graph.nodes.values()].find((node) => node.name === 'Controller')!;
    expect(graph.nodes.size).toBe(5); // Spare is a retained referenced block; shared projector is one node.
    expect([...graph.nodes.values()].some((node) => node.name === 'Idle Node')).toBe(true);
    expect(projector.origin).toBe('local');
    expect(projector.bindingsRead).toBe('unread');
    const action = [...graph.connections.values()].find((edge) => edge.alias === 'Power On')!;
    const event = [...graph.connections.values()].find((edge) => edge.alias === 'power state')!;
    expect(graph.ports.get(action.fromPortId)).toMatchObject({ nodeId: controller.id, kind: 'remote-action' });
    expect(graph.ports.get(action.toPortId)).toMatchObject({ nodeId: projector.id, kind: 'local-action' });
    expect(graph.ports.get(event.fromPortId)).toMatchObject({ nodeId: projector.id, kind: 'local-event' });
    expect(graph.ports.get(event.toPortId)).toMatchObject({ nodeId: controller.id, kind: 'remote-event' });
    expect([...graph.ports.values()].filter((port) => port.nodeId === projector.id && port.name === 'Power On')).toHaveLength(1);
    expect(graph.conflicts).toEqual([{ ownerId: controller.id, alias: 'conflict', kind: 'action', rows: 2 }]);
    expect(graph.incompleteAssignments).toBe(1);
  });

  it('models the two reciprocal Example Frontend and Example 2 bindings with distinct endpoint kinds', () => {
    const graph = buildLocalGraph({ locals: [
      { name: 'Example Frontend', readState: 'read', actions: [{ alias: 'Preset', node: 'Example 2', endpoint: 'power' }], events: [{ alias: 'Preset', node: 'Example 2', endpoint: 'LogLevel' }] },
      { name: 'Example 2', readState: 'read' }
    ] });
    const nodes = new Map([...graph.nodes.values()].map((node) => [node.name, node]));
    const ports = [...graph.ports.values()];
    const binding = (kind: 'action' | 'event') => [...graph.connections.values()].find((connection) => connection.kind === kind)!;
    const action = binding('action');
    const event = binding('event');
    expect(ports.find((port) => port.id === action.fromPortId)).toMatchObject({ nodeId: nodes.get('Example Frontend')!.id, kind: 'remote-action', name: 'Preset' });
    expect(ports.find((port) => port.id === action.toPortId)).toMatchObject({ nodeId: nodes.get('Example 2')!.id, kind: 'local-action', name: 'power' });
    expect(ports.find((port) => port.id === event.fromPortId)).toMatchObject({ nodeId: nodes.get('Example 2')!.id, kind: 'local-event', name: 'LogLevel' });
    expect(ports.find((port) => port.id === event.toPortId)).toMatchObject({ nodeId: nodes.get('Example Frontend')!.id, kind: 'remote-event', name: 'Preset' });
    const projection = projectLocalGraph(graph);
    expect(projection.edges).toHaveLength(2);
    expect(projection.nodes.find((node) => node.name === 'Example Frontend')?.ports.map((port) => [port.label, port.direction, port.side]))
      .toEqual([['Preset', 'out', 'right'], ['Preset', 'in', 'left']]);
  });

  it('assigns stable lanes by destination row even when source and destination orders disagree', () => {
    const owners: LocalSnapshot['locals'] = [
      { name: 'Owner', readState: 'read', actions: [
        { alias: 'Second', node: 'Peer', endpoint: 'Set A' },
        { alias: 'First', node: 'Peer', endpoint: 'Set B' }
      ] },
      { name: 'Peer', readState: 'read' }
    ];
    const make = (reverse = false) => buildLocalGraph({ locals: (reverse ? [...owners].reverse() : owners).map((owner) => ({
      ...owner,
      ...(owner.actions ? { actions: reverse ? [...owner.actions].reverse() : owner.actions } : {})
    })) });
    const first = projectLocalGraph(make());
    const reordered = projectLocalGraph(make(true));
    const owner = first.nodes.find((node) => node.name === 'Owner')!;
    const peer = first.nodes.find((node) => node.name === 'Peer')!;
    const pair = first.edges.filter((edge) => edge.from.nodeId === owner.id && edge.to.nodeId === peer.id);

    expect(pair).toHaveLength(2);
    expect(new Set(pair.map((edge) => edge.id)).size).toBe(2);
    expect(pair.map(({ laneIndex, laneCount }) => [laneIndex, laneCount])).toEqual([[1, 2], [0, 2]]);
    expect(portPoint(owner, pair[0]!.from.portId).y).toBeLessThan(portPoint(owner, pair[1]!.from.portId).y);
    expect(portPoint(peer, pair[0]!.to.portId).y).toBeGreaterThan(portPoint(peer, pair[1]!.to.portId).y);
    expect(reordered.edges.map(({ id, laneIndex, laneCount }) => [id, laneIndex, laneCount]))
      .toEqual(first.edges.map(({ id, laneIndex, laneCount }) => [id, laneIndex, laneCount]));
    const positions = new Map([[owner.id, { x: 300, y: 0 }], [peer.id, { x: 0, y: 0 }]]);
    const nodeMap = new Map(first.nodes.map((node) => [node.id, node]));
    const routeRails = pair.map((edge) => edgeCurves(edge, nodeMap, positions)
      .filter((curve) => curve.start.y === curve.end.y && curve.start.x !== curve.end.x)
      .sort((a, b) => Math.abs(b.end.x - b.start.x) - Math.abs(a.end.x - a.start.x))[0]!.start.y);
    expect(Math.abs(routeRails[0]! - routeRails[1]!)).toBeCloseTo(12);
  });

  it('gives opposed multi-binding groups stable row ranks and reserves space for both bands', () => {
    const owners: LocalSnapshot['locals'] = [{
      name: 'A', readState: 'read',
      actions: Array.from({ length: 4 }, (_, index) => ({ alias: `Action ${index}`, node: 'Z', endpoint: `Set ${index}` })),
      events: Array.from({ length: 3 }, (_, index) => ({ alias: `Event ${index}`, node: 'Z', endpoint: `Changed ${index}` }))
    }, { name: 'Z', readState: 'read' }];
    const make = (reverse = false) => buildLocalGraph({ locals: (reverse ? [...owners].reverse() : owners).map((owner) => ({
      ...owner,
      ...(reverse && owner.actions ? { actions: [...owner.actions].reverse() } : {}),
      ...(reverse && owner.events ? { events: [...owner.events].reverse() } : {})
    })) });
    const projection = projectLocalGraph(make());
    const reordered = projectLocalGraph(make(true));
    const laneAssignments = projection.edges.map(({ id, laneIndex, laneCount, oppositeLaneCount }) => [id, laneIndex, laneCount, oppositeLaneCount]);
    expect(projection.edges).toHaveLength(7);
    for (const source of projection.nodes) {
      const group = projection.edges.filter((edge) => edge.from.nodeId === source.id);
      expect(group.map((edge) => edge.laneIndex).sort((a, b) => a! - b!)).toEqual(group.map((_, index) => index));
      expect(group.every((edge) => edge.laneCount === group.length && edge.oppositeLaneCount === 7 - group.length)).toBe(true);
    }
    expect(reordered.edges.map(({ id, laneIndex, laneCount, oppositeLaneCount }) => [id, laneIndex, laneCount, oppositeLaneCount])).toEqual(laneAssignments);
  });

  it('produces order-independent placement and projection with collision-safe IDs', () => {
    const first = buildLocalGraph(sample());
    const shuffled: LocalSnapshot = { locals: [...sample().locals].reverse().map((owner) => ({
      ...owner,
      ...(owner.actions ? { actions: [...owner.actions].reverse() } : {}),
      ...(owner.events ? { events: [...owner.events].reverse() } : {})
    })) };
    const second = buildLocalGraph(shuffled);
    expect([...placeLocalGraph(first)]).toEqual([...placeLocalGraph(second)]);
    const projected = projectLocalGraph(first);
    expect(projected.nodes.map(({ id, x, y }) => [id, x, y])).toEqual(projectLocalGraph(second).nodes.map(({ id, x, y }) => [id, x, y]));
    expect(new Set(projected.nodes.map((node) => node.id)).size).toBe(projected.nodes.length);
    expect(new Set(projected.edges.map((edge) => edge.id)).size).toBe(projected.edges.length);
    expect([...projected.nodes.map((node) => node.id), ...projected.socketIds.values()]
      .every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true);
    expect(projected.edges.some((edge) => edge.selfLoop)).toBe(true);
    expect(projected.nodes.find((node) => node.name === 'Projector Left')?.displayStatus).toBe('Local · bindings unread');
    expect(projected.nodes.find((node) => node.name === 'Controller')?.displayStatus).toBe('Local · bindings partial');
    expect(projected.nodes.find((node) => node.name === 'Spare')?.displayStatus).toBe('Referenced · not inspected');
    const positions = placeLocalGraph(first);
    for (const point of positions.values()) expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    for (let i = 0; i < projected.nodes.length; i += 1) {
      const left = projected.nodes[i]!;
      const leftGraphNode = [...first.nodes.values()].find((node) => node.name === left.name)!;
      const leftPoint = positions.get(leftGraphNode.id)!;
      const leftBounds = { x: leftPoint.x, y: leftPoint.y, width: left.width, height: cardHeight({ ...left, status: 'online' }) };
      for (let j = i + 1; j < projected.nodes.length; j += 1) {
        const right = projected.nodes[j]!;
        const rightGraphNode = [...first.nodes.values()].find((node) => node.name === right.name)!;
        const rightPoint = positions.get(rightGraphNode.id)!;
        const rightBounds = { x: rightPoint.x, y: rightPoint.y, width: right.width, height: cardHeight({ ...right, status: 'online' }) };
        expect(leftBounds.x + leftBounds.width <= rightBounds.x || rightBounds.x + rightBounds.width <= leftBounds.x
          || leftBounds.y + leftBounds.height <= rightBounds.y || rightBounds.y + rightBounds.height <= leftBounds.y).toBe(true);
      }
    }
  });

  it('retains unread and successful-empty owners as different statuses', () => {
    const projection = projectLocalGraph(buildLocalGraph(sample()));
    expect(projection.nodes.find((node) => node.name === 'Unread Owner')?.displayStatus).toBe('Local · bindings unread');
    expect(projection.nodes.find((node) => node.name === 'Idle Node')?.displayStatus).toBe('Local');
    expect(projection.summary).toContain('2 local unread');
  });

  it('adapts the bounded-read contract while preserving incomplete rows and unread state', () => {
    const input = graphInputFromLocalSnapshot({ owners: [
      { key: 'owner', name: 'Owner', status: 'read', bindings: {
        actions: { Good: { node: 'Peer', action: 'A' }, TargetOnly: { node: 'Other' }, EndpointOnly: { action: 'B' }, Unbound: {} },
        events: { Listen: { node: 'Peer', event: 'Changed' } }
      } },
      { key: 'failed', name: 'Failed Owner', status: 'unread', reason: 'failed' }
    ] });
    const graph = buildLocalGraph(input);
    expect([...graph.nodes.values()].some((node) => node.name === 'Failed Owner' && node.bindingsRead === 'unread')).toBe(true);
    expect([...graph.nodes.values()].some((node) => node.name === 'Other')).toBe(true);
    expect(graph.connections.size).toBe(2);
    expect(graph.incompleteAssignments).toBe(2);
  });

  it('keeps opaque delimiter and Unicode strings out of renderer IDs', () => {
    const graph = buildLocalGraph({ locals: [{ name: 'Ａ💡/name--(test)', readState: 'read', actions: [
      { alias: 'x/ y--(z)', node: 'other|node', endpoint: 'p::q' }
    ] }] });
    const projection = projectLocalGraph(graph);
    expect(projection.nodes.some((node) => node.name === 'other|node')).toBe(true);
    expect([...projection.nodes.map((node) => node.id), ...projection.edges.map((edge) => edge.id)]
      .every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true);
    expect(projection.edges).toHaveLength(1);
  });

  it('rejects incompatible assignments sharing a Java-canonical alias', () => {
    const graph = buildLocalGraph({ locals: [{ name: 'Owner', readState: 'read', actions: [
      { alias: 'Power-On', node: 'Peer', endpoint: 'Switch On' },
      { alias: 'Power On', node: 'Peer', endpoint: 'Switch-On' },
      { alias: 'Power On', node: 'Other Peer', endpoint: 'Switch-On' }
    ] }] });
    expect(graph.connections.size).toBe(0);
    expect(graph.conflicts).toEqual([{ ownerId: JSON.stringify(['node', 'simple:owner']), alias: 'Power On', kind: 'action', rows: 3 }]);
    expect(graph.ports.size).toBe(0);
  });

  it('matches configured target spelling to its local inventory by Java simple name', () => {
    const graph = buildLocalGraph({ locals: [
      { name: 'Crème Brûlée', readState: 'read', actions: [] },
      { name: 'Owner', readState: 'read', actions: [{ alias: 'dessert', node: 'CremeBrulee', endpoint: 'Serve' }] }
    ] });
    const target = [...graph.nodes.values()].find((node) => node.name === 'Crème Brûlée');
    expect(target?.origin).toBe('local');
    expect([...graph.nodes.values()].filter((node) => node.key === target?.key)).toHaveLength(1);
    expect(graph.connections.size).toBe(1);
  });

  it('keeps configured binding identity stable when only its target changes', () => {
    const make = (node: string) => buildLocalGraph({ locals: [{
      name: 'Owner', readState: 'read', actions: [{ alias: 'Power On', node, endpoint: 'Switch' }]
    }] });
    const first = projectLocalGraph(make('Peer A'));
    const reassigned = projectLocalGraph(make('Peer B'));
    expect(reassigned.edges[0]?.id).toBe(first.edges[0]?.id);
    expect(reassigned.edges[0]?.to.nodeId).not.toBe(first.edges[0]?.to.nodeId);
  });

  it('does not choose one response when local spellings collide by Java identity', () => {
    const graph = buildLocalGraph({ locals: [
      { name: 'Projector Left', readState: 'read', actions: [{ alias: 'Power', node: 'Other', endpoint: 'On' }] },
      { name: 'Projector-Left', readState: 'read', actions: [{ alias: 'Power', node: 'Other', endpoint: 'Off' }] },
      { name: 'Owner', readState: 'read', actions: [{ alias: 'Target', node: 'Projector Left', endpoint: 'Power' }] }
    ] });
    const projector = [...graph.nodes.values()].find((node) => node.key === 'simple:projectorleft')!;
    expect(projector.origin).toBe('local');
    expect(projector.bindingsRead).toBe('unread');
    expect([...graph.ports.values()].filter((port) => port.nodeId === projector.id).map((port) => port.name)).toEqual(['Power']);
    expect([...graph.connections.values()]).toHaveLength(1); // Incoming owner reference remains intact.
  });

  it('does not use empty Java reductions as aliases, targets, or endpoints', () => {
    const graph = buildLocalGraph({ locals: [
      { name: '---', readState: 'read' },
      { name: 'Owner', readState: 'read', actions: [
      { alias: '---', node: 'Target', endpoint: 'Run' },
      { alias: 'Alias', node: '---', endpoint: 'Run' },
      { alias: 'Alias 2', node: 'Target 2', endpoint: '---' }
    ] }
    ] });
    expect(graph.connections.size).toBe(0);
    expect(graph.ports.size).toBe(0);
    expect([...graph.nodes.values()].map((node) => node.name).sort()).toEqual(['---', 'Owner', 'Target', 'Target 2']);
    expect([...graph.nodes.values()].filter((node) => node.name === '---')).toHaveLength(1);
    expect(graph.incompleteAssignments).toBe(3);
  });

  it('preserves FEFF because Java identity does not consider it an empty key or trim-space', () => {
    const graph = buildLocalGraph({ locals: [{ name: 'Owner', readState: 'read', actions: [
      { alias: '\ufeff', node: '\ufeff', endpoint: '\ufeff' }
    ] }] });
    expect(graph.connections.size).toBe(1);
    expect([...graph.ports.values()].map((port) => port.name)).toEqual(['\ufeff', '\ufeff']);
  });

  it('anchors a multi-owner component on a local node even when a referenced hub has higher degree', () => {
    const graph = buildLocalGraph({ locals: [
      { name: 'A Local', readState: 'read', events: [{ alias: 'Listen', node: 'Referenced Hub', endpoint: 'State' }] },
      { name: 'B Local', readState: 'read', actions: [{ alias: 'Set', node: 'Referenced Hub', endpoint: 'Set' }] },
      { name: 'Isolated', readState: 'read' }
    ] });
    const positions = placeLocalGraph(graph);
    const node = (name: string) => [...graph.nodes.values()].find((item) => item.name === name)!;
    expect(positions.get(node('Referenced Hub').id)!.x).toBeLessThan(positions.get(node('A Local').id)!.x);
    expect(positions.get(node('B Local').id)!.x).toBeLessThan(positions.get(node('Referenced Hub').id)!.x);
  });

  it('deduplicates a shared endpoint through multiple owners and retains a directed cycle/evidence', () => {
    const graph = buildLocalGraph({ locals: [
      { name: 'A', readState: 'read', actions: [
        { alias: 'to B', node: 'B', endpoint: 'Power' },
        { alias: 'also B', node: 'B', endpoint: 'Power' }
      ] },
      { name: 'B', readState: 'read', actions: [{ alias: 'to C', node: 'C', endpoint: 'Power' }] },
      { name: 'C', readState: 'read', actions: [{ alias: 'to A', node: 'A', endpoint: 'Power' }] },
      { name: 'Idle', readState: 'read' }
    ] });
    expect(graph.connections.size).toBe(4);
    const b = [...graph.nodes.values()].find((node) => node.name === 'B')!;
    expect([...graph.ports.values()].filter((port) => port.nodeId === b.id && port.kind === 'local-action' && port.name === 'Power')).toHaveLength(1);
    expect([...graph.ports.values()].find((port) => port.kind === 'remote-action')?.evidence).toBe('configured-alias');
    expect([...graph.ports.values()].find((port) => port.nodeId === b.id && port.name === 'Power')?.evidence).toBe('referenced-endpoint');
    expect(placeLocalGraph(graph).size).toBe(graph.nodes.size);
  });

  it('packs one hundred isolated inventory nodes into a deterministic non-overlapping grid', () => {
    const snapshot: LocalSnapshot = { locals: Array.from({ length: 100 }, (_, index) => ({
      name: `Idle ${String(index).padStart(3, '0')}`, readState: 'read' as const
    })) };
    const graph = buildLocalGraph(snapshot);
    const positions = placeLocalGraph(graph);
    expect(placeLocalGraph(graph)).toEqual(positions);
    expect(positions.size).toBe(100);
    const points = [...positions.values()];
    expect(Math.max(...points.map((point) => point.x))).toBeLessThan(10 * (218 + 180));
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        expect(Math.abs(points[i]!.x - points[j]!.x) >= 218 || Math.abs(points[i]!.y - points[j]!.y) >= 90).toBe(true);
      }
    }
  });

  it('indexes large inventories and port-heavy owners once for matching layout and projection geometry', () => {
    const workCount = 180;
    const graph = buildLocalGraph({ locals: [
      {
        name: 'Large Owner', readState: 'read',
        actions: Array.from({ length: workCount }, (_, index) => ({ alias: `Action ${index}`, node: 'Large Peer', endpoint: `Set ${index}` })),
        events: Array.from({ length: workCount - 60 }, (_, index) => ({ alias: `Event ${index}`, node: 'Large Peer', endpoint: `Changed ${index}` }))
      },
      { name: 'Large Peer', readState: 'read' },
      ...Array.from({ length: 80 }, (_, index) => ({ name: `Idle ${index}`, readState: 'read' as const }))
    ] });
    const geometry = indexLocalGraphGeometry(graph);
    const positions = placeLocalGraph(graph, {}, geometry);
    expect(localGraphGeometryForPositions(graph, positions)).toBe(geometry);
    const projection = projectLocalGraph(graph, positions);
    const owner = [...graph.nodes.values()].find((node) => node.name === 'Large Owner')!;
    const peer = [...graph.nodes.values()].find((node) => node.name === 'Large Peer')!;
    const projectedOwner = projection.nodes.find((node) => node.name === 'Large Owner')!;
    const projectedPeer = projection.nodes.find((node) => node.name === 'Large Peer')!;
    expect(graph.nodes.size).toBe(82);
    expect(graph.connections.size).toBe(workCount * 2 - 60);
    expect(geometry.portsByNode.get(owner.id)).toHaveLength(workCount * 2 - 60);
    expect(geometry.heightsByNode.get(owner.id)).toBe(cardHeight({ ...projectedOwner, status: 'online' }));
    expect(geometry.heightsByNode.get(peer.id)).toBe(cardHeight({ ...projectedPeer, status: 'online' }));
    expect(projectedOwner.ports.map((port) => port.label)).toEqual(localPortsForNode(graph, owner.id, geometry).map((port) => port.name));
    expect(projectedOwner.ports).toHaveLength(workCount * 2 - 60);
    expect(projectedPeer.ports).toHaveLength(workCount * 2 - 60);
  });

  it('reuses the default placement port index when projecting its positions', () => {
    const graph = buildLocalGraph({ locals: [
      { name: 'Owner', readState: 'read', actions: [{ alias: 'A', node: 'Peer', endpoint: 'Set' }] },
      { name: 'Peer', readState: 'read' }
    ] });
    const ports = graph.ports;
    let traversals = 0;
    graph.ports = new Proxy(ports, {
      get(target, property) {
        if (property === Symbol.iterator) {
          return function* () {
            traversals += 1;
            yield* target;
          };
        }
        if (property === 'values') return target.values.bind(target);
        if (property === 'size') return target.size;
        if (property === 'get') return target.get.bind(target);
        if (property === 'has') return target.has.bind(target);
        if (property === 'keys') return target.keys.bind(target);
        if (property === 'entries') return target.entries.bind(target);
        if (property === 'forEach') return target.forEach.bind(target);
        return undefined;
      }
    });

    const positions = placeLocalGraph(graph);
    expect(traversals).toBe(1);
    const projection = projectLocalGraph(graph, positions);

    expect(traversals).toBe(1);
    expect(projection.edges).toHaveLength(1);
  });
});
