import { getNodeActivity } from '../api/nodel-host-client';
import type { NodelActivityLogEntry } from '../api/nodel-types';
import { decodeActivityWebSocketMessage } from '../api/codecs/nodel-codecs';
import { getNodePathName } from '../utils/node-name';
import { createActivityAccumulator } from './activity-accumulator';
import { reportConnectivityFailure } from './connectivity';
import { observeNodelVisibility } from './visibility-scope';

export interface NodeActivityBatch {
  items: Array<{ entry: NodelActivityLogEntry; changed: boolean; live: boolean }>;
  replace: boolean;
  transport: NodeActivityTransport;
  nextSeq: number;
}

export type NodeActivityTransport = 'websocket' | 'poll';

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
let activeMode: 'idle' | 'websocket' | 'poll' = 'idle';
let connectionGeneration = 0;
let activityEpoch = 0;
const latestEntries = new Map<string, NodelActivityLogEntry>();

function activityEntryKey(entry: NodelActivityLogEntry) {
  return `${entry.source}_${entry.type}_${entry.alias}`;
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

  const entries = items.map((item) => item.value);
  const nextSeq = Math.max(lastSeq ?? 0, Math.max(...entries.map((entry) => entry.seq)) + 1);
  lastSeq = nextSeq;
  emit({
    items: items.map((item) => ({ entry: item.value, changed: item.changed, live: item.live })),
    replace: false,
    transport: 'websocket',
    nextSeq
  });
});

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
  activeMode = 'idle';
  connected = false;
}

function resetActivitySource() {
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

function emit(batch: NodeActivityBatch | null, nextError = error) {
  if (batch) {
    updateCurrentBatch(batch);
    loading = false;
    error = '';
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
        batch,
        transport: activeMode === 'idle' ? null : activeMode
      });
    } catch (listenerError) {
      window.dispatchEvent(new CustomEvent('nodel-source-listener-error', { detail: { error: listenerError } }));
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

function scheduleReconnect() {
  clearReconnectTimer();
  if (!shouldRun() || activeMode === 'websocket') {
    return;
  }

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

  activeMode = 'poll';
  const generation = connectionGeneration;
  const controller = new AbortController();
  pollController = controller;
  connected = false;
  emit(null);

  const request = (async () => {
    try {
      const from = lastSeq === null ? -1 : lastSeq;
      const entries = await getNodeActivity({ from }, { signal: controller.signal });
      if (!shouldRun() || generation !== connectionGeneration || controller.signal.aborted || activeMode !== 'poll') {
        return;
      }

      const normalized = normalizeEntries(entries);
      if (normalized.length > 0) {
        lastSeq = nextSeqFrom(normalized, lastSeq);
      } else if (lastSeq === null) {
        lastSeq = 0;
      }

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
      emit(null);
    } finally {
      if (!shouldRun() || generation !== connectionGeneration || controller.signal.aborted || activeMode !== 'poll') {
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
      }, pollIntervalMs);
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
      return;
    }

    if (Array.isArray(data.activityHistory)) {
      const normalized = normalizeEntries(data.activityHistory);
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
      const entry = data.activity;
      liveAccumulator.enqueue({
        key: activityEntryKey(entry),
        value: entry,
        changed: true,
        live: true
      });
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

  if (ws) {
    return;
  }

  lastWsAttemptAt = Date.now();
  clearPollTimer();
  pollController?.abort();
  pollController = null;
  pollInFlight = null;
  activeMode = 'websocket';

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
    activeMode = 'poll';
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
    activeMode = 'poll';
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
      activeMode = 'idle';
      emit(null);
      return;
    }

    activeMode = 'poll';
    emit(null);
    void runPoll();
  };

  wsConnectTimer = window.setTimeout(() => {
    wsConnectTimer = null;
    if (ws !== socket || generation !== connectionGeneration || connected) {
      return;
    }
    ws = null;
    activeMode = 'poll';
    try {
      socket.close();
    } catch {
      // ignore
    }
    error = 'WebSocket activity stream timed out';
    emit(null);
    void runPoll();
  }, reconnectDelayMs);
}

function evaluate() {
  if (!shouldRun()) {
    resetConnection();
    emit(null);
    return;
  }

  if (activeMode === 'websocket' && ws) {
    return;
  }

  if (activeMode === 'poll') {
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
    listener({ loading, connected, error, batch: currentBatch, transport: activeMode === 'idle' ? null : activeMode });
  } catch (listenerError) {
    window.dispatchEvent(new CustomEvent('nodel-source-listener-error', { detail: { error: listenerError } }));
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
