interface PaintFrames {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

interface EnrichmentRun { freeze(): void; resume(): void }

export const REMOTE_ENRICHMENT_BUDGET_MS = 15_000;

export function localInspectionDepth(query: URLSearchParams): 1 | 2 {
  const depth = query.getAll('depth');
  return query.get('source') === 'local' && depth.length === 1 && depth[0] === '2' ? 2 : 1;
}

/** Stage A can recover an interrupted load in the same retained document, but mounts once. */
export function createLocalSnapshotLifetime(load: (signal: AbortSignal) => Promise<void>) {
  let state: 'initial' | 'loading' | 'suspended' | 'settled' | 'disposed' = 'initial';
  let active: AbortController | undefined;

  function start() {
    const attempt = new AbortController();
    active = attempt;
    state = 'loading';
    const settle = () => {
      if (active !== attempt) return;
      active = undefined;
      state = 'settled';
    };
    void load(attempt.signal).then(settle, settle);
  }

  function stop(next: 'suspended' | 'disposed') {
    const attempt = active;
    active = undefined;
    state = next;
    attempt?.abort();
  }

  return {
    start() { if (state === 'initial') start(); },
    suspend() { if (state === 'loading') stop('suspended'); },
    restore() { if (state === 'suspended') start(); },
    dispose() { stop('disposed'); }
  };
}

/** Only the retained, painted document may start Stage B, and only once. */
export function createEnrichmentLifetime(frames: PaintFrames, now = () => performance.now()) {
  const controller = new AbortController();
  let frame: number | undefined;
  let sized = false;
  let fired = false;
  let stopped = false;
  let frozen = false;
  let start: ((deadline: number) => void) | undefined;
  let run: EnrichmentRun | undefined;
  const activeCallbacks: Array<() => void> = [];

  function cancelFrame() {
    if (frame !== undefined) frames.cancel(frame);
    frame = undefined;
  }

  function schedule() {
    if (stopped || frozen || !sized || !start || frame !== undefined) return;
    // ResizeObserver runs before paint. Konva has requested its draw already.
    // Keep one rendering opportunity between that draw and network starts.
    frame = frames.request(() => {
      if (stopped) return;
      frame = frames.request(() => {
        frame = undefined;
        if (stopped) return;
        const callback = start;
        start = undefined;
        fired = true;
        callback?.(now() + REMOTE_ENRICHMENT_BUDGET_MS);
      });
    });
  }

  return {
    get canStart() { return !stopped; },
    get isFrozen() { return frozen; },
    signal: controller.signal,
    sized() { sized = true; schedule(); },
    afterPaint(callback: (deadline: number) => void) { if (!stopped && !fired && !start) { start = callback; schedule(); } },
    /** Defer post-import startup while a persisted document is frozen. */
    whenActive(callback: () => void) {
      if (stopped) return;
      if (frozen) activeCallbacks.push(callback);
      else callback();
    },
    attach(active: EnrichmentRun) {
      if (stopped) return;
      run = active;
      if (frozen) active.freeze();
    },
    finish() { stopped = true; start = undefined; cancelFrame(); run = undefined; activeCallbacks.length = 0; },
    freeze() {
      if (stopped || frozen) return;
      frozen = true;
      cancelFrame();
      // Do not abort the authorisation while the scheduler applies accepted work.
      run?.freeze();
    },
    resume() {
      if (stopped || !frozen) return;
      frozen = false;
      run?.resume();
      const callbacks = activeCallbacks.splice(0);
      for (const callback of callbacks) callback();
      schedule();
    },
    cancel() {
      if (stopped) return;
      stopped = true;
      start = undefined;
      cancelFrame();
      controller.abort();
      run = undefined;
      activeCallbacks.length = 0;
    }
  };
}
