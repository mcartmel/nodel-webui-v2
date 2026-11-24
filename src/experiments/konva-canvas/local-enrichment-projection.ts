import { cardHeight, type FixtureNode } from './fixture';
import { placeEnrichedPeer } from './enrichment-placement';
import { applyRemoteDiscovery, applyRemoteEnrichmentResult, type LocalGraph } from './local-graph';
import type { LocalSnapshot } from './local-snapshot';
import { mergePreviewLocalInventory } from './preview-coordinator';
import { compareLocalPorts, disconnectedInventoryAnchor, placeDisconnectedInventoryCard, placeLocalGraph } from './local-placement';
import {
  localCardId, localTopologyProgressSummary, projectLocalCard, projectLocalCardStatus, projectLocalPort, projectLocalWire,
  LocalWirePairs, type LocalGraphProjection, type ProjectedLocalEdge, type ProjectedLocalNode, type TopologySchedulerLifecycle
} from './local-projection';
import type { RemoteEnrichmentBatch, RemoteEnrichmentFailure, RemoteEnrichmentResult, RemoteDiscovery } from './remote-enrichment';

export type LocalCardPatch = Pick<ProjectedLocalNode, 'id' | 'name' | 'displayStatus' | 'displayQualifier' | 'statusKind' | 'hostKind' | 'origin' | 'hostDescription' | 'tooltip'> & { localPathName?: ProjectedLocalNode['localPathName']; ports?: ProjectedLocalNode['ports'] };

export interface LocalEnrichmentProjectionOptions {
  /** IDs mounted in the initial scene; omitted means the whole initial projection. */
  readonly displayedNodeIds?: Iterable<string>;
  /** Deferred advertised names remain model-only until terminal evidence or Show all. */
  readonly deferredNodeIds?: Iterable<string>;
  readonly frameBatchSize?: number;
  readonly viewportHeight?: number | (() => number);
}

export interface LocalProjectionCounts {
  readonly discovered: number;
  readonly shown: number;
  readonly inspected: number;
  readonly deferred: number;
}

/** Filter only the initial renderer projection; the backing LocalGraph remains complete. */
export function restrictLocalGraphProjection(
  graph: LocalGraph,
  projection: LocalGraphProjection,
  shownNodeIds: ReadonlySet<string>
): LocalGraphProjection {
  const shownCardIds = new Set([...shownNodeIds].map(localCardId));
  const nodes = projection.nodes.filter(({ id }) => shownCardIds.has(id));
  const edges = projection.edges.filter(({ from, to }) => shownCardIds.has(from.nodeId) && shownCardIds.has(to.nodeId));
  const socketIds = new Map([...projection.socketIds].filter(([portId]) => shownNodeIds.has(graph.ports.get(portId)?.nodeId ?? '')));
  const wirePairs = new LocalWirePairs();
  for (const edge of edges) wirePairs.add(edge);
  wirePairs.update(edges.map(({ id }) => id), new Map(nodes.map((node) => [node.id, node])));
  return { ...projection, nodes, edges, socketIds, wirePairs };
}

interface LiveLocalScene {
  readonly nodes: ReadonlyMap<string, FixtureNode>;
  occupiedNodes?(): Iterable<FixtureNode>;
  /** Return incident wires whose attachment or routing geometry can change. */
  patchCard(card: LocalCardPatch): Iterable<string>;
  addCard(card: ProjectedLocalNode): void;
  addWire(wire: ProjectedLocalEdge): void;
}

const failures: Record<RemoteEnrichmentFailure, [card: string, count: string]> = {
  'lookup-timeout': ['Lookup failed', 'lookup failed'],
  'lookup-transport': ['Lookup failed', 'lookup failed'],
  'lookup-invalid-data': ['Invalid discovery response', 'invalid discovery response'],
  'lookup-limited': ['Invalid discovery response', 'invalid discovery response'],
  'lookup-interrupted': ['Not inspected', 'not inspected'],
  'no-route': ['No advertised route', 'no advertised route'],
  'policy-blocked': ['Remote route blocked', 'route blocked'],
  timeout: ['Unreachable', 'unreachable'],
  transport: ['Unreachable', 'unreachable'],
  'invalid-data': ['Invalid response', 'invalid response'],
  'prepare-failed': ['Invalid response', 'invalid response']
};

