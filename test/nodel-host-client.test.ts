import { once } from 'node:events';
import { createServer } from 'node:http';
import {
  createNode,
  duplicateNode,
  getDiagnosticMeasurements,
  getHostLogs,
  getNodeEventBinding,
  getNodeConsoleLogs,
  getNodeRemoteBindings,
  getNodeUrlsForNode,
  getNodeRestartStatus,
  listRecipes,
  NodelDuplicateNodeError,
  callNodeAction,
  emitNodeSignal,
  renameCurrentNode,
  saveNodeParams,
  saveNodeRemoteBindings,
  waitForNodeReady
} from '../src/api/nodel-host-client';
import { getTopologyActions, getTopologyEvents, getTopologyRemoteBindings, getTopologyRemoteSchema, localTopologyNodeAddress, topologyNodeAddress } from '../src/api/topology-client';
import { searchNodeUrls, searchNodeUrlsDetailed } from '../src/api/node-discovery';
import { subscribeConnectivity } from '../src/data/connectivity';
import { BindingLookupService } from '../src/features/bindings-lookup';
import { topologyReaders } from '../src/features/topology/topology-discovery';
import { reconstructTopology } from '../src/features/topology/topology-model';
import { presentTopology } from '../src/features/topology/topology-presentation';

const transportFetch = globalThis.fetch;

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected test value to be present');
  return value;
}

