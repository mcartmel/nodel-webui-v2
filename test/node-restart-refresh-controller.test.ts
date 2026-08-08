import { NodeRestartRefreshController } from '../src/data/node-restart-refresh-controller';
import type { NodeRestartRefreshContext, NodeRestartRefreshResult } from '../src/data/node-restart-source';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function context(id = 1, generation = 1): NodeRestartRefreshContext {
  return {
    expectation: { id, generation, baselineTimestamp: null, state: 'refreshing' },
    detail: { previousTimestamp: null, timestamp: 'next' }
  };
}

describe('NodeRestartRefreshController', () => {
  it('starts expected and manual children synchronously in order, then runs diagnostics after settle', async () => {
    const first = deferred<{ status: 'verified' }>();
    const second = deferred<{ status: 'verified' }>();
    const calls: string[] = [];
    const controller = new NodeRestartRefreshController({
      resetConsoleCursor: () => calls.push('reset'),
      refreshConsole: async () => { calls.push('console'); return { status: 'verified' }; },
      refreshActivity: async () => { calls.push('activity'); return { status: 'verified' }; }
    });
    const result = controller.startExpected(context(), [
      { label: 'First', refresh: () => { calls.push('first'); return first.promise; } },
      { label: 'Second', refresh: () => { calls.push('second'); return second.promise; } }
    ]);
    expect(calls).toEqual(['first', 'second']);
    first.resolve({ status: 'verified' });
    await Promise.resolve();
    expect(calls).toEqual(['first', 'second']);
    second.resolve({ status: 'verified' });
    expect(await result).toMatchObject({ result: { status: 'verified' }, expectation: { id: 1, generation: 1 } });
    expect(calls).toEqual(['first', 'second', 'reset', 'console', 'activity']);

    const manualCalls: string[] = [];
    const manual = new NodeRestartRefreshController({
      resetConsoleCursor: vi.fn(),
      refreshConsole: async () => ({ status: 'verified' }),
      refreshActivity: async () => ({ status: 'verified' })
    });
    const manualResult = manual.startManual([{ label: 'Manual', refresh: () => { manualCalls.push('manual'); return true; } }]);
    expect(manualCalls).toEqual(['manual']);
    await manualResult;
  });

  it('normalizes child and source outcomes with exact aggregation precedence and bounded details', async () => {
    const controller = new NodeRestartRefreshController({
      resetConsoleCursor: vi.fn(),
      refreshConsole: async () => ({ status: 'skipped' }),
      refreshActivity: async () => ({ status: 'absent' })
    });
    const result = await controller.startManual([
      { label: 'Bad', refresh: () => false },
      { label: 'Conflict', refresh: () => ({ status: 'conflict', detail: 'conflict' }) },
      { label: 'Dirty', refresh: () => ({ status: 'dirty-preserved' }) },
      { label: 'Invalid', refresh: () => ({ status: 'nope' } as unknown as NodeRestartRefreshResult) }
    ]);
    expect(result).toMatchObject({ failed: true, conflict: true, dirtyPreserved: true, diagnosticIssues: true, result: { status: 'failed' } });
    expect(result?.failureDetail).toContain('Bad: Bad did not report a verified refresh.');
    expect(result?.diagnosticDetail).toContain('Console: skipped');

    const long = await controller.startManual([{ label: 'Long', refresh: () => Promise.reject(new Error('x'.repeat(800))) }]);
    expect(long?.failureDetail.length).toBeLessThanOrEqual(500);
  });

  it('suppresses stale refreshes for superseding runs, pending identities, and disposal', async () => {
    const gate = deferred<{ status: 'verified' }>();
    const reset = vi.fn();
    const controller = new NodeRestartRefreshController({
      resetConsoleCursor: reset,
      refreshConsole: async () => ({ status: 'verified' }),
      refreshActivity: async () => ({ status: 'verified' })
    });
    const stale = controller.startExpected(context(1, 1), [{ label: 'View', refresh: () => gate.promise }]);
    expect(controller.getActiveExpectation()).toEqual({ id: 1, generation: 1 });
    controller.invalidateForPending({ id: 2, generation: 2 });
    gate.resolve({ status: 'verified' });
    expect(await stale).toBeNull();
    expect(reset).not.toHaveBeenCalled();

    const next = deferred<{ status: 'verified' }>();
    const disposed = controller.startExpected(context(2, 2), [{ label: 'View', refresh: () => next.promise }]);
    controller.dispose();
    next.resolve({ status: 'verified' });
    expect(await disposed).toBeNull();
    expect(controller.getActiveExpectation()).toBeNull();
  });

  it('cancels only matching timeout diagnostics on supersede', async () => {
    const consoleGate = deferred<{ status: 'verified' }>();
    const captured = { signal: null as AbortSignal | null };
    const controller = new NodeRestartRefreshController({
      resetConsoleCursor: vi.fn(),
      refreshConsole: (options) => {
        captured.signal = options.signal;
        return consoleGate.promise;
      },
      refreshActivity: async () => ({ status: 'verified' })
    });
    const diagnostic = controller.refreshTimeoutDiagnostics({ id: 1, generation: 1 });
    await Promise.resolve();
    controller.supersede({ id: 2, generation: 2 });
    expect(captured.signal?.aborted).toBe(false);
    controller.supersede({ id: 1, generation: 1 });
    expect(captured.signal?.aborted).toBe(true);
    consoleGate.resolve({ status: 'verified' });
    await diagnostic;
    expect(controller.getActiveExpectation()).toBeNull();
  });

  it('normalizes rejected and invalid diagnostics as warnings without failing the view', async () => {
    const controller = new NodeRestartRefreshController({
      resetConsoleCursor: vi.fn(),
      refreshConsole: async () => Promise.reject(new Error('Console unavailable')),
      refreshActivity: async () => ({ status: 'unknown' } as unknown as { status: 'verified' })
    });

    const result = await controller.startManual([{ label: 'View', refresh: () => true }]);
    expect(result).toMatchObject({ result: { status: 'verified' }, diagnosticIssues: true });
    expect(result?.diagnosticDetail).toContain('Console: Console unavailable');
    expect(result?.diagnosticDetail).toContain('Activity: Activity returned an invalid refresh result.');
  });

  it('cancels matching timeout diagnostics when an expected refresh starts', async () => {
    const diagnosticGate = deferred<{ status: 'verified' }>();
    const captured = { signal: null as AbortSignal | null };
    const controller = new NodeRestartRefreshController({
      resetConsoleCursor: vi.fn(),
      refreshConsole: (options) => {
        captured.signal = options.signal;
        return diagnosticGate.promise;
      },
      refreshActivity: async () => ({ status: 'verified' })
    });
    const diagnostic = controller.refreshTimeoutDiagnostics({ id: 3, generation: 4 });
    await Promise.resolve();
    const refresh = controller.startExpected(context(3, 4), [{ label: 'View', refresh: () => true }]);

    expect(captured.signal?.aborted).toBe(true);
    diagnosticGate.resolve({ status: 'verified' });
    await diagnostic;
    await refresh;
  });

  it('suppresses a stale completion after source refreshes have started and disposal occurs', async () => {
    const consoleGate = deferred<{ status: 'verified' }>();
    const activityGate = deferred<{ status: 'verified' }>();
    const controller = new NodeRestartRefreshController({
      resetConsoleCursor: vi.fn(),
      refreshConsole: () => consoleGate.promise,
      refreshActivity: () => activityGate.promise
    });
    const result = controller.startManual([{ label: 'View', refresh: () => true }]);
    await Promise.resolve();
    await Promise.resolve();
    controller.dispose();
    consoleGate.resolve({ status: 'verified' });
    activityGate.resolve({ status: 'verified' });

    expect(await result).toBeNull();
  });
});
