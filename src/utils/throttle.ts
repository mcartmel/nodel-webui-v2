export interface ThrottledFunction<T extends unknown[]> {
  (...args: T): void;
  cancel(): void;
  flush(): void;
}

export function throttle<T extends unknown[]>(callback: (...args: T) => void, waitMs: number): ThrottledFunction<T> {
  let timer: number | null = null;
  let lastRunAt = 0;
  let pendingArgs: T | null = null;

  const run = (args: T) => {
    lastRunAt = Date.now();
    callback(...args);
  };

  const throttled = ((...args: T) => {
    const elapsed = Date.now() - lastRunAt;
    pendingArgs = args;

    if (elapsed >= waitMs || lastRunAt === 0) {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      const nextArgs = pendingArgs;
      pendingArgs = null;
      run(nextArgs);
      return;
    }

    if (timer === null) {
      timer = window.setTimeout(() => {
        timer = null;
        if (pendingArgs) {
          const nextArgs = pendingArgs;
          pendingArgs = null;
          run(nextArgs);
        }
      }, waitMs - elapsed);
    }
  }) as ThrottledFunction<T>;

  throttled.cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    pendingArgs = null;
  };

  throttled.flush = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (pendingArgs) {
      const nextArgs = pendingArgs;
      pendingArgs = null;
      run(nextArgs);
    }
  };

  return throttled;
}
