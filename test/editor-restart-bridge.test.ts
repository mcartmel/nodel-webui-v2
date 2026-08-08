import { EditorRestartBridge, type EditorRestartDependencies } from '../src/editor/editor-restart-bridge';
import { NodeRestartExpectationObsoleteError, NodeRestartScriptWriteBlockedError, type PreparedNodeRestartExpectation } from '../src/data/node-restart-source';

const prepared: PreparedNodeRestartExpectation = { id: 1, generation: 2, baselineTimestamp: 'before', replacesExpectationId: null, replacesExpectationGeneration: null };
function dependencies(log: string[]): EditorRestartDependencies {
  return {
    subscribe: () => ({ dispose: () => undefined }), getExpectation: () => null, getWriteState: () => 'idle',
    prepare: vi.fn(async () => { log.push('prepare'); return prepared; }), isPrepared: vi.fn(() => true),
    commit: vi.fn(() => { log.push('commit'); return { id: 1, generation: 2, baselineTimestamp: 'before', state: 'pending' as const }; }),
    activate: vi.fn(() => { log.push('activate'); return true; }), cancel: vi.fn(() => log.push('cancel'))
  };
}

describe('EditorRestartBridge', () => {
  it('preserves prepare-save-commit-install-activate ordering', async () => {
    const log: string[] = []; const bridge = new EditorRestartBridge(dependencies(log));
    await bridge.saveScript('text', { isCurrent: () => true, save: async () => { log.push('save'); }, install: () => log.push('install') });
    expect(log).toEqual(['prepare', 'save', 'commit', 'install', 'activate']);
  });

  it('cancels prepared work on save failure but not committed expectations on disposal', async () => {
    const log: string[] = []; const deps = dependencies(log); const bridge = new EditorRestartBridge(deps);
    await expect(bridge.saveScript('text', { isCurrent: () => true, save: async () => { throw new Error('save failed'); }, install: vi.fn() })).rejects.toThrow('save failed');
    expect(log).toContain('cancel');
    log.length = 0;
    await bridge.saveScript('text', { isCurrent: () => true, save: async () => undefined, install: vi.fn() });
    bridge.dispose();
    expect(log).not.toContain('cancel');
  });

  it('ignores stale expectation events and exposes blocked state through dependencies', () => {
    const log: string[] = []; const deps = dependencies(log); const bridge = new EditorRestartBridge(deps);
    bridge.track({ id: 1, generation: 2, baselineTimestamp: null, state: 'pending' });
    bridge.event({ type: 'expected-pending', expectation: { id: 1, generation: 2, baselineTimestamp: null, state: 'pending' } });
    bridge.event({ type: 'expected-timeout', expectation: { id: 9, generation: 9, baselineTimestamp: null, state: 'unconfirmed' } });
    expect(bridge.state.id).toBe(1);
  });

  it('preserves blocked and obsolete error types while wrapping only baseline failures', async () => {
    const log: string[] = []; const blocked = new NodeRestartScriptWriteBlockedError();
    const blockedDeps = dependencies(log); blockedDeps.getWriteState = () => 'pending';
    await expect(new EditorRestartBridge(blockedDeps).saveScript('x', { isCurrent: () => true, save: vi.fn(), install: vi.fn() })).rejects.toThrow(NodeRestartScriptWriteBlockedError);
    const prepareBlocked = dependencies(log); prepareBlocked.prepare = vi.fn(async () => { throw blocked; });
    await expect(new EditorRestartBridge(prepareBlocked).saveScript('x', { isCurrent: () => true, save: vi.fn(), install: vi.fn() })).rejects.toBe(blocked);
    const failed = dependencies(log); failed.prepare = vi.fn(async () => { throw new Error('offline'); });
    await expect(new EditorRestartBridge(failed).saveScript('x', { isCurrent: () => true, save: vi.fn(), install: vi.fn() })).rejects.toThrow('Could not capture the node reload baseline; script.py was not saved. offline');
    const stale = dependencies(log);
    await expect(new EditorRestartBridge(stale).saveScript('x', { isCurrent: () => false, save: vi.fn(), install: vi.fn() })).rejects.toBeInstanceOf(NodeRestartExpectationObsoleteError);
  });

  it('keeps active and corrective preparation identities separate and generation-safe', () => {
    const log: string[] = []; const bridge = new EditorRestartBridge(dependencies(log));
    bridge.track({ id: 1, generation: 1, baselineTimestamp: null, state: 'unconfirmed' });
    bridge.event({ type: 'expected-preparing', expectation: { id: 2, generation: 2, baselineTimestamp: null, replacesExpectationId: 1, replacesExpectationGeneration: 1 } });
    expect(bridge.state).toMatchObject({ id: 1, generation: 1, state: 'unconfirmed', prepared: true });
    bridge.event({ type: 'expected-timeout', expectation: { id: 1, generation: 9, baselineTimestamp: null, state: 'unconfirmed' } });
    expect(bridge.state.generation).toBe(1);
    expect(bridge.isCurrent({ id: 1, generation: 1 })).toBe(true);
    bridge.event({ type: 'expected-pending', expectation: { id: 2, generation: 2, baselineTimestamp: null, state: 'pending' } });
    expect(bridge.state).toMatchObject({ id: 2, generation: 2, prepared: false });
  });

  it('cancels committed expectations after commit or activation failures', async () => {
    const log: string[] = []; const commitFailure = dependencies(log); commitFailure.commit = vi.fn(() => null);
    await expect(new EditorRestartBridge(commitFailure).saveScript('x', { isCurrent: () => true, save: vi.fn(), install: vi.fn() })).rejects.toBeInstanceOf(NodeRestartExpectationObsoleteError);
    expect(log).toContain('cancel');
    const activateFailure = dependencies(log); activateFailure.activate = vi.fn(() => false);
    await expect(new EditorRestartBridge(activateFailure).saveScript('x', { isCurrent: () => true, save: vi.fn(), install: vi.fn() })).rejects.toBeInstanceOf(NodeRestartExpectationObsoleteError);
    expect(log.filter((entry) => entry === 'cancel')).toHaveLength(2);
  });
});
