import type { FixtureNode } from './fixture';
import { placeEnrichedPeer } from './enrichment-placement';
import { applyRemoteEnrichmentResult, type LocalGraph } from './local-graph';
import { compareLocalPorts } from './local-placement';
import {
  createLocalSummary, localCardId, projectLocalCard, projectLocalCardStatus, projectLocalPort, projectLocalWire,
  type LocalGraphProjection, type LocalWirePairs, type ProjectedLocalEdge, type ProjectedLocalNode
} from './local-projection';
import type { RemoteEnrichmentBatch, RemoteEnrichmentFailure, RemoteEnrichmentResult } from './remote-enrichment';

export type LocalCardPatch = Pick<ProjectedLocalNode, 'id' | 'name' | 'displayStatus' | 'displayQualifier' | 'statusKind' | 'hostKind' | 'origin' | 'hostDescription' | 'tooltip'> & { localPathName?: ProjectedLocalNode['localPathName']; ports?: ProjectedLocalNode['ports'] };

interface LiveLocalScene {
  readonly nodes: ReadonlyMap<string, FixtureNode>;
  /** Return incident wires whose attachment or routing geometry can change. */
  patchCard(card: LocalCardPatch): Iterable<string>;
  addCard(card: ProjectedLocalNode): void;
  addWire(wire: ProjectedLocalEdge): void;
}

const failures: Record<RemoteEnrichmentFailure, [card: string, count: string]> = {
  'lookup-timeout': ['Discovery timed out', 'discovery timed out'],
  'lookup-transport': ['Discovery failed', 'discovery failed'],
  'lookup-invalid-data': ['Invalid discovery response', 'invalid discovery response'],
  'no-route': ['No usable remote route', 'no usable route'],
  'policy-blocked': ['Remote route blocked', 'route blocked'],
  timeout: ['Binding read timed out', 'binding read timed out'],
  transport: ['Remote binding read failed', 'binding read failed'],
  'invalid-data': ['Invalid binding response', 'invalid binding response'],
  'prepare-failed': ['Binding reconstruction failed', 'reconstruction failed']
};

/** Index Stage A once; thereafter consume only one owner's model delta at a time. */
export class LocalEnrichmentProjection {
  private readonly portIds: Map<string, string>;
  private readonly portsByNode = new Map<string, Set<string>>();
  private readonly knownConnections: Set<string>;
  private readonly displayOverrides = new Map<string, string>();
  private readonly failureCounts = new Map<RemoteEnrichmentFailure, number>();
  private readonly baseSummary: () => string;
  private readonly wirePairs: LocalWirePairs;

  constructor(private readonly graph: LocalGraph, initial: LocalGraphProjection) {
    this.portIds = new Map(initial.socketIds);
    this.wirePairs = initial.wirePairs;
    this.knownConnections = new Set(graph.connections.keys());
    this.baseSummary = createLocalSummary(graph);
    for (const { id, nodeId } of graph.ports.values()) this.indexPort(nodeId, id);
  }

  private indexPort(nodeId: string, id: string): void {
    const ports = this.portsByNode.get(nodeId) ?? new Set<string>();
    ports.add(id);
    this.portsByNode.set(nodeId, ports);
  }

