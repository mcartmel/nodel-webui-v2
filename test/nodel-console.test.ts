const consoleMock = vi.hoisted(() => ({
  dispose: vi.fn(),
  listeners: [] as Array<(state: unknown) => void>,
  execute: vi.fn(async (command?: string, init?: RequestInit) => {
    void command;
    void init;
    return {};
  }),
  refresh: vi.fn(async () => undefined)
}));

vi.mock('../src/data/node-console-source', () => ({
  refreshNodeConsole: consoleMock.refresh,
  subscribeNodeConsole: vi.fn((_element: HTMLElement, listener: (state: unknown) => void) => {
    consoleMock.listeners.push(listener);
    return { dispose: consoleMock.dispose, refresh: vi.fn(), getState: vi.fn() };
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
    consoleMock.dispose.mockClear();
    consoleMock.listeners = [];
    consoleMock.execute.mockClear();
    consoleMock.execute.mockResolvedValue({});
    consoleMock.refresh.mockClear();
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
    expect(document.querySelector('.nodel-console')?.classList.contains('space-y-3')).toBe(false);
    expect(document.querySelector('.nodel-console')?.classList.contains('gap-3')).toBe(true);
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

    expect(consoleMock.execute).toHaveBeenCalledWith('print("hello")', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(input!.value).toBe('');

    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await flush();
    expect(input!.value).toBe('print("hello")');

    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flush();
    expect(input!.value).toBe('');
  });

  it('keeps execution controls available when console history is unavailable', async () => {
    document.body.innerHTML = '<nodel-console></nodel-console>';
    await customElements.whenDefined('nodel-console');
    await waitFor(() => consoleMock.listeners.length === 1);

    const input = document.querySelector<HTMLInputElement>('[data-console-input]');
    expect(input).toBeTruthy();

    consoleMock.listeners[0]?.({
      loading: false,
      active: false,
      error: 'Console history unavailable',
      data: undefined
    });
    await flush();

    expect(document.querySelector('[data-console-input]')).toBe(input);
    expect(document.querySelector('nodel-console')?.getAttribute('data-state')).toBe('error');
    expect(document.querySelector('[data-console-status]')?.textContent).toContain('Console history unavailable');

    input!.value = 'print("still available")';
    input!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(consoleMock.execute).toHaveBeenCalledWith('print("still available")', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('disposes and reconnects once while preserving per-instance command history', async () => {
    const console = document.createElement('nodel-console');
    document.body.append(console);
    await customElements.whenDefined('nodel-console');
    await waitFor(() => consoleMock.listeners.length === 1);

    const firstInput = console.querySelector<HTMLInputElement>('[data-console-input]')!;
    firstInput.value = 'first command';
    firstInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();
    firstInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(consoleMock.execute).toHaveBeenCalledTimes(1);

    console.remove();
    await flush();
    expect(consoleMock.dispose).toHaveBeenCalledOnce();

    document.body.append(console);
    await waitFor(() => consoleMock.listeners.length === 2);
    const reconnectedInput = console.querySelector<HTMLInputElement>('[data-console-input]')!;
    const oldListener = consoleMock.listeners[0]!;
    const currentListener = consoleMock.listeners[1]!;

    currentListener({
      loading: false,
      active: true,
      error: '',
      data: { entries: [{ seq: 10, timestamp: '', console: 'out', comment: 'Current first' }], replace: true, nextSeq: 11 }
    });
    await flush();
    oldListener({
      loading: false,
      active: true,
      error: '',
      data: { entries: [{ seq: 99, timestamp: '', console: 'out', comment: 'Stale' }], replace: true, nextSeq: 12 }
    });
    await flush();
    currentListener({
      loading: false,
      active: true,
      error: '',
      data: { entries: [{ seq: 11, timestamp: '', console: 'out', comment: 'Current second' }], replace: false, nextSeq: 12 }
    });
    await flush();

    expect(reconnectedInput).toBeTruthy();
    expect(console.textContent).toContain('Current first');
    expect(console.textContent).toContain('Current second');
    expect(console.textContent).not.toContain('Stale');
    reconnectedInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await flush();

    expect(reconnectedInput.value).toBe('first command');
    expect(consoleMock.execute).toHaveBeenCalledTimes(1);

    console.remove();
    await flush();
    const freshConsole = document.createElement('nodel-console');
    document.body.append(freshConsole);
    await waitFor(() => consoleMock.listeners.length === 3);
    const freshInput = freshConsole.querySelector<HTMLInputElement>('[data-console-input]')!;
    freshInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await flush();

    expect(freshInput.value).toBe('');
    expect(consoleMock.dispose).toHaveBeenCalledTimes(2);
  });

  it('ignores a disposed source callback while a fresh console receives one current subscription', async () => {
    const oldConsole = document.createElement('nodel-console');
    document.body.append(oldConsole);
    await waitFor(() => consoleMock.listeners.length === 1);
    oldConsole.remove();

    const freshConsole = document.createElement('nodel-console');
    document.body.append(freshConsole);
    await waitFor(() => consoleMock.listeners.length === 2);
    consoleMock.listeners[0]?.({
      loading: false,
      active: true,
      error: '',
      data: { entries: [{ seq: 100, timestamp: '', console: 'out', comment: 'Stale' }], replace: true, nextSeq: 101 }
    });
    consoleMock.listeners[1]?.({
      loading: false,
      active: true,
      error: '',
      data: { entries: [{ seq: 1, timestamp: '', console: 'out', comment: 'Current' }], replace: true, nextSeq: 2 }
    });
    await flush();

    expect(consoleMock.dispose).toHaveBeenCalledOnce();
    expect(oldConsole.textContent).not.toContain('Stale');
    expect(freshConsole.textContent).toContain('Current');
    expect(freshConsole.textContent).not.toContain('Stale');
  });

  it('aborts pending commands on disconnect and renders current command failures', async () => {
    let rejectCommand!: (error: Error) => void;
    consoleMock.execute.mockImplementationOnce((command?: string, init?: RequestInit) => new Promise((_, reject) => {
      void command;
      rejectCommand = reject;
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const console = document.createElement('nodel-console');
    document.body.append(console);
    await waitFor(() => consoleMock.listeners.length === 1);
    const input = console.querySelector<HTMLInputElement>('[data-console-input]')!;
    input.value = 'pending()';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => consoleMock.execute.mock.calls.length === 1);

    const signal = consoleMock.execute.mock.calls[0]?.[1]?.signal as AbortSignal;
    console.remove();
    expect(signal.aborted).toBe(true);
    await flush();
    expect(consoleMock.refresh).not.toHaveBeenCalled();

    document.body.append(console);
    await waitFor(() => consoleMock.listeners.length === 2);
    consoleMock.execute.mockRejectedValueOnce(new Error('Command failed'));
    const reconnectedInput = console.querySelector<HTMLInputElement>('[data-console-input]')!;
    reconnectedInput.value = 'fail()';
    reconnectedInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();
    reconnectedInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => console.getAttribute('data-state') === 'error');

    expect(console.getAttribute('title')).toContain('Command failed');
    expect(console.querySelector('[data-console-status]')?.textContent).toContain('Command failed');
    consoleMock.listeners[1]?.({ loading: false, active: true, error: '', data: undefined });
    await flush();
    expect(console.querySelector('[data-console-status]')?.textContent).toContain('Command failed');
    expect(consoleMock.refresh).not.toHaveBeenCalled();
    rejectCommand(new Error('late failure'));
  });

  it('keeps the newest command result when commands complete out of order', async () => {
    let resolveFirst!: (value: {}) => void;
    let rejectSecond!: (error: Error) => void;
    consoleMock.execute
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectSecond = reject;
      }));
    document.body.innerHTML = '<nodel-console></nodel-console>';
    await waitFor(() => consoleMock.listeners.length === 1);
    const input = document.querySelector<HTMLInputElement>('[data-console-input]')!;
    input.value = 'first()';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.value = 'second()';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitFor(() => consoleMock.execute.mock.calls.length === 2);

    rejectSecond(new Error('Newest command failed'));
    await waitFor(() => document.querySelector('[data-console-status]')?.textContent?.includes('Newest command failed') ?? false);
    resolveFirst({});
    await flush();

    expect(document.querySelector('[data-console-status]')?.textContent).toContain('Newest command failed');
    expect(consoleMock.refresh).not.toHaveBeenCalled();
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
