const activityMock = vi.hoisted(() => ({
  listeners: [] as Array<(state: any) => void>,
  dispose: vi.fn()
}));

vi.mock('../src/data/node-activity-source', () => ({
  subscribeNodeActivity: vi.fn((_element: HTMLElement, listener: (state: any) => void) => {
    activityMock.listeners.push(listener);
    return { dispose: activityMock.dispose };
  })
}));

import { bootstrapSignalVisibilityBindings, parseSignalBindings, subscribeSignalBindings } from '../src/data/signal-bindings';

function emitSignal(alias: string, arg: unknown) {
  for (const listener of activityMock.listeners) {
    listener({
      loading: false,
      connected: true,
      error: '',
      batch: {
        items: [
          {
            entry: {
              seq: 1,
              timestamp: '2026-05-30T00:00:00Z',
              source: 'local',
              type: 'event',
              alias,
              arg
            },
            changed: true,
            live: true
          }
        ],
        replace: false,
        transport: 'websocket',
        nextSeq: 2
      }
    });
  }
}

describe('signal bindings', () => {
  let bindingHost: { dispose(): void } | null = null;

  beforeEach(() => {
    activityMock.listeners = [];
    activityMock.dispose.mockClear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    bindingHost?.dispose();
    bindingHost = null;
    document.body.innerHTML = '';
  });

  it('parses path-aware signal expressions', () => {
    expect(parseSignalBindings('Status.message', null, 'value')).toEqual([
      { signal: 'Status', path: ['message'], target: 'value', mode: 'last' }
    ]);
    expect(parseSignalBindings(null, 'Status.level:level; Device\\.Status.message:message')).toEqual([
      { signal: 'Status', path: ['level'], target: 'level', mode: 'last' },
      { signal: 'Device.Status', path: ['message'], target: 'message', mode: 'last' }
    ]);
    expect(parseSignalBindings(null, 'Status.details\\.message:value')).toEqual([
      { signal: 'Status', path: ['details.message'], target: 'value', mode: 'last' }
    ]);
    expect(parseSignalBindings(null, 'Status.:value; Status..message:value')).toEqual([]);
  });

  it('extracts nested values before formatting signal target values', () => {
    const values: string[] = [];
    subscribeSignalBindings(
      document.createElement('div'),
      parseSignalBindings(null, 'Status.level:value; Status.message:value; Status.items.1:value'),
      { value: (value) => values.push(value) }
    );

    emitSignal('Status', { level: 1, message: 'Lamp warning', items: ['first', 'second'] });

    expect(values).toEqual(['1', 'Lamp warning', 'second']);
  });

  it('passes raw extracted values to target handlers without changing formatted values', () => {
    const values: string[] = [];
    const rawValues: unknown[] = [];
    subscribeSignalBindings(
      document.createElement('div'),
      parseSignalBindings(null, 'Status.items:value'),
      { value: (value, rawValue) => { values.push(value); rawValues.push(rawValue); } }
    );

    const items = [{ value: 'A', label: 'A' }];
    emitSignal('Status', { items });

    expect(values).toEqual([JSON.stringify(items, null, 2)]);
    expect(rawValues).toEqual([items]);
  });

  it('includes options-signal bindings and ignores duplicate options targets', () => {
    expect(parseSignalBindings(null, 'Available.items:options; Other:options(any)', undefined, null, 'Available.items')).toEqual([
      { signal: 'Available', path: ['items'], target: 'options', mode: 'last' },
      { signal: 'Other', target: 'options', mode: 'any' }
    ]);
  });

  it('reports activity source state to subscribers', () => {
    const states: any[] = [];
    subscribeSignalBindings(
      document.createElement('div'),
      parseSignalBindings('Status', null, 'value'),
      { value: vi.fn() },
      {},
      (state) => states.push(state)
    );

    for (const listener of activityMock.listeners) {
      listener({ loading: true, connected: false, error: 'offline', batch: null });
    }

    expect(states).toEqual([{ loading: true, connected: false, error: 'offline' }]);
  });

  it('formats missing, object, and array path values consistently with whole signal values', () => {
    const values: string[] = [];
    subscribeSignalBindings(
      document.createElement('div'),
      parseSignalBindings(null, 'Status.missing:value; Status.detail:value; Status.items:value'),
      { value: (value) => values.push(value) }
    );

    emitSignal('Status', { detail: { label: 'Nested' }, items: ['one', 'two'] });

    expect(values).toEqual(['', JSON.stringify({ label: 'Nested' }, null, 2), JSON.stringify(['one', 'two'], null, 2)]);
  });

  it('supports escaped dots in aliases and path keys', () => {
    const values: string[] = [];
    subscribeSignalBindings(
      document.createElement('div'),
      parseSignalBindings(null, 'Device\\.Status.message:value; Status.details\\.message:value'),
      { value: (value) => values.push(value) }
    );

    emitSignal('Device.Status', { message: 'Alias OK' });
    emitSignal('Status', { 'details.message': 'Path OK' });

    expect(values).toEqual(['Alias OK', 'Path OK']);
  });

  it('keeps multiple paths from the same signal independent for aggregation', () => {
    const values: string[] = [];
    subscribeSignalBindings(
      document.createElement('div'),
      parseSignalBindings(null, 'Status.ready:active(any); Status.override:active(any)'),
      { active: (value) => values.push(value) },
      { active: { evaluate: (value) => value === 'true' || value === 'on' } }
    );

    emitSignal('Status', { ready: false, override: true });
    emitSignal('Status', { ready: false, override: false });

    expect(values[values.length - 2]).toBe('true');
    expect(values[values.length - 1]).toBe('false');
  });

  it('binds visibility signal targets generically', () => {
    document.body.innerHTML = `
      <nodel-row visibility="PanelVisible"></nodel-row>
      <nodel-column signals="PanelVisible:visibility"></nodel-column>
      <nodel-text signal="Status">Status</nodel-text>
    `;

    bindingHost = bootstrapSignalVisibilityBindings();

    const row = document.querySelector('nodel-row') as HTMLElement;
    const column = document.querySelector('nodel-column') as HTMLElement;
    const text = document.querySelector('nodel-text') as HTMLElement;

    expect(activityMock.listeners).toHaveLength(2);

    emitSignal('PanelVisible', 'hidden');
    expect(row.hidden).toBe(true);
    expect(column.hidden).toBe(true);
    expect(text.hidden).toBe(false);

    emitSignal('PanelVisible', 'visible');
    expect(row.hidden).toBe(false);
    expect(column.hidden).toBe(false);

    emitSignal('PanelVisible', false);
    expect(row.hidden).toBe(true);
    expect(column.hidden).toBe(true);

    emitSignal('PanelVisible', 1);
    expect(row.hidden).toBe(false);
    expect(column.hidden).toBe(false);
  });

  it('binds visibility from signal paths', () => {
    document.body.innerHTML = `
      <nodel-row visibility="Panel.visible"></nodel-row>
      <nodel-column signals="Panel.visible:visibility"></nodel-column>
    `;

    bindingHost = bootstrapSignalVisibilityBindings();

    const row = document.querySelector('nodel-row') as HTMLElement;
    const column = document.querySelector('nodel-column') as HTMLElement;

    emitSignal('Panel', { visible: 'hidden' });
    expect(row.hidden).toBe(true);
    expect(column.hidden).toBe(true);

    emitSignal('Panel', { visible: 'visible' });
    expect(row.hidden).toBe(false);
    expect(column.hidden).toBe(false);
  });
});
