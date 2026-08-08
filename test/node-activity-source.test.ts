import { flushMicrotasks } from './helpers';
import type { NodelActivityLogEntry } from '../src/api/nodel-types';
import type { NodeActivityBatch, NodeActivityTransport } from '../src/data/node-activity-source';
import { localNodePath } from '../src/utils/urls';

const activityMock = vi.hoisted(() => ({
  disposeVisibility: vi.fn(),
  getNodeActivity: vi.fn(),
  initialVisible: true,
  reportConnectivityFailure: vi.fn(),
  visibilityHandlers: [] as Array<(visible: boolean) => void>
}));

vi.mock('../src/api/nodel-host-client', () => ({
  getNodeActivity: activityMock.getNodeActivity
}));

vi.mock('../src/data/visibility-scope', () => ({
  observeNodelVisibility: vi.fn((_element: HTMLElement, handler: (visible: boolean) => void) => {
    activityMock.visibilityHandlers.push(handler);
    handler(activityMock.initialVisible);
    return activityMock.disposeVisibility;
  })
}));

vi.mock('../src/data/connectivity', () => ({
  reportConnectivityFailure: activityMock.reportConnectivityFailure
}));

interface ActivityState {
  loading: boolean;
  connected: boolean;
  error: string;
  batch: NodeActivityBatch | null;
  transport: NodeActivityTransport | null;
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  close = vi.fn();

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.onopen?.({} as Event);
  }

  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }

  closeFromServer() {
    this.onclose?.({} as CloseEvent);
  }
}

function setDocumentHidden(value: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value
  });
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value
  });
}

type MockFn = ReturnType<typeof vi.fn>;

function getArrayValue<T>(values: readonly T[], index: number, label: string): T {
  const value = index >= 0 ? values[index] : values.at(index);
  if (value === undefined) {
    throw new Error(`Expected ${label}`);
  }
  return value;
}

function getMockCallArg<T>(mockFn: MockFn, callIndex: number, argIndex: number, label: string): T {
  const call = getArrayValue(mockFn.mock.calls, callIndex, `${label} call`);
  return getArrayValue(call, argIndex, `${label} call ${callIndex} argument`);
}

function getLatestState(states: ActivityState[]): ActivityState {
  return getArrayValue(states, -1, 'activity state');
}

function getSocket(index: number): MockWebSocket {
  return getArrayValue(MockWebSocket.instances, index, `MockWebSocket at index ${index}`);
}

function visibilityHandler(): (visible: boolean) => void {
  return getArrayValue(activityMock.visibilityHandlers, 0, 'visibility handler');
}

function getBatchItem(batch: NodeActivityBatch | null, index: number, label: string) {
  if (batch === null) {
    throw new Error(`Expected ${label} but batch was null`);
  }

  return getArrayValue(batch.items, index, `${label} batch item`);
}

function getAbortSignal(init: { signal?: AbortSignal }, label: string): AbortSignal {
  const signal = init.signal;
  if (signal === undefined) {
    throw new Error(`Expected ${label}`);
  }
  return signal;
}

function activityEntry(overrides: Partial<NodelActivityLogEntry> = {}): NodelActivityLogEntry {
  return {
    seq: 1,
    timestamp: '2026-01-01T00:00:00Z',
    source: 'local',
    type: 'action',
    alias: 'Power',
    arg: true,
    ...overrides
  };
}

function activityEntryWithoutTimestamp(overrides: Omit<Partial<NodelActivityLogEntry>, 'timestamp'> = {}): Omit<NodelActivityLogEntry, 'timestamp'> {
  const entry = activityEntry(overrides);
  const { timestamp, ...entryWithoutTimestamp } = entry;
  void timestamp;
  return entryWithoutTimestamp;
}

function createSubscriberHost() {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
}

async function loadSource() {
  vi.resetModules();
  return import('../src/data/node-activity-source');
}

