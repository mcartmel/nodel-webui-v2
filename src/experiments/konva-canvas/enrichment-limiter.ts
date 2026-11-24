export interface EnrichmentClock {
  now(): number;
  setTimer(callback: () => void, delay: number): number;
  clearTimer(handle: number): void;
}

export const enrichmentClock: EnrichmentClock = {
  now: () => performance.now(),
  setTimer: (callback, delay) => window.setTimeout(callback, delay),
  clearTimer: (handle) => window.clearTimeout(handle)
};

const physicalLimit = 4;
const tokenInterval = 250;

/** Shared for the viewing session, including an old generation's aborted I/O. */
export function createEnrichmentLimiter(clock: EnrichmentClock = enrichmentClock) {
  let tokens = physicalLimit;
  let updatedAt = clock.now();
  let active = 0;
  let wakeTimer: number | undefined;
  const listeners = new Set<() => void>();
  const remoteByOrigin = new Map<string, number>();
  const refill = () => {
    const now = clock.now();
    tokens = Math.min(physicalLimit, tokens + Math.max(0, now - updatedAt) / tokenInterval);
    updatedAt = now;
  };

  function notify() {
    for (const listener of [...listeners]) listener();
  }

  return {
    get active() { return active; },
    remoteActive(origin: string) { return remoteByOrigin.get(origin) ?? 0; },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && wakeTimer !== undefined) {
          clock.clearTimer(wakeTimer);
          wakeTimer = undefined;
        }
      };
    },
    /** Release only in the physical promise's settlement path, not on abort/deadline. */
    tryStart(remoteOrigin?: string) {
      if (active >= physicalLimit) return undefined;
      refill();
      if (tokens < 1) {
        if (listeners.size && wakeTimer === undefined) {
          wakeTimer = clock.setTimer(() => { wakeTimer = undefined; notify(); }, Math.max(1, Math.ceil((1 - tokens) * tokenInterval)));
        }
        return undefined;
      }
      tokens -= 1;
      active += 1;
      if (remoteOrigin !== undefined) remoteByOrigin.set(remoteOrigin, (remoteByOrigin.get(remoteOrigin) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
        if (remoteOrigin !== undefined) {
          const remaining = remoteByOrigin.get(remoteOrigin)! - 1;
          if (remaining) remoteByOrigin.set(remoteOrigin, remaining);
          else remoteByOrigin.delete(remoteOrigin);
        }
        notify();
      };
    }
  };
}

export type EnrichmentLimiter = ReturnType<typeof createEnrichmentLimiter>;

const pageLimiterKey = Symbol.for('nodel-webui-v2.konva.physical-enrichment-limiter');

/** Reuse one physical limiter for every Stage-A/Stage-B generation in a retained page. */
export function getPageEnrichmentLimiter(scope: object = window): EnrichmentLimiter {
  const registry = scope as { [key: symbol]: EnrichmentLimiter | undefined };
  return registry[pageLimiterKey] ??= createEnrichmentLimiter();
}
