import { waitFor } from './helpers';

const activityMock = vi.hoisted(() => ({
  listeners: [] as Array<(state: unknown) => void>
}));

vi.mock('../src/data/node-activity-source', () => ({
  subscribeNodeActivity: vi.fn((_element: HTMLElement, listener: (state: unknown) => void) => {
    activityMock.listeners.push(listener);
    return { dispose: vi.fn(), refresh: vi.fn() };
  })
}));

import '../src/components/nodel-log';

describe('nodel-log', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    activityMock.listeners = [];
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders activity history newest first and filters by alias', async () => {
    document.body.innerHTML = '<nodel-log></nodel-log>';
    await customElements.whenDefined('nodel-log');
    await waitFor(() => activityMock.listeners.length === 1);

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
    expect(rows[0].textContent).toContain('Level');
    expect(rows[0].textContent).toContain('"value": 10');
    expect(rows[1].textContent).toContain('Power');
    expect(document.body.textContent).not.toContain('Hidden');
    expect(document.body.textContent).not.toContain('empty');
    expect(rows[0].querySelector('[data-icon="traffic-light"]')).toBeTruthy();
    expect(rows[0].querySelector('[data-icon="arrow-right"]')).toBeTruthy();
    expect(rows[1].querySelector('[data-icon="person-running"]')).toBeTruthy();
    expect(rows[0].textContent).not.toContain('remote');
    expect(rows[0].textContent).not.toContain('event');
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

  it('does not render placeholder text when there are no visible rows', async () => {
    document.body.innerHTML = '<nodel-log></nodel-log>';
    await customElements.whenDefined('nodel-log');
    await waitFor(() => activityMock.listeners.length === 1);

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
    expect(document.querySelector('[data-log-output]')?.textContent?.trim()).toBe('');
  });

  it('highlights JSON tokens safely when filter enables highlighted arguments', async () => {
    document.body.innerHTML = '<nodel-log></nodel-log>';
    await customElements.whenDefined('nodel-log');
    await waitFor(() => activityMock.listeners.length === 1);

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
    document.body.innerHTML = '<nodel-log></nodel-log>';
    await customElements.whenDefined('nodel-log');
    await waitFor(() => activityMock.listeners.length === 1);

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
    expect(rows[0].textContent).toContain('Level');
    expect(rows[1].textContent).toContain('Power');
    expect(rows[1].textContent).toContain('on');
  });

  it('renders incomplete activity entries without crashing', async () => {
    document.body.innerHTML = '<nodel-log></nodel-log>';
    await customElements.whenDefined('nodel-log');
    await waitFor(() => activityMock.listeners.length === 1);

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
});
