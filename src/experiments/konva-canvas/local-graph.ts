import { javaSimpleNameKey } from './local-simple-name';
import type { LocalSnapshot as BoundedLocalSnapshot } from './local-snapshot';
import type { RemoteEnrichmentLookupState, RemoteEnrichmentResult } from './remote-enrichment';
import type { NodelRemoteBindings } from '../../api/nodel-types';
import { isUsableNodeName } from '../../utils/node-name';

export type LocalReadState = 'read' | 'partial' | 'unread' | 'not-requested';
export type LocalBindingKind = 'action' | 'event';

/** A decoded assignment row. Missing fields are intentional and mean incomplete. */
export interface LocalAssignmentRow {
  alias: string;
  node?: string;
  endpoint?: string;
  malformed?: boolean;
}

export interface LocalOwnerSnapshot {
  name: string;
  readState: LocalReadState;
  actions?: readonly LocalAssignmentRow[];
  events?: readonly LocalAssignmentRow[];
}

export interface LocalSnapshot {
  /** Names from the one local inventory response, whether readable or not. */
  locals: readonly LocalOwnerSnapshot[];
}

/** Adapt the bounded GET snapshot without leaking API shapes into the graph model. */
export function graphInputFromLocalSnapshot(snapshot: BoundedLocalSnapshot): LocalSnapshot {
  const stringField = (value: unknown, key: string): string | undefined => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const field = (value as Record<string, unknown>)[key];
    return typeof field === 'string' ? field : undefined;
  };
  return {
    locals: snapshot.owners.map((owner) => {
      const readState: LocalReadState = owner.status === 'read' ? 'read' : 'unread';
      const rows = (section: Readonly<Record<string, unknown>> | undefined, kind: LocalBindingKind): LocalAssignmentRow[] =>
        Object.entries(section ?? {}).map(([alias, value]) => {
          const malformed = value === null || typeof value !== 'object' || Array.isArray(value);
          const node = stringField(value, 'node');
          const endpoint = stringField(value, kind);
          const hasNode = value !== null && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'node');
          const hasEndpoint = value !== null && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, kind);
          return { alias, ...(node === undefined ? {} : { node }), ...(endpoint === undefined ? {} : { endpoint }),
            ...((malformed || (hasNode && node === undefined) || (hasEndpoint && endpoint === undefined)) ? { malformed: true } : {}) };
        });
      return {
        name: owner.name,
        readState,
        ...(owner.status === 'read' ? {
          actions: rows(owner.bindings.actions, 'action'),
          events: rows(owner.bindings.events, 'event')
        } : {})
      };
    })
  };
}

export type LocalPortKind = 'remote-action' | 'remote-event' | 'local-action' | 'local-event';

export interface LocalGraphNode {
  id: string;
  key: string;
  name: string;
  origin: 'local' | 'referenced';
  bindingsRead: LocalReadState;
  /** Known canonical aliases and the subset with usable node+endpoint assignments. */
  bindingCounts?: { readonly set: number; readonly total: number };
  /** Independent one-hop discovery/inspection state; local reads remain authoritative. */
  lookupState?: RemoteLookupState;
  inspectionState?: RemoteInspectionState;
  displayFailure?: string;
  /** Sanitized URL.host from unambiguous validated advertisements, never a URL. */
  hostEvidence?: string;
}

export type RemoteLookupState = RemoteEnrichmentLookupState;
export type RemoteInspectionState = 'not-inspected' | 'read' | 'partial' | 'failed' | 'cutoff';

/** Structural scheduler contract; deliberately independent of its implementation module. */
export interface RemoteEnrichmentOwner {
  id: string;
  key: string;
  name: string;
}

export type RemoteOwnerInspection =
  | { readonly status: 'read'; readonly bindings?: NodelRemoteBindings }
  | { readonly status: 'partial'; readonly bindings?: NodelRemoteBindings }
  | { readonly status: 'failed' }
  | { readonly status: 'cutoff' };

