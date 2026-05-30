const activityMock = vi.hoisted(() => ({
  listeners: [] as Array<(state: any) => void>,
  dispose: vi.fn()
}));

vi.mock('../src/data/node-activity-source', () => ({
  subscribeNodeActivity: vi.fn((_element: HTMLElement, listener: (state: any) => void) => {
    activityMock.listeners.push(listener);
    return { dispose: activityMock.dispose };
  })
}));

import '../src/components/nodel-host-icon';
import { generateHostIconDataUri } from '../src/icons/host-identicon';

describe('nodel-host-icon', () => {
  beforeEach(() => {
    activityMock.listeners = [];
    activityMock.dispose.mockClear();
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

  it('updates host icon attributes from signal bindings', async () => {
    document.body.innerHTML = `
      <nodel-host-icon
        host="Waiting"
        signal="HostName"
        signals="HostAddress:icon-host; HostUrl:href; HostTitle:title"
      ></nodel-host-icon>
    `;
    await customElements.whenDefined('nodel-host-icon');
    await Promise.resolve();

    activityMock.listeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        items: [
          {
            entry: { seq: 1, timestamp: '2026-05-30T00:00:00Z', source: 'local', type: 'event', alias: 'HostName', arg: 'Display Node' },
            changed: true,
            live: true
          },
          {
            entry: { seq: 2, timestamp: '2026-05-30T00:00:01Z', source: 'local', type: 'event', alias: 'HostAddress', arg: '192.168.1.42:8085' },
            changed: true,
            live: true
          },
          {
            entry: { seq: 3, timestamp: '2026-05-30T00:00:02Z', source: 'local', type: 'event', alias: 'HostUrl', arg: 'http://192.168.1.42:8085/' },
            changed: true,
            live: true
          },
          {
            entry: { seq: 4, timestamp: '2026-05-30T00:00:03Z', source: 'local', type: 'event', alias: 'HostTitle', arg: 'Open display node' },
            changed: true,
            live: true
          }
        ],
        replace: false,
        transport: 'websocket',
        nextSeq: 5
      }
    });

    const link = document.querySelector('nodel-host-icon a') as HTMLAnchorElement | null;
    const icon = document.querySelector('nodel-host-icon img') as HTMLImageElement | null;

    expect(link?.getAttribute('href')).toBe('http://192.168.1.42:8085/');
    expect(link?.getAttribute('title')).toBe('Open display node');
    expect(icon?.getAttribute('src')).toBe(generateHostIconDataUri('192.168.1.42:8085'));
    expect(icon?.getAttribute('alt')).toBe('Display Node');
  });
});
