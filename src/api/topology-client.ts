import { runWithDeadline, startRequestDeadline, type NodelReadInit } from './request';
import { fetchWithConnectivity } from '../data/connectivity';
import { responseError } from './http-transport';
import { decodeActions, decodeSchema, decodeSignals, decodeTopologyRemoteBindings, type DecodedTopologyRemoteBindings } from './codecs/nodel-codecs';
import type { NodelActionDefinition, NodelJsonSchema, NodelSignalDefinition } from './nodel-types';
import { canonicalTopologyNodeHref, localNodeUrl, remoteNodeEndpoint, safeNavigationHref, safeRemoteNodeUrl } from '../utils/urls';

/** A node's fetch target is kept distinct from its display address and admin link. */
export interface TopologyNodeAddress {
  /** Validated HTTP(S) base used only for REST reads. */
  fetchBase: string;
  /** Canonical address suitable for display, never used for navigation. */
  displayAddress: string;
  /** Safe browser navigation link, or null when the address is not navigable. */
  adminHref: string | null;
  /** Local targets are trusted only when constructed by localTopologyNodeAddress. */
  scope: 'local' | 'remote';
}
const verifiedLocalTargets = new WeakSet<TopologyNodeAddress>();

/** Convert a discovered advertised address to separated fetch, display and navigation values. */
export function topologyNodeAddress(address: string): TopologyNodeAddress | null {
  const displayAddress = canonicalTopologyNodeHref(address);
  if (!displayAddress) return null;
  const base = safeRemoteNodeUrl(displayAddress);
  if (!base) return { fetchBase: '', displayAddress, adminHref: null, scope: 'remote' };
  return { fetchBase: base.href, displayAddress, adminHref: safeNavigationHref(base.href), scope: 'remote' };
}

/** Verified local nodes are addressed on this page's origin, including HTTPS deployments. */
export function localTopologyNodeAddress(name: string): TopologyNodeAddress {
  const address = localNodeUrl(name, window.location.origin);
  const target: TopologyNodeAddress = { fetchBase: address, displayAddress: address, adminHref: address, scope: 'local' };
  verifiedLocalTargets.add(target);
  return target;
}

async function topologyRead<T>(target: TopologyNodeAddress, endpoint: 'REST/actions' | 'REST/events' | 'REST/remote' | 'REST/remote/schema', decode: (value: unknown, context: string) => T, init?: NodelReadInit): Promise<T> {
  // Do not permit callers to add credentials/auth headers, alter the fixed read
  // policy, or follow a redirect to a destination that was never discovered.
  if (!target.fetchBase) throw new Error('Topology target has no browser-fetchable address');
  const base = safeRemoteNodeUrl(target.fetchBase);
  if (!base) throw new Error('Topology target address is invalid');
  const localTrusted = target.scope === 'local' && verifiedLocalTargets.has(target) && base.origin === window.location.origin;
  if (target.scope === 'local' && !localTrusted) throw new Error('Local topology reads must use the current origin');
  const url = remoteNodeEndpoint(base.href, endpoint);
  const operation = async (signal: AbortSignal) => {
    // Origin equality does not turn an advertisement into trusted local evidence.
    const read = localTrusted ? fetchWithConnectivity : fetch;
    const response = await read(url, {
      signal,
      method: 'GET',
      mode: 'cors',
      credentials: localTrusted ? 'same-origin' : 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/json' }
    });
    signal.throwIfAborted();
    if (!response.ok) throw await responseError(response);
    const body: unknown = await response.json();
    signal.throwIfAborted();
    return decode(body, `GET topology ${endpoint}`);
  };
  return init?.waitForSettlement ? runWithDeadline(operation, init.signal) : startRequestDeadline(operation, init?.signal).result;
}

export function getTopologyRemoteBindings(target: TopologyNodeAddress, init?: NodelReadInit): Promise<DecodedTopologyRemoteBindings> {
  return topologyRead(target, 'REST/remote', decodeTopologyRemoteBindings, init);
}

export function getTopologyRemoteSchema(target: TopologyNodeAddress, init?: NodelReadInit): Promise<NodelJsonSchema> {
  return topologyRead(target, 'REST/remote/schema', decodeSchema, init);
}

export function getTopologyActions(target: TopologyNodeAddress, init?: NodelReadInit): Promise<Record<string, NodelActionDefinition>> {
  return topologyRead(target, 'REST/actions', decodeActions, init);
}

export function getTopologyEvents(target: TopologyNodeAddress, init?: NodelReadInit): Promise<Record<string, NodelSignalDefinition>> {
  return topologyRead(target, 'REST/events', decodeSignals, init);
}
