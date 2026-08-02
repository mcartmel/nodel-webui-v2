import '../src/components/nodel-confirm-host';
import '../src/components/nodel-app';
import '../src/components/nodel-button';
import '../src/components/nodel-toggle';
import '../src/components/nodel-segmented';
import '../src/components/nodel-select';
import '../src/components/nodel-palette';
import '../src/components/nodel-pad';
import '../src/components/nodel-stepper';
import type { NodelConfirmHostElement } from '../src/components/nodel-confirm-host';
import type { NodelActivityLogEntry } from '../src/api/nodel-types';
import type { NodelControlRuntime, NodelControlSignalState } from '../src/data/control-runtime';
import { installControlRuntime } from '../src/data/control-runtime';
import { confirmRequestFromAttributes, NODEL_CONFIRM, requestConfirm, shouldConfirm, type NodelConfirmDetail } from '../src/data/confirm';
import { flush, waitFor } from './helpers';

function signalEntry(alias: string, arg: unknown, seq = 1): NodelActivityLogEntry {
  return {
    seq,
    timestamp: '2026-07-31T00:00:00Z',
    source: 'local',
    type: 'event',
    alias,
    arg
  };
}

function createRuntime(initialState?: NodelControlSignalState) {
  let listener: ((state: NodelControlSignalState) => void) | null = null;
  const dispose = vi.fn();
  const callAction = vi.fn(async () => ({}));
  const subscribeSignals = vi.fn((_element: HTMLElement, nextListener: (state: NodelControlSignalState) => void) => {
    listener = nextListener;
    if (initialState) {
      nextListener(initialState);
    }
    return { dispose };
  });
  const runtime: NodelControlRuntime = { callAction, subscribeSignals };

  return {
    callAction,
    dispose,
    emit(state: NodelControlSignalState) {
      listener?.(state);
    },
    runtime,
    subscribeSignals
  };
}

function connectedState(entries: NodelActivityLogEntry[] = []): NodelControlSignalState {
  return { loading: false, connected: true, error: '', entries };
}

function clickDigit(host: NodelConfirmHostElement, digit: string) {
  host.querySelector<HTMLButtonElement>(`[data-confirm-code-digit="${digit}"]`)?.click();
}

