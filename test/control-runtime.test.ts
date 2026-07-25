const runtimeMock = vi.hoisted(() => ({
  callNodeAction: vi.fn(),
  subscribeNodeActivity: vi.fn()
}));

vi.mock('../src/api/nodel-host-client', () => ({
  callNodeAction: runtimeMock.callNodeAction
}));

vi.mock('../src/data/node-activity-source', () => ({
  subscribeNodeActivity: runtimeMock.subscribeNodeActivity
}));

import type { NodelActivityLogEntry } from '../src/api/nodel-types';
import { getControlRuntime, installControlRuntime } from '../src/data/control-runtime';
import { busyDelayMs, createCatalogueRuntime, initialSignals } from '../src/catalogue/runtime';

function activityEntry(alias: string, arg: unknown): NodelActivityLogEntry {
  return {
    seq: 4,
    timestamp: '2026-07-25T00:00:00.000Z',
    source: 'local',
    type: 'event',
    alias,
    arg
  };
}

describe('control runtime', () => {
  beforeEach(() => {
    runtimeMock.callNodeAction.mockReset().mockResolvedValue({ ok: true });
    runtimeMock.subscribeNodeActivity.mockReset();
  });

  it('delegates the default action runtime to the node API', async () => {
    const result = await getControlRuntime().callAction('Power', { arg: true });

    expect(runtimeMock.callNodeAction).toHaveBeenCalledWith('Power', { arg: true });
    expect(result).toEqual({ ok: true });
  });

  it('preserves default action failures', async () => {
    const error = new Error('No route');
    runtimeMock.callNodeAction.mockRejectedValue(error);

    await expect(getControlRuntime().callAction('Missing', {})).rejects.toBe(error);
  });

  it('maps default activity batches to signal runtime entries and disposes them', () => {
    const dispose = vi.fn();
    let sourceListener: ((state: any) => void) | undefined;
    runtimeMock.subscribeNodeActivity.mockImplementation((_element: HTMLElement, listener: (state: any) => void) => {
      sourceListener = listener;
      return { dispose };
    });
    const states: any[] = [];
    const subscription = getControlRuntime().subscribeSignals(document.createElement('div'), (state) => states.push(state));
    const entry = activityEntry('Power', true);

    sourceListener?.({ loading: false, connected: true, error: '', batch: { items: [{ entry }] } });

    expect(states).toEqual([{ loading: false, connected: true, error: '', entries: [entry] }]);
    subscription.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('installs and restores a runtime override', async () => {
    const override = {
      callAction: vi.fn().mockResolvedValue('override'),
      subscribeSignals: vi.fn()
    };
    const restore = installControlRuntime(override);

    expect(getControlRuntime()).toBe(override);
    await expect(getControlRuntime().callAction('Demo', {})).resolves.toBe('override');
    restore();
    expect(getControlRuntime()).not.toBe(override);
  });
});

describe('catalogue runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replays seeded signals to new subscribers', () => {
    const runtime = createCatalogueRuntime();
    const states: any[] = [];

    runtime.subscribeSignals(document.createElement('div'), (state) => states.push(state));

    expect(states[0]).toMatchObject({ loading: false, connected: true, error: '' });
    expect(states[0].entries.map((entry: NodelActivityLogEntry) => entry.alias)).toEqual(Object.keys(initialSignals));
  });

  it('keeps source and current-source signals synchronized', async () => {
    const runtime = createCatalogueRuntime();
    const aliases: string[] = [];
    runtime.subscribeSignals(document.createElement('div'), (state) => {
      for (const entry of state.entries) {
        aliases.push(`${entry.alias}:${entry.arg}`);
      }
    });

    await runtime.callAction('SetSource', { arg: 'TV' });

    expect(aliases.slice(-2)).toEqual(['Source:TV', 'CurrentSource:TV']);
  });

  it('handles explicit mappings, generated setters, and unknown actions', async () => {
    const runtime = createCatalogueRuntime();
    const updates: Array<[string, unknown]> = [];
    runtime.subscribeSignals(document.createElement('div'), (state) => {
      for (const entry of state.entries) {
        updates.push([entry.alias, entry.arg]);
      }
    });

    await runtime.callAction('SetPower', { arg: true });
    await runtime.callAction('StartShow', {});
    await runtime.callAction('RestartNetwork', {});
    await runtime.callAction('SetLevel2', { arg: 75 });
    await runtime.callAction('UnknownCatalogueAction', {});

    expect(updates.slice(-4)).toEqual([
      ['Power', true],
      ['ShowRunning', true],
      ['NetworkStatus', { level: 0, message: 'Network ready' }],
      ['Level2', 75]
    ]);
  });

  it('does not notify disposed subscribers and keeps busy actions bounded', async () => {
    const runtime = createCatalogueRuntime();
    const listener = vi.fn();
    const subscription = runtime.subscribeSignals(document.createElement('div'), listener);
    listener.mockClear();
    subscription.dispose();

    await runtime.callAction('SetPower', { arg: true });
    expect(listener).not.toHaveBeenCalled();

    const action = runtime.callAction('CatalogueBusy', {});
    await vi.advanceTimersByTimeAsync(busyDelayMs);
    await expect(action).resolves.toMatchObject({ demo: true, action: 'CatalogueBusy' });
  });
});
