import { getNodeRestartStatus } from '../api/nodel-host-client';
import { getNodePathName } from '../utils/node-name';

export interface NodeRestartDetail {
  previousTimestamp: string;
  timestamp: string;
}

export type NodeRestartListener = (detail: NodeRestartDetail) => void;

export interface NodeRestartWatcher {
  dispose(): void;
}

const restartPollDelayMs = 5000;
const restartLongPollTimeoutMs = 5000;

export function isNodePage() {
  return Boolean(getNodePathName());
}

export function watchNodeRestart(listener: NodeRestartListener): NodeRestartWatcher {
  let disposed = false;
  let timer: number | null = null;
  let abortController: AbortController | null = null;
  let lastTimestamp: string | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (delayMs = restartPollDelayMs) => {
    clearTimer();
    if (disposed) {
      return;
    }
    timer = window.setTimeout(() => {
      timer = null;
      void poll();
    }, delayMs);
  };

  const poll = async () => {
    if (disposed) {
      return;
    }

    if (!isNodePage() || !navigator.onLine) {
      schedule();
      return;
    }

    abortController?.abort();
    abortController = new AbortController();

    try {
      const status = await getNodeRestartStatus(
        {
          timestamp: lastTimestamp,
          timeout: lastTimestamp ? restartLongPollTimeoutMs : 0
        },
        { signal: abortController.signal }
      );
      const timestamp = typeof status.timestamp === 'string' ? status.timestamp : null;

      if (!timestamp) {
        schedule();
        return;
      }

      if (!lastTimestamp) {
        lastTimestamp = timestamp;
        schedule();
        return;
      }

      if (timestamp !== lastTimestamp) {
        const previousTimestamp = lastTimestamp;
        lastTimestamp = timestamp;
        listener({ previousTimestamp, timestamp });
      }

      schedule();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      schedule();
    }
  };

  void poll();

  return {
    dispose() {
      disposed = true;
      clearTimer();
      abortController?.abort();
      abortController = null;
    }
  };
}
