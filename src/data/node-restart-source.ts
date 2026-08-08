import { getNodeRestartStatus } from '../api/nodel-host-client';
import { getNodePathName } from '../utils/node-name';
import { isAbortError } from '../utils/errors';

export interface NodeRestartDetail {
  previousTimestamp: string | null;
  timestamp: string;
}

export type NodeRestartListener = (detail: NodeRestartDetail) => void;

export interface NodeRestartWatcher {
  dispose(): void;
}

export interface NodeRestartPageOwner {
  release(): void;
}

export type NodeRestartExpectationState =
  | 'idle'
  | 'pending'
  | 'unconfirmed'
  | 'refreshing'
  | 'verification-failed';

export type NodeRestartRefreshStatus = 'verified' | 'dirty-preserved' | 'conflict' | 'failed' | 'aborted' | 'superseded';

export type NodeRestartScriptWriteState = NodeRestartExpectationState | 'preparing';

export interface NodeRestartRefreshResult {
  status: NodeRestartRefreshStatus;
  detail?: string;
}

export interface NodeRestartExpectation {
  id: number;
  generation: number;
  baselineTimestamp: string | null;
  state: NodeRestartExpectationState;
  confirmedTimestamp?: string;
  observedAt?: number;
}

export interface NodeRestartRefreshContext {
  expectation: NodeRestartExpectation;
  detail: NodeRestartDetail;
}

export interface PreparedNodeRestartExpectation {
  readonly id: number;
  readonly generation: number;
  readonly baselineTimestamp: string | null;
  readonly replacesExpectationId: number | null;
  readonly replacesExpectationGeneration: number | null;
}

export type NodeRestartEvent =
  | { type: 'restart'; detail: NodeRestartDetail }
  | { type: 'expected-preparing'; expectation: PreparedNodeRestartExpectation }
  | { type: 'expected-pending'; expectation: NodeRestartExpectation }
  | { type: 'expected-timeout'; expectation: NodeRestartExpectation }
  | { type: 'expected-confirmed'; expectation: NodeRestartExpectation; detail: NodeRestartDetail }
  | { type: 'expected-superseded'; expectation: NodeRestartExpectation }
  | { type: 'expected-verified'; expectation: NodeRestartExpectation; result: NodeRestartRefreshResult }
  | { type: 'expected-verification-failed'; expectation: NodeRestartExpectation; result: NodeRestartRefreshResult };

export type NodeRestartEventListener = (event: NodeRestartEvent) => void;

export class NodeRestartExpectationObsoleteError extends Error {
  constructor() {
    super('The script reload expectation is no longer current');
    this.name = 'NodeRestartExpectationObsoleteError';
  }
}

export class NodeRestartScriptWriteBlockedError extends Error {
  constructor() {
    super('Another script.py save is waiting for node reload verification');
    this.name = 'NodeRestartScriptWriteBlockedError';
  }
}

export const NODE_RESTART_EXPECTATION_TIMEOUT_MS = 30_000;
export const NODE_RESTART_LONG_POLL_TIMEOUT_MS = 5_000;
export const NODE_RESTART_POLL_DELAY_MS = 5_000;
export const NODE_RESTART_EXPECTED_RETRY_DELAY_MS = 100;
export const NODE_RESTART_EXPECTED_RETRY_BACKOFF_INITIAL_MS = 250;
export const NODE_RESTART_EXPECTED_RETRY_BACKOFF_MAX_MS = 2_000;
export const NODE_RESTART_UNCONFIRMED_RETRY_DELAY_MS = 1_000;
export const NODE_RESTART_OFFLINE_RETRY_DELAY_MS = 250;

export function isNodePage() {
  return Boolean(getNodePathName());
}

interface InternalExpectation {
  id: number;
  generation: number;
  baselineTimestamp: string | null;
  state: Exclude<NodeRestartExpectationState, 'idle'> | 'idle';
  phase: 'prepared' | 'committed';
  confirmedTimestamp?: string;
  observedTimestamp: string | null;
  replacesExpectationId: number | null;
  replacesExpectationGeneration: number | null;
  observedAt?: number;
  deadlineTimer: number | null;
}

