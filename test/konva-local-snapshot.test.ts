import { buildLocalGraph, graphInputFromLocalSnapshot } from '../src/experiments/konva-canvas/local-graph';
import { projectLocalGraph } from '../src/experiments/konva-canvas/local-projection';
import { loadLocalSnapshot, LocalSnapshotInventoryError, type LocalSnapshot } from '../src/experiments/konva-canvas/local-snapshot';
import * as urls from '../src/utils/urls';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function json(value: unknown) {
  return Response.json(value);
}

function stalledBody(body: Promise<unknown>) {
  const response = json({});
  vi.spyOn(response, 'json').mockReturnValue(body);
  return response;
}

function stubFetch(handler: (path: string, init: RequestInit) => Promise<Response> | Response) {
  const mock = vi.fn(async (input: string | URL, init: RequestInit) => {
    const url = new URL(input, window.location.href);
    expect(url.origin).toBe(window.location.origin);
    expect(url.search + url.hash).toBe('');
    return handler(url.pathname, init);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function inventory(...names: string[]) {
  return json({ nodes: Object.fromEntries(names.map((name) => [name, {}])) });
}

function ownerRoute(name: string) {
  return `/nodes/${name}/REST/remote`;
}

function useClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Konva local snapshot read boundary', () => {
  it('uses only one inventory GET and local owner assignment GETs built from decoded names', async () => {
    const fetchMock = stubFetch((path) => {
      switch (path) {
        case '/REST':
          return json({ nodes: {
            'Not the owner name': { name: 'Café A ?# / \\ B', node: 'Also ignored', address: 'https://elsewhere.invalid/nodes/Wrong/' },
            'Fallback field': { name: null, node: 'Touch Panel' },
            'Map key': {}
          } });
        case '/nodes/Caf%C3%A9AB/REST/remote':
          return json({
            actions: { Power: { node: 'Referenced Only', action: 'Turn On' }, Unbound: {}, Incomplete: { node: 'Other Peer' } },
            events: { Playback: { node: 'Remote Player', event: 'Playing' } }
          });
        default:
          return json({});
      }
    });

    const snapshot = await loadLocalSnapshot();
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      '/REST',
      `${location.origin}/nodes/Caf%C3%A9AB/REST/remote`,
      `${location.origin}/nodes/Mapkey/REST/remote`,
      `${location.origin}/nodes/TouchPanel/REST/remote`
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toEqual({
        method: 'GET', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal)
      });
    }
    expect(snapshot.owners).toMatchObject([
      { key: 'cafeab', name: 'Café A ?# / \\ B', status: 'read', bindings: {
        actions: { Power: { node: 'Referenced Only', action: 'Turn On' }, Unbound: {}, Incomplete: { node: 'Other Peer' } },
        events: { Playback: { node: 'Remote Player', event: 'Playing' } }
      } },
      { name: 'Map key', status: 'read', bindings: {} },
      { name: 'Touch Panel', status: 'read', bindings: {} }
    ]);
  });

  it('coalesces equal keys only for a proven shared URL and keeps unsafe and ambiguous locals unread', async () => {
    const names = ['Panel (West)', 'power', 'Panel (East)', 'Power', 'No Safe Path 😀', 'Bad\ud800', 'Ъь', 'Mixed', 'Mixed (🚀)'];
    let rowOrder = names;
    const fetchMock = stubFetch((path) => path === '/REST' ? inventory(...rowOrder) : json({}));
    const first = await loadLocalSnapshot();
    rowOrder = [...names].reverse();
    const second = await loadLocalSnapshot();
    expect(first).toEqual(second);
    expect(first.owners).toEqual([
      { key: 'bad\ud800', name: 'Bad\ud800', status: 'unread', reason: 'unaddressable' },
      { key: 'mixed', name: 'Mixed', status: 'unread', reason: 'ambiguous' },
      { key: 'nosafepath😀', name: 'No Safe Path 😀', status: 'unread', reason: 'unaddressable' },
      { key: 'panel', name: 'Panel (East)', status: 'read', bindings: {} },
      { key: 'power', name: 'Power', status: 'unread', reason: 'ambiguous' },
      { key: null, name: 'Ъь', status: 'unread', reason: 'unaddressable' }
    ]);
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      '/REST', `${location.origin}/nodes/Panel/REST/remote`, '/REST', `${location.origin}/nodes/Panel/REST/remote`
    ]);
  });

  it('distinguishes a confirmed empty inventory from malformed or denied inventory', async () => {
    const fetchMock = stubFetch(() => json({ nodes: {} }));
    await expect(loadLocalSnapshot()).resolves.toEqual({ owners: [] });

    const badResponses = [
      json({}), json({ nodes: null }), json({ nodes: [] }), json({ nodes: { Broken: null } }),
      json({ nodes: { '...': {} } }), json({ nodes: { Unsafe: { address: 'javascript:invalid' } } }),
      new Response('<html>Not REST</html>', { headers: { 'Content-Type': 'text/html' } }),
      new Response('permission denied', { status: 403 })
    ];
    for (const response of badResponses) {
      fetchMock.mockResolvedValueOnce(response);
      await expect(loadLocalSnapshot()).rejects.toMatchObject({ name: 'LocalSnapshotInventoryError', timedOut: false });
    }
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual(Array<string>(badResponses.length + 1).fill('/REST'));
  });

  it('keeps bad owner data unread instead of mistaking it for empty configuration', async () => {
    stubFetch((path) => {
      if (path === '/REST') return inventory('Malformed', 'Denied', 'Empty', 'Valid');
      if (path === ownerRoute('Malformed')) return json({ actions: { Broken: { action: 42 } } });
      if (path === ownerRoute('Denied')) return new Response('secret diagnostic', { status: 403 });
      if (path === ownerRoute('Valid')) return json({ events: { ToLocal: { node: 'Empty', event: 'Tick' } } });
      return json({});
    });
    expect((await loadLocalSnapshot()).owners).toEqual([
      { key: 'denied', name: 'Denied', status: 'unread', reason: 'failed' },
      { key: 'empty', name: 'Empty', status: 'read', bindings: {} },
      { key: 'malformed', name: 'Malformed', status: 'unread', reason: 'failed' },
      { key: 'valid', name: 'Valid', status: 'read', bindings: { events: { ToLocal: { node: 'Empty', event: 'Tick' } } } }
    ]);
  });

  it('instructs Fetch to reject redirects for both inventory and owner requests without retrying', async () => {
    const fetchMock = stubFetch(() => { throw new Error('Unexpected extra request'); });
    const performRedirect = async (_input: string | URL, init: RequestInit) => {
      // Simulate browser Fetch's redirect:'error' rejection without networking.
      if (init.redirect === 'error') throw new TypeError('Redirect not allowed');
      return json({ nodes: {} });
    };
    fetchMock.mockImplementationOnce(performRedirect);
    await expect(loadLocalSnapshot()).rejects.toBeInstanceOf(LocalSnapshotInventoryError);

    fetchMock.mockResolvedValueOnce(inventory('Redirected')).mockImplementationOnce(performRedirect);
    expect((await loadLocalSnapshot()).owners).toEqual([
      { key: 'redirected', name: 'Redirected', status: 'unread', reason: 'failed' }
    ]);
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      '/REST', '/REST', `${location.origin}/nodes/Redirected/REST/remote`
    ]);
  });
});

