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

function emitActivityState(state: any) {
  for (const listener of activityMock.listeners) {
    listener(state);
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
    expect(options[1].querySelector('button')?.getAttribute('role')).toBe('radio');
    expect(options[1].querySelector('button')?.getAttribute('aria-checked')).toBe('true');
    expect(options[1].querySelector('button')?.hasAttribute('aria-pressed')).toBe(false);
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

  it('uses the first enabled segmented option as the roving tab stop', async () => {
    document.body.innerHTML = `
      <nodel-segmented>
        <nodel-button value="A" disabled>A</nodel-button>
        <nodel-button value="B">B</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await customElements.whenDefined('nodel-button');
    await flush();

    const buttons = Array.from(document.querySelectorAll('nodel-button button'));
    expect(buttons.map((button) => button.getAttribute('tabindex'))).toEqual(['-1', '0']);
  });

  it('skips disabled segmented options during keyboard navigation and selection', async () => {
    document.body.innerHTML = `
      <nodel-segmented action="SetMode">
        <nodel-button value="A">A</nodel-button>
        <nodel-button value="B" disabled>B</nodel-button>
        <nodel-button value="C">C</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await customElements.whenDefined('nodel-button');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    (host.querySelector('nodel-button[value="A"] button') as HTMLButtonElement).focus();
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(host.querySelector('nodel-button[value="C"] button'));
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetMode', { arg: 'C' });

    host.querySelector('nodel-button[value="B"] button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(actionMock.callNodeAction).not.toHaveBeenCalledWith('SetMode', { arg: 'B' });
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

  it('uses shared typed argument parsing for segmented selections', async () => {
    document.body.innerHTML = `
      <nodel-segmented action="SetMode" arg-type="boolean">
        <nodel-button value="active">Active</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    document.querySelector('nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetMode', { arg: true });
  });

  it('renders dynamic segmented options from both binding syntaxes', async () => {
    document.body.innerHTML = `
      <nodel-segmented options-signal="Modes" action="SetMode">
        <nodel-button value="Fallback">Fallback</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    expect(host.dataset.optionsState).toBe('loading');
    emitSignal('Modes', ['Auto', { value: 'manual', label: 'Manual' }]);
    await flush();

    const options = Array.from(host.querySelectorAll('nodel-button')) as HTMLElement[];
    expect(host.dataset.optionsState).toBe('ready');
    expect(options.map((option) => `${option.getAttribute('value')}:${option.textContent}`)).toEqual(['Auto:Auto', 'manual:Manual']);

    options[1].querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetMode', { arg: 'manual' });
  });

  it('renders dynamic segmented options from signals syntax and v1 key/value payloads', async () => {
    document.body.innerHTML = '<nodel-segmented signals="Modes:options" action="SetMode"></nodel-segmented>';
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    emitSignal('Modes', [{ key: 'auto-key', value: 'Auto mode' }, { key: '', value: 'Fallback key' }]);
    await flush();

    const options = Array.from(host.querySelectorAll('nodel-button')) as HTMLElement[];
    expect(options.map((option) => `${option.getAttribute('value')}:${option.textContent}`)).toEqual(['auto-key:Auto mode', 'Fallback key:Fallback key']);
  });

  it('uses custom dynamic segmented labels and empty/error status states', async () => {
    document.body.innerHTML = '<nodel-segmented options-signal="Modes" options-loading-label="Waiting" options-empty-label="Nothing" options-error-label="Broken"></nodel-segmented>';
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    expect(host.dataset.optionsState).toBe('loading');
    expect(host.querySelector('.nodel-options-status')?.textContent).toBe('Waiting');

    emitSignal('Modes', []);
    await flush();
    expect(host.dataset.optionsState).toBe('empty');
    expect(host.querySelector('.nodel-options-status')?.textContent).toBe('Nothing');

    emitSignal('Modes', [{ key: { nested: true }, value: 'Bad key' }]);
    await flush();
    expect(host.dataset.optionsState).toBe('error');
    expect(host.querySelector('.nodel-options-status')?.textContent).toBe('Broken');
  });

  it('preserves selected value when dynamic segmented options remove it', async () => {
    document.body.innerHTML = '<nodel-segmented signals="Modes:options" value="B"></nodel-segmented>';
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    emitSignal('Modes', ['A']);
    await flush();

    expect(host.getAttribute('value')).toBe('B');
    expect(host.querySelector('nodel-button')?.hasAttribute('active')).toBe(false);

    emitSignal('Modes', ['A', 'B']);
    await flush();
    expect(host.getAttribute('value')).toBe('B');
    expect(host.querySelector('nodel-button[value="B"]')?.hasAttribute('active')).toBe(true);
  });

  it('parses dynamic segmented values with number and json arg types', async () => {
    document.body.innerHTML = `
      <nodel-segmented options-signal="Numbers" action="SetNumber" arg-type="number"></nodel-segmented>
      <nodel-segmented options-signal="Objects" action="SetObject" arg-type="json"></nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    emitSignal('Numbers', [42]);
    emitSignal('Objects', [{ value: '{"mode":"auto"}', label: 'Auto' }]);
    await flush();

    document.querySelector('nodel-segmented[action="SetNumber"] nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector('nodel-segmented[action="SetObject"] nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetNumber', { arg: 42 });
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetObject', { arg: { mode: 'auto' } });
  });

  it('keeps dynamic segmented confirmation, deselect, busy, and action-failure behavior stable', async () => {
    document.body.innerHTML = '<nodel-segmented options-signal="Modes" action="SetMode" value="A" allow-deselect confirm-text="Change mode?"></nodel-segmented>';
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    const confirm = vi.fn((event: Event) => {
      event.preventDefault();
      (event as CustomEvent).detail.resolve(true);
    });
    host.addEventListener('nodel-confirm', confirm);
    emitSignal('Modes', ['A', 'B']);
    await flush();

    host.querySelector('nodel-button[value="A"] button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetMode', { arg: '' });
    expect(host.getAttribute('value')).toBe('');

    actionMock.callNodeAction.mockRejectedValueOnce(new Error('No route'));
    host.querySelector('nodel-button[value="B"] button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(host.getAttribute('value')).toBe('');

    let resolveAction: () => void = () => undefined;
    actionMock.callNodeAction.mockReturnValueOnce(new Promise<void>((resolve) => {
      resolveAction = resolve;
    }));
    host.querySelector('nodel-button[value="B"] button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(host.dataset.disabled).toBe('true');
    resolveAction();
    await flush();
    expect(host.dataset.disabled).toBe('false');
  });

  it('keeps dynamic segmented options after malformed payloads and recovers', async () => {
    document.body.innerHTML = '<nodel-segmented options-signal="Modes"></nodel-segmented>';
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    emitSignal('Modes', ['A', 'B']);
    emitSignal('Modes', [{ value: 'A', label: 'A' }, { value: 'A', label: 'Duplicate' }]);
    await flush();
    expect(host.dataset.optionsState).toBe('error');
    expect(Array.from(host.querySelectorAll('nodel-button')).map((option) => option.textContent)).toEqual(['A', 'B']);

    emitSignal('Modes', []);
    await flush();
    expect(host.dataset.optionsState).toBe('empty');
    expect(host.querySelectorAll('nodel-button')).toHaveLength(0);
  });

  it('does not treat options aggregation bindings as active dynamic options', async () => {
    document.body.innerHTML = `
      <nodel-segmented signals="Modes:options(any)">
        <nodel-button value="Fallback">Fallback</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    expect(host.dataset.optionsState).toBe('static');
    expect(activityMock.listeners).toHaveLength(0);
  });

  it('does not duplicate dynamic segmented nodes across repeated updates and attribute renders', async () => {
    document.body.innerHTML = '<nodel-segmented options-signal="Modes"></nodel-segmented>';
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    emitSignal('Modes', ['A', 'B']);
    await flush();
    host.setAttribute('variant', 'warning');
    emitSignal('Modes', ['B', 'A']);
    emitSignal('Modes', ['B', 'A']);
    await flush();

    expect(Array.from(host.querySelectorAll('nodel-button')).map((option) => option.getAttribute('value'))).toEqual(['B', 'A']);
  });

  it('supports horizontal and vertical segmented keyboard navigation through dynamic options', async () => {
    document.body.innerHTML = `
      <nodel-segmented options-signal="Horizontal" action="SetHorizontal"></nodel-segmented>
      <nodel-segmented options-signal="Vertical" action="SetVertical" orientation="vertical"></nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const [horizontal, vertical] = Array.from(document.querySelectorAll('nodel-segmented')) as HTMLElement[];
    emitSignal('Horizontal', ['A', 'B', 'C']);
    emitSignal('Vertical', ['One', 'Two', 'Three']);
    await flush();

    (horizontal.querySelector('nodel-button[value="A"] button') as HTMLButtonElement).focus();
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(horizontal.querySelector('nodel-button[value="C"] button'));
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetHorizontal', { arg: 'C' });
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(horizontal.querySelector('nodel-button[value="A"] button'));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(horizontal.querySelector('nodel-button[value="C"] button'));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(horizontal.querySelector('nodel-button[value="A"] button'));

    (vertical.querySelector('nodel-button[value="One"] button') as HTMLButtonElement).focus();
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(vertical.querySelector('nodel-button[value="Two"] button'));
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetVertical', { arg: 'Two' });
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(vertical.querySelector('nodel-button[value="One"] button'));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(vertical.querySelector('nodel-button[value="Three"] button'));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(vertical.querySelector('nodel-button[value="One"] button'));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(vertical.querySelector('nodel-button[value="Three"] button'));
  });

  it('recovers segmented focus through reorder, removal, and empty dynamic updates', async () => {
    document.body.innerHTML = '<nodel-segmented options-signal="Modes"></nodel-segmented>';
    await customElements.whenDefined('nodel-segmented');
    await customElements.whenDefined('nodel-button');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    emitSignal('Modes', ['A', 'B', 'C']);
    await flush();
    const focused = host.querySelector('nodel-button[value="B"] button') as HTMLButtonElement;
    focused.focus();

    emitSignal('Modes', ['C', 'B', 'A']);
    await flush();
    expect(document.activeElement).toBe(focused);

    emitSignal('Modes', ['C', 'A']);
    await flush();
    expect(document.activeElement).toBe(host.querySelector('nodel-button[value="A"] button'));

    emitSignal('Modes', []);
    await flush();
    expect(host.querySelectorAll('nodel-button')).toHaveLength(0);
    expect(document.activeElement).toBe(host);
    expect(host.getAttribute('tabindex')).toBe('-1');

    emitSignal('Modes', ['A']);
    await flush();
    expect(host.hasAttribute('tabindex')).toBe(false);
  });

  it('restores retained dynamic segmented state after transport recovery', async () => {
    document.body.innerHTML = '<nodel-segmented options-signal="Modes"></nodel-segmented>';
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    emitSignal('Modes', ['A']);
    await flush();
    expect(host.dataset.optionsState).toBe('ready');

    emitActivityState({ loading: false, connected: false, error: 'offline', batch: null });
    expect(host.dataset.optionsState).toBe('error');

    emitActivityState({ loading: false, connected: true, error: '', batch: null });
    expect(host.dataset.optionsState).toBe('ready');
  });

  it('keeps dynamic segmented transport errors across unrelated renders until recovery', async () => {
    document.body.innerHTML = '<nodel-segmented options-signal="Modes"></nodel-segmented>';
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    emitSignal('Modes', ['A']);
    emitActivityState({ loading: false, connected: false, error: 'offline', batch: null });
    expect(host.dataset.optionsState).toBe('error');

    host.setAttribute('variant', 'warning');
    await flush();
    expect(host.dataset.optionsState).toBe('error');

    emitActivityState({ loading: false, connected: true, error: '', batch: null });
    expect(host.dataset.optionsState).toBe('ready');
  });

  it('resets dynamic segmented options when the options binding identity changes', async () => {
    document.body.innerHTML = '<nodel-segmented options-signal="Modes"></nodel-segmented>';
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    emitSignal('Modes', ['A']);
    await flush();
    expect(host.querySelector('nodel-button')?.textContent).toBe('A');

    host.setAttribute('options-signal', 'OtherModes');
    await flush();
    expect(host.dataset.optionsState).toBe('loading');
    expect(host.querySelectorAll('nodel-button')).toHaveLength(0);
  });

  it('restores authored segmented fallback semantics when the options binding is removed', async () => {
    document.body.innerHTML = `
      <nodel-segmented options-signal="Modes" value="Fallback">
        <nodel-button value="Fallback">Fallback</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    emitSignal('Modes', ['A']);
    await flush();
    expect(host.querySelector('nodel-button')?.textContent).toBe('A');

    host.removeAttribute('options-signal');
    await flush();

    const fallback = host.querySelector('nodel-button') as HTMLElement;
    const native = fallback.querySelector('button') as HTMLButtonElement;
    expect(host.dataset.optionsState).toBe('static');
    expect(fallback.textContent).toBe('Fallback');
    expect(fallback.hasAttribute('active')).toBe(true);
    expect(native.getAttribute('role')).toBe('radio');
    expect(native.getAttribute('aria-checked')).toBe('true');
  });

  it('resets dynamic segmented state on disconnect and reconnect', async () => {
    document.body.innerHTML = `
      <nodel-segmented options-signal="Modes">
        <nodel-button value="Fallback">Fallback</nodel-button>
      </nodel-segmented>
    `;
    await customElements.whenDefined('nodel-segmented');
    await flush();

    const host = document.querySelector('nodel-segmented') as HTMLElement;
    emitSignal('Modes', ['A']);
    await flush();
    expect(host.querySelector('nodel-button')?.textContent).toBe('A');

    host.remove();
    document.body.appendChild(host);
    await flush();

    expect(host.dataset.optionsState).toBe('loading');
    expect(host.querySelector('nodel-button')?.textContent).toBe('Fallback');
  });
});