/** Index Stage A once; thereafter consume only one owner's model delta at a time. */
export class LocalEnrichmentProjection {
  private readonly portIds: Map<string, string>;
  private readonly portsByNode = new Map<string, Set<string>>();
  private readonly knownConnections: Set<string>;
  private readonly displayOverrides = new Map<string, string>();
  private readonly wirePairs: LocalWirePairs;
  private readonly displayedNodeIds = new Set<string>();
  private readonly deferredNodeIds = new Set<string>();
  private readonly revealQueue = new Set<string>();
  private readonly frameBatchSize: number;
  private readonly viewportHeight: number | (() => number) | undefined;
  private showAll = false;
  private disconnectedOrdinal = 0;
  private disconnectedAnchor?: { x: number; y: number };

  constructor(private readonly graph: LocalGraph, initial: LocalGraphProjection, options: LocalEnrichmentProjectionOptions = {}) {
    this.portIds = new Map(initial.socketIds);
    this.wirePairs = initial.wirePairs;
    this.knownConnections = new Set(graph.connections.keys());
    this.frameBatchSize = Math.max(1, Math.floor(options.frameBatchSize ?? 8));
    this.viewportHeight = options.viewportHeight;
    const initiallyDisplayed = options.displayedNodeIds ?? initial.nodes.map(({ id }) => this.nodeIdFromCard(id));
    for (const id of initiallyDisplayed) this.displayedNodeIds.add(id);
    for (const id of options.deferredNodeIds ?? []) if (!this.displayedNodeIds.has(id)) this.deferredNodeIds.add(id);
    for (const { id, nodeId } of graph.ports.values()) this.indexPort(nodeId, id);
  }

  /** Enable the session-only Show all override and queue names in stable order. */
  revealAll(): boolean {
    this.showAll = true;
    for (const node of [...this.graph.nodes.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : 1)) {
      if (!this.displayedNodeIds.has(node.id)) this.revealQueue.add(node.id);
    }
    return this.revealQueue.size > 0;
  }

  /** Mount at most one bounded frame batch; caller schedules the next animation frame if true. */
  drainFrame(scene: LiveLocalScene, limit = this.frameBatchSize): boolean {
    const batch = [...this.revealQueue].sort((a, b) => {
      const left = this.graph.nodes.get(a)!;
      const right = this.graph.nodes.get(b)!;
      return left.key < right.key ? -1 : left.key > right.key ? 1 : left.id < right.id ? -1 : 1;
    }).slice(0, Math.max(1, Math.min(this.frameBatchSize, Math.floor(limit))));
    for (const id of batch) {
      this.revealQueue.delete(id);
      this.deferredNodeIds.delete(id);
      const node = this.graph.nodes.get(id);
      if (!node || this.displayedNodeIds.has(id)) continue;
      this.mountCard(projectLocalCard(node, this.projectPorts(id), { x: 0, y: 0 }, this.currentViewportHeight()), scene);
    }
    return this.revealQueue.size > 0;
  }

  counts(): LocalProjectionCounts {
    let inspected = 0;
    for (const node of this.graph.nodes.values()) {
      if (node.origin === 'local' ? node.bindingsRead === 'read' || node.bindingsRead === 'partial'
        : node.inspectionState === 'read' || node.inspectionState === 'partial') inspected += 1;
    }
    return { discovered: this.graph.nodes.size, shown: this.displayedNodeIds.size, inspected, deferred: this.deferredNodeIds.size };
  }

  shouldOfferShowAll(): boolean { return this.deferredNodeIds.size > 0; }

  private projectPorts(nodeId: string): ProjectedLocalNode['ports'] {
    return [...(this.portsByNode.get(nodeId) ?? [])].map((portId) => this.graph.ports.get(portId)!).sort(compareLocalPorts).map((port) => {
      const projected = projectLocalPort(port);
      this.portIds.set(port.id, projected.id);
      return projected;
    });
  }

  private currentViewportHeight(): number {
    const height = typeof this.viewportHeight === 'function' ? this.viewportHeight() : this.viewportHeight;
    // Zero selects the minimum bounded row budget. Undefined would instead
    // opt out of footprints altogether, leaving early late cards uncapped.
    return height !== undefined && Number.isFinite(height) && height > 0 ? height : 0;
  }

