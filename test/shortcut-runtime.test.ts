import { flush, waitFor } from './helpers';
const calls = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock('../src/api/nodel-host-client', () => ({ callNodeAction: calls.action }));

import '../src/components/nodel-shortcut';
import { dispatchControlActionError } from '../src/data/control-actions';

describe('shortcut runtime', () => {
  beforeEach(() => {
    calls.action.mockReset().mockResolvedValue({});
    document.body.innerHTML = '';
  });

  it('claims exact unique chords and leaves unmatched events alone', async () => {
    document.body.innerHTML = '<nodel-app><nodel-shortcut id="one" key="K" action="Run"></nodel-shortcut></nodel-app>';
    const event = new KeyboardEvent('keydown', { key: 'K', cancelable: true, bubbles: true });
    window.dispatchEvent(event);
    await waitFor(() => calls.action.mock.calls.length === 1);
    expect(event.defaultPrevented).toBe(true);
    expect(calls.action).toHaveBeenCalledWith('Run', {}, expect.anything());

    const unmatched = new KeyboardEvent('keydown', { key: 'k', cancelable: true });
    window.dispatchEvent(unmatched);
    expect(unmatched.defaultPrevented).toBe(false);
  });

  it('matches literal spaces, modifiers and repeats without rerunning', async () => {
    document.body.innerHTML = '<nodel-app><nodel-shortcut key=" " ctrl action="Run"></nodel-shortcut></nodel-app>';
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, cancelable: true }));
    await waitFor(() => calls.action.mock.calls.length === 1);
    const repeat = new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, repeat: true, cancelable: true });
    window.dispatchEvent(repeat);
    await flush();
    expect(repeat.defaultPrevented).toBe(true);
    expect(calls.action).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['plain', {}, false], ['ctrl', { ctrlKey: true }, true], ['alt', { altKey: true }, false],
    ['shift', { shiftKey: true }, false], ['meta', { metaKey: true }, false],
    ['missing', { ctrlKey: false }, false], ['extra', { ctrlKey: true, shiftKey: true }, false]
  ])('requires exact modifier presence: %s', async (_name, modifiers, expected) => {
    document.body.innerHTML = '<nodel-app><nodel-shortcut key="M" ctrl action="Run"></nodel-shortcut></nodel-app>';
    const event = new KeyboardEvent('keydown', { key: 'M', ...(modifiers as KeyboardEventInit), cancelable: true });
    window.dispatchEvent(event);
    await flush();
    expect(event.defaultPrevented).toBe(expected);
    expect(calls.action).toHaveBeenCalledTimes(expected ? 1 : 0);
  });

  it('captures before document handlers and ignores focus, inert, modal, and defaultPrevented state', async () => {
    document.body.innerHTML = '<nodel-app><div inert><dialog open><input id="field"><div contenteditable class="cm-editor"></div></dialog></div><nodel-shortcut key="Escape" action="Run"></nodel-shortcut></nodel-app>';
    const documentHandler = vi.fn();
    document.addEventListener('keydown', documentHandler);
    const field = document.querySelector<HTMLInputElement>('#field')!;
    field.focus();
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    await waitFor(() => calls.action.mock.calls.length === 1);
    expect(documentHandler).not.toHaveBeenCalled();
    document.removeEventListener('keydown', documentHandler);
  });

  it.each(['input', 'textarea', '[contenteditable]', '.cm-editor'])('does not filter focused target %s', async (selector) => {
    const targetMarkup = selector === 'input' ? '<input id="target">'
      : selector === 'textarea' ? '<textarea id="target"></textarea>'
        : selector === '[contenteditable]' ? '<div id="target" contenteditable></div>'
          : '<div id="target" class="cm-editor"></div>';
    document.body.innerHTML = `<nodel-app>${targetMarkup}<nodel-shortcut key="T" action="Run"></nodel-shortcut></nodel-app>`;
    const target = document.querySelector<HTMLElement>('#target')!;
    target.focus();
    const event = new KeyboardEvent('keydown', { key: 'T', bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    await waitFor(() => calls.action.mock.calls.length === 1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('fails closed for duplicate chords across apps and reports document order', () => {
    document.body.innerHTML = '<nodel-app><nodel-shortcut id="first" key="F2" action="A"></nodel-shortcut></nodel-app><nodel-app><nodel-shortcut id="second" key="F2" action="B"></nodel-shortcut></nodel-app>';
    const conflict = vi.fn();
    document.querySelector('#first')?.addEventListener('nodel-shortcut-conflict', conflict);
    const event = new KeyboardEvent('keydown', { key: 'F2', cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(calls.action).not.toHaveBeenCalled();
    expect(conflict).toHaveBeenCalledTimes(1);
    expect(conflict.mock.calls[0]?.[0].detail).toEqual(expect.objectContaining({ key: 'F2', count: 2, ids: ['first', 'second'] }));
  });

  it('does not claim invalid placement, disabled or hidden declarations', () => {
    document.body.innerHTML = '<nodel-shortcut key="F2" action="Bad"></nodel-shortcut><nodel-app><nodel-shortcut key="F3" action="No" disabled></nodel-shortcut><nodel-shortcut key="F4" action="Hidden" hidden></nodel-shortcut></nodel-app>';
    for (const key of ['F2', 'F3', 'F4']) {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('registers after connected reparenting into a direct app child', async () => {
    document.body.innerHTML = '<nodel-app><div id="nested"><nodel-shortcut key="F5" action="Moved"></nodel-shortcut></div></nodel-app>';
    const app = document.querySelector('nodel-app')!;
    const shortcut = document.querySelector('nodel-shortcut')!;
    const nestedEvent = new KeyboardEvent('keydown', { key: 'F5', cancelable: true });
    window.dispatchEvent(nestedEvent);
    expect(nestedEvent.defaultPrevented).toBe(false);

    app.append(shortcut);
    const directEvent = new KeyboardEvent('keydown', { key: 'F5', cancelable: true });
    window.dispatchEvent(directEvent);
    await waitFor(() => calls.action.mock.calls.length === 1);
    expect(directEvent.defaultPrevented).toBe(true);
    expect(calls.action).toHaveBeenCalledWith('Moved', {}, expect.anything());
  });

  it('applies dynamic key, modifier, action, hidden, disabled, and parent changes', async () => {
    const app = document.createElement('nodel-app');
    const shortcut = document.createElement('nodel-shortcut');
    shortcut.setAttribute('key', 'A');
    shortcut.setAttribute('action', 'Run');
    app.append(shortcut);
    document.body.append(app);
    shortcut.setAttribute('key', 'B');
    shortcut.setAttribute('ctrl', '');
    let event = new KeyboardEvent('keydown', { key: 'B', cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    event = new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    await waitFor(() => calls.action.mock.calls.length === 1);
    shortcut.setAttribute('disabled', '');
    event = new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    shortcut.removeAttribute('disabled');
    app.hidden = true;
    event = new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    app.hidden = false;
    shortcut.remove();
    const outside = new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, cancelable: true });
    window.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false);
    app.append(shortcut);
    await flush();
    shortcut.setAttribute('actions', 'Other:bad');
    const invalid = new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, cancelable: true });
    window.dispatchEvent(invalid);
    expect(invalid.defaultPrevented).toBe(false);
  });

  it('bounds document-order, eligibility, activation, and listener failures', async () => {
    const errors = vi.fn();
    window.addEventListener('nodel-shortcut-listener-error', errors);
    document.body.innerHTML = '<nodel-app><nodel-shortcut id="broken" key="Q" action="Broken"></nodel-shortcut><nodel-shortcut key="Q" action="Later"></nodel-shortcut></nodel-app>';
    const broken = document.querySelector<HTMLElement>('#broken')!;
    const other = document.querySelector<HTMLElement>('nodel-shortcut:not(#broken)')!;
    vi.spyOn(broken, 'compareDocumentPosition').mockImplementation(() => { throw new Error('sort failed'); });
    vi.spyOn(other, 'compareDocumentPosition').mockImplementation(() => { throw new Error('sort failed'); });
    const first = new KeyboardEvent('keydown', { key: 'Q', cancelable: true });
    window.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(calls.action).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
    broken.remove();
    const later = new KeyboardEvent('keydown', { key: 'Q', cancelable: true });
    window.dispatchEvent(later);
    await waitFor(() => calls.action.mock.calls.length === 1);
    window.removeEventListener('nodel-shortcut-listener-error', errors);
  });

  it('bounds listener installation/removal failures and retries consistently', async () => {
    const errors = vi.fn();
    window.addEventListener('nodel-shortcut-listener-error', errors);
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    add.mockImplementationOnce(() => { throw new Error('add failed'); });
    const app = document.createElement('nodel-app');
    const shortcut = document.createElement('nodel-shortcut');
    shortcut.setAttribute('key', 'L');
    shortcut.setAttribute('action', 'Run');
    app.append(shortcut);
    document.body.append(app);
    expect(errors).toHaveBeenCalled();
    const second = document.createElement('nodel-shortcut');
    second.setAttribute('key', 'N');
    second.setAttribute('action', 'Run');
    app.append(second);
    remove.mockImplementationOnce(() => { throw new Error('remove failed'); });
    shortcut.remove();
    second.remove();
    const sources = errors.mock.calls.map((call) => (call[0] as CustomEvent<{ source: string }>).detail.source);
    expect(sources).toEqual(expect.arrayContaining([
      'shortcut-runtime:add-listener', 'shortcut-runtime:remove-listener'
    ]));
    await flush();
    add.mockRestore();
    remove.mockRestore();
    window.removeEventListener('nodel-shortcut-listener-error', errors);
  });

  it('preserves canonical control error fields when adding shortcut metadata', () => {
    const host = document.createElement('div');
    const received = vi.fn();
    host.addEventListener('error', received);
    dispatchControlActionError(host, {
      eventName: 'error', action: 'Canonical', phase: 'trigger', payload: {}, extra: {
        action: 'overwrite', phase: 'overwrite', payload: 'overwrite', key: 'K'
      }
    });
    const detail = (received.mock.calls[0]?.[0] as CustomEvent).detail;
    expect(detail).toMatchObject({ action: 'Canonical', phase: 'trigger', payload: {}, key: 'K' });
  });

  it('uses one window listener and cleans it up with the last shortcut', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const app = document.createElement('nodel-app');
    const shortcut = document.createElement('nodel-shortcut');
    shortcut.setAttribute('key', 'X');
    shortcut.setAttribute('action', 'Run');
    app.append(shortcut);
    document.body.append(app);
    expect(add.mock.calls.filter(([name, , capture]) => name === 'keydown' && capture === true)).toHaveLength(1);
    shortcut.remove();
    expect(remove.mock.calls.filter(([name, , capture]) => name === 'keydown' && capture === true)).toHaveLength(1);
    add.mockRestore();
    remove.mockRestore();
  });

  it('recovers from a transient last-listener removal failure in one microtask', async () => {
    const app = document.createElement('nodel-app');
    const shortcut = document.createElement('nodel-shortcut');
    shortcut.setAttribute('key', 'R');
    shortcut.setAttribute('action', 'Run');
    app.append(shortcut);
    document.body.append(app);
    const remove = vi.spyOn(window, 'removeEventListener');
    remove.mockImplementationOnce(() => { throw new Error('transient remove'); });
    shortcut.remove();
    expect(remove).toHaveBeenCalledTimes(1);
    await flush();
    expect(remove).toHaveBeenCalledTimes(2);
    remove.mockRestore();
  });

  it('does not loop after repeated removal failures and retries on a later lifecycle', async () => {
    const app = document.createElement('nodel-app');
    const shortcut = document.createElement('nodel-shortcut');
    shortcut.setAttribute('key', 'S');
    shortcut.setAttribute('action', 'Run');
    app.append(shortcut);
    document.body.append(app);
    const remove = vi.spyOn(window, 'removeEventListener').mockImplementation(() => { throw new Error('persistent remove'); });
    shortcut.remove();
    await flush();
    expect(remove).toHaveBeenCalledTimes(2);
    await flush();
    expect(remove).toHaveBeenCalledTimes(2);
    remove.mockRestore();

    const laterRemove = vi.spyOn(window, 'removeEventListener');
    const replacement = document.createElement('nodel-shortcut');
    replacement.setAttribute('key', 'S');
    replacement.setAttribute('action', 'Run');
    app.append(replacement);
    replacement.remove();
    expect(laterRemove).toHaveBeenCalledTimes(1);
    laterRemove.mockRestore();
  });

  it('keeps the needed listener when a shortcut registers before the retry', async () => {
    const app = document.createElement('nodel-app');
    const first = document.createElement('nodel-shortcut');
    first.setAttribute('key', 'A');
    first.setAttribute('action', 'Run');
    app.append(first);
    document.body.append(app);
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    remove.mockImplementationOnce(() => { throw new Error('deferred remove'); });
    first.remove();
    const second = document.createElement('nodel-shortcut');
    second.setAttribute('key', 'B');
    second.setAttribute('action', 'Run');
    app.append(second);
    await flush();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(add.mock.calls.filter(([name]) => name === 'keydown')).toHaveLength(0);
    second.remove();
    expect(remove).toHaveBeenCalledTimes(2);
    add.mockRestore();
    remove.mockRestore();
  });

  it('retries a failed listener add once, cancels on unregister, and handles a later registration', async () => {
    const app = document.createElement('nodel-app');
    const add = vi.spyOn(window, 'addEventListener');
    add.mockImplementationOnce(() => { throw new Error('transient add'); });
    const first = document.createElement('nodel-shortcut');
    first.setAttribute('key', 'T');
    first.setAttribute('action', 'Run');
    app.append(first);
    document.body.append(app);
    first.remove();
    await flush();
    expect(add.mock.calls.filter(([name]) => name === 'keydown')).toHaveLength(1);

    const persistentAdd = vi.spyOn(window, 'addEventListener').mockImplementation(() => { throw new Error('persistent add'); });
    const second = document.createElement('nodel-shortcut');
    second.setAttribute('key', 'U');
    second.setAttribute('action', 'Run');
    app.append(second);
    await flush();
    const attempts = persistentAdd.mock.calls.filter(([name]) => name === 'keydown').length;
    await flush();
    expect(persistentAdd.mock.calls.filter(([name]) => name === 'keydown')).toHaveLength(attempts);
    persistentAdd.mockRestore();
    add.mockRestore();
    second.remove();
  });

  it('recovers a lone shortcut after a transient add failure and consumes its keydown', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    add.mockImplementationOnce(() => { throw new Error('transient add'); });
    const app = document.createElement('nodel-app');
    const shortcut = document.createElement('nodel-shortcut');
    shortcut.setAttribute('key', 'Y');
    shortcut.setAttribute('action', 'Run');
    app.append(shortcut);
    document.body.append(app);
    await flush();
    const event = new KeyboardEvent('keydown', { key: 'Y', cancelable: true });
    window.dispatchEvent(event);
    await waitFor(() => calls.action.mock.calls.length === 1);
    expect(event.defaultPrevented).toBe(true);
    add.mockRestore();
  });
});
