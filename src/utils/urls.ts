import { getVerySimpleName } from './node-name';

const unsafeUrlCharacters = /[\u0000-\u001f\u007f]/;
const dataImagePattern = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i;

function cleanUrlValue(value: string) {
  const cleaned = value.trim();
  return cleaned && !unsafeUrlCharacters.test(cleaned) ? cleaned : null;
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

const httpProtocols = new Set(['http:', 'https:']);
const markdownProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function localNodePath(name: string) {
  return `/nodes/${encodeURIComponent(getVerySimpleName(name))}/`;
}

export function localNodeUrl(name: string, base: string | URL = window.location.origin) {
  return new URL(localNodePath(name), base).href;
}

export function safeNavigationUrl(value: string, base: string | URL = window.location.href) {
  return parseUrl(value, base, httpProtocols);
}

export function safeNavigationHref(value: string, base: string | URL = window.location.href) {
  return safeNavigationUrl(value, base) ? value.trim() : null;
}

export function safeMarkdownHref(value: string, base: string | URL = window.location.href) {
  return parseUrl(value, base, markdownProtocols) ? value.trim() : null;
}

export function safeAbsoluteHttpUrl(value: string) {
  return parseUrl(value, undefined, httpProtocols);
}

export function safeRemoteNodeUrl(value: string) {
  const url = safeAbsoluteHttpUrl(value);
  if (!url || url.search || url.hash) {
    return null;
  }

  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

export function remoteNodeEndpoint(nodeUrl: string, endpoint: string) {
  const base = safeRemoteNodeUrl(nodeUrl);
  const endpointValue = endpoint.replace(/^\/+/, '');
  if (!base || !endpointValue || unsafeUrlCharacters.test(endpointValue) || endpointValue.includes('\\')) {
    throw new Error('Remote node URL is invalid');
  }
  const result = new URL(endpointValue, base);
  if (result.origin !== base.origin || !result.pathname.startsWith(base.pathname)) {
    throw new Error('Remote node URL is invalid');
  }
  return result.href;
}

export function appendUrlPath(url: URL, ...segments: string[]) {
  const result = new URL(url.href);
  const path = result.pathname.replace(/\/+$/, '');
  result.pathname = `${path}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
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

  const url = parseUrl(`//${cleaned}/REST`, base, httpProtocols);
  return url?.pathname === '/REST' ? url : null;
}