export class NodeRestartExpectationCoordinator {
  private disposed = false;
  private timer: number | null = null;
  private abortController: AbortController | null = null;
  private pollGeneration = 0;
  private pollInFlight = false;
  private lastTimestamp: string | null = null;
  private nextId = 0;
  private nextGeneration = 0;
  private prepareGeneration = 0;
  private preparationAbortController: AbortController | null = null;
  private preparing: InternalExpectation | null = null;
  private prepared: InternalExpectation | null = null;
  private current: InternalExpectation | null = null;
  private expectedFailureRetryDelayMs = NODE_RESTART_EXPECTED_RETRY_BACKOFF_INITIAL_MS;
  private wasOffline = false;
  private pageOwnerCount = 0;
  private listeners = new Set<NodeRestartEventListener>();

  subscribe(listener: NodeRestartEventListener): NodeRestartWatcher {
    if (this.disposed) {
      return { dispose: () => undefined };
    }
    this.listeners.add(listener);
    this.ensurePolling();
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        this.listeners.delete(listener);
        this.stopIfUnused();
      }
    };
  }

  acquirePageOwner(): NodeRestartPageOwner {
    this.pageOwnerCount += 1;
    let released = false;
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.pageOwnerCount = Math.max(0, this.pageOwnerCount - 1);
        if (this.pageOwnerCount === 0) {
          this.clearPageState();
        }
      }
    };
  }

  getExpectation() {
    return this.current ? this.snapshot(this.current) : null;
  }

  getScriptWriteState(): NodeRestartScriptWriteState {
    return this.preparing || this.prepared ? 'preparing' : this.current?.state ?? 'idle';
  }

  async prepare(init?: RequestInit): Promise<PreparedNodeRestartExpectation> {
    if (this.disposed) {
      throw new NodeRestartExpectationObsoleteError();
    }

    if (this.preparing || this.prepared || this.current?.state === 'pending' || this.current?.state === 'refreshing') {
      throw new NodeRestartScriptWriteBlockedError();
    }
    const prepareGeneration = ++this.prepareGeneration;

    const oldExpectation = this.current?.state === 'unconfirmed' ? this.current : null;
    const reservation: InternalExpectation = {
      id: ++this.nextId,
      generation: ++this.nextGeneration,
      baselineTimestamp: null,
      state: 'idle',
      phase: 'prepared',
      observedTimestamp: null,
      replacesExpectationId: oldExpectation?.id ?? null,
      replacesExpectationGeneration: oldExpectation?.generation ?? null,
      deadlineTimer: null
    };
    this.preparing = reservation;
    const preparationAbortController = new AbortController();
    this.preparationAbortController = preparationAbortController;
    const relayAbort = () => preparationAbortController.abort();
    if (init?.signal) {
      if (init.signal.aborted) {
        preparationAbortController.abort();
      } else {
        init.signal.addEventListener('abort', relayAbort, { once: true });
      }
    }
    this.resetExpectedFailureRetryDelay();
    this.emit({ type: 'expected-preparing', expectation: this.snapshotPrepared(reservation) });

    const clearReservation = (superseded: boolean) => {
      if (this.preparing !== reservation) {
        return;
      }
      this.preparing = null;
      if (superseded) {
        this.emit({ type: 'expected-superseded', expectation: this.snapshot(reservation) });
      }
      this.stopIfUnused();
    };

    // Keep an existing expectation alive until the new baseline has been
    // captured. A failed corrective baseline must not make a prior save
    // untrackable.
    let status: { timestamp: string | null };
    try {
      status = await getNodeRestartStatus({ timestamp: null, timeout: 0 }, { ...init, signal: preparationAbortController.signal });
    } catch (error) {
      clearReservation(true);
      throw error;
    } finally {
      if (this.preparationAbortController === preparationAbortController) {
        this.preparationAbortController = null;
      }
      init?.signal?.removeEventListener('abort', relayAbort);
    }
    if (this.disposed || prepareGeneration !== this.prepareGeneration || this.preparing !== reservation) {
      clearReservation(true);
      throw new NodeRestartExpectationObsoleteError();
    }
    if (oldExpectation
      && (this.current !== oldExpectation
        || oldExpectation.id !== reservation.replacesExpectationId
        || oldExpectation.generation !== reservation.replacesExpectationGeneration
        || oldExpectation.state !== 'unconfirmed')) {
      clearReservation(true);
      throw new NodeRestartExpectationObsoleteError();
    }

    const expectation = reservation;
    expectation.baselineTimestamp = typeof status.timestamp === 'string' ? status.timestamp : null;
    if (expectation.observedTimestamp === expectation.baselineTimestamp) {
      expectation.observedTimestamp = null;
    }
    this.preparing = null;
    this.prepared = expectation;
    this.lastTimestamp = expectation.baselineTimestamp;
    this.clearTimer();
    this.ensurePolling();
    return {
      id: expectation.id,
      generation: expectation.generation,
      baselineTimestamp: expectation.baselineTimestamp,
      replacesExpectationId: expectation.replacesExpectationId,
      replacesExpectationGeneration: expectation.replacesExpectationGeneration
    };
  }

  commit(prepared: PreparedNodeRestartExpectation, activate = true): NodeRestartExpectation | null {
    const expectation = this.prepared;
    if (!expectation
      || expectation.id !== prepared.id
      || expectation.generation !== prepared.generation
      || expectation.baselineTimestamp !== prepared.baselineTimestamp
      || expectation.replacesExpectationId !== prepared.replacesExpectationId
      || expectation.replacesExpectationGeneration !== prepared.replacesExpectationGeneration) {
      return null;
    }

    this.prepared = null;
    this.replaceCurrentForCommit();
    expectation.phase = 'committed';
    expectation.state = 'pending';
    expectation.deadlineTimer = window.setTimeout(() => this.timeout(expectation), NODE_RESTART_EXPECTATION_TIMEOUT_MS);
    this.current = expectation;
    this.resetExpectedFailureRetryDelay();
    if (activate) {
      this.activate(expectation.id, expectation.generation);
    }

    return this.snapshot(expectation);
  }

  activate(expectationId: number, generation: number) {
    const expectation = this.current;
    if (!expectation
      || expectation.id !== expectationId
      || expectation.generation !== generation
      || expectation.phase !== 'committed'
      || expectation.state !== 'pending') {
      return false;
    }
    this.emit({ type: 'expected-pending', expectation: this.snapshot(expectation) });
    this.clearTimer();
    this.ensurePolling();
    if (expectation.observedTimestamp && expectation.observedTimestamp !== expectation.baselineTimestamp) {
      this.confirm(expectation, expectation.observedTimestamp);
    }
    return true;
  }

  isPreparedForWrite(prepared: PreparedNodeRestartExpectation) {
    const expectation = this.prepared;
    if (!expectation
      || expectation.id !== prepared.id
      || expectation.generation !== prepared.generation
      || expectation.baselineTimestamp !== prepared.baselineTimestamp
      || expectation.replacesExpectationId !== prepared.replacesExpectationId
      || expectation.replacesExpectationGeneration !== prepared.replacesExpectationGeneration) {
      return false;
    }
    if (prepared.replacesExpectationId === null) {
      return this.current?.state !== 'pending' && this.current?.state !== 'refreshing';
    }
    return Boolean(this.current
      && this.current.id === prepared.replacesExpectationId
      && this.current.generation === prepared.replacesExpectationGeneration
      && this.current.state === 'unconfirmed');
  }

  cancel(prepared: PreparedNodeRestartExpectation | NodeRestartExpectation | null | undefined) {
    if (!prepared) {
      return;
    }

    if (this.prepared
      && this.prepared.id === prepared.id
      && this.prepared.generation === prepared.generation) {
      const preparedExpectation = this.prepared;
      const observed = preparedExpectation.observedTimestamp;
      const baseline = preparedExpectation.baselineTimestamp;
      this.prepared = null;
      this.emit({ type: 'expected-superseded', expectation: this.snapshot(preparedExpectation) });
      this.stopIfUnused();
      if (observed && observed !== baseline && !this.current) {
        this.emitExternalRestart(baseline, observed);
      }
      return;
    }

    if (this.preparing
      && this.preparing.id === prepared.id
      && this.preparing.generation === prepared.generation) {
      this.prepareGeneration += 1;
      this.preparationAbortController?.abort();
      this.preparationAbortController = null;
      this.preparing = null;
      this.emit({ type: 'expected-superseded', expectation: this.snapshot(prepared as InternalExpectation) });
      this.stopIfUnused();
      return;
    }

    if (this.current
      && this.current.id === prepared.id
      && this.current.generation === prepared.generation) {
      const old = this.current;
      this.clearExpectationTimer(old);
      this.current = null;
      this.abortPoll();
      this.emit({ type: 'expected-superseded', expectation: this.snapshot(old) });
      this.stopIfUnused();
    }
  }

  complete(expectationId: number, result: NodeRestartRefreshResult) {
    const expectation = this.current;
    if (!expectation || expectation.id !== expectationId || expectation.state !== 'refreshing') {
      return false;
    }

    expectation.state = result.status === 'verified' || result.status === 'dirty-preserved'
      ? 'idle'
      : 'verification-failed';
    const event = expectation.state === 'idle' ? 'expected-verified' : 'expected-verification-failed';
    this.emit({ type: event, expectation: this.snapshot(expectation), result });
    this.ensurePolling();
    return true;
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.pageOwnerCount = 0;
    this.prepareGeneration += 1;
    this.preparationAbortController?.abort();
    this.preparationAbortController = null;
    this.preparing = null;
    this.prepared = null;
    if (this.current) {
      this.clearExpectationTimer(this.current);
      this.current = null;
    }
    this.clearTimer();
    this.abortPoll();
    this.resetExpectedFailureRetryDelay();
    this.listeners.clear();
  }

  private clearPageState() {
    this.prepareGeneration += 1;
    this.preparationAbortController?.abort();
    this.preparationAbortController = null;
    const preparing = this.preparing;
    const prepared = this.prepared;
    const current = this.current;
    this.preparing = null;
    this.prepared = null;
    this.current = null;
    if (preparing) {
      this.emit({ type: 'expected-superseded', expectation: this.snapshot(preparing) });
    }
    if (prepared) {
      this.emit({ type: 'expected-superseded', expectation: this.snapshot(prepared) });
    }
    if (current) {
      this.clearExpectationTimer(current);
      this.emit({ type: 'expected-superseded', expectation: this.snapshot(current) });
    }
    this.lastTimestamp = null;
    this.abortPoll();
    this.resetExpectedFailureRetryDelay();
  }

  private snapshot(expectation: InternalExpectation): NodeRestartExpectation {
    return {
      id: expectation.id,
      generation: expectation.generation,
      baselineTimestamp: expectation.baselineTimestamp,
      state: expectation.state,
      ...(expectation.confirmedTimestamp ? { confirmedTimestamp: expectation.confirmedTimestamp } : {}),
      ...(expectation.observedAt === undefined ? {} : { observedAt: expectation.observedAt })
    };
  }

  private snapshotPrepared(expectation: InternalExpectation): PreparedNodeRestartExpectation {
    return {
      id: expectation.id,
      generation: expectation.generation,
      baselineTimestamp: expectation.baselineTimestamp,
      replacesExpectationId: expectation.replacesExpectationId,
      replacesExpectationGeneration: expectation.replacesExpectationGeneration
    };
  }

  private emit(event: NodeRestartEvent) {
    for (const listener of [...this.listeners]) {
      if (!this.listeners.has(listener)) {
        continue;
      }
      try {
        listener(event);
      } catch (error) {
        window.dispatchEvent(new CustomEvent('nodel-source-listener-error', { detail: { error } }));
      }
    }
  }

  private replaceCurrentForCommit() {
    const old = this.current;
    if (!old || old.state === 'idle') {
      this.current = null;
      this.abortPoll();
      return;
    }
    this.clearExpectationTimer(old);
    this.current = null;
    this.abortPoll();
    this.emit({ type: 'expected-superseded', expectation: this.snapshot(old) });
  }

  private timeout(expectation: InternalExpectation) {
    expectation.deadlineTimer = null;
    if (this.disposed || this.current !== expectation || expectation.state !== 'pending') {
      return;
    }
    expectation.state = 'unconfirmed';
    this.emit({ type: 'expected-timeout', expectation: this.snapshot(expectation) });
    this.ensurePolling();
  }

  private confirm(expectation: InternalExpectation, timestamp: string) {
    if (this.disposed || this.current !== expectation || expectation.phase !== 'committed') {
      return;
    }
    if (expectation.state !== 'pending' && expectation.state !== 'unconfirmed') {
      return;
    }
    this.clearExpectationTimer(expectation);
    expectation.state = 'refreshing';
    expectation.confirmedTimestamp = timestamp;
    expectation.observedAt = Date.now();
    this.lastTimestamp = timestamp;
    this.abortPoll();
    this.emit({
      type: 'expected-confirmed',
      expectation: this.snapshot(expectation),
      detail: {
        previousTimestamp: expectation.baselineTimestamp,
        timestamp
      }
    });
  }

  private recordTimestamp(timestamp: string) {
    const previousTimestamp = this.lastTimestamp;
    this.lastTimestamp = timestamp;

    const tracked = [
      this.current?.state === 'pending' || this.current?.state === 'unconfirmed' ? this.current : null,
      this.preparing,
      this.prepared
    ].filter((expectation): expectation is InternalExpectation => expectation !== null);
    if (tracked.length > 0) {
      for (const expectation of tracked) {
        if (expectation.baselineTimestamp !== timestamp) {
          expectation.observedTimestamp = timestamp;
          if (expectation.phase === 'committed') {
            this.confirm(expectation, timestamp);
          }
        }
      }
      return;
    }

    if (previousTimestamp !== null && previousTimestamp !== timestamp) {
      this.emitExternalRestart(previousTimestamp, timestamp);
    }
  }

  private emitExternalRestart(previousTimestamp: string | null, timestamp: string) {
    this.lastTimestamp = timestamp;
    this.emit({ type: 'restart', detail: { previousTimestamp, timestamp } });
  }

  private ensurePolling() {
    if (this.disposed || this.pollInFlight || this.timer !== null) {
      return;
    }
    if (this.current?.state === 'refreshing') {
      return;
    }
    if (!isNodePage()) {
      this.schedule(NODE_RESTART_POLL_DELAY_MS);
      return;
    }
    if (!navigator.onLine) {
      this.wasOffline = true;
      this.schedule(this.hasExpectedReload() ? NODE_RESTART_OFFLINE_RETRY_DELAY_MS : NODE_RESTART_POLL_DELAY_MS);
      return;
    }
    if (this.wasOffline) {
      this.wasOffline = false;
      this.resetExpectedFailureRetryDelay();
    }
    void this.poll();
  }

  private hasExpectedReload() {
    return this.preparing !== null
      || this.prepared !== null
      || this.current?.state === 'pending'
      || this.current?.state === 'unconfirmed'
      || this.current?.state === 'refreshing';
  }

  private schedule(delayMs: number) {
    this.clearTimer();
    if (this.disposed || (!this.hasListeners() && !this.hasExpectedReload())) {
      return;
    }
    if (this.current?.state === 'refreshing') {
      return;
    }
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.ensurePolling();
    }, Math.max(0, delayMs));
  }

  private hasListeners() {
    return this.listeners.size > 0;
  }

  private clearTimer() {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private clearExpectationTimer(expectation: InternalExpectation) {
    if (expectation.deadlineTimer !== null) {
      window.clearTimeout(expectation.deadlineTimer);
      expectation.deadlineTimer = null;
    }
  }

  private abortPoll() {
    this.pollGeneration += 1;
    this.pollInFlight = false;
    this.abortController?.abort();
    this.abortController = null;
    this.clearTimer();
  }

  private resetExpectedFailureRetryDelay() {
    this.expectedFailureRetryDelayMs = NODE_RESTART_EXPECTED_RETRY_BACKOFF_INITIAL_MS;
  }

  private stopIfUnused() {
    if (!this.hasListeners() && !this.hasExpectedReload()) {
      this.abortPoll();
    } else {
      this.ensurePolling();
    }
  }

  private async poll() {
    if (this.disposed || this.pollInFlight) {
      return;
    }
    if (this.current?.state === 'refreshing') {
      return;
    }
    if (!this.hasListeners() && !this.hasExpectedReload()) {
      return;
    }
    if (!isNodePage() || !navigator.onLine) {
      this.schedule(this.hasExpectedReload() ? NODE_RESTART_OFFLINE_RETRY_DELAY_MS : NODE_RESTART_POLL_DELAY_MS);
      return;
    }

    const generation = ++this.pollGeneration;
    const controller = new AbortController();
    this.abortController = controller;
    this.pollInFlight = true;
    const tracked = this.current?.state === 'pending' || this.current?.state === 'unconfirmed'
      ? this.current
      : this.prepared;
    const timestamp = tracked ? tracked.baselineTimestamp : this.lastTimestamp;
    const expected = Boolean(tracked);
    let pollFailed = false;
    let pollFailureDelayMs = this.expectedFailureRetryDelayMs;

    try {
      const status = await getNodeRestartStatus({
        timestamp,
        timeout: expected ? NODE_RESTART_LONG_POLL_TIMEOUT_MS : timestamp ? NODE_RESTART_LONG_POLL_TIMEOUT_MS : 0
      }, { signal: controller.signal });
      if (this.disposed || generation !== this.pollGeneration || controller.signal.aborted) {
        return;
      }
      if (typeof status.timestamp === 'string') {
        this.recordTimestamp(status.timestamp);
      }
      this.resetExpectedFailureRetryDelay();
    } catch (error) {
      if (this.disposed || generation !== this.pollGeneration || isAbortError(error)) {
        return;
      }
      pollFailed = true;
      pollFailureDelayMs = this.expectedFailureRetryDelayMs;
      this.expectedFailureRetryDelayMs = Math.min(NODE_RESTART_EXPECTED_RETRY_BACKOFF_MAX_MS, pollFailureDelayMs * 2);
    } finally {
      if (generation === this.pollGeneration) {
        this.pollInFlight = false;
        if (this.abortController === controller) {
          this.abortController = null;
        }
        if (this.hasExpectedReload()) {
          this.schedule(pollFailed
            ? pollFailureDelayMs
            : this.current?.state === 'unconfirmed'
              ? NODE_RESTART_UNCONFIRMED_RETRY_DELAY_MS
              : NODE_RESTART_EXPECTED_RETRY_DELAY_MS);
        } else {
          this.schedule(NODE_RESTART_POLL_DELAY_MS);
        }
      }
    }
  }
}

