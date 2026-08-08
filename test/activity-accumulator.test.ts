import { createActivityAccumulator } from '../src/data/activity-accumulator';

describe('activity-accumulator', () => {
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
    expect(getMockCallArg<Array<{ key: string; value: { seq: number }; changed: boolean; live: boolean }>>(listener, 0, 0, 'coalescing flush callback')).toEqual([
      { key: 'local_action_power', value: { seq: 2 }, changed: true, live: true },
      { key: 'remote_event_level', value: { seq: 3 }, changed: true, live: true }
    ]);
    expect(accumulator.size()).toBe(0);
  });

  it('orders interleaved coalesced updates by their latest occurrence', () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const accumulator = createActivityAccumulator(listener, { flushIntervalMs: 100 });

    accumulator.enqueue({ key: 'local_event_a', value: { seq: 1 }, changed: true, live: true });
    accumulator.enqueue({ key: 'local_event_b', value: { seq: 2 }, changed: true, live: true });
    accumulator.enqueue({ key: 'local_event_a', value: { seq: 3 }, changed: true, live: true });
    vi.advanceTimersByTime(100);

    expect(getMockCallArg<Array<{ value: { seq: number } }>>(listener, 0, 0, 'ordering flush callback').map((item) => item.value.seq)).toEqual([2, 3]);
  });

  it('caps pending activity and retains the newest queued keys', () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    const accumulator = createActivityAccumulator(listener, { flushIntervalMs: 100, maxItems: 3 });

    for (let seq = 1; seq <= 5; seq += 1) {
      accumulator.enqueue({ key: `entry-${seq}`, value: { seq }, changed: true, live: true });
    }

    expect(accumulator.size()).toBe(3);
    vi.advanceTimersByTime(100);
    expect(getMockCallArg<Array<{ value: { seq: number } }>>(listener, 0, 0, 'cap overflow flush callback').map((item) => item.value.seq)).toEqual([3, 4, 5]);
  });
});
