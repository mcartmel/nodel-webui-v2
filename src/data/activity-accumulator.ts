export interface ActivityAccumulatorItem<T> {
  key: string;
  value: T;
  changed: boolean;
  live: boolean;
}

export interface ActivityAccumulatorOptions {
  flushIntervalMs?: number;
}

type FlushListener<T> = (items: ActivityAccumulatorItem<T>[]) => void;

export function createActivityAccumulator<T>(listener: FlushListener<T>, options: ActivityAccumulatorOptions = {}) {
  const flushIntervalMs = options.flushIntervalMs ?? 100;
  const pending = new Map<string, ActivityAccumulatorItem<T>>();
  let flushTimer: number | null = null;

  function clearTimer() {
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function flush() {
    clearTimer();
    if (pending.size === 0) {
      return;
    }

    const items = Array.from(pending.values());
    pending.clear();
    listener(items);
  }

  function scheduleFlush() {
    if (flushTimer !== null) {
      return;
    }

    flushTimer = window.setTimeout(() => {
      flush();
    }, flushIntervalMs);
  }

  return {
    enqueue(item: ActivityAccumulatorItem<T>) {
      pending.set(item.key, item);
      scheduleFlush();
    },
    flush,
    clear() {
      pending.clear();
      clearTimer();
    },
    size() {
      return pending.size;
    }
  };
}
