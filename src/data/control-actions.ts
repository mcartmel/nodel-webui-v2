import {
  callActionBindings,
  type ActionBinding,
  type ActionBindingExecution,
  type ActionBindingResult,
  type ActionBindingExecutionContext,
  throwIfActionExecutionCancelled
} from './action-bindings';
import { parseTypedArgStrict, type ControlArgType } from '../utils/control-values';
import { apiErrorMessage } from '../utils/errors';

interface ControlActionPayloadSuccess {
  ok: true;
  payload: Record<string, unknown>;
  arg?: unknown;
}

interface ControlActionPayloadFailure {
  ok: false;
  error: string;
}

type ControlActionPayloadResult = ControlActionPayloadSuccess | ControlActionPayloadFailure;

interface ControlActionErrorOptions {
  eventName: string;
  action?: string;
  phase?: string;
  phases?: readonly string[];
  payload?: unknown;
  arg?: unknown;
  value?: unknown;
  committed?: boolean;
  live?: boolean;
  results?: ActionBindingResult[];
  failures?: ActionBindingResult[];
  error?: string;
  toastMessage?: string;
}

export function buildActionPayload(rawValue: string | null, type: ControlArgType): ControlActionPayloadResult {
  if (rawValue === null) {
    return { ok: true, payload: {} };
  }

  const decoded = parseTypedArgStrict(rawValue, type);
  if (!decoded.ok) {
    return { ok: false, error: decoded.error };
  }

  return { ok: true, payload: { arg: decoded.value }, arg: decoded.value };
}

export function emptyActionExecution(): ActionBindingExecution {
  return { results: [], failures: [] };
}

export async function executeActionPhases(bindings: ActionBinding[], phases: readonly string[], payload: unknown, context?: ActionBindingExecutionContext): Promise<ActionBindingExecution> {
  const results: ActionBindingResult[] = [];

  for (const phase of phases) {
    throwIfActionExecutionCancelled(context);
    const execution = await callActionBindings(bindings, phase, payload, context);
    results.push(...execution.results);
  }

  return {
    results,
    failures: results.filter((result) => !result.ok)
  };
}

export function actionName(bindings: readonly ActionBinding[], fallback = '') {
  return bindings[0]?.action ?? fallback;
}

export function actionErrorMessage(error: unknown, fallback = 'Failed to call action') {
  return apiErrorMessage(error, fallback);
}

export function formatActionFailures(failures: ReadonlyArray<{ action: string; error?: string }>, fallback = 'Failed to call action') {
  if (failures.length === 0) {
    return fallback;
  }
  if (failures.length === 1) {
    return failures[0]?.error ?? fallback;
  }
  return failures.map((failure) => `${failure.action}: ${failure.error ?? fallback}`).join('; ');
}

export function dispatchControlActionError(host: HTMLElement, options: ControlActionErrorOptions) {
  const error = options.error ?? formatActionFailures(options.failures ?? []);
  const payload = options.payload ?? {};
  const arg = options.arg ?? (payload && typeof payload === 'object' && 'arg' in payload ? (payload).arg : undefined);

  host.dispatchEvent(new CustomEvent(options.eventName, {
    bubbles: true,
    detail: {
      action: options.action ?? '',
      phase: options.phase,
      phases: options.phases,
      value: options.value,
      arg,
      payload,
      results: options.results ?? [],
      failures: options.failures ?? [],
      committed: options.committed,
      live: options.live,
      error
    }
  }));
  host.dispatchEvent(new CustomEvent('nodel-toast', {
    bubbles: true,
    detail: {
      message: options.toastMessage ?? 'Failed to call action',
      detail: error,
      tone: 'danger',
      durationMs: 7000
    }
  }));
}

export class ControlActionController {
  private generation = 0;
  private state: ControlActionConnectionState | null = null;

  connect() {
    this.connectState();
    return this.captureScope()!;
  }

  disconnect() {
    const state = this.state;
    this.state = null;
    this.generation += 1;
    state?.controller.abort();
  }

  captureScope(): ControlActionScope | null {
    const state = this.state;
    if (!state || state.controller.signal.aborted) {
      return null;
    }
    return {
      generation: state.generation,
      signal: state.controller.signal,
      isCurrent: () => this.state === state && !state.controller.signal.aborted
    };
  }

  private connectState() {
    if (!this.state || this.state.controller.signal.aborted) {
      this.state = {
        generation: ++this.generation,
        controller: new AbortController(),
        serialQueue: Promise.resolve(),
        singleFlightActive: false,
        latest: 0
      };
    }
    return this.state;
  }

  nextToken(scope: ControlActionScope | null) {
    const state = this.stateFor(scope);
    if (!state) {
      return -1;
    }
    state.latest += 1;
    return state.latest;
  }

  isLatest(token: number, scope: ControlActionScope | null) {
    const state = this.stateFor(scope);
    return state !== null && token === state.latest;
  }

  invalidate() {
    if (this.state) {
      this.state.latest += 1;
    }
  }

  startSingleFlight(scope: ControlActionScope | null) {
    const state = this.stateFor(scope);
    if (!state || state.singleFlightActive) {
      return false;
    }
    state.singleFlightActive = true;
    return true;
  }

  finishSingleFlight(scope: ControlActionScope | null) {
    const state = this.stateFor(scope);
    if (state) {
      state.singleFlightActive = false;
    }
  }

  runSerial<T>(scope: ControlActionScope | null, operation: () => Promise<T>): Promise<T> {
    const state = this.stateFor(scope);
    if (!state || !scope) {
      return Promise.reject(actionCancelled());
    }
    const runOperation = () => {
      if (!scope.isCurrent()) {
        throw actionCancelled();
      }
      return operation();
    };
    const run = state.serialQueue.then(runOperation, runOperation);
    state.serialQueue = run.catch(() => undefined);
    return run;
  }

  private stateFor(scope: ControlActionScope | null) {
    return scope?.isCurrent() && this.state?.generation === scope.generation ? this.state : null;
  }
}

interface ControlActionConnectionState {
  generation: number;
  controller: AbortController;
  serialQueue: Promise<unknown>;
  singleFlightActive: boolean;
  latest: number;
}

export interface ControlActionScope extends ActionBindingExecutionContext {
  generation: number;
  signal: AbortSignal;
  isCurrent(): boolean;
}

function actionCancelled() {
  const error = new Error('Action generation is no longer current');
  error.name = 'AbortError';
  return error;
}
