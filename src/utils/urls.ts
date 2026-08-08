import { assertUsableNodeName, getVerySimpleName, isWellFormedUtf16 } from './node-name';

const unsafeUrlCharacters = /[\u0000-\u001f\u007f]/;
const dataImagePattern = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i;
const httpProtocols = new Set(['http:', 'https:']);
const markdownProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** True when a string cannot be represented as a sequence of Unicode scalar values. */
export function hasUnpairedSurrogate(value: string) {
  return !isWellFormedUtf16(value);
}

function cleanUrlValue(value: string) {
  if (hasUnpairedSurrogate(value)) {
    return null;
  }
  const cleaned = value.trim();
  return cleaned && !unsafeUrlCharacters.test(cleaned) ? cleaned : null;
}

/** Encodes every UTF-16 input, replacing isolated surrogate code units safely. */
export function encodeUrlPathSegment(value: string) {
  let normalized = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        normalized += value.charAt(index) + value.charAt(index + 1);
        index += 1;
      } else {
        normalized += '\ufffd';
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      normalized += '\ufffd';
    } else {
        normalized += value.charAt(index);
    }
  }
  // encodeURIComponent deliberately leaves dot-only segments unchanged, which
  // lets URL resolution normalize them as traversal.
  if (normalized === '.') return '%2E';
  if (normalized === '..') return '%2E%2E';
  return encodeURIComponent(normalized);
}

/**
 * Encodes a value only when WHATWG URL parsing preserves it as one exact path
 * segment. This is deliberately stricter than display-oriented URL encoding.
 */
export function reversibleUrlPathSegment(value: string) {
  if (!value || value === '.' || value === '..' || hasUnpairedSurrogate(value)) {
    return null;
  }

  let encoded: string;
  try {
    encoded = encodeURIComponent(value);
  } catch {
    return null;
  }

  const parsed = new URL(`https://nodel.invalid/${encoded}`);
  const segment = parsed.pathname.slice(1);
  try {
    return segment === encoded && decodeURIComponent(segment) === value ? encoded : null;
  } catch {
    return null;
  }
}

function hasCredentials(url: URL) {
  return Boolean(url.username || url.password);
}

function parseUrl(value: string, base: string | URL | undefined, protocols: ReadonlySet<string>) {
  const cleaned = cleanUrlValue(value);
  if (!cleaned) {
    return null;
  }

  try {
    const url = base === undefined ? new URL(cleaned) : new URL(cleaned, base);
    return protocols.has(url.protocol) && !hasCredentials(url) ? url : null;
  } catch {
    return null;
  }
}

