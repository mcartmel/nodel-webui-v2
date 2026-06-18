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

import '../src/components/nodel-select';

function emitSignal(alias: string, arg: unknown) {
  for (const listener of activityMock.listeners) {
    listener({ loading: false, connected: true, error: '', batch: { items: [{ entry: { seq: 1, timestamp: '2026-06-18T00:00:00Z', source: 'local', type: 'event', alias, arg }, changed: true, live: true }], replace: false, transport: 'websocket', nextSeq: 2 } });
  }
}

describe('nodel-select', () => {
  beforeEach(() => {
    actionMock.callNodeAction.mockReset();
    actionMock.callNodeAction.mockResolvedValue({});
    activityMock.listeners = [];
    document.body.innerHTML = '';
  });

  it('renders a trigger and preserves button options in the panel', async () => {
    document.body.innerHTML = `
      <nodel-select label="Source" value="HDMI 2" variant="primary" tone="soft">
        <nodel-button value="HDMI 1">HDMI 1</nodel-button>
        <nodel-button value="HDMI 2">HDMI 2</nodel-button>
      </nodel-select>
    `;
    await customElements.whenDefined('nodel-select');
    await customElements.whenDefined('nodel-button');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    expect(select.dataset.variant).toBe('primary');
    expect(select.querySelector('.nodel-select-value')?.textContent).toBe('HDMI 2');
    expect(select.querySelector('.nodel-select-panel')?.querySelectorAll('nodel-button')).toHaveLength(2);
    expect(document.querySelectorAll('nodel-button')[1].hasAttribute('active')).toBe(true);
  });

  it('opens, selects an option, and calls an action', async () => {
    document.body.innerHTML = `
      <nodel-select action="SetSource" arg-type="string">
        <nodel-button value="HDMI 1">HDMI 1</nodel-button>
        <nodel-button value="HDMI 2">HDMI 2</nodel-button>
      </nodel-select>
    `;
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    select.querySelector('.nodel-select-trigger')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(select.hasAttribute('open')).toBe(true);
    document.querySelectorAll('nodel-button button')[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetSource', { arg: 'HDMI 2' });
    expect(select.getAttribute('value')).toBe('HDMI 2');
    expect(select.hasAttribute('open')).toBe(false);
  });

  it('uses join as action and value signal shorthand', async () => {
    document.body.innerHTML = '<nodel-select join="Source"><nodel-button value="A">A</nodel-button></nodel-select>';
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    document.querySelector('nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('Source', { arg: 'A' });

    emitSignal('Source', 'B');
    expect(select.getAttribute('value')).toBe('B');
  });

  it('updates label and disabled from signals', async () => {
    document.body.innerHTML = '<nodel-select signals="Name:label; Lock:disabled"></nodel-select>';
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    emitSignal('Name', 'Input');
    emitSignal('Lock', true);
    expect(select.getAttribute('label')).toBe('Input');
    expect(select.hasAttribute('disabled')).toBe(true);
  });
});
