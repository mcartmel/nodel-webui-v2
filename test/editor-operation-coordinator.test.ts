import { EditorOperationCoordinator, type EditorOperationKind } from '../src/editor/editor-operation-coordinator';

describe('editor operation coordinator', () => {
  it('keeps independent generations and prevents stale completion ownership', () => {
    const coordinator = new EditorOperationCoordinator();
    const firstOpen = coordinator.begin('open');
    const save = coordinator.begin('save');
    const secondOpen = coordinator.begin('open');

    expect(firstOpen.signal.aborted).toBe(true);
    expect(firstOpen.isCurrent()).toBe(false);
    expect(secondOpen.isCurrent()).toBe(true);
    expect(save.isCurrent()).toBe(true);
    firstOpen.finish();
    expect(coordinator.isActive('open')).toBe(true);
    secondOpen.finish();
    expect(coordinator.isActive('open')).toBe(false);
    expect(coordinator.isActive('save')).toBe(true);
  });

  it('invalidates every operation and inherits parent cancellation', () => {
    const coordinator = new EditorOperationCoordinator();
    const parent = new AbortController();
    const create = coordinator.begin('create', parent.signal);
    parent.abort();
    expect(create.signal.aborted).toBe(true);
    expect(create.isCurrent()).toBe(false);

    const tickets = (['list', 'open', 'save', 'create', 'delete'] as EditorOperationKind[]).map((kind) => coordinator.begin(kind));
    coordinator.invalidateAll();
    expect(tickets.every((ticket) => ticket.signal.aborted && !ticket.isCurrent())).toBe(true);
  });
});