export interface LocalGraphMutation {
  readonly nodeIds: readonly string[];
  readonly portIds: readonly string[];
  readonly connectionIds: readonly string[];
  readonly geometryChanged: boolean;
}

export interface RemoteInspectionCounts {
  readonly eligible: number;
  readonly inspected: number;
  readonly partial: number;
  readonly failed: number;
  readonly cutoff: number;
  readonly notInspected: number;
  readonly lookup: Readonly<Record<RemoteLookupState, number>>;
}

export interface LocalGraphPort {
  id: string;
  nodeId: string;
  kind: LocalPortKind;
  name: string;
  evidence: 'configured-alias' | 'referenced-endpoint';
}

export interface LocalGraphConnection {
  id: string;
  ownerId: string;
  alias: string;
  kind: LocalBindingKind;
  fromPortId: string;
  toPortId: string;
}

export interface LocalGraphConflict {
  ownerId: string;
  alias: string;
  kind: LocalBindingKind;
  rows: number;
}

export interface LocalGraph {
  nodes: Map<string, LocalGraphNode>;
  ports: Map<string, LocalGraphPort>;
  connections: Map<string, LocalGraphConnection>;
  conflicts: LocalGraphConflict[];
  incompleteAssignments: number;
  /** Fixed Stage-A worklist. Enrichment must not append second-hop references here. */
  eligibleRemoteOwners: readonly RemoteEnrichmentOwner[];
}

const conflictIndexes = new WeakMap<LocalGraph, Set<string>>();

const tupleId = (...parts: string[]): string => JSON.stringify(parts);
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const usableNameKey = (name: string): string | undefined => javaSimpleNameKey(name) || undefined;
const nameIdentity = (name: string): string => {
  const key = usableNameKey(name);
  return key ? `simple:${key}` : `opaque:${name}`;
};
const assignmentValueIdentity = (value: string | undefined): string => {
  if (value === undefined || value.length === 0) return '';
  const key = usableNameKey(value);
  return key ? `simple:${key}` : `invalid:${value}`;
};

function preferredSpelling(values: readonly (string | undefined)[]): string | undefined {
  const present = values.filter((value): value is string => value !== undefined && value.length > 0);
  const usable = present.filter(isUsableNodeName);
  return [...(usable.length ? usable : present)].sort(compareText)[0];
}

function conflictIdentity(conflict: LocalGraphConflict): string {
  return tupleId(conflict.ownerId, conflict.kind, nameIdentity(conflict.alias));
}

/** Java SimpleName matching key, retaining opaque names as exact identities. */
export function localNodeKey(name: string): string {
  const reduced = usableNameKey(name);
  return reduced ? `simple:${reduced}` : `opaque:${name}`;
}

function stableRows(rows: readonly LocalAssignmentRow[] | undefined): LocalAssignmentRow[] {
  return [...(rows ?? [])].sort((a, b) =>
    compareText(a.alias, b.alias) || compareText(a.node ?? '', b.node ?? '') || compareText(a.endpoint ?? '', b.endpoint ?? '')
  );
}

