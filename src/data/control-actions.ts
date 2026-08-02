import {
  callActionBindings,
  type ActionBinding,
  type ActionBindingExecution,
  type ActionBindingResult
} from './action-bindings';
import { parseTypedArgStrict, type ControlArgType } from '../utils/control-values';

export interface ControlActionPayloadSuccess {
  ok: true;
  payload: Record<string, unknown>;
  arg?: unknown;
}

export interface ControlActionPayloadFailure {
  ok: false;
  error: string;
}

export type ControlActionPayloadResult = ControlActionPayloadSuccess | ControlActionPayloadFailure;

export interface ControlActionErrorOptions {
  eventName: string;
  action?: string;
  phase?: string;
  phases?: readonly string[];
  payload?: unknown;
  arg?: unknown;
  value?: unknown;
  committed?: boolean;
  live?: boolean;
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

export async function executeActionPhases(bindings: ActionBinding[], phases: readonly string[], payload: unknown): Promise<ActionBindingExecution> {
  const results: ActionBindingResult[] = [];

  for (const phase of phases) {
    const execution = await callActionBindings(bindings, phase, payload);
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
  return error instanceof Error ? error.message : fallback;
}

export function formatActionFailures(failures: ReadonlyArray<{ action: string; error?: string }>, fallback = 'Failed to call action') {
  if (failures.length === 0) {
    return fallback;
  }
  if (failures.length === 1) {
    return failures[0].error ?? fallback;
  }
  return failures.map((failure) => `${failure.action}: ${failure.error ?? fallback}`).join('; ');
}

export function dispatchControlActionError(host: HTMLElement, options: ControlActionErrorOptions) {
  const error = options.error ?? formatActionFailures(options.failures ?? []);
  const payload = options.payload ?? {};
  const arg = options.arg ?? (payload && typeof payload === 'object' && 'arg' in payload ? (payload as { arg: unknown }).arg : undefined);

  host.dispatchEvent(new CustomEvent(options.eventName, {
    bubbles: true,
    detail: {
      action: options.action ?? '',
      phase: options.phase,
      phases: options.phases,
      value: options.value,
      arg,
      payload,
      results: [],
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
  private latest = 0;
  private serialQueue: Promise<unknown> = Promise.resolve();
  private singleFlightActive = false;

  nextToken() {
    this.latest += 1;
    return this.latest;
  }

  isLatest(token: number) {
    return token === this.latest;
  }

  invalidate() {
    this.latest += 1;
    this.singleFlightActive = false;
  }

  startSingleFlight() {
    if (this.singleFlightActive) {
      return false;
    }
    this.singleFlightActive = true;
    return true;
  }

  finishSingleFlight() {
    this.singleFlightActive = false;
  }

  runSerial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.serialQueue.then(operation, operation);
    this.serialQueue = run.catch(() => undefined);
    return run;
  }
}
