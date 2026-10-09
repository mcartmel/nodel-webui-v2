import { flushMicrotasks } from './helpers';

const hostLogPollMock = vi.hoisted(() => {
  const subscriptions: Array<{
    active: boolean;
    dispose: ReturnType<typeof vi.fn>;
    listener: (state: unknown) => void;
    timer: number;
  }> = [];
  let initialActive = true;
  return {
    subscriptions,
    reset: () => {
      subscriptions.length = 0;
      initialActive = true;
    },
    setInitialActive(active: boolean) { initialActive = active; },
    register(intervalMs: number) {
      return {
        subscribe(_element: HTMLElement, listener: (state: unknown) => void) {
          const subscription = {
            active: true,
            dispose: vi.fn(() => {
              if (!subscription.active) {
                return;
              }
              subscription.active = false;
              window.clearInterval(subscription.timer);
            }),
            listener,
            timer: window.setInterval(() => listener({ active: true, data: null, error: '', loading: true }), intervalMs)
          };
          subscriptions.push(subscription);
          listener({ active: initialActive, data: null, error: '', loading: true });
          return { dispose: subscription.dispose, getState: vi.fn(), refresh: vi.fn() };
        }
      };
    }
  };
});

vi.mock('../src/data/nodel-data-runtime', () => ({
  registerNodelPollSource: vi.fn((config: { intervalMs: number }) => hostLogPollMock.register(config.intervalMs))
}));

vi.mock('../src/api/nodel-host-client', () => ({
  getHostLogs: vi.fn()
}));

vi.mock('../src/jsviews/jsviews-link-controller', () => ({
  JsViewsLinkController: class {
    link() {
      return Promise.resolve(true);
    }
  }
}));

vi.mock('../src/jsviews/jsviews-runtime', () => ({
  getJQuery: () => ({
    observable: (value: any) => ({
      refresh: (next: unknown[]) => value.splice(0, value.length, ...next),
      setProperty: (values: object) => Object.assign(value, values)
    })
  })
}));

import '../src/components/nodel-host-log';

async function settleLifecycle() {
  for (let index = 0; index < 12; index += 1) {
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
  }
}

describe('nodel-host-log poll lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    hostLogPollMock.reset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('owns one active poll timer across rapid reconnects and isolates a fresh instance', async () => {
    const oldHostLog = document.createElement('nodel-host-log');
    document.body.append(oldHostLog);
    await settleLifecycle();
    expect(hostLogPollMock.subscriptions.filter((subscription) => subscription.active)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    for (let index = 0; index < 3; index += 1) {
      oldHostLog.remove();
      expect(hostLogPollMock.subscriptions[index]!.dispose).toHaveBeenCalledOnce();
      expect(hostLogPollMock.subscriptions.filter((subscription) => subscription.active)).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);

      document.body.append(oldHostLog);
      await settleLifecycle();
      expect(hostLogPollMock.subscriptions.filter((subscription) => subscription.active)).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(1);
    }

    oldHostLog.remove();
    const freshHostLog = document.createElement('nodel-host-log');
    document.body.append(freshHostLog);
    await settleLifecycle();
    hostLogPollMock.subscriptions[0]!.listener({
      active: true,
      data: { entries: [{ seq: 1, level: 'INFO', message: 'Stale' }], nextSeq: 2, replace: true },
      error: '',
      loading: false
    });

    expect(hostLogPollMock.subscriptions.filter((subscription) => subscription.active)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(freshHostLog.textContent).not.toContain('Stale');
  });

  it('uses polling-paused rather than loading while the first request is inactive', async () => {
    hostLogPollMock.setInitialActive(false);
    const hostLog = document.createElement('nodel-host-log');
    const previews: string[] = [];
    hostLog.addEventListener('nodel-collapse-preview', (event) => previews.push((event as CustomEvent<{ text: string }>).detail.text));
    document.body.append(hostLog);
    await settleLifecycle();
    expect(previews.at(-1)).toBe('Host log polling paused');
    expect(previews).not.toContain('Loading host log');
  });

  it('does not emit preview events from stale lifecycle callbacks', async () => {
    const hostLog = document.createElement('nodel-host-log');
    let previewEvents = 0;
    hostLog.addEventListener('nodel-collapse-preview', () => { previewEvents += 1; });
    document.body.append(hostLog);
    await settleLifecycle();
    const stale = hostLogPollMock.subscriptions[0]!;
    hostLog.remove();
    const eventCountAtDispose = previewEvents;
    stale.listener({ active: true, data: { entries: [{ seq: 1, timestamp: '2026-01-01T00:00:01Z', level: 'INFO', message: 'Stale' }], nextSeq: 2, replace: true }, error: '', loading: false });
    expect(previewEvents).toBe(eventCountAtDispose);
  });

  it('publishes pause, resumes the current entry without loading flicker, and recovers from errors', async () => {
    const hostLog = document.createElement('nodel-host-log');
    const previews: string[] = [];
    hostLog.addEventListener('nodel-collapse-preview', (event) => previews.push((event as CustomEvent<{ text: string }>).detail.text));
    document.body.append(hostLog);
    await settleLifecycle();
    const listener = hostLogPollMock.subscriptions[0]!.listener;
    const beforeSuccess = previews.length;
    listener({ active: true, data: { entries: [{ seq: 1, timestamp: '2026-01-01T00:00:01Z', level: 'WARN', message: 'kept' }], nextSeq: 2, replace: true }, error: '', loading: false });
    listener({ active: false, data: null, error: '', loading: true });
    expect(previews.at(-1)).toMatch(/ WARN: kept — polling paused$/);
    listener({ active: true, data: null, error: '', loading: true });
    expect(previews.at(-1)).toMatch(/ WARN: kept$/);
    expect(previews.slice(beforeSuccess)).not.toContain('Loading host log');
    listener({ active: true, data: null, error: 'network', loading: false });
    expect(previews.at(-1)).toBe('Host log unavailable');
    listener({ active: true, data: { entries: [], nextSeq: 2, replace: false }, error: '', loading: false });
    expect(previews.at(-1)).toMatch(/ WARN: kept$/);
  });
});
