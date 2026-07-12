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

import '../src/components/nodel-segmented';

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

describe('nodel-segmented', () => {
  beforeEach(() => {
    actionMock.callNodeAction.mockReset();
    actionMock.callNodeAction.mockResolvedValue({});
    activityMock.listeners = [];
    activityMock.dispose.mockClear();
    document.body.innerHTML = '';
  });

  it('marks one child active from value and preserves children', async () => {
    document.body.innerHTML = `
      <nodel-segmented label="Source" value="HDMI 2">
        <nodel-button value="HDMI 1">HDMI 1</nodel-button>
        <nodel-button value="HDMI 2"><nodel-icon name="image"></nodel-icon>HDMI 2</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await customElements.whenDefined('nodel-button');
    await flush();

    const options = Array.from(document.querySelectorAll('nodel-button'));
    expect(document.querySelector('nodel-segmented')?.getAttribute('role')).toBe('radiogroup');
    expect(options[0].hasAttribute('active')).toBe(false);
    expect(options[1].hasAttribute('active')).toBe(true);
    expect(options[1].querySelector('nodel-icon')).not.toBeNull();
    expect(options[1].getAttribute('aria-checked')).toBe('true');
  });

  it('calls one shared action and updates selected value', async () => {
    document.body.innerHTML = `
      <nodel-segmented action="SetSource" value="HDMI 1">
        <nodel-button value="HDMI 1">HDMI 1</nodel-button>
        <nodel-button value="HDMI 2">HDMI 2</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    document.querySelectorAll('nodel-button button')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetSource', { arg: 'HDMI 2' });
    expect(host.getAttribute('value')).toBe('HDMI 2');
    expect(document.querySelectorAll('nodel-button')[1].hasAttribute('active')).toBe(true);
  });

  it('uses join for shared action and selected value signal', async () => {
    document.body.innerHTML = `
      <nodel-segmented join="Source">
        <nodel-button value="HDMI 1">HDMI 1</nodel-button>
        <nodel-button value="HDMI 2">HDMI 2</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    document.querySelectorAll('nodel-button button')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('Source', { arg: 'HDMI 2' });

    emitSignal('Source', 'HDMI 1');
    expect(host.getAttribute('value')).toBe('HDMI 1');
  });

  it('applies group variant and tone to the active option', async () => {
    document.body.innerHTML = `
      <nodel-segmented value="Auto" variant="warning" tone="outline">
        <nodel-button value="Auto">Auto</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const option = document.querySelector('nodel-button') as HTMLElement;
    expect(option.getAttribute('variant')).toBe('warning');
    expect(option.getAttribute('tone')).toBe('outline');
  });

  it('removes group styling from an option that is no longer active', async () => {
    document.body.innerHTML = `
      <nodel-segmented value="Auto" variant="warning" tone="outline">
        <nodel-button value="Auto">Auto</nodel-button>
        <nodel-button value="Manual">Manual</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    const [auto, manual] = Array.from(document.querySelectorAll('nodel-button')) as HTMLElement[];
    expect(auto.getAttribute('variant')).toBe('warning');
    expect(auto.getAttribute('tone')).toBe('outline');

    host.setAttribute('value', 'Manual');
    await flush();

    expect(auto.hasAttribute('active')).toBe(false);
    expect(auto.hasAttribute('variant')).toBe(false);
    expect(auto.hasAttribute('tone')).toBe(false);
    expect(manual.hasAttribute('active')).toBe(true);
    expect(manual.getAttribute('variant')).toBe('warning');
    expect(manual.getAttribute('tone')).toBe('outline');
  });

  it('preserves an explicit option variant and tone after selection changes', async () => {
    document.body.innerHTML = `
      <nodel-segmented value="Auto" variant="warning" tone="outline">
        <nodel-button value="Auto">Auto</nodel-button>
        <nodel-button value="Manual" variant="info" tone="soft">Manual</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    const [, manual] = Array.from(document.querySelectorAll('nodel-button')) as HTMLElement[];
    host.setAttribute('value', 'Manual');
    await flush();
    host.setAttribute('value', 'Auto');
    await flush();

    expect(manual.hasAttribute('active')).toBe(false);
    expect(manual.getAttribute('variant')).toBe('info');
    expect(manual.getAttribute('tone')).toBe('soft');
  });

  it('supports allow-deselect without an action', async () => {
    document.body.innerHTML = `
      <nodel-segmented value="Auto" allow-deselect>
        <nodel-button value="Auto">Auto</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    const change = vi.fn();
    host.addEventListener('nodel-segmented-change', change);
    document.querySelector('nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(host.getAttribute('value')).toBe('');
    expect(change.mock.calls[0][0].detail.value).toBe('');
  });

  it('updates selected value, label, and disabled from signals', async () => {
    document.body.innerHTML = `
      <nodel-segmented signal="Source" signals="Name:label; Locked:disabled">
        <nodel-button value="HDMI 1">HDMI 1</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    emitSignal('Source', 'HDMI 1');
    expect(host.getAttribute('value')).toBe('HDMI 1');
    expect(document.querySelector('nodel-button')?.hasAttribute('active')).toBe(true);

    emitSignal('Name', 'Input source');
    expect(host.getAttribute('aria-label')).toBe('Input source');

    emitSignal('Locked', 'true');
    expect(host.dataset.disabled).toBe('true');
  });

  it('gates selection through confirmation', async () => {
    document.body.innerHTML = `
      <nodel-segmented action="SetMode" confirm-text="Change mode?">
        <nodel-button value="Manual">Manual</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    host.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      (event as CustomEvent).detail.resolve(true);
    });
    document.querySelector('nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetMode', { arg: 'Manual' });
  });

  it('does not update selected value when action calls fail', async () => {
    actionMock.callNodeAction.mockRejectedValue(new Error('No route'));
    document.body.innerHTML = `
      <nodel-segmented action="SetSource" value="HDMI 1">
        <nodel-button value="HDMI 1">HDMI 1</nodel-button>
        <nodel-button value="HDMI 2">HDMI 2</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    document.querySelectorAll('nodel-button button')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(host.getAttribute('value')).toBe('HDMI 1');
  });
});
