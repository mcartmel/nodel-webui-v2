import '../src/components/nodel-host-icon';
import { generateHostIconDataUri } from '../src/icons/host-identicon';

describe('nodel-host-icon', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders an image using the host identicon by default', async () => {
    document.body.innerHTML = '<nodel-host-icon></nodel-host-icon>';
    await customElements.whenDefined('nodel-host-icon');
    await Promise.resolve();

    const icon = document.querySelector('nodel-host-icon img') as HTMLImageElement | null;
    expect(icon?.getAttribute('src')).toBe(generateHostIconDataUri(window.location.host));
    expect(icon?.getAttribute('alt')).toBe(window.location.host);
    expect(document.querySelector('nodel-host-icon a')).toBeNull();
  });

  it('renders a linked host icon when href is set', async () => {
    document.body.innerHTML = `
      <nodel-host-icon
        host="node-a"
        icon-host="node-b"
        href="https://example.test/"
        title="Browse this host"
        alt="Host icon"
      ></nodel-host-icon>
    `;
    await customElements.whenDefined('nodel-host-icon');
    await Promise.resolve();

    const link = document.querySelector('nodel-host-icon a') as HTMLAnchorElement | null;
    const icon = document.querySelector('nodel-host-icon img') as HTMLImageElement | null;

    expect(link?.getAttribute('href')).toBe('https://example.test/');
    expect(link?.getAttribute('title')).toBe('Browse this host');
    expect(icon?.getAttribute('src')).toBe(generateHostIconDataUri('node-b'));
    expect(icon?.getAttribute('alt')).toBe('Host icon');
  });
});
