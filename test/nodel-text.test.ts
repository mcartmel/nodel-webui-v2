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

import '../src/components/nodel-text';

describe('nodel-text', () => {
  beforeEach(() => {
    activityMock.listeners = [];
    activityMock.dispose.mockClear();
    document.body.innerHTML = '<nodel-text>Default text</nodel-text>';
  });

  it('renders default body text styling state', async () => {
    await customElements.whenDefined('nodel-text');
    await Promise.resolve();

    const text = document.querySelector('nodel-text') as HTMLElement;
    expect(text.dataset.tone).toBe('muted');
    expect(text.dataset.size).toBe('sm');
    expect(text.dataset.surface).toBe('none');
    expect(text.style.getPropertyValue('--nodel-text-color')).toContain('rgb(var(--nodel-muted))');
    expect(text.textContent).toContain('Default text');
  });

  it('applies card surface and custom tone/size', async () => {
    document.body.innerHTML = '<nodel-text tone="accent" size="lg" surface="card">Card text</nodel-text>';
    await customElements.whenDefined('nodel-text');
    await Promise.resolve();

    const text = document.querySelector('nodel-text') as HTMLElement;
    expect(text.dataset.tone).toBe('accent');
    expect(text.dataset.size).toBe('lg');
    expect(text.dataset.surface).toBe('card');
    expect(text.style.getPropertyValue('--nodel-text-padding')).toBe('1rem');
    expect(text.style.getPropertyValue('--nodel-text-background')).toContain('rgb(var(--nodel-surface))');
  });

  it('updates text from matching local signal activity', async () => {
    document.body.innerHTML = '<nodel-text signal="Status">Waiting</nodel-text>';
    await customElements.whenDefined('nodel-text');
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
              alias: 'Status',
              arg: 'Online'
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

    expect(document.querySelector('nodel-text')?.textContent).toBe('Online');
  });
});
