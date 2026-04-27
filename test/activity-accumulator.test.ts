import { createActivityAccumulator } from '../src/data/activity-accumulator';

describe('activity-accumulator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces updates by key before flushing', () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const accumulator = createActivityAccumulator(listener, { flushIntervalMs: 100 });

    accumulator.enqueue({ key: 'local_action_power', value: { seq: 1 }, changed: true, live: true });
    accumulator.enqueue({ key: 'local_action_power', value: { seq: 2 }, changed: true, live: true });
    accumulator.enqueue({ key: 'remote_event_level', value: { seq: 3 }, changed: true, live: true });

    expect(accumulator.size()).toBe(2);
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual([
      { key: 'local_action_power', value: { seq: 2 }, changed: true, live: true },
      { key: 'remote_event_level', value: { seq: 3 }, changed: true, live: true }
    ]);
    expect(accumulator.size()).toBe(0);
  });
});
