import {
  appendUrlPath,
  remoteNodeEndpoint,
  safeAbsoluteHttpUrl,
  safeHostRestUrl,
  safeImageSrc,
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
    expect(safeRemoteNodeUrl('https://display.test/nodes/Display/?mode=test')).toBeNull();
    expect(safeRemoteNodeUrl('https://display.test/nodes/Display/#status')).toBeNull();
    expect(remoteNodeEndpoint('https://display.test/nodes/Display/', 'REST/actions')).toBe('https://display.test/nodes/Display/REST/actions');
    expect(() => remoteNodeEndpoint('javascript:alert(1)', 'REST/actions')).toThrow('Remote node URL is invalid');
    expect(() => remoteNodeEndpoint('https://display.test/nodes/Display/', 'https://evil.test/REST/actions')).toThrow('Remote node URL is invalid');
    expect(() => remoteNodeEndpoint('https://display.test/nodes/Display/', '../REST/actions')).toThrow('Remote node URL is invalid');
  });

  it('handles external links, generated paths, images, and host probes separately', () => {
    const repository = safeAbsoluteHttpUrl('https://example.test/project')!;
    expect(appendUrlPath(repository, 'tree', 'feature/test').href).toBe('https://example.test/project/tree/feature%2Ftest');
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
  });
});
