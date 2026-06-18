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

import '../src/components/nodel-palette';

function emitSignal(alias: string, arg: unknown) {
  for (const listener of activityMock.listeners) {
    listener({ loading: false, connected: true, error: '', batch: { items: [{ entry: { seq: 1, timestamp: '2026-06-18T00:00:00Z', source: 'local', type: 'event', alias, arg }, changed: true, live: true }], replace: false, transport: 'websocket', nextSeq: 2 } });
  }
}

describe('nodel-palette', () => {
  beforeEach(() => {
    actionMock.callNodeAction.mockReset();
    actionMock.callNodeAction.mockResolvedValue({});
    activityMock.listeners = [];
    document.body.innerHTML = '';
  });

  it('renders swatch options and selected state', async () => {
    document.body.innerHTML = `
      <nodel-palette label="Colour" value="#00ff00" columns="3" shape="circle" show-labels="hide">
        <nodel-button value="#ff0000" color="#ff0000">Red</nodel-button>
        <nodel-button value="#00ff00" color="#00ff00">Green</nodel-button>
      </nodel-palette>
    `;
    await customElements.whenDefined('nodel-palette');
    await customElements.whenDefined('nodel-button');
    await flush();

    const palette = document.querySelector('nodel-palette') as HTMLElement;
    const options = Array.from(document.querySelectorAll<HTMLElement>('nodel-button'));
    expect(palette.dataset.shape).toBe('circle');
    expect(palette.style.getPropertyValue('--nodel-palette-columns')).toBe('3');
    expect(options[0].dataset.paletteSwatch).toBe('true');
    expect(options[1].hasAttribute('active')).toBe(true);
  });

  it('calls an action with selected colour value', async () => {
    document.body.innerHTML = '<nodel-palette action="SetColour"><nodel-button value="#ff0000" color="#ff0000">Red</nodel-button></nodel-palette>';
    await customElements.whenDefined('nodel-palette');
    await flush();

    document.querySelector('nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetColour', { arg: '#ff0000' });
    expect(document.querySelector('nodel-palette')?.getAttribute('value')).toBe('#ff0000');
  });

  it('supports native custom colour picker', async () => {
    document.body.innerHTML = '<nodel-palette picker="native"></nodel-palette>';
    await customElements.whenDefined('nodel-palette');
    await flush();

    const palette = document.querySelector('nodel-palette') as HTMLElement;
    const input = palette.querySelector('input[type="color"]') as HTMLInputElement;
    input.value = '#123456';
    palette.querySelector('.nodel-palette-custom-button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(palette.getAttribute('value')).toBe('#123456');
  });

  it('uses join as action and updates from signals', async () => {
    document.body.innerHTML = '<nodel-palette join="Colour" signals="Name:label; Lock:disabled"><nodel-button value="#0000ff">Blue</nodel-button></nodel-palette>';
    await customElements.whenDefined('nodel-palette');
    await flush();

    const palette = document.querySelector('nodel-palette') as HTMLElement;
    document.querySelector('nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('Colour', { arg: '#0000ff' });

    emitSignal('Colour', '#ff0000');
    emitSignal('Name', 'LED Colour');
    emitSignal('Lock', true);
    expect(palette.getAttribute('value')).toBe('#ff0000');
    expect(palette.getAttribute('label')).toBe('LED Colour');
    expect(palette.hasAttribute('disabled')).toBe(true);
  });
});
