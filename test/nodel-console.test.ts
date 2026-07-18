const consoleMock = vi.hoisted(() => ({
  capabilitiesListeners: [] as Array<(state: unknown) => void>,
  listeners: [] as Array<(state: unknown) => void>,
  execute: vi.fn(async () => ({}))
}));

vi.mock('../src/data/host-capabilities-source', () => ({
  subscribeHostCapabilities: vi.fn((_element: HTMLElement, listener: (state: unknown) => void) => {
    consoleMock.capabilitiesListeners.push(listener);
    return { dispose: vi.fn(), refresh: vi.fn(), getState: vi.fn() };
  })
}));

vi.mock('../src/data/node-console-source', () => ({
  refreshNodeConsole: vi.fn(async () => undefined),
  subscribeNodeConsole: vi.fn((_element: HTMLElement, listener: (state: unknown) => void) => {
    consoleMock.listeners.push(listener);
    return { dispose: vi.fn(), refresh: vi.fn(), getState: vi.fn() };
  })
}));

vi.mock('../src/api/nodel-host-client', () => ({
  executeNodeConsoleCommand: consoleMock.execute
}));

import { flush, waitFor } from './helpers';
import '../src/components/nodel-console';

describe('nodel-console', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    consoleMock.capabilitiesListeners = [];
    consoleMock.listeners = [];
    consoleMock.execute.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders console output and executes entered commands', async () => {
    document.body.innerHTML = '<nodel-console></nodel-console>';
    await customElements.whenDefined('nodel-console');
    await waitFor(() => consoleMock.listeners.length === 1);
    const preview = vi.fn();
    document.querySelector('nodel-console')?.addEventListener('nodel-collapse-preview', preview);

    consoleMock.listeners[0]?.({
      loading: false,
      active: true,
      error: '',
      data: {
        entries: [
          { seq: 1, timestamp: '2026-01-01T00:00:00Z', console: 'out', comment: 'ready' },
          { seq: 2, timestamp: '2026-01-01T00:00:01Z', console: 'err', comment: 'bad <value>' }
        ],
        replace: true,
        nextSeq: 3
      }
    });

    expect(document.body.textContent).toContain('ready');
    expect(document.body.textContent).toContain('bad <value>');
    expect(document.body.textContent).not.toContain('Console');
    expect(document.body.innerHTML).toContain('bad &lt;value&gt;');
    expect(document.querySelector('[data-console-output]')?.classList.contains('nodel-console-output')).toBe(true);
    expect(document.querySelector('[data-console-status]')).toBeNull();
    expect(document.querySelector('nodel-console')?.getAttribute('data-state')).toBe('active');
    expect(preview).not.toHaveBeenCalled();

    const input = document.querySelector<HTMLInputElement>('[data-console-input]');
    expect(input).toBeTruthy();
    input!.value = 'print("hello")';
    input!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    expect(consoleMock.execute).toHaveBeenCalledWith('print("hello")');
    expect(input!.value).toBe('');

    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await flush();
    expect(input!.value).toBe('print("hello")');

    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flush();
    expect(input!.value).toBe('');
  });

  it('hides command input and disables execution when capabilities disable console execution', async () => {
    document.body.innerHTML = '<nodel-console></nodel-console>';
    await customElements.whenDefined('nodel-console');
    await waitFor(() => consoleMock.listeners.length === 1 && consoleMock.capabilitiesListeners.length === 1);

    const input = document.querySelector<HTMLInputElement>('[data-console-input]');
    expect(input).toBeTruthy();
    input!.value = 'print("blocked")';
    input!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();

    consoleMock.capabilitiesListeners[0]?.({
      loading: false,
      active: false,
      error: '',
      data: {
        schemaVersion: 1,
        apiVersion: '1.0',
        features: {
          consoleHistory: true,
          consoleExec: false
        }
      }
    });
    await flush();

    expect(document.querySelector('[data-console-input]')).toBeNull();

    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await flush();
    expect(consoleMock.execute).not.toHaveBeenCalled();

    consoleMock.listeners[0]?.({
      loading: false,
      active: true,
      error: '',
      data: {
        entries: [
          { seq: 1, timestamp: '2026-01-01T00:00:00Z', console: 'out', comment: 'history still loads' }
        ],
        replace: true,
        nextSeq: 2
      }
    });
    await flush();

    expect(document.body.textContent).toContain('history still loads');
  });

  it('renders an empty state only after successful empty console history loads', async () => {
    document.body.innerHTML = '<nodel-console></nodel-console>';
    await customElements.whenDefined('nodel-console');
    await waitFor(() => consoleMock.listeners.length === 1);

    expect(document.querySelector('.nodel-console-empty')).toBeNull();

    consoleMock.listeners[0]?.({
      loading: true,
      active: false,
      error: '',
      data: {
        entries: [],
        replace: true,
        nextSeq: 0
      }
    });

    expect(document.querySelector('.nodel-console-empty')).toBeNull();

    consoleMock.listeners[0]?.({
      loading: false,
      active: true,
      error: '',
      data: {
        entries: [],
        replace: true,
        nextSeq: 0
      }
    });

    expect(document.querySelector('.nodel-console-empty')?.textContent).toBe('No console output yet.');

    consoleMock.listeners[0]?.({
      loading: false,
      active: false,
      error: 'Console request failed',
      data: undefined
    });

    expect(document.querySelector('.nodel-console-empty')).toBeNull();
  });

  it('emits the latest console line as an opt-in collapse preview', async () => {
    document.body.innerHTML = '<nodel-console collapse-preview="last-line"></nodel-console>';
    await customElements.whenDefined('nodel-console');
    await waitFor(() => consoleMock.listeners.length === 1);

    const preview = vi.fn();
    document.querySelector('nodel-console')?.addEventListener('nodel-collapse-preview', preview);

    consoleMock.listeners[0]?.({
      loading: false,
      active: true,
      error: '',
      data: {
        entries: [
          { seq: 1, timestamp: '2026-01-01T00:00:00Z', console: 'out', comment: 'ready' },
          { seq: 2, timestamp: '2026-01-01T00:00:01Z', console: 'err', comment: 'bad <value>' }
        ],
        replace: true,
        nextSeq: 3
      }
    });
    await flush();

    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({
      detail: {
        source: 'console',
        text: expect.stringContaining('error: bad <value>')
      }
    }));

    consoleMock.listeners[0]?.({
      loading: false,
      active: true,
      error: '',
      data: {
        entries: [
          { seq: 3, timestamp: '2026-01-01T00:00:02Z', console: 'warn', comment: 'careful' }
        ],
        replace: false,
        nextSeq: 4
      }
    });
    await flush();

    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({
      detail: {
        source: 'console',
        text: expect.stringContaining('warn: careful')
      }
    }));
  });
});
