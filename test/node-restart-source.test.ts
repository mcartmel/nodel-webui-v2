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

  it('prepares, commits, and cancels a generation without losing a change before commit', async () => {
    const beforeCommit = deferred<{ timestamp: string | null }>();
    restartMock.getNodeRestartStatus
      .mockResolvedValueOnce({ timestamp: 'start-1' })
      .mockReturnValueOnce(beforeCommit.promise);
    const { NodeRestartExpectationCoordinator } = await loadSource();
    const coordinator = new NodeRestartExpectationCoordinator();
    const events: Array<{ type: string }> = [];
    const prepared = await coordinator.prepare();
    const watcher = coordinator.subscribe((event) => events.push({ type: event.type }));

    expect(prepared).toMatchObject({ baselineTimestamp: 'start-1' });
    expect(events).toEqual([]);
    beforeCommit.resolve({ timestamp: 'start-2' });
    await flushMicrotasks();
    const committed = coordinator.commit(prepared);

    expect(committed).toMatchObject({ state: 'refreshing' });
    expect(events.map((event) => event.type)).toEqual(['expected-pending', 'expected-confirmed']);

    coordinator.cancel(committed);
    watcher.dispose();
  });

  it('records a timestamp change after commit and supports a null baseline', async () => {
    restartMock.getNodeRestartStatus.mockResolvedValue({ timestamp: null });
    const { NodeRestartExpectationCoordinator, NODE_RESTART_EXPECTED_RETRY_DELAY_MS } = await loadSource();
    const coordinator = new NodeRestartExpectationCoordinator();
    const events: string[] = [];
    const prepared = await coordinator.prepare();
    const watcher = coordinator.subscribe((event) => events.push(event.type));
    coordinator.commit(prepared);

    restartMock.getNodeRestartStatus.mockResolvedValueOnce({ timestamp: 'start-1' });
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTED_RETRY_DELAY_MS);

    expect(events).toEqual(['expected-pending', 'expected-confirmed']);
    watcher.dispose();
  });

  it('does not confirm on repeated null status responses before one later timestamp', async () => {
    restartMock.getNodeRestartStatus
      .mockResolvedValueOnce({ timestamp: null })
      .mockResolvedValueOnce({ timestamp: null })
      .mockResolvedValueOnce({ timestamp: null })
      .mockResolvedValueOnce({ timestamp: 'start-1' });
    const { NodeRestartExpectationCoordinator, NODE_RESTART_EXPECTED_RETRY_DELAY_MS } = await loadSource();
    const coordinator = new NodeRestartExpectationCoordinator();
    const events: string[] = [];
    const prepared = await coordinator.prepare();
    const watcher = coordinator.subscribe((event) => events.push(event.type));
    coordinator.commit(prepared);

    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTED_RETRY_DELAY_MS * 3);

    expect(events.filter((event) => event === 'expected-confirmed')).toHaveLength(1);
    expect(coordinator.getExpectation()).toMatchObject({ state: 'refreshing', confirmedTimestamp: 'start-1' });
    watcher.dispose();
  });

  it('times out at exactly 30 seconds, retains pending state through transient errors, and recovers late', async () => {
    restartMock.getNodeRestartStatus
      .mockResolvedValueOnce({ timestamp: 'start-1' })
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValue({ timestamp: 'start-1' });
    const {
      NodeRestartExpectationCoordinator,
      NODE_RESTART_EXPECTATION_TIMEOUT_MS,
      NODE_RESTART_UNCONFIRMED_RETRY_DELAY_MS
    } = await loadSource();
    const coordinator = new NodeRestartExpectationCoordinator();
    const events: string[] = [];
    const prepared = await coordinator.prepare();
    const watcher = coordinator.subscribe((event) => events.push(event.type));
    await flushMicrotasks();
    coordinator.commit(prepared);

    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTATION_TIMEOUT_MS - 1);
    expect(events).not.toContain('expected-timeout');
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toContain('expected-timeout');
    expect(coordinator.getExpectation()).toMatchObject({ state: 'unconfirmed' });

    restartMock.getNodeRestartStatus.mockResolvedValueOnce({ timestamp: 'start-2' });
    await vi.advanceTimersByTimeAsync(NODE_RESTART_UNCONFIRMED_RETRY_DELAY_MS);
    expect(events).toContain('expected-confirmed');
    expect(coordinator.getExpectation()).toMatchObject({ state: 'refreshing', confirmedTimestamp: 'start-2' });
    watcher.dispose();
  });

  it('does not discard an existing expectation when a corrective baseline fails', async () => {
    restartMock.getNodeRestartStatus.mockResolvedValue({ timestamp: 'start-1' });
    const {
      NodeRestartExpectationCoordinator,
      NODE_RESTART_EXPECTATION_TIMEOUT_MS
    } = await loadSource();
    const coordinator = new NodeRestartExpectationCoordinator();
    const prepared = await coordinator.prepare();
    const watcher = coordinator.subscribe(vi.fn());
    const committed = coordinator.commit(prepared)!;
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTATION_TIMEOUT_MS);
    restartMock.getNodeRestartStatus.mockRejectedValueOnce(new Error('baseline unavailable'));

    await expect(coordinator.prepare()).rejects.toThrow('baseline unavailable');
    expect(coordinator.getExpectation()).toMatchObject({ id: committed.id, state: 'unconfirmed' });
    watcher.dispose();
  });

  it('reserves preparation synchronously so concurrent editors share one baseline request', async () => {
    const baseline = deferred<{ timestamp: string | null }>();
    restartMock.getNodeRestartStatus.mockReturnValueOnce(baseline.promise);
    const { NodeRestartExpectationCoordinator } = await loadSource();
    const coordinator = new NodeRestartExpectationCoordinator();

    const first = coordinator.prepare();
    expect(coordinator.getScriptWriteState()).toBe('preparing');
    await expect(coordinator.prepare()).rejects.toBeInstanceOf(Error);
    expect(restartMock.getNodeRestartStatus).toHaveBeenCalledTimes(1);
    baseline.resolve({ timestamp: 'start-1' });
    await expect(first).resolves.toMatchObject({ baselineTimestamp: 'start-1' });
  });

  it('abandons corrective preparation when the old unconfirmed expectation confirms during baseline capture', async () => {
    restartMock.getNodeRestartStatus.mockResolvedValue({ timestamp: 'start-1' });
    const {
      NodeRestartExpectationCoordinator,
      NODE_RESTART_EXPECTATION_TIMEOUT_MS,
      NODE_RESTART_UNCONFIRMED_RETRY_DELAY_MS
    } = await loadSource();
    const coordinator = new NodeRestartExpectationCoordinator();
    const first = await coordinator.prepare();
    const committed = coordinator.commit(first)!;
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTATION_TIMEOUT_MS);

    const baseline = deferred<{ timestamp: string | null }>();
    restartMock.getNodeRestartStatus.mockImplementation((options: { timestamp?: string | null }) => (
      options.timestamp === null ? baseline.promise : Promise.resolve({ timestamp: 'start-2' })
    ));
    const corrective = coordinator.prepare();
    await vi.advanceTimersByTimeAsync(NODE_RESTART_UNCONFIRMED_RETRY_DELAY_MS);
    expect(coordinator.getExpectation()).toMatchObject({ id: committed.id, state: 'refreshing' });
    baseline.resolve({ timestamp: 'start-1' });

    await expect(corrective).rejects.toBeInstanceOf(Error);
    expect(coordinator.getExpectation()).toMatchObject({ id: committed.id, state: 'refreshing' });
    expect(coordinator.getScriptWriteState()).toBe('refreshing');
    coordinator.cancel(coordinator.getExpectation());
  });

  it('rejects a prepared corrective write if the old expectation confirms before the save request', async () => {
    restartMock.getNodeRestartStatus.mockResolvedValue({ timestamp: 'start-1' });
    const { NodeRestartExpectationCoordinator, NODE_RESTART_EXPECTATION_TIMEOUT_MS } = await loadSource();
    const coordinator = new NodeRestartExpectationCoordinator();
    const first = await coordinator.prepare();
    const committed = coordinator.commit(first)!;
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTATION_TIMEOUT_MS);
    const corrective = await coordinator.prepare();

    (coordinator as any).recordTimestamp('start-2');

    expect(coordinator.getExpectation()).toMatchObject({ id: committed.id, state: 'refreshing' });
    expect(coordinator.isPreparedForWrite(corrective)).toBe(false);
    coordinator.cancel(corrective);
  });

  it('keeps an unconfirmed expectation active while a corrective preparation is canceled', async () => {
    restartMock.getNodeRestartStatus.mockResolvedValue({ timestamp: 'start-1' });
    const { NodeRestartExpectationCoordinator, NODE_RESTART_EXPECTATION_TIMEOUT_MS } = await loadSource();
    const coordinator = new NodeRestartExpectationCoordinator();
    const watcher = coordinator.subscribe(vi.fn());
    const first = await coordinator.prepare();
    const committed = coordinator.commit(first)!;
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTATION_TIMEOUT_MS);

    const corrective = await coordinator.prepare();
    expect(coordinator.getScriptWriteState()).toBe('preparing');
    expect(coordinator.getExpectation()).toMatchObject({ id: committed.id, state: 'unconfirmed' });
    coordinator.cancel(corrective);

    expect(coordinator.getScriptWriteState()).toBe('unconfirmed');
    expect(coordinator.getExpectation()).toMatchObject({ id: committed.id, state: 'unconfirmed' });
    watcher.dispose();
  });

  it('retains late recovery of the old expectation until corrective commit', async () => {
    const late = deferred<{ timestamp: string | null }>();
    restartMock.getNodeRestartStatus
      .mockResolvedValueOnce({ timestamp: 'start-1' })
      .mockResolvedValue({ timestamp: 'start-1' });
    const {
      NodeRestartExpectationCoordinator,
      NODE_RESTART_EXPECTATION_TIMEOUT_MS,
      NODE_RESTART_UNCONFIRMED_RETRY_DELAY_MS
    } = await loadSource();
    const coordinator = new NodeRestartExpectationCoordinator();
    const events: string[] = [];
    const watcher = coordinator.subscribe((event) => events.push(event.type));
    const first = await coordinator.prepare();
    const committed = coordinator.commit(first)!;
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTATION_TIMEOUT_MS);

    await vi.advanceTimersByTimeAsync(NODE_RESTART_UNCONFIRMED_RETRY_DELAY_MS);
    const corrective = await coordinator.prepare();
    restartMock.getNodeRestartStatus.mockReturnValueOnce(late.promise);
    await vi.advanceTimersByTimeAsync(NODE_RESTART_UNCONFIRMED_RETRY_DELAY_MS);
    late.resolve({ timestamp: 'start-2' });
    await flushMicrotasks();

    expect(events).toContain('expected-confirmed');
    expect(coordinator.getExpectation()).toMatchObject({ id: committed.id, state: 'refreshing' });
    coordinator.cancel(corrective);
    expect(coordinator.getExpectation()).toMatchObject({ id: committed.id, state: 'refreshing' });
    watcher.dispose();
  });

  it('retries expected polling promptly while offline and stops after disposal', async () => {
    const poll = deferred<{ timestamp: string | null }>();
    restartMock.getNodeRestartStatus
      .mockResolvedValueOnce({ timestamp: null })
      .mockReturnValueOnce(poll.promise);
    const {
      NodeRestartExpectationCoordinator,
      NODE_RESTART_OFFLINE_RETRY_DELAY_MS,
      NODE_RESTART_EXPECTED_RETRY_DELAY_MS
    } = await loadSource();
    const coordinator = new NodeRestartExpectationCoordinator();
    const listener = vi.fn();
    const prepared = await coordinator.prepare();
    const watcher = coordinator.subscribe(listener);
    coordinator.commit(prepared);

    setNavigatorOnline(false);
    poll.resolve({ timestamp: null });
    await flushMicrotasks();
    const callsAfterResponse = restartMock.getNodeRestartStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTED_RETRY_DELAY_MS);
    expect(restartMock.getNodeRestartStatus.mock.calls.length).toBe(callsAfterResponse);
    setNavigatorOnline(true);
    await vi.advanceTimersByTimeAsync(NODE_RESTART_OFFLINE_RETRY_DELAY_MS);
    expect(restartMock.getNodeRestartStatus.mock.calls.length).toBeGreaterThan(callsAfterResponse);

    coordinator.dispose();
    const callsAfterDispose = restartMock.getNodeRestartStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(NODE_RESTART_OFFLINE_RETRY_DELAY_MS * 2);
    expect(restartMock.getNodeRestartStatus.mock.calls.length).toBe(callsAfterDispose);
    watcher.dispose();
  });

  it('backs off consecutive expected polling failures and resets after success', async () => {
    restartMock.getNodeRestartStatus
      .mockResolvedValueOnce({ timestamp: 'start-1' })
      .mockRejectedValue(new Error('temporary failure'));
    const {
      NodeRestartExpectationCoordinator,
      NODE_RESTART_EXPECTED_RETRY_BACKOFF_INITIAL_MS,
      NODE_RESTART_EXPECTED_RETRY_BACKOFF_MAX_MS
    } = await loadSource();
    const coordinator = new NodeRestartExpectationCoordinator();
    const prepared = await coordinator.prepare();
    const watcher = coordinator.subscribe(vi.fn());
    coordinator.commit(prepared);
    await flushMicrotasks();

    const callsAfterFirstFailure = restartMock.getNodeRestartStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTED_RETRY_BACKOFF_INITIAL_MS - 1);
    expect(restartMock.getNodeRestartStatus.mock.calls.length).toBe(callsAfterFirstFailure);
    await vi.advanceTimersByTimeAsync(1);
    expect(restartMock.getNodeRestartStatus.mock.calls.length).toBe(callsAfterFirstFailure + 1);

    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTED_RETRY_BACKOFF_INITIAL_MS * 2);
    expect(restartMock.getNodeRestartStatus.mock.calls.length).toBe(callsAfterFirstFailure + 2);
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTED_RETRY_BACKOFF_MAX_MS * 3);
    expect(restartMock.getNodeRestartStatus.mock.calls.length).toBeLessThan(20);

    restartMock.getNodeRestartStatus.mockResolvedValueOnce({ timestamp: 'start-1' });
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTED_RETRY_BACKOFF_MAX_MS);
    const callsAfterSuccess = restartMock.getNodeRestartStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTED_RETRY_BACKOFF_INITIAL_MS - 1);
    expect(restartMock.getNodeRestartStatus.mock.calls.length).toBe(callsAfterSuccess);
    coordinator.cancel(coordinator.getExpectation());
    watcher.dispose();
  });

  it('clears preparing, pending, unconfirmed, and refreshing state when the last page owner releases', async () => {
    restartMock.getNodeRestartStatus.mockResolvedValue({ timestamp: 'start-1' });
    const {
      NodeRestartExpectationCoordinator,
      NODE_RESTART_EXPECTATION_TIMEOUT_MS
    } = await loadSource();
    const coordinator = new NodeRestartExpectationCoordinator();

    const baseline = deferred<{ timestamp: string | null }>();
    restartMock.getNodeRestartStatus.mockReturnValueOnce(baseline.promise);
    const preparingOwner = coordinator.acquirePageOwner();
    const preparing = coordinator.prepare();
    preparingOwner.release();
    baseline.resolve({ timestamp: 'start-1' });
    await expect(preparing).rejects.toBeInstanceOf(Error);
    expect(coordinator.getScriptWriteState()).toBe('idle');

    const pendingOwner = coordinator.acquirePageOwner();
    const pending = await coordinator.prepare();
    coordinator.commit(pending);
    pendingOwner.release();
    expect(coordinator.getExpectation()).toBeNull();

    const unconfirmedOwner = coordinator.acquirePageOwner();
    const unconfirmed = await coordinator.prepare();
    coordinator.commit(unconfirmed);
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTATION_TIMEOUT_MS);
    expect(coordinator.getExpectation()).toMatchObject({ state: 'unconfirmed' });
    unconfirmedOwner.release();
    expect(coordinator.getExpectation()).toBeNull();

    const refreshingOwner = coordinator.acquirePageOwner();
    const refreshing = await coordinator.prepare();
    coordinator.commit(refreshing);
    (coordinator as any).recordTimestamp('start-2');
    expect(coordinator.getExpectation()).toMatchObject({ state: 'refreshing' });
    refreshingOwner.release();
    expect(coordinator.getExpectation()).toBeNull();
  });

  it('supersedes stale expectations and disposes timers and polls', async () => {
    const pending = deferred<{ timestamp: string | null }>();
    restartMock.getNodeRestartStatus
      .mockResolvedValueOnce({ timestamp: 'start-1' })
      .mockReturnValueOnce(pending.promise);
    const { NodeRestartExpectationCoordinator, NODE_RESTART_EXPECTATION_TIMEOUT_MS } = await loadSource();
    const coordinator = new NodeRestartExpectationCoordinator();
    const events: string[] = [];
    const first = await coordinator.prepare();
    const watcher = coordinator.subscribe((event) => events.push(event.type));
    coordinator.commit(first);
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTATION_TIMEOUT_MS);
    restartMock.getNodeRestartStatus.mockResolvedValueOnce({ timestamp: 'start-2' });
    const second = await coordinator.prepare();
    coordinator.commit(second);

    expect(events).toContain('expected-superseded');
    const timeoutCountBeforeStaleResult = events.filter((type) => type === 'expected-timeout').length;
    pending.resolve({ timestamp: 'stale' });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTATION_TIMEOUT_MS);
    expect(events.filter((type) => type === 'expected-timeout')).toHaveLength(timeoutCountBeforeStaleResult + 1);

    watcher.dispose();
    coordinator.dispose();
    await vi.advanceTimersByTimeAsync(NODE_RESTART_EXPECTATION_TIMEOUT_MS);
    expect(coordinator.getExpectation()).toBeNull();
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((nextResolve) => {
      resolve = nextResolve;
    });
    return { promise, resolve };
  }
});