function nextTimer() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe('nodel-confirm-host', () => {
  let restoreRuntime: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = '<button id="trigger">Trigger</button><nodel-confirm-host></nodel-confirm-host>';
  });

  afterEach(() => {
    restoreRuntime?.();
    restoreRuntime = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps standard confirmation behavior and restores focus', async () => {
    const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
    const trigger = document.querySelector<HTMLButtonElement>('#trigger')!;
    const resolutions: boolean[] = [];
    trigger.focus();

    host.confirm({
      title: 'Confirm power',
      text: 'Power on?',
      tone: 'warning',
      resolve: (value) => resolutions.push(value)
    }, trigger);
    await flush();

    expect(host.hidden).toBe(false);
    expect(host.textContent).toContain('Confirm power');
    expect(host.querySelector('.nodel-confirm-warning')).not.toBeNull();
    expect(trigger.inert).toBe(true);
    expect(trigger.hasAttribute('inert')).toBe(true);
    const confirm = host.querySelector<HTMLButtonElement>('[data-confirm-action="confirm"]')!;
    const cancel = host.querySelector<HTMLButtonElement>('button[data-confirm-action="cancel"]')!;
    expect(document.activeElement).toBe(confirm);

    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(cancel);
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(confirm);
    confirm.click();

    expect(resolutions).toEqual([true]);
    expect(host.hidden).toBe(true);
    await nextTimer();
    expect(trigger.inert).toBe(false);
    expect(trigger.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('restores trigger focus after the confirmed caller finishes rendering', async () => {
    const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
    const trigger = document.querySelector<HTMLButtonElement>('#trigger')!;
    host.confirm({
      text: 'Continue?',
      resolve: () => {
        queueMicrotask(() => {
          trigger.disabled = true;
          trigger.disabled = false;
        });
      }
    }, trigger);
    await flush();

    host.querySelector<HTMLButtonElement>('[data-confirm-action="confirm"]')?.click();
    expect(document.activeElement).not.toBe(trigger);
    await nextTimer();

    expect(document.activeElement).toBe(trigger);
  });

  it('preserves focus explicitly moved by the confirmed caller', async () => {
    const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
    const trigger = document.querySelector<HTMLButtonElement>('#trigger')!;
    const nextControl = document.createElement('button');
    document.body.appendChild(nextControl);
    host.confirm({
      text: 'Continue?',
      resolve: () => queueMicrotask(() => nextControl.focus())
    }, trigger);
    await flush();

    host.querySelector<HTMLButtonElement>('[data-confirm-action="confirm"]')?.click();
    await nextTimer();

    expect(document.activeElement).toBe(nextControl);
  });

  it('focuses Cancel first for destructive confirmations', async () => {
    const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
    host.confirm({ title: 'Delete file?', text: 'Continue?', tone: 'danger', resolve: vi.fn() });
    await flush();
    expect(document.activeElement).toBe(host.querySelector('button[data-confirm-action="cancel"]'));
  });

  it('closes and cancels a confirmation when its operation aborts', async () => {
    const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
    const controller = new AbortController();
    const resolve = vi.fn();
    host.confirm({ title: 'Delete file?', text: 'Continue?', tone: 'danger', signal: controller.signal, resolve });
    await flush();
    expect(host.hidden).toBe(false);
    controller.abort();
    expect(resolve).toHaveBeenCalledWith(false);
    expect(host.hidden).toBe(true);
  });

  it('resolves false on cancel, backdrop, and Escape', () => {
    const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
    const resolutions: boolean[] = [];

    host.confirm({ text: 'Continue?', resolve: (value) => resolutions.push(value) });
    host.querySelector<HTMLButtonElement>('[data-confirm-action="cancel"]')?.click();
    host.confirm({ text: 'Continue?', resolve: (value) => resolutions.push(value) });
    host.querySelector<HTMLElement>('.nodel-confirm-backdrop')?.click();
    host.confirm({ mode: 'code', text: 'Enter code', resolve: (value) => resolutions.push(value) });
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(resolutions).toEqual([false, false, false]);
  });

  it('keeps code mode unavailable while loading, missing, disconnected, or non-scalar', async () => {
    const runtime = createRuntime();
    restoreRuntime = installControlRuntime(runtime.runtime);
    const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
    host.confirm({ mode: 'code', codeSignal: 'OperatorPin', resolve: vi.fn() });

    expect(host.textContent).toContain('Loading operator code...');
    expect(host.querySelector<HTMLButtonElement>('[data-confirm-action="confirm"]')?.disabled).toBe(true);
    expect(runtime.subscribeSignals).toHaveBeenCalledTimes(1);

    runtime.emit(connectedState());
    expect(host.textContent).toContain('Operator code unavailable.');
    runtime.emit(connectedState([signalEntry('OperatorPin', { code: 1234 })]));
    expect(host.textContent).toContain('Operator code unavailable.');
    runtime.emit(connectedState([signalEntry('OperatorPin', ['1', '2'])]));
    expect(host.textContent).toContain('Operator code unavailable.');
    runtime.emit(connectedState([signalEntry('OperatorPin', '1234')]));
    const digit = host.querySelector<HTMLButtonElement>('[data-confirm-code-digit="1"]')!;
    digit.focus();
    runtime.emit({ loading: false, connected: false, error: '', entries: [] });
    await flush();
    expect(host.textContent).toContain('Operator code unavailable.');
    expect(document.activeElement).toBe(host.querySelector('button[data-confirm-action="cancel"]'));
    runtime.emit({ loading: false, connected: false, error: 'offline', entries: [] });
    expect(host.textContent).not.toContain('offline');
  });

  it('matches leading-zero codes through keyboard input and Enter', () => {
    const runtime = createRuntime(connectedState([signalEntry('ConfirmCode', '0420')]));
    restoreRuntime = installControlRuntime(runtime.runtime);
    const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
    const resolved = vi.fn();
    host.confirm({ mode: 'code', resolve: resolved });

    for (const key of ['0', '4', '2', '1']) {
      host.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    expect(host.querySelector<HTMLButtonElement>('[data-confirm-action="confirm"]')?.disabled).toBe(true);
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    host.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true, cancelable: true }));
    expect(host.querySelector<HTMLButtonElement>('[data-confirm-action="confirm"]')?.disabled).toBe(false);
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(resolved).toHaveBeenCalledOnce();
    expect(resolved).toHaveBeenCalledWith(true);
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it('supports keypad digits, Clear, Backspace, and clears entry when the signal changes', () => {
    const runtime = createRuntime(connectedState([signalEntry('ConfirmCode', '12')]));
    restoreRuntime = installControlRuntime(runtime.runtime);
    const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const toastHost = document.createElement('nodel-toast-host');
    document.body.append(toastHost);
    host.confirm({ mode: 'code', resolve: vi.fn() });

    clickDigit(host, '1');
    clickDigit(host, '2');
    expect(host.querySelector<HTMLButtonElement>('[data-confirm-action="confirm"]')?.disabled).toBe(false);
    expect(host.querySelector('.nodel-confirm-code-entry')?.getAttribute('aria-label')).toBe('2 digits entered');
    host.querySelector<HTMLButtonElement>('[data-confirm-action="clear"]')?.click();
    expect(host.querySelector('.nodel-confirm-code-entry')?.getAttribute('aria-label')).toBe('0 digits entered');

    clickDigit(host, '1');
    clickDigit(host, '2');
    host.querySelector<HTMLButtonElement>('[data-confirm-action="backspace"]')?.click();
    expect(host.querySelector('.nodel-confirm-code-entry')?.getAttribute('aria-label')).toBe('1 digit entered');
    expect(host.querySelector<HTMLButtonElement>('[data-confirm-action="confirm"]')?.disabled).toBe(true);

    runtime.emit(connectedState([signalEntry('ConfirmCode', '9072', 2)]));
    expect(host.querySelector('.nodel-confirm-code-entry')?.getAttribute('aria-label')).toBe('0 digits entered');
    expect(host.textContent).not.toContain('9072');
    expect(host.innerHTML).not.toContain('9072');
    expect(Array.from(host.querySelectorAll('[aria-label]')).map((element) => element.getAttribute('aria-label')).join(' ')).not.toContain('9072');
    expect(toastHost.textContent).not.toContain('9072');
    expect(JSON.stringify([...consoleLog.mock.calls, ...consoleWarn.mock.calls, ...consoleError.mock.calls])).not.toContain('9072');
  });

  it('subscribes only for open code dialogs and disposes on cancellation', () => {
    const runtime = createRuntime();
    restoreRuntime = installControlRuntime(runtime.runtime);
    const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;

    host.confirm({ text: 'Standard', resolve: vi.fn() });
    expect(runtime.subscribeSignals).not.toHaveBeenCalled();
    host.querySelector<HTMLButtonElement>('[data-confirm-action="cancel"]')?.click();
    host.confirm({ mode: 'code', resolve: vi.fn() });
    expect(runtime.subscribeSignals).toHaveBeenCalledTimes(1);
    host.querySelector<HTMLButtonElement>('[data-confirm-action="cancel"]')?.click();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it('cancels code fallback without calling window.confirm', async () => {
    document.body.innerHTML = '<button id="standalone">Standalone</button>';
    const element = document.querySelector<HTMLButtonElement>('#standalone')!;
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    await expect(requestConfirm(element, { mode: 'code', text: 'Enter code' })).resolves.toBe(false);
    expect(nativeConfirm).not.toHaveBeenCalled();
    await expect(requestConfirm(element, { mode: 'standard', text: 'Continue?' })).resolves.toBe(true);
    expect(nativeConfirm).toHaveBeenCalledWith('Continue?');
  });

  it('parses explicit code mode and its default or overridden signal', () => {
    const element = document.createElement('button');
    element.setAttribute('confirm-mode', 'code');
    expect(shouldConfirm(element)).toBe(true);
    expect(confirmRequestFromAttributes(element)).toMatchObject({ mode: 'code', codeSignal: 'ConfirmCode' });
    element.setAttribute('confirm-code-signal', 'OperatorPin');
    expect(confirmRequestFromAttributes(element)).toMatchObject({ mode: 'code', codeSignal: 'OperatorPin' });
  });

  it('blocks an action until one successful code match and restores the native trigger', async () => {
    const runtime = createRuntime(connectedState([signalEntry('ConfirmCode', '12')]));
    restoreRuntime = installControlRuntime(runtime.runtime);
    document.body.innerHTML = `
      <nodel-app>
        <nodel-button action="SetPower" arg="true" arg-type="boolean" confirm-mode="code">Power</nodel-button>
      </nodel-app>
    `;
    await flush();

    const control = document.querySelector('nodel-button')!;
    const nativeButton = control.querySelector<HTMLButtonElement>('button')!;
    nativeButton.focus();
    nativeButton.click();
    await flush();
    const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
    expect(runtime.callAction).not.toHaveBeenCalled();
    expect(host.hidden).toBe(false);

    clickDigit(host, '1');
    expect(runtime.callAction).not.toHaveBeenCalled();
    clickDigit(host, '2');
    const confirm = host.querySelector<HTMLButtonElement>('[data-confirm-action="confirm"]')!;
    expect(confirm.disabled).toBe(false);
    confirm.click();
    await waitFor(() => runtime.callAction.mock.calls.length === 1);

    expect(runtime.callAction).toHaveBeenCalledWith('SetPower', { arg: true });
    expect(document.activeElement).toBe(nativeButton);
    confirm.click();
    expect(runtime.callAction).toHaveBeenCalledTimes(1);
  });

  it('exposes code confirmation attributes on every confirm-capable control', () => {
    for (const name of ['nodel-button', 'nodel-toggle', 'nodel-segmented', 'nodel-select', 'nodel-palette', 'nodel-pad', 'nodel-stepper']) {
      const constructor = customElements.get(name) as (CustomElementConstructor & { observedAttributes?: string[] }) | undefined;
      expect(constructor?.observedAttributes, name).toEqual(expect.arrayContaining(['confirm-mode', 'confirm-code-signal']));
    }
  });

  it('routes code confirmation metadata from every confirm-capable control', async () => {
    const cases = [
      ['<nodel-button action="Run" confirm-mode="code" confirm-code-signal="Pin">Run</nodel-button>', 'nodel-button button'],
      ['<nodel-toggle action="Run" confirm-mode="code" confirm-code-signal="Pin"></nodel-toggle>', 'nodel-toggle button'],
      ['<nodel-segmented action="Run" confirm-mode="code" confirm-code-signal="Pin"><nodel-button value="A">A</nodel-button></nodel-segmented>', 'nodel-segmented nodel-button button'],
      ['<nodel-select action="Run" open confirm-mode="code" confirm-code-signal="Pin"><nodel-button value="A">A</nodel-button></nodel-select>', 'nodel-select nodel-button button'],
      ['<nodel-palette action="Run" confirm-mode="code" confirm-code-signal="Pin"><nodel-button value="red">Red</nodel-button></nodel-palette>', 'nodel-palette nodel-button button'],
      ['<nodel-pad action="Run" center="show" confirm-mode="code" confirm-code-signal="Pin"></nodel-pad>', 'nodel-pad [data-direction="center"]']
    ] as const;

    for (const [markup, selector] of cases) {
      document.body.innerHTML = markup;
      await flush();
      const control = document.body.firstElementChild!;
      let detail: NodelConfirmDetail | null = null;
      control.addEventListener(NODEL_CONFIRM, ((event: CustomEvent<NodelConfirmDetail>) => {
        event.preventDefault();
        detail = event.detail;
        event.detail.resolve(false);
      }) as EventListener);
      document.querySelector<HTMLButtonElement>(selector)?.click();
      await flush();
      expect(detail, control.localName).toMatchObject({ mode: 'code', codeSignal: 'Pin' });
    }

    document.body.innerHTML = '<nodel-stepper action="Run" value="0" confirm-mode="code" confirm-code-signal="Pin"></nodel-stepper>';
    await flush();
    const stepper = document.querySelector('nodel-stepper')!;
    let stepperDetail: NodelConfirmDetail | null = null;
    stepper.addEventListener(NODEL_CONFIRM, ((event: CustomEvent<NodelConfirmDetail>) => {
      event.preventDefault();
      stepperDetail = event.detail;
      event.detail.resolve(false);
    }) as EventListener);
    stepper.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await flush();
    expect(stepperDetail).toMatchObject({ mode: 'code', codeSignal: 'Pin' });
  });

  it('blocks and then dispatches exactly once for every confirm-capable control', async () => {
    const runtime = createRuntime(connectedState([signalEntry('Pin', '1')]));
    restoreRuntime = installControlRuntime(runtime.runtime);
    const cases = [
      { markup: '<nodel-button action="Run" confirm-mode="code" confirm-code-signal="Pin">Run</nodel-button>', selector: 'nodel-button button' },
      { markup: '<nodel-toggle action="Run" confirm-mode="code" confirm-code-signal="Pin"></nodel-toggle>', selector: 'nodel-toggle button' },
      { markup: '<nodel-segmented action="Run" confirm-mode="code" confirm-code-signal="Pin"><nodel-button value="A">A</nodel-button></nodel-segmented>', selector: 'nodel-segmented nodel-button button' },
      { markup: '<nodel-select action="Run" open confirm-mode="code" confirm-code-signal="Pin"><nodel-button value="A">A</nodel-button></nodel-select>', selector: 'nodel-select nodel-button button' },
      { markup: '<nodel-palette action="Run" confirm-mode="code" confirm-code-signal="Pin"><nodel-button value="red">Red</nodel-button></nodel-palette>', selector: 'nodel-palette nodel-button button' },
      { markup: '<nodel-pad action="Run" center="show" confirm-mode="code" confirm-code-signal="Pin"></nodel-pad>', selector: 'nodel-pad [data-direction="center"]' },
      { markup: '<nodel-stepper action="Run" value="0" confirm-mode="code" confirm-code-signal="Pin"></nodel-stepper>', selector: 'nodel-stepper', key: 'ArrowRight' }
    ];

    for (const testCase of cases) {
      document.body.innerHTML = `<nodel-app>${testCase.markup}</nodel-app>`;
      await flush();
      const callsBefore = runtime.callAction.mock.calls.length;
      const target = document.querySelector<HTMLElement>(testCase.selector)!;
      if (testCase.key) {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: testCase.key, bubbles: true, cancelable: true }));
      } else {
        (target as HTMLButtonElement).click();
      }
      await flush();

      const host = document.querySelector('nodel-confirm-host') as NodelConfirmHostElement;
      expect(host.hidden, testCase.selector).toBe(false);
      expect(runtime.callAction, testCase.selector).toHaveBeenCalledTimes(callsBefore);
      clickDigit(host, '1');
      const confirm = host.querySelector<HTMLButtonElement>('[data-confirm-action="confirm"]')!;
      expect(confirm.disabled, testCase.selector).toBe(false);
      confirm.click();
      await waitFor(() => runtime.callAction.mock.calls.length === callsBefore + 1);
      confirm.click();
      expect(runtime.callAction, testCase.selector).toHaveBeenCalledTimes(callsBefore + 1);
    }
  });
});
