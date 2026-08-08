import { errorMessage } from '../utils/errors';
import type { NodelSourceRefreshResult } from './nodel-data-runtime';
import type { NodeRestartRefreshContext, NodeRestartRefreshResult } from './node-restart-source';

export interface RestartRefreshTarget {
  label: string;
  refresh(context?: NodeRestartRefreshContext): void | boolean | NodeRestartRefreshResult | Promise<void | boolean | NodeRestartRefreshResult>;
}

export interface RestartRefreshIdentity {
  id: number;
  generation: number;
}

export interface RestartRefreshSummary {
  result: NodeRestartRefreshResult;
  failed: boolean;
  conflict: boolean;
  dirtyPreserved: boolean;
  failureDetail: string;
  diagnosticDetail: string;
  diagnosticIssues: boolean;
  expectation: RestartRefreshIdentity | null;
}

export interface NodeRestartRefreshDependencies {
  resetConsoleCursor(): void;
  refreshConsole(options: { signal: AbortSignal; force: true }): Promise<NodelSourceRefreshResult>;
  refreshActivity(options: { signal: AbortSignal; force: true }): Promise<NodelSourceRefreshResult>;
}

interface Outcome<R> {
  label: string;
  result: R;
}

const restartStatuses = new Set<NodeRestartRefreshResult['status']>(['verified', 'dirty-preserved', 'conflict', 'failed', 'aborted', 'superseded']);
const sourceStatuses = new Set<NodelSourceRefreshResult['status']>(['verified', 'failed', 'aborted', 'superseded', 'skipped', 'absent', 'inactive']);

function validRestartResult(value: unknown): value is NodeRestartRefreshResult {
  return value !== null && typeof value === 'object' && restartStatuses.has((value as NodeRestartRefreshResult).status);
}

function validSourceResult(value: unknown): value is NodelSourceRefreshResult {
  return value !== null && typeof value === 'object' && sourceStatuses.has((value as NodelSourceRefreshResult).status);
}

function normalizeRestart(label: string, settled: PromiseSettledResult<void | boolean | NodeRestartRefreshResult>): Outcome<NodeRestartRefreshResult> {
  if (settled.status === 'rejected') {
    return { label, result: { status: 'failed', detail: errorMessage(settled.reason, `${label} refresh failed.`) } };
  }
  if (settled.value === true) {
    return { label, result: { status: 'verified' } };
  }
  if (settled.value === false || settled.value === undefined) {
    return { label, result: { status: 'failed', detail: `${label} did not report a verified refresh.` } };
  }
  return validRestartResult(settled.value)
    ? { label, result: settled.value }
    : { label, result: { status: 'failed', detail: `${label} returned an invalid refresh result.` } };
}

function normalizeSource(label: string, settled: PromiseSettledResult<NodelSourceRefreshResult>): Outcome<NodelSourceRefreshResult> {
  if (settled.status === 'rejected') {
    return { label, result: { status: 'failed', detail: errorMessage(settled.reason, `${label} refresh failed.`) } };
  }
  return validSourceResult(settled.value)
    ? { label, result: settled.value }
    : { label, result: { status: 'failed', detail: `${label} returned an invalid refresh result.` } };
}

function formatIssues(outcomes: Array<Outcome<NodeRestartRefreshResult> | Outcome<NodelSourceRefreshResult>>) {
  return outcomes.map((outcome) => `${outcome.label}: ${outcome.result.detail ?? outcome.result.status}`).join(' ').slice(0, 500);
}

function identityOf(context?: NodeRestartRefreshContext): RestartRefreshIdentity | null {
  return context ? { id: context.expectation.id, generation: context.expectation.generation } : null;
}

function identitiesMatch(left: RestartRefreshIdentity | null, right: RestartRefreshIdentity) {
  return left?.id === right.id && left.generation === right.generation;
}

