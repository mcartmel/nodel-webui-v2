import { flushMicrotasks } from './helpers';
import type { NodelActivityLogEntry } from '../src/api/nodel-types';
import type { NodeActivityBatch, NodeActivityTransport } from '../src/data/node-activity-source';

const activityMock = vi.hoisted(() => ({
  disposeVisibility: vi.fn(),
  getNodeActivity: vi.fn(),
  initialVisible: true,
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
    expect(MockWebSocket.instances[0].url).toBe(`ws://${window.location.host}/nodes/TestUI`);

    MockWebSocket.instances[0].open();

    expect(states.at(-1)?.connected).toBe(true);
    expect(activityMock.getNodeActivity).not.toHaveBeenCalled();

    first.dispose();
    second.dispose();
    expect(MockWebSocket.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it('emits sorted and deduplicated activity history from WebSocket messages', async () => {
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));

    MockWebSocket.instances[0].message({
      activityHistory: [
        activityEntry({ seq: 3, alias: 'Power', arg: 'latest' }),
        activityEntry({ seq: 2, source: 'remote', type: 'event', alias: 'Level', arg: 25 }),
        activityEntry({ seq: 1, alias: 'Power', arg: 'old' })
      ]
    });

    const batch = states.at(-1)?.batch;

    expect(batch?.transport).toBe('websocket');
    expect(batch?.replace).toBe(true);
    expect(batch?.nextSeq).toBe(4);
    expect(batch?.items).toHaveLength(2);
    expect(batch?.items.map((item) => item.entry.alias)).toEqual(['Power', 'Level']);
    expect(batch?.items[0].entry.arg).toBe('latest');

    subscription.dispose();
  });

  it('coalesces live WebSocket activity before emitting a batch', async () => {
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));

    MockWebSocket.instances[0].message({ activity: activityEntry({ seq: 4, arg: 'first' }) });
    MockWebSocket.instances[0].message({ activity: activityEntry({ seq: 5, arg: 'second' }) });

    expect(states.at(-1)?.batch?.items[0]?.entry.seq).not.toBe(5);

    vi.advanceTimersByTime(100);
    await flushMicrotasks();

    const batch = states.at(-1)?.batch;

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

  it('falls back to activity polling when the WebSocket closes', async () => {
    activityMock.getNodeActivity.mockResolvedValue([
      activityEntry({ seq: 10, alias: 'Power' }),
      activityEntry({ seq: 11, source: 'remote', type: 'event', alias: 'Level' })
    ]);
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));

    MockWebSocket.instances[0].closeFromServer();
    await flushMicrotasks();

    expect(activityMock.getNodeActivity).toHaveBeenCalledWith({ from: -1 });
    expect(states.at(-1)?.batch).toMatchObject({
      replace: true,
      transport: 'poll',
      nextSeq: 12
    });
    expect(states.at(-1)?.batch?.items.map((item) => item.entry.alias)).toEqual(['Power', 'Level']);
    expect(states.at(-1)?.transport).toBe('poll');

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

    MockWebSocket.instances[0].closeFromServer();
    await flushMicrotasks();
    expect(states.at(-1)).toMatchObject({ loading: false, connected: false, error: '', transport: 'poll' });

    vi.advanceTimersByTime(1000);
    await flushMicrotasks();
    expect(activityMock.getNodeActivity).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toMatchObject({ loading: false, connected: false, error: '', batch: null, transport: 'poll' });

    resolveNextPoll?.([]);
    await flushMicrotasks();
    subscription.dispose();
  });

  it('waits for visibility before running and closes the socket when hidden', async () => {
    activityMock.initialVisible = false;
    const { subscribeNodeActivity } = await loadSource();
    const states: ActivityState[] = [];
    const subscription = subscribeNodeActivity(createSubscriberHost(), (state) => states.push(state));

    expect(MockWebSocket.instances).toHaveLength(0);
    expect(activityMock.getNodeActivity).not.toHaveBeenCalled();

    activityMock.visibilityHandlers[0]?.(true);
    expect(MockWebSocket.instances).toHaveLength(1);

    MockWebSocket.instances[0].open();
    activityMock.visibilityHandlers[0]?.(false);

    expect(MockWebSocket.instances[0].close).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.connected).toBe(false);

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
});