  private placeConnectedBatch(cards: readonly ProjectedLocalNode[], wires: readonly ProjectedLocalEdge[], scene: LiveLocalScene): void {
    if (!cards.length) return;
    const cardsById = new Map(cards.map(card => [card.id, card]));
    const placed = new Set<string>();
    const occupied = [...(scene.occupiedNodes?.() ?? scene.nodes.values())];
    type Peer = { id: string; side: -1 | 1 };
    const neighbors = new Map<string, Peer[]>();
    const link = (id: string, peer: Peer) => {
      const list = neighbors.get(id) ?? [];
      list.push(peer); neighbors.set(id, list);
    };
    for (const { from, to } of wires) {
      link(from.nodeId, { id: to.nodeId, side: 1 });
      link(to.nodeId, { id: from.nodeId, side: -1 });
    }
    const queue = [...neighbors.keys()].sort().flatMap(id => scene.nodes.get(id) ?? []);
    for (let index = 0; index < queue.length; index++) {
      const anchor = queue[index]!;
      for (const side of [1, -1] as const) {
        const peers: ProjectedLocalNode[] = [];
        for (const peer of neighbors.get(anchor.id) ?? []) {
          const card = cardsById.get(peer.id);
          if (peer.side !== side || !card || placed.has(card.id)) continue;
          placed.add(card.id); peers.push(card);
        }
        if (!peers.length) continue;
        peers.sort((a, b) => a.id < b.id ? -1 : 1);
        if (peers.length === 1) Object.assign(peers[0]!, placeEnrichedPeer(peers[0]!, anchor, side, occupied));
        else {
          // Pack siblings in one flow column. Sweep each obstacle once, not
          // once per trial slot; reserve the entire group before the next seed.
          const gap = 28, width = Math.max(...peers.map(card => card.width));
          const x = side === 1 ? anchor.x + anchor.width + 150 : anchor.x - width - 150;
          const obstacles = occupied.filter(card => card.x < x + width + gap && x < card.x + card.width + gap).sort((a, b) => a.y - b.y);
          let cursor = 0, y = anchor.y - peers.reduce((sum, card) => sum + cardHeight(card) + gap, 0) / 2;
          for (const card of peers) {
            const height = cardHeight(card);
            while (cursor < obstacles.length && obstacles[cursor]!.y < y + height + gap) {
              const other = obstacles[cursor++]!;
              y = Math.max(y, other.y + cardHeight(other) + gap);
            }
            Object.assign(card, { x, y }); y += height + gap;
          }
        }
        for (const card of peers) { occupied.push(card); queue.push(card); }
      }
    }

    const unplacedIds = new Set(cards.filter(card => !placed.has(card.id)).map(card => this.nodeIdFromCard(card.id)));
    if (!unplacedIds.size) return;
    const isolated = [...unplacedIds].filter((id) => !(neighbors.get(localCardId(id))?.length)).sort();
    const stagedIsolated: FixtureNode[] = [];
    for (const id of isolated) {
      const card = cardsById.get(localCardId(id))!;
      this.positionDisconnectedCard(card, scene, stagedIsolated);
      stagedIsolated.push(card);
      unplacedIds.delete(id);
    }
    if (!unplacedIds.size) return;
    const subgraph: LocalGraph = {
      ...this.graph,
      nodes: new Map([...this.graph.nodes].filter(([id]) => unplacedIds.has(id))),
      ports: new Map([...this.graph.ports].filter(([, port]) => unplacedIds.has(port.nodeId))),
      connections: new Map([...this.graph.connections].filter(([, connection]) => {
        const from = this.graph.ports.get(connection.fromPortId)?.nodeId;
        const to = this.graph.ports.get(connection.toPortId)?.nodeId;
        return !!from && !!to && unplacedIds.has(from) && unplacedIds.has(to);
      }))
    };
    const positions = placeLocalGraph(subgraph, { viewportHeight: this.currentViewportHeight() });
    const laidOut = [...positions.values()];
    const minimumX = Math.min(0, ...laidOut.map(({ x }) => x));
    const minimumY = Math.min(0, ...laidOut.map(({ y }) => y));
    const anchor = occupied.length ? disconnectedInventoryAnchor(occupied) : { x: 0, y: 0 };
    for (const nodeId of unplacedIds) {
      const card = cardsById.get(localCardId(nodeId))!;
      const point = positions.get(nodeId) ?? { x: 0, y: 0 };
      card.x = anchor.x + point.x - minimumX;
      card.y = anchor.y + point.y - minimumY;
    }
  }

  private mountCard(card: ProjectedLocalNode, scene: LiveLocalScene): void {
    const nodeId = this.nodeIdFromCard(card.id);
    if (this.displayedNodeIds.has(nodeId)) return;
    this.positionDisconnectedCard(card, scene);
    this.displayedNodeIds.add(nodeId);
    scene.addCard(card);
  }

  private positionDisconnectedCard(card: ProjectedLocalNode, scene: LiveLocalScene, staged: readonly FixtureNode[] = []): void {
    this.disconnectedAnchor ??= disconnectedInventoryAnchor(scene.nodes.values());
    const { position, nextSlot } = placeDisconnectedInventoryCard(card, this.disconnectedOrdinal, this.disconnectedAnchor,
      [...(scene.occupiedNodes?.() ?? scene.nodes.values()), ...staged]);
    this.disconnectedOrdinal = nextSlot;
    card.x = position.x;
    card.y = position.y;
  }

