// @vitest-environment-options {"url":"https://topology.example/"}

import { MAX_FALLBACK_DETAIL_NODES_PER_CYCLE, MAX_PRIMARY_DETAIL_NODES_PER_CYCLE, TopologyController, type TopologyUpdate } from '../src/features/topology/topology-controller';
import { MAX_DETAIL_NAME_LENGTH, MAX_DETAIL_TEXT_PER_INTERFACE, MAX_INVENTORY_ROUTES_PER_SOURCE } from '../src/features/topology/topology-discovery';
import { localNodeUrl } from '../src/utils/urls';

const localBase = () => localNodeUrl('Owner');
const networkBase = 'https://display.example/nodes/display/';
const advertised = (node: string, address: string) => ({ node, address });
const local = (name = 'Owner') => ({ nodes: { [name]: { name } } });
const empty = { nodes: {} };
const epoch = new Date('2026-08-01T01:00:00.000Z');

interface Call { url: string; init?: RequestInit }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const failure = () => json({ error: 'untrusted error content' }, 403);
const actions = (name = 'On') => ({ 'ignored transport key': { name } });
const assignments = (node = 'Display', action = 'On') => ({ actions: { Power: { node, action } } });
const schema = { properties: { actions: { type: 'object', properties: { Power: { type: 'object' } } } } };

const pendingFixtures = new Set<() => void>();

function deferred<T>(cleanupValue: () => T) {
  let complete!: (value: T) => void;
  const promise = new Promise<T>((done) => { complete = done; });
  const cleanup = () => resolve(cleanupValue());
  const resolve = (value: T) => {
    pendingFixtures.delete(cleanup);
    complete(value);
  };
  pendingFixtures.add(cleanup);
  return { promise, resolve };
}

const heldResponse = () => deferred<Response>(() => json({}));
const heldBody = () => deferred<unknown>(() => ({}));

function mockFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(url), ...(init ? { init } : {}) };
    calls.push(call);
    return Promise.resolve(handler(call));
  }));
  return calls;
}

const controllers: TopologyController[] = [];

function create() {
  const updates: TopologyUpdate[] = [];
  const controller = new TopologyController((update) => updates.push(update));
  controllers.push(controller);
  return { controller, updates, latest: () => updates.at(-1)! };
}

function mutableVisibility(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

function mutableConnectivity(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(epoch);
  mutableVisibility(false);
  mutableConnectivity(true);
});

afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.dispose();
  // Abort-insensitive fixtures must release their shared physical slots even
  // when an earlier assertion fails; otherwise later lifecycle tests cascade.
  for (const settle of pendingFixtures) settle();
  await flush();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'onLine');
  Reflect.deleteProperty(document, 'hidden');
});

const flush = () => vi.advanceTimersByTimeAsync(0);
const flushProgress = () => vi.advanceTimersByTimeAsync(16);

