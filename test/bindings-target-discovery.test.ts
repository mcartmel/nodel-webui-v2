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

  it('fetches canonical unscoped IPv6 targets and skips display-only scoped candidates', async () => {
    discoveryApiMock.getLocalRest.mockResolvedValue({ nodes: {} });
    discoveryApiMock.searchNodeUrls.mockResolvedValue([
      { node: 'Display', address: 'http://fe80::1%EtherNet0:8085/nodes/Display/' },
      { node: 'Display', address: 'http://::1:8085/nodes/Display/' }
    ]);
    discoveryApiMock.getRemoteNodeActions.mockResolvedValue({ Power: { name: 'Power', title: 'Power' } });
    const service = new BindingTargetDiscoveryService();

    await expect(service.getDefinitions({ kind: 'actions', node: 'Display', nodeAddress: '' }, new AbortController().signal)).resolves.toEqual([
      { name: 'Power', title: 'Power', group: '' }
    ]);
    expect(discoveryApiMock.getRemoteNodeActions).toHaveBeenCalledWith('http://[::1]:8085/nodes/Display/', expect.any(Object));
    expect(discoveryApiMock.getRemoteNodeActions).not.toHaveBeenCalledWith(expect.stringContaining('EtherNet0'), expect.anything());
  });

  it('does not derive a local target URL from a malformed backend node name', async () => {
    discoveryApiMock.getLocalRest.mockResolvedValue({ nodes: { malformed: { name: 'Node\ud800' } } });
    const service = new BindingTargetDiscoveryService();

    await expect(service.getDefinitions({ kind: 'actions', node: 'Node\ud800', nodeAddress: '' }, new AbortController().signal)).resolves.toEqual([]);

    expect(discoveryApiMock.searchNodeUrls).not.toHaveBeenCalled();
    expect(discoveryApiMock.getRemoteNodeActions).not.toHaveBeenCalled();
  });

  it('filters before capping remote target requests while preserving deduplicated order', async () => {
    const pending = deferred<Record<string, unknown>>();
    discoveryApiMock.getLocalRest.mockResolvedValue({ nodes: {} });
    discoveryApiMock.searchNodeUrls.mockResolvedValue([
      ...Array.from({ length: 20 }, (_, index) => ({ node: 'Display', address: `javascript:invalid-${index}` })),
      { node: 'Display', address: 'http://fe80::1%EtherNet0:8085/nodes/Display/' },
      ...Array.from({ length: 21 }, (_, index) => ({ node: 'Display', address: `https://candidate-${index}.example/nodes/Display/` }))
    ]);
    discoveryApiMock.getRemoteNodeActions.mockReturnValue(pending.promise);
    const service = new BindingTargetDiscoveryService();
    const request = service.getDefinitions({
      kind: 'actions',
      node: 'Display',
      nodeAddress: 'https://candidate-0.example/nodes/Display/'
    }, new AbortController().signal);

    await vi.waitFor(() => expect(discoveryApiMock.getRemoteNodeActions).toHaveBeenCalledTimes(20));
    expect(discoveryApiMock.getRemoteNodeActions.mock.calls.map(([url]) => url)).toEqual(Array.from(
      { length: 20 },
      (_, index) => `https://candidate-${index}.example/nodes/Display/`
    ));
    pending.resolve({ Power: { name: 'Power', title: 'Power' } });

    await expect(request).resolves.toEqual([{ name: 'Power', title: 'Power', group: '' }]);
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
    const firstCall = discoveryApiMock.getLocalRest.mock.calls[0];
    if (firstCall === undefined) throw new Error('Missing local REST call.');
    const sharedSignal = firstCall[0].signal as AbortSignal;
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
    const firstCall = discoveryApiMock.getLocalRest.mock.calls[0];
    if (firstCall === undefined) throw new Error('Missing local REST call.');
    const sharedSignal = firstCall[0].signal as AbortSignal;
    service.clear();

    expect(sharedSignal.aborted).toBe(true);
    localRest.resolve({ nodes: { Display: { name: 'Display' } } });
    await first;

    expect(discoveryApiMock.getLocalRest).toHaveBeenCalledTimes(1);
  });
});