export const nodeRestartCoordinator = new NodeRestartExpectationCoordinator();

export function subscribeNodeRestart(listener: NodeRestartEventListener): NodeRestartWatcher {
  return nodeRestartCoordinator.subscribe(listener);
}

export function acquireNodeRestartPageOwner(): NodeRestartPageOwner {
  return nodeRestartCoordinator.acquirePageOwner();
}

export function prepareNodeRestartExpectation(init?: RequestInit) {
  return nodeRestartCoordinator.prepare(init);
}

export function commitNodeRestartExpectation(prepared: PreparedNodeRestartExpectation, activate = true) {
  return nodeRestartCoordinator.commit(prepared, activate);
}

export function activateNodeRestartExpectation(expectationId: number, generation: number) {
  return nodeRestartCoordinator.activate(expectationId, generation);
}

export function isNodeRestartExpectationPreparedForWrite(prepared: PreparedNodeRestartExpectation) {
  return nodeRestartCoordinator.isPreparedForWrite(prepared);
}

export function cancelNodeRestartExpectation(prepared: PreparedNodeRestartExpectation | NodeRestartExpectation | null | undefined) {
  nodeRestartCoordinator.cancel(prepared);
}

export function completeNodeRestartExpectation(expectationId: number, result: NodeRestartRefreshResult) {
  return nodeRestartCoordinator.complete(expectationId, result);
}

export function getNodeRestartExpectation() {
  return nodeRestartCoordinator.getExpectation();
}

export function getNodeRestartScriptWriteState(): NodeRestartScriptWriteState {
  return nodeRestartCoordinator.getScriptWriteState();
}

export function isNodeRestartScriptWriteBlocked() {
  const state = getNodeRestartScriptWriteState();
  return state === 'preparing' || state === 'pending' || state === 'refreshing';
}

export function watchNodeRestart(listener: NodeRestartListener, eventListener?: NodeRestartEventListener): NodeRestartWatcher {
  return nodeRestartCoordinator.subscribe((event) => {
    eventListener?.(event);
    if (event.type === 'restart') {
      listener(event.detail);
    }
  });
}
