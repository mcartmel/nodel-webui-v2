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
import '../src/components/nodel-icon';
import '../src/components/nodel-image';
import '../src/components/nodel-status-indicator';
import '../src/components/nodel-text';

function emitSignals(entries: Array<{ alias: string; arg: unknown }>) {
  for (const listener of activityMock.listeners) {
    listener({
      loading: false,
      connected: true,
      error: '',
      batch: {
        items: [
          ...entries.map(({ alias, arg }, index) => ({
            entry: {
              seq: 1,
              timestamp: '2026-06-06T00:00:00Z',
              source: 'local',
              type: 'event',
              alias,
              arg
            },
            changed: true,
            live: true
          }))
        ],
        replace: false,
        transport: 'websocket',
        nextSeq: 2
      }
    });
  }
}

function emitSignal(alias: string, arg: unknown) {
  emitSignals([{ alias, arg }]);
}

describe('nodel-button', () => {
  beforeEach(() => {
    actionMock.callNodeAction.mockReset();
    actionMock.callNodeAction.mockResolvedValue({});
    activityMock.listeners = [];
    activityMock.dispose.mockClear();
    document.body.innerHTML = '<nodel-button variant="primary">Start</nodel-button>';
  });

  it('renders a native touch button with variant and label', async () => {
    await customElements.whenDefined('nodel-button');
    await Promise.resolve();

    const host = document.querySelector('nodel-button') as HTMLElement;
    const button = host.querySelector('button') as HTMLButtonElement;

    expect(host.dataset.variant).toBe('primary');
    expect(button.className).toContain('nodel-button-touch');
    expect(button.className).toContain('nodel-button-primary');
    expect(button.textContent?.trim()).toBe('Start');
  });

  it('supports Bootstrap-like button variants', async () => {
    document.body.innerHTML = `
      <nodel-button variant="success">Success</nodel-button>
      <nodel-button variant="info">Info</nodel-button>
      <nodel-button variant="warning">Warning</nodel-button>
      <nodel-button variant="link">Link</nodel-button>
    `;
    await customElements.whenDefined('nodel-button');
    await Promise.resolve();

    const buttons = Array.from(document.querySelectorAll('nodel-button'));
    expect(buttons.map((button) => button.getAttribute('data-variant'))).toEqual(['success', 'info', 'warning', 'link']);
    expect(buttons[0].querySelector('button')?.className).toContain('nodel-button-success');
    expect(buttons[1].querySelector('button')?.className).toContain('nodel-button-info');
    expect(buttons[2].querySelector('button')?.className).toContain('nodel-button-warning');
    expect(buttons[3].querySelector('button')?.className).toContain('nodel-button-link');
  });

  it('supports soft and outline tones', async () => {
    document.body.innerHTML = `
      <nodel-button variant="primary" tone="soft">Soft</nodel-button>
      <nodel-button variant="danger" tone="outline">Outline</nodel-button>
      <nodel-button tone="invalid">Fallback</nodel-button>
    `;
    await customElements.whenDefined('nodel-button');
    await Promise.resolve();

    const buttons = Array.from(document.querySelectorAll('nodel-button'));
    expect(buttons.map((button) => button.getAttribute('data-tone'))).toEqual(['soft', 'outline', 'solid']);
    expect(buttons[0].querySelector('button')?.className).toContain('nodel-button-soft');
    expect(buttons[1].querySelector('button')?.className).toContain('nodel-button-outline');
    expect(buttons[2].querySelector('button')?.className).not.toContain('nodel-button-soft');
    expect(buttons[2].querySelector('button')?.className).not.toContain('nodel-button-outline');
  });

  it('supports stacked child layout', async () => {
    document.body.innerHTML = `
      <nodel-button layout="stack">
        <nodel-icon name="volume"></nodel-icon>
        <nodel-text size="lg">Volume</nodel-text>
      </nodel-button>
    `;
    await customElements.whenDefined('nodel-button');
    await Promise.resolve();

    const host = document.querySelector('nodel-button') as HTMLElement;
    expect(host.dataset.layout).toBe('stack');
    expect(host.querySelector('.nodel-button-content')).not.toBeNull();
  });

  it('supports explicit button sizes', async () => {
    document.body.innerHTML = `
      <nodel-button size="sm">Small</nodel-button>
      <nodel-button size="md">Medium</nodel-button>
      <nodel-button size="lg">Large</nodel-button>
      <nodel-button size="bad">Fallback</nodel-button>
    `;
    await customElements.whenDefined('nodel-button');
    await Promise.resolve();

    const buttons = Array.from(document.querySelectorAll('nodel-button'));
    expect(buttons.map((button) => button.getAttribute('data-size'))).toEqual(['sm', 'md', 'lg', 'auto']);
  });

  it('maps disabled and active attributes to native state', async () => {
    document.body.innerHTML = '<nodel-button active disabled>Selected</nodel-button>';
    await customElements.whenDefined('nodel-button');
    await Promise.resolve();

    const host = document.querySelector('nodel-button') as HTMLElement;
    const button = host.querySelector('button') as HTMLButtonElement;

    expect(host.dataset.active).toBe('true');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.className).toContain('is-active');
  });

  it('calls an action with an empty payload when no arg is set', async () => {
    document.body.innerHTML = '<nodel-button action="Power">Power</nodel-button>';
    await customElements.whenDefined('nodel-button');
    await Promise.resolve();

    const submitted = vi.fn();
    const host = document.querySelector('nodel-button') as HTMLElement;
    host.addEventListener('nodel-button-submitted', submitted);
    host.querySelector('button')?.click();
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('Power', {});
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it('uses join as action and default active signal shorthand', async () => {
    document.body.innerHTML = '<nodel-button join="Power">Power</nodel-button>';
    await customElements.whenDefined('nodel-button');
    await flush();

    const host = document.querySelector('nodel-button') as HTMLElement;
    host.querySelector('button')?.click();
    await flush();
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('Power', {});

    emitSignal('Power', 'on');
    expect(host.hasAttribute('active')).toBe(true);
  });

  it('calls multiple click actions in declaration order', async () => {
    document.body.innerHTML = '<nodel-button actions="Prepare; Start" arg="true" arg-type="boolean">Start</nodel-button>';
    await customElements.whenDefined('nodel-button');
    await flush();

    document.querySelector<HTMLButtonElement>('nodel-button button')?.click();
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenNthCalledWith(1, 'Prepare', { arg: true });
    expect(actionMock.callNodeAction).toHaveBeenNthCalledWith(2, 'Start', { arg: true });
  });

  it('parses arg payloads before calling an action', async () => {
    document.body.innerHTML = '<nodel-button action="SetLevel" arg="42" arg-type="number">Set</nodel-button>';
    await customElements.whenDefined('nodel-button');
    await Promise.resolve();

    document.querySelector('nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('SetLevel', { arg: 42 });
  });

  it('blocks duplicate clicks while busy', async () => {
    let resolveAction: () => void = () => undefined;
    actionMock.callNodeAction.mockReturnValue(new Promise<void>((resolve) => {
      resolveAction = resolve;
    }));
    document.body.innerHTML = '<nodel-button action="Slow">Slow</nodel-button>';
    await customElements.whenDefined('nodel-button');
    await Promise.resolve();

    const button = document.querySelector('nodel-button button') as HTMLButtonElement;
    button.click();
    button.click();

    expect(actionMock.callNodeAction).toHaveBeenCalledTimes(1);
    resolveAction();
    await flush();
  });

  it('dispatches error events and toast details when action calls fail', async () => {
    actionMock.callNodeAction.mockRejectedValue(new Error('No route'));
    document.body.innerHTML = '<nodel-button action="Missing">Missing</nodel-button>';
    await customElements.whenDefined('nodel-button');
    await Promise.resolve();

    const error = vi.fn();
    const toast = vi.fn();
    const host = document.querySelector('nodel-button') as HTMLElement;
    host.addEventListener('nodel-button-error', error);
    host.addEventListener('nodel-toast', toast);
    host.querySelector('button')?.click();
    await flush();

    expect(error).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0].detail).toMatchObject({ tone: 'danger', detail: 'No route' });
  });

  it('does not dispatch submitted events when action calls fail', async () => {
    actionMock.callNodeAction.mockRejectedValue(new Error('No route'));
    document.body.innerHTML = '<nodel-button action="Missing">Missing</nodel-button>';
    await customElements.whenDefined('nodel-button');
    await flush();

    const submitted = vi.fn();
    const host = document.querySelector('nodel-button') as HTMLElement;
    host.addEventListener('nodel-button-submitted', submitted);
    host.querySelector('button')?.click();
    await flush();

    expect(submitted).not.toHaveBeenCalled();
  });

  it('gates click actions through confirmation', async () => {
    document.body.innerHTML = '<nodel-button action="Delete" confirm-text="Delete it?">Delete</nodel-button>';
    await customElements.whenDefined('nodel-button');
    await flush();

    const host = document.querySelector('nodel-button') as HTMLElement;
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
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('Delete', {});
  });

  it('updates active, label, and disabled state from signal bindings', async () => {
    document.body.innerHTML = '<nodel-button signal="Source" arg="TV" signals="ButtonLabel:label; Locked:disabled">Waiting</nodel-button>';
    await customElements.whenDefined('nodel-button');
    await flush();

    const host = document.querySelector('nodel-button') as HTMLElement;
    expect(activityMock.listeners).toHaveLength(1);

    emitSignal('Source', 'TV');
    expect(host.hasAttribute('active')).toBe(true);

    emitSignal('ButtonLabel', 'Television');
    expect(host.querySelector('button')?.textContent?.trim()).toBe('Television');

    emitSignal('Locked', 'true');
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);

    emitSignal('Locked', 'false');
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false);
  });

  it('aggregates repeated active signal targets when requested', async () => {
    document.body.innerHTML = '<nodel-button signals="ReadyA:active(any); ReadyB:active(any)">Ready</nodel-button>';
    await customElements.whenDefined('nodel-button');
    await flush();

    const host = document.querySelector('nodel-button') as HTMLElement;
    emitSignal('ReadyA', 'off');
    expect(host.hasAttribute('active')).toBe(false);

    emitSignal('ReadyB', 'on');
    expect(host.hasAttribute('active')).toBe(true);

    emitSignals([{ alias: 'ReadyA', arg: 'off' }, { alias: 'ReadyB', arg: 'off' }]);
    expect(host.hasAttribute('active')).toBe(false);
  });

  it('supports momentary press and release actions', async () => {
    document.body.innerHTML = '<nodel-button actions="VolumeUp:press; VolumeStop:release">Up</nodel-button>';
    await customElements.whenDefined('nodel-button');
    await flush();

    const button = document.querySelector('nodel-button button') as HTMLButtonElement;
    button.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    await flush();
    document.dispatchEvent(new Event('pointerup', { bubbles: true, cancelable: true }));
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenNthCalledWith(1, 'VolumeUp', {});
    expect(actionMock.callNodeAction).toHaveBeenNthCalledWith(2, 'VolumeStop', {});
  });

  it('runs confirmed momentary press and release after pointer release', async () => {
    document.body.innerHTML = '<nodel-button actions="VolumeUp:press; VolumeStop:release" confirm-text="Move volume?">Up</nodel-button>';
    await customElements.whenDefined('nodel-button');
    await flush();

    const host = document.querySelector('nodel-button') as HTMLElement;
    let resolveConfirm: (confirmed: boolean) => void = () => undefined;
    host.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      resolveConfirm = (event as CustomEvent<{ resolve: (confirmed: boolean) => void }>).detail.resolve;
    });

    const button = host.querySelector('button') as HTMLButtonElement;
    button.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    document.dispatchEvent(new Event('pointerup', { bubbles: true, cancelable: true }));
    resolveConfirm(true);
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenNthCalledWith(1, 'VolumeUp', {});
    expect(actionMock.callNodeAction).toHaveBeenNthCalledWith(2, 'VolumeStop', {});
  });

  it('allows click actions on buttons that also define momentary phases', async () => {
    document.body.innerHTML = '<nodel-button actions="Arm:click; VolumeUp:press; VolumeStop:release">Up</nodel-button>';
    await customElements.whenDefined('nodel-button');
    await flush();

    const button = document.querySelector('nodel-button button') as HTMLButtonElement;
    button.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    document.dispatchEvent(new Event('pointerup', { bubbles: true, cancelable: true }));
    button.click();
    await flush();

    expect(actionMock.callNodeAction).toHaveBeenCalledWith('VolumeUp', {});
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('VolumeStop', {});
    expect(actionMock.callNodeAction).toHaveBeenCalledWith('Arm', {});
  });

  it('preserves media and indicator children across state renders', async () => {
    document.body.innerHTML = `
      <nodel-button signal="Source" arg="HDMI1" signals="ButtonLabel:label">
        <nodel-icon name="image"></nodel-icon>
        HDMI 1
        <nodel-status-indicator value="present"></nodel-status-indicator>
      </nodel-button>
    `;
    await customElements.whenDefined('nodel-button');
    await customElements.whenDefined('nodel-icon');
    await customElements.whenDefined('nodel-status-indicator');
    await flush();

    const host = document.querySelector('nodel-button') as HTMLElement;
    const icon = host.querySelector('nodel-icon');
    const indicator = host.querySelector('nodel-status-indicator');

    emitSignal('Source', 'HDMI1');
    expect(host.hasAttribute('active')).toBe(true);
    expect(host.querySelector('nodel-icon')).toBe(icon);
    expect(host.querySelector('nodel-status-indicator')).toBe(indicator);

    emitSignal('ButtonLabel', 'Input 1');
    expect(host.querySelector('[data-button-label]')?.textContent).toBe('Input 1');
    expect(host.querySelector('nodel-icon')).toBe(icon);
    expect(host.querySelector('nodel-status-indicator')).toBe(indicator);
  });

  it('supports accessible icon-only and image-only buttons', async () => {
    document.body.innerHTML = `
      <nodel-button aria-label="Power"><nodel-icon name="power"></nodel-icon></nodel-button>
      <nodel-button><nodel-image src="logo.png" alt="Nodel"></nodel-image></nodel-button>
    `;
    await customElements.whenDefined('nodel-button');
    await customElements.whenDefined('nodel-icon');
    await customElements.whenDefined('nodel-image');
    await flush();

    const buttons = Array.from(document.querySelectorAll('nodel-button'));
    expect(buttons[0].querySelector('button')?.getAttribute('aria-label')).toBe('Power');
    expect(buttons[0].querySelector('[data-button-label]')).toBeNull();
    expect(buttons[1].querySelector('nodel-image img')?.getAttribute('alt')).toBe('Nodel');
    expect(buttons[1].querySelector('[data-button-label]')).toBeNull();
  });

  it('preserves nodel-text children inside buttons', async () => {
    document.body.innerHTML = `
      <nodel-button action="Volume">
        <nodel-icon name="volume"></nodel-icon>
        <nodel-text tone="info" size="xl">Volume</nodel-text>
      </nodel-button>
    `;
    await customElements.whenDefined('nodel-button');
    await customElements.whenDefined('nodel-icon');
    await customElements.whenDefined('nodel-text');
    await flush();

    const host = document.querySelector('nodel-button') as HTMLElement;
    const text = host.querySelector('nodel-text');
    host.setAttribute('active', '');

    expect(host.querySelector('nodel-text')).toBe(text);
    expect(text?.getAttribute('data-tone')).toBe('info');
    expect(text?.getAttribute('data-size')).toBe('xl');
  });
});
