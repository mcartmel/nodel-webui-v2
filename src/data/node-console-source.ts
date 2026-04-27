import { getNodeConsoleLogs } from '../api/nodel-host-client';
import type { NodelConsoleLogEntry } from '../api/nodel-types';
import { registerNodelPollSource, type NodelSourceState, type NodelSourceSubscription } from './nodel-data-runtime';

export interface NodeConsoleBatch {
  entries: NodelConsoleLogEntry[];
  replace: boolean;
  nextSeq: number;
}

interface ConsoleState {
  seq: number | null;
}

type ConsoleListener = (state: NodelSourceState<NodeConsoleBatch>) => void;

const state: ConsoleState = {
  seq: null
};

const source = registerNodelPollSource<NodeConsoleBatch>({
  key: 'node-console',
  intervalMs: 1000,
  visibleOnly: true,
  fetcher: async (signal) => {
    const initial = state.seq === null;
    const from = initial ? -1 : (state.seq ?? 0);
    const entries = await getNodeConsoleLogs(
      {
        from,
        max: initial ? 200 : 9999
      },
      { signal }
    );

    const chronological = [...entries].reverse();
    const nextSeq = chronological.length > 0 ? chronological[chronological.length - 1].seq + 1 : (state.seq ?? 0);
    state.seq = nextSeq;

    return {
      entries: chronological,
      replace: initial,
      nextSeq
    };
  }
});

export function subscribeNodeConsole(element: HTMLElement, listener: ConsoleListener): NodelSourceSubscription<NodeConsoleBatch> {
  return source.subscribe(element, listener);
}

export function refreshNodeConsole() {
  return source.refresh();
}

export function resetNodeConsoleCursor() {
  state.seq = null;
}
