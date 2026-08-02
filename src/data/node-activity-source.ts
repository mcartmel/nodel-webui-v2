import { getNodeActivity } from '../api/nodel-host-client';
import type { NodelActivityLogEntry } from '../api/nodel-types';
import { decodeActivityWebSocketMessage } from '../api/codecs/nodel-codecs';
import { getNodePathName } from '../utils/node-name';
import { createActivityAccumulator } from './activity-accumulator';
import { reportConnectivityFailure } from './connectivity';
import { observeNodelVisibility } from './visibility-scope';
import type { NodelSourceRefreshOptions, NodelSourceRefreshResult } from './nodel-data-runtime';
import { isAbortError, reportBoundedListenerError } from '../utils/errors';

export interface NodeActivityBatch {
  items: Array<{ entry: NodelActivityLogEntry; changed: boolean; live: boolean }>;
  replace: boolean;
  transport: NodeActivityTransport;
  nextSeq: number;
}

export type NodeActivityTransport = 'websocket' | 'poll';
type NodeActivityTransportState = 'idle' | 'connecting' | 'websocket' | 'polling' | 'backoff';

type Listener = (state: {
  loading: boolean;
  connected: boolean;
  error: string;
  batch: NodeActivityBatch | null;
  transport: NodeActivityTransport | null;
}) => void;

interface Subscriber {
  element: HTMLElement;
  visible: boolean;
  listener: Listener;
  disposeVisibility: () => void;
}

const reconnectDelayMs = 5000;
const pollIntervalMs = 1000;
const pollMaxBackoffMs = 15_000;
const pollJitterMs = 250;
const wsConnectionDeadlineMs = 2500;
const maxRetainedActivityEntries = 500;

const subscribers = new Set<Subscriber>();

let loading = true;
let connected = false;
let error = '';
let currentBatch: NodeActivityBatch | null = null;
let lastSeq: number | null = null;
let ws: WebSocket | null = null;
let wsConnectTimer: number | null = null;
let pollTimer: number | null = null;
let pollController: AbortController | null = null;
let pollInFlight: Promise<void> | null = null;
let reconnectTimer: number | null = null;
let lastWsAttemptAt = 0;
let activeState: NodeActivityTransportState = 'idle';
let connectionGeneration = 0;
let activityEpoch = 0;
let pollFailureCount = 0;
const latestEntries = new Map<string, NodelActivityLogEntry>();
const pendingLiveEntries = new Map<string, NodelActivityLogEntry>();
let nextRefreshRequestId = 0;
interface ActivityRefreshWaiter {
  epoch: number;
  resolve: (result: NodelSourceRefreshResult) => void;
  timer: number;
  signal?: AbortSignal;
  abortListener?: () => void;
  settled: boolean;
}

const refreshWaiters = new Map<number, ActivityRefreshWaiter>();
const ACTIVITY_REFRESH_TIMEOUT_MS = 5_000;

function activityEntryKey(entry: NodelActivityLogEntry) {
  return `${entry.source}_${entry.type}_${entry.alias}`;
}

function publicTransport() {
  if (activeState === 'websocket' || activeState === 'connecting') {
    return 'websocket' as const;
  }
  if (activeState === 'polling' || activeState === 'backoff') {
    return 'poll' as const;
  }
  return null;
}

function pollDelay() {
  const backoff = Math.min(pollMaxBackoffMs, pollIntervalMs * Math.max(1, pollFailureCount + 1));
  return backoff + (pollFailureCount > 0 ? Math.floor(Math.random() * pollJitterMs) : 0);
}

function capLatestEntries() {
  while (latestEntries.size > maxRetainedActivityEntries) {
    const firstKey = latestEntries.keys().next().value as string | undefined;
    if (firstKey === undefined) {
      break;
    }
    latestEntries.delete(firstKey);
  }
}

function capPendingLiveEntries() {
  while (pendingLiveEntries.size > maxRetainedActivityEntries) {
    const firstKey = pendingLiveEntries.keys().next().value as string | undefined;
    if (firstKey === undefined) {
      break;
    }
    pendingLiveEntries.delete(firstKey);
  }
}

