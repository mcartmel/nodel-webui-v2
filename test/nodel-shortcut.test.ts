import { flush, waitFor } from './helpers';
import { installControlRuntime } from '../src/data/control-runtime';
import '../src/components/nodel-shortcut';

describe('nodel-shortcut', () => {
  const action = vi.fn();
  let actionResultFor: (name: string) => Promise<unknown> = () => Promise.resolve();
  let restore: (() => void) | undefined;

  beforeEach(() => {
    action.mockReset().mockResolvedValue({});
    actionResultFor = () => Promise.resolve();
    restore = installControlRuntime({
      callAction: (name, payload) => {
        action(name, payload);
        return actionResultFor(name);
      },
      subscribeSignals: () => ({ dispose() {} })
    });
    document.body.innerHTML = '';
  });

  afterEach(() => restore?.());

  it('executes ordered trigger actions with strict typed payload and detail', async () => {
    document.body.innerHTML = '<nodel-app><nodel-shortcut key="R" actions="First;Second:trigger" arg="42" arg-type="number"></nodel-shortcut></nodel-app>';
    const shortcut = document.querySelector<HTMLElement>('nodel-shortcut')!;
    const submitted = vi.fn();
    shortcut.addEventListener('nodel-shortcut-submitted', submitted);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', cancelable: true }));
    await waitFor(() => action.mock.calls.length === 2);
    expect(action.mock.calls).toEqual([['First', { arg: 42 }], ['Second', { arg: 42 }]]);
    expect(submitted.mock.calls[0]?.[0].detail).toEqual(expect.objectContaining({ phase: 'trigger', committed: true, live: false, key: 'R' }));
  });

  it('starts singleflight before confirmation and restores the prior focus', async () => {
    document.body.innerHTML = '<input id="focus"><nodel-app><nodel-shortcut key="C" action="Run" confirm></nodel-shortcut></nodel-app>';
    const input = document.querySelector<HTMLInputElement>('#focus')!;
    input.focus();
    const shortcut = document.querySelector<HTMLElement>('nodel-shortcut')!;
    let resolve!: (value: boolean) => void;
    shortcut.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      resolve = (event as CustomEvent<{ resolve: (value: boolean) => void }>).detail.resolve;
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', cancelable: true }));
    await flush();
    expect(action).not.toHaveBeenCalled();
    resolve(true);
    await waitFor(() => action.mock.calls.length === 1);
    await flush();
    expect(document.activeElement).toBe(input);
  });

  it('is DOM-free, nonfocusable, and dynamically invalidates declarations', () => {
    document.body.innerHTML = '<nodel-app><nodel-shortcut key="X" action="Run"></nodel-shortcut></nodel-app>';
    const shortcut = document.querySelector<HTMLElement>('nodel-shortcut')!;
    expect(shortcut.childNodes).toHaveLength(0);
    expect(shortcut.hasAttribute('hidden')).toBe(false);
    expect(shortcut.getAttribute('role')).toBeNull();
    expect(shortcut.getAttribute('tabindex')).toBeNull();
    shortcut.setAttribute('actions', 'Run:other');
    const event = new KeyboardEvent('keydown', { key: 'X', cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(shortcut.dataset.state).toBe('invalid');
  });

  it('reports strict payload failures, backend failures, formatted multi-action failures, and toasts', async () => {
    document.body.innerHTML = '<nodel-app><nodel-shortcut id="bad-payload" key="P" action="Run" arg="no" arg-type="number"></nodel-shortcut><nodel-shortcut id="failed" key="F" actions="First;Second" label="labelled sequence"></nodel-shortcut></nodel-app>';
    const payloadError = vi.fn();
    const toast = vi.fn();
    const failed = document.querySelector<HTMLElement>('#bad-payload')!;
    failed.addEventListener('nodel-shortcut-error', payloadError);
    failed.addEventListener('nodel-toast', toast);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', cancelable: true }));
    await flush();
    expect(payloadError.mock.calls[0]?.[0].detail).toEqual(expect.objectContaining({ key: 'P', error: 'Invalid number argument: no' }));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]?.[0].detail.message).toBe('Failed to run Run');

    actionResultFor = (name) => Promise.reject(new Error(`${name} failed`));
    const failedActions = document.querySelector<HTMLElement>('#failed')!;
    const actionError = vi.fn();
    failedActions.addEventListener('nodel-shortcut-error', actionError);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', cancelable: true }));
    await waitFor(() => actionError.mock.calls.length === 1);
    expect(actionError.mock.calls[0]?.[0].detail.error).toBe('First: First failed; Second: Second failed');
    expect(actionError.mock.calls[0]?.[0].detail.key).toBe('F');
    const failedToast = vi.fn();
    failedActions.addEventListener('nodel-toast', failedToast);
    action.mockClear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', cancelable: true }));
    await waitFor(() => failedToast.mock.calls.length === 1);
    expect(failedToast.mock.calls[0]?.[0].detail.message).toBe('Failed to run labelled sequence');
  });

  it('cancels stale confirmation and action work across disconnect/reconnect', async () => {
    document.body.innerHTML = '<nodel-app><nodel-shortcut key="D" action="Run" confirm></nodel-shortcut></nodel-app>';
    const shortcut = document.querySelector<HTMLElement>('nodel-shortcut')!;
    let resolve!: (value: boolean) => void;
    shortcut.addEventListener('nodel-confirm', (event) => {
      event.preventDefault();
      resolve = (event as CustomEvent<{ resolve: (value: boolean) => void }>).detail.resolve;
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', cancelable: true }));
    await flush();
    shortcut.remove();
    resolve(true);
    await flush();
    expect(action).not.toHaveBeenCalled();
    document.querySelector('nodel-app')!.append(shortcut);
    await flush();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', cancelable: true }));
    await flush();
    expect(action).not.toHaveBeenCalled();
  });

  it('does not execute after confirmation cancel or code rejection', async () => {
    document.body.innerHTML = '<nodel-app><nodel-shortcut id="cancel" key="C" action="Cancel" confirm></nodel-shortcut><nodel-shortcut id="code" key="D" action="Code" confirm-mode="code"></nodel-shortcut></nodel-app>';
    const resolveConfirmations: Array<(value: boolean) => void> = [];
    document.querySelectorAll<HTMLElement>('nodel-shortcut').forEach((shortcut) => {
      shortcut.addEventListener('nodel-confirm', (event) => {
        event.preventDefault();
        resolveConfirmations.push((event as CustomEvent<{ resolve: (value: boolean) => void }>).detail.resolve);
      });
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'C', cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', cancelable: true }));
    await flush();
    resolveConfirmations.forEach((resolve) => resolve(false));
    await flush();
    expect(action).not.toHaveBeenCalled();
  });

  it('continues matching while the browser reports offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    document.body.innerHTML = '<nodel-app><nodel-shortcut key="O" action="OnlineIndependent"></nodel-shortcut></nodel-app>';
    const event = new KeyboardEvent('keydown', { key: 'O', cancelable: true });
    window.dispatchEvent(event);
    await waitFor(() => action.mock.calls.length === 1);
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ['alt', { altKey: true }], ['shift', { shiftKey: true }], ['meta', { metaKey: true }]
  ])('supports a positive %s chord', async (modifierName, modifier) => {
    document.body.innerHTML = `<nodel-app><nodel-shortcut key="Z" ${modifierName} action="Run"></nodel-shortcut></nodel-app>`;
    const event = new KeyboardEvent('keydown', { key: 'Z', ...(modifier as KeyboardEventInit), cancelable: true });
    window.dispatchEvent(event);
    await waitFor(() => action.mock.calls.length === 1);
    expect(event.defaultPrevented).toBe(true);
  });
});