describe('nodel host client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const value = url === '/REST/logs?from=-1&max=200' || url === '/REST/diagnostics/measurements' || url.startsWith('REST/console?')
        ? []
        : { timestamp: '2026-01-01T00:00:00.000Z' };
      return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
  });

  it('reads topology bindings and schema with fixed read-only remote contracts', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), ...(init ? { init } : {}) });
      return new Response(JSON.stringify(String(input).endsWith('/REST/remote')
        ? { actions: { Move: { node: 'Device', action: 'Run' } }, events: {} }
        : { type: 'object', properties: { actions: { type: 'object' }, events: { type: 'object' } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }) as never;
    }) as unknown as typeof fetch);

    const target = topologyNodeAddress('https://host.example/nodes/Controller/')!;
    await expect(getTopologyRemoteBindings(target, { cache: 'force-cache', credentials: 'include', headers: { Authorization: 'ignored' } }))
      .resolves.toMatchObject({ actions: { Move: { node: 'Device', action: 'Run' } }, events: {} });
    await expect(getTopologyRemoteSchema(target))
      .resolves.toMatchObject({ type: 'object' });

    expect(calls.map(({ url }) => url)).toEqual([
      'https://host.example/nodes/Controller/REST/remote',
      'https://host.example/nodes/Controller/REST/remote/schema'
    ]);
    for (const { init } of calls) {
      expect(init).toMatchObject({ method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) });
      expect(new Headers(init?.headers).get('Accept')).toBe('application/json');
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get('Authorization')).toBeNull();
    }
  });

  it('carries malformed null fields through topology as conflicting rows, without changing legacy bindings', async () => {
    const rows = {
      actions: { ClearAction: {}, NullNode: { node: null }, NullAction: { action: null }, WrongKind: { event: null } },
      events: { ClearEvent: {}, NullEvent: { event: null }, NullNode: { node: null } }
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(rows))));
    const target = localTopologyNodeAddress('Display');
    await expect(getTopologyRemoteBindings(target)).resolves.toEqual({
      actions: { ClearAction: {}, NullNode: null, NullAction: null, WrongKind: null },
      events: { ClearEvent: {}, NullEvent: null, NullNode: null }
    });
    await expect(getNodeRemoteBindings()).resolves.toEqual({
      actions: { ClearAction: {}, NullNode: {}, NullAction: {}, WrongKind: {} },
      events: { ClearEvent: {}, NullEvent: {}, NullNode: {} }
    });

    const assignments = await topologyReaders.assignments(target, {});
    const graph = reconstructTopology({
      hostContext: window.location.origin,
      discovery: { status: 'success', source: 'inventory', value: ['Display'] },
      nodes: [{
        observationId: 'Display', name: 'Display', addresses: [],
        actions: { status: 'absent', source: 'actions' },
        events: { status: 'absent', source: 'events' },
        schema: { status: 'absent', source: 'schema' },
        assignments: { status: 'success', source: 'assignments', value: assignments }
      }]
    });
    expect(graph.bindings).toHaveLength(7);
    expect(graph.bindings.filter(({ assignment }) => assignment === 'unbound').map(({ alias }) => alias).sort())
      .toEqual(['ClearAction', 'ClearEvent']);
    for (const row of graph.bindings.filter(({ alias }) => !alias.startsWith('Clear'))) {
      expect(row).toMatchObject({ assignmentRow: 'present', assignment: 'conflicting', referenceResolution: 'unknown' });
      expect(row.targetNodeId).toBeUndefined();
    }
  });

  it('draws the valid Power assignment and removes a formerly wired Broken row when it becomes numeric', async () => {
    const power = { node: 'Device', action: 'On' };
    const previous = { actions: { Power: power, Broken: { node: 'Other', action: 'On' } }, events: {} };
    const current = { actions: { Power: power, Broken: 42 }, events: {} };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => new Response(JSON.stringify(previous)))
      .mockImplementationOnce(async () => new Response(JSON.stringify(current))));
    const target = localTopologyNodeAddress('Owner');
    const readGraph = async () => {
      const assignments = await topologyReaders.assignments(target, {});
      return reconstructTopology({
        hostContext: window.location.origin,
        discovery: { status: 'success', source: 'inventory', value: ['Owner'] },
        nodes: [{ observationId: 'Owner', name: 'Owner', addresses: [],
          actions: { status: 'absent', source: 'actions' }, events: { status: 'absent', source: 'events' },
          schema: { status: 'absent', source: 'schema' }, assignments: { status: 'success', source: 'assignments', value: assignments } }]
      });
    };
    const before = await readGraph();
    const after = await readGraph();
    const wires = (graph: typeof before) => presentTopology(graph, new Map(), {
      query: '', showCandidates: true, showPlaceholders: true
    }, 'connected').projection.wires;
    expect(wires(before)).toHaveLength(2);
    const oldBroken = before.bindings.find(({ alias }) => alias === 'Broken')!;
    expect(after.bindings.find(({ alias }) => alias === 'Broken')).toMatchObject({
      id: oldBroken.id, assignment: 'conflicting', assignmentRow: 'present', assignmentFreshness: 'current'
    });
    expect(after.bindings.filter(({ targetEndpointId }) => targetEndpointId)).toEqual([before.bindings.find(({ alias }) => alias === 'Power')]);
    expect(wires(after)).toEqual([expect.objectContaining({ id: before.bindings.find(({ alias }) => alias === 'Power')?.id })]);
    expect(after.nodes.some(({ name }) => name === 'Other')).toBe(false);
  });

  it('rejects redirects and does not fetch unsafe or guessed remote addresses', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    await expect(getTopologyRemoteBindings(topologyNodeAddress('https://user:secret@host.example/')!)).rejects.toThrow();
    expect(() => topologyNodeAddress('host.example')).not.toThrow();
    expect(topologyNodeAddress('host.example')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe('error');
      return new Response(null, { status: 302, headers: { Location: 'https://unverified.example/REST/remote' } });
    }) as unknown as typeof fetch);
    await expect(getTopologyRemoteBindings(topologyNodeAddress('https://advertised.example/nodes/Device/')!)).rejects.toThrow();
  });

  it('keeps topology display and fetch addresses separate and builds verified local addresses on current origin', () => {
    expect(topologyNodeAddress('https://display.example/nodes/Display/')).toEqual({
      fetchBase: 'https://display.example/nodes/Display/',
      displayAddress: 'https://display.example/nodes/Display/',
      adminHref: 'https://display.example/nodes/Display/',
      scope: 'remote'
    });
    expect(topologyNodeAddress('https://user:secret@display.example/')).toBeNull();
    expect(topologyNodeAddress('http://[fe80::1%25eth0]/nodes/Display/')).toMatchObject({
      fetchBase: '', displayAddress: 'http://[fe80::1%25eth0]/nodes/Display/', adminHref: null, scope: 'remote'
    });
    expect(localTopologyNodeAddress('Display')).toEqual({
      fetchBase: `${window.location.origin}/nodes/Display/`,
      displayAddress: `${window.location.origin}/nodes/Display/`,
      adminHref: `${window.location.origin}/nodes/Display/`,
      scope: 'local'
    });
  });

  it('rejects topology addresses with queries, fragments or raw control characters', () => {
    for (const base of ['https://example.test/nodes/Display/', 'http://[fe80::1%25eth0]/nodes/Display/']) {
      for (const suffix of ['?token=private', '#private', '?token=private#private', '?', '#', '\n', '\u0085']) {
        expect(topologyNodeAddress(base + suffix)).toBeNull();
      }
    }
    expect(topologyNodeAddress('https://example.test/nodes/Display%3F%23')).toEqual({
      fetchBase: 'https://example.test/nodes/Display%3F%23/',
      displayAddress: 'https://example.test/nodes/Display%3F%23/',
      adminHref: 'https://example.test/nodes/Display%3F%23/',
      scope: 'remote'
    });
  });

  it('uses fixed action and event read paths and sends credentials only to verified local nodes', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), ...(init ? { init } : {}) });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch);
    const local = localTopologyNodeAddress('Display');
    await getTopologyActions(local);
    await getTopologyEvents(local);
    await getTopologyActions(topologyNodeAddress('https://remote.example/nodes/Display/')!);
    expect(calls.map(({ url }) => url)).toEqual([
      `${window.location.origin}/nodes/Display/REST/actions`,
      `${window.location.origin}/nodes/Display/REST/events`,
      'https://remote.example/nodes/Display/REST/actions'
    ]);
    expect(calls.map(({ init }) => init?.credentials)).toEqual(['same-origin', 'same-origin', 'omit']);
    for (const { init } of calls) expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
    await expect(getTopologyActions({ ...local })).rejects.toThrow('current origin');
  });

  it('isolates failed and successful same-origin advertisements from host connectivity', async () => {
    const local = localTopologyNodeAddress('Display');
    const remote = topologyNodeAddress(local.fetchBase)!;
    let respond = false;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      if (!respond) throw new TypeError('unreadable');
      return new Response('{}');
    });
    vi.stubGlobal('fetch', fetchMock);
    const listener = vi.fn();
    const subscription = subscribeConnectivity(listener);
    const endpoint = `${local.fetchBase}REST/actions`;

    try {
      await expect(getTopologyActions(remote)).rejects.toThrow('unreadable');
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(endpoint, expect.objectContaining({ credentials: 'omit', cache: 'no-store' }));
      expect(listener).toHaveBeenCalledTimes(1);

      await expect(getTopologyActions(local)).rejects.toThrow('unreadable');
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([endpoint, endpoint, '/REST']);
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ offline: true, reason: 'network' }));
      const updates = listener.mock.calls.length;

      respond = true;
      await expect(getTopologyActions(remote)).resolves.toEqual({});
      expect(listener).toHaveBeenCalledTimes(updates);
      await expect(getTopologyActions(local)).resolves.toEqual({});
      expect(listener).toHaveBeenLastCalledWith({ offline: false, reason: '', retryAttempt: 0 });
    } finally {
      subscription.dispose();
    }
  });

  it('never requests the redirect destination when a local topology failure induces a probe', async () => {
    const requested: string[] = [];
    const server = createServer((request, response) => {
      const path = request.url ?? '';
      requested.push(path);
      if (path === '/redirect-destination') {
        response.writeHead(200).end('{}');
      } else {
        response.writeHead(302, { Location: '/redirect-destination' }).end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const listener = vi.fn();
    const subscription = subscribeConnectivity(listener);
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('Expected a loopback test server');
      const origin = `http://127.0.0.1:${address.port}`;
      // Map the jsdom page's logical origin to the fixture; the real Fetch
      // implementation handles redirect policy for both requests.
      const pending: Promise<Response>[] = [];
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), window.location.href);
        const result = transportFetch(`${origin}${url.pathname}`, init);
        pending.push(result);
        return result;
      });
      await expect(getTopologyActions(localTopologyNodeAddress('Display'))).rejects.toThrow();
      await Promise.allSettled(pending);
      expect(requested).toEqual(['/nodes/Display/REST/actions', '/REST']);
      expect(listener).toHaveBeenCalledExactlyOnceWith({ offline: false, reason: '', retryAttempt: 0 });
    } finally {
      subscription.dispose();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it.each([200, 403])('bounds topology, local inventory and discovery body reads at HTTP %i', async (status) => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: status === 200,
      status,
      statusText: '',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () => new Promise(() => undefined),
      text: () => new Promise(() => undefined)
    })) as unknown as typeof fetch);
    const pending = Promise.allSettled([
      getTopologyActions(localTopologyNodeAddress('Display')),
      import('../src/api/nodel-host-client').then(({ getLocalRest }) => getLocalRest()),
      searchNodeUrlsDetailed()
    ]);
    await vi.advanceTimersByTimeAsync(30_000);
    const results = await pending;
    expect(results).toHaveLength(3);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(results.map((result) => result.status === 'rejected' ? (result.reason as Error).name : '')).toEqual(['TimeoutError', 'TimeoutError', 'TimeoutError']);
  });

  it('does not dispatch topology or inventory reads for a pre-aborted signal', async () => {
    const caller = new AbortController();
    const reason = new DOMException('Aborted before dispatch', 'AbortError');
    caller.abort(reason);
    const { getLocalRest } = await import('../src/api/nodel-host-client');
    const opts = { signal: caller.signal };
    await Promise.all([
      expect(getTopologyActions(localTopologyNodeAddress('Display'), opts)).rejects.toBe(reason),
      expect(getLocalRest(opts)).rejects.toBe(reason),
      expect(searchNodeUrlsDetailed('', opts)).rejects.toBe(reason)
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns bounded redacted discovery diagnostics while retaining legacy array behavior', async () => {
    const legacyDisplay = { node: '', name: 'Display', address: 'https://display.example/nodes/Display/' };
    const rows = [
      { node: 'Good', address: 'https://good.example/nodes/Good/' },
      { node: 'Offline', address: 'https://user:password@bad.example/private?token=secret' },
      { node: 'NoAddress' },
      { node: 'Bad\u0000name', address: 'https://bad.example/' },
      legacyDisplay
    ];
    const discoveryFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const payload = JSON.parse(String(init?.body));
      if (String(input) === '/REST/nodeURLsForNode') {
        expect(payload).toEqual({ name: 'Display' });
      } else {
        expect(String(input)).toBe('/REST/nodeURLs');
        expect(payload).toEqual({ filter: payload.filter === 'Display' ? 'Display' : '' });
      }
      return new Response(JSON.stringify(payload.filter === '' ? rows : [legacyDisplay]));
    });
    vi.stubGlobal('fetch', discoveryFetch);
    const detailed = await searchNodeUrlsDetailed();
    expect(detailed.entries.map(({ node, address }) => ({ node, address }))).toEqual([
      { node: 'Good', address: 'https://good.example/nodes/Good/' },
      { node: 'Offline', address: undefined },
      { node: 'NoAddress', address: undefined }
    ]);
    expect(detailed.diagnostics).toEqual({
      discardedCount: 2,
      discarded: [{ index: 3, reason: 'unsafe-name' }, { index: 4, reason: 'missing-name' }],
      unusableAddressCount: 2,
      unusableAddresses: [{ index: 1, reason: 'unusable-address' }, { index: 2, reason: 'unusable-address' }],
      nameIssueCount: 0,
      nameIssues: []
    });
    expect(JSON.stringify(detailed)).not.toContain('password');
    expect(JSON.stringify(detailed)).not.toContain('token');
    await expect(searchNodeUrls('')).resolves.toEqual([rows[0], legacyDisplay]);
    await expect(getNodeUrlsForNode('Display')).resolves.toEqual([legacyDisplay]);
    await expect(new BindingLookupService().searchNodeOptions('Display', new AbortController().signal)).resolves.toEqual([
      { label: 'Display', value: 'Display', address: legacyDisplay.address, detail: 'display.example' }
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('propagates cancellation through node creation, readiness, and duplication', async () => {
    const createController = new AbortController();
    await createNode('Cancelled Node', 'Template', { signal: createController.signal });
    expect(fetch).toHaveBeenCalledWith('/REST/newNode', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ value: 'Cancelled Node', base: 'Template' }),
      signal: expect.any(AbortSignal)
    }));

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    const readyController = new AbortController();
    const readiness = waitForNodeReady('http://localhost/nodes/CancelledNode/', 30, 10_000, { signal: readyController.signal });
    await Promise.resolve();
    readyController.abort();
    await expect(readiness).rejects.toMatchObject({ name: 'AbortError' });

    const duplicateController = new AbortController();
    duplicateController.abort();
    await expect(duplicateNode('http://source/nodes/Test/', 'Cancelled Copy', { signal: duplicateController.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects malformed and supplementary names before create, rename, or duplicate requests', async () => {
    const invalidNames = ['Node\ud800', 'Node \ud83d\ude00'];

    for (const name of invalidNames) {
      await expect(createNode(name)).rejects.toThrow();
      await expect(renameCurrentNode(name)).rejects.toThrow();
      await expect(duplicateNode('http://source/nodes/Source/', name)).rejects.toThrow();
    }

    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects control names before create, rename, or duplicate requests', async () => {
    for (const name of ['Node\u0000', 'Node\u001f', 'Node\u007f', 'Node\u0080', 'Node\u009f']) {
      await expect(createNode(name)).rejects.toThrow('control or supplementary');
      await expect(renameCurrentNode(name)).rejects.toThrow('control or supplementary');
      await expect(duplicateNode('http://source/nodes/Source/', name)).rejects.toThrow('control or supplementary');
    }

    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects empty Java reductions before create, rename, or duplication requests', async () => {
    const emptyReduction = '\u00a0';

    await expect(createNode(emptyReduction)).rejects.toThrow('reduce to at least one path character');
    await expect(renameCurrentNode(emptyReduction)).rejects.toThrow('reduce to at least one path character');
    await expect(duplicateNode('http://source/nodes/Source/', emptyReduction)).rejects.toThrow('reduce to at least one path character');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates, renames, and duplicates ordinary BMP Unicode names exactly', async () => {
    const destination = 'Node \u4e2d\u6587';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'http://source/nodes/Source/REST/files') {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode' || url === 'REST/rename' || url === `${window.location.origin}/nodes/Node%E4%B8%AD%E6%96%87/REST/`) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await createNode(destination);
    await renameCurrentNode(destination);
    await expect(duplicateNode('http://source/nodes/Source/', destination)).resolves.toMatchObject({
      url: `${window.location.origin}/nodes/Node%E4%B8%AD%E6%96%87/`,
      copied: []
    });

    expect(fetchMock).toHaveBeenCalledWith('/REST/newNode', expect.objectContaining({
      body: JSON.stringify({ value: destination })
    }));
    expect(fetchMock).toHaveBeenCalledWith('REST/rename', expect.objectContaining({
      body: JSON.stringify({ value: destination })
    }));
    expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/nodes/Node%E4%B8%AD%E6%96%87/REST/`, expect.any(Object));
  });

  it('permits only portable typed recipe bases and exact decoded recipe capabilities', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/REST/recipes/list') {
        return new Response(JSON.stringify([{ path: '' }, { path: 'Recipes/legacy:template' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }) as never;
      }
      if (url === '/REST/newNode') {
        return new Response(JSON.stringify(JSON.parse(String(init?.body))), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    for (const base of ['', '../traversal', '..\\traversal', '/absolute', '\\absolute', 'C:drive', '\\\\server\\share', 'bad\u0000name', 'legacy:template']) {
      await expect(createNode('Blocked', base)).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();

    const [root, legacy] = await listRecipes();
    await expect(createNode('Root', root)).resolves.toEqual({ value: 'Root', base: '' });
    await expect(createNode('Legacy', legacy)).resolves.toEqual({ value: 'Legacy', base: 'Recipes/legacy:template' });
    await expect(createNode('Copied', { ...required(legacy) })).rejects.toThrow('exact decoded recipe entry');
  });

  it('reads node restart status with optional timestamp and timeout params', async () => {
    await expect(getNodeRestartStatus({ timestamp: '2026-01-01T00:00:00.000Z', timeout: 5000 })).resolves.toEqual({
      timestamp: '2026-01-01T00:00:00.000Z'
    });

    expect(fetch).toHaveBeenCalledWith(
      'REST/hasRestarted?timestamp=2026-01-01T00%3A00%3A00.000Z&timeout=5000',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('bounds invalid and excessive long-poll timeout values', async () => {
    await expect(getNodeRestartStatus({ timeout: Number.POSITIVE_INFINITY })).resolves.toEqual({ timestamp: '2026-01-01T00:00:00.000Z' });
    await expect(getNodeConsoleLogs({ from: -1, max: 200, timeout: 500_000 })).resolves.toEqual([]);

    expect(fetch).toHaveBeenCalledWith('REST/hasRestarted', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetch).toHaveBeenCalledWith('REST/console?from=-1&max=200&timeout=120000', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('blocks unsafe JSON values before parameter, action, signal, and binding writes', async () => {
    const unsafe = { arg: Number.POSITIVE_INFINITY };

    await expect(callNodeAction('Unsafe', unsafe)).rejects.toThrow('safe bounds');
    await expect(emitNodeSignal('Unsafe', unsafe)).rejects.toThrow('safe bounds');
    await expect(saveNodeParams(unsafe)).rejects.toThrow('safe bounds');
    await expect(saveNodeRemoteBindings(unsafe)).rejects.toThrow('safe bounds');
    await expect(callNodeAction('Blank', undefined)).rejects.toThrow('safe bounds');
    await expect(saveNodeParams(undefined as unknown as Record<string, unknown>)).rejects.toThrow('safe bounds');
    await expect(saveNodeRemoteBindings(undefined as unknown as Record<string, unknown>)).rejects.toThrow('safe bounds');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts and saves prototype-like binding aliases as exact JSON payload properties', async () => {
    const payload = JSON.parse('{"actions":{"__proto__":{"node":"Display","action":"PowerOn"},"constructor":{"node":"Display","action":"WarmUp"},"prototype":{"node":"Display","action":"CoolDown"}}}');

    await expect(saveNodeRemoteBindings(payload)).resolves.toEqual({ timestamp: '2026-01-01T00:00:00.000Z' });
    expect(fetch).toHaveBeenCalledWith('REST/remote/save', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(payload)
    }));
  });

  it('rejects unrepresentable and dot-only action and signal identifiers before requests', async () => {
    await expect(callNodeAction('\ud800', {})).rejects.toThrow('cannot be represented safely');
    await expect(emitNodeSignal('..', {})).rejects.toThrow('cannot be represented safely');
    await expect(callNodeAction('.', {})).rejects.toThrow('cannot be represented safely');
    expect(fetch).not.toHaveBeenCalled();

    await callNodeAction('run.v2', {});
    await emitNodeSignal('status.v2', {});
    expect(fetch).toHaveBeenCalledWith('REST/actions/run.v2/call', expect.anything());
    expect(fetch).toHaveBeenCalledWith('REST/events/status.v2/emit', expect.anything());
  });

  it('reads host diagnostics logs and measurements', async () => {
    const init = { signal: new AbortController().signal };

    await getHostLogs({ from: -1, max: 200 }, init);
    await getDiagnosticMeasurements(init);

    expect(fetch).toHaveBeenCalledWith('/REST/logs?from=-1&max=200', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(fetch).toHaveBeenCalledWith('/REST/diagnostics/measurements', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('resolves exact node URLs and typed local event bindings', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/REST/nodeURLsForNode') {
        expect(JSON.parse(String(init?.body))).toEqual({ name: 'Display' });
        return new Response(JSON.stringify([{ node: 'Display', address: 'https://display.example/nodes/Display/' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === 'REST/remote') {
        return new Response(JSON.stringify({ events: { DisplayStatus: { node: 'Display', event: 'Status' } } }), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    await expect(getNodeUrlsForNode('Display')).resolves.toEqual([{ node: 'Display', address: 'https://display.example/nodes/Display/' }]);
    await expect(getNodeEventBinding('DisplayStatus')).resolves.toEqual({ node: 'Display', event: 'Status' });
    await expect(getNodeEventBinding('Missing')).resolves.toBeNull();
    await expect(getNodeEventBinding('toString')).resolves.toBeNull();
  });

  it('rejects malformed local event bindings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ events: { Broken: 'not an object' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch);

    await expect(getNodeEventBinding('Broken')).rejects.toThrow('GET REST/remote returned invalid data at $.events.Broken: expected an object');
  });

  it('rejects a malformed remote event-binding collection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ events: 'not an object' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch);

    await expect(getNodeEventBinding('Broken')).rejects.toThrow('GET REST/remote returned invalid data at $.events: expected an object');
  });

  it('duplicates files byte-for-byte, filters unsafe files, and saves script.py last', async () => {
    const source = 'http://source/nodes/Original/';
    const payloads = new Map<string, number[]>([
      ['docs/readme.txt', Array.from(new TextEncoder().encode('Stage 9 text file\n'))],
      ['assets/image.png', [137, 80, 78, 71, 0, 255]],
      ['bundles/archive.zip', [80, 75, 3, 4, 254]],
      ['script.py', [35, 32, 114, 101, 99, 105, 112, 101]]
    ]);
    const files = [
      { path: 'script.py' },
      { path: 'docs/readme.txt' },
      { path: 'assets/image.png' },
      { path: 'bundles/archive.zip' },
      { path: 'Script.py' },
      { path: '_generated.json' },
      { path: 'nested/_cache.json' },
      { path: 'script_backup_2026.py' },
      { path: 'nested/script_backup_old.py' },
      { path: 'nodeConfig.json' }
    ];
    const saved = new Map<string, number[]>();
    const saveOrder: string[] = [];
    const progress: string[] = [];
    const creationRequests: Record<string, unknown>[] = [];

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify(files), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode') {
        creationRequests.push(JSON.parse(String(init?.body)));
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url.endsWith('/nodes/BinaryCopy/REST/')) {
        return new Response('{}', { status: 200 }) as never;
      }
      if (url.startsWith(`${source}REST/files/contents?path=`)) {
        const path = decodeURIComponent(required(url.split('path=')[1]));
        return new Response(Uint8Array.from(payloads.get(path) ?? []), { status: 200 }) as never;
      }
      if (url.endsWith('/nodes/BinaryCopy/REST/script/save')) {
        saveOrder.push('script.py');
        saved.set('script.py', Array.from(new TextEncoder().encode(JSON.parse(String(init?.body)).script)));
        expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
        return new Response('{}', { status: 200 }) as never;
      }
      if (url.includes('/nodes/BinaryCopy/REST/files/save?path=')) {
        const path = decodeURIComponent(required(url.split('path=')[1]));
        const body = init?.body as ArrayBuffer;
        saveOrder.push(path);
        saved.set(path, Array.from(new Uint8Array(body)));
        expect(new Headers(init?.headers).get('Content-Type')).toBe('application/octet-stream');
        return new Response('{}', { status: 200 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    const result = await duplicateNode(source, 'Binary Copy', {
      onProgress: (entry) => progress.push(entry.phase)
    });

    expect(saveOrder).toEqual(['docs/readme.txt', 'assets/image.png', 'bundles/archive.zip', 'script.py']);
    expect(creationRequests).toEqual([{ value: 'Binary Copy' }]);
    expect(Object.fromEntries(saved)).toEqual(Object.fromEntries(payloads));
    expect(result).toMatchObject({
      copied: saveOrder,
      failed: [],
      skipped: [
        'Script.py',
        '_generated.json',
        'nested/_cache.json',
        'script_backup_2026.py',
        'nested/script_backup_old.py',
        'nodeConfig.json'
      ]
    });
    expect(result.skippedDetails).toContainEqual({ path: 'Script.py', reason: 'Case-only script.py aliases cannot be copied safely.' });
    expect(progress).toEqual(['creating', 'waiting', 'copying', 'copying', 'copying', 'copying', 'complete']);
  });

  it('copies nodeConfig.json only when explicitly requested', async () => {
    const source = 'http://source/nodes/Original/';
    const saves: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify([{ path: 'nodeConfig.json' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode' || url.endsWith('/nodes/ConfiguredCopy/REST/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === `${source}REST/files/contents?path=nodeConfig.json`) {
        return new Response(Uint8Array.from([1, 2, 3]), { status: 200 }) as never;
      }
      if (url.includes('/nodes/ConfiguredCopy/REST/files/save?path=')) {
        saves.push(decodeURIComponent(required(url.split('path=')[1])));
        expect(Object.prototype.toString.call(init?.body)).toBe('[object ArrayBuffer]');
        return new Response('{}', { status: 200 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    const result = await duplicateNode(source, 'Configured Copy', { includeNodeConfig: true });

    expect(result.skipped).toEqual([]);
    expect(saves).toEqual(['nodeConfig.json']);
  });

  it('treats only root nodeConfig.json case aliases as configuration', async () => {
    const source = 'http://source/nodes/Original/';
    const reads: string[] = [];
    const saves: string[] = [];
    let files = [
      { path: 'NODECONFIG.JSON' },
      { path: 'nodeConfig.json' },
      { path: 'NodeConfig.json' },
      { path: 'templates/nodeConfig.json' }
    ];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify(files), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode' || url.endsWith('/nodes/AliasCopy/REST/')) {
        return new Response('{}', { status: 200 }) as never;
      }
      if (url.startsWith(`${source}REST/files/contents?path=`)) {
        reads.push(decodeURIComponent(required(url.split('path=')[1])));
        return new Response(Uint8Array.from([1, 2, 3]), { status: 200 }) as never;
      }
      if (url.includes('/nodes/AliasCopy/REST/files/save?path=')) {
        saves.push(decodeURIComponent(required(url.split('path=')[1])));
        return new Response('{}', { status: 200 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    const excluded = await duplicateNode(source, 'Alias Copy');
    expect(excluded.skipped).toEqual(['NODECONFIG.JSON', 'nodeConfig.json', 'NodeConfig.json']);
    expect(reads).toEqual(['templates/nodeConfig.json']);
    expect(saves).toEqual(['templates/nodeConfig.json']);

    reads.length = 0;
    saves.length = 0;
    files = [{ path: 'NODECONFIG.JSON' }, { path: 'NodeConfig.json' }, { path: 'templates/nodeConfig.json' }];
    const included = await duplicateNode(source, 'Alias Copy', { includeNodeConfig: true });
    expect(included.skipped).toEqual(['NodeConfig.json']);
    expect(reads).toEqual(['templates/nodeConfig.json', 'NODECONFIG.JSON']);
    expect(saves).toEqual(['templates/nodeConfig.json', 'nodeConfig.json']);
  });

  it('deduplicates exact duplicate source paths before copying', async () => {
    const source = 'http://source/nodes/Original/';
    const saves: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify([{ path: 'same.txt' }, { path: 'same.txt' }, { path: 'script.py' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode' || url.endsWith('/nodes/DedupedCopy/REST/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url.startsWith(`${source}REST/files/contents?path=`)) {
        return new Response(Uint8Array.from([1, 2, 3]), { status: 200 }) as never;
      }
      if (url.endsWith('/nodes/DedupedCopy/REST/script/save')) {
        saves.push('script.py');
        return new Response('{}', { status: 200 }) as never;
      }
      if (url.includes('/nodes/DedupedCopy/REST/files/save?path=')) {
        saves.push(decodeURIComponent(required(url.split('path=')[1])));
        expect(Object.prototype.toString.call(init?.body)).toBe('[object ArrayBuffer]');
        return new Response('{}', { status: 200 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    const result = await duplicateNode(source, 'Deduped Copy');

    expect(saves).toEqual(['same.txt', 'script.py']);
    expect(result.skipped).toEqual(['same.txt']);
  });

  it('skips legacy source paths and rejects oversized portable metadata before creating the destination', async () => {
    const source = 'http://source/nodes/Original/';
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify([{ path: 'content/legacy:one.txt' }, { path: 'content/é.txt' }, { path: 'content/unpaired\ud800name.txt' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode' || url.endsWith('/nodes/AmbiguousCopy/REST/')) {
        return new Response('{}', { status: 200 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    await expect(duplicateNode(source, 'Ambiguous Copy')).resolves.toMatchObject({
      copied: [],
      skipped: ['content/legacy:one.txt', 'content/é.txt', 'content/unpaired\ud800name.txt'],
      skippedDetails: [
        { path: 'content/legacy:one.txt', reason: 'Legacy path is read-only and cannot be copied safely.' },
        { path: 'content/é.txt', reason: 'Legacy path is read-only and cannot be copied safely.' },
        { path: 'content/unpaired\ud800name.txt', reason: 'Legacy path is read-only and cannot be copied safely.' }
      ]
    });
    expect(calls).toEqual([`${source}REST/files`, '/REST/newNode', expect.stringContaining('/nodes/AmbiguousCopy/REST/')]);

    calls.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify([{ path: 'huge.bin', size: 12 }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    await expect(duplicateNode(source, 'Huge Copy', { maxFileBytes: 8 })).rejects.toThrow('duplicate-copy limit');
    expect(calls).toEqual([`${source}REST/files`]);
  });

  it('continues after non-script failures and reports structured partial results', async () => {
    const source = 'http://source/nodes/Original/';
    const saves: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify([
          { path: 'read-failure.bin' },
          { path: 'save-failure.bin' },
          { path: 'good.bin' },
          { path: 'script.py' }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode' || url.endsWith('/nodes/PartialCopy/REST/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === `${source}REST/files/contents?path=read-failure.bin`) {
        return new Response('source unavailable', { status: 503, statusText: 'Unavailable' }) as never;
      }
      if (url.startsWith(`${source}REST/files/contents?path=`)) {
        return new Response(Uint8Array.from([1, 2, 3]), { status: 200 }) as never;
      }
      if (url.endsWith('/nodes/PartialCopy/REST/script/save')) {
        saves.push('script.py');
        return new Response('{}', { status: 200 }) as never;
      }
      if (url.includes('/nodes/PartialCopy/REST/files/save?path=')) {
        const path = decodeURIComponent(required(url.split('path=')[1]));
        saves.push(path);
        if (path === 'save-failure.bin') {
          return new Response(JSON.stringify({ message: 'destination rejected file' }), { status: 500, headers: { 'Content-Type': 'application/json' } }) as never;
        }
        return new Response('{}', { status: 200 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    const result = await duplicateNode(source, 'Partial Copy');

    expect(saves).toEqual(['save-failure.bin', 'good.bin', 'script.py']);
    expect(result.copied).toEqual(['good.bin', 'script.py']);
    expect(result.failed).toEqual([
      expect.objectContaining({ path: 'read-failure.bin', phase: 'read', status: 503, message: 'source unavailable' }),
      expect.objectContaining({ path: 'save-failure.bin', phase: 'save', status: 500, message: 'destination rejected file' })
    ]);
  });

  it('throws an incomplete-node error when script.py cannot be copied', async () => {
    const source = 'http://source/nodes/Original/';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify([{ path: 'script.py' }, { path: 'support.txt' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode' || url.endsWith('/nodes/BrokenCopy/REST/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url.startsWith(`${source}REST/files/contents?path=`)) {
        return new Response('content', { status: 200 }) as never;
      }
      if (url.includes('/nodes/BrokenCopy/REST/files/save?path=support.txt')) {
        return new Response('{}', { status: 200 }) as never;
      }
      if (url.includes('/nodes/BrokenCopy/REST/script/save')) {
        return new Response('recipe rejected', { status: 500 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    const promise = duplicateNode(source, 'Broken Copy');

    await expect(promise).rejects.toMatchObject({
      name: 'NodelDuplicateNodeError',
      destinationUrl: expect.stringContaining('/nodes/BrokenCopy/'),
      failed: [expect.objectContaining({ path: 'script.py', phase: 'save', status: 500 })]
    });
    await expect(promise).rejects.toBeInstanceOf(NodelDuplicateNodeError);
  });

  it('does not create a destination when the source list is unavailable or invalid', async () => {
    const source = 'http://source/nodes/Original/';
    const createCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify([{ invalid: true }]), { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode') {
        createCalls.push(url);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    await expect(duplicateNode(source, 'Invalid Copy')).rejects.toThrow('Failed to read source node file list: GET source REST/files returned invalid data');
    expect(createCalls).toEqual([]);
  });

  it('does not create a destination when the source file list request fails', async () => {
    const source = 'http://source/nodes/Original/';
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === `${source}REST/files`) {
        return new Response(JSON.stringify({ message: 'source node is offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    await expect(duplicateNode(source, 'Unavailable Copy')).rejects.toThrow('source node is offline');
    expect(calls).toEqual([`${source}REST/files`]);
  });

  it('labels destination creation failures distinctly from source-list failures', async () => {
    const source = 'http://source/nodes/Original/';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode') {
        return new Response(JSON.stringify({ message: 'destination name already exists' }), { status: 500, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    await expect(duplicateNode(source, 'Existing Copy')).rejects.toThrow(
      'Failed to create destination node "Existing Copy": destination name already exists'
    );
  });

  it('reports a created but unavailable destination after readiness timeout', async () => {
    vi.useFakeTimers();
    const source = 'http://source/nodes/Original/';
    let readinessAttempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${source}REST/files`) {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url === '/REST/newNode') {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) as never;
      }
      if (url.endsWith('/nodes/UnavailableCopy/REST/')) {
        readinessAttempts += 1;
        return new Response('starting', { status: 503 }) as never;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch);

    const duplication = duplicateNode(source, 'Unavailable Copy');
    const rejection = expect(duplication).rejects.toMatchObject({
      name: 'NodelDuplicateNodeError',
      destinationUrl: expect.stringContaining('/nodes/UnavailableCopy/'),
      message: expect.stringContaining('created but may be incomplete because it did not become available')
    });
    await vi.runAllTimersAsync();
    await rejection;
    expect(readinessAttempts).toBe(30);
  });
});
