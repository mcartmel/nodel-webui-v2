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

function emitActivityState(state: any) {
  for (const listener of activityMock.listeners) {
    listener(state);
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
    const selectedButton = document.querySelectorAll('nodel-button button')[1];
    expect(selectedButton.getAttribute('role')).toBe('option');
    expect(selectedButton.getAttribute('aria-selected')).toBe('true');
    expect(selectedButton.hasAttribute('aria-pressed')).toBe(false);
  });

  it('makes the first native select option tabbable when opened without a selected value', async () => {
    document.body.innerHTML = `
      <nodel-select open>
        <nodel-button value="A">A</nodel-button>
        <nodel-button value="B">B</nodel-button>
      </nodel-select>
    `;
    await customElements.whenDefined('nodel-select');
    await customElements.whenDefined('nodel-button');
    await flush();

    const buttons = Array.from(document.querySelectorAll('nodel-button button'));
    expect(buttons.map((button) => button.getAttribute('tabindex'))).toEqual(['0', '-1']);
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

  it('renders dynamic options from raw signal payloads and calls the shared action', async () => {
    document.body.innerHTML = `
      <nodel-select options-signal="Sources" action="SetSource">
        <nodel-button value="Fallback">Fallback</nodel-button>
      </nodel-select>
    `;
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    expect(select.dataset.optionsState).toBe('loading');
    expect(select.querySelectorAll('nodel-button')).toHaveLength(1);

    emitSignal('Sources', [{ key: 'hdmi1', value: 'HDMI 1' }, { value: 'hdmi2', label: 'HDMI 2' }]);
    await flush();

    const options = Array.from(select.querySelectorAll('nodel-button')) as HTMLElement[];
    expect(select.dataset.optionsState).toBe('ready');
    expect(options.map((option) => `${option.getAttribute('value')}:${option.textContent}`)).toEqual(['hdmi1:HDMI 1', 'hdmi2:HDMI 2']);

    options[1].querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetSource', { arg: 'hdmi2' });
    expect(select.getAttribute('value')).toBe('hdmi2');
  });

  it('keeps the last valid dynamic select options on malformed payloads', async () => {
    document.body.innerHTML = '<nodel-select signals="Sources:options"></nodel-select>';
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    const error = vi.fn();
    select.addEventListener('nodel-options-error', error);
    emitSignal('Sources', ['A', 'B']);
    emitSignal('Sources', ['A', 'A']);
    await flush();

    expect(select.dataset.optionsState).toBe('error');
    expect(error).toHaveBeenCalledTimes(1);
    expect(Array.from(select.querySelectorAll('nodel-button')).map((option) => option.textContent)).toEqual(['A', 'B']);
  });

  it('restores authored select fallback when the options binding is removed', async () => {
    document.body.innerHTML = `
      <nodel-select options-signal="Sources" value="Fallback">
        <nodel-button value="Fallback">Fallback</nodel-button>
      </nodel-select>
    `;
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    emitSignal('Sources', ['A']);
    expect(select.querySelector('nodel-button')?.textContent).toBe('A');

    select.removeAttribute('options-signal');
    await flush();

    expect(select.dataset.optionsState).toBe('static');
    expect(select.querySelector('nodel-button')?.textContent).toBe('Fallback');
    expect(select.querySelector('nodel-button')?.hasAttribute('active')).toBe(true);
    expect(select.querySelector('nodel-button button')?.getAttribute('role')).toBe('option');
    expect(select.querySelector('nodel-button button')?.getAttribute('aria-selected')).toBe('true');
  });

  it('updates dynamic select labels without replacing the generated button shell', async () => {
    document.body.innerHTML = '<nodel-select options-signal="Sources"></nodel-select>';
    await customElements.whenDefined('nodel-select');
    await customElements.whenDefined('nodel-button');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    emitSignal('Sources', [{ value: 'A', label: 'A' }]);
    await flush();
    const option = select.querySelector('nodel-button') as HTMLElement;
    const button = option.querySelector('button');

    emitSignal('Sources', [{ value: 'A', label: 'Alpha' }]);
    await flush();

    expect(option.querySelector('button')).toBe(button);
    expect(option.textContent).toBe('Alpha');
  });

  it('returns focus to the trigger when focused fallback is replaced by dynamic options', async () => {
    document.body.innerHTML = `
      <nodel-select options-signal="Sources" open>
        <nodel-button value="Fallback">Fallback</nodel-button>
      </nodel-select>
    `;
    await customElements.whenDefined('nodel-select');
    await customElements.whenDefined('nodel-button');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    const trigger = select.querySelector('.nodel-select-trigger') as HTMLButtonElement;
    const fallbackButton = select.querySelector('nodel-button button') as HTMLButtonElement;
    fallbackButton.focus();
    expect(document.activeElement).toBe(fallbackButton);

    emitSignal('Sources', ['A']);
    await flush();

    expect(document.activeElement).toBe(trigger);
    expect(select.hasAttribute('open')).toBe(false);
  });

  it('does not treat options aggregation bindings as active dynamic options', async () => {
    document.body.innerHTML = `
      <nodel-select signals="Sources:options(all)">
        <nodel-button value="Fallback">Fallback</nodel-button>
      </nodel-select>
    `;
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    expect(select.dataset.optionsState).toBe('static');
    expect(activityMock.listeners).toHaveLength(0);
  });

  it('restores retained dynamic select state after transport recovery', async () => {
    document.body.innerHTML = '<nodel-select options-signal="Sources"></nodel-select>';
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    emitSignal('Sources', ['A']);
    await flush();
    expect(select.dataset.optionsState).toBe('ready');

    emitActivityState({ loading: false, connected: false, error: 'offline', batch: null });
    expect(select.dataset.optionsState).toBe('error');

    emitActivityState({ loading: false, connected: true, error: '', batch: null });
    expect(select.dataset.optionsState).toBe('ready');
  });

  it('keeps dynamic select transport errors across unrelated renders until recovery', async () => {
    document.body.innerHTML = '<nodel-select options-signal="Sources"></nodel-select>';
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    emitSignal('Sources', ['A']);
    emitActivityState({ loading: false, connected: false, error: 'offline', batch: null });
    expect(select.dataset.optionsState).toBe('error');

    select.setAttribute('variant', 'primary');
    await flush();
    expect(select.dataset.optionsState).toBe('error');

    emitActivityState({ loading: false, connected: true, error: '', batch: null });
    expect(select.dataset.optionsState).toBe('ready');
  });

  it('resets dynamic select options when the options binding identity changes', async () => {
    document.body.innerHTML = '<nodel-select options-signal="Sources"></nodel-select>';
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    emitSignal('Sources', ['A']);
    await flush();
    expect(select.querySelector('nodel-button')?.textContent).toBe('A');

    select.setAttribute('options-signal', 'OtherSources');
    await flush();
    expect(select.dataset.optionsState).toBe('loading');
    expect(select.querySelectorAll('nodel-button')).toHaveLength(0);
  });

  it('resets dynamic select state on disconnect and reconnect', async () => {
    document.body.innerHTML = `
      <nodel-select options-signal="Sources">
        <nodel-button value="Fallback">Fallback</nodel-button>
      </nodel-select>
    `;
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    emitSignal('Sources', ['A']);
    await flush();
    expect(select.querySelector('nodel-button')?.textContent).toBe('A');

    select.remove();
    document.body.appendChild(select);
    await flush();

    expect(select.dataset.optionsState).toBe('loading');
    expect(select.querySelector('nodel-button')?.textContent).toBe('Fallback');
  });

  it('uses custom dynamic select labels and effective unavailable state without reflecting disabled', async () => {
    document.body.innerHTML = '<nodel-select options-signal="Sources" options-loading-label="Waiting" options-empty-label="Nothing" options-error-label="Broken"></nodel-select>';
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    const trigger = select.querySelector('.nodel-select-trigger') as HTMLButtonElement;
    expect(select.dataset.optionsState).toBe('loading');
    expect(select.hasAttribute('disabled')).toBe(false);
    expect(trigger.disabled).toBe(false);
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(select.querySelector('.nodel-options-status')?.textContent).toBe('Waiting');

    emitSignal('Sources', []);
    await flush();
    expect(select.dataset.optionsState).toBe('empty');
    expect(trigger.disabled).toBe(false);
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(select.querySelector('.nodel-options-status')?.textContent).toBe('Nothing');

    emitSignal('Sources', ['A', 'A']);
    await flush();
    expect(select.dataset.optionsState).toBe('error');
    expect(select.querySelector('.nodel-options-status')?.textContent).toBe('Broken');
  });

  it('keeps fallback select options interactive while dynamic options are loading', async () => {
    document.body.innerHTML = `
      <nodel-select options-signal="Sources">
        <nodel-button value="Fallback">Fallback</nodel-button>
      </nodel-select>
    `;
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    const trigger = select.querySelector('.nodel-select-trigger') as HTMLButtonElement;
    expect(select.dataset.optionsState).toBe('loading');
    expect(trigger.disabled).toBe(false);
    expect(select.querySelector('.nodel-options-status')?.textContent).toBe('');
    expect(select.querySelector('.nodel-select-value')?.textContent).toBe('Fallback');
  });

  it('preserves and reactivates a selected select value when dynamic options reintroduce it', async () => {
    document.body.innerHTML = '<nodel-select options-signal="Sources" value="B"></nodel-select>';
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    emitSignal('Sources', ['A']);
    await flush();
    expect(select.getAttribute('value')).toBe('B');
    expect(select.querySelector('.nodel-select-value')?.textContent).toBe('B');
    expect(select.querySelector('nodel-button')?.hasAttribute('active')).toBe(false);

    emitSignal('Sources', ['A', { value: 'B', label: 'Bee' }]);
    await flush();
    expect(select.getAttribute('value')).toBe('B');
    expect(select.querySelector('.nodel-select-value')?.textContent).toBe('Bee');
    expect(select.querySelector('nodel-button[value="B"]')?.hasAttribute('active')).toBe(true);
  });

  it('parses dynamic select values with number and json arg types', async () => {
    document.body.innerHTML = `
      <nodel-select options-signal="Numbers" action="SetNumber" arg-type="number"></nodel-select>
      <nodel-select options-signal="Objects" action="SetObject" arg-type="json"></nodel-select>
    `;
    await customElements.whenDefined('nodel-select');
    await flush();

    emitSignal('Numbers', [42]);
    emitSignal('Objects', [{ value: '{"mode":"auto"}', label: 'Auto' }]);
    await flush();

    document.querySelector('nodel-select[action="SetNumber"] nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.querySelector('nodel-select[action="SetObject"] nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetNumber', { arg: 42 });
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetObject', { arg: { mode: 'auto' } });
  });

  it('keeps dynamic select confirmation, deselect, and action-failure behavior stable', async () => {
    document.body.innerHTML = '<nodel-select options-signal="Sources" action="SetSource" value="A" allow-deselect confirm-text="Change source?"></nodel-select>';
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    const confirm = vi.fn((event: Event) => {
      event.preventDefault();
      (event as CustomEvent).detail.resolve(true);
    });
    select.addEventListener('nodel-confirm', confirm);
    emitSignal('Sources', ['A', 'B']);
    await flush();

    select.querySelector('nodel-button[value="A"] button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetSource', { arg: '' });

    actionMock.callNodeAction.mockRejectedValueOnce(new Error('No route'));
    select.querySelector('nodel-button[value="B"] button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();
    expect(select.getAttribute('value')).toBe('');
  });

  it('does not duplicate dynamic select nodes across repeated updates and attribute renders', async () => {
    document.body.innerHTML = '<nodel-select options-signal="Sources"></nodel-select>';
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    emitSignal('Sources', ['A', 'B']);
    await flush();
    select.setAttribute('variant', 'primary');
    emitSignal('Sources', ['B', 'A']);
    emitSignal('Sources', ['B', 'A']);
    await flush();

    expect(Array.from(select.querySelectorAll('nodel-button')).map((option) => option.getAttribute('value'))).toEqual(['B', 'A']);
  });

  it('supports select keyboard navigation through dynamic options', async () => {
    document.body.innerHTML = '<nodel-select options-signal="Sources" action="SetSource"></nodel-select>';
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    const trigger = select.querySelector('.nodel-select-trigger') as HTMLButtonElement;
    emitSignal('Sources', ['A', 'B', 'C']);
    await flush();

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(select.querySelector('nodel-button[value="A"] button'));

    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(select.querySelector('nodel-button[value="C"] button'));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(select.querySelector('nodel-button[value="A"] button'));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(select.querySelector('nodel-button[value="C"] button'));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetSource', { arg: 'C' });
    expect(select.hasAttribute('open')).toBe(false);

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await flush();
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(select.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('supports select trigger keys, Space selection, and Tab close', async () => {
    document.body.innerHTML = '<nodel-select options-signal="Sources" action="SetSource"></nodel-select>';
    await customElements.whenDefined('nodel-select');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    const trigger = select.querySelector('.nodel-select-trigger') as HTMLButtonElement;
    emitSignal('Sources', ['A', 'B']);
    await flush();

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(select.hasAttribute('open')).toBe(true);
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(select.hasAttribute('open')).toBe(false);

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(select.querySelector('nodel-button[value="B"] button'));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetSource', { arg: 'B' });

    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await flush();
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(select.hasAttribute('open')).toBe(false);
  });

  it('returns focus to the select trigger when focused dynamic options become empty', async () => {
    document.body.innerHTML = '<nodel-select options-signal="Sources" open></nodel-select>';
    await customElements.whenDefined('nodel-select');
    await customElements.whenDefined('nodel-button');
    await flush();

    const select = document.querySelector('nodel-select') as HTMLElement;
    const trigger = select.querySelector('.nodel-select-trigger') as HTMLButtonElement;
    emitSignal('Sources', ['A']);
    await flush();
    (select.querySelector('nodel-button[value="A"] button') as HTMLButtonElement).focus();

    emitSignal('Sources', []);
    await flush();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
  });
});