/** Reconstruct configured topology without network access or renderer dependencies. */
export function buildLocalGraph(snapshot: LocalSnapshot): LocalGraph {
  const nodes = new Map<string, LocalGraphNode>();
  const ports = new Map<string, LocalGraphPort>();
  const connections = new Map<string, LocalGraphConnection>();
  const conflicts: LocalGraphConflict[] = [];
  let incompleteAssignments = 0;

  const canonicalOwners = new Map<string, { names: Set<string>; owners: LocalOwnerSnapshot[] }>();
  for (const owner of snapshot.locals) {
    const key = localNodeKey(owner.name);
    const group = canonicalOwners.get(key) ?? { names: new Set<string>(), owners: [] };
    group.names.add(owner.name);
    group.owners.push(owner);
    canonicalOwners.set(key, group);
  }
  const ambiguousLocalKeys = new Set([...canonicalOwners].filter(([, group]) => group.names.size > 1).map(([key]) => key));
  // When multiple local spellings reduce to one logical name, choose a stable label.
  for (const [key, group] of [...canonicalOwners].sort(([a], [b]) => compareText(a, b))) {
    const label = [...group.names].sort(compareText)[0]!;
    const readState: LocalReadState = ambiguousLocalKeys.has(key) || group.owners.some((owner) => owner.readState === 'unread') ? 'unread'
      : group.owners.some((owner) => owner.readState === 'partial') ? 'partial'
        : group.owners.some((owner) => owner.readState === 'read') ? 'read' : 'not-requested';
    const id = tupleId('node', key);
    nodes.set(id, { id, key, name: label, origin: 'local', bindingsRead: readState });
  }

  const ensureReferenced = (name: string): LocalGraphNode => {
    const key = localNodeKey(name);
    const existing = nodes.get(tupleId('node', key));
    if (existing) {
      const existingUsable = isUsableNodeName(existing.name);
      const incomingUsable = isUsableNodeName(name);
      if (existing.origin === 'referenced' && incomingUsable && (!existingUsable || compareText(name, existing.name) < 0)) existing.name = name;
      return existing;
    }
    const node: LocalGraphNode = { id: tupleId('node', key), key, name, origin: 'referenced', bindingsRead: 'not-requested' };
    nodes.set(node.id, node);
    return node;
  };
  const ensurePort = (node: LocalGraphNode, kind: LocalPortKind, name: string, evidence: LocalGraphPort['evidence']): LocalGraphPort => {
    const id = tupleId('port', node.key, kind, nameIdentity(name));
    const old = ports.get(id);
    if (old) return old;
    const port = { id, nodeId: node.id, kind, name, evidence };
    ports.set(id, port);
    return port;
  };
  const markPartial = (owner: LocalGraphNode): void => {
    if (owner.bindingsRead === 'read') owner.bindingsRead = 'partial';
  };

  const byOwner = [...canonicalOwners].flatMap(([key, group]) => group.owners.map((owner) => ({ key, owner })))
    .sort((a, b) => compareText(a.key, b.key) || compareText(a.owner.name, b.owner.name));
  for (const { key, owner: ownerSnapshot } of byOwner) {
    if (ambiguousLocalKeys.has(key)) continue;
    const owner = nodes.get(tupleId('node', key))!;
    for (const [kind, rows] of [['action', ownerSnapshot.actions], ['event', ownerSnapshot.events]] as const) {
      const aliasGroups = new Map<string, LocalAssignmentRow[]>();
      for (const row of stableRows(rows)) {
        if (ownerSnapshot.readState !== 'read' && ownerSnapshot.readState !== 'partial') continue;
        const aliasKey = usableNameKey(row.alias);
        if (!aliasKey) {
          incompleteAssignments += 1;
          markPartial(owner);
          continue;
        }
        const groupKey = tupleId(kind, aliasKey);
      const group = aliasGroups.get(groupKey) ?? [];
        group.push(row);
        aliasGroups.set(groupKey, group);
      }
      for (const group of aliasGroups.values()) {
        const signatures = new Set(group.map((row) => {
          return tupleId(assignmentValueIdentity(row.node), assignmentValueIdentity(row.endpoint), String(Boolean(row.malformed)));
        }));
        const alias = preferredSpelling(group.map((row) => row.alias)) ?? group[0]!.alias;
        if (signatures.size > 1) {
          conflicts.push({ ownerId: owner.id, alias, kind, rows: group.length });
          markPartial(owner);
          continue;
        }
        if (group.some((row) => row.malformed)) {
          incompleteAssignments += 1;
          markPartial(owner);
          continue;
        }
        const targetName = preferredSpelling(group.map((row) => row.node));
        const endpoint = preferredSpelling(group.map((row) => row.endpoint));
        const targetKey = targetName === undefined ? undefined : usableNameKey(targetName);
        const endpointKey = endpoint === undefined ? undefined : usableNameKey(endpoint);
        // A configured alias is either set (both values usable) or simply unset.
        // Unset rows are ordinary configuration, not malformed reads, and must
        // not create a provisional target or affect the frozen lookup worklist.
        if (!targetKey && !endpointKey) {
          if ((targetName?.length ?? 0) > 0 || (endpoint?.length ?? 0) > 0) { incompleteAssignments += 1; markPartial(owner); }
          continue;
        }
        if (!targetKey || !targetName || !endpointKey || !endpoint) {
          const invalidNode = targetName !== undefined && targetName.length > 0 && !targetKey;
          const invalidEndpoint = endpoint !== undefined && endpoint.length > 0 && !endpointKey;
          if (invalidNode || invalidEndpoint) { incompleteAssignments += 1; markPartial(owner); }
          continue;
        }

        const target = ensureReferenced(targetName);
        const remoteKind: LocalPortKind = kind === 'action' ? 'remote-action' : 'remote-event';
        const localKind: LocalPortKind = kind === 'action' ? 'local-action' : 'local-event';
        const aliasPort = ensurePort(owner, remoteKind, alias, 'configured-alias');
        const endpointPort = ensurePort(target, localKind, endpoint, 'referenced-endpoint');
        const from = kind === 'action' ? aliasPort : endpointPort;
        const to = kind === 'action' ? endpointPort : aliasPort;
        const id = tupleId('binding', owner.key, kind, nameIdentity(alias));
        connections.set(id, { id, ownerId: owner.id, alias, kind, fromPortId: from.id, toPortId: to.id });
      }
      const count = owner.bindingCounts ?? { set: 0, total: 0 };
      let total = count.total;
      let set = count.set;
      for (const group of aliasGroups.values()) {
        const signatures = new Set(group.map((row) => tupleId(
          assignmentValueIdentity(row.node), assignmentValueIdentity(row.endpoint), String(Boolean(row.malformed))
        )));
        if (group.some((row) => row.malformed) || signatures.size !== 1) continue;
        total += 1;
        const row = group[0]!;
        if (row.node !== undefined && row.endpoint !== undefined && usableNameKey(row.node) && usableNameKey(row.endpoint)) set += 1;
      }
      owner.bindingCounts = { set, total };
    }
  }
  conflicts.sort((a, b) => compareText(a.ownerId, b.ownerId) || compareText(a.kind, b.kind) || compareText(a.alias, b.alias));
  const eligibleRemoteOwners = Object.freeze([...nodes.values()]
    .filter((node) => node.origin === 'referenced' && Boolean(usableNameKey(node.name)) && isUsableNodeName(node.name))
    .sort((a, b) => compareText(a.key, b.key))
    .map((node) => Object.freeze({ id: node.id, key: node.key, name: node.name })));
  const graph = { nodes, ports, connections, conflicts, incompleteAssignments, eligibleRemoteOwners };
  conflictIndexes.set(graph, new Set(conflicts.map(conflictIdentity)));
  return graph;
}

