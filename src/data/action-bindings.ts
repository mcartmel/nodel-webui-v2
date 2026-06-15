import { callNodeAction } from '../api/nodel-host-client';

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

function parseBindingList(value: string | null, defaultPhase: string) {
  const bindings: ActionBinding[] = [];

  for (const part of (value ?? '').split(/[;,]/)) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.lastIndexOf(':');
    const action = separatorIndex > 0 ? trimmed.slice(0, separatorIndex).trim() : trimmed;
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
    ...(options.aliases ?? []).filter((alias) => alias.action?.trim()).map((alias) => ({ action: alias.action!.trim(), phase: alias.phase }))
  ];

  if (bindings.length === 0 && options.join?.trim()) {
    bindings.push({ action: options.join.trim(), phase: options.defaultPhase });
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

export async function callActionBindings(bindings: ActionBinding[], phase: string, payload: unknown): Promise<ActionBindingExecution> {
  const results: ActionBindingResult[] = [];

  for (const binding of actionBindingsForPhase(bindings, phase)) {
    try {
      await callNodeAction(binding.action, payload);
      results.push({ action: binding.action, phase, ok: true });
    } catch (error) {
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
