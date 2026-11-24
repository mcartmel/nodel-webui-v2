import { decodeRemoteBindings, MAX_API_COLLECTION_ITEMS, NodelApiDecodeError } from '../../api/codecs/nodel-codecs';
import type { NodelRemoteBindings } from '../../api/nodel-types';
import { getVerySimpleName, isUsableNodeName } from '../../utils/node-name';
import { isRecord } from '../../utils/records';
import { hostMatchesRemoteNodeUrl, remoteNodeEndpoint, safeRemoteNodeUrl } from '../../utils/urls';
import { javaSimpleNameKey } from './local-simple-name';

export interface RemoteEnrichmentOwner {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export type PolicyIssue = 'unsafe-route' | 'identity-conflict' | 'mixed-content';
export interface RemoteRoute {
  readonly url: string;
  readonly origin: string;
}

/** Null explicitly revokes a previously unambiguous advertised host. */
export type RemoteHostEvidence = string | null;

export interface RemoteLookup {
  readonly routes: readonly RemoteRoute[];
  readonly hostEvidence?: RemoteHostEvidence;
  readonly issues: readonly PolicyIssue[];
  readonly advertised: boolean;
  readonly advertisedName?: string;
  /** The response cannot establish a negative result. */
  readonly limited?: boolean;
}

export interface RemoteAdvertisement extends RemoteLookup {
  readonly owner: RemoteEnrichmentOwner;
}

export interface RemoteInventory {
  readonly advertisements: readonly RemoteAdvertisement[];
  readonly rows: number;
  readonly discardedRows: number;
  readonly limited?: 'rows' | 'malformed-rows';
}

/** Reader promises represent physical settlement, even after an abort. */
export interface RemoteEnrichmentReaders {
  inventory(signal: AbortSignal): Promise<RemoteInventory>;
  lookup(owner: RemoteEnrichmentOwner, signal: AbortSignal): Promise<RemoteLookup>;
  read(owner: RemoteEnrichmentOwner, route: RemoteRoute, signal: AbortSignal): Promise<NodelRemoteBindings>;
  /** Optional on fake readers. The real transport can revoke an owner/route before dispatch. */
  allows?(owner: RemoteEnrichmentOwner, route: RemoteRoute): boolean;
}

export const maxEnrichmentOwners = MAX_API_COLLECTION_ITEMS;
export const maxEnrichmentResponseBytes = 4 * 1024 * 1024;
export const routeLimit = 2;
export class InvalidEnrichmentJson extends Error {}
export class EnrichmentResponseLimit extends Error {}

export function enrichmentReadFailure(error: unknown): 'invalid-data' | 'transport' {
  return error instanceof NodelApiDecodeError || error instanceof InvalidEnrichmentJson || error instanceof EnrichmentResponseLimit
    ? 'invalid-data' : 'transport';
}

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function usableOwnerKey(name: string) {
  const key = isUsableNodeName(name) ? javaSimpleNameKey(name) : '';
  return key ? `simple:${key}` : '';
}

export function ownerFromName(name: string, key = usableOwnerKey(name)): RemoteEnrichmentOwner {
  return Object.freeze({ id: JSON.stringify(['node', key]), key, name });
}

export function validOwner(owner: RemoteEnrichmentOwner) {
  return Boolean(owner.key && owner.key === usableOwnerKey(owner.name) && owner.id === JSON.stringify(['node', owner.key]));
}

// No connectivity probes, and keep the physical slot through body consumption/cancellation.
export async function fetchEnrichmentJson(fetcher: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  init.signal?.throwIfAborted();
  const response = await fetcher(url, init);
  const body = response.body;
  if (!response.ok || response.redirected || response.type === 'opaque' || response.type === 'opaqueredirect' || init.signal?.aborted) {
    await body?.cancel();
    throw new Error('The response is not readable');
  }
  if (Number(response.headers.get('Content-Length')) > maxEnrichmentResponseBytes) {
    await body?.cancel();
    throw new EnrichmentResponseLimit();
  }
  if (!body) throw new InvalidEnrichmentJson();
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  const chunks: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (init.signal?.aborted) {
        await reader.cancel();
        init.signal.throwIfAborted();
      }
      if (done) break;
      size += value.byteLength;
      if (size > maxEnrichmentResponseBytes) {
        await reader.cancel();
        throw new EnrichmentResponseLimit();
      }
      try { chunks.push(decoder.decode(value, { stream: true })); }
      catch {
        await reader.cancel();
        throw new InvalidEnrichmentJson();
      }
    }
  } finally {
    reader.releaseLock();
  }
  try {
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join('')) as unknown;
  }
  catch { throw new InvalidEnrichmentJson(); }
}

