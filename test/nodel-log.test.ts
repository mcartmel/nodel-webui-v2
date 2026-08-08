import { waitFor } from './helpers';
import { rapidReconnect } from './lifecycle-helpers';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected test fixture value');
  return value;
}

const activityMock = vi.hoisted(() => ({
  disposers: [] as Array<ReturnType<typeof vi.fn>>,
  listeners: [] as Array<(state: unknown) => void>,
  subscriptions: [] as Array<{ active: boolean; dispose: ReturnType<typeof vi.fn> }>
}));

vi.mock('../src/data/node-activity-source', () => ({
  subscribeNodeActivity: vi.fn((_element: HTMLElement, listener: (state: unknown) => void) => {
    activityMock.listeners.push(listener);
    const subscription = {
      active: true,
      dispose: vi.fn(() => {
        subscription.active = false;
      })
    };
    const { dispose } = subscription;
    activityMock.disposers.push(dispose);
    activityMock.subscriptions.push(subscription);
    return { dispose, refresh: vi.fn() };
  })
}));

import '../src/components/nodel-log';

describe('nodel-log', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    activityMock.disposers = [];
    activityMock.listeners = [];
    activityMock.subscriptions = [];
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  async function mountLog() {
    document.body.innerHTML = '<nodel-log></nodel-log>';
    await customElements.whenDefined('nodel-log');
    await waitFor(() => activityMock.listeners.length === 1, {
      attempts: 100,
      intervalMs: 1,
      message: 'Timed out waiting for nodel-log activity subscription'
    });
  }

  it('renders activity history newest first and filters by alias', async () => {
    await mountLog();

    activityMock.listeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: true,
        transport: 'websocket',
        nextSeq: 3,
        items: [
          { entry: { seq: 0, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'Hidden', arg: 'empty' }, changed: false, live: false },
          { entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'action', alias: 'Power', arg: true }, changed: false, live: false },
          { entry: { seq: 2, timestamp: '2026-01-01T00:00:01Z', source: 'remote', type: 'event', alias: 'Level', arg: { value: 10 } }, changed: false, live: false }
        ]
      }
    });

    const rows = Array.from(document.querySelectorAll('.nodel-log-row'));
    expect(rows.length).toBe(2);
    expect(required(rows[0]).textContent).toContain('Level');
    expect(required(rows[0]).textContent).toContain('"value": 10');
    expect(required(rows[1]).textContent).toContain('Power');
    expect(document.body.textContent).not.toContain('Hidden');
    expect(document.body.textContent).not.toContain('empty');
    expect(required(rows[0]).querySelector('[data-icon="traffic-light"]')).toBeTruthy();
    expect(required(rows[0]).querySelector('[data-icon="arrow-right"]')).toBeTruthy();
    expect((required(rows[0]) as HTMLElement).dataset.logSource).toBe('remote');
    expect((required(rows[0]) as HTMLElement).dataset.logType).toBe('event');
    expect(required(rows[1]).querySelector('[data-icon="person-running"]')).toBeTruthy();
    expect((required(rows[1]) as HTMLElement).dataset.logSource).toBe('local');
    expect((required(rows[1]) as HTMLElement).dataset.logType).toBe('action');
    expect(required(rows[0]).textContent).not.toContain('remote');
    expect(required(rows[0]).textContent).not.toContain('event');
    expect(document.body.textContent).not.toContain('Live activity stream');
    expect(document.querySelector('[data-log-status]')).toBeNull();
    expect(document.querySelector('nodel-log')?.getAttribute('data-state')).toBe('active');

    const filter = document.querySelector<HTMLInputElement>('[data-log-filter]');
    filter!.value = 'pow';
    filter!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => document.querySelectorAll('.nodel-log-row').length === 1);

    expect(document.querySelectorAll('.nodel-log-row').length).toBe(1);
    expect(document.body.textContent).toContain('Power');
    expect(document.body.textContent).not.toContain('Level');
  });

  it('classifies activity icons with compact badges and accessible labels', async () => {
    await mountLog();

    activityMock.listeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: true,
        transport: 'websocket',
        nextSeq: 10,
        items: [
          { entry: { seq: 1, source: 'local', type: 'action', alias: 'LocalAction' }, changed: false, live: false },
          { entry: { seq: 2, source: 'remote', type: 'action', alias: 'RemoteAction' }, changed: false, live: false },
          { entry: { seq: 3, source: 'unbound', type: 'action', alias: 'UnboundAction' }, changed: false, live: false },
          { entry: { seq: 4, source: 'local', type: 'event', alias: 'LocalSignal' }, changed: false, live: false },
          { entry: { seq: 5, source: 'remote', type: 'event', alias: 'RemoteSignal' }, changed: false, live: false },
          { entry: { seq: 6, source: 'unbound', type: 'event', alias: 'UnboundSignal' }, changed: false, live: false },
          { entry: { seq: 7, source: 'remote', type: 'actionBinding', alias: 'ActionBinding' }, changed: false, live: false },
          { entry: { seq: 8, source: 'remote', type: 'eventBinding', alias: 'EventBinding' }, changed: false, live: false },
          { entry: { seq: 9 } as any, changed: false, live: false },
          { entry: { seq: 10, source: 'remote', type: 'unknown', alias: 'UnknownRemote' } as any, changed: false, live: false }
        ]
      }
    });

    const rowFor = (alias: string) => Array.from(document.querySelectorAll<HTMLElement>('.nodel-log-row'))
      .find((row) => row.querySelector('.nodel-log-alias')?.textContent === alias)!;
    const assertIcon = (alias: string, label: string, base: string, badge: string | undefined, source?: string, type?: string) => {
      const row = rowFor(alias);
      const icon = row.querySelector<HTMLElement>('.nodel-log-icon')!;
      expect(row.dataset.logSource).toBe(source);
      expect(row.dataset.logType).toBe(type);
      expect(icon.getAttribute('role')).toBe('img');
      expect(icon.getAttribute('aria-label')).toBe(label);
      expect(icon.getAttribute('title')).toBe(label);
      expect(icon.querySelector('.nodel-log-icon-primary')?.getAttribute('data-icon')).toBe(base);
      expect(icon.querySelector('.nodel-log-icon-badge')?.getAttribute('data-icon')).toBe(badge);
    };

    assertIcon('LocalAction', 'Local action', 'person-running', undefined, 'local', 'action');
    assertIcon('RemoteAction', 'Remote action', 'person-running', 'arrow-right', 'remote', 'action');
    assertIcon('UnboundAction', 'Unbound action', 'person-running', undefined, 'unbound', 'action');
    assertIcon('LocalSignal', 'Local signal', 'traffic-light', undefined, 'local', 'event');
    assertIcon('RemoteSignal', 'Remote signal', 'traffic-light', 'arrow-right', 'remote', 'event');
    assertIcon('UnboundSignal', 'Unbound signal', 'traffic-light', undefined, 'unbound', 'event');
    assertIcon('ActionBinding', 'Remote action binding status', 'person-running', 'link', 'remote', 'actionBinding');
    assertIcon('EventBinding', 'Remote signal binding status', 'traffic-light', 'link', 'remote', 'eventBinding');
    assertIcon('', 'Activity', 'traffic-light', undefined);
    assertIcon('UnknownRemote', 'Activity', 'traffic-light', 'arrow-right', 'remote', 'unknown');

    const remoteAction = rowFor('RemoteAction').querySelector('.nodel-log-icon')!;
    expect(remoteAction.querySelector('[data-icon="link"]')).toBeNull();
    const actionBinding = rowFor('ActionBinding').querySelector('.nodel-log-icon')!;
    expect(actionBinding.querySelector('[data-icon="arrow-right"]')).toBeNull();
  });

  it('renders blank time for missing timestamps', async () => {
    await mountLog();

    activityMock.listeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: true,
        transport: 'websocket',
        nextSeq: 1,
        items: [
          {
            entry: { seq: 1, source: 'local', type: 'event', alias: 'NoTime' },
            changed: false,
            live: false
          }
        ]
      }
    });

    const time = document.querySelector<HTMLElement>('.nodel-log-time');
    expect(time?.textContent).toBe(' - ');
  });

  it('renders an empty state only after a successful empty activity load', async () => {
    await mountLog();

    expect(document.querySelector('.nodel-log-empty')).toBeNull();

    activityMock.listeners[0]?.({
      loading: true,
      connected: false,
      error: '',
      batch: {
        replace: true,
        transport: 'websocket',
        nextSeq: 0,
        items: []
      }
    });

    expect(document.querySelector('.nodel-log-empty')).toBeNull();

    activityMock.listeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: true,
        transport: 'websocket',
        nextSeq: 1,
        items: [
          { entry: { seq: 0, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'Hidden' }, changed: false, live: false }
        ]
      }
    });

    expect(document.querySelectorAll('.nodel-log-row').length).toBe(0);
    expect(document.querySelector('.nodel-log-empty')?.textContent).toBe('No activity entries yet.');

    activityMock.listeners[0]?.({
      loading: false,
      connected: false,
      error: 'Activity request failed',
      batch: undefined
    });

    expect(document.querySelector('.nodel-log-empty')).toBeNull();
    expect(document.querySelector('[data-log-status]')?.textContent).toContain('Activity request failed');
  });

  it('renders filter-specific empty activity copy', async () => {
    await mountLog();

    activityMock.listeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: true,
        transport: 'websocket',
        nextSeq: 2,
        items: [
          { entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'Power' }, changed: false, live: false }
        ]
      }
    });

    const filter = document.querySelector<HTMLInputElement>('[data-log-filter]');
    filter!.value = 'missing';
    filter!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => document.querySelector('.nodel-log-empty') !== null);

    expect(document.querySelector('.nodel-log-empty')?.textContent).toBe('No activity matches this filter.');
  });

  it('defaults to showing 10 rows', async () => {
    await mountLog();

    activityMock.listeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: true,
        transport: 'websocket',
        nextSeq: 13,
        items: Array.from({ length: 12 }, (_, index) => ({
          entry: {
            seq: index + 1,
            timestamp: '2026-01-01T00:00:00Z',
            source: 'local',
            type: 'event',
            alias: `Signal${index + 1}`
          },
          changed: false,
          live: false
        }))
      }
    });

    await waitFor(() => document.querySelectorAll('.nodel-log-row').length === 10);

    expect(document.querySelector<HTMLSelectElement>('[data-log-limit]')?.value).toBe('10');
    expect(document.querySelectorAll('.nodel-log-row').length).toBe(10);
    expect(document.body.textContent).toContain('Signal12');
    expect(document.body.textContent).not.toContain('Signal2');
  });

  it('highlights JSON tokens safely when filter enables highlighted arguments', async () => {
    await mountLog();

    activityMock.listeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: true,
        transport: 'websocket',
        nextSeq: 2,
        items: [
          {
            entry: {
              seq: 1,
              timestamp: '2026-01-01T00:00:00Z',
              source: 'local',
              type: 'event',
              alias: 'Level',
              arg: { value: '<unsafe>', count: 10, enabled: true, missing: null }
            },
            changed: false,
            live: false
          }
        ]
      }
    });

    const filter = document.querySelector<HTMLInputElement>('[data-log-filter]');
    filter!.value = 'lev';
    filter!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => Boolean(document.querySelector('.nodel-log-arg.is-highlighted')));

    const row = document.querySelector<HTMLElement>('.nodel-log-row');
    const arg = document.querySelector<HTMLElement>('.nodel-log-arg.is-highlighted');

    expect(row?.hasAttribute('data-log-key')).toBe(false);
    expect(arg?.querySelector('.jsonkey')?.textContent).toBe('"value":');
    expect(arg?.querySelector('.jsonstring')?.textContent).toBe('"<unsafe>"');
    expect(arg?.querySelector('.jsonnumber')?.textContent).toBe('10');
    expect(arg?.querySelector('.jsonboolean')?.textContent).toBe('true');
    expect(arg?.querySelector('.jsonnull')?.textContent).toBe('null');
    expect(arg?.querySelector('unsafe')).toBeNull();
  });

  it('updates existing rows without moving them while hold is enabled', async () => {
    await mountLog();

    activityMock.listeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: true,
        transport: 'websocket',
        nextSeq: 3,
        items: [
          { entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'action', alias: 'Power' }, changed: false, live: false },
          { entry: { seq: 2, timestamp: '2026-01-01T00:00:01Z', source: 'remote', type: 'event', alias: 'Level' }, changed: false, live: false }
        ]
      }
    });

    const initialRows = Array.from(document.querySelectorAll('.nodel-log-row'));
    activityMock.listeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: false,
        transport: 'poll',
        nextSeq: 3,
        items: []
      }
    });
    expect(document.querySelectorAll('.nodel-log-row')[0]).toBe(initialRows[0]);

    const hold = document.querySelector<HTMLInputElement>('[data-log-hold]');
    hold!.checked = true;
    hold!.dispatchEvent(new Event('change', { bubbles: true }));

    activityMock.listeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: false,
        transport: 'websocket',
        nextSeq: 4,
        items: [
          { entry: { seq: 3, timestamp: '2026-01-01T00:00:02Z', source: 'local', type: 'action', alias: 'Power', arg: 'on' }, changed: true, live: true }
        ]
      }
    });

    const rows = Array.from(document.querySelectorAll('.nodel-log-row'));
    expect(rows[0]).toBe(initialRows[0]);
    expect(required(rows[0]).textContent).toContain('Level');
    expect(required(rows[1]).textContent).toContain('Power');
    expect(required(rows[1]).textContent).toContain('on');
    expect(required(rows[1]).classList.contains('is-pulsing')).toBe(true);
    expect((document.querySelector('nodel-log') as HTMLElement).dataset.state).toBe('active');
  });

  it('stays active while a polling request is in progress', async () => {
    await mountLog();

    activityMock.listeners[0]?.({
      loading: false,
      connected: false,
      error: '',
      transport: 'poll',
      batch: {
        replace: true,
        transport: 'poll',
        nextSeq: 2,
        items: [
          { entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'event', alias: 'Power', arg: 'on' }, changed: false, live: false }
        ]
      }
    });

    const log = document.querySelector('nodel-log') as HTMLElement;
    expect(log.dataset.state).toBe('active');

    activityMock.listeners[0]?.({
      loading: false,
      connected: false,
      error: '',
      transport: 'poll',
      batch: null
    });

    expect(log.dataset.state).toBe('active');
    expect(log.title).toBe('Activity polling active');
  });

  it('renders incomplete activity entries without crashing', async () => {
    await mountLog();

    expect(() => activityMock.listeners[0]?.({
      loading: false,
      connected: true,
      error: '',
      batch: {
        replace: true,
        transport: 'websocket',
        nextSeq: 2,
        items: [
          { entry: { seq: 1 }, changed: false, live: false }
        ]
      }
    })).not.toThrow();

    expect(document.querySelectorAll('.nodel-log-row').length).toBe(1);
  });

  it('owns exactly one activity subscription through rapid reconnect loops', async () => {
    await mountLog();
    const log = document.querySelector<HTMLElement>('nodel-log')!;
    let reconnects = 0;
    await rapidReconnect(log, async () => {
      expect(activityMock.disposers[reconnects]).toHaveBeenCalledOnce();
      reconnects += 1;
      await waitFor(() => activityMock.listeners.length === reconnects + 1);
    });

    expect(activityMock.listeners).toHaveLength(4);
    expect(activityMock.disposers.slice(0, 3).every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(activityMock.subscriptions.filter((subscription) => subscription.active)).toHaveLength(1);

    vi.useFakeTimers();
    try {
      activityMock.listeners[0]?.({
        loading: false,
        connected: true,
        error: '',
        batch: {
          replace: true,
          transport: 'websocket',
          nextSeq: 2,
          items: [{ entry: { seq: 1, timestamp: '2026-01-01T00:00:00Z', source: 'local', type: 'action', alias: 'Stale', arg: true }, changed: true, live: true }]
        }
      });
      activityMock.listeners[3]?.({
        loading: false,
        connected: true,
        error: '',
        batch: {
          replace: true,
          transport: 'websocket',
          nextSeq: 3,
          items: [{ entry: { seq: 2, timestamp: '2026-01-01T00:00:01Z', source: 'local', type: 'action', alias: 'Current', arg: true }, changed: true, live: true }]
        }
      });
      expect(log.textContent).toContain('Current');
      expect(log.textContent).not.toContain('Stale');
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(700);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