function timestampMillis(entry: NodelActivityLogEntry) {
  if (typeof entry.timestamp !== 'string') {
    return null;
  }
  const timestamp = Date.parse(entry.timestamp);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isFreshLogicalEntry(entry: NodelActivityLogEntry, existing: NodelActivityLogEntry | undefined) {
  if (!existing) {
    return true;
  }

  const incomingTime = timestampMillis(entry);
  const existingTime = timestampMillis(existing);
  if (incomingTime !== null && existingTime !== null) {
    return incomingTime > existingTime || (incomingTime === existingTime && entry.seq > existing.seq);
  }
  if (incomingTime !== null && existingTime === null) {
    return true;
  }
  if (incomingTime === null && existingTime !== null) {
    return entry.seq > existing.seq;
  }
  return entry.seq > existing.seq;
}

function enqueueLiveEntry(entry: NodelActivityLogEntry) {
  const key = activityEntryKey(entry);
  const existing = pendingLiveEntries.get(key) ?? latestEntries.get(key);
  if (!isFreshLogicalEntry(entry, existing)) {
    return;
  }

  pendingLiveEntries.delete(key);
  pendingLiveEntries.set(key, entry);
  capPendingLiveEntries();
  liveAccumulator.enqueue({
    key,
    value: entry,
    changed: true,
    live: true
  });
}

function cloneBatch(batch: NodeActivityBatch | null): NodeActivityBatch | null {
  if (!batch) {
    return null;
  }
  return {
    ...batch,
    items: batch.items.map((item) => ({ ...item, entry: { ...item.entry } }))
  };
}

function updateCurrentBatch(batch: NodeActivityBatch) {
  if (batch.replace) {
    latestEntries.clear();
  }
  for (const item of batch.items) {
    const key = activityEntryKey(item.entry);
    latestEntries.delete(key);
    latestEntries.set(key, item.entry);
  }
  capLatestEntries();
  currentBatch = {
    items: Array.from(latestEntries.values(), (entry) => ({ entry, changed: false, live: false })),
    replace: true,
    transport: batch.transport,
    nextSeq: batch.nextSeq
  };
}

const liveAccumulator = createActivityAccumulator<NodelActivityLogEntry>((items) => {
  if (items.length === 0) {
    return;
  }

  const freshItems = items.filter((item) => {
    if (pendingLiveEntries.get(item.key) === item.value) {
      pendingLiveEntries.delete(item.key);
    }
    return isFreshLogicalEntry(item.value, latestEntries.get(item.key));
  });
  if (freshItems.length === 0) {
    return;
  }

  const entries = freshItems.map((item) => item.value);
  const nextSeq = Math.max(lastSeq ?? 0, Math.max(...entries.map((entry) => entry.seq)) + 1);
  lastSeq = nextSeq;
  emit({
    items: freshItems.map((item) => ({ entry: item.value, changed: item.changed, live: item.live })),
    replace: false,
    transport: 'websocket',
    nextSeq
  });
}, { maxItems: maxRetainedActivityEntries });

function isVisible() {
  if (document.hidden || !navigator.onLine) {
    return false;
  }

  return Array.from(subscribers).some((subscriber) => subscriber.visible);
}

function clearTimer(timer: number | null) {
  if (timer !== null) {
    window.clearTimeout(timer);
  }
}

function clearPollTimer() {
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function resetConnection() {
  activityEpoch += 1;
  connectionGeneration += 1;
  liveAccumulator.clear();
  pendingLiveEntries.clear();
  clearPollTimer();
  clearReconnectTimer();
  clearTimer(wsConnectTimer);
  wsConnectTimer = null;
  pollController?.abort();
  pollController = null;
  pollInFlight = null;
  if (ws) {
    try {
      ws.close();
    } catch {
      // ignore
    }
    ws = null;
  }
  activeState = 'idle';
  pollFailureCount = 0;
  connected = false;
}

function resetActivitySource(keepRequestId?: number) {
  settleAllRefreshWaiters({ status: 'superseded', detail: 'The activity refresh was superseded.' }, keepRequestId);
  liveAccumulator.clear();
  latestEntries.clear();
  lastSeq = null;
  currentBatch = null;
  loading = true;
  error = '';
  resetConnection();
  emit(null, '');
  evaluate();
}

function settleRefreshWaiters(result: NodelSourceRefreshResult, epoch = activityEpoch, keepRequestId?: number) {
  for (const [requestId, waiter] of [...refreshWaiters]) {
    if (requestId === keepRequestId || waiter.epoch !== epoch) {
      continue;
    }
    window.clearTimeout(waiter.timer);
    refreshWaiters.delete(requestId);
    waiter.settled = true;
    if (waiter.signal && waiter.abortListener) {
      waiter.signal.removeEventListener('abort', waiter.abortListener);
    }
    waiter.resolve(result);
  }
}

function settleAllRefreshWaiters(result: NodelSourceRefreshResult, keepRequestId?: number) {
  for (const [requestId, waiter] of [...refreshWaiters]) {
    if (requestId === keepRequestId) {
      continue;
    }
    window.clearTimeout(waiter.timer);
    refreshWaiters.delete(requestId);
    waiter.settled = true;
    if (waiter.signal && waiter.abortListener) {
      waiter.signal.removeEventListener('abort', waiter.abortListener);
    }
    waiter.resolve(result);
  }
}

function emit(batch: NodeActivityBatch | null, nextError = error) {
  if (batch) {
    updateCurrentBatch(batch);
    loading = false;
    error = '';
    settleRefreshWaiters({ status: 'verified' });
  } else if (nextError !== error) {
    error = nextError;
  }

  const epoch = activityEpoch;
  for (const subscriber of [...subscribers]) {
    if (!subscribers.has(subscriber)) {
      continue;
    }
    try {
      subscriber.listener({
        loading,
        connected,
        error,
        batch: cloneBatch(batch),
        transport: publicTransport()
      });
    } catch (listenerError) {
      reportBoundedListenerError('nodel-source-listener-error', listenerError, 'node-activity-source');
    }
    if (epoch !== activityEpoch) {
      return;
    }
  }
}

function normalizeEntries(entries: NodelActivityLogEntry[]) {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const deduped = new Map<string, NodelActivityLogEntry>();

  for (const entry of sorted) {
    const key = activityEntryKey(entry);
    deduped.delete(key);
    deduped.set(key, entry);
  }

  return Array.from(deduped.values());
}

function nextSeqFrom(entries: NodelActivityLogEntry[], fallback: number | null) {
  if (entries.length === 0) {
    return fallback ?? 0;
  }

  return Math.max(fallback ?? 0, Math.max(...entries.map((entry) => entry.seq)) + 1);
}

function activityNodeName() {
  return getNodePathName();
}

function shouldRun() {
  return Boolean(activityNodeName()) && isVisible() && subscribers.size > 0;
}

function canForceRestartRefresh() {
  return Boolean(activityNodeName()) && !document.hidden && navigator.onLine && subscribers.size > 0;
}

function abortResult(signal?: AbortSignal): NodelSourceRefreshResult | null {
  return signal?.aborted ? { status: 'aborted', detail: 'The activity refresh was aborted.' } : null;
}

async function forceRefreshActivityForRestart(options: NodelSourceRefreshOptions): Promise<NodelSourceRefreshResult> {
  const aborted = abortResult(options.signal);
  if (aborted) {
    return aborted;
  }
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  options.signal?.addEventListener('abort', relayAbort, { once: true });
  try {
    const entries = await getNodeActivity({ from: -1 }, { signal: controller.signal });
    if (options.signal?.aborted || controller.signal.aborted) {
      return { status: 'aborted', detail: 'The activity refresh was aborted.' };
    }
    const normalized = normalizeEntries(entries);
    lastSeq = normalized.length > 0 ? nextSeqFrom(normalized, null) : 0;
    emit({
      items: normalized.map((entry) => ({ entry, changed: false, live: false })),
      replace: true,
      transport: 'poll',
      nextSeq: lastSeq
    });
    return { status: 'verified' };
  } catch (caught) {
    if (options.signal?.aborted || controller.signal.aborted || isAbortError(caught)) {
      return { status: 'aborted', detail: 'The activity refresh was aborted.' };
    }
    const detail = caught instanceof Error ? caught.message : 'Failed to refresh activity';
    error = detail;
    emit(null, detail);
    return { status: 'failed', detail };
  } finally {
    options.signal?.removeEventListener('abort', relayAbort);
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  if (!shouldRun() || activeState === 'websocket' || activeState === 'connecting') {
    return;
  }

  activeState = 'backoff';
  const generation = connectionGeneration;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (generation === connectionGeneration) {
      void openWebSocket();
    }
  }, reconnectDelayMs);
}

function runPoll() {
  if (!shouldRun()) {
    return Promise.resolve();
  }
  if (pollInFlight) {
    return pollInFlight;
  }

  activeState = 'polling';
  const generation = connectionGeneration;
  const controller = new AbortController();
  pollController = controller;
  connected = false;
  emit(null);

  const request = (async () => {
    try {
      const from = lastSeq === null ? -1 : lastSeq;
      const entries = await getNodeActivity({ from }, { signal: controller.signal });
      if (!shouldRun() || generation !== connectionGeneration || controller.signal.aborted || activeState !== 'polling') {
        return;
      }

      const normalized = normalizeEntries(entries);
      if (normalized.length > 0) {
        lastSeq = nextSeqFrom(normalized, lastSeq);
      } else if (lastSeq === null) {
        lastSeq = 0;
      }
      pollFailureCount = 0;

      emit({
        items: normalized.map((entry) => ({ entry, changed: false, live: false })),
        replace: from === -1,
        transport: 'poll',
        nextSeq: lastSeq ?? 0
      });
    } catch (pollError) {
      if (generation !== connectionGeneration || controller.signal.aborted) {
        return;
      }
      error = pollError instanceof Error ? pollError.message : 'Failed to load activity';
      pollFailureCount += 1;
      activeState = 'backoff';
      emit(null);
      settleRefreshWaiters({ status: 'failed', detail: error });
    } finally {
      if (!shouldRun() || generation !== connectionGeneration || controller.signal.aborted || (activeState !== 'polling' && activeState !== 'backoff')) {
        return;
      }
      clearPollTimer();

      if (Date.now() - lastWsAttemptAt >= reconnectDelayMs) {
        void openWebSocket();
        return;
      }

      pollTimer = window.setTimeout(() => {
        pollTimer = null;
        void runPoll();
      }, pollDelay());
    }
  })();
  pollInFlight = request;
  void request.finally(() => {
    if (pollInFlight === request) {
      pollInFlight = null;
      pollController = null;
    }
  });
  return request;
}

function handleWebSocketMessage(message: MessageEvent<string>) {
  try {
    const data = decodeActivityWebSocketMessage(JSON.parse(message.data) as unknown, 'WebSocket activity');
    error = '';
    if (data.error) {
      error = data.error;
      emit(null);
      settleRefreshWaiters({ status: 'failed', detail: data.error });
      return;
    }

    if (Array.isArray(data.activityHistory)) {
      const normalized = normalizeEntries(data.activityHistory);
      if (lastSeq !== null && normalized.length > 0 && Math.max(...normalized.map((entry) => entry.seq)) + 1 <= lastSeq) {
        return;
      }
      liveAccumulator.clear();
      pendingLiveEntries.clear();
      lastSeq = nextSeqFrom(normalized, lastSeq);
      emit({
        items: normalized.map((entry) => ({ entry, changed: false, live: false })),
        replace: true,
        transport: 'websocket',
        nextSeq: lastSeq ?? 0
      });
      return;
    }

    if (data.activity) {
      enqueueLiveEntry(data.activity);
    }
  } catch (caught) {
    error = (caught instanceof Error ? caught.message : 'WebSocket activity returned invalid data').replace(/\s+/g, ' ').slice(0, 500);
    emit(null);
  }
}

async function openWebSocket() {
  const nodeName = activityNodeName();
  if (!nodeName || !shouldRun()) {
    return;
  }

  if (ws || activeState === 'connecting') {
    return;
  }

  lastWsAttemptAt = Date.now();
  clearPollTimer();
  pollController?.abort();
  pollController = null;
  pollInFlight = null;
  activeState = 'connecting';

  const generation = connectionGeneration;
  let socket: WebSocket;
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/nodes/${encodeURIComponent(nodeName)}`;
    socket = new WebSocket(url);
    ws = socket;
  } catch (connectError) {
    reportConnectivityFailure('REST/', connectError);
    error = connectError instanceof Error ? connectError.message : 'Failed to open activity socket';
    ws = null;
    connected = false;
    activeState = 'polling';
    emit(null);
    scheduleReconnect();
    await runPoll();
    return;
  }

  socket.onopen = () => {
    if (ws !== socket || generation !== connectionGeneration) {
      return;
    }
    clearTimer(wsConnectTimer);
    wsConnectTimer = null;
    connected = true;
    activeState = 'websocket';
    error = '';
    emit(null);
  };

  socket.onmessage = (message) => {
    if (ws === socket && generation === connectionGeneration) {
      handleWebSocketMessage(message);
    }
  };

  socket.onerror = () => {
    if (ws !== socket || generation !== connectionGeneration) {
      return;
    }
    reportConnectivityFailure('REST/', new TypeError('WebSocket activity stream unavailable'));
    error = 'WebSocket activity stream unavailable';
    clearTimer(wsConnectTimer);
    wsConnectTimer = null;
    ws = null;
    connected = false;
    activeState = 'polling';
    try {
      socket.close();
    } catch {
      // ignore
    }
    emit(null);
    void runPoll();
  };

  socket.onclose = () => {
    if (ws !== socket || generation !== connectionGeneration) {
      return;
    }
    clearTimer(wsConnectTimer);
    wsConnectTimer = null;
    ws = null;
    connected = false;

    if (!shouldRun()) {
      activeState = 'idle';
      emit(null);
      return;
    }

    activeState = 'polling';
    emit(null);
    void runPoll();
  };

  wsConnectTimer = window.setTimeout(() => {
    wsConnectTimer = null;
    if (ws !== socket || generation !== connectionGeneration || connected) {
      return;
    }
    ws = null;
    activeState = 'polling';
    try {
      socket.close();
    } catch {
      // ignore
    }
    error = 'WebSocket activity stream timed out';
    emit(null);
    void runPoll();
  }, wsConnectionDeadlineMs);
}

function evaluate() {
  if (!shouldRun()) {
    resetConnection();
    emit(null);
    return;
  }

  if ((activeState === 'websocket' || activeState === 'connecting') && ws) {
    return;
  }

  if (activeState === 'polling' || activeState === 'backoff') {
    if (!pollTimer && !pollInFlight && !ws) {
      void runPoll();
    }
    return;
  }

  void openWebSocket();
}

export function subscribeNodeActivity(element: HTMLElement, listener: Listener) {
  const subscriber: Subscriber = {
    element,
    visible: false,
    listener,
    disposeVisibility: () => undefined
  };

  subscriber.disposeVisibility = observeNodelVisibility(element, (visible) => {
    subscriber.visible = visible;
    evaluate();
  });

  subscribers.add(subscriber);
  try {
    listener({ loading, connected, error, batch: cloneBatch(currentBatch), transport: publicTransport() });
  } catch (listenerError) {
    reportBoundedListenerError('nodel-source-listener-error', listenerError, 'node-activity-source');
  }
  evaluate();

  let disposed = false;
  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      subscriber.disposeVisibility();
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        resetConnection();
        loading = true;
        currentBatch = null;
        latestEntries.clear();
        pendingLiveEntries.clear();
        lastSeq = null;
        error = '';
      }
    },
    refresh() {
      resetActivitySource();
    }
  };
}

export function refreshNodeActivity() {
  resetActivitySource();
}

export function refreshNodeActivityForRestart(options: NodelSourceRefreshOptions = {}): Promise<NodelSourceRefreshResult> {
  if (options.signal?.aborted) {
    return Promise.resolve({ status: 'aborted', detail: 'The activity refresh was aborted.' });
  }
  if (!shouldRun()) {
    if (options.force && canForceRestartRefresh()) {
      return forceRefreshActivityForRestart(options);
    }
    return Promise.resolve({
      status: subscribers.size === 0 ? 'absent' as const : 'inactive' as const,
      detail: subscribers.size === 0
        ? 'The activity source has no subscribers.'
        : 'The activity source has subscribers but none are active and visible.'
    });
  }

  const requestId = ++nextRefreshRequestId;
  let resolveRequest!: (result: NodelSourceRefreshResult) => void;
  const result = new Promise<NodelSourceRefreshResult>((resolve) => {
    resolveRequest = resolve;
  });
  const timer = window.setTimeout(() => {
    const waiter = refreshWaiters.get(requestId);
    if (!waiter || waiter.settled) {
      return;
    }
    refreshWaiters.delete(requestId);
    waiter.settled = true;
    if (waiter.signal && waiter.abortListener) {
      waiter.signal.removeEventListener('abort', waiter.abortListener);
    }
    waiter.resolve({ status: 'aborted', detail: 'Activity refresh did not settle before its bounded wait expired.' });
  }, ACTIVITY_REFRESH_TIMEOUT_MS);
  const waiter: ActivityRefreshWaiter = {
    epoch: activityEpoch + 1,
    resolve: resolveRequest,
    timer,
    signal: options.signal,
    settled: false,
    abortListener: undefined
  };
  waiter.abortListener = () => {
    if (waiter.settled) {
      return;
    }
    waiter.settled = true;
    refreshWaiters.delete(requestId);
    window.clearTimeout(waiter.timer);
    waiter.resolve({ status: 'aborted', detail: 'The activity refresh was aborted.' });
    if (waiter.epoch === activityEpoch) {
      resetActivitySource();
    }
  };
  options.signal?.addEventListener('abort', waiter.abortListener, { once: true });
  refreshWaiters.set(requestId, waiter);
  resetActivitySource(requestId);
  const activeWaiter = refreshWaiters.get(requestId);
  if (activeWaiter) {
    activeWaiter.epoch = activityEpoch;
  }
  return result;
}
