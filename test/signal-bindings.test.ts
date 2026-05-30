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

import { bootstrapSignalVisibilityBindings } from '../src/data/signal-bindings';

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
});