describe('node-activity-source', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    window.history.replaceState(undefined, '', '/nodes/TestUI/nodel.html');
    document.body.innerHTML = '';
    setDocumentHidden(false);
    setNavigatorOnline(true);
    activityMock.disposeVisibility.mockClear();
    activityMock.getNodeActivity.mockReset();
    activityMock.initialVisible = true;
    activityMock.reportConnectivityFailure.mockClear();
    activityMock.visibilityHandlers = [];
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens one WebSocket for multiple visible subscribers and emits connected state', async () => {
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const first = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));
    const second = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(getSocket(0).url).toBe(`ws://${window.location.host}${localNodePath('TestUI')}`);

    getSocket(0).open();

    expect(getLatestState(states).connected).toBe(true);
    expect(activityMock.getNodeActivity).not.toHaveBeenCalled();

    first.dispose();
    second.dispose();
    expect(getSocket(0).close).toHaveBeenCalledTimes(1);
  });

  it('isolates throwing subscribers and ignores stale socket callbacks after reconnect', async () => {
    const { subscribeNodeActivity } = await loadSource();
    const listenerError = vi.fn();
    window.addEventListener('nodel-source-listener-error', listenerError);
    const first = subscribeNodeActivity(createSubscriberHost(), () => {
      throw new Error('subscriber failed');
    });
    const states: ActivityState[] = [];
    const second = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));
    const oldSocket = getSocket(0);

    activityMock.visibilityHandlers.forEach((handler) => handler(false));
    activityMock.visibilityHandlers.forEach((handler) => handler(true));
    expect(MockWebSocket.instances).toHaveLength(2);
    oldSocket.closeFromServer();
    await flushMicrotasks();

    expect(activityMock.getNodeActivity).not.toHaveBeenCalled();
    expect(listenerError).toHaveBeenCalled();
    const listenerErrorEvent = getMockCallArg<CustomEvent>(listenerError, 0, 0, 'listener error event');
    expect(listenerErrorEvent.detail).toMatchObject({
      message: 'subscriber failed',
      source: 'node-activity-source'
    });
    getSocket(1).open();
    expect(getLatestState(states).connected).toBe(true);

    first.dispose();
    second.dispose();
    window.removeEventListener('nodel-source-listener-error', listenerError);
  });

  it('emits sorted and deduplicated activity history from WebSocket messages', async () => {
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));

    getSocket(0).message({
      activityHistory: [
        activityEntry({ seq: 3, alias: 'Power', arg: 'latest' }),
        activityEntry({ seq: 2, source: 'remote', type: 'event', alias: 'Level', arg: 25 }),
        activityEntry({ seq: 1, alias: 'Power', arg: 'old' })
      ]
    });

    const batch = getLatestState(states).batch;

    expect(batch?.transport).toBe('websocket');
    expect(batch?.replace).toBe(true);
    expect(batch?.nextSeq).toBe(4);
    expect(batch?.items).toHaveLength(2);
    expect(batch?.items.map((item) => item.entry.alias)).toEqual(['Level', 'Power']);
    expect(getBatchItem(getLatestState(states).batch, 1, 'sorted websocket batch').entry.arg).toBe('latest');

    subscription.dispose();
  });

  it('keeps the next sequence monotonic across duplicate and stale WebSocket entries', async () => {
    activityMock.getNodeActivity.mockResolvedValue([]);
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));
    const socket = getSocket(0);
    socket.message({ activityHistory: [activityEntry({ seq: 5 })] });
    socket.message({ activity: activityEntry({ seq: 5 }) });
    vi.advanceTimersByTime(100);
    await flushMicrotasks();
    socket.message({ activityHistory: [activityEntry({ seq: 3 })] });

    expect(getLatestState(states).batch?.nextSeq).toBe(6);
    socket.closeFromServer();
    await flushMicrotasks();
    expect(getMockCallArg<{ from: number }>(activityMock.getNodeActivity, -1, 0, 'poll refresh request')).toEqual({ from: 6 });
    subscription.dispose();
  });

  it('accepts newer live WebSocket activity whose seq is lower than the history cursor', async () => {
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));
    const historySeq = 1_784_106_123_556;
    const liveSeq = 1_784_102_982_703;

    getSocket(0).message({
      activityHistory: [activityEntry({
        seq: historySeq,
        timestamp: '2026-08-02T22:24:26.042+10:00',
        source: 'local',
        type: 'event',
        alias: 'Clock',
        arg: '2026-08-02T22:24:26.042+10:00'
      })]
    });
    getSocket(0).message({
      activity: activityEntry({
        seq: liveSeq,
        timestamp: '2026-08-02T22:24:27.042+10:00',
        source: 'local',
        type: 'event',
        alias: 'Clock',
        arg: '2026-08-02T22:24:27.042+10:00'
      })
    });
    vi.advanceTimersByTime(100);
    await flushMicrotasks();

    const batch = getLatestState(states).batch;
    expect(batch?.replace).toBe(false);
    expect(batch?.transport).toBe('websocket');
    expect(batch?.nextSeq).toBe(historySeq + 1);
    expect(batch?.items).toEqual([
      {
        entry: activityEntry({
          seq: liveSeq,
          timestamp: '2026-08-02T22:24:27.042+10:00',
          source: 'local',
          type: 'event',
          alias: 'Clock',
          arg: '2026-08-02T22:24:27.042+10:00'
        }),
        changed: true,
        live: true
      }
    ]);

    subscription.dispose();
  });

  it('stops an outer emission when a subscriber refreshes the source', async () => {
    const { subscribeNodeActivity } = await loadSource();
    let refreshed = false;
    const first = subscribeNodeActivity(createSubscriberHost(), (state) => {
      if (state.batch && !refreshed) {
        refreshed = true;
        first.refresh();
      }
    });
    const secondBatches: Array<NodeActivityBatch | null> = [];
    const second = subscribeNodeActivity(createSubscriberHost(), (state) => secondBatches.push(state.batch));
    secondBatches.length = 0;

    getSocket(0).message({ activityHistory: [activityEntry({ seq: 1, alias: 'Superseded' })] });

    expect(secondBatches.some((batch) => batch?.items.some((item) => item.entry.alias === 'Superseded'))).toBe(false);
    first.dispose();
    second.dispose();
  });

  it('coalesces live WebSocket activity before emitting a batch', async () => {
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));

    getSocket(0).message({ activity: activityEntry({ seq: 4, arg: 'first' }) });
    getSocket(0).message({ activity: activityEntry({ seq: 5, arg: 'second' }) });

    expect(getLatestState(states).batch?.items[0]?.entry.seq).not.toBe(5);

    vi.advanceTimersByTime(100);
    await flushMicrotasks();

    const batch = getLatestState(states).batch;

    expect(batch?.transport).toBe('websocket');
    expect(batch?.replace).toBe(false);
    expect(batch?.nextSeq).toBe(6);
    expect(batch?.items).toEqual([
      {
        entry: activityEntry({ seq: 5, arg: 'second' }),
        changed: true,
        live: true
      }
    ]);

    subscription.dispose();
  });

  it('surfaces malformed WebSocket entries and recovers on the next valid message', async () => {
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));

    getSocket(0).message({
      activity: { seq: 1, timestamp: 'not-a-date', source: 'local', type: 'event', alias: 'Status' }
    });
    expect(getLatestState(states).error).toContain('WebSocket activity returned invalid data');
    expect(getLatestState(states).error.length).toBeLessThanOrEqual(500);
    expect(getLatestState(states).batch).toBeNull();

    getSocket(0).message({
      activityHistory: [activityEntry({ seq: 2, source: 'local', type: 'event', alias: 'Status', arg: 'Ready' })]
    });
    expect(getLatestState(states).error).toBe('');
    expect(getBatchItem(getLatestState(states).batch, 0, 'malformed recovery batch').entry.alias).toBe('Status');
    expect(getLatestState(states).batch?.transport).toBe('websocket');

    subscription.dispose();
  });

  it('accepts initial WebSocket snapshots with uninitialized activity timestamps', async () => {
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));

    getSocket(0).message({
      activityHistory: [
        { seq: 1, source: 'local', type: 'event', alias: 'Boot', arg: 'ready' },
      ]
    });

    expect(getLatestState(states).error).toBe('');
    expect(getBatchItem(getLatestState(states).batch, 0, 'uninitialized batch item').entry.timestamp).toBeUndefined();

    subscription.dispose();
  });

  it('replays retained latest signal values to subscribers after unrelated live activity', async () => {
    const { subscribeNodeActivity } = await loadSource();
    const firstStates: ActivityState[] = [];
    const first = subscribeNodeActivity(createSubscriberHost(), (state) => firstStates.push(state));

    getSocket(0).message({
      activityHistory: [
        activityEntry({ seq: 1, source: 'local', type: 'event', alias: 'ConfirmCode', arg: '0420' }),
        activityEntry({ seq: 2, source: 'local', type: 'event', alias: 'Status', arg: 'Ready' })
      ]
    });
    getSocket(0).message({
      activity: activityEntry({ seq: 3, source: 'local', type: 'event', alias: 'Status', arg: 'Busy' })
    });
    vi.advanceTimersByTime(100);
    await flushMicrotasks();
    expect(getLatestState(firstStates).batch?.items.map((item) => item.entry.alias)).toEqual(['Status']);

    const secondStates: ActivityState[] = [];
    const second = subscribeNodeActivity(createSubscriberHost(), (state) => secondStates.push(state));
    const snapshot = getArrayValue(secondStates, 0, 'second subscriber state').batch;
    expect(snapshot?.replace).toBe(true);
    expect(snapshot?.items.map((item) => [item.entry.alias, item.entry.arg])).toEqual([
      ['ConfirmCode', '0420'],
      ['Status', 'Busy']
    ]);
    expect(snapshot?.items.every((item) => item.changed === false && item.live === false)).toBe(true);

    first.dispose();
    second.dispose();
  });

  it('drops queued live activity when the last subscriber disconnects', async () => {
    const { subscribeNodeActivity } = await loadSource();
    const first = subscribeNodeActivity(createSubscriberHost(), vi.fn());
    getSocket(0).message({ activity: activityEntry({ seq: 7, alias: 'Queued' }) });
    first.dispose();
    vi.advanceTimersByTime(100);
    await flushMicrotasks();

    const states: ActivityState[] = [];
    const second = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));
    expect(getArrayValue(states, 0, 'fallback state').batch).toBeNull();
    second.dispose();
  });

  it('falls back to activity polling when the WebSocket closes', async () => {
    activityMock.getNodeActivity.mockResolvedValue([
      activityEntry({ seq: 10, alias: 'Power' }),
      activityEntry({ seq: 11, source: 'remote', type: 'event', alias: 'Level' })
    ]);
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));

    getSocket(0).closeFromServer();
    await flushMicrotasks();

    expect(activityMock.getNodeActivity).toHaveBeenCalledWith({ from: -1 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(getLatestState(states).batch).toMatchObject({
      replace: true,
      transport: 'poll',
      nextSeq: 12
    });
    expect(getLatestState(states).batch?.items.map((item) => item.entry.alias)).toEqual(['Power', 'Level']);
    expect(getLatestState(states).transport).toBe('poll');

    subscription.dispose();
  });

  it('falls back to polling when the WebSocket connection hangs past its deadline', async () => {
    activityMock.getNodeActivity.mockResolvedValue([activityEntry({ seq: 12, alias: 'Fallback' })]);
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));
    const socket = getSocket(0);

    vi.advanceTimersByTime(2500);
    await flushMicrotasks();

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(activityMock.getNodeActivity).toHaveBeenCalledWith({ from: -1 }, expect.any(Object));
    expect(getLatestState(states).transport).toBe('poll');
    expect(getBatchItem(getLatestState(states).batch, 0, 'fallback poll batch').entry.alias).toBe('Fallback');

    subscription.dispose();
  });

  it('accepts missing timestamps from polled REST activity without a source error', async () => {
    activityMock.getNodeActivity.mockResolvedValue([
      activityEntryWithoutTimestamp({ seq: 10 })
    ]);
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));

    getSocket(0).closeFromServer();
    await flushMicrotasks();

    expect(getLatestState(states).error).toBe('');
    expect(getBatchItem(getLatestState(states).batch, 0, 'missing-timestamp poll batch').entry.timestamp).toBeUndefined();

    subscription.dispose();
  });

  it('reports WebSocket transport errors for same-origin connectivity confirmation', async () => {
    activityMock.getNodeActivity.mockResolvedValue([]);
    const { subscribeNodeActivity } = await loadSource();
    const subscription = subscribeNodeActivity(createSubscriberHost(), vi.fn());

    getSocket(0).onerror?.({} as Event);
    await flushMicrotasks();

    expect(activityMock.reportConnectivityFailure).toHaveBeenCalledWith('REST/', expect.any(TypeError));
    expect(activityMock.getNodeActivity).toHaveBeenCalledTimes(1);
    subscription.dispose();
  });

  it('keeps polling transport active between requests', async () => {
    let resolveNextPoll: ((entries: NodelActivityLogEntry[]) => void) | undefined;
    activityMock.getNodeActivity
      .mockResolvedValueOnce([activityEntry({ seq: 10 })])
      .mockImplementationOnce(() => new Promise<NodelActivityLogEntry[]>((resolve) => {
        resolveNextPoll = resolve;
      }));
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));

    getSocket(0).closeFromServer();
    await flushMicrotasks();
    expect(getLatestState(states)).toMatchObject({ loading: false, connected: false, error: '', transport: 'poll' });

    vi.advanceTimersByTime(1000);
    await flushMicrotasks();
    expect(activityMock.getNodeActivity).toHaveBeenCalledTimes(2);
    expect(getLatestState(states)).toMatchObject({ loading: false, connected: false, error: '', batch: null, transport: 'poll' });

    resolveNextPoll?.([]);
    await flushMicrotasks();
    subscription.dispose();
  });

  it('bounds polling backoff and refreshes immediately on visibility recovery', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    activityMock.getNodeActivity.mockRejectedValue(new Error('offline'));
    const { subscribeNodeActivity } = await loadSource();
    const subscription = subscribeNodeActivity(createSubscriberHost(), vi.fn());
    getSocket(0).closeFromServer();
    await flushMicrotasks();

    for (let index = 0; index < 20; index += 1) {
      vi.advanceTimersByTime(15_000);
      await flushMicrotasks();
    }
    const socketsBeforeRecovery = MockWebSocket.instances.length;
    activityMock.getNodeActivity.mockResolvedValue([]);
    visibilityHandler()(false);
    visibilityHandler()(true);
    await flushMicrotasks();

    expect(MockWebSocket.instances.length).toBeGreaterThan(socketsBeforeRecovery);
    subscription.dispose();
  });

  it('serializes polling when another subscriber evaluates an unresolved request', async () => {
    let resolvePoll!: (entries: NodelActivityLogEntry[]) => void;
    activityMock.getNodeActivity.mockImplementation(() => new Promise((resolve) => {
      resolvePoll = resolve;
    }));
    const { subscribeNodeActivity } = await loadSource();
    const first = subscribeNodeActivity(createSubscriberHost(), vi.fn());
    getSocket(0).closeFromServer();
    await flushMicrotasks();
    const second = subscribeNodeActivity(createSubscriberHost(), vi.fn());

    expect(activityMock.getNodeActivity).toHaveBeenCalledTimes(1);
    resolvePoll([]);
    await flushMicrotasks();

    first.dispose();
    second.dispose();
  });

  it('does not let a stale poll finalizer clear the reconnect polling timer', async () => {
    let resolveStale!: (entries: NodelActivityLogEntry[]) => void;
    activityMock.getNodeActivity
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveStale = resolve;
      }))
      .mockResolvedValue([]);
    const { subscribeNodeActivity } = await loadSource();
    const subscription = subscribeNodeActivity(createSubscriberHost(), vi.fn());
    getSocket(0).closeFromServer();
    await flushMicrotasks();

    visibilityHandler()(false);
    visibilityHandler()(true);
    getSocket(1).closeFromServer();
    await flushMicrotasks();
    expect(activityMock.getNodeActivity).toHaveBeenCalledTimes(2);

    resolveStale([]);
    await flushMicrotasks();
    vi.advanceTimersByTime(1000);
    await flushMicrotasks();
    expect(activityMock.getNodeActivity).toHaveBeenCalledTimes(3);

    subscription.dispose();
  });

  it('aborts fallback polling when a reconnect WebSocket takes ownership', async () => {
    let constructionAttempts = 0;
    class FlakyWebSocket extends MockWebSocket {
      constructor(url: string) {
        constructionAttempts += 1;
        if (constructionAttempts === 1) {
          throw new TypeError('socket unavailable');
        }
        super(url);
      }
    }
    vi.stubGlobal('WebSocket', FlakyWebSocket);
    let resolvePoll!: (entries: NodelActivityLogEntry[]) => void;
    activityMock.getNodeActivity.mockImplementation((_options: unknown, init: RequestInit) => new Promise((resolve) => {
      resolvePoll = resolve;
      expect(init.signal?.aborted).toBe(false);
    }));
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));
    await flushMicrotasks();
    const pollSignal = getAbortSignal(
      getMockCallArg<{ signal?: AbortSignal }>(activityMock.getNodeActivity, 0, 1, 'stale poll request'),
      'stale poll request abort signal'
    );

    vi.advanceTimersByTime(5000);
    await flushMicrotasks();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(pollSignal.aborted).toBe(true);
    getSocket(0).open();
    resolvePoll([activityEntry({ seq: 10, alias: 'Stale poll' })]);
    await flushMicrotasks();

    expect(getLatestState(states).connected).toBe(true);
    expect(states.some((state) => state.batch?.items.some((item) => item.entry.alias === 'Stale poll'))).toBe(false);
    subscription.dispose();
  });

  it('waits for visibility before running and closes the socket when hidden', async () => {
    activityMock.initialVisible = false;
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(activityMock.getNodeActivity).not.toHaveBeenCalled();

    visibilityHandler()(true);
    expect(MockWebSocket.instances).toHaveLength(1);

    getSocket(0).open();
    visibilityHandler()(false);

    expect(getSocket(0).close).toHaveBeenCalledTimes(1);
    expect(getLatestState(states).connected).toBe(false);

    subscription.dispose();
  });

  it('does not open activity sources while offline', async () => {
    setNavigatorOnline(false);
    const { subscribeNodeActivity } = await loadSource();
    const subscription = subscribeNodeActivity(createSubscriberHost(), () => undefined);

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(activityMock.getNodeActivity).not.toHaveBeenCalled();

    subscription.dispose();
  });

  it('returns a failed result for a requested restart refresh while preserving source errors', async () => {
    const { refreshNodeActivityForRestart, subscribeNodeActivity } = await loadSource();
    const subscription = subscribeNodeActivity(createSubscriberHost(), () => undefined);
    await flushMicrotasks();

    const resultPromise = refreshNodeActivityForRestart();
    await flushMicrotasks();
    getSocket(-1).message({ error: 'Activity unavailable' });
    const result = await resultPromise;

    expect(result).toMatchObject({ status: 'failed', detail: 'Activity unavailable' });
    subscription.dispose();
  });

  it('bounds and normalizes decoded WebSocket error text before exposing it to state', async () => {
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));
    await flushMicrotasks();

    getSocket(-1).message({ error: `  ${'x'.repeat(800)}\nmore` });

    expect(getLatestState(states).error).toHaveLength(500);
    expect(getLatestState(states).error).not.toContain('\n');
    subscription.dispose();
  });

  it('forces a restart activity refresh for a hidden but subscribed log source', async () => {
    activityMock.initialVisible = false;
    activityMock.getNodeActivity.mockResolvedValueOnce([activityEntry({ seq: 7, alias: 'ForcedStatus' })]);
    const { refreshNodeActivityForRestart, subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));
    await flushMicrotasks();

    await expect(refreshNodeActivityForRestart()).resolves.toMatchObject({ status: 'inactive' });
    await expect(refreshNodeActivityForRestart({ force: true })).resolves.toMatchObject({ status: 'verified' });

    expect(activityMock.getNodeActivity).toHaveBeenCalledWith({ from: -1 }, expect.any(Object));
    expect(getLatestState(states).batch?.items[0]?.entry.alias).toBe('ForcedStatus');
    subscription.dispose();
  });

  it('marks an activity refresh superseded when a newer reset owns the source', async () => {
    const { refreshNodeActivity, refreshNodeActivityForRestart, subscribeNodeActivity } = await loadSource();
    const subscription = subscribeNodeActivity(createSubscriberHost(), () => undefined);
    await flushMicrotasks();

    const resultPromise = refreshNodeActivityForRestart();
    await flushMicrotasks();
    refreshNodeActivity();

    await expect(resultPromise).resolves.toMatchObject({ status: 'superseded' });
    subscription.dispose();
  });
});
