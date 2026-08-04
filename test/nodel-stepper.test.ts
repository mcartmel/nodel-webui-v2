import { flush } from './helpers';

const actionMock = vi.hoisted(() => ({ callNodeAction: vi.fn() }));
const activityMock = vi.hoisted(() => ({ listeners: [] as Array<(state: any) => void>, dispose: vi.fn() }));

vi.mock('../src/api/nodel-host-client', () => ({ callNodeAction: (name: string, payload: unknown) => actionMock.callNodeAction(name, payload) }));
vi.mock('../src/data/node-activity-source', () => ({
  subscribeNodeActivity: vi.fn((_element: HTMLElement, listener: (state: any) => void) => {
    activityMock.listeners.push(listener);
    return { dispose: activityMock.dispose };
  })
}));

import '../src/components/nodel-stepper';

function emitSignal(alias: string, arg: unknown) {
  for (const listener of activityMock.listeners) {
    listener({ loading: false, connected: true, error: '', batch: { items: [{ entry: { seq: 1, timestamp: '2026-06-18T00:00:00Z', source: 'local', type: 'event', alias, arg }, changed: true, live: true }], replace: false, transport: 'websocket', nextSeq: 2 } });
  }
}

function pointerDown() {
  const event = new Event('pointerdown', { bubbles: true, cancelable: true }) as Event & { pointerId: number };
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

function pointerUp() {
  const event = new Event('pointerup', { bubbles: true, cancelable: true }) as Event & { pointerId: number };
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

describe('nodel-stepper', () => {
  beforeEach(() => {
    actionMock.callNodeAction.mockReset();
    actionMock.callNodeAction.mockResolvedValue({});
    activityMock.listeners = [];
    document.body.innerHTML = '';
  });

  it('uses label for accessibility, readout, and edge-disabled buttons', async () => {
    document.body.innerHTML = '<nodel-stepper label="Trim" value="0" min="0" max="10" variant="info" tone="outline"></nodel-stepper>';
    await customElements.whenDefined('nodel-stepper');
    await Promise.resolve();

    const stepper = document.querySelector('nodel-stepper') as HTMLElement;
    expect(stepper.dataset.variant).toBe('info');
    expect(stepper.dataset.tone).toBe('outline');
    expect(stepper.querySelector('.nodel-stepper-label')).toBeNull();
    expect(stepper.querySelector('.nodel-stepper-shell')?.getAttribute('aria-label')).toBe('Trim');
    expect(stepper.querySelector('.nodel-stepper-decrease')?.getAttribute('aria-label')).toBe('Decrease Trim');
    expect(stepper.querySelector('.nodel-stepper-readout')?.textContent).toBe('0');
    expect((stepper.querySelector('.nodel-stepper-decrease') as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls an action and commits a snapped numeric value', async () => {
    document.body.innerHTML = '<nodel-stepper action="SetTemp" value="20" step="0.5" suffix="C"></nodel-stepper>';
    await customElements.whenDefined('nodel-stepper');
    await Promise.resolve();

    const increase = document.querySelector('.nodel-stepper-increase') as HTMLButtonElement;
    increase.dispatchEvent(pointerDown());
    document.dispatchEvent(pointerUp());
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledTimes(1);
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetTemp', { arg: 20.5 });
    expect(document.querySelector('nodel-stepper')?.getAttribute('value')).toBe('20.5');
  });

  it('performs one committed action when repeat is off', async () => {
    document.body.innerHTML = '<nodel-stepper action="SetTemp" value="20" repeat="off"></nodel-stepper>';
    await customElements.whenDefined('nodel-stepper');
    await Promise.resolve();

    const increase = document.querySelector('.nodel-stepper-increase') as HTMLButtonElement;
    increase.dispatchEvent(pointerDown());
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledTimes(1);
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetTemp', { arg: 21 });
  });

  it('does not call actions when stepper confirmation is cancelled', async () => {
    document.body.innerHTML = '<nodel-stepper action="SetTemp" value="20" confirm-text="Set value?"></nodel-stepper>';
    await customElements.whenDefined('nodel-stepper');
    await Promise.resolve();

    const stepper = document.querySelector('nodel-stepper') as HTMLElement;
    stepper.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      (event as CustomEvent).detail.resolve(false);
    });
    document.querySelector('.nodel-stepper-increase')?.dispatchEvent(pointerDown());
    document.dispatchEvent(pointerUp());
    await flush();

    expect(actionMock.callNodeAction).not.toHaveBeenCalled();
    expect(stepper.getAttribute('value')).toBe('20');
  });

  it('does not let a cancelled confirmation from an old connection roll back a fresh value', async () => {
    document.body.innerHTML = '<nodel-stepper action="SetTemp" value="20" confirm-text="Set value?"></nodel-stepper>';
    await customElements.whenDefined('nodel-stepper');
    await Promise.resolve();

    const stepper = document.querySelector('nodel-stepper') as HTMLElement;
    stepper.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
    });
    stepper.querySelector('.nodel-stepper-increase')?.dispatchEvent(pointerDown());

    document.body.removeChild(stepper);
    document.body.appendChild(stepper);
    stepper.setAttribute('value', '30');
    stepper.removeAttribute('confirm-text');
    stepper.querySelector('.nodel-stepper-shell')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetTemp', { arg: 31 });
    expect(stepper.getAttribute('value')).toBe('31');
  });

  it('clears repeat ownership when disconnected between generations', async () => {
    document.body.innerHTML = '<nodel-stepper action="SetTemp" value="20"></nodel-stepper>';
    await customElements.whenDefined('nodel-stepper');
    await Promise.resolve();

    const stepper = document.querySelector('nodel-stepper') as HTMLElement & { repeatStartValue?: string | null };
    stepper.querySelector('.nodel-stepper-increase')?.dispatchEvent(pointerDown());
    expect(stepper.repeatStartValue).toBe('20');

    document.body.removeChild(stepper);
    expect(stepper.repeatStartValue).toBeNull();
    document.body.appendChild(stepper);
    stepper.setAttribute('value', '30');
    expect(stepper.repeatStartValue).toBeNull();
  });

  it('ignores stale failed commits after a newer stepper value succeeds', async () => {
    let rejectFirst: (error: Error) => void = () => undefined;
    actionMock.callNodeAction
      .mockReturnValueOnce(new Promise<void>((_resolve, reject) => {
        rejectFirst = reject;
      }))
      .mockResolvedValueOnce({});
    document.body.innerHTML = '<nodel-stepper action="SetTemp" value="20"></nodel-stepper>';
    await customElements.whenDefined('nodel-stepper');
    await Promise.resolve();

    const stepper = document.querySelector('nodel-stepper') as HTMLElement;
    const shell = stepper.querySelector('.nodel-stepper-shell') as HTMLElement;
    shell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    shell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    await flush();
    expect(stepper.getAttribute('value')).toBe('22');

    rejectFirst(new Error('No route'));
    await flush();
    expect(stepper.getAttribute('value')).toBe('22');
  });

  it('uses join as action and value signal shorthand', async () => {
    document.body.innerHTML = '<nodel-stepper join="Level" value="5" step="5"></nodel-stepper>';
    await customElements.whenDefined('nodel-stepper');
    await Promise.resolve();

    const stepper = document.querySelector('nodel-stepper') as HTMLElement;
    emitSignal('Level', 25);
    expect(stepper.getAttribute('value')).toBe('25');

    stepper.querySelector('.nodel-stepper-shell')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('Level', { arg: 20 });
  });

  it('updates label and disabled from signals', async () => {
    document.body.innerHTML = '<nodel-stepper signals="Name:label; Lock:disabled"></nodel-stepper>';
    await customElements.whenDefined('nodel-stepper');
    await Promise.resolve();

    const stepper = document.querySelector('nodel-stepper') as HTMLElement;
    emitSignal('Name', 'Temperature');
    emitSignal('Lock', true);

    expect(stepper.getAttribute('label')).toBe('Temperature');
    expect(stepper.hasAttribute('disabled')).toBe(true);
  });

  it('does not commit when current action calls fail', async () => {
    actionMock.callNodeAction.mockRejectedValue(new Error('No route'));
    document.body.innerHTML = '<nodel-stepper action="Missing" value="10"></nodel-stepper>';
    await customElements.whenDefined('nodel-stepper');
    await Promise.resolve();

    document.querySelector('.nodel-stepper-increase')?.dispatchEvent(pointerDown());
    document.dispatchEvent(pointerUp());
    await flush();

    expect(document.querySelector('nodel-stepper')?.getAttribute('value')).toBe('10');
  });
});
