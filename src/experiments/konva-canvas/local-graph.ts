import { javaSimpleNameKey } from './local-simple-name';
import type { LocalSnapshot as BoundedLocalSnapshot } from './local-snapshot';

export type LocalReadState = 'read' | 'partial' | 'unread' | 'not-requested';
export type LocalBindingKind = 'action' | 'event';

/** A decoded assignment row. Missing fields are intentional and mean incomplete. */
export interface LocalAssignmentRow {
  alias: string;
  node?: string;
  endpoint?: string;
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
          const node = stringField(value, 'node');
          const endpoint = stringField(value, kind);
          return { alias, ...(node === undefined ? {} : { node }), ...(endpoint === undefined ? {} : { endpoint }) };
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
}

const tupleId = (...parts: string[]): string => JSON.stringify(parts);
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const usableNameKey = (name: string): string | undefined => javaSimpleNameKey(name) || undefined;
const nameIdentity = (name: string): string => {
  const key = usableNameKey(name);
  return key ? `simple:${key}` : `opaque:${name}`;
};

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
    if (existing) return existing;
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
          const targetName = row.node;
          const endpoint = row.endpoint;
          const targetKey = targetName === undefined ? undefined : usableNameKey(targetName);
          const endpointKey = endpoint === undefined ? undefined : usableNameKey(endpoint);
          if (targetKey && targetName) {
            ensureReferenced(targetName);
            incompleteAssignments += 1;
            markPartial(owner);
          } else if (endpointKey) incompleteAssignments += 1;
          if (!targetKey && endpointKey) markPartial(owner);
          continue;
        }
        const groupKey = tupleId(kind, aliasKey);
        const group = aliasGroups.get(groupKey) ?? [];
        group.push(row);
        aliasGroups.set(groupKey, group);
      }
      for (const group of aliasGroups.values()) {
        const signatures = new Set(group.map((row) => {
          const target = row.node === undefined ? undefined : usableNameKey(row.node);
          const endpoint = row.endpoint === undefined ? undefined : usableNameKey(row.endpoint);
          return tupleId(target ? `simple:${target}` : '', endpoint ? `simple:${endpoint}` : '');
        }));
        const row = group[0]!;
        if (signatures.size > 1) {
          conflicts.push({ ownerId: owner.id, alias: row.alias, kind, rows: group.length });
          markPartial(owner);
          continue;
        }
        const targetName = row.node;
        const endpoint = row.endpoint;
        const targetKey = targetName === undefined ? undefined : usableNameKey(targetName);
        const endpointKey = endpoint === undefined ? undefined : usableNameKey(endpoint);
        if (!targetKey && !endpointKey) continue;
        if (targetKey && targetName && !endpointKey) {
          ensureReferenced(targetName);
          incompleteAssignments += 1;
          markPartial(owner);
          continue;
        }
        if (!targetKey || !targetName || !endpointKey || !endpoint) { incompleteAssignments += 1; markPartial(owner); continue; }

        const target = ensureReferenced(targetName);
        const remoteKind: LocalPortKind = kind === 'action' ? 'remote-action' : 'remote-event';
        const localKind: LocalPortKind = kind === 'action' ? 'local-action' : 'local-event';
        const aliasPort = ensurePort(owner, remoteKind, row.alias, 'configured-alias');
        const endpointPort = ensurePort(target, localKind, endpoint, 'referenced-endpoint');
        const from = kind === 'action' ? aliasPort : endpointPort;
        const to = kind === 'action' ? endpointPort : aliasPort;
        const id = tupleId('binding', owner.key, kind, nameIdentity(row.alias));
        connections.set(id, { id, ownerId: owner.id, alias: row.alias, kind, fromPortId: from.id, toPortId: to.id });
      }
    }
  }
  conflicts.sort((a, b) => compareText(a.ownerId, b.ownerId) || compareText(a.kind, b.kind) || compareText(a.alias, b.alias));
  return { nodes, ports, connections, conflicts, incompleteAssignments };
}
