import { getControlRuntime } from './control-runtime';
import { trimPointReference } from '../utils/edge-whitespace';

export interface ActionBinding {
  action: string;
  phase: string;
}

export interface ActionBindingAlias {
  action: string | null;
  phase: string;
}

export interface ActionBindingResult {
  action: string;
  phase: string;
  ok: boolean;
  error?: string;
}

export interface ActionBindingExecution {
  results: ActionBindingResult[];
  failures: ActionBindingResult[];
}

export interface ActionBindingExecutionContext {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
}

export function actionExecutionCancelled(context?: ActionBindingExecutionContext) {
  return context?.signal?.aborted || context?.isCurrent?.() === false;
}

export function actionCancellationError() {
  const error = new Error('Action execution was cancelled');
  error.name = 'AbortError';
  return error;
}

export function isActionCancellation(error: unknown, context?: ActionBindingExecutionContext) {
  return actionExecutionCancelled(context)
    || (error instanceof Error && error.name === 'AbortError');
}

export function throwIfActionExecutionCancelled(context?: ActionBindingExecutionContext) {
  if (actionExecutionCancelled(context)) {
    throw actionCancellationError();
  }
}

function parseBindingList(value: string | null, defaultPhase: string) {
  const bindings: ActionBinding[] = [];

  for (const part of (value ?? '').split(/[;,]/)) {
    const trimmed = trimPointReference(part);
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.lastIndexOf(':');
    const action = separatorIndex > 0 ? trimPointReference(trimmed.slice(0, separatorIndex)) : trimmed;
    const phase = separatorIndex > 0 && separatorIndex < trimmed.length - 1
      ? trimmed.slice(separatorIndex + 1).trim()
      : defaultPhase;

    if (action && phase) {
      bindings.push({ action, phase });
    }
  }

  return bindings;
}

export function parseActionBindings(options: {
  action?: string | null;
  actions?: string | null;
  join?: string | null;
  defaultPhase: string;
  aliases?: ActionBindingAlias[];
}) {
  const bindings = [
    ...parseBindingList(options.action ?? null, options.defaultPhase),
    ...parseBindingList(options.actions ?? null, options.defaultPhase),
    ...(options.aliases ?? []).map((alias) => ({ action: trimPointReference(alias.action ?? ''), phase: alias.phase })).filter((alias) => alias.action)
  ];

  const join = trimPointReference(options.join ?? '');
  if (bindings.length === 0 && join) {
    bindings.push({ action: join, phase: options.defaultPhase });
  }

  const seen = new Set<string>();
  return bindings.filter((binding) => {
    const key = `${binding.action}:${binding.phase}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function actionBindingsForPhase(bindings: ActionBinding[], phase: string) {
  return bindings.filter((binding) => binding.phase === phase);
}

export function hasActionPhase(bindings: ActionBinding[], phase: string) {
  return actionBindingsForPhase(bindings, phase).length > 0;
}

export async function callActionBindings(bindings: ActionBinding[], phase: string, payload: unknown, context?: ActionBindingExecutionContext): Promise<ActionBindingExecution> {
  const results: ActionBindingResult[] = [];

  for (const binding of actionBindingsForPhase(bindings, phase)) {
    throwIfActionExecutionCancelled(context);
    try {
      await getControlRuntime().callAction(binding.action, payload, context?.signal ? { signal: context.signal } : undefined);
      throwIfActionExecutionCancelled(context);
      results.push({ action: binding.action, phase, ok: true });
    } catch (error) {
      if (isActionCancellation(error, context)) {
        throw error;
      }
      results.push({
        action: binding.action,
        phase,
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to call action'
      });
    }
  }

  return {
    results,
    failures: results.filter((result) => !result.ok)
  };
}
