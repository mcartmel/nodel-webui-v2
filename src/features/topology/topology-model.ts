/** Pure, read-only projections used by network-topology discovery and UI layers. */

import { javaSimpleNameKey } from './topology-simple-name';

export { javaNodeNameEquals, javaSimpleNameKey } from './topology-simple-name';

export type TopologyNodeId = string & { readonly __topologyNodeId: unique symbol };
export type TopologyEndpointId = string & { readonly __topologyEndpointId: unique symbol };
export type TopologyBindingId = string & { readonly __topologyBindingId: unique symbol };
export type TopologyPointKind = 'local-action' | 'local-event' | 'remote-action' | 'remote-event';
export type TopologyBindingKind = 'actions' | 'events';

export interface TopologyEvidence<T> {
  status: 'success' | 'failure' | 'absent';
  /** Meaning of this evidence at its boundary, e.g. `discovery`, `schema`, `assignments`. */
  source: string;
  value?: T;
  error?: string;
  lastSuccessAt?: number;
  /** A previous attempt reused on the same route and authority, not a new response. */
  cached?: boolean;
}

export interface TopologyAddressEvidence {
  /** Canonical address used for deduplication; never used as a node identity by itself. */
  canonicalAddress: string;
  /** A fetchable, already-validated base URL, if available. */
  fetchBase?: string;
  /** Safe human-facing address, kept separate from fetch and administration links. */
  displayAddress: string;
  adminHref?: string;
  source: string;
}

export interface TopologyVerifiedIdentity {
  /** Both fields must come from verified same-host/interface evidence. */
  hostId: string;
  nodeId: string;
}

export interface TopologyAssignmentValue {
  node?: unknown;
  action?: unknown;
  event?: unknown;
}

export interface TopologyAssignments {
  actions: Record<string, TopologyAssignmentValue | null>;
  events: Record<string, TopologyAssignmentValue | null>;
}

/** A single route observation; its interface responses are kept together. */
export interface TopologyNodeSnapshot {
  /** Stable observation key supplied by the snapshot producer, not a display name. */
  observationId: string;
  name?: string;
  host?: string;
  verifiedIdentity?: TopologyVerifiedIdentity;
  addresses: TopologyAddressEvidence[];
  actions: TopologyEvidence<readonly string[]>;
  events: TopologyEvidence<readonly string[]>;
  schema: TopologyEvidence<Readonly<Record<TopologyBindingKind, readonly string[]>>>;
  assignments: TopologyEvidence<TopologyAssignments>;
}

export interface TopologySnapshot {
  /** Distinguishes separate Nodel installations even when names and addresses overlap. */
  hostContext: string;
  discovery: TopologyEvidence<readonly string[]>;
  nodes: readonly TopologyNodeSnapshot[];
  /** Unresolved disputes from earlier reads, tracked by the snapshot producer. */
  routeDisputes?: ReadonlyMap<TopologyNodeId, readonly TopologyRouteConflict[]>;
}

export interface TopologyEndpoint {
  id: TopologyEndpointId;
  nodeId: TopologyNodeId;
  kind: TopologyPointKind;
  name: string;
  evidence: 'declared' | 'inferred' | 'unknown' | 'missing';
}

export interface TopologyNode {
  id: TopologyNodeId;
  name: string;
  host?: string;
  addresses: TopologyAddressEvidence[];
  discovery: 'advertised' | 'placeholder';
  duplicate?: { routeCount: number; names: readonly string[] };
  conflicts?: readonly TopologyRouteConflict[];
  /** Route that supplied the projected interface evidence, if it is coherent. */
  evidenceRouteId?: string;
  /** Safe administration link from the selected evidence route only. */
  adminHref?: string;
  actionInventory: TopologyEvidence<readonly string[]>;
  eventInventory: TopologyEvidence<readonly string[]>;
  schemaEvidence: TopologyEvidence<Readonly<Record<TopologyBindingKind, readonly string[]>>>;
  assignmentEvidence: TopologyEvidence<TopologyAssignments>;
}

