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

import '../src/components/nodel-pad';

function emitSignal(alias: string, arg: unknown) {
  for (const listener of activityMock.listeners) {
    listener({ loading: false, connected: true, error: '', batch: { items: [{ entry: { seq: 1, timestamp: '2026-06-18T00:00:00Z', source: 'local', type: 'event', alias, arg }, changed: true, live: true }], replace: false, transport: 'websocket', nextSeq: 2 } });
  }
}

function pointerEvent(type: string, props: Record<string, unknown> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(event, key, { value });
  }
  return event;
}

describe('nodel-pad', () => {
  beforeEach(() => {
    actionMock.callNodeAction.mockReset();
    actionMock.callNodeAction.mockResolvedValue({});
    activityMock.listeners = [];
    document.body.innerHTML = '';
  });

  it('renders a D-pad with optional centre button states', async () => {
    document.body.innerHTML = `
      <nodel-pad label="Full" action="Move" center="show"></nodel-pad>
      <nodel-pad center="hide"></nodel-pad>
      <nodel-pad center="disabled"></nodel-pad>
    `;
    await customElements.whenDefined('nodel-pad');
    await Promise.resolve();

    const pads = Array.from(document.querySelectorAll('nodel-pad'));
    expect(pads.map((pad) => pad.getAttribute('data-center'))).toEqual(['show', 'hide', 'disabled']);
    for (const direction of ['up', 'down', 'left', 'right']) {
      expect((pads[1].querySelector(`[data-direction="${direction}"]`) as HTMLButtonElement).hidden).toBe(false);
    }
    expect((pads[1].querySelector('[data-direction="center"]') as HTMLButtonElement).hidden).toBe(true);
    expect((pads[2].querySelector('[data-direction="center"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls a shared click action with direction payload', async () => {
    document.body.innerHTML = '<nodel-pad action="Navigate" center="show"></nodel-pad>';
    await customElements.whenDefined('nodel-pad');
    await Promise.resolve();

    document.querySelector('[data-direction="right"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('Navigate', { arg: 'right' });
  });

  it('prefers direction-specific actions', async () => {
    document.body.innerHTML = '<nodel-pad action="Navigate" left-action="Previous"></nodel-pad>';
    await customElements.whenDefined('nodel-pad');
    await Promise.resolve();

    document.querySelector('[data-direction="left"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('Previous', { arg: 'left' });
  });

  it('supports momentary press and release phases', async () => {
    document.body.innerHTML = '<nodel-pad press-mode="momentary" up-actions="Up:press; Stop:release"></nodel-pad>';
    await customElements.whenDefined('nodel-pad');
    await Promise.resolve();

    document.querySelector('[data-direction="up"]')?.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1 }));
    await flush();
    document.dispatchEvent(pointerEvent('pointerup', { pointerId: 1 }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenNthCalledWith(1, 'Up', { arg: 'up' });
    expect(actionMock.callNodeAction).toHaveBeenNthCalledWith(2, 'Stop', { arg: 'up' });
  });

  it('updates label, disabled, and center-disabled from signals', async () => {
    document.body.innerHTML = '<nodel-pad signals="Name:label; Lock:disabled; NoEnter:center-disabled" center="show"></nodel-pad>';
    await customElements.whenDefined('nodel-pad');
    await Promise.resolve();

    const pad = document.querySelector('nodel-pad') as HTMLElement;
    emitSignal('Name', 'Camera');
    emitSignal('Lock', true);
    emitSignal('NoEnter', true);

    expect(pad.getAttribute('label')).toBe('Camera');
    expect(pad.hasAttribute('disabled')).toBe(true);
    expect(pad.hasAttribute('center-disabled')).toBe(true);
  });
});
