import { flushMicrotasks } from './helpers';

const restartMock = vi.hoisted(() => ({
  getNodeRestartStatus: vi.fn()
}));

vi.mock('../src/api/nodel-host-client', () => ({
  getNodeRestartStatus: restartMock.getNodeRestartStatus
}));

async function loadSource() {
  vi.resetModules();
  return import('../src/data/node-restart-source');
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value
  });
}

describe('node-restart-source', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(undefined, '', '/nodes/TestNode/nodel.html');
    setNavigatorOnline(true);
    restartMock.getNodeRestartStatus.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('captures the initial timestamp without notifying listeners', async () => {
    restartMock.getNodeRestartStatus.mockResolvedValue({ timestamp: 'start-1' });
    const { watchNodeRestart } = await loadSource();
    const listener = vi.fn();
    const watcher = watchNodeRestart(listener);

    await flushMicrotasks();

    expect(listener).not.toHaveBeenCalled();
    expect(restartMock.getNodeRestartStatus).toHaveBeenCalledWith(
      { timestamp: null, timeout: 0 },
      expect.any(Object)
    );

    watcher.dispose();
  });

  it('notifies listeners when the timestamp changes', async () => {
    restartMock.getNodeRestartStatus
      .mockResolvedValueOnce({ timestamp: 'start-1' })
      .mockResolvedValueOnce({ timestamp: 'start-2' });
    const { watchNodeRestart } = await loadSource();
    const listener = vi.fn();
    const watcher = watchNodeRestart(listener);

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5000);

    expect(listener).toHaveBeenCalledWith({
      previousTimestamp: 'start-1',
      timestamp: 'start-2'
    });
    expect(restartMock.getNodeRestartStatus).toHaveBeenLastCalledWith(
      { timestamp: 'start-1', timeout: 5000 },
      expect.any(Object)
    );

    watcher.dispose();
  });

  it('does not poll on non-node pages', async () => {
    window.history.replaceState(undefined, '', '/');
    const { watchNodeRestart } = await loadSource();
    const watcher = watchNodeRestart(vi.fn());

    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5000);

    expect(restartMock.getNodeRestartStatus).not.toHaveBeenCalled();

    watcher.dispose();
  });
});
