import { flush, waitFor } from './helpers';
import { ControlActionController } from '../src/data/control-actions';

const actionMock = vi.hoisted(() => ({ callNodeAction: vi.fn() }));

vi.mock('../src/api/nodel-host-client', () => ({ callNodeAction: actionMock.callNodeAction }));

import '../src/components/nodel-button';
import '../src/components/nodel-fader';
import '../src/components/nodel-pad';
import '../src/components/nodel-palette';
import '../src/components/nodel-segmented';
import '../src/components/nodel-select';
import '../src/components/nodel-stepper';
import '../src/components/nodel-toggle';

interface ConfirmCase {
  name: string;
  markup: string;
  host: string;
  trigger: () => void;
}

describe('control action semantics', () => {
  const confirmationCases: ConfirmCase[] = [
    {
      name: 'button',
      markup: '<nodel-button action="Run" confirm>Run</nodel-button>',
      host: 'nodel-button',
      trigger: () => document.querySelector('nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    {
      name: 'toggle',
      markup: '<nodel-toggle action="SetPower" confirm></nodel-toggle>',
      host: 'nodel-toggle',
      trigger: () => document.querySelector('nodel-toggle button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    {
      name: 'segmented',
      markup: '<nodel-segmented action="SetMode" confirm><nodel-button value="A">A</nodel-button></nodel-segmented>',
      host: 'nodel-segmented',
      trigger: () => document.querySelector('nodel-segmented nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    {
      name: 'select',
      markup: '<nodel-select action="SetMode" confirm><nodel-button value="A">A</nodel-button></nodel-select>',
      host: 'nodel-select',
      trigger: () => document.querySelector('nodel-select nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    {
      name: 'stepper',
      markup: '<nodel-stepper action="SetLevel" value="1" confirm></nodel-stepper>',
      host: 'nodel-stepper',
      trigger: () => document.querySelector('.nodel-stepper-shell')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    },
    {
      name: 'pad',
      markup: '<nodel-pad action="Move" confirm center="show"></nodel-pad>',
      host: 'nodel-pad',
      trigger: () => document.querySelector('[data-direction="right"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    {
      name: 'palette',
      markup: '<nodel-palette action="SetColour" confirm><nodel-button value="#ff0000">Red</nodel-button></nodel-palette>',
      host: 'nodel-palette',
      trigger: () => document.querySelector('nodel-palette nodel-button button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    },
    {
      name: 'fader',
      markup: '<nodel-fader action="SetLevel" value="50" confirm></nodel-fader>',
      host: 'nodel-fader',
      trigger: () => document.querySelector('.nodel-fader-track')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    }
  ];

  beforeEach(() => {
    actionMock.callNodeAction.mockReset();
    actionMock.callNodeAction.mockResolvedValue({});
    document.body.innerHTML = '';
  });

  it.each(confirmationCases)('does not call $name actions when confirmation is cancelled', async ({ markup, host: hostSelector, trigger }) => {
    document.body.innerHTML = markup;
    await flush();

    const confirm = vi.fn((event: Event) => {
      event.preventDefault();
      (event as CustomEvent).detail.resolve(false);
    });
    document.querySelector(hostSelector)?.addEventListener('nodel-confirm', confirm);
    trigger();
    await flush();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(actionMock.callNodeAction).not.toHaveBeenCalled();
  });

  it.each(confirmationCases)('does not start $name actions after disconnecting during confirmation and reconnects cleanly', async ({ markup, host: hostSelector, trigger, name }) => {
    document.body.innerHTML = markup;
    await flush();
    const host = document.querySelector<HTMLElement>(hostSelector)!;
    const completion = vi.fn();
    const error = vi.fn();
    host.addEventListener(`nodel-${name}-${name === 'button' ? 'submitted' : name === 'pad' ? 'action' : 'change'}`, completion);
    host.addEventListener(`nodel-${name}-error`, error);
    let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
    const confirm = vi.fn((event: Event) => {
      event.preventDefault();
      const resolve = (event as CustomEvent).detail.resolve as (confirmed: boolean) => void;
      if (resolveConfirmation) {
        resolve(true);
      } else {
        resolveConfirmation = resolve;
      }
    });
    host.addEventListener('nodel-confirm', confirm);

    trigger();
    await flush();
    expect(resolveConfirmation).toBeDefined();
    host.remove();
    resolveConfirmation?.(true);
    await flush();

    expect(actionMock.callNodeAction).not.toHaveBeenCalled();
    expect(completion).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    document.body.append(host);
    await flush();
    trigger();
    await flush();

    await waitFor(() => actionMock.callNodeAction.mock.calls.length === 1);
  });

  it('retains successful action results when a later binding fails', async () => {
    actionMock.callNodeAction
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('Second action failed'));
    document.body.innerHTML = '<nodel-button actions="First; Second">Run</nodel-button>';
    await flush();
    const button = document.querySelector<HTMLElement>('nodel-button')!;
    const error = vi.fn();
    button.addEventListener('nodel-button-error', error);

    button.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await flush();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0].detail.results).toEqual([
      { action: 'First', phase: 'click', ok: true },
      { action: 'Second', phase: 'click', ok: false, error: 'Second action failed' }
    ]);
    expect(error.mock.calls[0][0].detail.failures).toEqual([
      { action: 'Second', phase: 'click', ok: false, error: 'Second action failed' }
    ]);
  });

  it('calls action names with U+FEFF exactly while trimming Java edge spaces', async () => {
    document.body.innerHTML = '<nodel-button action=" \u00a0Power\uFEFF\u00a0 ">Run</nodel-button>';
    await flush();

    document.querySelector<HTMLButtonElement>('nodel-button button')?.click();
    await waitFor(() => actionMock.callNodeAction.mock.calls.length === 1);

    expect(actionMock.callNodeAction.mock.calls.map((call) => call[0])).toEqual(['Power\uFEFF']);
    expect(actionMock.callNodeAction).not.toHaveBeenCalledWith('Power', expect.anything());
  });

  it('does not start later bindings after disconnecting an in-flight action', async () => {
    let resolveFirst!: () => void;
    actionMock.callNodeAction.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve; }));
    document.body.innerHTML = '<nodel-button actions="First; Second">Run</nodel-button>';
    await flush();
    const button = document.querySelector<HTMLElement>('nodel-button')!;

    button.querySelector('button')?.click();
    await waitFor(() => actionMock.callNodeAction.mock.calls.length === 1);
    button.remove();
    resolveFirst();
    await flush();

    expect(actionMock.callNodeAction.mock.calls.map((call) => call[0])).toEqual(['First']);
  });

  it('does not start later phases after disconnecting an in-flight toggle action', async () => {
    let resolveToggle!: () => void;
    actionMock.callNodeAction.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveToggle = resolve; }));
    document.body.innerHTML = '<nodel-toggle actions="Toggle:toggle; TurnOn:on"></nodel-toggle>';
    await flush();
    const toggle = document.querySelector<HTMLElement>('nodel-toggle')!;

    toggle.querySelector('button')?.click();
    await waitFor(() => actionMock.callNodeAction.mock.calls.length === 1);
    toggle.remove();
    resolveToggle();
    await flush();

    expect(actionMock.callNodeAction.mock.calls.map((call) => call[0])).toEqual(['Toggle']);
  });

  it('does not let an old segmented request clear fresh busy state after reconnect', async () => {
    let resolveOld!: () => void;
    let resolveNew!: () => void;
    actionMock.callNodeAction
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveNew = resolve; }));
    document.body.innerHTML = '<nodel-segmented action="SetMode"><nodel-button value="A">A</nodel-button><nodel-button value="B">B</nodel-button></nodel-segmented>';
    await flush();
    const segmented = document.querySelector<HTMLElement>('nodel-segmented')!;
    const clickOption = (value: string) => segmented.querySelector<HTMLElement>(`nodel-button[value="${value}"] button`)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    clickOption('A');
    await waitFor(() => actionMock.callNodeAction.mock.calls.length === 1);
    segmented.remove();
    document.body.append(segmented);
    await flush();
    clickOption('B');
    await waitFor(() => actionMock.callNodeAction.mock.calls.length === 2);
    expect(segmented.dataset.disabled).toBe('true');

    resolveOld();
    await flush();
    expect(segmented.dataset.disabled).toBe('true');

    resolveNew();
    await flush();
    expect(segmented.dataset.disabled).toBe('false');
  });

  it('keeps a button usable after an in-flight action disconnects and reconnects', async () => {
    let resolveOld!: () => void;
    actionMock.callNodeAction
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({});
    document.body.innerHTML = '<nodel-button action="Run">Run</nodel-button>';
    await flush();
    const button = document.querySelector<HTMLElement>('nodel-button')!;
    const nativeButton = button.querySelector<HTMLButtonElement>('button')!;

    nativeButton.click();
    await waitFor(() => actionMock.callNodeAction.mock.calls.length === 1);
    expect(nativeButton.disabled).toBe(true);

    button.remove();
    expect(nativeButton.disabled).toBe(false);
    document.body.append(button);
    await flush();
    nativeButton.click();
    await waitFor(() => actionMock.callNodeAction.mock.calls.length === 2);

    resolveOld();
    await flush();
    expect(nativeButton.disabled).toBe(false);
  });

  it('blocks queued button momentary release work from an old generation', async () => {
    let resolvePress!: () => void;
    actionMock.callNodeAction.mockImplementationOnce(() => new Promise<void>((resolve) => { resolvePress = resolve; }));
    document.body.innerHTML = '<nodel-button actions="Start:press; Stop:release">Run</nodel-button>';
    await flush();
    const button = document.querySelector<HTMLElement>('nodel-button')!;
    const nativeButton = button.querySelector<HTMLButtonElement>('button')!;

    nativeButton.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await waitFor(() => actionMock.callNodeAction.mock.calls.length === 1);
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
    button.remove();
    expect(button.hasAttribute('active')).toBe(false);
    expect(nativeButton.getAttribute('aria-pressed')).toBeNull();
    document.body.append(button);
    resolvePress();
    await flush();

    expect(actionMock.callNodeAction.mock.calls.map((call) => call[0])).toEqual(['Start']);
  });

  it('blocks queued pad momentary release work from an old generation', async () => {
    let resolvePress!: () => void;
    actionMock.callNodeAction.mockImplementationOnce(() => new Promise<void>((resolve) => { resolvePress = resolve; }));
    document.body.innerHTML = '<nodel-pad press-mode="momentary" up-actions="Up:press; Stop:release"></nodel-pad>';
    await flush();
    const pad = document.querySelector<HTMLElement>('nodel-pad')!;
    const up = pad.querySelector<HTMLButtonElement>('[data-direction="up"]')!;

    up.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await waitFor(() => actionMock.callNodeAction.mock.calls.length === 1);
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
    pad.remove();
    document.body.append(pad);
    resolvePress();
    await flush();

    expect(actionMock.callNodeAction.mock.calls.map((call) => call[0])).toEqual(['Up']);
  });

  it('does not retain an old serial queue or single-flight state across generations', async () => {
    const controller = new ControlActionController();
    expect(controller.captureScope()).toBeNull();
    expect(controller.startSingleFlight(null)).toBe(false);

    const oldScope = controller.connect();
    let resolveOld!: () => void;
    const oldRun = controller.runSerial(oldScope, () => new Promise<void>((resolve) => { resolveOld = resolve; }));
    await Promise.resolve();
    expect(controller.startSingleFlight(oldScope)).toBe(true);
    controller.disconnect();

    const newScope = controller.connect();
    const freshRun = vi.fn().mockResolvedValue(undefined);
    await controller.runSerial(newScope, freshRun);
    expect(freshRun).toHaveBeenCalledTimes(1);
    expect(controller.startSingleFlight(newScope)).toBe(true);

    controller.finishSingleFlight(oldScope);
    expect(controller.startSingleFlight(newScope)).toBe(false);
    controller.finishSingleFlight(newScope);
    expect(controller.startSingleFlight(newScope)).toBe(true);

    resolveOld();
    await oldRun.catch(() => undefined);
  });

  it('uses the same generation AbortSignal for confirmation and the action call', async () => {
    document.body.innerHTML = '<nodel-button action="Run" confirm>Run</nodel-button>';
    await flush();
    const button = document.querySelector<HTMLElement>('nodel-button')!;
    let confirmationSignal: AbortSignal | undefined;
    button.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      confirmationSignal = (event as CustomEvent).detail.signal;
      (event as CustomEvent).detail.resolve(true);
    });

    button.querySelector('button')?.click();
    await waitFor(() => actionMock.callNodeAction.mock.calls.length === 1);

    expect(actionMock.callNodeAction.mock.calls[0][2]?.signal).toBe(confirmationSignal);
  });
});
