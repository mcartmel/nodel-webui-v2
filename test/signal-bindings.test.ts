const activityMock = vi.hoisted(() => ({
  listeners: [] as Array<(state: any) => void>
}));

vi.mock('../src/data/node-activity-source', () => ({
  subscribeNodeActivity: vi.fn((_element: HTMLElement, listener: (state: any) => void) => {
    activityMock.listeners.push(listener);
    return {
      dispose: () => {
        const index = activityMock.listeners.indexOf(listener);
        if (index >= 0) {
          activityMock.listeners.splice(index, 1);
        }
      }
    };
  })
}));

import { bootstrapSignalVisibilityBindings, normalizeSignalName, parseSignalBindings, subscribeSignalBindings } from '../src/data/signal-bindings';
import { flush } from './helpers';

function emitSignalBatch(entries: Array<{ alias: string; arg: unknown; seq?: number }>) {
  for (const listener of activityMock.listeners) {
    listener({
      loading: false,
      connected: true,
      error: '',
      batch: {
        items: entries.map((entry, index) => ({
          entry: {
            seq: entry.seq ?? index + 1,
            timestamp: '2026-05-30T00:00:00Z',
            source: 'local',
            type: 'event',
            alias: entry.alias,
            arg: entry.arg
          },
          changed: true,
          live: true
        })),
        replace: false,
        transport: 'websocket',
        nextSeq: Math.max(...entries.map((entry, index) => entry.seq ?? index + 1)) + 1
      }
    });
  }
}

function emitSignal(alias: string, arg: unknown) {
  emitSignalBatch([{ alias, arg }]);
}

