import { checkHostReachable } from '../src/api/node-discovery';

describe('node discovery reachability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps an abort-insensitive probe as cancellation rather than unreachable', async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    })) as unknown as typeof fetch);
    const controller = new AbortController();
    const result = checkHostReachable('remote:8085', 3000, controller.signal);

    controller.abort();
    resolveFetch(new Response('', { status: 503 }));

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('marks completed transport failures as unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failed')) as unknown as typeof fetch);

    await expect(checkHostReachable('remote:8085')).resolves.toEqual({ host: 'remote:8085', reachable: false });
  });

  it('probes a canonical unscoped IPv6 REST URL through a native URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkHostReachable('::1:8085')).resolves.toEqual({ host: '::1:8085', reachable: true });
    expect(fetchMock).toHaveBeenCalledWith(new URL('http://[::1]:8085/REST'), expect.any(Object));
  });

  it('does not fetch scoped IPv6 hosts that the native URL parser rejects', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    await expect(checkHostReachable('fe80::1%EtherNet0:8085')).resolves.toEqual({ host: 'fe80::1%EtherNet0:8085', reachable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
