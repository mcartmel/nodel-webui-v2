import { waitFor } from './helpers';

const consoleSourceMock = vi.hoisted(() => ({
  getNodeConsoleLogs: vi.fn()
}));

vi.mock('../src/api/nodel-host-client', () => ({
  getNodeConsoleLogs: consoleSourceMock.getNodeConsoleLogs
}));

import { refreshNodeConsole, resetNodeConsoleCursor, subscribeNodeConsole } from '../src/data/node-console-source';

describe('node console source lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    consoleSourceMock.getNodeConsoleLogs.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function host() {
    const element = document.createElement('div');
    document.body.append(element);
    return element;
  }

  it('resets its cursor for a fresh subscriber and rejects stale cursor advancement', async () => {
    let resolveStale!: (entries: Array<{ seq: number; timestamp: string; console: 'out'; comment: string }>) => void;
    consoleSourceMock.getNodeConsoleLogs
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveStale = resolve;
      }))
      .mockResolvedValueOnce([{ seq: 1, timestamp: '2026-01-01T00:00:01Z', console: 'out', comment: 'current' }])
      .mockResolvedValueOnce([]);
    const first = subscribeNodeConsole(host(), () => undefined);
    await waitFor(() => consoleSourceMock.getNodeConsoleLogs.mock.calls.length === 1);
    first.dispose();

    const states: unknown[] = [];
    const second = subscribeNodeConsole(host(), (state) => states.push(state));
    await waitFor(() => consoleSourceMock.getNodeConsoleLogs.mock.calls.length === 2);
    await waitFor(() => states.some((state: any) => state.data?.entries?.[0]?.comment === 'current'));
    expect(consoleSourceMock.getNodeConsoleLogs.mock.calls[1][0]).toEqual({ from: -1, max: 200 });

    resolveStale([{ seq: 100, timestamp: '2026-01-01T00:01:40Z', console: 'out', comment: 'stale' }]);
    await Promise.resolve();
    await Promise.resolve();
    await second.refresh();
    expect(consoleSourceMock.getNodeConsoleLogs.mock.calls.at(-1)?.[0]).toEqual({ from: 2, max: 9999 });
    expect(states.some((state: any) => state.data?.entries?.some((entry: any) => entry.comment === 'stale'))).toBe(false);

    second.dispose();
  });

  it('keeps a restart cursor reset when an incremental request resolves late', async () => {
    let resolveIncremental!: (entries: Array<{ seq: number; timestamp: string; console: 'out'; comment: string }>) => void;
    consoleSourceMock.getNodeConsoleLogs
      .mockResolvedValueOnce([{ seq: 5, timestamp: '2026-01-01T00:00:05Z', console: 'out', comment: 'before restart' }])
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveIncremental = resolve;
      }))
      .mockResolvedValueOnce([{ seq: 1, timestamp: '2026-01-01T00:00:01Z', console: 'out', comment: 'after restart' }]);
    const states: unknown[] = [];
    const subscription = subscribeNodeConsole(host(), (state) => states.push(state));
    await waitFor(() => states.some((state: any) => state.data?.entries?.[0]?.comment === 'before restart'));
    const incremental = subscription.refresh();
    await waitFor(() => consoleSourceMock.getNodeConsoleLogs.mock.calls.length === 2);

    resetNodeConsoleCursor();
    const restartRefresh = refreshNodeConsole();
    resolveIncremental([{ seq: 6, timestamp: '2026-01-01T00:00:06Z', console: 'out', comment: 'stale incremental' }]);
    await incremental;
    await restartRefresh;
    await waitFor(() => consoleSourceMock.getNodeConsoleLogs.mock.calls.length === 3);
    await waitFor(() => states.some((state: any) => state.data?.entries?.[0]?.comment === 'after restart'));

    expect(consoleSourceMock.getNodeConsoleLogs.mock.calls[2][0]).toEqual({ from: -1, max: 200 });
    expect(states.some((state: any) => state.data?.entries?.some((entry: any) => entry.comment === 'stale incremental'))).toBe(false);
    subscription.dispose();
  });
});
