import { updateHostFavicon } from '../src/icons/favicon';
import { generateHostIconDataUri } from '../src/icons/host-identicon';

describe('host favicon', () => {
  beforeEach(() => {
    document.head.querySelectorAll('link[rel*="icon"]').forEach((link) => link.remove());
  });

  afterEach(() => {
    document.head.querySelectorAll('link[rel*="icon"]').forEach((link) => link.remove());
  });

  it('sets the favicon to the generated host icon', () => {
    const link = updateHostFavicon('localhost:8085');

    expect(link.rel).toBe('shortcut icon');
    expect(link.type).toBe('image/svg+xml');
    expect(link.href).toBe(generateHostIconDataUri('localhost:8085'));
    expect(document.head.querySelectorAll('link[rel*="icon"]').length).toBe(1);
  });

  it('reuses an existing icon link', () => {
    const existing = document.createElement('link');
    existing.rel = 'icon';
    existing.href = '/favicon.ico';
    document.head.append(existing);

    const link = updateHostFavicon('example.local:8085');

    expect(link).toBe(existing);
    expect(document.head.querySelectorAll('link[rel*="icon"]').length).toBe(1);
    expect(link.href).toBe(generateHostIconDataUri('example.local:8085'));
  });
});
