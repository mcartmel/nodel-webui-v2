import { flush } from './helpers';

const actionMock = vi.hoisted(() => ({
  callNodeAction: vi.fn()
}));

const activityMock = vi.hoisted(() => ({
  listeners: [] as Array<(state: any) => void>,
  dispose: vi.fn()
}));

vi.mock('../src/api/nodel-host-client', () => ({
  callNodeAction: actionMock.callNodeAction
}));

vi.mock('../src/data/node-activity-source', () => ({
  subscribeNodeActivity: vi.fn((_element: HTMLElement, listener: (state: any) => void) => {
    activityMock.listeners.push(listener);
    return { dispose: activityMock.dispose };
  })
}));

import '../src/components/nodel-toggle';
import '../src/components/nodel-group';

function emitSignal(alias: string, arg: unknown) {
  for (const listener of activityMock.listeners) {
    listener({
      loading: false,
      connected: true,
      error: '',
      batch: {
        items: [{ entry: { seq: 1, timestamp: '2026-06-06T00:00:00Z', source: 'local', type: 'event', alias, arg }, changed: true, live: true }],
        replace: false,
        transport: 'websocket',
        nextSeq: 2
      }
    });
  }
}

describe('nodel-toggle', () => {
  beforeEach(() => {
    actionMock.callNodeAction.mockReset();
    actionMock.callNodeAction.mockResolvedValue({});
    activityMock.listeners = [];
    activityMock.dispose.mockClear();
    document.body.innerHTML = '';
  });

  it('renders switch states and mixed aria for partials', async () => {
    document.body.innerHTML = '<nodel-toggle label="Lighting" value="partially-on"></nodel-toggle>';
    await customElements.whenDefined('nodel-toggle');
    await flush();

    const host = document.querySelector('nodel-toggle') as HTMLElement;
    const button = host.querySelector('button') as HTMLButtonElement;

    expect(host.dataset.state).toBe('partially-on');
    expect(host.dataset.stateLabel).toBe('hide');
    expect(button.getAttribute('role')).toBe('switch');
    expect(button.getAttribute('aria-label')).toBe('Lighting');
    expect(button.getAttribute('aria-checked')).toBe('mixed');
    expect(host.querySelector<HTMLElement>('.nodel-toggle-state')?.hidden).toBe(true);
    expect(button.textContent).not.toContain('Lighting');
    expect(button.textContent).not.toContain('Partial On');
  });

  it('can show visible state text when requested', async () => {
    document.body.innerHTML = '<nodel-toggle label="Lighting" value="partially-on" state-label="show"></nodel-toggle>';
    await customElements.whenDefined('nodel-toggle');
    await flush();

    const host = document.querySelector('nodel-toggle') as HTMLElement;
    expect(host.dataset.stateLabel).toBe('show');
    expect(host.querySelector<HTMLElement>('.nodel-toggle-state')?.hidden).toBe(false);
    expect(host.querySelector('button')?.textContent).toContain('Partial On');
  });

  it('renders state icons independent of visible state text', async () => {
    document.body.innerHTML = '<nodel-toggle label="Theme" value="off" off-icon="sun" on-icon="moon"></nodel-toggle>';
    await customElements.whenDefined('nodel-toggle');
    await flush();

    const host = document.querySelector('nodel-toggle') as HTMLElement;
    const icon = host.querySelector('.nodel-toggle-state-icon') as HTMLElement;

    expect(host.querySelector<HTMLElement>('.nodel-toggle-state')?.hidden).toBe(true);
    expect(icon.hidden).toBe(false);
    expect(icon.parentElement?.classList.contains('nodel-toggle-thumb')).toBe(true);
    expect(icon.querySelector('svg')?.dataset.icon).toBe('sun');

    host.setAttribute('value', 'on');
    await flush();
    expect(icon.querySelector('svg')?.dataset.icon).toBe('moon');
  });

  it('renders state icons with visible state labels and partial fallbacks', async () => {
    document.body.innerHTML = '<nodel-toggle label="Theme" value="partially-off" off-icon="sun" on-icon="moon" off-label="Light" on-label="Dark" state-label="show"></nodel-toggle>';
    await customElements.whenDefined('nodel-toggle');
    await flush();

    const host = document.querySelector('nodel-toggle') as HTMLElement;
    const icon = host.querySelector('.nodel-toggle-state-icon') as HTMLElement;

    expect(icon.querySelector('svg')?.dataset.icon).toBe('sun');
    expect(host.querySelector('.nodel-toggle-state')?.textContent).toBe('Partial Light');

    host.setAttribute('value', 'partially-on');
    await flush();
    expect(icon.querySelector('svg')?.dataset.icon).toBe('moon');
    expect(host.querySelector('.nodel-toggle-state')?.textContent).toBe('Partial Dark');
  });

  it('keeps grouped accessible labels separate from visual state icons', async () => {
    document.body.innerHTML = '<nodel-group label="Theme"><nodel-toggle value="on" off-icon="sun" on-icon="moon"></nodel-toggle></nodel-group>';
    await customElements.whenDefined('nodel-group');
    await customElements.whenDefined('nodel-toggle');
    await flush();

    const group = document.querySelector('nodel-group') as HTMLElement;
    const label = group.querySelector('.nodel-group-label') as HTMLElement;
    const toggle = group.querySelector('nodel-toggle') as HTMLElement;
    const button = toggle.querySelector('button') as HTMLButtonElement;

    expect(toggle.getAttribute('aria-labelledby')).toBe(label.id);
    expect(button.getAttribute('aria-labelledby')).toBe(label.id);
    expect(button.getAttribute('aria-label')).toBeNull();
    expect(toggle.querySelector('.nodel-toggle-state-content')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('supports configurable off variants', async () => {
    document.body.innerHTML = '<nodel-toggle value="off" off-variant="danger"></nodel-toggle>';
    await customElements.whenDefined('nodel-toggle');
    await flush();

    const host = document.querySelector('nodel-toggle') as HTMLElement;
    expect(host.dataset.offVariant).toBe('danger');
    expect(host.querySelector('button')?.className).toBe('nodel-toggle');
  });

  it('keeps the off state neutral by default', async () => {
    document.body.innerHTML = '<nodel-toggle value="off"></nodel-toggle>';
    await customElements.whenDefined('nodel-toggle');
    await flush();

    const host = document.querySelector('nodel-toggle') as HTMLElement;
    expect(host.dataset.variant).toBe('success');
    expect(host.dataset.offVariant).toBe('default');
  });

  it('calls on/off args based on onish state', async () => {
    document.body.innerHTML = '<nodel-toggle label="Power" action="SetPower" value="off" on-arg="1" off-arg="0" arg-type="number"></nodel-toggle>';
    await customElements.whenDefined('nodel-toggle');
    await flush();

    const host = document.querySelector('nodel-toggle') as HTMLElement;
    host.querySelector('button')?.click();
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenLastCalledWith('SetPower', { arg: 1 });

    host.setAttribute('value', 'on');
    host.querySelector('button')?.click();
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenLastCalledWith('SetPower', { arg: 0 });
  });

  it('uses join and action phases for toggle state changes', async () => {
    document.body.innerHTML = '<nodel-toggle join="Power" actions="PowerOn:on; PowerOff:off" value="off"></nodel-toggle>';
    await customElements.whenDefined('nodel-toggle');
    await flush();

    const host = document.querySelector('nodel-toggle') as HTMLElement;
    host.querySelector('button')?.click();
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('PowerOn', { arg: true });

    emitSignal('Power', 'on');
    expect(host.dataset.state).toBe('on');
  });

  it('updates state, label, and disabled from signal bindings', async () => {
    document.body.innerHTML = '<nodel-toggle signal="Power" signals="Name:label; Locked:disabled">Power</nodel-toggle>';
    await customElements.whenDefined('nodel-toggle');
    await flush();

    const host = document.querySelector('nodel-toggle') as HTMLElement;
    emitSignal('Power', 'on');
    expect(host.dataset.state).toBe('on');

    emitSignal('Name', 'Main Power');
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Main Power');
    expect(host.querySelector('button')?.textContent).not.toContain('Main Power');

    emitSignal('Locked', 'true');
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
  });

  it('gates actions through confirmation', async () => {
    document.body.innerHTML = '<nodel-toggle label="Power" action="SetPower" confirm-text="Continue?"></nodel-toggle>';
    await customElements.whenDefined('nodel-toggle');
    await flush();

    const host = document.querySelector('nodel-toggle') as HTMLElement;
    let confirmed = false;
    host.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      (event as CustomEvent).detail.resolve(confirmed);
    });
    host.querySelector('button')?.click();
    await flush();
    expect(actionMock.callNodeAction).not.toHaveBeenCalled();

    confirmed = true;
    host.querySelector('button')?.click();
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenCalledTimes(1);
  });

  it('dispatches error and toast details when action calls fail', async () => {
    actionMock.callNodeAction.mockRejectedValue(new Error('No route'));
    document.body.innerHTML = '<nodel-toggle action="Missing"></nodel-toggle>';
    await customElements.whenDefined('nodel-toggle');
    await flush();

    const host = document.querySelector('nodel-toggle') as HTMLElement;
    const error = vi.fn();
    const toast = vi.fn();
    host.addEventListener('nodel-toggle-error', error);
    host.addEventListener('nodel-toast', toast);
    host.querySelector('button')?.click();
    await flush();

    expect(error).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0].detail).toMatchObject({ tone: 'danger', detail: 'No route' });
  });

  it('does not dispatch change events when action calls fail', async () => {
    actionMock.callNodeAction.mockRejectedValue(new Error('No route'));
    document.body.innerHTML = '<nodel-toggle action="Missing"></nodel-toggle>';
    await customElements.whenDefined('nodel-toggle');
    await flush();

    const host = document.querySelector('nodel-toggle') as HTMLElement;
    const change = vi.fn();
    host.addEventListener('nodel-toggle-change', change);
    host.querySelector('button')?.click();
    await flush();

    expect(change).not.toHaveBeenCalled();
  });
});
