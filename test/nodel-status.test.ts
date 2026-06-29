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

import { flush } from './helpers';

import '../src/components/nodel-status';

function emitSignal(alias: string, arg: unknown) {
  for (const listener of activityMock.listeners) {
    listener({
      loading: false,
      connected: true,
      error: '',
      batch: { items: [{ entry: { seq: 1, timestamp: '2026-06-29T00:00:00Z', source: 'local', type: 'event', alias, arg }, changed: true, live: true }], replace: false, transport: 'websocket', nextSeq: 2 }
    });
  }
}

describe('nodel-status', () => {
  beforeEach(() => {
    activityMock.listeners = [];
    activityMock.dispose.mockClear();
    document.body.innerHTML = '';
  });

  it('renders a labelled unknown status block with preserved children', async () => {
    document.body.innerHTML = '<nodel-status label="Projector"><nodel-button action="Power">Power</nodel-button></nodel-status>';
    await customElements.whenDefined('nodel-status');
    await flush();

    const status = document.querySelector('nodel-status') as HTMLElement;
    const shell = status.querySelector('.nodel-status-shell') as HTMLElement;
    const label = status.querySelector('.nodel-status-label') as HTMLElement;
    const message = status.querySelector('.nodel-status-message') as HTMLElement;
    const button = status.querySelector('nodel-button') as HTMLElement;
    const scaleSteps = Array.from(status.querySelectorAll('.nodel-status-scale span')).map((step) => step.getAttribute('data-status-step'));

    expect(status.dataset.state).toBe('unknown');
    expect(status.dataset.surface).toBe('card');
    expect(status.dataset.padding).toBe('default');
    expect(status.dataset.tone).toBe('soft');
    expect(shell.getAttribute('role')).toBe('group');
    expect(shell.getAttribute('aria-labelledby')).toBe(label.id);
    expect(label.textContent).toBe('Projector');
    expect(message.getAttribute('role')).toBe('status');
    expect(message.getAttribute('aria-live')).toBe('polite');
    expect(message.textContent).toBe('Unknown');
    expect(scaleSteps).toEqual(['muted', 'danger', 'warning', 'info', 'success']);
    expect(status.querySelector('.nodel-status-body nodel-button')).toBe(button);
    expect(button.getAttribute('aria-labelledby')).toBeNull();
  });

  it('infers simple signal values conservatively and displays useful text', async () => {
    document.body.innerHTML = '<nodel-status label="Device" signal="DeviceState"></nodel-status>';
    await customElements.whenDefined('nodel-status');
    await flush();

    const status = document.querySelector('nodel-status') as HTMLElement;
    const message = status.querySelector('.nodel-status-message') as HTMLElement;

    emitSignal('DeviceState', 'ready');
    expect(status.dataset.state).toBe('success');
    expect(message.textContent).toBe('ready');

    emitSignal('DeviceState', 'offline');
    expect(status.dataset.state).toBe('muted');
    expect(message.textContent).toBe('offline');

    emitSignal('DeviceState', 'standby');
    expect(status.dataset.state).toBe('unknown');
    expect(message.textContent).toBe('standby');
  });

  it('maps boolean-like values to friendly status messages', async () => {
    document.body.innerHTML = '<nodel-status label="Online" signal="Online"></nodel-status>';
    await customElements.whenDefined('nodel-status');
    await flush();

    const status = document.querySelector('nodel-status') as HTMLElement;
    const message = status.querySelector('.nodel-status-message') as HTMLElement;

    emitSignal('Online', true);
    expect(status.dataset.state).toBe('success');
    expect(message.textContent).toBe('OK');

    emitSignal('Online', false);
    expect(status.dataset.state).toBe('muted');
    expect(message.textContent).toBe('Offline');
  });

  it('supports case-insensitive exact state maps for local values', async () => {
    document.body.innerHTML = '<nodel-status label="Amp" value="Standby" state-map="standby:muted; warming:info; protect:danger"></nodel-status>';
    await customElements.whenDefined('nodel-status');
    await flush();

    const status = document.querySelector('nodel-status') as HTMLElement;
    expect(status.dataset.state).toBe('muted');

    status.setAttribute('value', 'Protect');
    expect(status.dataset.state).toBe('danger');
  });

  it('maps v1-style levels to normalized states', async () => {
    document.body.innerHTML = '<nodel-status label="Status"></nodel-status>';
    await customElements.whenDefined('nodel-status');
    await flush();

    const status = document.querySelector('nodel-status') as HTMLElement;
    status.setAttribute('level', '0');
    expect(status.dataset.state).toBe('success');
    status.setAttribute('level', '1');
    expect(status.dataset.state).toBe('warning');
    status.setAttribute('level', '3');
    expect(status.dataset.state).toBe('danger');
    status.setAttribute('level', '5');
    expect(status.dataset.state).toBe('info');
  });

  it('updates level and message from explicit structured signal paths', async () => {
    document.body.innerHTML = '<nodel-status label="Network" signals="NetworkStatus.level:level; NetworkStatus.message:message"></nodel-status>';
    await customElements.whenDefined('nodel-status');
    await flush();

    const status = document.querySelector('nodel-status') as HTMLElement;
    emitSignal('NetworkStatus', { level: 1, message: 'Packet loss warning' });

    expect(status.dataset.state).toBe('warning');
    expect(status.querySelector('.nodel-status-message')?.textContent).toBe('Packet loss warning');
  });

  it('falls back to state labels when an explicit message path is missing', async () => {
    document.body.innerHTML = '<nodel-status label="Network" signals="NetworkStatus.level:level; NetworkStatus.message:message"></nodel-status>';
    await customElements.whenDefined('nodel-status');
    await flush();

    const status = document.querySelector('nodel-status') as HTMLElement;
    emitSignal('NetworkStatus', { level: 4 });

    expect(status.dataset.state).toBe('danger');
    expect(status.querySelector('.nodel-status-message')?.textContent).toBe('Fault');
  });

  it('auto-detects v1-style whole-object signal values', async () => {
    document.body.innerHTML = '<nodel-status label="Projector" signal="ProjectorStatus"></nodel-status>';
    await customElements.whenDefined('nodel-status');
    await flush();

    const status = document.querySelector('nodel-status') as HTMLElement;
    emitSignal('ProjectorStatus', { level: 4, message: 'Lamp fault' });

    expect(status.dataset.state).toBe('danger');
    expect(status.querySelector('.nodel-status-message')?.textContent).toBe('Lamp fault');
  });

  it('keeps explicit messages ahead of structured object messages', async () => {
    document.body.innerHTML = '<nodel-status label="Projector" signal="ProjectorStatus" message="Manual override"></nodel-status>';
    await customElements.whenDefined('nodel-status');
    await flush();

    const status = document.querySelector('nodel-status') as HTMLElement;
    emitSignal('ProjectorStatus', { level: 4, message: 'Lamp fault' });

    expect(status.dataset.state).toBe('danger');
    expect(status.querySelector('.nodel-status-message')?.textContent).toBe('Manual override');
  });
});