export interface TopologyBinding {
  /** Stable across target changes: identifies the owner's declared/configured alias. */
  id: TopologyBindingId;
  ownerId: TopologyNodeId;
  kind: TopologyBindingKind;
  alias: string;
  declared: 'yes' | 'no' | 'unknown';
  assignment: 'unbound' | 'partial' | 'complete' | 'conflicting' | 'unknown';
  assignmentRow: 'present' | 'absent' | 'unknown';
  configuredNode?: string;
  configuredEndpoint?: string;
  targetNodeId?: TopologyNodeId;
  /** Without a complete reference only the directed owner port is present. */
  sourceEndpointId?: TopologyEndpointId;
  targetEndpointId?: TopologyEndpointId;
  direction: 'source-to-target';
  referenceResolution: 'resolved' | 'ambiguous' | 'not-discovered' | 'endpoint-missing' | 'unknown';
  ambiguity?: 'node' | 'endpoint' | 'routes';
  /** Freshness belongs to the owner assignment read, never to target validation. */
  assignmentFreshness?: 'current' | 'cached' | 'stale' | 'unknown';
}

const interfaces = ['actions', 'events', 'schema', 'assignments'] as const;
type TopologyInterface = typeof interfaces[number];
export type TopologyRouteConflict = 'identity' | TopologyInterface;

export interface TopologyGraph {
  nodes: TopologyNode[];
  endpoints: TopologyEndpoint[];
  bindings: TopologyBinding[];
  discoveryEvidence: TopologyEvidence<readonly string[]>;
  completeness: {
    discovery: 'complete' | 'partial' | 'unknown';
    schema: 'complete' | 'partial' | 'unknown';
    assignments: 'complete' | 'partial' | 'unknown';
  };
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const tupleId = (prefix: string, parts: readonly string[]) => `${prefix}:${parts.map((part) => `${part.length}:${part}`).join('|')}`;
const bindingKinds = ['actions', 'events'] as const;

function logicalName(name: string): string {
  const key = javaSimpleNameKey(name);
  // An empty reduction cannot prove Java equality. Keep a disjoint exact-text
  // ID so that complete owner rows still have a terminal without merging all empties.
  return key ? `key:${key}` : `raw:${name}`;
}

export function topologyNodeId(hostContext: string, name: string): TopologyNodeId {
  return tupleId('node', [hostContext, logicalName(name)]) as TopologyNodeId;
}

export function topologyEndpointId(nodeId: TopologyNodeId, kind: TopologyPointKind, name: string): TopologyEndpointId {
  return tupleId('endpoint', [nodeId, kind, logicalName(name)]) as TopologyEndpointId;
}

export function topologyBindingId(ownerId: TopologyNodeId, kind: TopologyBindingKind, alias: string): TopologyBindingId {
  return tupleId('binding', [ownerId, kind, logicalName(alias)]) as TopologyBindingId;
}

function successful<T>(evidence: TopologyEvidence<T>): evidence is TopologyEvidence<T> & { value: T } {
  return evidence.status === 'success' && evidence.value !== undefined;
}

function hasValue<T>(evidence: TopologyEvidence<T>): evidence is TopologyEvidence<T> & { value: T } {
  return evidence.value !== undefined;
}

function absent<T>(source: string): TopologyEvidence<T> {
  return { status: 'absent', source };
}

function readAssignment(value: unknown, kind: TopologyBindingKind): { node?: string; endpoint?: string; state: TopologyBinding['assignment'] } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { state: 'conflicting' };
  const row = value as Record<string, unknown>;
  const endpointKey = kind === 'actions' ? 'action' : 'event';
  const nodePresent = Object.prototype.hasOwnProperty.call(row, 'node');
  const endpointPresent = Object.prototype.hasOwnProperty.call(row, endpointKey);
  const node = nodePresent && typeof row.node === 'string' && row.node.length > 0 ? row.node : undefined;
  const endpoint = endpointPresent && typeof row[endpointKey] === 'string' && row[endpointKey].length > 0 ? row[endpointKey] : undefined;
  const unexpectedField = Object.keys(row).some((field) => field !== 'node' && field !== endpointKey);
  const supplied = { ...(node ? { node } : {}), ...(endpoint ? { endpoint } : {}) };
  if (unexpectedField || (nodePresent && row.node !== undefined && typeof row.node !== 'string')
      || (endpointPresent && row[endpointKey] !== undefined && typeof row[endpointKey] !== 'string')) {
    return { ...supplied, state: 'conflicting' };
  }
  if (node?.trim() && endpoint?.trim()) return { node, endpoint, state: 'complete' };
  if (!nodePresent && !endpointPresent) return { state: 'unbound' };
  return { ...supplied, state: 'partial' };
}

function indexNames(names: readonly string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const name of [...new Set(names)].sort(compare)) {
    const key = logicalName(name);
    const matches = index.get(key);
    if (matches) matches.push(name);
    else index.set(key, [name]);
  }
  return index;
}

