/** Isolated REST fixtures for port-window timing; every read is loopback-mocked. */
export const LOCAL_SESSION_KEY = 'nodel.topology-canvas.layout.v1:/topology-canvas.html';
export const ORDINARY_TARGET_PORT = 'DenseA-Action-208';
export const FANOUT_TARGET_PORT = 'Local-208';

const ownerPath = (name) => name.replace(/[^a-zA-Z0-9]/g, '');
const cardId = (name) => {
  const key = `simple:${ownerPath(name).toLowerCase()}`;
  const nodeId = JSON.stringify(['node', key]);
  return `n-${Array.from(nodeId, character => character.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`;
};

function pinnedFixtureCardPositions(owners) {
  return owners.map((name, index) => {
    let x;
    let y;
    if (owners.length < 450) { x = index * 300; y = 0; }
    else if (index < 5) { x = index * 300; y = 0; }
    else {
      const ordinary = index - 5;
      x = (ordinary % 24) * 260;
      y = 700 + Math.floor(ordinary / 24) * 160;
    }
    return [cardId(name), x, y, true];
  });
}

function aliases(count, { prefix, target, kind = 'action', shared = false }) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(3, '0');
    return [`${prefix}-${kind === 'action' ? 'Action' : 'Event'}-${number}`, {
      node: target,
      [kind]: shared ? `${prefix}-SharedEndpoint` : `${prefix}-Endpoint-${number}`
    }];
  }));
}

function ownerRouteFixture({ owners, routes, ordinaryCount, description }) {
  return {
    owners,
    routes: new Map(Object.entries(routes).map(([name, value]) => [ownerPath(name), value])),
    inventory: { nodes: Object.fromEntries(owners.map((name) => [name, {}])) },
    cardPositions: pinnedFixtureCardPositions(owners),
    ordinaryCount,
    description,
    holdUnconnectedOwners: false
  };
}

/** 244 unique rows plus a few opposite-side ports; only two local owners. */
export function createOrdinaryFixture() {
  const owners = ['Dense-A', 'Peer-A'];
  for (let index = 1; index <= 7; index += 1) owners.push(`Side-${String(index).padStart(2, '0')}`);
  const routes = {
    'Dense-A': {
      actions: aliases(244, { prefix: 'DenseA', target: 'Peer-A' }),
      events: Object.fromEntries(Array.from({ length: 4 }, (_, index) => {
        const number = String(index + 1).padStart(2, '0');
        return [`DenseA-Event-${number}`, { node: 'Peer-A', event: `DenseA-EventTarget-${number}` }];
      }))
    },
    'Peer-A': {
      actions: { 'Peer-to-DenseA': { node: 'Dense-A', action: 'DenseA-Inbound' } },
      events: { 'Peer-event-to-side': { node: 'Side-01', event: 'Side-LocalEvent' } }
    }
  };
  for (const name of owners.slice(2)) routes[name] = { actions: {} };
  return ownerRouteFixture({
    owners,
    routes,
    ordinaryCount: 7,
    description: '9 inspected local cards, 244 unique action ports + 4 event ports, opposite-side local endpoints, and two uniquely identified return edges'
  });
}

/** One hundred aliases create parallel wires into one shared peer endpoint. */
export function createFanoutFixture() {
  const owners = ['Peer-B', 'Dense-B'];
  // Scroll the local endpoint itself (left half of Dense-B), not any of its aliases.
  const actions = {};
  for (let i = 1; i <= 244; i++) for (let j = 1; j <= (i === 208 ? 100 : 1); j++) {
    const n = String(i).padStart(3, '0');
    actions[`Alias-${n}-${String(j).padStart(3, '0')}`] = { node: 'Dense-B', action: `Local-${n}` };
  }
  return ownerRouteFixture({
    owners,
    routes: {
      'Dense-B': { actions: {} }, 'Peer-B': { actions }
    },
    ordinaryCount: 0,
    description: '2 inspected local cards; 244 left local action endpoints on Dense-B; Local-208 has 100 incident bindings from Peer-B; 343 total wires'
  });
}

/**
 * A 450-card local canvas includes both dense cards. Only five owner reads are
 * allowed to complete (the two dense owners, hubs and one return-peer owner);
 * all other owners are held before fetch so every mode measures the same quiet,
 * explicitly partial snapshot instead of waiting 113 seconds for 450 reads.
 */
