const consoleMock = vi.hoisted(() => ({
  listeners: [] as Array<(state: unknown) => void>,
  execute: vi.fn(async () => ({}))
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

import '../src/components/nodel-console';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('nodel-console', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
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
    expect(document.querySelector('[data-console-output]')?.className).toContain('h-[14.4rem]');
    expect(document.querySelector('[data-console-status]')).toBeNull();
    expect(document.querySelector('nodel-console')?.getAttribute('data-state')).toBe('active');

    const input = document.querySelector<HTMLElement>('[data-console-input]');
    expect(input).toBeTruthy();
    input!.textContent = 'print("hello")';
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    expect(consoleMock.execute).toHaveBeenCalledWith('print("hello")');
    expect(input!.textContent).toBe('');
  });
});