describe('Konva local snapshot terminal state', () => {
  it('keeps physical slots past owner timeouts and publishes one graph with its retained wire at the overall cutoff', async () => {
    useClock();
    const localInventory = deferred<Response>();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const lateBody = deferred<unknown>();
    const lateFetch = deferred<Response>();
    const lateFailure = deferred<Response>();
    const never = deferred<unknown>();
    const fetchMock = stubFetch((path) => {
      if (path === '/REST') return localInventory.promise;
      switch (path) {
        case ownerRoute('A'): return stalledBody(first.promise);
        case ownerRoute('B'): return stalledBody(second.promise);
        case ownerRoute('C'): return stalledBody(lateBody.promise);
        case ownerRoute('D'): return lateFetch.promise;
        case ownerRoute('E'): return lateFailure.promise;
        case ownerRoute('F'): return stalledBody(never.promise);
        default: throw new Error('Reads G and H should stay queued');
      }
    });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const publication = vi.fn((snapshot: LocalSnapshot) => projectLocalGraph(buildLocalGraph(graphInputFromLocalSnapshot(snapshot))));
    const result = loadLocalSnapshot(controller.signal);
    const projected = result.then(publication);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    localInventory.resolve(inventory('H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(5); // 1 inventory + 4 owners, even though 3 returned headers

    const assignment = { actions: { Send: { node: 'Referenced', action: 'Run', extra: [1] } } };
    first.resolve(assignment);
    second.resolve({});
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchMock).toHaveBeenCalledTimes(7); // 2 more, replacing only the truly finished reads
    expect(publication).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[3]?.[1].signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock.mock.calls.slice(3).every(([, init]) => init.signal?.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(publication).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(7); // no physical release on an abort signal alone

    await vi.advanceTimersByTimeAsync(1);
    const snapshot = await result;
    const projection = await projected;
    expect(publication).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(snapshot.owners.map((owner) => [owner.name, owner.status])).toEqual([
      ['A', 'read'], ['B', 'read'], ['C', 'unread'], ['D', 'unread'],
      ['E', 'unread'], ['F', 'unread'], ['G', 'unread'], ['H', 'unread']
    ]);
    expect(snapshot.owners[0]).toMatchObject({ bindings: assignment });
    expect(snapshot.owners[1]).toMatchObject({ bindings: {} });
    expect(snapshot.owners.slice(2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'C', reason: 'timed-out' }),
      expect.objectContaining({ name: 'H', reason: 'unfinished' })
    ]));
    expect(fetchMock.mock.calls.slice(3).every(([, init]) => init.signal?.aborted)).toBe(true);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.owners)).toBe(true);
    expect(snapshot.owners.every(Object.isFrozen)).toBe(true);
    const readOwner = snapshot.owners[0];
    if (readOwner?.status !== 'read') throw new Error('Expected owner A to finish');
    expect(Object.isFrozen(readOwner.bindings)).toBe(true);
    expect(Object.isFrozen(readOwner.bindings.actions)).toBe(true);
    expect(Object.isFrozen(readOwner.bindings.actions?.Send)).toBe(true);
    expect(Object.isFrozen((readOwner.bindings.actions?.Send as { extra: number[] }).extra)).toBe(true);
    expect(projection.summary).toBe('8 local · 1 referenced · 1 configured · 6 local unread');
    expect(projection.nodes).toHaveLength(9);
    expect(projection.nodes.find((node) => node.name === 'B')?.displayStatus).toBe('');
    expect(projection.nodes.find((node) => node.name === 'B')?.tooltip).toContain('Inspection succeeded; 0 configured bindings, none unassigned.');
    for (const name of ['C', 'D', 'E', 'F', 'G', 'H']) {
      expect(projection.nodes.find((node) => node.name === name)?.displayStatus).toBe('Not inspected');
    }
    const source = projection.nodes.find((node) => node.name === 'A')!;
    const target = projection.nodes.find((node) => node.name === 'Referenced')!;
    expect(target.displayStatus).toBe('Not inspected');
    expect(source.ports[0]).toMatchObject({ label: 'Send', direction: 'out' });
    expect(target.ports[0]).toMatchObject({ label: 'Run', direction: 'in' });
    expect(projection.edges).toEqual([expect.objectContaining({
      from: { nodeId: source.id, portId: source.ports[0]!.id },
      to: { nodeId: target.id, portId: target.ports[0]!.id }
    })]);
    const publishedState = JSON.stringify(snapshot);
    const publishedScene = JSON.stringify(projection);

    lateBody.resolve({ actions: { Late: { node: 'Late Peer', action: 'Run' } } });
    lateFetch.resolve(json({ events: { Late: { node: 'Late Peer', event: 'Started' } } }));
    lateFailure.reject(new Error('late error'));
    controller.abort();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(publication).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(JSON.stringify(snapshot)).toBe(publishedState);
    expect(JSON.stringify(projection)).toBe(publishedScene);
  });

  it('lets an abort-responsive body release a slot while timed-out late successes stay unread', async () => {
    useClock();
    const responsiveBody = deferred<unknown>();
    const unresponsive = deferred<void>();
    const fetchMock = stubFetch((path, init) => {
      if (path === '/REST') return inventory('A', 'B', 'C', 'D', 'E', 'F');
      if (path === ownerRoute('A')) {
        init.signal?.addEventListener('abort', () => responsiveBody.reject(new DOMException('body aborted', 'AbortError')), { once: true });
        return stalledBody(responsiveBody.promise);
      }
      if (path === ownerRoute('E')) return json({});
      if (path === ownerRoute('F')) return json({ actions: { Send: { node: 'Target', action: 'Run' } } });
      return unresponsive.promise.then(() => json({ actions: { Late: { node: 'Target', action: 'Wrong' } } }));
    });
    const result = loadLocalSnapshot();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    // A really settled, making its slot available to E and then F. B/C/D's
    // abort-insensitive promises still own the other three physical slots.
    expect(fetchMock.mock.calls.map(([input]) => new URL(input, location.href).pathname)).toEqual([
      '/REST', ...['A', 'B', 'C', 'D', 'E', 'F'].map(ownerRoute)
    ]);
    expect(fetchMock.mock.calls.slice(1, 5).every(([, init]) => init.signal?.aborted)).toBe(true);
    expect(fetchMock.mock.calls.slice(5).every(([, init]) => !init.signal?.aborted)).toBe(true);

    unresponsive.resolve(undefined);
    const snapshot = await result;
    expect(snapshot.owners.slice(0, 4)).toEqual(['A', 'B', 'C', 'D'].map((name) => ({
      key: name.toLowerCase(), name, status: 'unread', reason: 'timed-out'
    })));
    expect(snapshot.owners.slice(4)).toMatchObject([
      { name: 'E', status: 'read', bindings: {} },
      { name: 'F', status: 'read', bindings: { actions: { Send: { action: 'Run', node: 'Target' } } } }
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['fetch', 'JSON body'])('rejects on inventory timeout with no pending timers when its %s never settles', async (stage) => {
    useClock();
    const fetchMock = stubFetch(() => stage === 'fetch' ? deferred<Response>().promise : stalledBody(deferred<unknown>().promise));
    const result = loadLocalSnapshot();
    const check = expect(result).rejects.toMatchObject({ name: 'LocalSnapshotInventoryError', timedOut: true });
    await vi.advanceTimersByTimeAsync(10_000);
    await check;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1].signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('publishes seeded unread cards without dispatching owner GETs when route planning crosses the cutoff', async () => {
    useClock();
    const localInventory = deferred<Response>();
    const fetchMock = stubFetch((path) => {
      if (path === '/REST') return localInventory.promise;
      throw new Error('Owner GET must not start after the cutoff');
    });
    const now = vi.spyOn(performance, 'now');
    const localNodeUrl = urls.localNodeUrl;
    let planningStartedAt: number | undefined;
    vi.spyOn(urls, 'localNodeUrl').mockImplementationOnce((name, origin) => {
      planningStartedAt = performance.now();
      const route = localNodeUrl(name, origin);
      // Cross the monotonic deadline inside synchronous planning, before the
      // overall timer callback can run.
      now.mockReturnValue(10_000);
      return route;
    });
    const publish = vi.fn((snapshot: LocalSnapshot) => projectLocalGraph(buildLocalGraph(graphInputFromLocalSnapshot(snapshot))));
    const result = loadLocalSnapshot().then(publish);
    await vi.advanceTimersByTimeAsync(9_999);
    localInventory.resolve(inventory('Beta', 'Alpha'));

    const projection = await result;
    expect(planningStartedAt).toBe(9_999);
    expect(projection.nodes.map(({ name, displayStatus }) => [name, displayStatus])).toEqual([
      ['Alpha', 'Not inspected'], ['Beta', 'Not inspected']
    ]);
    expect(projection.edges).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual(['/REST']);
  });

  it('enforces the monotonic cutoff before accepting a resumed microtask even if the timer has not fired', async () => {
    useClock();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const owner = deferred<unknown>();
    const fetchMock = stubFetch((path) => path === '/REST' ? inventory('Owner') : stalledBody(owner.promise));
    const result = loadLocalSnapshot();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    now.mockReturnValue(10_000);
    owner.resolve({});
    await expect(result).resolves.toEqual({ owners: [{ key: 'owner', name: 'Owner', status: 'unread', reason: 'unfinished' }] });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a body that settles at its owner deadline before the timeout callback gets a turn', async () => {
    useClock();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const owner = deferred<unknown>();
    const fetchMock = stubFetch((path) => path === '/REST' ? inventory('Owner') : stalledBody(owner.promise));
    const result = loadLocalSnapshot();
    await vi.advanceTimersByTimeAsync(0);
    now.mockReturnValue(3_000);
    owner.resolve({});
    await expect(result).resolves.toEqual({ owners: [{ key: 'owner', name: 'Owner', status: 'unread', reason: 'timed-out' }] });
    expect(fetchMock.mock.calls[1]?.[1].signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['inventory', 'owners'])('unload cancels without publication while %s are pending', async (stage) => {
    useClock();
    const pending = deferred<Response>();
    const fetchMock = stubFetch((path) => {
      if (stage === 'inventory') return pending.promise;
      if (path === '/REST') return inventory('A', 'B', 'C', 'D', 'E', 'F');
      return path === ownerRoute('A') ? json({ actions: { Completed: { node: 'Peer', action: 'Run' } } }) : pending.promise;
    });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const publish = vi.fn();
    const result = loadLocalSnapshot(controller.signal).then(publish);
    const check = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1_000);
    const requests = stage === 'inventory' ? 1 : 6;
    expect(fetchMock).toHaveBeenCalledTimes(requests);
    controller.abort(new Error('page unloaded'));
    await check;
    const outstanding = stage === 'inventory' ? fetchMock.mock.calls : fetchMock.mock.calls.slice(2);
    expect(outstanding.every(([, init]) => init.signal?.aborted)).toBe(true);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);

    pending.resolve(stage === 'inventory' ? inventory('Late') : json({}));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(publish).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(requests);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start an inventory read for an already cancelled source', async () => {
    useClock();
    const fetchMock = stubFetch(() => inventory());
    const controller = new AbortController();
    controller.abort();
    await expect(loadLocalSnapshot(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