function urlParts(value: string) {
  const match = /^(https?:\/\/)([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(value);
  if (!match) return null;
  const scheme = match[1];
  const authority = match[2];
  const pathname = match[3];
  if (!scheme || !authority || pathname === undefined) return null;
  return {
    scheme,
    authority,
    pathname,
    search: match[4] || '',
    hash: match[5] || ''
  };
}

function isIpv6Address(value: string) {
  if (value.includes('%') || value.split(':').length < 3 || !/^[0-9a-f:.]+$/i.test(value)) return false;
  try {
    new URL(`http://[${value}]/`);
    return true;
  } catch {
    return false;
  }
}

function ipv6PortSuffix(authority: string) {
  const separator = authority.lastIndexOf(':');
  const port = authority.slice(separator + 1);
  const address = authority.slice(0, separator);
  return separator > 0 && /^\d{1,5}$/.test(port) && isIpv6Address(address) ? { address, port } : null;
}

function splitIpv6Authority(authority: string, javaAuthority = false) {
  if (authority.startsWith('[') || authority.includes('@')) return null;
  const scoped = /^(.*)%([A-Za-z0-9._~-]+)(?::(\d{1,5}))?$/.exec(authority);
  const scopedAddress = scoped?.[1];
  const scopedZone = scoped?.[2];
  if (scoped && scopedAddress && scopedZone && isIpv6Address(scopedAddress)) {
    const port = scoped[3] ? Number(scoped[3]) : undefined;
    if (port !== undefined && port > 65535) return null;
    return { address: scopedAddress, zone: scopedZone, port: scoped[3] ?? '' };
  }

  // Java writes IPv6 authorities without brackets and always appends a port.
  // This includes one-digit ports and a third colon after a compressed suffix.
  const suffix = ipv6PortSuffix(authority);
  if (suffix && javaAuthority) {
    const { address, port } = suffix;
    if (Number(port) > 65535) return null;
    return { address, zone: '', port };
  }
  // An otherwise-valid IPv6 address can also be a Java host plus one-digit
  // port. Do not guess outside a Java response context.
  if (suffix) return null;
  return isIpv6Address(authority) ? { address: authority, zone: '', port: '' } : null;
}

/** Canonicalize a Java-emitted IPv6 host without touching its path, query, or fragment. */
function canonicalizeIpv6HttpUrl(value: string, javaAuthority = false) {
  const parts = urlParts(value);
  if (!parts) return value;
  const bracketedScope = /^\[([0-9a-f:.]+)%25([A-Za-z0-9._~-]+)\](?::(\d{1,5}))?$/i.exec(parts.authority);
  const scopedAddress = bracketedScope?.[1];
  const scopedZone = bracketedScope?.[2];
  if (bracketedScope && scopedAddress && scopedZone && isIpv6Address(scopedAddress) && (!bracketedScope[3] || Number(bracketedScope[3]) <= 65535)) {
    return `${parts.scheme}[${scopedAddress}%25${scopedZone}]${bracketedScope[3] ? `:${bracketedScope[3]}` : ''}${parts.pathname}${parts.search}${parts.hash}`;
  }
  const host = splitIpv6Authority(parts.authority, javaAuthority || /^\/nodes\/[^/]+(?:\/|$)/.test(parts.pathname));
  if (!host) return ipv6PortSuffix(parts.authority) ? null : value;
  const zone = host.zone ? `%25${host.zone}` : '';
  return `${parts.scheme}[${host.address}${zone}]${host.port ? `:${host.port}` : ''}${parts.pathname}${parts.search}${parts.hash}`;
}

function parseCanonicalAbsoluteHttpUrl(canonical: string | null) {
  return canonical ? parseUrl(canonical, undefined, httpProtocols) : null;
}

function hasAuthorityPort(authority: string) {
  return /(?:\]|[^:]):\d{1,5}$/.test(authority);
}

function scopedIpv6HttpParts(value: string) {
  const parts = urlParts(value);
  if (!parts || !parts.authority.includes('%25') || parts.authority.includes('@')) return null;
  const match = /^\[([0-9a-f:.]+)%25([A-Za-z0-9._~-]+)\](?::(\d{1,5}))?$/i.exec(parts.authority);
  const address = match?.[1];
  if (!match || !address || !isIpv6Address(address) || (match[3] && Number(match[3]) > 65535)) return null;
  return parts;
}

export function localNodePath(name: string) {
  assertUsableNodeName(name);
  return `/nodes/${encodeUrlPathSegment(getVerySimpleName(name))}/`;
}

export function localNodeUrl(name: string, base: string | URL = window.location.origin) {
  return new URL(localNodePath(name), base).href;
}

export function safeNavigationUrl(value: string, base: string | URL = window.location.href) {
  const cleaned = cleanUrlValue(value);
  const canonical = cleaned ? canonicalizeIpv6HttpUrl(cleaned) : null;
  return canonical ? parseUrl(canonical, base, httpProtocols) : null;
}

export function safeNavigationHref(value: string, base: string | URL = window.location.href) {
  const cleaned = cleanUrlValue(value);
  const canonical = cleaned ? canonicalizeIpv6HttpUrl(cleaned) : null;
  return canonical && parseUrl(canonical, base, httpProtocols) ? canonical : null;
}

export function safeMarkdownHref(value: string, base: string | URL = window.location.href) {
  return parseUrl(value, base, markdownProtocols) ? value.trim() : null;
}

export function safeAbsoluteHttpUrl(value: string) {
  const cleaned = cleanUrlValue(value);
  if (!cleaned) return null;
  return parseCanonicalAbsoluteHttpUrl(canonicalizeIpv6HttpUrl(cleaned));
}

/** Parse a Java HTTP(S) response that may contain an unbracketed IPv6 authority. */
export function safeJavaAbsoluteHttpUrl(value: string) {
  const cleaned = cleanUrlValue(value);
  if (!cleaned) return null;
  return parseCanonicalAbsoluteHttpUrl(canonicalizeIpv6HttpUrl(cleaned, true));
}

/**
 * Return a display-safe absolute HTTP(S) URL. Scoped IPv6 forms may be returned
 * even when this runtime cannot parse them; callers must use safeAbsoluteHttpUrl
 * before navigation or fetch.
 */
export function canonicalAbsoluteHttpHref(value: string) {
  const cleaned = cleanUrlValue(value);
  if (!cleaned) return null;
  const canonical = canonicalizeIpv6HttpUrl(cleaned);
  return canonical && (safeAbsoluteHttpUrl(canonical) || scopedIpv6HttpParts(canonical)) ? canonical : null;
}

/** Canonicalize a Java HTTP(S) response, retaining scoped IPv6 for display only. */
export function canonicalJavaAbsoluteHttpHref(value: string) {
  const cleaned = cleanUrlValue(value);
  if (!cleaned) return null;
  const canonical = canonicalizeIpv6HttpUrl(cleaned, true);
  return canonical && (safeJavaAbsoluteHttpUrl(canonical) || scopedIpv6HttpParts(canonical)) ? canonical : null;
}

export function safeRemoteNodeUrl(value: string) {
  const url = safeJavaAbsoluteHttpUrl(value);
  if (!url || url.search || url.hash) {
    return null;
  }

  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

/**
 * Canonicalize a remote node address for display and storage. A returned string
 * is not proof that a scoped IPv6 address is browser-navigable or fetchable.
 */
export function canonicalRemoteNodeHref(value: string) {
  const canonical = canonicalJavaAbsoluteHttpHref(value);
  if (!canonical) return null;
  const url = safeRemoteNodeUrl(canonical);
  if (url) return url.href;
  const parts = scopedIpv6HttpParts(canonical);
  if (!parts || parts.search || parts.hash) return null;
  return `${parts.scheme}${parts.authority}${parts.pathname.endsWith('/') ? parts.pathname : `${parts.pathname}/`}`;
}

/** Return a display host without claiming that a scoped host is fetchable. */
export function remoteNodeDisplayHost(value: string) {
  const canonical = canonicalJavaAbsoluteHttpHref(value);
  if (!canonical) return '';
  const scoped = scopedIpv6HttpParts(canonical);
  if (scoped) {
    const match = /^\[([0-9a-f:.]+)%25([A-Za-z0-9._~-]+)\](?::(\d{1,5}))?$/i.exec(scoped.authority);
    const address = match?.[1];
    const zone = match?.[2];
    if (address && zone) return `${address}%${zone}${match[3] ? `:${match[3]}` : ''}`;
  }
  return safeJavaAbsoluteHttpUrl(canonical)?.host ?? '';
}

/** Compare a discovery host with an address without treating a scoped URL as navigable. */
export function hostMatchesRemoteNodeUrl(host: string, nodeUrl: string) {
  const nodeHref = canonicalJavaAbsoluteHttpHref(nodeUrl);
  const nodeParts = nodeHref ? urlParts(nodeHref) : null;
  const hostValue = cleanUrlValue(host);
  if (!nodeHref || !nodeParts || !hostValue || /[\\/?#@]/.test(hostValue)) return false;
  const hostHref = canonicalJavaAbsoluteHttpHref(`${nodeParts.scheme}${hostValue}/`);
  if (!hostHref) return false;
  const hostParts = urlParts(hostHref);
  if (!hostParts) return false;

  const scopedNode = scopedIpv6HttpParts(nodeHref);
  const scopedHost = scopedIpv6HttpParts(hostHref);
  if (scopedNode || scopedHost) {
    if (!scopedNode || !scopedHost) return false;
    const nodeMatch = /^\[([0-9a-f:.]+)%25([A-Za-z0-9._~-]+)\](?::(\d+))?$/i.exec(scopedNode.authority);
    const hostMatch = /^\[([0-9a-f:.]+)%25([A-Za-z0-9._~-]+)\](?::(\d+))?$/i.exec(scopedHost.authority);
    const nodeAddress = nodeMatch?.[1];
    const hostAddress = hostMatch?.[1];
    const nodeZone = nodeMatch?.[2];
    const hostZone = hostMatch?.[2];
    return Boolean(nodeAddress && hostAddress && nodeZone && hostZone
      && nodeAddress.toLowerCase() === hostAddress.toLowerCase()
      && nodeZone === hostZone
      && (!hasAuthorityPort(hostParts.authority) || (nodeMatch?.[3] ?? '') === (hostMatch?.[3] ?? '')));
  }

  const node = safeJavaAbsoluteHttpUrl(nodeHref);
  const candidate = safeJavaAbsoluteHttpUrl(hostHref);
  return Boolean(node && candidate && node.hostname === candidate.hostname
    && (!hasAuthorityPort(hostParts.authority) || node.port === candidate.port));
}

export function remoteNodeEndpoint(nodeUrl: string, endpoint: string) {
  const base = safeRemoteNodeUrl(nodeUrl);
  const endpointValue = endpoint.replace(/^\/+/, '');
  const queryIndex = endpointValue.indexOf('?');
  const endpointPath = queryIndex === -1 ? endpointValue : endpointValue.slice(0, queryIndex);
  const endpointQuery = queryIndex === -1 ? '' : endpointValue.slice(queryIndex);
  const trailingSlash = endpointPath.endsWith('/');
  let segments: string[];
  try {
    const rawSegments = endpointPath.split('/');
    if (rawSegments.at(-1) === '') rawSegments.pop();
    segments = rawSegments.map((segment) => decodeURIComponent(segment));
    if (endpointQuery) decodeURIComponent(endpointQuery.replace(/\+/g, '%20'));
  } catch {
    throw new Error('Remote node URL is invalid');
  }
  if (!base || !endpointPath || unsafeUrlCharacters.test(endpointValue) || endpointValue.includes('\\') || endpointValue.includes('#')
    || segments.some((segment) => !segment || segment === '.' || segment === '..' || /[\\/?#]/.test(segment))) {
    throw new Error('Remote node URL is invalid');
  }
  let query: URLSearchParams;
  try {
    query = new URLSearchParams(endpointQuery);
  } catch {
    throw new Error('Remote node URL is invalid');
  }
  const result = new URL(`${segments.map(encodeUrlPathSegment).join('/')}${trailingSlash ? '/' : ''}`, base);
  result.search = queryIndex === -1 ? '' : query.toString();
  if (result.origin !== base.origin || !result.pathname.startsWith(base.pathname)) {
    throw new Error('Remote node URL is invalid');
  }
  return result.href;
}

export function appendUrlPath(url: URL, ...segments: string[]) {
  const encodedSegments = segments.map(reversibleUrlPathSegment);
  if (encodedSegments.some((segment) => segment === null)) {
    return null;
  }
  const result = new URL(url.href);
  const path = result.pathname.replace(/\/+$/, '');
  result.pathname = `${path}/${encodedSegments.join('/')}`;
  result.search = '';
  result.hash = '';
  return result;
}

export function safeImageSrc(value: string, base: string | URL = window.location.href) {
  const cleaned = cleanUrlValue(value);
  if (!cleaned) {
    return null;
  }
  if (dataImagePattern.test(cleaned)) {
    return cleaned;
  }

  try {
    const url = new URL(cleaned, base);
    if (hasCredentials(url)) {
      return null;
    }
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'blob:' ? cleaned : null;
  } catch {
    return null;
  }
}

export function safeHostRestUrl(host: string, base: string | URL = window.location.href) {
  const cleaned = cleanUrlValue(host);
  if (!cleaned || /[\\/?#@]/.test(cleaned)) {
    return null;
  }

  const protocol = typeof base === 'string'
    ? parseUrl(base, undefined, httpProtocols)?.protocol
    : base.protocol;
  if (!protocol) return null;
  const url = safeJavaAbsoluteHttpUrl(`${protocol}//${cleaned}/REST`);
  return url?.pathname === '/REST' ? url : null;
}
