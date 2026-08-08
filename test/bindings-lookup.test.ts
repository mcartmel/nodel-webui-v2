const lookupApiMock = vi.hoisted(() => ({
  getLocalRest: vi.fn(),
  getRemoteNodeActions: vi.fn(),
  getRemoteNodeSignals: vi.fn(),
  searchNodeUrls: vi.fn()
}));

vi.mock('../src/api/nodel-host-client', () => lookupApiMock);

import { BindingLookupService } from '../src/features/bindings-lookup';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('binding lookup service', () => {
  beforeEach(() => {
    lookupApiMock.getLocalRest.mockReset().mockResolvedValue({ nodes: {} });
    lookupApiMock.getRemoteNodeActions.mockReset().mockResolvedValue({});
    lookupApiMock.getRemoteNodeSignals.mockReset().mockResolvedValue({});
    lookupApiMock.searchNodeUrls.mockReset().mockResolvedValue([]);
  });

  it('does not query discovered nodes for blank input', async () => {
    const service = new BindingLookupService();
    await expect(service.searchNodeOptions('   ', new AbortController().signal)).resolves.toEqual([]);
    expect(lookupApiMock.searchNodeUrls).not.toHaveBeenCalled();
  });

  it('maps safe node URLs and caps results at twenty', async () => {
    lookupApiMock.searchNodeUrls.mockResolvedValue([
      ...Array.from({ length: 21 }, (_, index) => ({
        node: `Display ${index}`,
        address: `https://host-${index}.example/nodes/Display${index}/`
      }))
    ]);

    const service = new BindingLookupService();
    const options = await service.searchNodeOptions('Display', new AbortController().signal);

    expect(options).toHaveLength(20);
    expect(options[0]).toMatchObject({ value: 'Display 0', address: 'https://host-0.example/nodes/Display0/' });
    expect(options.every((option) => option.address.startsWith('https://'))).toBe(true);
  });

  it('excludes non-fetchable discovered node URLs', async () => {
    lookupApiMock.searchNodeUrls.mockResolvedValue([
      { node: 'Unsafe', address: 'javascript:alert(1)' },
      { node: 'Scoped', address: 'http://[fe80::1%25EtherNet0]:8085/nodes/Scoped/' },
      { node: 'IPv6', address: 'http://::1:8085/nodes/IPv6/' }
    ]);

    const service = new BindingLookupService();
    await expect(service.searchNodeOptions('node', new AbortController().signal)).resolves.toEqual([{
      label: 'IPv6',
      value: 'IPv6',
      address: 'http://[::1]:8085/nodes/IPv6/',
      detail: '[::1]:8085'
    }]);
  });

  it('uses advertised names and hosts when node labels are absent', async () => {
    lookupApiMock.searchNodeUrls.mockResolvedValue([
      { node: '', name: 'Named node', host: 'Friendly host', address: 'https://named.example/nodes/Named/' },
      { node: '', name: '', address: 'https://address.example/nodes/Address/' }
    ]);

    await expect(new BindingLookupService().searchNodeOptions('node', new AbortController().signal)).resolves.toEqual([
      { label: 'Named node', value: 'Named node', address: 'https://named.example/nodes/Named/', detail: 'Friendly host' },
      { label: 'https://address.example/nodes/Address/', value: 'https://address.example/nodes/Address/', address: 'https://address.example/nodes/Address/', detail: 'address.example' }
    ]);
  });

  it('filters scoped matches before applying the lookup cap', async () => {
    lookupApiMock.searchNodeUrls.mockResolvedValue([
      ...Array.from({ length: 20 }, (_, index) => ({ node: `Scoped ${index}`, address: `http://fe80::${index + 1}%EtherNet0:8085/nodes/Scoped${index}/` })),
      { node: 'Display', address: 'https://display.example/nodes/Display/' }
    ]);

    const service = new BindingLookupService();
    await expect(service.searchNodeOptions('Display', new AbortController().signal)).resolves.toEqual([expect.objectContaining({ value: 'Display' })]);
  });

  it('preserves Unicode node matching and target filtering', async () => {
    lookupApiMock.searchNodeUrls.mockResolvedValue([
      { node: 'Display Ünit', address: 'https://display.example/nodes/Display/' }
    ]);
    lookupApiMock.getRemoteNodeActions.mockResolvedValue({
      power: { name: 'power', title: 'Café Power' }
    });

    const service = new BindingLookupService();
    const options = await service.getTargetOptions({ kind: 'actions', node: 'Display Ünit', nodeAddress: '' }, 'Café', new AbortController().signal);

    expect(options).toEqual([{ label: 'Café Power', value: 'power', detail: 'power' }]);
  });

  it('returns successful target definitions when another discovered URL fails', async () => {
    lookupApiMock.searchNodeUrls.mockResolvedValue([
      { node: 'Display', address: 'https://bad.example/nodes/Display/' },
      { node: 'Display', address: 'https://good.example/nodes/Display/' }
    ]);
    lookupApiMock.getRemoteNodeActions.mockImplementation(async (url: string) => {
      if (url.includes('bad.example')) {
        throw new Error('offline');
      }
      return { power: { name: 'power', title: 'Power' } };
    });

    const service = new BindingLookupService();
    await expect(service.getTargetOptions({ kind: 'actions', node: 'Display', nodeAddress: '' }, '', new AbortController().signal)).resolves.toEqual([
      { label: 'Power', value: 'power', detail: 'power' }
    ]);
  });

  it('reports an all-target failure instead of returning no matches', async () => {
    lookupApiMock.searchNodeUrls.mockResolvedValue([
      { node: 'Display', address: 'https://bad.example/nodes/Display/' }
    ]);
    lookupApiMock.getRemoteNodeActions.mockRejectedValue(new Error('offline'));

    const service = new BindingLookupService();
    await expect(service.getTargetOptions({ kind: 'actions', node: 'Display', nodeAddress: '' }, '', new AbortController().signal))
      .rejects.toThrow('Failed to load target definitions');
  });

  it('propagates caller cancellation to target requests', async () => {
    const pending = deferred<Record<string, unknown>>();
    let targetSignal: AbortSignal | undefined;
    lookupApiMock.searchNodeUrls.mockResolvedValue([
      { node: 'Display', address: 'https://display.example/nodes/Display/' }
    ]);
    lookupApiMock.getRemoteNodeActions.mockImplementation((_url: string, init?: RequestInit) => {
      targetSignal = init?.signal ?? undefined;
      targetSignal?.addEventListener('abort', () => pending.reject(new DOMException('Aborted', 'AbortError')), { once: true });
      return pending.promise;
    });

    const service = new BindingLookupService();
    const caller = new AbortController();
    const request = service.getTargetOptions({ kind: 'actions', node: 'Display', nodeAddress: '' }, '', caller.signal);
    await vi.waitFor(() => expect(targetSignal).toBeDefined());
    caller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(targetSignal?.aborted).toBe(true);
  });

  it('clears composed target discovery caches', async () => {
    lookupApiMock.searchNodeUrls.mockResolvedValue([
      { node: 'Display', address: 'https://display.example/nodes/Display/' }
    ]);
    lookupApiMock.getRemoteNodeActions.mockResolvedValue({ power: { name: 'power', title: 'Power' } });

    const service = new BindingLookupService();
    const request = { kind: 'actions' as const, node: 'Display', nodeAddress: '' };
    await service.getTargetOptions(request, '', new AbortController().signal);
    service.clear();
    await service.getTargetOptions(request, '', new AbortController().signal);

    expect(lookupApiMock.getRemoteNodeActions).toHaveBeenCalledTimes(2);
    expect(lookupApiMock.searchNodeUrls).toHaveBeenCalledTimes(2);
  });
});
