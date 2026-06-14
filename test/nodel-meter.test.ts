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

import '../src/components/nodel-meter';

function emitSignal(alias: string, arg: unknown) {
  for (const listener of activityMock.listeners) {
    listener({
      loading: false,
      connected: true,
      error: '',
      batch: {
        items: [{ entry: { seq: 1, timestamp: '2026-06-14T00:00:00Z', source: 'local', type: 'event', alias, arg }, changed: true, live: true }],
        replace: false,
        transport: 'websocket',
        nextSeq: 2
      }
    });
  }
}

describe('nodel-meter', () => {
  beforeEach(() => {
    activityMock.listeners = [];
    activityMock.dispose.mockClear();
    document.body.innerHTML = '<nodel-meter value="50" label="Output"></nodel-meter>';
  });

  it('renders value, zone, readout, and accessibility metadata', async () => {
    await customElements.whenDefined('nodel-meter');
    await Promise.resolve();

    const meter = document.querySelector('nodel-meter') as HTMLElement;
    expect(meter.dataset.orientation).toBe('vertical');
    expect(meter.style.getPropertyValue('--nodel-meter-value')).toBe('0.5');
    expect(meter.getAttribute('role')).toBe('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('50');
    expect(meter.querySelector('.nodel-meter-readout')?.textContent).toBe('50%');
    expect((meter.querySelector('.nodel-meter-readout') as HTMLElement).hidden).toBe(true);
  });

  it('supports dB range and danger zones', async () => {
    document.body.innerHTML = '<nodel-meter unit="db" value="8" readout="show" label="Level"></nodel-meter>';
    await customElements.whenDefined('nodel-meter');
    await Promise.resolve();

    const meter = document.querySelector('nodel-meter') as HTMLElement;
    expect(meter.style.getPropertyValue('--nodel-meter-value')).toBe(String(68 / 70));
    expect(meter.dataset.zone).toBe('danger');
    expect(meter.querySelector('.nodel-meter-readout')?.textContent).toBe('+8 dB');
  });

  it('updates value, peak, and label from signals', async () => {
    document.body.innerHTML = '<nodel-meter signal="Level" signals="Peak:peak; MeterLabel:label" peak="hold"></nodel-meter>';
    await customElements.whenDefined('nodel-meter');
    await Promise.resolve();

    const meter = document.querySelector('nodel-meter') as HTMLElement;
    emitSignal('Level', 75);
    emitSignal('Peak', 90);
    emitSignal('MeterLabel', 'Program');

    expect(meter.getAttribute('value')).toBe('75');
    expect(meter.getAttribute('data-explicit-peak')).toBe('90');
    expect(meter.getAttribute('label')).toBe('Program');
    expect(meter.style.getPropertyValue('--nodel-meter-peak')).toBe('0.9');
  });
});