export function topologyInterfaceFingerprint(route: TopologyNodeSnapshot, key: TopologyInterface): string {
  const names = (values: readonly string[]) => [...new Set(values)].map(logicalName).sort(compare);
  if (key === 'actions' || key === 'events') return JSON.stringify(names(route[key].value ?? []));
  if (key === 'schema') return JSON.stringify(bindingKinds.map((kind) => names(route.schema.value?.[kind] ?? [])));
  return JSON.stringify(bindingKinds.map((kind) => Object.entries(route.assignments.value?.[kind] ?? {}).map(([alias, value]) => {
    const row = readAssignment(value, kind);
    return JSON.stringify([logicalName(alias), row.state, row.node && logicalName(row.node), row.endpoint && logicalName(row.endpoint)]);
  }).sort(compare)));
}

function compareRoutes(left: TopologyNodeSnapshot, right: TopologyNodeSnapshot): number {
  // Current successes win. Historical values are ordered by their successful
  // read, so a carried failure never resurrects a row after a newer clear.
  const assignmentRank = (evidence: TopologyNodeSnapshot['assignments']) => successful(evidence) && !evidence.cached ? 2
    : (successful(evidence) || (evidence.status === 'failure' && hasValue(evidence))) ? 1 : 0;
  const retainedRank = (evidence: TopologyNodeSnapshot['assignments']) => evidence.status === 'failure' ? (evidence.cached ? 0 : 2) : 1;
  const leftRank = assignmentRank(left.assignments);
  const rightRank = assignmentRank(right.assignments);
  if (rightRank !== leftRank) return rightRank - leftRank;
  if (leftRank === 1) {
    const freshness = (right.assignments.lastSuccessAt ?? -1) - (left.assignments.lastSuccessAt ?? -1)
      || retainedRank(right.assignments) - retainedRank(left.assignments);
    if (freshness) return freshness;
  }
  const currentCount = (route: TopologyNodeSnapshot) => interfaces.filter((key) => !route[key].cached && successful<unknown>(route[key])).length;
  const readableCount = (route: TopologyNodeSnapshot) => interfaces.filter((key) => successful<unknown>(route[key])).length;
  const localRank = (route: TopologyNodeSnapshot) => Number(route.addresses.some(({ source }) => source === 'local'));
  return currentCount(right) - currentCount(left)
    || readableCount(right) - readableCount(left) || localRank(right) - localRank(left)
    || compare(left.observationId, right.observationId) || compare(left.name ?? '', right.name ?? '')
    || compare(JSON.stringify(left), JSON.stringify(right));
}

function emptyNode(id: TopologyNodeId, name: string, discovery: TopologyNode['discovery']): TopologyNode {
  return { id, name, discovery, addresses: [],
    actionInventory: absent('actions'), eventInventory: absent('events'),
    schemaEvidence: absent('schema'), assignmentEvidence: absent('assignments') };
}

function projectLogicalNode(id: TopologyNodeId, names: readonly string[], routes: readonly TopologyNodeSnapshot[],
  routeDisputes: readonly TopologyRouteConflict[] | undefined): TopologyNode {
  const identities = new Set(routes.flatMap(({ verifiedIdentity }) => verifiedIdentity
    ? [tupleId('verified', [verifiedIdentity.hostId, verifiedIdentity.nodeId])] : []));
  const identityConflict = identities.size > 1 || Boolean(routeDisputes?.includes('identity'));
  const conflicts: TopologyRouteConflict[] = identityConflict ? ['identity'] : [];
  for (const key of interfaces) {
    if (routeDisputes?.includes(key)) {
      conflicts.push(key);
      continue;
    }
    const successfulRoutes = routes.filter((route) => !route[key].cached && successful<unknown>(route[key]));
    if (successfulRoutes.length > 1 && new Set(successfulRoutes.map((route) => topologyInterfaceFingerprint(route, key))).size > 1) conflicts.push(key);
  }
  // Never build a composite interface from different routes, including routes
  // whose successes cover disjoint interfaces and cannot be compared.
  const primary = identityConflict ? undefined : routes.slice().sort(compareRoutes)[0];
  const evidence = <K extends TopologyInterface>(key: K): TopologyNodeSnapshot[K] => {
    if (primary && !conflicts.includes(key)) return primary[key];
    return { status: 'absent', source: key };
  };
  const addresses = new Map<string, TopologyAddressEvidence>();
  for (const route of routes) for (const address of route.addresses) {
    const previous = addresses.get(address.canonicalAddress);
    if (!previous || compare(JSON.stringify(address), JSON.stringify(previous)) < 0) addresses.set(address.canonicalAddress, address);
  }
  const routeCount = new Set(routes.map(({ observationId }) => observationId)).size;
  const selectedAdminHref = primary && !conflicts.length
    ? primary.addresses.find(({ adminHref }) => Boolean(adminHref))?.adminHref : undefined;
  return {
    id, name: primary?.name ?? names[0]!, addresses: [...addresses.values()].sort((a, b) => compare(a.canonicalAddress, b.canonicalAddress)),
    discovery: 'advertised',
    ...(primary ? { evidenceRouteId: primary.observationId } : {}),
    ...(primary?.host ? { host: primary.host } : {}),
    ...(selectedAdminHref ? { adminHref: selectedAdminHref } : {}),
    ...(routeCount > 1 || names.length > 1 ? { duplicate: { routeCount, names } } : {}),
    ...(conflicts.length ? { conflicts } : {}),
    actionInventory: evidence('actions'), eventInventory: evidence('events'),
    schemaEvidence: evidence('schema'), assignmentEvidence: evidence('assignments')
  };
}