/** Decode a successful bindings body into the existing row-reconstruction input. */
export function prepareRemoteOwnerInspection(
  owner: RemoteEnrichmentOwner,
  bindings: NodelRemoteBindings
): { outcome: 'read' | 'partial'; prepared: LocalGraph } {
  const rows = (section: Readonly<Record<string, unknown>> | undefined, kind: LocalBindingKind): LocalAssignmentRow[] =>
    Object.entries(section ?? {}).map(([alias, value]) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return { alias, malformed: true };
      const record = value as Record<string, unknown>;
      const endpoint = record[kind];
      return {
        alias,
        ...(typeof record.node === 'string' ? { node: record.node } : {}),
        ...(typeof endpoint === 'string' ? { endpoint } : {}),
        ...((Object.hasOwn(record, 'node') && typeof record.node !== 'string') || (Object.hasOwn(record, kind) && typeof endpoint !== 'string') ? { malformed: true } : {})
      };
    });
  const prepared = buildLocalGraph({ locals: [{ name: owner.name, readState: 'read', actions: rows(bindings.actions, 'action'), events: rows(bindings.events, 'event') }] });
  const localOwner = prepared.nodes.get(owner.id);
  return { outcome: localOwner?.bindingsRead === 'partial' ? 'partial' : 'read', prepared };
}