describe('TopologyController discovery', () => {
  it('publishes useful local data while the network list stalls and limits combined HTTP concurrency to four', async () => {
    const discovery = heldResponse();
    const nodeReads: Array<ReturnType<typeof heldResponse>> = [];
    const requests = mockFetch(({ url }) => {
      if (url === '/REST') return json(local());
      if (url === '/REST/nodeURLs') return discovery.promise;
      const read = heldResponse();
      nodeReads.push(read);
      return read.promise;
    });
    const { controller, latest, updates } = create();
    expect(requests).toEqual([]);
    controller.start();
    controller.start();
    await flushProgress();
    expect(nodeReads).toHaveLength(3);
    expect(latest()).toMatchObject({ phase: 'loading', progress: { total: 6, completed: 1 } });
    expect(latest().graph.nodes.map(({ name }) => name)).toEqual(['Owner']);

    nodeReads[0]!.resolve(json(actions('Local only')));
    await flushProgress();
    expect(nodeReads).toHaveLength(4);
    expect(latest().graph.endpoints.map(({ name }) => name)).toContain('Local only');
    expect(latest().phase).toBe('loading');
    expect(latest().nodeStatuses.get(latest().graph.nodes[0]!.id)?.readability).toBe('partial');
    discovery.resolve(json([advertised('Display', networkBase)]));
    for (const read of nodeReads) read.resolve(json({}));
    await flush();
    expect(nodeReads).toHaveLength(8);
    for (const read of nodeReads) read.resolve(json({}));
    await flush();

    expect(latest()).toMatchObject({ phase: 'idle', coverage: 'complete', progress: { completed: 10, total: 10 } });
    expect(latest().lastSuccessAt).toBe(Date.now());
    expect(updates.every(({ progress }) => progress.total >= progress.completed)).toBe(true);
    expect(latest().graph.nodes.every(({ id }) => latest().nodeStatuses.get(id)?.readability === 'readable')).toBe(true);
  });

  it('keeps alternate addresses but reads only one route per logical node and prefers verified local even when discovery arrives first', async () => {
    const ownerInventory = heldResponse();
    const alternate = 'https://z-alternate.example/nodes/display/';
    const alternateOwner = 'https://anonymous.example/nodes/owner/';
    const requests = mockFetch(({ url }) => {
      if (url === '/REST') return ownerInventory.promise;
      if (url === '/REST/nodeURLs') return json([
        advertised('owner', localBase().slice(0, -1)), advertised('Owner', localBase()),
        advertised('Display', networkBase), advertised('Display', networkBase.slice(0, -1)),
        advertised('DISPLAY', alternate), advertised('Owner', alternateOwner)
      ]);
      if (url === `${localBase()}REST/remote`) return json(assignments());
      if (url === `${networkBase}REST/actions`) return json(actions('On'));
      return json({});
    });
    const { controller, latest } = create();
    controller.start();
    await flush();
    expect(requests).toHaveLength(2);
    ownerInventory.resolve(json(local()));
    await flush();

    const ownerCalls = requests.filter(({ url }) => url.startsWith(localBase()));
    expect(ownerCalls).toHaveLength(4);
    expect(ownerCalls.every(({ init }) => init?.credentials === 'same-origin')).toBe(true);
    expect(requests.filter(({ url }) => url.startsWith(networkBase))).toHaveLength(4);
    expect(requests.some(({ url }) => url.startsWith(alternate) || url.startsWith(alternateOwner))).toBe(false);
    expect(latest().graph.nodes).toHaveLength(2);
    const display = latest().graph.nodes.find(({ name }) => name.toLowerCase() === 'display')!;
    expect(display.actionInventory.value).toEqual(['On']);
    expect(display.addresses.map(({ canonicalAddress }) => canonicalAddress).sort()).toEqual([networkBase, alternate].sort());
    expect(display.conflicts).toBeUndefined();
    expect(latest().nodeStatuses.get(display.id)?.readability).toBe('readable');
    expect(latest().graph.bindings).toHaveLength(1);
    expect(latest().graph.bindings[0]?.referenceResolution).toBe('resolved');
  });

  it('falls back as a whole anonymous route, without merging contradictory authenticated evidence', async () => {
    const alternate = 'https://alternate.example/nodes/owner/';
    const untouched = 'https://unused.example/nodes/owner/';
    let mode: 'contradictory' | 'primary-failed' | 'alternate-omitted' | 'matching' = 'contradictory';
    const requests = mockFetch(({ url }) => {
      if (url === '/REST') return json(local());
      if (url === '/REST/nodeURLs') return json(mode === 'alternate-omitted' ? [] : [advertised('Owner', alternate), advertised('Owner', untouched)]);
      if (url === `${localBase()}REST/actions` && mode !== 'primary-failed') return json(actions('Local action'));
      if (url.startsWith(localBase())) return mode === 'matching' || mode === 'alternate-omitted' ? json({}) : failure();
      if (url === `${alternate}REST/actions`) return json(actions(mode === 'matching' ? 'LOCAL ACTION' : 'Remote action'));
      return json({});
    });
    const { controller, latest } = create();
    controller.start();
    await flush();
    expect(requests.slice(2).map(({ init }) => init?.credentials)).toEqual([
      ...Array(4).fill('same-origin'), ...Array(4).fill('omit')
    ]);
    expect(requests.some(({ url }) => url.startsWith(untouched))).toBe(false);
    const owner = latest().graph.nodes[0]!;
    expect(owner.addresses).toHaveLength(3);
    expect(owner.conflicts).toEqual(['actions']);
    expect(owner.actionInventory.value).toBeUndefined();
    expect(latest().graph.endpoints.filter(({ kind }) => kind === 'local-action')).toHaveLength(0);
    expect(latest().nodeStatuses.get(owner.id)?.readability).toBe('partial');
    const conflicts = latest().diagnostics.filter(({ message }) => message.includes('disagreed'));
    expect(conflicts.map(({ routeAddress }) => routeAddress).sort()).toEqual([localBase(), alternate].sort());
    expect(conflicts.every(({ source }) => source === 'actions')).toBe(true);

    mode = 'primary-failed';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(latest()).toMatchObject({ phase: 'idle', coverage: 'partial' });
    expect(latest().graph.nodes[0]).toMatchObject({ conflicts: ['actions'], actionInventory: { status: 'absent' } });
    expect(latest().graph.nodes[0]?.adminHref).toBeUndefined();
    expect(latest().graph.endpoints).toEqual([]);
    expect(latest().diagnostics.filter(({ message }) => message.includes('disagreed'))).toEqual(conflicts);
    expect(requests.filter(({ url }) => url === `${alternate}REST/actions`)).toHaveLength(2);

    mode = 'alternate-omitted';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(latest().graph.nodes[0]).toMatchObject({ conflicts: ['actions'], actionInventory: { status: 'absent' } });
    expect(latest().coverage).toBe('partial');

    mode = 'matching';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requests.filter(({ url }) => url === `${localBase()}REST/actions`)).toHaveLength(4);
    expect(requests.filter(({ url }) => url === `${alternate}REST/actions`)).toHaveLength(3);
    expect(latest().graph.nodes[0]?.actionInventory).toMatchObject({ status: 'success', value: [expect.stringMatching(/^local action$/i)] });
    expect(latest().graph.nodes[0]?.actionInventory.cached).toBeUndefined();
    expect(latest().graph.nodes[0]?.conflicts).toBeUndefined();
    expect(latest().coverage).toBe('complete');
    expect(requests.some(({ url }) => url.startsWith(untouched))).toBe(false);
  });

  it('keeps assignment disputes through a deferred page and rejects a single successful fallback as authority', async () => {
    const alternate = 'https://alt.example/nodes/owner/';
    let mode: 'contradictory' | 'deferred' | 'primary-failed' = 'contradictory';
    const names = Array.from({ length: MAX_PRIMARY_DETAIL_NODES_PER_CYCLE }, (_, index) => `Zed${String(index).padStart(2, '0')}`);
    const calls = mockFetch(({ url }) => {
      if (url === '/REST') return json(mode === 'deferred'
        ? { nodes: { ...local().nodes, ...Object.fromEntries(names.map((name) => [name, { name }])) } } : local());
      if (url === '/REST/nodeURLs') return json([advertised('Owner', alternate)]);
      if (url.startsWith(localBase())) {
        if (url.endsWith('/events') || mode === 'primary-failed') return failure();
        if (url.endsWith('/remote')) return json(assignments('Local target'));
        if (url.endsWith('/remote/schema')) return json(schema);
      }
      if (url.startsWith(alternate) && url.endsWith('/remote')) return json(assignments('Fallback target'));
      if (url.startsWith(alternate) && url.endsWith('/remote/schema')) return json(schema);
      return json({});
    });
    const { controller, latest } = create();
    const owner = () => latest().graph.nodes.find(({ name }) => name === 'Owner')!;
    const expectWithheld = () => {
      expect(owner()).toMatchObject({ conflicts: ['assignments'], assignmentEvidence: { status: 'absent' } });
      expect(owner().adminHref).toBeUndefined();
      expect(latest().graph.bindings.some(({ configuredNode }) => configuredNode !== undefined)).toBe(false);
      expect(latest().graph.completeness.assignments).not.toBe('complete');
      expect(latest().coverage).toBe('partial');
      expect(latest().diagnostics.filter(({ source, message }) => source === 'assignments' && message.includes('disagreed'))
        .map(({ routeAddress }) => routeAddress).sort()).toEqual([localBase(), alternate].sort());
    };
    controller.start();
    await flush();
    expectWithheld();
    const attempts = () => calls.filter(({ url }) => url.startsWith(localBase()) || url.startsWith(alternate)).length;
    const first = attempts();
    mode = 'deferred';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(attempts()).toBe(first);
    expectWithheld();
    mode = 'primary-failed';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(attempts()).toBeGreaterThan(first);
    expectWithheld();
  });

  it('blocks anonymous reads to a shared address claimed by different logical nodes', async () => {
    const aSafeRoute = 'https://other.example/nodes/display/';
    const localInventory = heldResponse();
    const calls = mockFetch(({ url }) => {
      if (url === '/REST') return localInventory.promise;
      if (url === '/REST/nodeURLs') return json([
        advertised('Shadow', localBase()), advertised('Display', networkBase),
        advertised('Other', networkBase), advertised('Display', aSafeRoute)
      ]);
      return json({});
    });
    const { controller, latest } = create();
    controller.start();
    const expectShadowDisplayOnly = () => {
      const shadow = latest().graph.nodes.find(({ name }) => name === 'Shadow')!;
      expect(shadow?.adminHref).toBeUndefined();
      expect(shadow.addresses).toEqual([{ source: 'network', canonicalAddress: localBase(), displayAddress: localBase() }]);
    };
    await flushProgress();
    expectShadowDisplayOnly();
    localInventory.resolve(json(local()));
    await flush();
    expectShadowDisplayOnly();
    expect(calls).toHaveLength(10);
    expect(calls.some(({ url }) => url.startsWith(networkBase))).toBe(false);
    expect(calls.filter(({ url }) => url.startsWith(localBase())).every(({ init }) => init?.credentials === 'same-origin')).toBe(true);
    expect(calls.filter(({ url }) => url.startsWith(aSafeRoute)).every(({ init }) => init?.credentials === 'omit')).toBe(true);
    for (const [name, status] of [['Display', 'readable'], ['Shadow', 'advertised-only'], ['Other', 'advertised-only']]) {
      const node = latest().graph.nodes.find((entry) => entry.name === name)!;
      expect(latest().nodeStatuses.get(node.id)?.readability).toBe(status);
    }
    const owner = latest().graph.nodes.find(({ name }) => name === 'Owner')!;
    expect(owner.adminHref).toBe(localBase());
    expect(owner.addresses[0]?.fetchBase).toBe(localBase());
    const display = latest().graph.nodes.find(({ name }) => name === 'Display')!;
    expect(display.addresses.find(({ canonicalAddress }) => canonicalAddress === networkBase)?.fetchBase).toBeUndefined();
    expect(display.adminHref).toBe(aSafeRoute);
    expect(latest().diagnostics).toContainEqual({ source: 'network', nodeName: 'Shadow', routeAddress: localBase(), message: 'Different advertised node names claim this address.' });
    controller.stop();
    expectShadowDisplayOnly();
  });

  it('carries the newer empty fallback across deferral instead of reviving the old failed primary', async () => {
    const fallback = 'https://alternate.example/nodes/owner/';
    const page = Object.fromEntries(Array.from({ length: MAX_PRIMARY_DETAIL_NODES_PER_CYCLE }, (_, index) => {
      const name = `Zed${String(index).padStart(2, '0')}`;
      return [name, { name }];
    }));
    let cycle = 1;
    const calls = mockFetch(({ url }) => {
      if (url === '/REST') return json({ nodes: { ...local().nodes, ...(cycle === 3 ? page : {}) } });
      if (url === '/REST/nodeURLs') return json([advertised('Owner', fallback)]);
      if (url === `${localBase()}REST/remote`) return cycle === 1 ? json(assignments()) : failure();
      if (url.endsWith('/REST/remote/schema')) return json(schema);
      return json({});
    });
    const { controller, latest } = create();
    const owner = () => latest().graph.nodes.find(({ name }) => name === 'Owner')!;
    const ownerReads = () => calls.filter(({ url }) => url.startsWith(localBase()) || url.startsWith(fallback)).length;
    controller.start();
    await flush();
    expect(owner().assignmentEvidence).toMatchObject({ status: 'success', value: { actions: { Power: { node: 'Display', action: 'On' } } }, lastSuccessAt: +epoch });
    expect(owner().adminHref).toBe(localBase());
    expect(latest().graph.bindings[0]?.assignmentFreshness).toBe('current');

    cycle = 2;
    await vi.advanceTimersByTimeAsync(30_000);
    const clearAt = +epoch + 30_000;
    const currentEmpty = { status: 'success', value: { actions: {}, events: {} }, lastSuccessAt: clearAt };
    expect(owner().assignmentEvidence).toMatchObject(currentEmpty);
    expect(owner().assignmentEvidence.cached).toBeUndefined();
    expect(owner().adminHref).toBe(fallback);
    expect(latest().graph.bindings[0]).not.toHaveProperty('targetEndpointId');

    cycle = 3;
    const reads = ownerReads();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ownerReads()).toBe(reads);
    expect(owner().assignmentEvidence).toMatchObject({ ...currentEmpty, cached: true });
    expect(owner().adminHref).toBe(fallback);
    expect(latest().graph.bindings[0]).not.toHaveProperty('configuredNode');
    expect(latest().nodeStatuses.get(owner().id)).toEqual({ readability: 'readable', stale: false, cached: true });
  });

  it('shows a freshly failed primary as stale when its last success is newer than the fallback cache', async () => {
    const fallback = 'https://alternate.example/nodes/owner/';
    const pendingFallback = heldResponse();
    let cycle = 1;
    mockFetch(({ url }) => {
      if (url === '/REST') return json(local());
      if (url === '/REST/nodeURLs') return json([advertised('Owner', fallback)]);
      if (url === `${localBase()}REST/remote`) return cycle === 2 ? json(assignments('New target')) : failure();
      if (url === `${fallback}REST/remote`) return cycle === 1 ? json({}) : pendingFallback.promise;
      if (url.endsWith('/REST/remote/schema')) return json(schema);
      return json({});
    });
    const { controller, latest } = create();
    const owner = () => latest().graph.nodes.find(({ name }) => name === 'Owner')!;
    controller.start();
    await flush();
    expect(owner().assignmentEvidence).toMatchObject({ status: 'success', value: { actions: {}, events: {} }, lastSuccessAt: +epoch });
    cycle = 2;
    await vi.advanceTimersByTimeAsync(30_000);
    const primarySuccess = +epoch + 30_000;
    expect(owner().assignmentEvidence).toMatchObject({ status: 'success', lastSuccessAt: primarySuccess });
    cycle = 3;
    await vi.advanceTimersByTimeAsync(30_016);
    const expectLatestFailure = () => {
      expect(owner().assignmentEvidence).toMatchObject({ status: 'failure', lastSuccessAt: primarySuccess,
        value: { actions: { Power: { node: 'New target', action: 'On' } } } });
      expect(owner().assignmentEvidence.cached).toBeUndefined();
      expect(latest().graph.bindings[0]).toMatchObject({ configuredNode: 'New target', assignmentFreshness: 'stale' });
      expect(latest().nodeStatuses.get(owner().id)).toEqual({ readability: 'partial', stale: true });
    };
    expect(latest().phase).toBe('loading');
    expectLatestFailure();
    pendingFallback.resolve(failure());
    await flush();
    expect(latest().phase).toBe('idle');
    expectLatestFailure();
  });

  it('rejects oversized retained text without treating a truncated inventory or assignment as authoritative', async () => {
    const big = 'x'.repeat(MAX_DETAIL_NAME_LENGTH + 1);
    const many = Object.fromEntries(Array.from({ length: Math.floor(MAX_DETAIL_TEXT_PER_INTERFACE / MAX_DETAIL_NAME_LENGTH) + 1 },
      (_, index) => [String(index), { name: `${index}`.padEnd(MAX_DETAIL_NAME_LENGTH, 'e') }]));
    const display = localNodeUrl('Display');
    mockFetch(({ url }) => {
      if (url === '/REST') return json({ nodes: { ...local().nodes, ...local('Display').nodes } });
      if (url === '/REST/nodeURLs') return json([]);
      if (url === `${localBase()}REST/remote`) return json(assignments());
      if (url === `${display}REST/actions`) return json({ valid: { name: 'On' }, ...many });
      if (url === `${display}REST/events`) return json(many);
      if (url === `${display}REST/remote/schema`) return json({ properties: { actions: { properties: { [big]: {} } } } });
      if (url === `${display}REST/remote`) return json({ actions: { ...assignments().actions, [big]: { node: 'Owner', action: 'On' } } });
      return json({});
    });
    const { controller, latest } = create();
    controller.start();
    await flush();
    const target = latest().graph.nodes.find(({ name }) => name === 'Display')!;
    for (const evidence of [target.actionInventory, target.eventInventory, target.schemaEvidence, target.assignmentEvidence]) {
      expect(evidence.status).toBe('failure');
      expect(evidence.value).toBeUndefined();
    }
    expect(latest().coverage).toBe('partial');
    expect(latest().graph.bindings).toEqual([expect.objectContaining({ configuredNode: 'Display', referenceResolution: 'unknown' })]);
    expect(latest().diagnostics.filter(({ message }) => message.includes('detail limit'))).toHaveLength(4);
  });

  it.each(['node', 'action', 'event'] as const)('rejects an oversized configured %s field without replacing good assignments', async (field) => {
    let valid = true;
    mockFetch(({ url }) => {
      if (url === '/REST') return json(local());
      if (url === '/REST/nodeURLs') return json([]);
      if (url === `${localBase()}REST/remote`) return json(valid ? assignments('Owner', 'On')
        : { actions: { Power: { [field]: 'x'.repeat(MAX_DETAIL_NAME_LENGTH + 1) } } });
      return json({});
    });
    const { controller, latest } = create();
    controller.start();
    await flush();
    expect(latest().graph.bindings[0]?.assignmentFreshness).toBe('current');
    valid = false;
    controller.refresh();
    await flush();
    expect(latest().graph.nodes[0]?.assignmentEvidence).toMatchObject({ status: 'failure', value: assignments('Owner', 'On') });
    expect(latest().graph.bindings[0]).toMatchObject({ configuredNode: 'Owner', configuredEndpoint: 'On', assignmentFreshness: 'stale' });
    expect(latest().coverage).toBe('partial');
  });

  it('preserves addressless advertisements, blocks unsafe routes and never fetches configured names', async () => {
    const calls = mockFetch(({ url }) => {
      if (url === '/REST') return json(local());
      if (url === '/REST/nodeURLs') return json([
        { node: 'Addressless' }, advertised('Scoped', 'http://[fe80::12%25eth0]:8085/nodes/scoped/'),
        advertised('Rejected', 'https://user:secret@remote.example/nodes/rejected/'),
        advertised('Mixed', 'http://remote.example/nodes/mixed/'),
        advertised('Display', networkBase), { unexpected: 'discarded-text' }
      ]);
      if (url.startsWith(networkBase)) return failure();
      if (url.endsWith('/REST/remote')) return json(assignments('Not advertised'));
      return json({});
    });
    const { controller, latest } = create();
    controller.start();
    await flush();
    expect(window.location.protocol).toBe('https:');
    expect(latest()).toMatchObject({ phase: 'idle', coverage: 'partial' });
    expect(latest().graph.bindings[0]).toMatchObject({ configuredNode: 'Not advertised', referenceResolution: 'unknown' });
    for (const name of ['Addressless', 'Scoped', 'Rejected', 'Mixed', 'Display']) {
      const node = latest().graph.nodes.find((entry) => entry.name === name)!;
      expect(node.discovery).toBe('advertised');
      expect(latest().nodeStatuses.get(node.id)?.readability).toBe(name === 'Display' ? 'unreadable' : 'advertised-only');
    }
    expect(calls.filter(({ url }) => url === '/REST/nodeURLs')[0]?.init).toMatchObject({ method: 'POST', body: '{"filter":""}', redirect: 'error' });
    expect(calls.filter(({ url }) => url.startsWith(networkBase))).toHaveLength(4);
    expect(calls).toHaveLength(10);
    for (const { url, init } of calls.filter(({ url }) => url.startsWith(networkBase))) {
      expect(url).toMatch(/\/REST\/(actions|events|remote(?:\/schema)?)$/);
      expect(init).toMatchObject({ credentials: 'omit', method: 'GET', mode: 'cors', redirect: 'error' });
      expect(new Headers(init?.headers).get('Authorization')).toBeNull();
    }
    expect(JSON.stringify(latest().diagnostics)).not.toMatch(/secret|discarded-text|untrusted error/);
  });

  it('reports a healthy origin while another origin has multiple stalled routes', async () => {
    const stalled = heldResponse();
    const requests = mockFetch(({ url }) => {
      if (url === '/REST') return json(empty);
      if (url === '/REST/nodeURLs') return json([
        advertised('AA', 'https://offline.example/nodes/aa/'),
        advertised('BB', 'https://offline.example/nodes/bb/'),
        advertised('Display', networkBase)
      ]);
      if (url.startsWith('https://offline.example/')) return stalled.promise;
      return json(url.endsWith('/REST/actions') ? actions('Available now') : {});
    });
    const { controller, latest } = create();
    controller.start();
    await flushProgress();
    expect(requests.filter(({ url }) => url.startsWith(networkBase))).toHaveLength(4);
    expect(latest().phase).toBe('loading');
    expect(latest().graph.endpoints.map(({ name }) => name)).toContain('Available now');
    expect(requests.filter(({ url }) => url.startsWith('https://offline.example/'))).toHaveLength(4);
    stalled.resolve(json({}));
  });

  it('preserves prior authenticated evidence as stale while reading the exact route anonymously', async () => {
    let mode: 'local' | 'anonymous-failure' | 'anonymous-partial' = 'local';
    const declinedInventory = heldResponse();
    const requests = mockFetch(({ url }) => {
      if (url === '/REST') return mode === 'local' ? json(local()) : mode === 'anonymous-failure' ? declinedInventory.promise : failure();
      if (url === '/REST/nodeURLs') return json([advertised('Owner', localBase())]);
      if (mode === 'anonymous-failure') return failure();
      if (mode === 'anonymous-partial') return url.endsWith('/REST/actions') ? json({}) : failure();
      if (url.endsWith('REST/actions')) return json(actions('Private'));
      if (url.endsWith('REST/remote/schema')) return json(schema);
      if (url.endsWith('REST/remote')) return json(assignments());
      return json({});
    });
    const { controller, latest } = create();
    controller.start();
    await flush();
    const id = latest().graph.nodes.find(({ name }) => name === 'Owner')!.id;
    const credentials = () => requests.filter(({ url }) => url.startsWith(localBase())).map(({ init }) => init?.credentials);
    const advertisedOwner = () => latest().graph.nodes.find((node) => node.id === id);
    expect(advertisedOwner()?.actionInventory.value).toEqual(['Private']);
    mode = 'anonymous-failure';
    await vi.advanceTimersByTimeAsync(30_020);
    expect(credentials()).toEqual(Array(4).fill('same-origin'));
    expect(advertisedOwner()?.actionInventory).toMatchObject({ status: 'absent', value: ['Private'] });
    declinedInventory.resolve(failure());
    await flush();
    expect(credentials()).toEqual([
      ...Array(4).fill('same-origin'), ...Array(4).fill('omit')
    ]);
    expect(advertisedOwner()).toMatchObject({ id, actionInventory: { status: 'failure', value: ['Private'], lastSuccessAt: epoch.getTime() } });
    expect(latest().graph.bindings[0]).toMatchObject({ alias: 'Power', declared: 'unknown', configuredNode: 'Display', assignment: 'complete', assignmentFreshness: 'stale' });
    expect(latest().graph.endpoints.find(({ name }) => name === 'Private')?.evidence).toBe('unknown');
    expect(latest().nodeStatuses.get(id)).toEqual({ stale: true, readability: 'unreadable' });

    mode = 'anonymous-partial';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(credentials().slice(8)).toEqual(Array(4).fill('omit'));
    expect(advertisedOwner()?.actionInventory).toMatchObject({ status: 'success', value: [] });
    expect(latest().graph.bindings).toEqual([]);
    expect(advertisedOwner()?.schemaEvidence.value).toBeUndefined();
    expect(advertisedOwner()?.assignmentEvidence.value).toBeUndefined();
    expect(latest().nodeStatuses.get(id)?.stale).toBe(false);

    mode = 'local';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(credentials().slice(12)).toEqual(Array(4).fill('same-origin'));
    expect(advertisedOwner()?.actionInventory.value).toEqual(['Private']);
  });

  it('drops authenticated evidence when local inventory successfully reports the same advertised route is no longer local', async () => {
    let previouslyLocal = true;
    const requests = mockFetch(({ url, init }) => {
      if (url === '/REST') return json(previouslyLocal ? local() : empty);
      if (url === '/REST/nodeURLs') return json([advertised('Owner', localBase())]);
      if (init?.credentials === 'omit') return failure();
      return json(url.endsWith('REST/actions') ? actions('Private') : {});
    });
    const { controller, latest } = create();
    controller.start();
    await flush();
    expect(latest().graph.nodes[0]?.actionInventory.value).toEqual(['Private']);
    previouslyLocal = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requests.filter(({ url, init }) => url.startsWith(localBase()) && init?.credentials === 'omit')).toHaveLength(4);
    expect(latest().graph.nodes[0]?.actionInventory).toMatchObject({ status: 'failure' });
    expect(latest().graph.nodes[0]?.actionInventory.value).toBeUndefined();
  });

  it('does not carry authenticated target evidence into a stale owner reference after local authority is revoked', async () => {
    const display = localNodeUrl('Display');
    let includeDisplay = true;
    mockFetch(({ url, init }) => {
      if (url === '/REST') return json({ nodes: { ...local().nodes, ...(includeDisplay ? local('Display').nodes : {}) } });
      if (url === '/REST/nodeURLs') return json([advertised('Display', display)]);
      if (init?.credentials === 'omit') return failure();
      if (url === `${display}REST/actions`) return json(actions('Power On'));
      if (url === `${localBase()}REST/remote`) return includeDisplay ? json(assignments('Display', 'POWER ON')) : failure();
      return json({});
    });
    const { controller, latest } = create();
    controller.start();
    await flush();
    expect(latest().graph.bindings[0]).toMatchObject({ referenceResolution: 'resolved' });
    includeDisplay = false;
    controller.refresh();
    await flush();
    expect(latest().graph.nodes.find(({ name, discovery }) => name === 'Display' && discovery === 'advertised')?.actionInventory.value).toBeUndefined();
    expect(latest().graph.endpoints.some(({ name }) => name === 'Power On')).toBe(false);
    expect(latest().graph.bindings[0]).toMatchObject({ assignment: 'complete', assignmentRow: 'present', referenceResolution: 'unknown', assignmentFreshness: 'stale' });
  });

  it('bounds the advertised inventory and diagnostics separately from detail requests', async () => {
    const calls = mockFetch(({ url }) => {
      if (url === '/REST') return json(empty);
      if (url === '/REST/nodeURLs') return json(Array.from({ length: MAX_INVENTORY_ROUTES_PER_SOURCE + 3 }, (_, index) => ({ node: `Node ${index}` })));
      throw new Error('Should not fetch an addressless node');
    });
    const { controller, latest } = create();
    controller.start();
    await flush();
    expect(calls).toHaveLength(2);
    expect(latest().graph.nodes).toHaveLength(MAX_INVENTORY_ROUTES_PER_SOURCE);
    expect(latest().coverage).toBe('partial');
    expect(latest().graph.discoveryEvidence.status).not.toBe('success');
    expect(latest().diagnostics).toHaveLength(24);
    expect(latest().diagnostics.some(({ message }) => message.includes('3 additional advertisement(s) were omitted'))).toBe(true);
    expect(latest().diagnosticsOmitted).toBe(MAX_INVENTORY_ROUTES_PER_SOURCE - 22);
  });

  it('inventories a large network in full, rotates detail pages, and distinguishes deferred from failed reads', async () => {
    const entries = Array.from({ length: 180 }, (_, index) => {
      const suffix = String(index).padStart(3, '0');
      return advertised(`Remote ${suffix}`, `https://fleet.example/nodes/remote${suffix}/`);
    });
    let reversed = false;
    const calls = mockFetch(({ url }) => {
      if (url === '/REST') return json(empty);
      if (url === '/REST/nodeURLs') return json(reversed ? entries.slice().reverse() : entries);
      if (url.includes('/nodes/remote000/')) return failure();
      if (url.endsWith('/nodes/remote001/REST/remote')) return json(assignments('Remote 001'));
      return json({});
    });
    const { controller, latest } = create();
    const readStatus = (name: string) => latest().nodeStatuses.get(latest().graph.nodes.find((node) => node.name === name)!.id)?.readability;
    controller.start();
    await flush();
    expect(latest().graph.nodes).toHaveLength(entries.length);
    expect(latest().graph.discoveryEvidence.status).toBe('success');
    expect(latest().coverage).toBe('partial');
    expect(calls).toHaveLength(2 + 4 * MAX_PRIMARY_DETAIL_NODES_PER_CYCLE);
    expect(readStatus('Remote 000')).toBe('unreadable');
    expect(readStatus('Remote 179')).toBe('advertised-only');
    const binding = latest().graph.bindings[0]!;

    reversed = true;
    const pages = Math.ceil(entries.length / MAX_PRIMARY_DETAIL_NODES_PER_CYCLE);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(latest().graph.bindings[0]).toEqual({ ...binding, assignmentFreshness: 'cached' });
    const cached = latest().graph.nodes.find(({ name }) => name === 'Remote 001')!;
    expect(cached.assignmentEvidence).toMatchObject({ status: 'success', cached: true });
    expect(latest().nodeStatuses.get(cached.id)).toEqual({ readability: 'readable', stale: false, cached: true });
    for (let index = 2; index < pages; index += 1) await vi.advanceTimersByTimeAsync(30_000);
    const readRoutes = new Set(calls.flatMap(({ url }) => url.startsWith('https://fleet.example/') ? [url.split('REST/')[0]] : []));
    expect(readRoutes.size).toBe(entries.length);
    expect(readStatus('Remote 179')).toBe('readable');
    expect(latest().graph.nodes).toHaveLength(entries.length);
  });

  it('reserves a bounded fallback page and rotates eligible fallback nodes when every primary fails', async () => {
    const count = 2 * MAX_PRIMARY_DETAIL_NODES_PER_CYCLE;
    const entries = Array.from({ length: count }, (_, index) => [
      advertised(`Node ${index}`, `https://first.example/nodes/${index}/`),
      advertised(`Node ${index}`, `https://second.example/nodes/${index}/`)
    ]).flat();
    const calls = mockFetch(({ url }) => {
      if (url === '/REST') return json(empty);
      if (url === '/REST/nodeURLs') return json(entries);
      return url.startsWith('https://first.example/') ? failure() : json({});
    });
    const { controller, latest } = create();
    controller.start();
    await flush();
    expect(latest().graph.nodes).toHaveLength(count);
    expect(calls).toHaveLength(2 + 4 * (MAX_PRIMARY_DETAIL_NODES_PER_CYCLE + MAX_FALLBACK_DETAIL_NODES_PER_CYCLE));
    for (let index = 1; index < count / MAX_FALLBACK_DETAIL_NODES_PER_CYCLE; index += 1) {
      await vi.advanceTimersByTimeAsync(30_000);
    }
    const fallback = calls.filter(({ url }) => url.startsWith('https://second.example/') && url.endsWith('/REST/remote')).map(({ url }) => url);
    expect(fallback).toHaveLength(count);
    expect(new Set(fallback).size).toBe(fallback.length);
  });

  it('advances both local and anonymous pages without allowing either source to starve the other', async () => {
    const names = (prefix: string) => Array.from({ length: MAX_PRIMARY_DETAIL_NODES_PER_CYCLE + 1 }, (_, index) => `${prefix}${String(index).padStart(2, '0')}`);
    const locals = names('Local');
    const network = names('Remote');
    const calls = mockFetch(({ url }) => {
      if (url === '/REST') return json({ nodes: Object.fromEntries(locals.map((name) => [name, { name }])) });
      if (url === '/REST/nodeURLs') return json(network.map((name) => advertised(name, `https://fleet.example/nodes/${name}/`)));
      return json({});
    });
    const { controller, latest } = create();
    controller.start();
    await flush();
    const current = () => latest().graph.nodes.filter(({ id }) => latest().nodeStatuses.get(id)?.readability === 'readable');
    expect(latest().graph.nodes).toHaveLength(locals.length + network.length);
    expect(current().filter(({ name }) => name.startsWith('Local'))).toHaveLength(MAX_PRIMARY_DETAIL_NODES_PER_CYCLE / 2);
    expect(current().filter(({ name }) => name.startsWith('Remote'))).toHaveLength(MAX_PRIMARY_DETAIL_NODES_PER_CYCLE / 2);
    for (let index = 0; index < 2; index += 1) await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.some(({ url }) => url === `${localNodeUrl(locals.at(-1)!)}REST/remote`)).toBe(true);
    expect(calls.some(({ url }) => url === `https://fleet.example/nodes/${network.at(-1)}/REST/remote`)).toBe(true);
  });
});

