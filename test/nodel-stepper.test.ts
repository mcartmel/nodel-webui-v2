import { flush } from './helpers';

const actionMock = vi.hoisted(() => ({ callNodeAction: vi.fn() }));
const activityMock = vi.hoisted(() => ({ listeners: [] as Array<(state: any) => void>, dispose: vi.fn() }));

vi.mock('../src/api/nodel-host-client', () => ({ callNodeAction: actionMock.callNodeAction }));
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

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetTemp', { arg: 20.5 });
    expect(document.querySelector('nodel-stepper')?.getAttribute('value')).toBe('20.5');
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

  it('does not commit when action calls fail', async () => {
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