function validateReference(target: TopologyNode, kind: TopologyBindingKind, endpoint: string, points: readonly string[] | undefined,
  exhaustiveDiscovery: boolean, nodeName: string): Pick<TopologyBinding, 'referenceResolution' | 'ambiguity'> {
  if (!javaSimpleNameKey(nodeName)) return { referenceResolution: 'unknown' };
  if (target.conflicts?.includes('identity')) return { referenceResolution: 'ambiguous', ambiguity: 'node' };
  if (target.conflicts?.includes(kind)) return { referenceResolution: 'ambiguous', ambiguity: 'routes' };
  if (target.discovery === 'placeholder') return { referenceResolution: exhaustiveDiscovery ? 'not-discovered' : 'unknown' };
  const inventory = kind === 'actions' ? target.actionInventory : target.eventInventory;
  if (!javaSimpleNameKey(endpoint) || !successful(inventory)) return { referenceResolution: 'unknown' };
  if (!points?.length) return { referenceResolution: 'endpoint-missing' };
  if (points.length > 1) return { referenceResolution: 'ambiguous', ambiguity: 'endpoint' };
  return { referenceResolution: 'resolved' };
}

/** Reconstruct configured edges regardless of the completeness of target validation. */
export function reconstructTopology(snapshot: TopologySnapshot): TopologyGraph {
  const groups = new Map<TopologyNodeId, { names: Set<string>; routes: TopologyNodeSnapshot[] }>();
  const addName = (name: string) => {
    const id = topologyNodeId(snapshot.hostContext, name);
    let group = groups.get(id);
    if (!group) groups.set(id, group = { names: new Set(), routes: [] });
    group.names.add(name);
    return group;
  };
  for (const name of snapshot.discovery.value ?? []) if (name.trim()) addName(name);
  for (const route of snapshot.nodes) if (route.name?.trim()) addName(route.name).routes.push(route);
  const advertised = [...groups].map(([id, { names, routes }]) => projectLogicalNode(id, [...names].sort(compare), routes, snapshot.routeDisputes?.get(id)))
    .sort((a, b) => compare(a.id, b.id));
  const nodes = new Map(advertised.map((node) => [node.id, node]));
  const endpoints = new Map<TopologyEndpointId, TopologyEndpoint>();
  const bindings: TopologyBinding[] = [];
  const inventories = new Map<TopologyNodeId, Record<TopologyBindingKind, ReturnType<typeof indexNames>>>();
  const exhaustiveDiscovery = successful(snapshot.discovery);

  function putEndpoint(nodeId: TopologyNodeId, kind: TopologyPointKind, name: string, evidence: TopologyEndpoint['evidence']) {
    const id = topologyEndpointId(nodeId, kind, name);
    if (!endpoints.has(id)) endpoints.set(id, { id, nodeId, kind, name, evidence });
    return id;
  }

  for (const node of advertised) {
    const actions = indexNames(node.actionInventory.value ?? []);
    const events = indexNames(node.eventInventory.value ?? []);
    inventories.set(node.id, { actions, events });
    for (const [kind, inventory, points] of [
      ['local-action', node.actionInventory, actions], ['local-event', node.eventInventory, events]
    ] as const) {
      for (const names of points.values()) putEndpoint(node.id, kind, names[0]!, successful(inventory) ? 'declared' : 'unknown');
    }
  }

  for (const owner of advertised) {
    const { schemaEvidence: schema, assignmentEvidence: assignments } = owner;
    const assignmentConflict = owner.conflicts?.includes('assignments') ?? false;
    const assignmentKnown = !assignmentConflict && successful(assignments);
    const assignmentStale = !assignmentConflict && assignments.status === 'failure' && hasValue(assignments);
    const assignmentFreshness = assignmentStale ? 'stale' : assignmentKnown ? (assignments.cached ? 'cached' : 'current') : 'unknown';
    for (const kind of bindingKinds) {
      const declaredAliases = indexNames(schema.value?.[kind] ?? []);
      const rows = assignmentKnown || assignmentStale ? assignments.value[kind] : undefined;
      const configuredAliases = indexNames(Object.keys(rows ?? {}));
      const aliases = new Set([...declaredAliases.keys(), ...configuredAliases.keys()]);
      for (const key of [...aliases].sort(compare)) {
        const schemaNames = declaredAliases.get(key);
        const rowNames = configuredAliases.get(key);
        const alias = schemaNames?.[0] ?? rowNames![0]!;
        const declared = successful(schema) ? (schemaNames ? 'yes' : 'no') : 'unknown';
        const parsed = assignmentConflict || (rowNames?.length ?? 0) > 1 ? { state: 'conflicting' as const }
          : rowNames ? readAssignment(rows![rowNames[0]!], kind) : { state: 'unknown' as const };
        const assignmentRow = assignmentKnown || assignmentStale ? (rowNames ? 'present' : 'absent') : 'unknown';
        const ownerPort = putEndpoint(owner.id, kind === 'actions' ? 'remote-action' : 'remote-event', alias,
          declared === 'yes' ? 'declared' : declared === 'no' ? 'inferred' : 'unknown');
        let reference: Pick<TopologyBinding, 'referenceResolution' | 'ambiguity'> = { referenceResolution: 'unknown' };
        let targetNodeId: TopologyNodeId | undefined;
        let referencePort: TopologyEndpointId | undefined;
        if (parsed.state === 'complete' && parsed.node && parsed.endpoint) {
          targetNodeId = topologyNodeId(snapshot.hostContext, parsed.node);
          let target = nodes.get(targetNodeId);
          if (!target) nodes.set(targetNodeId, target = emptyNode(targetNodeId, parsed.node, 'placeholder'));
          const points = inventories.get(targetNodeId)?.[kind].get(logicalName(parsed.endpoint));
          reference = validateReference(target, kind, parsed.endpoint, points, exhaustiveDiscovery, parsed.node);
          referencePort = putEndpoint(targetNodeId, kind === 'actions' ? 'local-action' : 'local-event', parsed.endpoint,
            reference.referenceResolution === 'endpoint-missing' ? 'missing' : target.discovery === 'placeholder' ? 'inferred' : 'unknown');
        }
        const sourceEndpointId = kind === 'actions' ? ownerPort : referencePort;
        const targetEndpointId = kind === 'actions' ? referencePort : ownerPort;
        bindings.push({
          id: topologyBindingId(owner.id, kind, alias), ownerId: owner.id, kind, alias, declared,
          assignment: assignmentKnown || assignmentStale || assignmentConflict ? parsed.state : 'unknown', assignmentRow,
          ...(parsed.node ? { configuredNode: parsed.node } : {}), ...(parsed.endpoint ? { configuredEndpoint: parsed.endpoint } : {}),
          ...(targetNodeId ? { targetNodeId } : {}),
          ...(sourceEndpointId ? { sourceEndpointId } : {}), ...(targetEndpointId ? { targetEndpointId } : {}),
          direction: 'source-to-target', ...reference, assignmentFreshness
        });
      }
    }
  }

  const completeness = (evidence: readonly TopologyEvidence<unknown>[]): 'complete' | 'partial' | 'unknown' => {
    if (!evidence.length) return exhaustiveDiscovery ? 'complete' : 'unknown';
    const known = evidence.filter(successful).length;
    return known === evidence.length ? 'complete' : known > 0 ? 'partial' : 'unknown';
  };
  return {
    nodes: [...nodes.values()].sort((a, b) => compare(a.id, b.id)),
    endpoints: [...endpoints.values()].sort((a, b) => compare(a.id, b.id)),
    bindings: bindings.sort((a, b) => compare(a.id, b.id)),
    discoveryEvidence: hasValue(snapshot.discovery) ? { ...snapshot.discovery, value: snapshot.discovery.value.slice().sort(compare) } : snapshot.discovery,
    completeness: {
      discovery: exhaustiveDiscovery ? 'complete' : advertised.length ? 'partial' : 'unknown',
      schema: completeness(advertised.map((node) => node.schemaEvidence)),
      assignments: completeness(advertised.map((node) => node.assignmentEvidence))
    }
  };
}