function startTarget(target: RestartRefreshTarget, context?: NodeRestartRefreshContext) {
  try {
    return Promise.resolve(target.refresh(context));
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Coordinates app-local restart refresh generations; the restart source remains global. */
export class NodeRestartRefreshController {
  private disposed = false;
  private refreshGeneration = 0;
  private refreshAbortController: AbortController | null = null;
  private refreshExpectation: RestartRefreshIdentity | null = null;
  private diagnosticsGeneration = 0;
  private diagnosticsAbortController: AbortController | null = null;
  private diagnosticsExpectation: RestartRefreshIdentity | null = null;

  constructor(private readonly dependencies: NodeRestartRefreshDependencies) {}

  getActiveExpectation() {
    return this.refreshExpectation ? { ...this.refreshExpectation } : null;
  }

  startManual(targets: readonly RestartRefreshTarget[]) {
    return this.start(targets);
  }

  startExpected(context: NodeRestartRefreshContext, targets: readonly RestartRefreshTarget[]) {
    return this.start(targets, context);
  }

  async start(targets: readonly RestartRefreshTarget[], context?: NodeRestartRefreshContext): Promise<RestartRefreshSummary | null> {
    const generation = ++this.refreshGeneration;
    this.refreshAbortController?.abort();
    this.cancelDiagnostics();
    const controller = new AbortController();
    const expectation = identityOf(context);
    this.refreshAbortController = controller;
    this.refreshExpectation = expectation;
    // Preserve the app's established immediate, DOM-order child refresh start.
    const childRefreshes = targets.map((target) => startTarget(target, context));
    const childResults = await Promise.allSettled(childRefreshes);
    if (!this.isCurrentRefresh(generation, controller)) {
      return null;
    }
    this.dependencies.resetConsoleCursor();
    const sourceTargets = [
      { label: 'Console', refresh: Promise.resolve().then(() => this.dependencies.refreshConsole({ signal: controller.signal, force: true })) },
      { label: 'Activity', refresh: Promise.resolve().then(() => this.dependencies.refreshActivity({ signal: controller.signal, force: true })) }
    ];
    const sourceResults = await Promise.allSettled(sourceTargets.map((target) => target.refresh));
    if (!this.isCurrentRefresh(generation, controller)) {
      return null;
    }
    const refreshOutcomes = childResults.map((result, index) => normalizeRestart(targets[index]!.label, result));
    const sourceOutcomes = sourceResults.map((result, index) => normalizeSource(sourceTargets[index]!.label, result));
    const failures = refreshOutcomes.filter((outcome) => ['failed', 'aborted', 'superseded'].includes(outcome.result.status));
    const diagnostics = sourceOutcomes.filter((outcome) => outcome.result.status !== 'verified' && outcome.result.status !== 'absent');
    const conflict = refreshOutcomes.some((outcome) => outcome.result.status === 'conflict');
    const dirtyPreserved = refreshOutcomes.some((outcome) => outcome.result.status === 'dirty-preserved');
    const failureDetail = formatIssues(failures);
    const diagnosticDetail = diagnostics.length ? `Some diagnostics did not refresh: ${formatIssues(diagnostics)}` : '';
    const result: NodeRestartRefreshResult = failures.length
      ? { status: 'failed', detail: failureDetail || 'One or more node-backed views failed verification.' }
      : conflict
        ? { status: 'conflict', detail: refreshOutcomes.find((outcome) => outcome.result.status === 'conflict')?.result.detail ?? 'A node-backed view could not reconcile its remote content.' }
        : dirtyPreserved
          ? { status: 'dirty-preserved', detail: 'Unsaved editor changes were preserved.' }
          : { status: 'verified' };
    this.clearRefresh(controller);
    return { result, failed: failures.length > 0, conflict, dirtyPreserved, failureDetail, diagnosticDetail, diagnosticIssues: diagnostics.length > 0, expectation };
  }

  invalidateForPending(expectation: RestartRefreshIdentity) {
    if (this.refreshAbortController && !identitiesMatch(this.refreshExpectation, expectation)) {
      this.refreshAbortController.abort();
      this.refreshAbortController = null;
      this.refreshExpectation = null;
      this.refreshGeneration += 1;
    }
  }

  supersede(expectation: RestartRefreshIdentity) {
    if (this.refreshAbortController && identitiesMatch(this.refreshExpectation, expectation)) {
      this.refreshAbortController.abort();
      this.refreshAbortController = null;
      this.refreshExpectation = null;
      this.refreshGeneration += 1;
    }
    if (this.diagnosticsAbortController && identitiesMatch(this.diagnosticsExpectation, expectation)) {
      this.diagnosticsAbortController.abort();
      this.diagnosticsAbortController = null;
      this.diagnosticsExpectation = null;
      this.diagnosticsGeneration += 1;
    }
  }

  async refreshTimeoutDiagnostics(expectation: RestartRefreshIdentity) {
    const generation = ++this.diagnosticsGeneration;
    this.diagnosticsAbortController?.abort();
    const controller = new AbortController();
    this.diagnosticsAbortController = controller;
    this.diagnosticsExpectation = { ...expectation };
    this.dependencies.resetConsoleCursor();
    await Promise.allSettled([
      Promise.resolve().then(() => this.dependencies.refreshConsole({ signal: controller.signal, force: true })),
      Promise.resolve().then(() => this.dependencies.refreshActivity({ signal: controller.signal, force: true }))
    ]);
    if (!this.disposed && this.diagnosticsGeneration === generation && this.diagnosticsAbortController === controller && identitiesMatch(this.diagnosticsExpectation, expectation)) {
      this.diagnosticsAbortController = null;
      this.diagnosticsExpectation = null;
    }
  }

  dispose() {
    this.disposed = true;
    this.refreshGeneration += 1;
    this.refreshAbortController?.abort();
    this.refreshAbortController = null;
    this.refreshExpectation = null;
    this.cancelDiagnostics();
  }

  private isCurrentRefresh(generation: number, controller: AbortController) {
    return !this.disposed && generation === this.refreshGeneration && this.refreshAbortController === controller;
  }

  private clearRefresh(controller: AbortController) {
    if (this.refreshAbortController === controller) {
      this.refreshAbortController = null;
      this.refreshExpectation = null;
    }
  }

  private cancelDiagnostics() {
    this.diagnosticsGeneration += 1;
    this.diagnosticsAbortController?.abort();
    this.diagnosticsAbortController = null;
    this.diagnosticsExpectation = null;
  }
}
