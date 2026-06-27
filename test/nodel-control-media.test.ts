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

import '../src/components/nodel-image';
import '../src/components/nodel-icon';
import '../src/components/nodel-status-indicator';

function emitSignal(alias: string, arg: unknown) {
  for (const listener of activityMock.listeners) {
    listener({
      loading: false,
      connected: true,
      error: '',
      batch: {
        items: [
          {
            entry: {
              seq: 1,
              timestamp: '2026-06-06T00:00:00Z',
              source: 'local',
              type: 'event',
              alias,
              arg
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
  }
}

describe('control media components', () => {
  beforeEach(() => {
    activityMock.listeners = [];
    activityMock.dispose.mockClear();
    document.body.innerHTML = '';
  });

  it('renders nodel-image attributes and signal updates', async () => {
    document.body.innerHTML = '<nodel-image src="one.png" alt="One" label="Input" fit="cover" shape="circle" size="lg" variant="soft" signals="ImageSrc:src; ImageLabel:label"></nodel-image>';
    await customElements.whenDefined('nodel-image');
    await flush();

    const image = document.querySelector('nodel-image') as HTMLElement;
    expect(image.dataset.fit).toBe('cover');
    expect(image.dataset.shape).toBe('circle');
    expect(image.dataset.size).toBe('lg');
    expect(image.dataset.variant).toBe('soft');
    expect(image.querySelector('img')?.getAttribute('src')).toBe('one.png');
    expect(image.querySelector('.nodel-image-label')).toBeNull();
    expect(image.getAttribute('aria-label')).toBe('Input');

    emitSignal('ImageSrc', 'two.png');
    emitSignal('ImageLabel', 'Output');
    expect(image.querySelector('img')?.getAttribute('src')).toBe('two.png');
    expect(image.getAttribute('aria-label')).toBe('Output');
  });

  it('renders nodel-icon and signal updates', async () => {
    document.body.innerHTML = '<nodel-icon name="power" label="Power" tone="accent" size="xl" variant="bordered" signals="IconName:name; IconTone:tone"></nodel-icon>';
    await customElements.whenDefined('nodel-icon');
    await flush();

    const icon = document.querySelector('nodel-icon') as HTMLElement;
    expect(icon.dataset.name).toBe('power');
    expect(icon.dataset.tone).toBe('accent');
    expect(icon.dataset.size).toBe('xl');
    expect(icon.dataset.variant).toBe('bordered');
    expect(icon.getAttribute('aria-label')).toBe('Power');

    emitSignal('IconName', 'volume');
    emitSignal('IconTone', 'success');
    expect(icon.dataset.name).toBe('volume');
    expect(icon.dataset.tone).toBe('success');
  });

  it('supports accessible icon alt text without a visible label', async () => {
    document.body.innerHTML = '<nodel-icon name="power" alt="Power" tone="accent"></nodel-icon>';
    await customElements.whenDefined('nodel-icon');
    await flush();

    const icon = document.querySelector('nodel-icon') as HTMLElement;
    expect(icon.getAttribute('aria-label')).toBe('Power');
    expect(icon.querySelector('.nodel-icon-label')).toBeNull();
  });

  it('renders nodel-status-indicator state from values and signals', async () => {
    document.body.innerHTML = '<nodel-status-indicator signal="Present" label="Signal present"></nodel-status-indicator>';
    await customElements.whenDefined('nodel-status-indicator');
    await flush();

    const indicator = document.querySelector('nodel-status-indicator') as HTMLElement;
    expect(indicator.dataset.state).toBe('off');
    expect(indicator.getAttribute('role')).toBe('status');

    emitSignal('Present', 'present');
    expect(indicator.dataset.state).toBe('on');

    emitSignal('Present', 'absent');
    expect(indicator.dataset.state).toBe('off');
  });

  it('supports exact on-value overrides for status indicators', async () => {
    document.body.innerHTML = '<nodel-status-indicator value="Locked" on-value="Available"></nodel-status-indicator>';
    await customElements.whenDefined('nodel-status-indicator');
    await flush();

    const indicator = document.querySelector('nodel-status-indicator') as HTMLElement;
    expect(indicator.dataset.state).toBe('off');
    indicator.setAttribute('value', 'Available');
    expect(indicator.dataset.state).toBe('on');
  });
});