  apply(result: RemoteEnrichmentResult<LocalGraph>, scene: LiveLocalScene): Set<string> {
    const { graph } = this;
    const ownerId = result.owner.id;
    const delta = applyRemoteEnrichmentResult(graph, result);
    if (result.outcome === 'unsuccessful') {
      this.failureCounts.set(result.reason, (this.failureCounts.get(result.reason) ?? 0) + 1);
      this.displayOverrides.set(ownerId, failures[result.reason][0]);
      const failedNode = graph.nodes.get(ownerId)!;
      failedNode.inspectionState = 'failed';
      failedNode.displayFailure = failures[result.reason][0];
      if (result.reason === 'timeout') failedNode.displayFailure = 'Binding read timed out';
      else if (result.reason === 'lookup-timeout') failedNode.displayFailure = 'Discovery timed out';
      else if (result.reason === 'lookup-transport') failedNode.displayFailure = 'Discovery failed';
      else if (result.reason === 'lookup-invalid-data') failedNode.displayFailure = 'Invalid discovery response';
      else if (result.reason === 'transport') failedNode.displayFailure = 'Remote binding read failed';
      else if (result.reason === 'invalid-data') failedNode.displayFailure = 'Invalid binding response';
      else if (result.reason === 'no-route') failedNode.displayFailure = 'No usable remote route';
      else if (result.reason === 'policy-blocked') failedNode.displayFailure = 'Remote route blocked';
      failedNode.lookupState = result.reason === 'lookup-invalid-data' ? 'invalid'
        : result.reason === 'lookup-timeout' || result.reason === 'lookup-transport' ? 'failed' : result.lookupState;
      if (result.hostEvidence !== undefined) failedNode.hostEvidence = result.hostEvidence;
    } else {
      this.displayOverrides.delete(ownerId);
      const owner = graph.nodes.get(ownerId)!;
      delete owner.displayFailure;
      if (result.outcome === 'cutoff') owner.displayFailure = 'Inspection stopped at cutoff';
      else if (result.outcome === 'partial') owner.displayFailure = 'Bindings partially loaded';
      if (result.outcome === 'partial') this.displayOverrides.set(ownerId, 'Bindings partially loaded');
    }

    const rowsChanged = new Set<string>();
    const dirtyWires = new Set<string>();
    for (const portId of delta.portIds) {
      const port = graph.ports.get(portId)!;
      this.indexPort(port.nodeId, portId);
      rowsChanged.add(port.nodeId);
    }
    const projectPorts = (id: string) => [...(this.portsByNode.get(id) ?? [])]
      .map((portId) => graph.ports.get(portId)!).sort(compareLocalPorts).map((port) => {
        const projected = projectLocalPort(port);
        this.portIds.set(port.id, projected.id);
        return projected;
      });

    const insertions: ProjectedLocalNode[] = [];
    // Use the mutation's logical-ID order for peers first inserted by this result.
    for (const id of delta.nodeIds) {
      const node = graph.nodes.get(id)!;
      const cardId = localCardId(id);
      const status = projectLocalCardStatus(node);
      status.displayStatus = this.displayOverrides.get(id) ?? status.displayStatus;
      if (scene.nodes.has(cardId)) {
        const patch = { id: cardId, name: node.name, origin: node.origin, localPathName: node.localPathName, ...status, ...(rowsChanged.has(id) ? { ports: projectPorts(id) } : {}) };
        for (const dirty of scene.patchCard(patch)) dirtyWires.add(dirty);
      } else {
        insertions.push({ ...projectLocalCard(node, projectPorts(id), { x: 0, y: 0 }), ...status });
      }
    }

    // Scope flow-side decisions to these new wires so later references never move a peer.
    const owner = scene.nodes.get(localCardId(ownerId));
    const incoming = new Set<string>();
    const outgoing = new Set<string>();
    const newWires: ProjectedLocalEdge[] = [];
    for (const id of delta.connectionIds) {
      if (this.knownConnections.has(id)) continue; // e.g. an equivalent spelling changes, not the wire.
      const wire = projectLocalWire(graph, graph.connections.get(id)!, this.portIds);
      this.knownConnections.add(id);
      newWires.push(wire);
      if (wire.from.nodeId === owner?.id) outgoing.add(wire.to.nodeId);
      if (wire.to.nodeId === owner?.id) incoming.add(wire.from.nodeId);
    }
    for (const card of insertions) {
      if (owner) Object.assign(card, placeEnrichedPeer(card, owner, incoming.has(card.id) && !outgoing.has(card.id) ? -1 : 1, scene.nodes.values()));
      scene.addCard(card);
    }
    for (const wire of newWires) {
      this.wirePairs.add(wire);
      scene.addWire(wire);
      dirtyWires.add(wire.id);
    }
    if (dirtyWires.size) {
      const laneChanges = this.wirePairs.update(dirtyWires, scene.nodes);
      for (const id of laneChanges) dirtyWires.add(id);
    }
    return dirtyWires;
  }

  summary({ counts }: RemoteEnrichmentBatch<LocalGraph>): string {
    const parts = [this.baseSummary(), `${counts.read} inspected`];
    if (counts.partial) parts.push(`${counts.partial} partial`);
    for (const [reason, [, label]] of Object.entries(failures)) {
      const count = this.failureCounts.get(reason as RemoteEnrichmentFailure);
      if (count) parts.push(`${count} ${label}`);
    }
    if (counts.cutoff) parts.push(`${counts.cutoff} not inspected before cutoff`);
    const remaining = counts.total - counts.read - counts.partial - counts.unsuccessful - counts.cutoff;
    if (remaining) parts.push(`${remaining} awaiting inspection`);
    return parts.join(' · ');
  }
}