/** Check the wire spelling before WHATWG parsing can erase traversal or empty userinfo. */
function advertisedPath(address: string): string | undefined {
  // eslint-disable-next-line no-control-regex -- URL parsing can otherwise strip raw control bytes.
  if (/[\\?#\u0000-\u0020\u007f]/.test(address)) return;
  const path = /^https?:\/\/([^/]+)\/nodes\/([^/]+)\/?$/i.exec(address);
  if (!path || path[1]!.includes('@')) return;
  try {
    const segment = decodeURIComponent(path[2]!);
    // eslint-disable-next-line no-control-regex -- This also disallows encoded control bytes.
    if (segment !== '.' && segment !== '..' && !/[%/\\?#\u0000-\u0020\u007f-\u009f]/.test(segment)) return segment;
  } catch {
    // Invalid percent escape, or an invalid UTF-8 sequence.
  }
  return undefined;
}

interface Candidate extends RemoteRoute { readonly key: string; readonly priority: number; readonly host: string }
interface Claims {
  name: string;
  choices: Map<string, Candidate>;
  issues: Set<PolicyIssue>;
}

/** Partition the whole raw envelope before any route is exposed to a reader. */
function partition(value: unknown, page: URL, expectedKey?: string) {
  if (!Array.isArray(value)) throw new InvalidEnrichmentJson();
  const rows = value.length;
  const groups = new Map<string, Claims>();
  const conflicts = new Set<string>();
  let discardedRows = 0;
  if (rows > MAX_API_COLLECTION_ITEMS) return { rows, discardedRows: rows, groups, conflicts, overLimit: true };

  for (const row of value as unknown[]) {
    if (!isRecord(row)) { discardedRows += 1; continue; }
    const primary = Object.hasOwn(row, 'node') ? row.node : row.name;
    const name = typeof primary === 'string' ? primary : '';
    const nameKey = usableOwnerKey(name);
    let group: Claims | undefined;
    if (nameKey && (expectedKey === undefined || nameKey === expectedKey)) {
      group = groups.get(nameKey);
      if (!group) groups.set(nameKey, group = { name, choices: new Map(), issues: new Set() });
      else if (name < group.name) group.name = name;
    }
    const aliasConflict = Object.hasOwn(row, 'node') && Object.hasOwn(row, 'name') && row.name != null &&
      (typeof row.name !== 'string' || usableOwnerKey(row.name) !== nameKey);
    const address = typeof row.address === 'string' ? row.address : '';
    const pathName = advertisedPath(address);
    const base = pathName ? safeRemoteNodeUrl(address) : null;
    const pathKey = pathName ? javaSimpleNameKey(pathName) : '';
    const key = base && pathKey ? `${base.origin}/${pathKey}` : '';
    if (!group || aliasConflict || (base && (getVerySimpleName(name) !== pathName || nameKey !== `simple:${pathKey}`))) {
      if (key) conflicts.add(key);
      group?.issues.add('identity-conflict');
      discardedRows += 1;
    } else if (row.address == null || row.address === '') {
      // The logical name is still positive; there is no asserted route.
      if (row.host != null && row.host !== '') { group.issues.add('unsafe-route'); discardedRows += 1; }
    } else if (!base || !key || !/^\/nodes\/[^/]+\/$/.test(base.pathname) ||
      (row.host != null && row.host !== '' && (typeof row.host !== 'string' || !hostMatchesRemoteNodeUrl(row.host, base.href)))) {
      if (key && base) conflicts.add(key);
      group.issues.add('unsafe-route');
      discardedRows += 1;
    } else if (page.protocol === 'https:' && base.protocol === 'http:') {
      // A valid, identified advertisement blocked by browser policy is not a
      // malformed row and does not taint otherwise complete route evidence.
      group.issues.add('mixed-content');
    } else {
      const url = remoteNodeEndpoint(base.href, 'REST/remote');
      const old = group.choices.get(key);
      const priority = base.origin === page.origin ? 0 : base.protocol === 'https:' ? 1 : 2;
      if (!old || url < old.url) group.choices.set(key, { key, url, origin: base.origin, host: base.host, priority });
    }
  }
  return { rows, discardedRows, groups, conflicts, overLimit: false };
}

/** Only serving-host discovery POSTs and owner-authorised anonymous bindings GETs. */
export function createRemoteEnrichmentReaders(origin: string, fetcher: typeof fetch = fetch): RemoteEnrichmentReaders {
  const page = new URL(origin);
  const quarantined = new Set<string>();
  const authority = new WeakMap<RemoteRoute, { ownerKey: string; routeKey: string }>();
  let quarantineUnits = 0;
  let quarantineOverflow = false;
  let inventoryRequested = false;

  const post = (operation: 'nodeURLs' | 'nodeURLsForNode', payload: { filter: '' } | { name: string }, signal: AbortSignal) =>
    fetchEnrichmentJson(fetcher, new URL(`/REST/${operation}`, page.origin).href, {
      method: 'POST', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });

  function retainConflicts(conflicts: ReadonlySet<string>) {
    if (quarantineOverflow) return;
    for (const key of conflicts) {
      if (quarantined.has(key)) continue;
      if (quarantined.size >= MAX_API_COLLECTION_ITEMS || quarantineUnits + key.length > maxEnrichmentResponseBytes) {
        // Do not forget a conflict or allow a key that could not be retained.
        // Disable every remote capability, including ones already in flight.
        quarantineOverflow = true;
        quarantined.clear();
        return;
      }
      quarantined.add(key);
      quarantineUnits += key.length;
    }
  }

  const routeBlocked = (key: string) => quarantineOverflow || quarantined.has(key);

  function allows(owner: RemoteEnrichmentOwner, route: RemoteRoute) {
    const authorization = authority.get(route);
    return authorization?.ownerKey === owner.key && validOwner(owner) && !routeBlocked(authorization.routeKey);
  }

  function allowGroup(ownerKey: string, group: Claims): RemoteLookup {
    const choices = [...group.choices.values()].filter(({ key }) => {
      if (!routeBlocked(key)) return true;
      group.issues.add('identity-conflict');
      return false;
    });
    const hosts = new Set(choices.map(({ host }) => host));
    const host = hosts.size === 1 ? choices[0]?.host : undefined;
    const routes = choices.sort((a, b) => a.priority - b.priority || compare(a.url, b.url)).slice(0, routeLimit).map((choice) => {
      const route = Object.freeze({ url: choice.url, origin: choice.origin });
      authority.set(route, { ownerKey, routeKey: choice.key });
      return route;
    });
    return { advertised: true, advertisedName: group.name, routes, issues: [...group.issues].sort(compare),
      ...(hosts.size > 1 ? { hostEvidence: null } : host && host !== page.host ? { hostEvidence: host } : {}) };
  }

  return {
    async inventory(signal) {
      signal.throwIfAborted();
      if (inventoryRequested) throw new Error('Inventory was already requested');
      inventoryRequested = true;
      const value = await post('nodeURLs', { filter: '' }, signal);
      signal.throwIfAborted();
      const { groups, conflicts, rows, discardedRows, overLimit } = partition(value, page);
      retainConflicts(conflicts);
      const advertisements = [...groups].sort(([a], [b]) => compare(a, b)).map(([key, group]) => ({
        owner: ownerFromName(group.name, key), ...allowGroup(key, group)
      }));
      const limited = overLimit ? 'rows' : discardedRows || quarantineOverflow ? 'malformed-rows' : undefined;
      return { advertisements, rows, discardedRows, ...(limited ? { limited } : {}) };
    },
    async lookup(owner, signal) {
      if (!validOwner(owner)) throw new InvalidEnrichmentJson();
      const value = await post('nodeURLsForNode', { name: owner.name }, signal);
      signal.throwIfAborted();
      const { groups, conflicts, overLimit, discardedRows } = partition(value, page, owner.key);
      // Retain conflicts even if the owner has not received its positive reply yet.
      retainConflicts(conflicts);
      const group = groups.get(owner.key);
      if (!overLimit && discardedRows > 0 && !group) throw new InvalidEnrichmentJson();
      const lookup = group ? allowGroup(owner.key, group) : { advertised: false, routes: [], issues: [] };
      return { ...lookup, ...(overLimit || discardedRows > 0 || quarantineOverflow ? { limited: true } : {}) };
    },
    async read(owner, route, signal) {
      if (!allows(owner, route)) throw new Error('Remote route was not authorised for this owner');
      const value = await fetchEnrichmentJson(fetcher, route.url, {
        method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal,
        headers: { Accept: 'application/json' }
      });
      signal.throwIfAborted();
      if (!allows(owner, route)) throw new Error('Remote route authority was revoked');
      return decodeRemoteBindings(value, 'GET remote REST/remote');
    },
    allows
  };
}
