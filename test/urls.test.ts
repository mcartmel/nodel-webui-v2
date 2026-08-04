import {
  appendUrlPath,
  canonicalAbsoluteHttpHref,
  canonicalRemoteNodeHref,
  encodeUrlPathSegment,
  hostMatchesRemoteNodeUrl,
  localNodePath,
  localNodeUrl,
  remoteNodeEndpoint,
  safeAbsoluteHttpUrl,
  safeHostRestUrl,
  safeImageSrc,
  safeJavaAbsoluteHttpUrl,
  safeMarkdownHref,
  safeNavigationHref,
  safeNavigationUrl,
  safeRemoteNodeUrl
} from '../src/utils/urls';

describe('URL policies', () => {
  beforeEach(() => {
    window.history.replaceState(undefined, '', '/nodes/Demo/control.html');
  });

  it('allows safe browser navigation forms and preserves relative hrefs', () => {
    expect(safeNavigationHref('#Status')).toBe('#Status');
    expect(safeNavigationHref('/nodes.html#Network')).toBe('/nodes.html#Network');
    expect(safeNavigationHref('../docs/help.html')).toBe('../docs/help.html');
    expect(safeNavigationHref('HTTPS://example.test/path')).toBe('HTTPS://example.test/path');
    expect(safeNavigationHref('http://::1:8085/nodes/IPv6/')).toBe('http://[::1]:8085/nodes/IPv6/');
    expect(safeNavigationUrl('//display.test/nodes/Display/')?.host).toBe('display.test');
    expect(safeNavigationUrl('java%73cript:alert(1)')?.protocol).toBe(window.location.protocol);
  });

  it('rejects unsafe, credentialed, controlled, and malformed navigation values', () => {
    for (const value of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,unsafe',
      'https://user:secret@example.test/',
      'https://example.test/\nunsafe',
      'http://[invalid',
      '',
      '   '
    ]) {
      expect(safeNavigationHref(value), value).toBeNull();
    }
  });

  it('uses a broader but explicit policy for Markdown links', () => {
    expect(safeMarkdownHref('mailto:team@example.test')).toBe('mailto:team@example.test');
    expect(safeMarkdownHref('tel:+61000000000')).toBe('tel:+61000000000');
    expect(safeMarkdownHref('/guide')).toBe('/guide');
    expect(safeMarkdownHref('//docs.example.test/guide')).toBe('//docs.example.test/guide');
    expect(safeMarkdownHref('java%73cript:alert(1)')).toBe('java%73cript:alert(1)');
    expect(safeMarkdownHref('javascript:alert(1)')).toBeNull();
    expect(safeMarkdownHref('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeMarkdownHref('data:text/html,unsafe')).toBeNull();
    expect(safeMarkdownHref('https://user:secret@example.test/')).toBeNull();
    expect(safeMarkdownHref('https://example.test/\nunsafe')).toBeNull();
    expect(safeMarkdownHref('http://[invalid')).toBeNull();
  });

  it('requires absolute credential-free node API bases', () => {
    expect(safeRemoteNodeUrl('https://display.test/nodes/Display')?.href).toBe('https://display.test/nodes/Display/');
    expect(safeRemoteNodeUrl('/nodes/Display/')).toBeNull();
    expect(safeRemoteNodeUrl('//display.test/nodes/Display/')).toBeNull();
    expect(safeRemoteNodeUrl('https://user:secret@display.test/nodes/Display/')).toBeNull();
    expect(safeRemoteNodeUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeRemoteNodeUrl('data:text/html,unsafe')).toBeNull();
    expect(safeRemoteNodeUrl('java%73cript:alert(1)')).toBeNull();
    expect(safeRemoteNodeUrl('https://display.test/\nunsafe')).toBeNull();
    expect(safeRemoteNodeUrl('http://[invalid')).toBeNull();
    expect(safeRemoteNodeUrl('http://::1:65536/nodes/Display/')).toBeNull();
    expect(safeRemoteNodeUrl('https://display.test/nodes/Display/?mode=test')).toBeNull();
    expect(safeRemoteNodeUrl('https://display.test/nodes/Display/#status')).toBeNull();
    expect(remoteNodeEndpoint('https://display.test/nodes/Display/', 'REST/actions')).toBe('https://display.test/nodes/Display/REST/actions');
    expect(() => remoteNodeEndpoint('javascript:alert(1)', 'REST/actions')).toThrow('Remote node URL is invalid');
    expect(() => remoteNodeEndpoint('https://display.test/nodes/Display/', 'https://evil.test/REST/actions')).toThrow('Remote node URL is invalid');
    expect(() => remoteNodeEndpoint('https://display.test/nodes/Display/', '../REST/actions')).toThrow('Remote node URL is invalid');
    expect(() => remoteNodeEndpoint('https://display.test/nodes/Display/', 'REST/../actions')).toThrow('Remote node URL is invalid');
    for (const endpoint of ['REST/%2e%2e/actions', 'REST/%2Factions', 'REST/%5cactions', 'REST/%3Fquery', 'REST/%23fragment', 'REST/%zz']) {
      expect(() => remoteNodeEndpoint('https://display.test/nodes/Display/', endpoint), endpoint).toThrow('Remote node URL is invalid');
    }
  });

  it('handles external links, generated paths, images, and host probes separately', () => {
    const repository = safeAbsoluteHttpUrl('https://example.test/project')!;
    expect(appendUrlPath(repository, 'tree', 'feature/test')?.href).toBe('https://example.test/project/tree/feature%2Ftest');
    expect(safeAbsoluteHttpUrl('https://user@example.test/project')).toBeNull();
    expect(safeImageSrc('./image.png')).toBe('./image.png');
    expect(safeImageSrc('//images.example.test/image.png')).toBe('//images.example.test/image.png');
    expect(safeImageSrc('java%73cript:alert(1)')).toBe('java%73cript:alert(1)');
    expect(safeImageSrc('blob:https://example.test/id')).toBe('blob:https://example.test/id');
    expect(safeImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(safeImageSrc('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(safeImageSrc('javascript:alert(1)')).toBeNull();
    expect(safeImageSrc('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeImageSrc('https://user:secret@example.test/image.png')).toBeNull();
    expect(safeImageSrc('https://example.test/\nimage.png')).toBeNull();
    expect(safeImageSrc('http://[invalid')).toBeNull();
    expect(safeHostRestUrl('display.test:8085')?.href).toBe(`${window.location.protocol}//display.test:8085/REST`);
    expect(safeHostRestUrl('DISPLAY.TEST:8085')?.href).toBe(`${window.location.protocol}//display.test:8085/REST`);
    expect(safeHostRestUrl('user@display.test')).toBeNull();
    expect(safeHostRestUrl('display.test/path')).toBeNull();
    expect(safeHostRestUrl('display.test\\admin')).toBeNull();
    expect(safeHostRestUrl('::1:8085')?.href).toBe(`${window.location.protocol}//[::1]:8085/REST`);
    const unscoped = safeJavaAbsoluteHttpUrl('http://::1:8085/REST');
    expect(unscoped).toBeInstanceOf(URL);
    expect(unscoped?.href).toBe('http://[::1]:8085/REST');
    expect(safeRemoteNodeUrl('http://::1:8085/nodes/IPv6/')?.href).toBe('http://[::1]:8085/nodes/IPv6/');
    expect(remoteNodeEndpoint('http://::1:8085/nodes/IPv6/', 'REST/actions')).toBe('http://[::1]:8085/nodes/IPv6/REST/actions');
  });

  it('keeps display encoding separate from reversible request path segments', () => {
    expect(encodeUrlPathSegment('\ud800')).toBe('%EF%BF%BD');
    expect(encodeUrlPathSegment('\udc00')).toBe('%EF%BF%BD');
    expect(encodeUrlPathSegment('.')).toBe('%2E');
    expect(encodeUrlPathSegment('..')).toBe('%2E%2E');
    const repository = safeAbsoluteHttpUrl('https://example.test/repo')!;
    expect(appendUrlPath(repository, 'tree', 'release.v2')?.href).toBe('https://example.test/repo/tree/release.v2');
    expect(appendUrlPath(repository, 'tree', '\ud800')).toBeNull();
    expect(appendUrlPath(repository, 'tree', '.')).toBeNull();
    expect(appendUrlPath(repository, 'tree', '..')).toBeNull();
  });

  it('rejects malformed node names instead of substituting a URL collision', () => {
    expect(() => localNodePath('Node\ud800')).toThrow('Node name must be well-formed UTF-16');
    expect(() => localNodeUrl('Node\ud800')).toThrow('Node name must be well-formed UTF-16');
    expect(localNodePath('Node\ufffd')).toBe('/nodes/Node%EF%BF%BD/');
    expect(() => localNodePath('Node 😀')).toThrow('control or supplementary Unicode');
    expect(localNodePath('Node café')).toBe('/nodes/Nodecaf%C3%A9/');
    expect(appendUrlPath(safeAbsoluteHttpUrl('https://example.test/repo')!, 'tree', '\udc00')).toBeNull();
  });

  it('rejects malformed UTF-16 in navigation instead of linking to U+FFFD', () => {
    const malformed = '/nodes/Node\ud800/';
    const replacement = '/nodes/Node\ufffd/';

    expect(safeNavigationUrl(malformed)).toBeNull();
    expect(safeNavigationHref(malformed)).toBeNull();
    expect(safeNavigationUrl(replacement)?.pathname).toBe('/nodes/Node%EF%BF%BD/');
    expect(safeNavigationHref(replacement)).toBe(replacement);
  });

  it('parses Java IPv6 ports while rejecting ambiguous generic authorities', () => {
    expect(safeRemoteNodeUrl('http://::1:8/nodes/IPv6/')?.href).toBe('http://[::1]:8/nodes/IPv6/');
    expect(safeRemoteNodeUrl('http://2001:db8::8/nodes/IPv6/')?.href).toBe('http://[2001:db8::8]/nodes/IPv6/');
    expect(safeRemoteNodeUrl('http://2001:db8:::8/nodes/IPv6/')?.href).toBe('http://[2001:db8::]:8/nodes/IPv6/');
    expect(safeAbsoluteHttpUrl('http://::1:8/REST')).toBeNull();
    expect(safeAbsoluteHttpUrl('http://2001:db8:::8/REST')).toBeNull();
  });

  it('matches optional Java discovery host forms against canonical IPv6 URLs', () => {
    const nodeUrl = 'http://[::1]:8/nodes/IPv6/';
    expect(hostMatchesRemoteNodeUrl('::1', nodeUrl)).toBe(true);
    expect(hostMatchesRemoteNodeUrl('::1:8', nodeUrl)).toBe(true);
    expect(hostMatchesRemoteNodeUrl('[::1]:8', nodeUrl)).toBe(true);
    expect(hostMatchesRemoteNodeUrl('::1:9', nodeUrl)).toBe(false);
    expect(hostMatchesRemoteNodeUrl('::1:8/path', nodeUrl)).toBe(false);
  });

  it('keeps scoped IPv6 forms display-safe without inventing browser support', () => {
    const namedScope = 'http://fe80::1%EtherNet0:8085/nodes/Scoped/';
    const numericScope = 'http://fe80::1%3:8085/nodes/Numeric/';
    const encodedLookingScope = 'http://fe80::1%25EtherNet0:8085/nodes/Named/';
    expect(canonicalAbsoluteHttpHref(namedScope)).toBe('http://[fe80::1%25EtherNet0]:8085/nodes/Scoped/');
    expect(canonicalRemoteNodeHref(namedScope)).toBe('http://[fe80::1%25EtherNet0]:8085/nodes/Scoped/');
    expect(canonicalRemoteNodeHref(numericScope)).toBe('http://[fe80::1%253]:8085/nodes/Numeric/');
    expect(canonicalRemoteNodeHref(encodedLookingScope)).toBe('http://[fe80::1%2525EtherNet0]:8085/nodes/Named/');
    expect(safeAbsoluteHttpUrl(namedScope)).toBeNull();
    expect(safeRemoteNodeUrl(namedScope)).toBeNull();
    expect(safeNavigationUrl(namedScope)).toBeNull();
    expect(safeHostRestUrl('fe80::1%EtherNet0:8085')).toBeNull();
    expect(() => remoteNodeEndpoint(namedScope, 'REST/actions')).toThrow('Remote node URL is invalid');
  });

  it('rejects malformed IPv6 authorities before canonicalization', () => {
    for (const value of [
      'http://[::1:8085/REST',
      'http://[::1]extra:8085/REST',
      'http://user@::1:8085/REST',
      'http://[::1]:65536/REST',
      'http://[fe80::1%25EtherNet0]:65536/REST'
    ]) {
      expect(canonicalAbsoluteHttpHref(value), value).toBeNull();
    }
  });

  it('generates canonical local node paths and URLs', () => {
    expect(localNodePath('Living Room')).toBe('/nodes/LivingRoom/');
    expect(localNodePath('Café Δ')).toBe('/nodes/Caf%C3%A9%CE%94/');
    expect(localNodePath('Kitchen: A/B?')).toBe('/nodes/KitchenAB/');
    expect(localNodePath('A--B')).toBe('/nodes/A/');
    expect(localNodePath('\ufeff')).toBe('/nodes/%EF%BB%BF/');
    expect(() => localNodePath('\u00a0')).toThrow('reduce to at least one path character');
    expect(localNodePath('Demo')).toMatch(/^\/nodes\/[^/]+\/$/);
    expect(localNodeUrl('Demo')).toBe(new URL(localNodePath('Demo'), window.location.origin).href);
    expect(localNodeUrl('Demo', 'https://example.test/base/')).toBe('https://example.test/nodes/Demo/');
  });
});