/** Set read status without changing connections or local binding state. */
export function setRemoteOwnerState(
  graph: LocalGraph,
  ownerId: string,
  state: { readonly lookup?: RemoteLookupState; readonly inspection?: RemoteInspectionState; readonly hostEvidence?: string }
): LocalGraphMutation {
  const node = graph.nodes.get(ownerId);
  if (!node) return emptyMutation();
  let changed = false;
  if (state.lookup !== undefined && node.lookupState !== state.lookup) { node.lookupState = state.lookup; changed = true; }
  if (state.inspection !== undefined && node.inspectionState !== state.inspection) { node.inspectionState = state.inspection; changed = true; }
  if (state.hostEvidence !== undefined && node.hostEvidence !== state.hostEvidence) { node.hostEvidence = state.hostEvidence; changed = true; }
  return { nodeIds: changed ? [ownerId] : [], portIds: [], connectionIds: [], geometryChanged: false };
}

function emptyMutation(): LocalGraphMutation {
  return { nodeIds: [], portIds: [], connectionIds: [], geometryChanged: false };
}

/** Apply one accepted remote-owner result. Failed reads only update state; good siblings in partial results are retained. */
export function applyRemoteOwnerInspection(
  graph: LocalGraph,
  ownerId: string,
  result: RemoteOwnerInspection
): LocalGraphMutation {
  const owner = graph.nodes.get(ownerId);
  if (!owner) return emptyMutation();
  if (result.status === 'failed' || result.status === 'cutoff') {
    const stateChange = setRemoteOwnerState(graph, ownerId, { inspection: result.status });
    return stateChange;
  }

  const prepared = result.bindings !== undefined
    ? prepareRemoteOwnerInspection({ id: owner.id, key: owner.key, name: owner.name }, result.bindings)
    : { outcome: result.status, prepared: buildLocalGraph({ locals: [{ name: owner.name, readState: 'read', actions: [], events: [] }] }) };
  return applyRemoteOwnerDelta(graph, ownerId, prepared.prepared, prepared.outcome);
}

/** Adapt one scheduler result while preserving its explicit lookup evidence. */
export function applyRemoteEnrichmentResult(
  graph: LocalGraph,
  result: RemoteEnrichmentResult<LocalGraph>
): LocalGraphMutation {
  const ownerId = result.owner.id;
  if (!graph.nodes.has(ownerId)) return emptyMutation();
  const lookupMutation = setRemoteOwnerState(graph, ownerId, { lookup: result.lookupState, ...(result.hostEvidence ? { hostEvidence: result.hostEvidence } : {}) });
  let resultMutation: LocalGraphMutation;
  if (result.outcome === 'read' || result.outcome === 'partial') {
    resultMutation = applyRemoteOwnerDelta(graph, ownerId, result.prepared, result.outcome);
  } else {
    resultMutation = setRemoteOwnerState(graph, ownerId, { inspection: result.outcome === 'cutoff' ? 'cutoff' : 'failed' });
  }
  const nodeIds = [...new Set([...lookupMutation.nodeIds, ...resultMutation.nodeIds])].sort(compareText);
  return {
    nodeIds,
    portIds: resultMutation.portIds,
    connectionIds: resultMutation.connectionIds,
    geometryChanged: resultMutation.geometryChanged
  };
}

