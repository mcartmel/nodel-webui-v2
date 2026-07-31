import { updateHostFavicon } from '../src/icons/favicon';
import { generateHostIconDataUri } from '../src/icons/host-identicon';
import '../src/components/nodel-app';

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

  it('preserves an explicitly authored icon link', () => {
    const existing = document.createElement('link');
    existing.rel = 'icon';
    existing.href = '/favicon.ico';
    document.head.append(existing);

    const link = updateHostFavicon('example.local:8085');

    expect(link).toBe(existing);
    expect(document.head.querySelectorAll('link[rel*="icon"]').length).toBe(1);
    expect(link.href).toBe('http://localhost:3000/favicon.ico');
  });

  it('lets nodel-app create the generated fallback only when no icon is authored', async () => {
    document.body.innerHTML = '<nodel-app></nodel-app>';
    await customElements.whenDefined('nodel-app');
    const generated = document.head.querySelector<HTMLLinkElement>('link[data-nodel-host-favicon]');
    expect(generated?.href).toBe(generateHostIconDataUri(window.location.host));

    document.body.innerHTML = '';
    generated?.remove();
    const authored = document.createElement('link');
    authored.rel = 'icon';
    authored.href = '/brand.ico';
    document.head.append(authored);
    document.body.innerHTML = '<nodel-app></nodel-app>';
    await Promise.resolve();
    expect(document.head.querySelectorAll('link[rel*="icon"]')).toHaveLength(1);
    expect(authored.href).toBe('http://localhost:3000/brand.ico');
  });
});
