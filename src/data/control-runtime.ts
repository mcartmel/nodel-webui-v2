import { callNodeAction } from '../api/nodel-host-client';
import type { NodelActivityLogEntry } from '../api/nodel-types';
import { subscribeNodeActivity } from './node-activity-source';

export interface NodelControlSignalState {
  loading: boolean;
  connected: boolean;
  error: string;
  entries: NodelActivityLogEntry[];
}

export interface NodelControlRuntime {
  callAction(name: string, payload: unknown): Promise<unknown>;
  subscribeSignals(
    element: HTMLElement,
    listener: (state: NodelControlSignalState) => void
  ): { dispose(): void };
}

function defaultRuntime(): NodelControlRuntime {
  return {
    callAction(name, payload) {
      return callNodeAction(name, payload);
    },
    subscribeSignals(element, listener) {
      return subscribeNodeActivity(element, (state) => {
        listener({
          loading: state.loading,
          connected: state.connected,
          error: state.error,
          entries: state.batch?.items.map((item) => item.entry) ?? []
        });
      });
    }
  };
}

let activeRuntime: NodelControlRuntime = defaultRuntime();

export function getControlRuntime() {
  return activeRuntime;
}

export function installControlRuntime(runtime: NodelControlRuntime) {
  const previous = activeRuntime;
  activeRuntime = runtime;
  return () => {
    if (activeRuntime === runtime) {
      activeRuntime = previous;
    }
  };
}
