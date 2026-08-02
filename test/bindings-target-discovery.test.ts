const discoveryApiMock = vi.hoisted(() => ({
  getLocalRest: vi.fn(),
  getRemoteNodeActions: vi.fn(),
  getRemoteNodeSignals: vi.fn(),
  searchNodeUrls: vi.fn()
}));

vi.mock('../src/api/nodel-host-client', () => discoveryApiMock);

import { BindingTargetDiscoveryService } from '../src/features/bindings-target-discovery';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('binding target discovery service', () => {
  beforeEach(() => {
    discoveryApiMock.getLocalRest.mockReset();
    discoveryApiMock.getRemoteNodeActions.mockReset();
    discoveryApiMock.getRemoteNodeSignals.mockReset();
    discoveryApiMock.searchNodeUrls.mockReset();
  });

  it('does not poison the local-node cache after a failed local lookup', async () => {
    discoveryApiMock.getLocalRest
      .mockRejectedValueOnce(new Error('local REST unavailable'))
      .mockResolvedValueOnce({ nodes: { Display: { name: 'Display' } } });
    discoveryApiMock.searchNodeUrls.mockResolvedValue([]);
    discoveryApiMock.getRemoteNodeActions.mockResolvedValue({ Power: { name: 'Power', title: 'Power' } });
    discoveryApiMock.getRemoteNodeSignals.mockResolvedValue({ Online: { name: 'Online', title: 'Online' } });

    const service = new BindingTargetDiscoveryService();
    await expect(service.getDefinitions({ kind: 'events', node: 'Display', nodeAddress: '' }, new AbortController().signal)).resolves.toEqual([
      { name: 'Online', title: 'Online', group: '' }
    ]);
    await expect(service.getDefinitions({ kind: 'actions', node: 'Display', nodeAddress: '' }, new AbortController().signal)).resolves.toEqual([
      { name: 'Power', title: 'Power', group: '' }
    ]);

    expect(discoveryApiMock.getLocalRest).toHaveBeenCalledTimes(2);
  });

  it('throws when every remote target definition request fails', async () => {
    discoveryApiMock.getLocalRest.mockResolvedValue({ nodes: {} });
    discoveryApiMock.searchNodeUrls.mockResolvedValue([
      { address: 'https://display.example/nodes/Display/', name: 'Display' }
    ]);
    discoveryApiMock.getRemoteNodeActions.mockRejectedValue(new Error('offline'));

    const service = new BindingTargetDiscoveryService();
    await expect(service.getDefinitions({ kind: 'actions', node: 'Display', nodeAddress: '' }, new AbortController().signal))
      .rejects.toThrow('Failed to load target definitions');
  });

  it('does not cache an empty result from an already aborted lookup', async () => {
    const service = new BindingTargetDiscoveryService();
    const aborted = new AbortController();
    aborted.abort();

    await expect(service.getDefinitions({ kind: 'actions', node: 'Display', nodeAddress: '' }, aborted.signal)).resolves.toEqual([]);

    discoveryApiMock.getLocalRest.mockResolvedValue({ nodes: { Display: { name: 'Display' } } });
    discoveryApiMock.getRemoteNodeActions.mockResolvedValue({ Power: { name: 'Power', title: 'Power' } });

    await expect(service.getDefinitions({ kind: 'actions', node: 'Display', nodeAddress: '' }, new AbortController().signal)).resolves.toEqual([
      { name: 'Power', title: 'Power', group: '' }
    ]);
  });

  it('keeps caller cancellation independent from shared local discovery', async () => {
    const localRest = deferred<{ nodes: Record<string, { name: string }> }>();
    discoveryApiMock.getLocalRest.mockReturnValue(localRest.promise);
    discoveryApiMock.getRemoteNodeActions.mockResolvedValue({ Power: { name: 'Power', title: 'Power' } });

    const service = new BindingTargetDiscoveryService();
    const caller = new AbortController();
    const first = service.getDefinitions({ kind: 'actions', node: 'Display', nodeAddress: '' }, caller.signal);
    const sharedSignal = discoveryApiMock.getLocalRest.mock.calls[0][0].signal as AbortSignal;
    caller.abort();
    localRest.resolve({ nodes: { Display: { name: 'Display' } } });

    await first;
    expect(sharedSignal.aborted).toBe(false);
    await expect(service.getDefinitions({ kind: 'actions', node: 'Display', nodeAddress: '' }, new AbortController().signal)).resolves.toEqual([
      { name: 'Power', title: 'Power', group: '' }
    ]);
    expect(discoveryApiMock.getLocalRest).toHaveBeenCalledTimes(1);
  });

  it('clears successful local-node snapshots when caches are cleared', async () => {
    discoveryApiMock.getLocalRest.mockResolvedValue({ nodes: { Display: { name: 'Display' } } });
    discoveryApiMock.getRemoteNodeActions.mockResolvedValue({ Power: { name: 'Power', title: 'Power' } });
    discoveryApiMock.getRemoteNodeSignals.mockResolvedValue({ Online: { name: 'Online', title: 'Online' } });

    const service = new BindingTargetDiscoveryService();
    await service.getDefinitions({ kind: 'actions', node: 'Display', nodeAddress: '' }, new AbortController().signal);
    service.clear();
    await service.getDefinitions({ kind: 'events', node: 'Display', nodeAddress: '' }, new AbortController().signal);

    expect(discoveryApiMock.getLocalRest).toHaveBeenCalledTimes(2);
  });

  it('does not let in-flight local discovery repopulate a cleared cache', async () => {
    const localRest = deferred<{ nodes: Record<string, { name: string }> }>();
    discoveryApiMock.getLocalRest
      .mockReturnValueOnce(localRest.promise)
      .mockResolvedValueOnce({ nodes: { Display: { name: 'Display' } } });
    discoveryApiMock.getRemoteNodeActions.mockResolvedValue({ Power: { name: 'Power', title: 'Power' } });

    const service = new BindingTargetDiscoveryService();
    const first = service.getDefinitions({ kind: 'actions', node: 'Display', nodeAddress: '' }, new AbortController().signal);
    service.clear();
    localRest.resolve({ nodes: { Display: { name: 'Display' } } });
    await first;

    await service.getDefinitions({ kind: 'actions', node: 'Display', nodeAddress: '' }, new AbortController().signal);

    expect(discoveryApiMock.getLocalRest).toHaveBeenCalledTimes(2);
  });

  it('aborts the service-owned local discovery request when cleared', async () => {
    const localRest = deferred<{ nodes: Record<string, { name: string }> }>();
    discoveryApiMock.getLocalRest.mockReturnValue(localRest.promise);
    discoveryApiMock.getRemoteNodeActions.mockResolvedValue({ Power: { name: 'Power', title: 'Power' } });

    const service = new BindingTargetDiscoveryService();
    const first = service.getDefinitions({ kind: 'actions', node: 'Display', nodeAddress: '' }, new AbortController().signal);
    const sharedSignal = discoveryApiMock.getLocalRest.mock.calls[0][0].signal as AbortSignal;
    service.clear();

    expect(sharedSignal.aborted).toBe(true);
    localRest.resolve({ nodes: { Display: { name: 'Display' } } });
    await first;

    expect(discoveryApiMock.getLocalRest).toHaveBeenCalledTimes(1);
  });
});
