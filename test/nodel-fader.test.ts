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

import '../src/components/nodel-button';
import '../src/components/nodel-fader';
import '../src/components/nodel-meter';
import '../src/components/nodel-status-indicator';

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

function pointerEvent(type: string, props: Record<string, unknown> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(event, key, { value });
  }
  return event;
}

describe('nodel-fader', () => {
  beforeEach(() => {
    actionMock.callNodeAction.mockReset();
    actionMock.callNodeAction.mockResolvedValue({});
    activityMock.listeners = [];
    document.body.innerHTML = '<nodel-fader label="Volume" value="50" nudge="5"></nodel-fader>';
  });

  it('renders a vertical slider with readout and nudge buttons', async () => {
    await customElements.whenDefined('nodel-fader');
    await Promise.resolve();

    const fader = document.querySelector('nodel-fader') as HTMLElement;
    const track = fader.querySelector('.nodel-fader-track') as HTMLElement;
    expect(fader.dataset.orientation).toBe('vertical');
    expect(fader.dataset.compoundAlign).toBe('end');
    expect(fader.dataset.variant).toBe('default');
    expect(fader.dataset.tone).toBe('solid');
    expect(fader.style.getPropertyValue('--nodel-fader-value')).toBe('0.5');
    expect(track.getAttribute('role')).toBe('slider');
    expect(track.getAttribute('aria-valuenow')).toBe('50');
    const readout = fader.querySelector('.nodel-fader-readout') as HTMLElement;
    expect(readout.textContent).toBe('50%');
    expect(readout.parentElement).toBe(track);
    expect(fader.dataset.readoutPosition).toBe('bottom');
    fader.setAttribute('value', '25');
    expect(fader.dataset.readoutPosition).toBe('top');
    expect((fader.querySelector('.nodel-fader-nudge-down') as HTMLButtonElement).hidden).toBe(false);
  });

  it('supports configurable compound rail alignment', async () => {
    document.body.innerHTML = '<nodel-fader compound-align="top"><nodel-meter></nodel-meter></nodel-fader>';
    await customElements.whenDefined('nodel-fader');
    await Promise.resolve();

    const fader = document.querySelector('nodel-fader') as HTMLElement;
    expect(fader.dataset.compoundAlign).toBe('start');

    fader.setAttribute('compound-align', 'center');
    expect(fader.dataset.compoundAlign).toBe('center');

    fader.setAttribute('compound-align', 'bottom');
    expect(fader.dataset.compoundAlign).toBe('end');
  });

  it('supports semantic variants and surface tones', async () => {
    document.body.innerHTML = '<nodel-fader variant="warning" tone="soft" value="40"></nodel-fader>';
    await customElements.whenDefined('nodel-fader');
    await Promise.resolve();

    const fader = document.querySelector('nodel-fader') as HTMLElement;
    expect(fader.dataset.variant).toBe('warning');
    expect(fader.dataset.tone).toBe('soft');

    fader.setAttribute('variant', 'bad');
    fader.setAttribute('tone', 'bad');
    expect(fader.dataset.variant).toBe('default');
    expect(fader.dataset.tone).toBe('solid');
  });

  it('preserves compound child nodes inside the rail', async () => {
    document.body.innerHTML = `
      <nodel-fader label="Zone" value="60">
        <nodel-meter value="70"></nodel-meter>
        <nodel-status-indicator value="present"></nodel-status-indicator>
        <nodel-button>Mute</nodel-button>
      </nodel-fader>
    `;
    await customElements.whenDefined('nodel-fader');
    await customElements.whenDefined('nodel-meter');
    await customElements.whenDefined('nodel-button');
    await Promise.resolve();

    const fader = document.querySelector('nodel-fader') as HTMLElement;
    const meter = fader.querySelector('nodel-meter') as HTMLElement;
    const button = fader.querySelector('nodel-button') as HTMLElement;
    fader.setAttribute('value', '65');

    expect(fader.querySelector('.nodel-fader-rail')?.contains(meter)).toBe(true);
    expect(fader.querySelector('.nodel-fader-rail')?.contains(button)).toBe(true);
    expect(fader.querySelector('nodel-meter')).toBe(meter);
    expect(fader.querySelector('nodel-button')).toBe(button);
  });

  it('supports keyboard commits through bound actions', async () => {
    document.body.innerHTML = '<nodel-fader label="Volume" value="50" step="5" action="SetVolume"></nodel-fader>';
    await customElements.whenDefined('nodel-fader');
    await Promise.resolve();

    const fader = document.querySelector('nodel-fader') as HTMLElement;
    const track = fader.querySelector('.nodel-fader-track') as HTMLElement;
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    await flush();

    expect(fader.getAttribute('value')).toBe('55');
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetVolume', { arg: 55 });
  });

  it('updates value, label, and disabled state from signals', async () => {
    document.body.innerHTML = '<nodel-fader signal="Volume" signals="Name:label; Lock:disabled"></nodel-fader>';
    await customElements.whenDefined('nodel-fader');
    await Promise.resolve();

    const fader = document.querySelector('nodel-fader') as HTMLElement;
    emitSignal('Volume', 35);
    emitSignal('Name', 'Program');
    emitSignal('Lock', true);

    expect(fader.getAttribute('value')).toBe('35');
    expect(fader.getAttribute('label')).toBe('Program');
    expect(fader.hasAttribute('disabled')).toBe(true);
  });

  it('does not jump on pointer down and commits after relative drag', async () => {
    document.body.innerHTML = '<nodel-fader label="Volume" value="50" action="SetVolume"></nodel-fader>';
    await customElements.whenDefined('nodel-fader');
    await Promise.resolve();

    const fader = document.querySelector('nodel-fader') as HTMLElement;
    const track = fader.querySelector('.nodel-fader-track') as HTMLElement;
    track.setPointerCapture = vi.fn();
    track.releasePointerCapture = vi.fn();
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width: 40, height: 100, top: 0, right: 40, bottom: 100, left: 0, toJSON: () => ({}) });

    track.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientY: 20 }));
    expect(fader.getAttribute('value')).toBe('50');

    document.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientY: 10 }));
    document.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientY: 10 }));
    await flush();

    expect(fader.getAttribute('value')).toBe('60');
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetVolume', { arg: 60 });
  });
});
