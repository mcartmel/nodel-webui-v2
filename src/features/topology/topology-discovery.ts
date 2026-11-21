import type { DetailedNodeUrlDiscovery } from '../../api/node-discovery';
import type { NodelJsonSchema, NodelLocalRestResponse } from '../../api/nodel-types';
import { MAX_TOPOLOGY_NAMES_PER_INTERFACE, TopologyDetailLimitError, topologyDetailTextBudget } from '../../api/codecs/nodel-codecs';
import {
  getTopologyActions, getTopologyEvents, getTopologyRemoteBindings, getTopologyRemoteSchema,
  localTopologyNodeAddress, topologyNodeAddress, type TopologyNodeAddress
} from '../../api/topology-client';
import { remoteNodeDisplayHost } from '../../utils/urls';
import { topologyNodeId, type TopologyAddressEvidence, type TopologyNodeSnapshot } from './topology-model';

export { MAX_DETAIL_NAME_LENGTH, MAX_DETAIL_TEXT_PER_INTERFACE, TopologyDetailLimitError } from '../../api/codecs/nodel-codecs';

/** Safety limit for advertised inventory, not a limit on detail reads. */
export const MAX_INVENTORY_ROUTES_PER_SOURCE = 2_048;
const MAX_ADDRESS_LENGTH = 2_048;

export type InventorySource = 'local' | 'network';
export const topologyInterfaces = ['actions', 'events', 'schema', 'assignments'] as const;
export type TopologyInterface = typeof topologyInterfaces[number];
export type InterfaceValue<K extends TopologyInterface> = NonNullable<TopologyNodeSnapshot[K]['value']>;

export interface TopologyDiagnostic {
  source: InventorySource | TopologyInterface;
  message: string;
  nodeName?: string;
  routeAddress?: string;
}

export interface InventoryRoute {
  id: string;
  name: string;
  source: InventorySource;
  host?: string;
  address?: TopologyAddressEvidence;
  target?: TopologyNodeAddress;
}

export interface Inventory {
  routes: readonly InventoryRoute[];
  /** Can we rule out a name not present in this source? */
  exhaustive: boolean;
  diagnostics: readonly TopologyDiagnostic[];
}

/** Keep the advertised location, not a capability to fetch or navigate there. */
export function displayOnlyAddress({ canonicalAddress, displayAddress, source }: TopologyAddressEvidence): TopologyAddressEvidence {
  return { canonicalAddress, displayAddress, source };
}

function route(name: string, source: InventorySource, address: TopologyNodeAddress | undefined): InventoryRoute {
  const canonicalAddress = address?.fetchBase || address?.displayAddress;
  const host = canonicalAddress ? remoteNodeDisplayHost(canonicalAddress) : '';
  const target = address?.fetchBase ? address : undefined;
  return {
    // Route identity is separate from the logical node; only repeats of this
    // exact canonical address and logical name share a read/cache slot.
    id: JSON.stringify([topologyNodeId('', name), canonicalAddress ?? null]),
    name, source,
    ...(host ? { host } : {}),
    ...(target ? { target } : {}),
    ...(address && canonicalAddress ? { address: Object.freeze({
      canonicalAddress, displayAddress: address.displayAddress, source,
      ...(target ? { fetchBase: target.fetchBase } : {}),
      ...(address.adminHref ? { adminHref: address.adminHref } : {})
    }) } : {})
  };
}

interface InventoryProjection {
  routes: Map<string, InventoryRoute>;
  omitted: number;
}

function retainRoute(projection: InventoryProjection, entry: InventoryRoute) {
  const previous = projection.routes.get(entry.id);
  if (previous) {
    if (entry.name < previous.name) projection.routes.set(entry.id, entry);
  } else if (projection.routes.size >= MAX_INVENTORY_ROUTES_PER_SOURCE) {
    projection.omitted += 1;
  } else projection.routes.set(entry.id, entry);
}

