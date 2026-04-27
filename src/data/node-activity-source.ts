import { getNodeActivity } from '../api/nodel-host-client';
import type { NodelActivityLogEntry, NodelActivityWebSocketMessage } from '../api/nodel-types';
import { getNodePathName } from '../utils/node-name';
import { createActivityAccumulator } from './activity-accumulator';
import { observeNodelVisibility } from './visibility-scope';

export interface NodeActivityBatch {
  items: Array<{ entry: NodelActivityLogEntry; changed: boolean; live: boolean }>;
  replace: boolean;
  transport: 'websocket' | 'poll';
  nextSeq: number;
}

type Listener = (state: {
  loading: boolean;
  connected: boolean;
  error: string;
  batch: NodeActivityBatch | null;
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
let pollTimer: number | null = null;
let reconnectTimer: number | null = null;
let lastWsAttemptAt = 0;
let activeMode: 'idle' | 'websocket' | 'poll' = 'idle';

const liveAccumulator = createActivityAccumulator<NodelActivityLogEntry>((items) => {
  if (items.length === 0) {
    return;
  }

  const entries = items.map((item) => item.value);
  const nextSeq = Math.max(...entries.map((entry) => entry.seq), lastSeq ?? 0) + 1;
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
  clearPollTimer();
  clearReconnectTimer();
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

function emit(batch: NodeActivityBatch | null, nextError = error) {
  if (batch) {
    currentBatch = batch;
    loading = false;
    error = '';
  } else if (nextError !== error) {
    error = nextError;
  }

  for (const subscriber of subscribers) {
    subscriber.listener({
      loading,
      connected,
      error,
      batch
    });
  }
}

function normalizeEntries(entries: NodelActivityLogEntry[]) {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const deduped = new Map<string, NodelActivityLogEntry>();

  for (const entry of sorted) {
    deduped.set(`${entry.source}_${entry.type}_${entry.alias}`, entry);
  }

  return Array.from(deduped.values());
}

function nextSeqFrom(entries: NodelActivityLogEntry[], fallback: number | null) {
  if (entries.length === 0) {
    return fallback ?? 0;
  }

  return Math.max(...entries.map((entry) => entry.seq)) + 1;
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

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    void openWebSocket();
  }, reconnectDelayMs);
}

async function runPoll() {
  if (!shouldRun()) {
    return;
  }

  activeMode = 'poll';
  connected = false;
  emit(null);

  try {
    const from = lastSeq === null ? -1 : lastSeq;
    const entries = await getNodeActivity({ from });
    if (!shouldRun()) {
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
    error = pollError instanceof Error ? pollError.message : 'Failed to load activity';
    emit(null);
  } finally {
    clearPollTimer();

    if (!shouldRun()) {
      return;
    }

    if (Date.now() - lastWsAttemptAt >= reconnectDelayMs) {
      void openWebSocket();
      return;
    }

    pollTimer = window.setTimeout(() => {
      pollTimer = null;
      void runPoll();
    }, pollIntervalMs);
  }
}

function handleWebSocketMessage(message: MessageEvent<string>) {
  try {
    const data = JSON.parse(message.data) as NodelActivityWebSocketMessage;
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
        key: `${entry.source}_${entry.type}_${entry.alias}`,
        value: entry,
        changed: true,
        live: true
      });
    }
  } catch {
    // ignore malformed socket payloads
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
  activeMode = 'websocket';

  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/nodes/${encodeURIComponent(nodeName)}`;
    ws = new WebSocket(url);
  } catch (connectError) {
    error = connectError instanceof Error ? connectError.message : 'Failed to open activity socket';
    ws = null;
    connected = false;
    emit(null);
    scheduleReconnect();
    await runPoll();
    return;
  }

  ws.onopen = () => {
    connected = true;
    error = '';
    emit(null);
  };

  ws.onmessage = handleWebSocketMessage;

  ws.onerror = () => {
    error = 'WebSocket activity stream unavailable';
    emit(null);
  };

  ws.onclose = () => {
    ws = null;
    connected = false;
    emit(null);

    if (!shouldRun()) {
      activeMode = 'idle';
      return;
    }

    activeMode = 'poll';
    void runPoll();
  };
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
    if (!pollTimer && !ws) {
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
  listener({ loading, connected, error, batch: currentBatch });
  evaluate();

  return {
    dispose() {
      subscriber.disposeVisibility();
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        resetConnection();
        loading = true;
        currentBatch = null;
        lastSeq = null;
        error = '';
      }
    },
    refresh() {
      lastSeq = null;
      currentBatch = null;
      error = '';
      resetConnection();
      evaluate();
    }
  };
}