describe('signal bindings', () => {
  let bindingHost: { dispose(): void } | null = null;

  beforeEach(() => {
    activityMock.listeners = [];
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

  it('preserves U+FEFF in signal and JSON path keys while trimming Java edge spaces', () => {
    const values: string[] = [];
    const bindings = parseSignalBindings('\u00a0Status\uFEFF . \u00a0state\uFEFF\u00a0', null, 'value');
    expect(bindings).toEqual([
      { signal: 'Status\uFEFF', path: ['state\uFEFF'], target: 'value', mode: 'last' }
    ]);
    expect(normalizeSignalName('\u00a0Status\uFEFF\u00a0')).toBe('Status\uFEFF');
    subscribeSignalBindings(document.createElement('div'), bindings, { value: (value) => values.push(value) });

    emitSignal('Status', { state: 'wrong signal' });
    expect(values).toEqual([]);
    emitSignal('Status\uFEFF', { state: 'wrong path' });
    expect(values).toEqual(['']);
    emitSignal('Status\uFEFF', { 'state\uFEFF': 'exact' });

    expect(values).toEqual(['', 'exact']);
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
    emitSignal('Status', { ready: true, override: false });
    emitSignal('Status', { ready: false, override: false });

    expect(values).toEqual(['true', 'true', 'false']);
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

  it('matches exact single and plural scalar visibility values from nested paths', () => {
    document.body.innerHTML = `
      <nodel-row id="mode" visibility="Status.mode" visible-value="Presentation"></nodel-row>
      <nodel-row id="plural" visibility="Status.mode" visible-values=" ; Preview ; Presentation ; Presentation ; "></nodel-row>
      <nodel-row id="combined" visibility="Status.mode" visible-value="Emergency" visible-values="Preview; Presentation"></nodel-row>
      <nodel-row id="number" visibility="Count" visible-value="1"></nodel-row>
      <nodel-row id="boolean" visibility="Flag" visible-value="true"></nodel-row>
      <nodel-row id="object" visibility="Status" visible-value="Presentation"></nodel-row>
      <nodel-row id="missing" visibility="Status.missing" visible-value="Presentation"></nodel-row>
      <nodel-row id="array" visibility="Items" visible-value="one"></nodel-row>
      <nodel-row id="null" visibility="NullValue" visible-value="null"></nodel-row>
      <nodel-row id="escaped" visibility="Device\\.Status.details\\.mode" visible-value="Presentation"></nodel-row>
    `;

    bindingHost = bootstrapSignalVisibilityBindings();
    const element = (id: string) => document.querySelector<HTMLElement>(`#${id}`)!;

    for (const id of ['mode', 'plural', 'combined', 'number', 'boolean', 'object', 'missing', 'array', 'null', 'escaped']) {
      expect(element(id).hidden).toBe(true);
    }

    emitSignal('Status', { mode: 'Presentation' });
    expect(element('mode').hidden).toBe(false);
    expect(element('plural').hidden).toBe(false);
    expect(element('combined').hidden).toBe(false);
    expect(element('object').hidden).toBe(true);
    expect(element('missing').hidden).toBe(true);

    emitSignal('Count', 1);
    emitSignal('Flag', true);
    emitSignal('Items', ['one']);
    emitSignal('NullValue', null);
    emitSignal('Device.Status', { 'details.mode': 'Presentation' });
    expect(element('number').hidden).toBe(false);
    expect(element('boolean').hidden).toBe(false);
    expect(element('array').hidden).toBe(true);
    expect(element('null').hidden).toBe(true);
    expect(element('escaped').hidden).toBe(false);

    emitSignal('Count', ' 1 ');
    emitSignal('Flag', 'TRUE');
    expect(element('number').hidden).toBe(true);
    expect(element('boolean').hidden).toBe(true);

    emitSignal('Status', { mode: 'presentation' });
    expect(element('mode').hidden).toBe(true);
    expect(element('plural').hidden).toBe(true);

    emitSignal('Status', { mode: 'Preview' });
    expect(element('mode').hidden).toBe(true);
    expect(element('plural').hidden).toBe(false);
    expect(element('combined').hidden).toBe(false);

    emitSignal('Status', { mode: 'Emergency' });
    expect(element('combined').hidden).toBe(false);
  });

  it('applies exact visibility predicates to any, all, and last-event modes', () => {
    document.body.innerHTML = `
      <nodel-row id="any" signals="A:visibility(any); B:visibility(any)" visible-values="Ready; Standby"></nodel-row>
      <nodel-row id="all" signals="A:visibility(all); B:visibility(all)" visible-values="Ready; Standby"></nodel-row>
      <nodel-row id="last" signals="A:visibility; B:visibility" visible-value="Ready"></nodel-row>
    `;

    bindingHost = bootstrapSignalVisibilityBindings();
    const any = document.querySelector<HTMLElement>('#any')!;
    const all = document.querySelector<HTMLElement>('#all')!;
    const last = document.querySelector<HTMLElement>('#last')!;
    expect(any.hidden).toBe(true);
    expect(all.hidden).toBe(true);
    expect(last.hidden).toBe(true);

    emitSignal('B', 'Ready');
    expect(any.hidden).toBe(false);
    expect(all.hidden).toBe(true);
    expect(last.hidden).toBe(false);

    emitSignal('A', 'Ready');
    expect(any.hidden).toBe(false);
    expect(all.hidden).toBe(false);
    expect(last.hidden).toBe(false);

    emitSignal('A', 'Other');
    expect(any.hidden).toBe(false);
    expect(all.hidden).toBe(true);
    expect(last.hidden).toBe(true);

    emitSignal('B', 'Other');
    expect(any.hidden).toBe(true);
    expect(all.hidden).toBe(true);
    expect(last.hidden).toBe(true);

    emitSignal('A', 'Standby');
    expect(any.hidden).toBe(false);
    expect(all.hidden).toBe(true);
    expect(last.hidden).toBe(true);

    emitSignalBatch([
      { alias: 'A', arg: 'Ready', seq: 10 },
      { alias: 'B', arg: 'Other', seq: 11 },
      { alias: 'A', arg: 'Other', seq: 12 }
    ]);
    expect(last.hidden).toBe(true);
  });

  it('rebinds changed visibility attributes and restores authored hidden state', async () => {
    document.body.innerHTML = `
      <nodel-row id="dynamic" visibility="Mode"></nodel-row>
      <nodel-row id="authored-hidden" hidden visibility="Mode" visible-value="Presentation"></nodel-row>
    `;

    bindingHost = bootstrapSignalVisibilityBindings();
    const dynamic = document.querySelector<HTMLElement>('#dynamic')!;
    const authoredHidden = document.querySelector<HTMLElement>('#authored-hidden')!;

    expect(dynamic.hidden).toBe(false);
    expect(authoredHidden.hidden).toBe(true);
    emitSignal('Mode', 'visible');
    expect(dynamic.hidden).toBe(false);

    dynamic.setAttribute('visible-value', 'Presentation');
    await flush();
    expect(dynamic.hidden).toBe(true);
    emitSignal('Mode', 'Presentation');
    expect(dynamic.hidden).toBe(false);

    dynamic.setAttribute('visible-values', 'Preview; Presentation');
    dynamic.removeAttribute('visible-value');
    await flush();
    expect(dynamic.hidden).toBe(true);
    emitSignal('Mode', 'Preview');
    expect(dynamic.hidden).toBe(false);

    dynamic.removeAttribute('visible-values');
    await flush();
    expect(dynamic.hidden).toBe(false);
    dynamic.setAttribute('visibility', 'NewMode');
    await flush();
    emitSignal('Mode', 'hidden');
    expect(dynamic.hidden).toBe(false);
    emitSignal('NewMode', 'hidden');
    expect(dynamic.hidden).toBe(true);

    dynamic.removeAttribute('visibility');
    dynamic.setAttribute('signals', 'ThirdMode:visibility');
    await flush();
    expect(dynamic.hidden).toBe(false);
    emitSignal('NewMode', 'hidden');
    expect(dynamic.hidden).toBe(false);
    emitSignal('ThirdMode', 'hidden');
    expect(dynamic.hidden).toBe(true);

    dynamic.removeAttribute('signals');
    authoredHidden.removeAttribute('visibility');
    await flush();
    expect(dynamic.hidden).toBe(false);
    expect(authoredHidden.hidden).toBe(true);
    expect(activityMock.listeners).toHaveLength(0);
  });

  it('cleans pending attribute and subtree removals when bootstrap is disposed', () => {
    document.body.innerHTML = `
      <div id="container">
        <nodel-row id="pending-attribute" visibility="Mode" visible-value="Presentation"></nodel-row>
        <nodel-row id="pending-removal" hidden visibility="Mode" visible-value="Presentation"></nodel-row>
      </div>
    `;

    bindingHost = bootstrapSignalVisibilityBindings();
    const pendingAttribute = document.querySelector<HTMLElement>('#pending-attribute')!;
    const pendingRemoval = document.querySelector<HTMLElement>('#pending-removal')!;
    emitSignal('Mode', 'Presentation');
    expect(pendingAttribute.hidden).toBe(false);
    expect(pendingRemoval.hidden).toBe(false);

    pendingAttribute.removeAttribute('visibility');
    document.querySelector('#container')?.remove();
    bindingHost.dispose();
    bindingHost = null;

    expect(pendingAttribute.hidden).toBe(false);
    expect(pendingRemoval.hidden).toBe(true);
    expect(activityMock.listeners).toHaveLength(0);
  });

  it('restores authored hidden state when visibility bootstrap is disposed', () => {
    document.body.innerHTML = `
      <nodel-row id="visible-authored" visibility="Mode" visible-value="Presentation"></nodel-row>
      <nodel-row id="hidden-authored" hidden visibility="Mode" visible-value="Presentation"></nodel-row>
    `;

    bindingHost = bootstrapSignalVisibilityBindings();
    const visibleAuthored = document.querySelector<HTMLElement>('#visible-authored')!;
    const hiddenAuthored = document.querySelector<HTMLElement>('#hidden-authored')!;
    emitSignal('Mode', 'Presentation');
    expect(visibleAuthored.hidden).toBe(false);
    expect(hiddenAuthored.hidden).toBe(false);

    bindingHost.dispose();
    bindingHost = null;
    expect(visibleAuthored.hidden).toBe(false);
    expect(hiddenAuthored.hidden).toBe(true);
    expect(activityMock.listeners).toHaveLength(0);
  });
});
