import { flush } from './helpers';

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

import '../src/components/nodel-title';

describe('nodel-title', () => {
  beforeEach(() => {
    activityMock.listeners = [];
    activityMock.dispose.mockClear();
    document.body.innerHTML = '<nodel-title>Page title</nodel-title>';
  });

  it('renders a semantic heading with default title styling state', async () => {
    await customElements.whenDefined('nodel-title');
    await flush();

    const title = document.querySelector('nodel-title') as HTMLElement;
    expect(title.getAttribute('role')).toBe('heading');
    expect(title.getAttribute('aria-level')).toBe('1');
    expect(title.dataset.level).toBe('1');
    expect(title.dataset.tone).toBe('default');
    expect(title.textContent).toBe('Page title');
  });

  it('applies level and tone attributes', async () => {
    document.body.innerHTML = '<nodel-title level="3" tone="muted">Section title</nodel-title>';
    await customElements.whenDefined('nodel-title');
    await flush();

    const title = document.querySelector('nodel-title') as HTMLElement;
    expect(title.getAttribute('aria-level')).toBe('3');
    expect(title.dataset.level).toBe('3');
    expect(title.dataset.tone).toBe('muted');
    expect(title.style.getPropertyValue('--nodel-title-color')).toContain('rgb(var(--nodel-muted))');
  });

  it('updates title text from matching local signal activity', async () => {
    document.body.innerHTML = '<nodel-title signal="PageTitle">Waiting</nodel-title>';
    await customElements.whenDefined('nodel-title');
    await flush();

    activityMock.listeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        items: [
          {
            entry: {
              seq: 1,
              timestamp: '2026-05-30T00:00:00Z',
              source: 'local',
              type: 'event',
              alias: 'PageTitle',
              arg: 'Live Overview'
            },
            changed: true,
            live: true
          }
        ],
        replace: false,
        transport: 'websocket',
        nextSeq: 2
      }
    });

    expect(document.querySelector('nodel-title')?.textContent).toBe('Live Overview');
  });
});
