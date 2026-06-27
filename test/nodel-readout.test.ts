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

import '../src/components/nodel-readout';

function emitSignal(alias: string, arg: unknown) {
  for (const listener of activityMock.listeners) {
    listener({
      loading: false,
      connected: true,
      error: '',
      batch: { items: [{ entry: { seq: 1, timestamp: '2026-06-18T00:00:00Z', source: 'local', type: 'event', alias, arg }, changed: true, live: true }], replace: false, transport: 'websocket', nextSeq: 2 }
    });
  }
}

describe('nodel-readout', () => {
  beforeEach(() => {
    activityMock.listeners = [];
    document.body.innerHTML = '';
  });

  it('uses label for accessibility and renders value with variant and tone metadata', async () => {
    document.body.innerHTML = '<nodel-readout label="Source" value="HDMI 1" variant="primary" tone="soft"></nodel-readout>';
    await customElements.whenDefined('nodel-readout');
    await Promise.resolve();

    const readout = document.querySelector('nodel-readout') as HTMLElement;
    expect(readout.dataset.variant).toBe('primary');
    expect(readout.dataset.tone).toBe('soft');
    expect(readout.querySelector('.nodel-readout-label')).toBeNull();
    expect(readout.getAttribute('aria-label')).toBe('Source: HDMI 1');
    expect(readout.querySelector('.nodel-readout-value')?.textContent).toBe('HDMI 1');
  });

  it('formats numeric, percent, db, boolean, and duration values', async () => {
    document.body.innerHTML = `
      <nodel-readout type="number" value="22.54" precision="1" suffix="C"></nodel-readout>
      <nodel-readout type="percent" value="72"></nodel-readout>
      <nodel-readout type="db" value="3"></nodel-readout>
      <nodel-readout type="boolean" value="on"></nodel-readout>
      <nodel-readout type="duration" value="3661"></nodel-readout>
    `;
    await customElements.whenDefined('nodel-readout');
    await Promise.resolve();

    const values = Array.from(document.querySelectorAll('.nodel-readout-value')).map((node) => node.textContent);
    expect(values).toEqual(['22.5C', '72%', '+3 dB', 'On', '1:01:01']);
  });

  it('derives ring fraction and accessible meter metadata', async () => {
    document.body.innerHTML = '<nodel-readout label="Brightness" type="percent" visual="ring" value="75"></nodel-readout>';
    await customElements.whenDefined('nodel-readout');
    await Promise.resolve();

    const readout = document.querySelector('nodel-readout') as HTMLElement;
    expect(readout.dataset.visual).toBe('ring');
    expect(readout.style.getPropertyValue('--nodel-readout-fraction')).toBe('0.75');
    expect(readout.getAttribute('role')).toBe('meter');
    expect(readout.getAttribute('aria-label')).toBe('Brightness: 75%');
    expect(readout.getAttribute('aria-valuenow')).toBe('75');
  });

  it('updates value, label, variant, suffix, and prefix from signals', async () => {
    document.body.innerHTML = '<nodel-readout signal="Temp" signals="Name:label; Tone:variant; Unit:suffix; Prefix:prefix" type="number"></nodel-readout>';
    await customElements.whenDefined('nodel-readout');
    await Promise.resolve();

    const readout = document.querySelector('nodel-readout') as HTMLElement;
    emitSignal('Temp', 21);
    emitSignal('Name', 'Room');
    emitSignal('Tone', 'info');
    emitSignal('Unit', 'C');
    emitSignal('Prefix', '~');

    expect(readout.getAttribute('value')).toBe('21');
    expect(readout.getAttribute('label')).toBe('Room');
    expect(readout.dataset.variant).toBe('info');
    expect(readout.querySelector('.nodel-readout-value')?.textContent).toBe('~21C');
  });
});