export function createMounted450Fixture() {
  const owners = ['Dense-A', 'Dense-B', 'Hub-A', 'Hub-B'];
  for (let index = 1; index <= 446; index += 1) owners.push(`Peer-${String(index).padStart(3, '0')}`);
  return {
    ...ownerRouteFixture({
      owners,
      routes: {
        'Dense-A': {
          actions: aliases(244, { prefix: 'DenseA', target: 'Hub-A' }),
          events: Object.fromEntries(Array.from({ length: 4 }, (_, index) => {
            const number = String(index + 1).padStart(2, '0');
            return [`DenseA-Event-${number}`, { node: 'Hub-A', event: `DenseA-EventTarget-${number}` }];
          }))
        },
        'Dense-B': { actions: aliases(100, { prefix: 'FanoutB', target: 'Hub-B', shared: true }) },
        'Hub-A': { actions: {}, events: {} },
        'Hub-B': { actions: {}, events: {} },
        'Peer-001': {
          actions: { 'Peer-to-DenseA': { node: 'Dense-A', action: 'DenseA-Inbound' } },
          events: { 'Peer-event-to-DenseA': { node: 'Dense-A', event: 'DenseA-LocalEvent' } }
        }
      },
      ordinaryCount: 446,
      description: '450 mounted local cards; Dense-A (244 rows) + Dense-B (100 aliases/one endpoint), 350 wires; ordinary peers are held before remote inspection'
    }),
    holdUnconnectedOwners: true,
    stableInspectionOwners: ['Dense-A', 'Dense-B', 'Hub-A', 'Hub-B', 'Peer-001'],
    expectedCards: 450,
    expectedWires: 350
  };
}

export const TARGET_BY_SCENARIO = Object.freeze({
  ordinary: ORDINARY_TARGET_PORT,
  fanout: FANOUT_TARGET_PORT
});

/** Install deterministic same-origin reads and optional held peer requests. */
export async function installPortWindowFixture(page, fixture, baseUrl) {
  const expectedOrigin = new URL(baseUrl).origin;
  const requests = { rest: [], remoteOwners: [], blocked: [], heldOwners: [] };
  await page.addInitScript(({ holdUnconnectedOwners }) => {
    window.__portWindowHoldOwners = holdUnconnectedOwners;
    window.__portWindowHeldOwners = [];
    window.__portWindowSuppressedOwnerDeadlineTimers = 0;
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => {
      // local-snapshot.ts has a 3000ms owner budget. Suppress only those
      // deadline timers while rows are deliberately held; this keeps partial
      // 450-card state unchanged during the bounded quiet/sample window.
      if (window.__portWindowHoldOwners && Number.isFinite(delay) && delay >= 2800 && delay <= 3200) {
        window.__portWindowSuppressedOwnerDeadlineTimers += 1;
        return nativeSetTimeout(() => {}, 86_400_000);
      }
      return nativeSetTimeout(callback, delay, ...args);
    };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      let url;
      try { url = new URL(href, window.location.href); } catch { return nativeFetch(input, init); }
      const owner = /^\/nodes\/([^/]+)\/REST\/remote$/.exec(url.pathname)?.[1];
      if (window.__portWindowHoldOwners && owner?.startsWith('Peer') && owner !== 'Peer001') {
        window.__portWindowHeldOwners.push(owner);
        return new Promise(() => {});
      }
      return nativeFetch(input, init);
    };
  }, { holdUnconnectedOwners: fixture.holdUnconnectedOwners });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== expectedOrigin) {
      requests.blocked.push(url.href);
      await route.abort('blockedbyclient');
      return;
    }
    if (url.pathname === '/REST') {
      requests.rest.push(url.pathname);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.inventory) });
      return;
    }
    if (url.pathname === '/REST/nodeURLs' || url.pathname === '/REST/nodeURLsForNode') {
      requests.rest.push(url.pathname);
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    const match = /^\/nodes\/([^/]+)\/REST\/remote$/.exec(url.pathname);
    if (match) {
      const owner = decodeURIComponent(match[1]);
      requests.rest.push(url.pathname);
      requests.remoteOwners.push(owner);
      // Arrow A/B needs the same first-evidence footprint, not just the same pins.
      // Separate initial owners' settlements before any browser timing.
      if (fixture.orderedReads) await new Promise(r => setTimeout(r, 140 * (1 + fixture.owners.findIndex(name => ownerPath(name) === owner))));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.routes.get(owner) ?? fixture.routes.get(ownerPath(owner)) ?? {}) });
      return;
    }
    if (/\/REST(?:\/|$)/i.test(url.pathname)) {
      requests.rest.push(url.pathname);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  return {
    requests,
    heldOwners: () => page.evaluate(() => [...(window.__portWindowHeldOwners ?? [])]),
    suppressedOwnerDeadlineTimers: () => page.evaluate(() => window.__portWindowSuppressedOwnerDeadlineTimers ?? 0)
  };
}