  private nodeIdFromCard(cardId: string): string {
    for (const id of this.graph.nodes.keys()) if (localCardId(id) === cardId) return id;
    return cardId;
  }

  private indexPort(nodeId: string, id: string): void {
    const ports = this.portsByNode.get(nodeId) ?? new Set<string>();
    ports.add(id);
    this.portsByNode.set(nodeId, ports);
  }

  /** Publish inventory evidence independently from binding results. */
  applyDiscoveries(discoveries: readonly RemoteDiscovery[], scene: LiveLocalScene): void {
    const inserted: ProjectedLocalNode[] = [];
    for (const discovery of discoveries) {
      const mutation = applyRemoteDiscovery(this.graph, discovery);
      if (!mutation.nodeIds.length) continue;
      const node = this.graph.nodes.get(discovery.owner.id);
      if (!node) continue;
      const cardId = localCardId(node.id);
      const status = projectLocalCardStatus(node);
      if (scene.nodes.has(cardId)) {
        scene.patchCard({ id: cardId, name: node.name, origin: node.origin, localPathName: node.localPathName, ...status });
      } else {
        const terminal = node.origin === 'local' || node.inspectionState === 'read' || node.inspectionState === 'partial' ||
          node.inspectionState === 'failed' || node.inspectionState === 'cutoff' ||
          node.lookupState === 'no-route' || node.lookupState === 'invalid' || node.lookupState === 'failed' || node.lookupState === 'blocked' ||
          [...this.graph.connections.values()].some((wire) => this.graph.ports.get(wire.fromPortId)?.nodeId === node.id || this.graph.ports.get(wire.toPortId)?.nodeId === node.id);
        if (this.showAll) this.revealQueue.add(node.id);
        else if (this.deferredNodeIds.has(node.id) || (this.graph.nodes.size > 40 && !terminal)) this.deferredNodeIds.add(node.id);
        else inserted.push(projectLocalCard(node, [], { x: 0, y: 0 }, this.currentViewportHeight()));
      }
    }
    if (!inserted.length) return;

    // Disconnected inventory cards occupy a deterministic wrapping grid beyond
    // current groups instead of stacking at the origin or moving known cards.
    this.disconnectedAnchor ??= disconnectedInventoryAnchor(scene.nodes.values());
    inserted.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const card of inserted) {
      this.mountCard(card, scene);
    }
  }

  /** Promote inventory-only local names; their later binding result flows through apply(). */
  applyLocalInventory(snapshot: LocalSnapshot, scene: LiveLocalScene): Set<string> {
    const previousConnections = new Set(this.graph.connections.keys());
    const changedNodes = mergePreviewLocalInventory(this.graph, snapshot);
    if (!changedNodes.length) return new Set();
    const changedIds = new Set(changedNodes.map(({ id }) => id));
    for (const port of this.graph.ports.values()) if (changedIds.has(port.nodeId)) this.indexPort(port.nodeId, port.id);

    const newlyConnectedNodeIds = new Set<string>();
    const newConnections = [...this.graph.connections.values()].filter(({ id }) => !previousConnections.has(id));
    for (const connection of newConnections) {
      const from = this.graph.ports.get(connection.fromPortId)?.nodeId;
      const to = this.graph.ports.get(connection.toPortId)?.nodeId;
      if (from) newlyConnectedNodeIds.add(from);
      if (to) newlyConnectedNodeIds.add(to);
    }
    const toMount = new Set([...changedIds, ...newlyConnectedNodeIds]);
    const portList = (nodeId: string) => [...(this.portsByNode.get(nodeId) ?? [])]
      .map((portId) => this.graph.ports.get(portId)!).sort(compareLocalPorts).map((port) => {
        const projected = projectLocalPort(port);
        this.portIds.set(port.id, projected.id);
        return projected;
      });
    const inserted: ProjectedLocalNode[] = [];
    const dirtyWires = new Set<string>();
    for (const id of toMount) {
      const node = this.graph.nodes.get(id);
      if (!node) continue;
      const cardId = localCardId(id);
      if (scene.nodes.has(cardId)) {
        this.displayedNodeIds.add(id);
        const patch = { id: cardId, name: node.name, origin: node.origin, localPathName: node.localPathName, ...projectLocalCardStatus(node), ports: portList(id) };
        for (const wireId of scene.patchCard(patch)) dirtyWires.add(wireId);
      } else inserted.push(projectLocalCard(node, portList(id), { x: 0, y: 0 }, this.currentViewportHeight()));
    }
    const newWires = newConnections.map((connection) => projectLocalWire(this.graph, connection, this.portIds));
    this.placeConnectedBatch(inserted, newWires, scene);
    for (const card of inserted) {
      const nodeId = this.nodeIdFromCard(card.id);
      this.displayedNodeIds.add(nodeId);
      this.deferredNodeIds.delete(nodeId);
      scene.addCard(card);
    }
    for (const wire of newWires) {
      const connection = newConnections.find(({ id }) => id === wire.id)!;
      this.knownConnections.add(connection.id);
      this.wirePairs.add(wire);
      scene.addWire(wire);
      dirtyWires.add(wire.id);
    }
    if (dirtyWires.size) for (const wireId of this.wirePairs.update(dirtyWires, scene.nodes)) dirtyWires.add(wireId);
    return dirtyWires;
  }

  apply(result: RemoteEnrichmentResult<LocalGraph>, scene: LiveLocalScene): Set<string> {
    const { graph } = this;
    const ownerId = result.owner.id;
    const delta = applyRemoteEnrichmentResult(graph, result);
    if (result.outcome === 'unsuccessful') {
      const failedNode = graph.nodes.get(ownerId)!;
      failedNode.inspectionState = result.reason === 'lookup-interrupted' ? 'not-inspected' : 'failed';
      const failure = result.reason === 'policy-blocked' && result.issues.includes('identity-conflict')
        ? 'Identity unresolved' : failures[result.reason][0];
      failedNode.displayFailure = failure;
      this.displayOverrides.set(ownerId, failure);
      failedNode.lookupState = result.reason === 'lookup-interrupted' ? 'pending'
        : result.reason === 'lookup-invalid-data' || result.reason === 'lookup-limited' ? 'invalid'
        : result.reason === 'lookup-timeout' || result.reason === 'lookup-transport' ? 'failed' : result.lookupState;
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
    const nodesToProject = new Set(delta.nodeIds);
    nodesToProject.add(ownerId); // A terminal inspection makes even a name-only owner displayable.
    for (const id of delta.connectionIds) {
      const connection = graph.connections.get(id);
      if (!connection) continue;
      const from = graph.ports.get(connection.fromPortId)?.nodeId;
      const to = graph.ports.get(connection.toPortId)?.nodeId;
      if (from) nodesToProject.add(from);
      if (to) nodesToProject.add(to);
    }
    // Use the mutation's logical-ID order for peers first inserted by this result.
    for (const id of [...nodesToProject].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
      const node = graph.nodes.get(id);
      if (!node) continue;
      const cardId = localCardId(id);
      const status = projectLocalCardStatus(node);
      status.displayStatus = this.displayOverrides.get(id) ?? status.displayStatus;
      if (scene.nodes.has(cardId)) {
        this.displayedNodeIds.add(id);
        this.deferredNodeIds.delete(id);
        const patch = { id: cardId, name: node.name, origin: node.origin, localPathName: node.localPathName, ...status, ...(rowsChanged.has(id) ? { ports: projectPorts(id) } : {}) };
        for (const dirty of scene.patchCard(patch)) dirtyWires.add(dirty);
      } else {
        insertions.push({ ...projectLocalCard(node, projectPorts(id), { x: 0, y: 0 }, this.currentViewportHeight()), ...status });
      }
    }

    // Scope flow-side decisions to these new wires so later references never move a peer.
    const newWires: ProjectedLocalEdge[] = [];
    for (const id of delta.connectionIds) {
      if (this.knownConnections.has(id)) continue; // e.g. an equivalent spelling changes, not the wire.
      const wire = projectLocalWire(graph, graph.connections.get(id)!, this.portIds);
      this.knownConnections.add(id);
      newWires.push(wire);
    }
    this.placeConnectedBatch(insertions, newWires, scene);
    for (const card of insertions) {
      const nodeId = this.nodeIdFromCard(card.id);
      this.displayedNodeIds.add(nodeId);
      this.deferredNodeIds.delete(nodeId);
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

  summary(changes: RemoteEnrichmentBatch<LocalGraph>, lifecycle?: TopologySchedulerLifecycle): string {
    const counts = this.counts();
    const shown = `${counts.discovered} discovered · ${counts.shown} shown · ${counts.inspected} inspected`;
    const deferred = counts.deferred ? ` · ${counts.deferred} deferred` : '';
    return `${shown}${deferred} · ${localTopologyProgressSummary(this.graph, changes, lifecycle)}`;
  }
}