describe('TopologyController lifecycle and cache', () => {
  it('marks a failed owner assignment stale, validates against current target evidence, then recovers and clears', async () => {
    let mode: 'initial' | 'held' | 'recover' | 'clear' = 'initial';
    const inventory = heldResponse();
    const bindingRead = heldResponse();
    mockFetch(({ url }) => {
      if (url === '/REST') return json(local());
      if (url === '/REST/nodeURLs') return mode === 'held' ? inventory.promise : json([advertised('Display', networkBase)]);
      if (url === `${localBase()}REST/remote/schema`) return json(schema);
      if (url === `${localBase()}REST/remote`) {
        if (mode === 'held') return bindingRead.promise;
        if (mode === 'clear') return json({});
        return json({ actions: { ...assignments('Display', 'POWER ON').actions, Incomplete: { node: 'Display' } } });
      }
      return json(url === `${networkBase}REST/actions` ? actions('Power On') : {});
    });
    const { controller, latest } = create();
    const power = () => latest().graph.bindings.find(({ alias }) => alias === 'Power');
    controller.start();
    await flush();
    const original = power()!;
    expect(original.referenceResolution).toBe('resolved');
    expect(original.assignmentFreshness).toBe('current');

    mode = 'held';
    await vi.advanceTimersByTimeAsync(30_016);
    expect(latest().phase).toBe('loading');
    expect(power()?.assignmentFreshness).toBe('cached');
    expect(power()?.referenceResolution).not.toBe('resolved');
    inventory.resolve(json([advertised('Display', networkBase)]));
    await flushProgress();
    expect(power()?.referenceResolution).toBe('resolved');
    expect(power()?.assignmentFreshness).toBe('cached');
    bindingRead.resolve(failure());
    await flush();
    expect(latest().phase).toBe('idle');
    expect(power()).toMatchObject({ id: original.id, assignment: 'complete', assignmentRow: 'present', referenceResolution: 'resolved', assignmentFreshness: 'stale' });

    mode = 'recover';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(power()).toEqual(original);
    mode = 'clear';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(power()?.targetEndpointId).toBeUndefined();
    expect(latest().graph.bindings).toEqual([expect.objectContaining({ alias: 'Power', assignmentRow: 'absent' })]);
  });

  it('refreshes assignments on each cycle, bypasses the definition TTL manually, then expires it', async () => {
    const calls = mockFetch(({ url }) => url === '/REST' ? json(local()) : url === '/REST/nodeURLs' ? json([]) : json({}));
    const { controller, latest } = create();
    const count = (suffix: string) => calls.filter(({ url }) => url.startsWith(localBase()) && url.endsWith(suffix)).length;
    controller.start();
    await flush();
    expect(count('REST/actions')).toBe(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(count('REST/remote')).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(count('REST/remote')).toBe(2);
    expect(count('REST/actions')).toBe(1);
    expect(count('REST/events')).toBe(1);
    expect(count('REST/remote/schema')).toBe(1);
    controller.refresh();
    await flush();
    expect(count('REST/remote')).toBe(3);
    expect(count('REST/actions')).toBe(2);
    expect(count('REST/events')).toBe(2);
    expect(count('REST/remote/schema')).toBe(2);
    await vi.advanceTimersByTimeAsync(120_001);
    expect(count('REST/actions')).toBe(3);
    expect(count('REST/remote')).toBe(7);
    expect(latest().coverage).toBe('complete');
  });

  it('does not reuse data for the same name on a new base or after a confirmed disappearance', async () => {
    let advertisedBase: string | undefined = networkBase;
    const changes = 'https://new.example/nodes/display/';
    let readable = true;
    const calls = mockFetch(({ url }) => {
      if (url === '/REST') return json(empty);
      if (url === '/REST/nodeURLs') return json(advertisedBase ? [advertised('Display', advertisedBase)] : []);
      return json(url.endsWith('REST/actions') && readable ? actions() : {});
    });
    const { controller, latest } = create();
    controller.start();
    await flush();
    const originalId = latest().graph.nodes[0]!.id;
    advertisedBase = changes;
    readable = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(latest().graph.nodes[0]?.id).toBe(originalId);
    expect(latest().graph.nodes[0]?.actionInventory).toMatchObject({ status: 'success', value: [] });
    expect(calls.filter(({ url }) => url.startsWith(changes))).toHaveLength(4);
    advertisedBase = undefined;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(latest().graph.nodes).toEqual([]);
    advertisedBase = networkBase;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(latest().graph.nodes[0]?.actionInventory.value).toEqual([]);
    expect(calls.filter(({ url }) => url.startsWith(networkBase))).toHaveLength(8);
  });

  it('retains failed reads as stale with prior timestamps, distinguishes failed inventory, and clears on successful empty', async () => {
    let mode: 'first' | 'partial' | 'failed' | 'empty' = 'first';
    const calls = mockFetch(({ url }) => {
      if (mode === 'failed') return failure();
      if (url === '/REST') return json(local());
      if (url === '/REST/nodeURLs') return mode === 'partial' ? failure()
        : json(mode === 'empty' ? [] : [advertised('Display', networkBase)]);
      if (url.startsWith(networkBase)) return json(url.endsWith('/REST/actions') ? actions() : {});
      if (mode === 'partial' && (url.endsWith('/REST/remote') || url.endsWith('/REST/remote/schema'))) return failure();
      if (mode === 'empty') return json({});
      if (url.endsWith('/REST/remote')) return json(assignments());
      if (url.endsWith('/REST/remote/schema')) return json(schema);
      return json({});
    });
    const { controller, latest } = create();
    controller.start();
    await flush();
    expect(latest().graph.bindings[0]?.referenceResolution).toBe('resolved');
    const bindingId = latest().graph.bindings[0]!.id;
    const oldRemote = latest().graph.nodes.find(({ name }) => name === 'Display')!;
    const remoteCalls = () => calls.filter(({ url }) => url.startsWith(networkBase)).length;
    expect(remoteCalls()).toBe(4);

    mode = 'partial';
    await vi.advanceTimersByTimeAsync(100);
    controller.refresh();
    await flush();
    expect(remoteCalls()).toBe(4);
    expect(latest()).toMatchObject({ coverage: 'partial', stale: true, lastSuccessAt: epoch.getTime() });
    expect(latest().graph.bindings[0]).toMatchObject({ id: bindingId, configuredNode: 'Display', referenceResolution: 'unknown' });
    expect(latest().graph.nodes.find(({ id }) => id === oldRemote.id)?.actionInventory).toMatchObject({
      status: 'absent', value: ['On'], lastSuccessAt: epoch.getTime()
    });
    expect(latest().nodeStatuses.get(oldRemote.id)).toEqual({ readability: 'advertised-only', stale: true });

    mode = 'failed';
    controller.refresh();
    await flush();
    expect(latest()).toMatchObject({ coverage: 'failed', stale: true, lastSuccessAt: epoch.getTime() });
    expect(latest().graph.nodes.some(({ id }) => id === oldRemote.id)).toBe(true);

    mode = 'empty';
    controller.refresh();
    await flush();
    expect(latest()).toMatchObject({ coverage: 'complete', stale: false, lastSuccessAt: epoch.getTime() + 100 });
    expect(latest().graph.bindings).toHaveLength(0);
    expect(latest().graph.nodes.map(({ name }) => name)).toEqual(['Owner']);
  });

  it('applies short deadlines to body reads, then schedules the next cycle from completion', async () => {
    const body = heldBody();
    const response = json({});
    vi.spyOn(response, 'json').mockReturnValue(body.promise);
    const calls = mockFetch(({ url }) => {
      if (url === '/REST') return json(local());
      if (url === '/REST/nodeURLs') return json([]);
      if (url.endsWith('/REST/actions')) return response;
      return json({});
    });
    const { controller, latest } = create();
    controller.start();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(latest().phase).toBe('loading');
    const request = calls.find(({ url }) => url.endsWith('/REST/actions'))!;
    expect(request.init?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(request.init?.signal?.aborted).toBe(true);
    expect(latest().diagnostics).toContainEqual({ source: 'actions', nodeName: 'Owner', message: 'Request timed out.' });
    expect(latest()).toMatchObject({ phase: 'idle', coverage: 'partial' });
    body.resolve(actions('Too late'));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(latest().graph.endpoints).toHaveLength(0);
    expect(calls).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.filter(({ url }) => url === '/REST')).toHaveLength(2);
  });

  it('never commits early successes or late body completions from a superseded generation', async () => {
    const delayed = heldBody();
    const pendingResponse = json({});
    vi.spyOn(pendingResponse, 'json').mockReturnValue(delayed.promise);
    let generation = 0;
    mockFetch(({ url }) => {
      if (url === '/REST') { generation += 1; return json(local()); }
      if (url === '/REST/nodeURLs') return json([]);
      if (url.endsWith('/REST/actions')) return generation === 1 ? json(actions('Uncommitted')) : failure();
      if (url.endsWith('/REST/remote') && generation === 1) return pendingResponse;
      return json({});
    });
    const { controller, latest, updates } = create();
    controller.start();
    await flushProgress();
    expect(latest().graph.endpoints.map(({ name }) => name)).toContain('Uncommitted');
    expect(latest().phase).toBe('loading');
    controller.refresh();
    await flush();
    expect(latest()).toMatchObject({ phase: 'idle', coverage: 'partial', stale: false });
    expect(latest().graph.nodes[0]?.actionInventory.value).toBeUndefined();
    const count = updates.length;
    delayed.resolve(assignments('Late target'));
    await flush();
    expect(updates).toHaveLength(count);
    expect(latest().graph.bindings).toHaveLength(0);
  });

  it('retains physical request slots across abort-insensitive generations and releases them on settlement', async () => {
    const held: Array<ReturnType<typeof heldResponse>> = [];
    let generation = 0;
    const calls = mockFetch(({ url }) => {
      if (url === '/REST') { generation += 1; return json(local()); }
      if (url === '/REST/nodeURLs') return json([]);
      if (generation === 1) {
        const request = heldResponse();
        held.push(request);
        return request.promise;
      }
      return json({});
    });
    const { controller, latest } = create();
    controller.start();
    await flush();
    expect(held).toHaveLength(4);
    controller.refresh();
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toHaveLength(6);
    expect(calls.slice(2).every(({ init }) => init?.signal?.aborted)).toBe(true);
    expect(latest().phase).toBe('loading');

    held[0]!.resolve(json(actions('Stale transport')));
    await flush();
    expect(calls).toHaveLength(12);
    expect(latest()).toMatchObject({ phase: 'idle', coverage: 'complete' });
    expect(latest().graph.endpoints).toHaveLength(0);
    for (const request of held.slice(1)) request.resolve(json({}));
  });

  it('shares physical slots across overlapping viewers and their replacements without publishing disposed work', async () => {
    let active = 0;
    let peak = 0;
    const held: Array<ReturnType<typeof heldResponse>> = [];
    let hold = true;
    const calls = mockFetch(({ url }) => {
      if (!hold) return url === '/REST' ? json(empty) : json([]);
      const request = heldResponse();
      held.push(request);
      peak = Math.max(peak, ++active);
      return request.promise.finally(() => { active -= 1; });
    });
    const first = create();
    const second = create();
    first.controller.start();
    second.controller.start();
    expect(calls.map(({ url }) => url)).toEqual(['/REST', '/REST/nodeURLs', '/REST', '/REST/nodeURLs']);
    expect(peak).toBe(4);

    first.controller.dispose();
    second.controller.dispose();
    const replacement = create();
    replacement.controller.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(4);
    expect(calls.every(({ init }) => init?.signal?.aborted)).toBe(true);
    hold = false;
    held[0]!.resolve(json(local('Disposed')));
    await flush();
    expect(active).toBe(3);
    expect(calls).toHaveLength(6);
    expect(replacement.latest()).toMatchObject({ phase: 'idle', coverage: 'complete' });
    expect(replacement.latest().graph.nodes).toEqual([]);
    expect(first.updates).toHaveLength(1);
    expect(second.updates).toHaveLength(1);
    for (const request of held.slice(1)) request.resolve(json([]));
  });

  it('reports both timed out and undispatched jobs when four underlying bodies never settle', async () => {
    const stalled = heldBody();
    const calls = mockFetch(({ url }) => {
      if (url === '/REST') return json(local());
      if (url === '/REST/nodeURLs') return json([advertised('Display', networkBase)]);
      const response = json({});
      vi.spyOn(response, 'json').mockReturnValue(stalled.promise);
      return response;
    });
    const { controller, latest } = create();
    controller.start();
    await vi.advanceTimersByTimeAsync(3_001);
    expect(calls).toHaveLength(6);
    expect(latest().phase).toBe('loading');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(calls).toHaveLength(6);
    expect(latest()).toMatchObject({ phase: 'idle', coverage: 'partial', progress: { completed: 10, total: 10 } });
    expect(latest().diagnostics.filter(({ message }) => message === 'Request timed out.')).toHaveLength(4);
    expect(latest().diagnostics.filter(({ message }) => message.startsWith('Read skipped'))).toHaveLength(4);
    stalled.resolve({});
  });

  it('suspends hidden, offline and stopped work, resumes when visible, and disposes permanently', async () => {
    const old = heldResponse();
    let first = true;
    const calls = mockFetch(({ url }) => {
      if (url === '/REST' && first) { first = false; return old.promise; }
      return url === '/REST' ? json(empty) : json([]);
    });
    const { controller, latest, updates } = create();
    mutableVisibility(true);
    controller.start();
    expect(latest().phase).toBe('paused');
    expect(calls).toHaveLength(0);
    mutableVisibility(false);
    await flush();
    const { init } = calls[0]!;
    expect(latest().phase).toBe('loading');
    mutableConnectivity(false);
    expect(init?.signal?.aborted).toBe(true);
    controller.refresh();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
    mutableConnectivity(true);
    await flush();
    expect(latest()).toMatchObject({ phase: 'idle', coverage: 'complete', stale: false });
    expect(latest().graph.nodes).toEqual([]);
    old.resolve(json(local('Late local')));
    controller.stop();
    expect(latest().phase).toBe('paused');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(4);
    const count = updates.length;
    controller.dispose();
    controller.start();
    controller.refresh();
    mutableVisibility(true);
    mutableVisibility(false);
    expect(updates).toHaveLength(count);
  });
});