/** Apply an already reconstructed result from the scheduler's prepare callback. */
export function applyRemoteOwnerDelta(
  graph: LocalGraph,
  ownerId: string,
  delta: LocalGraph,
  outcome: 'read' | 'partial'
): LocalGraphMutation {
  const owner = graph.nodes.get(ownerId);
  if (!owner) return emptyMutation();
  const changedNodes = new Set<string>();
  const changedPorts = new Set<string>();
  const changedConnections = new Set<string>();

  // Promote the logical owner in place and add only nodes/ports/wires evidenced by this read.
  for (const [id, incoming] of delta.nodes) {
    const existing = graph.nodes.get(id);
    if (!existing) {
      const copy = { ...incoming };
      graph.nodes.set(id, copy);
      changedNodes.add(id);
    } else if (existing.origin === 'referenced' && incoming.origin === 'local') {
      existing.origin = 'referenced';
      changedNodes.add(id);
    }
    const current = graph.nodes.get(id)!;
    if (incoming.origin === 'referenced' && current.origin === 'referenced' && isUsableNodeName(incoming.name) &&
      (!isUsableNodeName(current.name) || compareText(incoming.name, current.name) < 0)) {
      current.name = incoming.name;
      changedNodes.add(id);
    }
    if (incoming.bindingCounts !== undefined && JSON.stringify(current.bindingCounts) !== JSON.stringify(incoming.bindingCounts)) {
      current.bindingCounts = incoming.bindingCounts;
      changedNodes.add(id);
    }
  }
  for (const [id, incoming] of delta.ports) {
    if (!graph.ports.has(id)) {
      graph.ports.set(id, { ...incoming });
      changedPorts.add(id);
    } else {
      const existing = graph.ports.get(id)!;
      if (incoming.name < existing.name) { existing.name = incoming.name; changedPorts.add(id); }
    }
  }
  for (const portId of changedPorts) {
    const port = graph.ports.get(portId);
    if (port) changedNodes.add(port.nodeId);
  }
  for (const [id, incoming] of delta.connections) {
    if (!graph.connections.has(id)) {
      graph.connections.set(id, { ...incoming });
      changedConnections.add(id);
    } else {
      const existing = graph.connections.get(id)!;
      if (incoming.alias < existing.alias) { existing.alias = incoming.alias; changedConnections.add(id); }
    }
  }
  // Keep per-owner diagnostics deterministic and do not erase earlier evidence on a partial read.
  const conflictIndex = conflictIndexes.get(graph) ?? new Set<string>();
  conflictIndexes.set(graph, conflictIndex);
  for (const conflict of delta.conflicts) {
    const key = conflictIdentity(conflict);
    if (conflictIndex.has(key)) continue;
    conflictIndex.add(key);
    graph.conflicts.push(conflict);
  }
  graph.incompleteAssignments += delta.incompleteAssignments;
  const stateChange = setRemoteOwnerState(graph, ownerId, { inspection: outcome });
  if (stateChange.nodeIds.length) changedNodes.add(ownerId);
  return {
    nodeIds: [...changedNodes].sort(compareText),
    portIds: [...changedPorts].sort(compareText),
    connectionIds: [...changedConnections].sort(compareText),
    geometryChanged: changedPorts.size > 0 || changedConnections.size > 0 || [...changedNodes].some((id) => id !== ownerId)
  };
}

/** Initial owner IDs are frozen and this summary never counts second-hop targets. */
export function remoteInspectionSummary(graph: LocalGraph): RemoteInspectionCounts {
  let inspected = 0;
  let partial = 0;
  let failed = 0;
  let cutoff = 0;
  let notInspected = 0;
  const lookup: Record<RemoteLookupState, number> = {
    pending: 0, found: 0, 'no-route': 0, failed: 0, blocked: 0, invalid: 0
  };
  for (const owner of graph.eligibleRemoteOwners) {
    const node = graph.nodes.get(owner.id);
    lookup[node?.lookupState ?? 'pending'] += 1;
    switch (node?.inspectionState ?? 'not-inspected') {
      case 'read': inspected += 1; break;
      case 'partial': inspected += 1; partial += 1; break;
      case 'failed': failed += 1; break;
      case 'cutoff': cutoff += 1; break;
      case 'not-inspected': notInspected += 1; break;
    }
  }
  return { eligible: graph.eligibleRemoteOwners.length, inspected, partial, failed, cutoff, notInspected, lookup };
}