function inventory(source: InventorySource, { routes, omitted }: InventoryProjection, discarded: number, unusable: number, nameIssues = 0): Inventory {
  const diagnostics: TopologyDiagnostic[] = [];
  if (discarded) diagnostics.push({ source, message: `${discarded} invalid inventory row(s) were discarded.` });
  if (unusable) diagnostics.push({ source, message: `${unusable} advertisement(s) had no usable address.` });
  if (nameIssues) diagnostics.push({ source, message: `${nameIssues} advertisement(s) supplied an inconsistent secondary name.` });
  if (omitted) diagnostics.push({ source, message: `Inventory limit reached; ${omitted} additional advertisement(s) were omitted.` });
  return {
    routes: [...routes.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    exhaustive: !discarded && !omitted,
    diagnostics
  };
}

export function projectLocalInventory(response: NodelLocalRestResponse): Inventory {
  // The Java host explicitly exposes a `nodes` map. A response with only host
  // metadata is not evidence of an empty local inventory.
  if (!response.nodes) throw new Error('Local inventory is missing the nodes map');
  const projection: InventoryProjection = { routes: new Map(), omitted: 0 };
  let unusable = 0;
  for (const [key, entry] of Object.entries(response.nodes)) {
    const name = entry.name ?? entry.node ?? key;
    try {
      retainRoute(projection, route(name, 'local', localTopologyNodeAddress(name)));
    } catch {
      retainRoute(projection, route(name, 'local', undefined));
      unusable += 1;
    }
  }
  return inventory('local', projection, 0, unusable);
}

export function projectNetworkInventory(response: DetailedNodeUrlDiscovery): Inventory {
  const projection: InventoryProjection = { routes: new Map(), omitted: 0 };
  let unusable = response.diagnostics.unusableAddressCount;
  for (const entry of response.entries) {
    // The detailed decoder validates the name and never exposes rejected URL text.
    const name = entry.node ?? entry.name;
    if (typeof name !== 'string' || !name) continue;
    const address = entry.address && entry.address.length <= MAX_ADDRESS_LENGTH ? topologyNodeAddress(entry.address) : null;
    if (!address && entry.address) unusable += 1;
    retainRoute(projection, route(name, 'network', address ?? undefined));
  }
  return inventory('network', projection, response.diagnostics.discardedCount, unusable, response.diagnostics.nameIssueCount);
}

function boundedNames(names: string[], countText = topologyDetailTextBudget()): readonly string[] {
  if (names.length > MAX_TOPOLOGY_NAMES_PER_INTERFACE) throw new TopologyDetailLimitError();
  for (const name of names) countText(name);
  return Object.freeze([...new Set(names)].sort());
}

function aliases(schema: NodelJsonSchema, kind: 'actions' | 'events', countText: (value: string) => void): readonly string[] {
  const group = schema.properties?.[kind];
  if (group?.type !== undefined && group.type !== 'object') throw new Error('Invalid binding schema group');
  return boundedNames(Object.keys(group?.properties ?? {}), countText);
}

export const topologyReaders: { [K in TopologyInterface]: (target: TopologyNodeAddress, init: RequestInit) => Promise<InterfaceValue<K>> } = {
  async actions(target, init) {
    return boundedNames(Object.values(await getTopologyActions(target, init)).map(({ name }) => name));
  },
  async events(target, init) {
    return boundedNames(Object.values(await getTopologyEvents(target, init)).map(({ name }) => name));
  },
  async schema(target, init) {
    const schema = await getTopologyRemoteSchema(target, init);
    if (schema.type !== undefined && schema.type !== 'object') throw new Error('Invalid binding schema root');
    const countText = topologyDetailTextBudget();
    return Object.freeze({ actions: aliases(schema, 'actions', countText), events: aliases(schema, 'events', countText) });
  },
  assignments: getTopologyRemoteBindings
};
