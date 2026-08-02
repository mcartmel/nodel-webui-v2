import { LatestOperationCoordinator } from '../src/utils/latest-operation-coordinator';

describe('latest operation coordinator', () => {
  it('keeps independent dynamic keys current', () => {
    const coordinator = new LatestOperationCoordinator<string>();
    const first = coordinator.begin('row:one:node');
    const second = coordinator.begin('row:two:node');

    expect(first.isCurrent()).toBe(true);
    expect(second.isCurrent()).toBe(true);
    expect(coordinator.isActive('row:one:node')).toBe(true);
    expect(coordinator.isActive('row:two:node')).toBe(true);
  });

  it('aborts the previous operation for the same key', () => {
    const coordinator = new LatestOperationCoordinator<'search'>();
    const first = coordinator.begin('search');
    const second = coordinator.begin('search');

    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it('keeps stale finish calls from clearing newer ownership and is idempotent', () => {
    const coordinator = new LatestOperationCoordinator<'resolve'>();
    const first = coordinator.begin('resolve');
    const second = coordinator.begin('resolve');

    first.finish();
    first.finish();
    expect(coordinator.isActive('resolve')).toBe(true);
    expect(second.isCurrent()).toBe(true);

    second.finish();
    second.finish();
    expect(coordinator.isActive('resolve')).toBe(false);
  });

  it('relays parent abort reasons and detaches the parent listener on finish', () => {
    const coordinator = new LatestOperationCoordinator<'load'>();
    const parent = new AbortController();
    const ticket = coordinator.begin('load', parent.signal);
    const reason = new Error('connection closed');

    parent.abort(reason);

    expect(ticket.signal.aborted).toBe(true);
    expect(ticket.signal.reason).toBe(reason);
    expect(ticket.isCurrent()).toBe(false);

    ticket.finish();
    expect(coordinator.isActive('load')).toBe(false);
  });

  it('detaches parent listeners when a ticket finishes', () => {
    const coordinator = new LatestOperationCoordinator<'load'>();
    const parent = new AbortController();
    const removeEventListener = vi.spyOn(parent.signal, 'removeEventListener');
    const ticket = coordinator.begin('load', parent.signal);

    ticket.finish();
    parent.abort();

    expect(removeEventListener).toHaveBeenCalled();
    expect(ticket.signal.aborted).toBe(false);
  });

  it('detaches parent listeners during invalidation and invalidates all dynamic keys', () => {
    const coordinator = new LatestOperationCoordinator<string>();
    const firstParent = new AbortController();
    const secondParent = new AbortController();
    const firstRemove = vi.spyOn(firstParent.signal, 'removeEventListener');
    const secondRemove = vi.spyOn(secondParent.signal, 'removeEventListener');
    const first = coordinator.begin('first', firstParent.signal);
    const second = coordinator.begin('second', secondParent.signal);

    coordinator.invalidate('first');
    expect(firstRemove).toHaveBeenCalled();
    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);

    coordinator.invalidateAll();
    expect(secondRemove).toHaveBeenCalled();
    expect(second.signal.aborted).toBe(true);
    expect(coordinator.isActive('first')).toBe(false);
    expect(coordinator.isActive('second')).toBe(false);
  });

  it('preserves generations across invalidation and supports already-aborted parents', () => {
    const coordinator = new LatestOperationCoordinator<'load'>();
    const first = coordinator.begin('load');
    coordinator.invalidate('load');
    const second = coordinator.begin('load');
    const parent = new AbortController();
    parent.abort('already aborted');
    const canceled = coordinator.begin('load', parent.signal);

    expect(second.generation).toBeGreaterThan(first.generation);
    expect(second.isCurrent()).toBe(false);
    expect(canceled.signal.aborted).toBe(true);
    expect(canceled.signal.reason).toBe('already aborted');
  });
});
