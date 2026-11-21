import { expect, test, type Locator, type Page, type Request as PlaywrightRequest, type Route } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';

type FixtureNode = {
  name: string;
  actions?: number;
  events?: string[];
  bindings?: number;
  targets?: string[];
  eventAssignmentRows?: Record<string, { node?: string; event?: string }>;
  assignmentRows?: Record<string, { node?: string; action?: string }>;
  fail?: boolean;
  failAssignments?: boolean;
};

type FixtureCounters = {
  requests: Array<{ method: string; path: string }>;
  refreshes: number;
  actionReads?: number;
  actionPoints?: number;
  actionReadNodes?: string[];
  actionPointInventories?: Record<string, number>;
};

const origin = 'http://127.0.0.1:4173';

function recordRequest(counters: FixtureCounters, request: PlaywrightRequest) {
  const url = new URL(request.url());
  counters.requests.push({ method: request.method(), path: url.pathname });
}

function inventory(nodes: readonly FixtureNode[]) {
  return Object.fromEntries(nodes.map(({ name }) => [name, { name }]));
}

function definitions(names: readonly string[]) {
  return Object.fromEntries(names.map((name) => [name, { name }]));
}

function nodePayload(node: FixtureNode, nodes: readonly FixtureNode[]) {
  const actionNames = Array.from({ length: node.actions ?? 2 }, (_, index) => index === 0 ? 'run' : `action-${index}`);
  const bindingNames = Array.from({ length: node.bindings ?? 1 }, (_, index) => `link-${index}`);
  const properties = Object.fromEntries(bindingNames.map((name) => [name, { type: 'object' }]));
  const assignments = Object.fromEntries(bindingNames.map((name, index) => [name, node.assignmentRows?.[name] ?? {
    node: node.targets?.[index] ?? nodes[(index + 1) % nodes.length]?.name ?? node.name,
    action: actionNames[index % actionNames.length] ?? 'run'
  }]));
  const eventProperties = Object.fromEntries(Object.keys(node.eventAssignmentRows ?? {}).map((name) => [name, { type: 'object' }]));
  return { actionNames, bindingNames, properties, assignments, eventProperties, eventAssignments: node.eventAssignmentRows ?? {} };
}

async function installLocalFixtures(
  page: Page,
  nodes: readonly FixtureNode[],
  counters: FixtureCounters,
  advertisedNodes: () => readonly FixtureNode[] = () => nodes,
  localOrigin = origin
) {
  await page.route('**/REST', async (route) => {
    recordRequest(counters, route.request());
    await route.fulfill({ json: { nodes: inventory(advertisedNodes()) } });
  });
  await page.route('**/REST/nodeURLs', async (route) => {
    recordRequest(counters, route.request());
    counters.refreshes += 1;
    await route.fulfill({ json: [] });
  });
  await page.route('**/nodes/**/REST/**', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.origin !== localOrigin) return route.fallback();
    const name = decodeURIComponent(url.pathname.split('/')[2] ?? '');
    const node = advertisedNodes().find((item) => item.name === name) ?? nodes.find((item) => item.name === name);
    if (!node) return route.fulfill({ status: 404, json: { error: 'fixture missing' } });
    recordRequest(counters, route.request());
    if (node.fail && url.pathname.endsWith('/REST/actions')) {
      return route.fulfill({ status: 503, json: { error: 'fixture unavailable' } });
    }
    const payload = nodePayload(node, nodes);
    const endpoint = url.pathname.slice(url.pathname.lastIndexOf('/REST/') + '/REST/'.length);
    if (node.failAssignments && endpoint === 'remote') {
      return route.fulfill({ status: 503, json: { error: 'fixture assignment read unavailable' } });
    }
    if (endpoint === 'actions') {
      if (counters.actionReads !== undefined) counters.actionReads += 1;
      if (counters.actionPoints !== undefined) counters.actionPoints += payload.actionNames.length;
      counters.actionReadNodes?.push(name);
      if (counters.actionPointInventories) counters.actionPointInventories[name] = payload.actionNames.length;
      return route.fulfill({ json: definitions(payload.actionNames) });
    }
    if (endpoint === 'events') return route.fulfill({ json: definitions(node.events ?? []) });
    if (endpoint === 'remote/schema') {
      return route.fulfill({ json: { type: 'object', properties: {
        actions: { type: 'object', properties: payload.properties },
        events: { type: 'object', properties: payload.eventProperties }
      } } });
    }
    if (endpoint === 'remote') return route.fulfill({ json: { actions: payload.assignments, events: payload.eventAssignments } });
    return route.fulfill({ status: 404, json: { error: 'unknown fixture endpoint' } });
  });
}

async function openBuiltTopology(page: Page, showAllNodes = true) {
  await page.goto('/nodes.html', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Topology' }).click();
  const topology = page.locator('nodel-topology');
  await expect(topology.locator('[data-topology-status]')).toBeVisible();
  if (showAllNodes) await topology.locator('[data-topology-mode]').selectOption('all-nodes');
  return topology;
}

function isReadOnlyRequest(request: { method: string; path: string }, nodePattern = '[^/]+') {
  if (request.method === 'POST') return request.path === '/REST' || request.path === '/REST/nodeURLs';
  if (request.method === 'GET' && request.path === '/REST') return true;
  if (request.method === 'OPTIONS') return new RegExp(`^/nodes/${nodePattern}/REST/(?:actions|events|remote|remote/schema)$`).test(request.path);
  if (request.method !== 'GET') return false;
  return new RegExp(`^/nodes/${nodePattern}/REST/(?:actions|events|remote|remote/schema)$`).test(request.path);
}

function isTopologyTraffic(request: { method: string; path: string }) {
  return request.path === '/REST/nodeURLs'
    || (request.method === 'POST' && request.path === '/REST')
    || /^\/nodes\/[^/]+\/REST\/(?:actions|events|remote|remote\/schema)$/.test(request.path);
}

function topologyCard(canvas: Locator, name: string) {
  return canvas.locator('.x6-node').filter({ has: canvas.page().locator(`text[aria-label="${name}"]`) });
}

async function cardIsInCanvas(card: Locator, requireHit = false) {
  return card.locator('rect').evaluate((body, hitRequired) => {
    const area = body.closest('[data-topology-canvas]')!.getBoundingClientRect();
    const box = body.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return box.width > 0 && box.height > 0 && box.left >= area.left && box.right <= area.right
      && box.top >= area.top && box.bottom <= area.bottom
      && (!hitRequired || hit?.closest('.x6-node') === body.closest('.x6-node'));
  }, requireHit);
}

test.describe('built host topology redesign', () => {
  test('captures selected partial topology at reference and responsive viewports', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-light-desktop', 'Capture evidence once from the pinned Chromium light project.');
    test.setTimeout(90_000);
    const nodes: FixtureNode[] = [
      { name: 'Hub', actions: 3, bindings: 2, targets: ['RelayA', 'RelayB'] },
      { name: 'RelayA', bindings: 2, targets: ['Collector', 'Hub'], fail: true },
      { name: 'RelayB', bindings: 2, targets: ['Collector', 'Hub'] },
      { name: 'Collector', bindings: 1, targets: ['Hub'] },
      { name: 'SensorA', bindings: 1, targets: ['Collector'] },
      { name: 'SensorB', bindings: 1, targets: ['Collector'] },
      { name: 'Controller', bindings: 1, targets: ['Hub'] }
    ];
    const incomingFixtureBindings = new Map<string, number>();
    for (const node of nodes) for (const target of node.targets ?? []) incomingFixtureBindings.set(target, (incomingFixtureBindings.get(target) ?? 0) + 1);
    expect(nodes[0]?.targets).toHaveLength(2);
    expect(incomingFixtureBindings.get('Collector')).toBe(4);
    const counters: FixtureCounters = { requests: [], refreshes: 0 };
    await installLocalFixtures(page, nodes, counters);
    await page.setViewportSize({ width: 1672, height: 941 });
    expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))).toEqual({ width: 1672, height: 941, dpr: 1 });
    await page.goto('/nodes.html', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Topology' }).click();
    const topology = page.locator('nodel-topology');
    await topology.locator('[data-topology-mode]').selectOption('all-nodes');
    const canvas = topology.locator('[data-topology-canvas]');
    await expect(canvas).toBeVisible();
    await expect.poll(() => canvas.locator('.x6-node').count()).toBe(7);
    await expect.poll(() => canvas.locator('.x6-edge').count()).toBeGreaterThanOrEqual(3);
    await expect(topology.locator('[data-topology-status-message]')).toContainText('Partial');
    const inspector = topology.locator('[data-topology-inspector]');
    const sidebar = topology.locator('[data-topology-sidebar]');
    await expect(inspector).toBeHidden();
    expect(await inspector.boundingBox()).toBeNull();
    await expect(sidebar).toBeVisible();
    await topology.locator('[data-topology-action="toggle-filters"]').click();
    await expect(sidebar).toBeHidden();
    expect(await sidebar.boundingBox()).toBeNull();
    await topology.locator('[data-topology-action="toggle-filters"]').click();
    await expect(sidebar).toBeVisible();
    expect(counters.requests.every((request) => isReadOnlyRequest(request)), JSON.stringify(counters.requests.filter((request) => !isReadOnlyRequest(request)))).toBe(true);

    const evidenceDir = 'build/topology-redesign-evidence';
    await mkdir(evidenceDir, { recursive: true });
    const geometry: Array<Record<string, unknown>> = [];
    const capture = async (name: string) => {
      const measurement = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>('nodel-topology');
        const canvasElement = root?.querySelector<HTMLElement>('[data-topology-canvas]');
        const rect = canvasElement?.getBoundingClientRect();
        const measurePanel = (panel: HTMLElement | null) => {
          if (!panel || panel.hidden) return null;
          const bounds = panel.getBoundingClientRect();
          return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
        };
        return {
          viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          theme: document.documentElement.getAttribute('data-theme'),
          document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
          topology: { width: root?.getBoundingClientRect().width ?? 0, height: root?.getBoundingClientRect().height ?? 0 },
          canvas: { x: rect?.x ?? 0, y: rect?.y ?? 0, width: rect?.width ?? 0, height: rect?.height ?? 0, clientWidth: canvasElement?.clientWidth ?? 0, scrollWidth: canvasElement?.scrollWidth ?? 0 },
          inspector: measurePanel(root?.querySelector<HTMLElement>('[data-topology-inspector]') ?? null),
          filters: measurePanel(root?.querySelector<HTMLElement>('[data-topology-sidebar]') ?? null),
          overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
          overflowY: Math.max(0, document.documentElement.scrollHeight - innerHeight)
        };
      });
      const screenshot = `${evidenceDir}/${name}.png`;
      geometry.push({ name, screenshot, ...measurement });
      await page.screenshot({ path: screenshot, fullPage: true });
    };
    await capture('topology-1672x941-light-initial');
    const composed = await canvas.evaluate(host => {
      const area = host.getBoundingClientRect();
      return [...host.querySelectorAll('.x6-node rect')].map(body => {
        const box = body.getBoundingClientRect();
        return box.width >= 200 && box.left >= area.left && box.right <= area.right && box.top >= area.top && box.bottom <= area.bottom;
      });
    });
    expect(composed).toEqual(Array(7).fill(true));

    // The card on the right initially lies in the area the docked inspector
    // takes over. A real card click must keep that card in the narrowed canvas.
    const relay = topologyCard(canvas, 'RelayA');
    await expect.poll(() => cardIsInCanvas(relay, true)).toBe(true);
    await relay.locator('rect').click();
    await expect(topology.locator('[data-topology-inspector]')).toBeVisible();
    expect(await topology.locator('[data-topology-inspector]').boundingBox()).not.toBeNull();
    await expect(topology.locator('[data-topology-inspector] h3')).toHaveText('RelayA');
    await expect(relay).toHaveClass(/\bis-selected\b/);
    await expect.poll(() => cardIsInCanvas(relay, true)).toBe(true);
    const bindingsTab = topology.locator('[data-topology-inspector-tab="bindings"]');
    await bindingsTab.focus();
    await bindingsTab.press('Enter');
    await expect(topology.locator('[data-topology-inspector-content]')).toContainText('Incoming bindings');
    await expect(topology.locator('[data-topology-inspector-content]')).toContainText('Owned bindings');
    await topology.locator('[data-topology-filter]').fill('Hub');
    await topology.locator('[data-topology-search-results] [data-topology-search-index]').filter({ hasText: 'Hub' }).first().click();
    const hubBindingsTab = topology.locator('[data-topology-inspector-tab="bindings"]');
    await hubBindingsTab.focus();
    await hubBindingsTab.press('Enter');
    const hubRelayBinding = topology.locator('[data-topology-inspector-content] [data-topology-select-type="binding"]').filter({ hasText: 'link-1' }).first();
    await hubRelayBinding.click();
    await topology.locator('[data-topology-action="zoom-in"]').first().click();
    await topology.locator('[data-topology-action="center"]').first().click();
    await expect.poll(() => cardIsInCanvas(topologyCard(canvas, 'Hub'))).toBe(true);
    await expect.poll(() => cardIsInCanvas(topologyCard(canvas, 'RelayB'))).toBe(true);
    await expect(canvas.locator('.x6-edge.is-selected')).toHaveCount(1);
    const selectedWirePath = canvas.locator('.x6-edge.is-selected path.connection');
    await expect(selectedWirePath).toHaveCount(1);
    const wireInk = await selectedWirePath.evaluate((path: SVGPathElement) => ({
      box: (() => {
        const bounds = path.getBBox();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      })(),
      stroke: getComputedStyle(path).stroke,
      length: path.getTotalLength(),
      socketEndpointMatches: (() => {
        const canvas = path.closest('[data-topology-canvas]');
        const matrix = path.getScreenCTM();
        if (!canvas || !matrix) return 0;
        const sockets = [...canvas.querySelectorAll<SVGCircleElement>('.x6-port circle')].map((socket) => {
          const bounds = socket.getBoundingClientRect();
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        });
        const endpoints = [0, path.getTotalLength()].map((length) => {
          const point = path.getPointAtLength(length);
          const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          return { x: screen.x, y: screen.y };
        });
        return endpoints.filter((endpoint) => sockets.some((socket) => Math.hypot(endpoint.x - socket.x, endpoint.y - socket.y) <= 16)).length;
      })()
    }));
    expect(wireInk.box.width + wireInk.box.height).toBeGreaterThan(0);
    expect(wireInk.stroke).not.toBe('none');
    expect(wireInk.length).toBeGreaterThan(0);
    expect(wireInk.socketEndpointMatches, 'selected routed wire should terminate at two visible socket positions').toBe(2);
    await capture('topology-1672x941-light-selected-wire');
    await topology.locator('[data-topology-filter]').fill('Hub');
    await topology.locator('[data-topology-search-results] [data-topology-search-index]').filter({ hasText: 'Hub' }).first().click();
    const hubEndpointsTab = topology.locator('[data-topology-inspector-tab="endpoints"]');
    await hubEndpointsTab.focus();
    await hubEndpointsTab.press('Enter');
    const revealedEndpoint = topology.locator('[data-topology-reveal-endpoint]').filter({ hasText: 'action-2' }).first();
    await expect(revealedEndpoint).toBeVisible();
    await expect(revealedEndpoint).toHaveAttribute('aria-pressed', 'false');
    expect(await canvas.locator('.x6-port text').filter({ hasText: 'action-2' }).count()).toBe(0);
    await revealedEndpoint.click();
    await expect(topology.locator('[data-topology-reveal-endpoint]').filter({ hasText: 'action-2' }).first()).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.locator('.x6-port text').filter({ hasText: 'action-2' })).toHaveCount(1);
    await topology.locator('[data-topology-filter]').fill('RelayA');
    await topology.locator('[data-topology-search-results] [data-topology-search-index]').filter({ hasText: 'RelayA' }).first().click();
    const overviewTab = topology.locator('[data-topology-inspector-tab="overview"]');
    await overviewTab.focus();
    await overviewTab.press('Enter');
    await expect(topology.locator('[data-topology-inspector-content]')).toContainText('Browser read status');
    await topology.locator('[data-topology-action="refresh"]').click();
    await expect.poll(() => counters.refreshes).toBeGreaterThan(1);
    await expect(topology.locator('[data-topology-status-message]')).toContainText('Partial');
    await expect(topology.locator('nodel-collapse[label="Diagnostics"]')).toBeAttached();
    await expect(topology.locator('nodel-collapse')).toContainText('Read unavailable');
    expect(counters.requests.every((request) => isReadOnlyRequest(request))).toBe(true);
    await topology.locator('[data-topology-action="toggle-inspector"]').click();
    await expect(inspector).toBeHidden();
    expect(await inspector.boundingBox()).toBeNull();
    await capture('topology-1672x941-light-selected-inspector-closed');
    await topology.locator('[data-topology-action="toggle-inspector"]').click();
    await expect(inspector).toBeVisible();
    expect(await inspector.boundingBox()).not.toBeNull();
    await capture('topology-1672x941-light-selected-partial');

    const app = page.locator('nodel-app');
    const themeToggle = app.locator('nodel-theme-toggle [data-theme-toggle]').first();
    await expect(themeToggle).toBeAttached();
    await themeToggle.evaluate((button: HTMLElement) => button.click());
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('dark');
    await expect(app).toHaveAttribute('theme', 'dark');
    await capture('topology-1672x941-dark-selected-partial');
    expect((geometry[geometry.length - 1] as { theme: string | null }).theme).toBe('dark');

    for (const [width, height, label] of [[1366, 768, '1366x768'], [1920, 1080, '1920x1080'], [390, 844, 'mobile-390x844']] as const) {
      await page.setViewportSize({ width, height });
      const inspectorToggle = topology.locator('[data-topology-inspector-toggle]');
      if (width < 900) {
        await expect(inspector).toBeHidden();
        await expect(inspectorToggle).toHaveText('Inspector');
        await expect(inspectorToggle).toHaveAttribute('aria-expanded', 'false');
        await expect.poll(() => cardIsInCanvas(relay, true)).toBe(true);
      } else {
        await expect.poll(() => cardIsInCanvas(relay, true)).toBe(true);
      }
      await capture(`topology-${label}-selected-partial`);
      const last = geometry[geometry.length - 1] as { viewport: { width: number; height: number }; canvas: { width: number; clientWidth: number } };
      expect(last.canvas.width, `canvas must fit at ${label}`).toBeGreaterThan(0);
    }
    const inspectorToggle = topology.locator('[data-topology-inspector-toggle]');
    await inspectorToggle.click();
    await expect(inspector).toHaveAttribute('role', 'dialog');
    await expect(inspector).toHaveAttribute('aria-modal', 'true');
    await expect(inspector.locator('h3')).toHaveText('RelayA');
    await expect(inspectorToggle).toHaveText('Hide inspector');
    await expect(inspectorToggle).toHaveAttribute('aria-expanded', 'true');
    await capture('topology-mobile-390x844-inspector-overlay');
    await page.setViewportSize({ width: 1672, height: 941 });
    await expect(inspector).toBeVisible();
    await expect(inspector).not.toHaveAttribute('aria-modal', 'true');
    await expect.poll(() => cardIsInCanvas(relay, true)).toBe(true);
    await topology.locator('[data-topology-action="reset"]').click();
    await expect(canvas.locator('.x6-node.is-selected, .x6-edge.is-selected')).toHaveCount(0);
    await expect(inspector).toBeHidden();
    await writeFile(`${evidenceDir}/geometry.json`, `${JSON.stringify(geometry, null, 2)}\n`);
    await testInfo.attach('topology-redesign-geometry.json', { path: `${evidenceDir}/geometry.json`, contentType: 'application/json' });
    const measured = geometry as Array<{ name: string; viewport: { width: number; height: number }; overflowX: number; overflowY: number }>;
    for (const viewport of measured) {
      expect(viewport.overflowX, `${viewport.name}: horizontal document overflow`).toBeLessThanOrEqual(1);
      expect(viewport.overflowY, `${viewport.name}: vertical document overflow`).toBeLessThanOrEqual(1);
    }
  });

  test('topology remains a read-only graph with a full host refresh', async ({ page }) => {
    const longNodeName = 'SensorWithAnExtremelyLongUnbrokenNodeNameThatMustWrapInsteadOfOverflowing1234567890';
    const nodes: FixtureNode[] = [{ name: 'Controller', actions: 3, bindings: 2 }, { name: 'Lamp', fail: true }, { name: longNodeName }];
    const counters: FixtureCounters = { requests: [], refreshes: 0 };
    await installLocalFixtures(page, nodes, counters);
    const topology = await openBuiltTopology(page);
    const canvas = topology.locator('[data-topology-canvas]');
    await expect.poll(() => canvas.locator('.x6-node').count()).toBe(3);
    await expect(topology.locator('[data-topology-status-message]')).toContainText('Partial');
    await topology.locator('[data-topology-filter]').fill('Controller');
    const result = topology.locator('[data-topology-search-results] [data-topology-search-index]').filter({ hasText: 'Controller' }).first();
    await result.click();
    await expect(topology.locator('[data-topology-inspector] h3')).toHaveText('Controller');
    await expect(topology.locator('[data-topology-inspector]')).toContainText('Discovered');
    const endpointsTab = topology.locator('[data-topology-inspector-tab="endpoints"]');
    await endpointsTab.focus();
    await endpointsTab.press('Enter');
    await expect(topology.locator('[data-topology-inspector-content]')).toContainText('run');
    await topology.locator('[data-topology-reveal]').selectOption('expanded');
    await topology.locator('[data-topology-action="refresh"]').click();
    await expect.poll(() => counters.refreshes).toBeGreaterThan(1);
    expect(counters.requests.every((request) => isReadOnlyRequest(request))).toBe(true);
    await expect(topology.locator('nodel-collapse')).toContainText('Read unavailable');
    const closeInspector = topology.locator('[data-topology-inspector] [data-topology-action="close-inspector"]');
    await closeInspector.focus();
    await closeInspector.press('Enter');
    await expect(topology.locator('[data-topology-inspector]')).toBeHidden();
    // Closing the inspector changes the canvas bounds and schedules a debounced
    // camera/layout save. Make an intentional camera change, then wait for the
    // persisted payload rather than racing its 180ms debounce with a one-shot read.
    await topology.locator('[data-topology-action="zoom-in"]').first().click();
    await expect.poll(() => page.evaluate(() => {
      const entry = Object.entries(localStorage).find(([key]) => key.startsWith('nodel.topology.layout.v2:'));
      if (!entry) return null;
      try {
        const payload = JSON.parse(String(entry[1])) as { positions?: Record<string, { x?: number; y?: number }>; viewport?: { x?: number; y?: number; scale?: number } };
        const positions = payload.positions ?? {};
        return Object.keys(positions).length >= 3
          && Object.values(positions).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
          && typeof payload.viewport?.scale === 'number' && Number.isFinite(payload.viewport.scale) && payload.viewport.scale > 1;
      } catch {
        return false;
      }
    }), { timeout: 5_000 }).toBe(true);
    const longResult = topology.locator('[data-topology-filter]');
    await longResult.fill(longNodeName);
    await topology.locator('[data-topology-search-results] [data-topology-search-index]').filter({ hasText: longNodeName }).first().click();
    await expect(topology.locator('[data-topology-inspector] h3')).toHaveText(longNodeName);
    await expect.poll(() => topology.locator('[data-topology-inspector] h3').evaluate((node) => getComputedStyle(node).wordBreak)).toBe('break-all');
  });

  test('covers cross-origin CORS allow/deny and credential isolation with browser fixtures', async ({ page, context }) => {
    const nodes: FixtureNode[] = [{ name: 'Local' }];
    const counters: FixtureCounters = { requests: [], refreshes: 0 };
    await installLocalFixtures(page, nodes, counters);
    await context.addCookies([{ name: 'host-session', value: 'local-only', url: origin }]);
    let port = 0;
    const remoteRequests: Array<{ name: string; cookie?: string | undefined; method: string; path: string }> = [];
    const remoteServer = createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
      const name = decodeURIComponent(url.pathname.split('/')[2] ?? '');
      remoteRequests.push({ name, cookie: request.headers.cookie, method: request.method ?? '', path: url.pathname });
      if (name === 'RemoteAllowed') {
        response.setHeader('access-control-allow-origin', origin);
        response.setHeader('vary', 'Origin');
      }
      if (request.method === 'OPTIONS') {
        response.setHeader('access-control-allow-methods', 'GET, OPTIONS');
        response.setHeader('access-control-allow-headers', 'accept');
        response.setHeader('access-control-allow-private-network', 'true');
        response.statusCode = 204;
        response.end();
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(url.pathname.endsWith('/actions') ? { run: { name: 'run' } } : {}));
    });
    await new Promise<void>((resolve) => remoteServer.listen(0, '127.0.0.1', resolve));
    port = (remoteServer.address() as { port: number }).port;
    const remoteAddress = `http://127.0.0.1:${port}/nodes/RemoteAllowed/`;
    const deniedAddress = `http://127.0.0.1:${port}/nodes/RemoteDenied/`;
    const remoteNames = ['RemoteAllowed', 'RemoteDenied'];
    await page.route('**/REST/nodeURLs', async (route) => {
      counters.refreshes += 1;
      await route.fulfill({ json: remoteNames.map((name) => ({ name, address: `http://127.0.0.1:${port}/nodes/${name}/` })) });
    });
    try {
      await page.goto('/nodes.html', { waitUntil: 'domcontentloaded' });
      const directCorsRead = await page.evaluate(async (fixturePort) => {
        const read = async (node: string) => fetch(`http://127.0.0.1:${fixturePort}/nodes/${node}/REST/actions`)
          .then((response) => response.ok, () => false);
        return { allowed: await read('RemoteAllowed'), denied: await read('RemoteDenied') };
      }, port);
      expect(directCorsRead, JSON.stringify(remoteRequests)).toEqual({ allowed: true, denied: false });
      const topology = await openBuiltTopology(page);
      await expect(topology.locator('[data-topology-status-message]')).toContainText('Partial');
      await expect.poll(() => topology.locator('[data-topology-canvas] .x6-node').count()).toBe(3);
      expect(remoteRequests.some((request) => request.name === 'RemoteAllowed')).toBe(true);
      expect(remoteRequests.some((request) => request.name === 'RemoteDenied')).toBe(true);
      expect(remoteRequests.every((request) => request.cookie === undefined)).toBe(true);
      expect(remoteRequests.every((request) => isReadOnlyRequest(request, '(?:RemoteAllowed|RemoteDenied)'))).toBe(true);
      await topology.locator('[data-topology-filter]').fill('RemoteDenied');
      await topology.locator('[data-topology-search-results] [data-topology-search-index]').filter({ hasText: 'RemoteDenied' }).first().click();
      await expect(topology.locator('[data-topology-inspector]')).toContainText('RemoteDenied');
      expect(new URL(remoteAddress).origin).not.toBe(origin);
      expect(new URL(deniedAddress).origin).not.toBe(origin);
    } finally {
      await new Promise<void>((resolve, reject) => {
        remoteServer.close((error) => error ? reject(error) : resolve());
        // Cross-origin browser fixtures leave keep-alive sockets open; force
        // their closure so cleanup cannot consume the test's remaining timeout.
        remoteServer.closeAllConnections();
      });
    }
  });

  test('renders 100 nodes with 200 action points each and 300 bindings', async ({ page }) => {
    test.setTimeout(120_000);
    const nodes: FixtureNode[] = Array.from({ length: 100 }, (_, index) => ({
      name: `Scale${String(index).padStart(3, '0')}`,
      actions: 200,
      bindings: 3
    }));
    const counters = {
      requests: [] as Array<{ method: string; path: string }>, refreshes: 0, actionReads: 0, actionPoints: 0,
      actionReadNodes: [] as string[], actionPointInventories: {} as Record<string, number>
    };
    await installLocalFixtures(page, nodes, counters);
    const topology = await openBuiltTopology(page);
    const startedAt = Date.now();
    const canvas = topology.locator('[data-topology-canvas]');
    // Inventory is intentionally independent from per-node detail reads: all
    // 100 cards are advertised immediately, while each refresh inspects only
    // the bounded 32-route primary page (with separate space for up to eight
    // alternates). Advance actual refresh cycles rather than assuming one
    // refresh probes every advertised node.
    await expect(canvas.locator('.x6-node')).toHaveCount(100, { timeout: 90_000 });
    await expect.poll(() => new Set(counters.actionReadNodes).size, { timeout: 90_000 }).toBe(32);
    expect(counters.actionReads).toBeLessThanOrEqual(32);
    for (let cycle = 1; cycle < 4; cycle += 1) {
      const uniqueActionsBefore = new Set(counters.actionReadNodes).size;
      const refreshesBefore = counters.refreshes;
      await topology.locator('[data-topology-action="refresh"]').click();
      await expect.poll(() => counters.refreshes).toBeGreaterThan(refreshesBefore);
      await expect.poll(() => new Set(counters.actionReadNodes).size, { timeout: 90_000 })
        .toBe(Math.min(uniqueActionsBefore + 32, 100));
      await expect(topology.locator('[data-topology-status-message]')).not.toContainText('Reading', { timeout: 90_000 });
    }
    await expect(topology.locator('[data-topology-status-message]')).toContainText('300 bindings', { timeout: 90_000 });
    const discoveryMs = Date.now() - startedAt;
    expect(new Set(counters.actionReadNodes).size).toBe(100);
    expect(Object.values(counters.actionPointInventories).reduce((total, points) => total + points, 0)).toBe(20_000);
    expect(counters.requests.every((request) => isReadOnlyRequest(request, 'Scale\\d{3}'))).toBe(true);

    await topology.locator('[data-topology-filter]').fill('Scale000');
    await topology.locator('[data-topology-search-results] [data-topology-search-index]').filter({ hasText: 'Scale000' }).first().click();
    const endpointsTab = topology.locator('[data-topology-inspector-tab="endpoints"]');
    await endpointsTab.focus();
    await endpointsTab.press('Enter');
    await topology.locator('[data-topology-endpoint-filter]').fill('action-199');
    await expect(topology.locator('[data-topology-inspector-content]')).toContainText('action-199');
    const bindingsTab = topology.locator('[data-topology-inspector-tab="bindings"]');
    await bindingsTab.focus();
    await bindingsTab.press('Enter');
    const scaleResult = await topology.evaluate((element) => ({
      nodes: element.querySelectorAll('[data-topology-canvas] .x6-node').length,
      bindings: Number(element.querySelector('[data-topology-inspector-content] h4')?.textContent?.match(/\((\d+)\)/)?.[1] ?? 0),
      canvasWidth: element.querySelector<HTMLElement>('[data-topology-canvas]')?.clientWidth ?? 0,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight
    }));
    expect(scaleResult.nodes).toBe(100);
    expect(scaleResult.bindings).toBe(3);
    const closeInspector = topology.locator('[data-topology-inspector] [data-topology-action="close-inspector"]');
    await closeInspector.focus();
    await closeInspector.press('Enter');
    await expect(topology.locator('[data-topology-inspector]')).toBeHidden();
    await expect.poll(() => canvas.evaluate((node) => node.clientWidth)).toBeGreaterThan(0);
    const canvasWidth = await canvas.evaluate((node) => node.clientWidth);
    expect(canvasWidth).toBeGreaterThan(Math.min(250, scaleResult.viewportWidth / 2));
    expect(canvasWidth).toBeLessThanOrEqual(scaleResult.viewportWidth + 1);
    expect(Math.max(0, scaleResult.documentWidth - scaleResult.viewportWidth)).toBeLessThanOrEqual(1);

    await topology.locator('[data-topology-action="reset"]').click();
    await expect(canvas.locator('.is-selected')).toHaveCount(0);
    // Initial framing favors a connected cluster, not the first SVG card.
    // Target a known card, then close the inspector without clearing selection.
    await topology.locator('[data-topology-filter]').fill('Scale000');
    await topology.getByRole('option', { name: 'Scale000 · Node', exact: true }).click();
    await expect(closeInspector).toBeVisible();
    await closeInspector.click();
    await expect(topology.locator('[data-topology-inspector]')).toBeHidden();
    const selectedCard = topologyCard(canvas, 'Scale000');
    await canvas.scrollIntoViewIfNeeded();
    await expect(canvas.locator('.x6-edge')).toHaveCount(300);
    const edgeCountBeforeRefresh = await canvas.locator('.x6-edge').count();
    await expect(selectedCard).toHaveClass(/\bis-selected\b/);
    await expect.poll(() => cardIsInCanvas(selectedCard, true)).toBe(true);
    await selectedCard.evaluate((element) => {
      (window as Window & { __topologyRefreshNode?: Element }).__topologyRefreshNode = element;
    });
    const nodeBounds = await selectedCard.locator('rect').boundingBox();
    expect(nodeBounds).not.toBeNull();
    if (!nodeBounds) throw new Error('Canvas node must have visible bounds');

    // Reset clears the key; the replacement snapshot is written after a debounce.
    const readLayout = async () => page.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) => candidate.startsWith('nodel.topology.layout.v2:'));
      const raw = key && localStorage.getItem(key);
      return raw ? JSON.parse(raw) as { positions?: Record<string, { x: number; y: number }>; viewport?: { x: number; y: number; scale: number } } : undefined;
    });
    const readSelectedPosition = async () => {
      const layout = await readLayout();
      return Object.entries(layout?.positions ?? {}).find(([key]) => key.includes('scale000'))?.[1];
    };
    await expect.poll(readSelectedPosition).toBeDefined();
    const positionBeforeDrag = (await readSelectedPosition())!;
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    if (!canvasBox) throw new Error('Canvas must have a physical viewport for drag and zoom interactions');
    expect(nodeBounds.x).toBeGreaterThanOrEqual(canvasBox.x);
    expect(nodeBounds.y).toBeGreaterThanOrEqual(canvasBox.y);
    expect(nodeBounds.x).toBeLessThan(canvasBox.x + canvasBox.width);
    expect(nodeBounds.y).toBeLessThan(canvasBox.y + canvasBox.height);
    await page.mouse.move(nodeBounds.x + nodeBounds.width / 2, nodeBounds.y + nodeBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(nodeBounds.x + nodeBounds.width / 2 + 45, nodeBounds.y + nodeBounds.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await readSelectedPosition())?.x ?? 0).toBeGreaterThan(positionBeforeDrag.x);
    await expect.poll(async () => (await readSelectedPosition())?.y ?? 0).toBeGreaterThan(positionBeforeDrag.y);
    const positionAfterDrag = await readSelectedPosition();
    const layoutBeforeRefresh = await readLayout();
    expect(Object.keys(layoutBeforeRefresh?.positions ?? {}).length).toBeGreaterThan(0);
    const refreshCount = counters.refreshes;
    await topology.locator('[data-topology-action="refresh"]').click();
    await expect.poll(() => counters.refreshes).toBeGreaterThan(refreshCount);
    // One manual refresh is bounded to 32 primary routes and up to eight
    // alternate routes; the complete fixture remains visible with partial
    // inspection coverage while the page rotates to its next batch.
    await expect(topology.locator('[data-topology-status-message]')).toContainText('Partial', { timeout: 90_000 });
    await expect.poll(() => selectedCard.evaluate((node) => node === (window as Window & { __topologyRefreshNode?: Element }).__topologyRefreshNode)).toBe(true);
    await expect(selectedCard).toHaveClass(/\bis-selected\b/);
    await expect.poll(readSelectedPosition).toEqual(positionAfterDrag);
    // A refresh rotates the bounded assignment-read window, so unresolved
    // owners can temporarily remove edges while the selected card/layout stay
    // stable. Keep a majority-retention floor rather than assuming all 100
    // owners are re-read in one 32-route cycle.
    const edgeCountAfterRefresh = await canvas.locator('.x6-edge').count();
    expect(edgeCountAfterRefresh).toBeGreaterThanOrEqual(Math.floor(edgeCountBeforeRefresh * 0.6));
    expect(edgeCountAfterRefresh).toBeLessThanOrEqual(edgeCountBeforeRefresh);
    await expect.poll(readLayout).toBeDefined();
    await canvas.scrollIntoViewIfNeeded();
    const postRefreshBounds = await selectedCard.boundingBox();
    expect(postRefreshBounds).not.toBeNull();
    if (!postRefreshBounds) throw new Error('Canvas node remains attached and visible after unchanged refresh');
    expect(postRefreshBounds.x + postRefreshBounds.width).toBeGreaterThan(0);
    expect(postRefreshBounds.x).toBeLessThan(scaleResult.viewportWidth);
    expect(postRefreshBounds.y + postRefreshBounds.height).toBeGreaterThan(0);
    expect(postRefreshBounds.y).toBeLessThan(scaleResult.viewportHeight);
    const paint = await selectedCard.evaluate((node) => {
      const body = node.querySelector('rect')!;
      const box = body.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { hitNode: hit?.closest('.x6-node') === node, fill: getComputedStyle(body).fill, text: node.textContent };
    });
    expect(paint.hitNode).toBe(true);
    expect(paint.fill).not.toBe('none');
    expect(paint.text).toContain('Scale000');
    await test.info().attach('topology-scale-timing.json', {
      body: JSON.stringify({ ...scaleResult, discoveryMs, canvasBox, nodeBounds, postRefreshBounds, paint,
        layoutBeforeRefresh, layoutAfterRefresh: await readLayout() }, null, 2),
      contentType: 'application/json'
    });
  });

  test('renders 1065 resolved dense bindings after bounded refresh cycles', async ({ page }, testInfo) => {
    const started = Date.now();
    test.skip(testInfo.project.name !== 'chromium-light-desktop', 'Dense rendering stress is executed once in the pinned Chromium light project.');
    test.setTimeout(240_000);
    const nodes: FixtureNode[] = Array.from({ length: 100 }, (_, index) => {
      const bindingCount = index < 65 ? 11 : 10;
      return {
        name: `Dense${String(index).padStart(3, '0')}`,
        actions: 11,
        bindings: bindingCount,
        targets: Array.from({ length: bindingCount }, (_, bindingIndex) => `Dense${String((index + bindingIndex + 1) % 100).padStart(3, '0')}`)
      };
    });
    expect(nodes).toHaveLength(100);
    expect(nodes.reduce((total, node) => total + (node.bindings ?? 0), 0)).toBe(1065);
    const maxOutDegree = Math.max(...nodes.map((node) => node.bindings ?? 0));
    const inDegree = new Map<string, number>();
    for (const node of nodes) for (const target of node.targets ?? []) inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
    expect(maxOutDegree).toBeGreaterThanOrEqual(10);
    expect(Math.max(...inDegree.values())).toBeGreaterThanOrEqual(10);
    const counters: FixtureCounters = { requests: [], refreshes: 0, actionReads: 0 };
    await installLocalFixtures(page, nodes, counters);
    const topology = await openBuiltTopology(page);
    const canvas = topology.locator('[data-topology-canvas]');
    await expect(topology.locator('[data-topology-status-message]')).toContainText('Partial', { timeout: 120_000 });
    await expect(topology.locator('[data-topology-status-message]')).toContainText('100 nodes', { timeout: 120_000 });
    await expect(canvas.locator('.x6-node')).toHaveCount(100, { timeout: 120_000 });
    let refreshCycles = 1;
    while (await canvas.locator('.x6-edge').count() < 1065 && refreshCycles < 6) {
      const actionReadsBefore = counters.actionReads ?? 0;
      const refreshesBefore = counters.refreshes;
      await topology.locator('[data-topology-action="refresh"]').click();
      await expect.poll(() => counters.refreshes).toBeGreaterThan(refreshesBefore);
      await expect.poll(() => counters.actionReads ?? 0).toBeGreaterThan(actionReadsBefore);
      await expect(topology.locator('[data-topology-status-message]')).not.toContainText('Reading', { timeout: 120_000 });
      refreshCycles += 1;
    }
    // The fixture has all 1065 assignments, but bounded per-cycle reads leave
    // uninspected nodes partial until later refreshes; the graph can still draw
    // every independently resolved binding.
    await expect(topology.locator('[data-topology-status-message]')).toContainText('Partial', { timeout: 20_000 });
    await expect(topology.locator('[data-topology-status-message]')).toContainText('1065 bindings', { timeout: 120_000 });
    await expect(canvas.locator('.x6-edge')).toHaveCount(1065, { timeout: 120_000 });
    const completeRenderMs = Date.now() - started;
    expect(counters.requests.every((request) => isReadOnlyRequest(request, 'Dense\\d{3}'))).toBe(true);
    const evidenceDir = 'build/topology-redesign-evidence';
    await mkdir(evidenceDir, { recursive: true });
    const bounds = await page.evaluate(() => ({
      fixtureNodes: 100,
      fixtureBindings: 1065,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      renderedNodes: document.querySelectorAll('nodel-topology [data-topology-canvas] .x6-node').length,
      status: document.querySelector('nodel-topology [data-topology-status-message]')?.textContent ?? '',
      edges: document.querySelectorAll('nodel-topology [data-topology-canvas] .x6-edge').length,
      overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      overflowY: Math.max(0, document.documentElement.scrollHeight - innerHeight)
    }));
    expect(bounds.overflowX).toBeLessThanOrEqual(1);
    expect(bounds.overflowY).toBeLessThanOrEqual(1);
    const screenshot = `${evidenceDir}/topology-dense-100x1065-complete.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    await writeFile(`${evidenceDir}/topology-dense-100x1065-complete.json`, `${JSON.stringify({ ...bounds, completeRenderMs, screenshot }, null, 2)}\n`);
  });

  test('keeps a 209-node partial inventory edge-free when assignments are unavailable', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-light-desktop', 'Truncation behavior is exercised once in the pinned Chromium light project.');
    test.setTimeout(120_000);
    const nodes: FixtureNode[] = Array.from({ length: 209 }, (_, index) => ({
      name: `Truncated${String(index).padStart(3, '0')}`,
      bindings: index < 20 ? 6 : 5,
      failAssignments: true
    }));
    expect(nodes).toHaveLength(209);
    expect(nodes.reduce((total, node) => total + (node.bindings ?? 0), 0)).toBe(1065);
    const counters: FixtureCounters = { requests: [], refreshes: 0 };
    await installLocalFixtures(page, nodes, counters);
    const topology = await openBuiltTopology(page);
    await expect(topology.locator('[data-topology-status-message]')).toContainText('Partial', { timeout: 120_000 });
    await expect(topology.locator('nodel-collapse[label="Diagnostics"]')).toContainText('Read unavailable', { timeout: 120_000 });
    const canvas = topology.locator('[data-topology-canvas]');
    await expect(canvas.locator('.x6-edge')).toHaveCount(0);
    expect(counters.requests.every((request) => isReadOnlyRequest(request, 'Truncated\\d{3}'))).toBe(true);
    const evidenceDir = 'build/topology-redesign-evidence';
    await mkdir(evidenceDir, { recursive: true });
    const state = await page.evaluate(() => ({
      fixtureNodes: 209,
      fixtureBindings: 1065,
      status: document.querySelector('nodel-topology [data-topology-status-message]')?.textContent ?? '',
      discoveredNodes: document.querySelectorAll('nodel-topology [data-topology-canvas] .x6-node').length,
      edges: document.querySelectorAll('nodel-topology [data-topology-canvas] .x6-edge').length
    }));
    const screenshot = `${evidenceDir}/topology-truncated-209x1065-partial-no-edges.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    await writeFile(`${evidenceDir}/topology-truncated-209x1065-partial-no-edges.json`, `${JSON.stringify({ ...state, screenshot }, null, 2)}\n`);
  });

  test('does not start discovery until a lazy topology page becomes visible', async ({ page }) => {
    const nodes: FixtureNode[] = [{ name: 'LazyNode' }];
    const counters: FixtureCounters = { requests: [], refreshes: 0 };
    await installLocalFixtures(page, nodes, counters);
    const topologyChunks: string[] = [];
    page.on('request', (request) => {
      if (/\/nodel-topology-[^/]+\.js(?:\?|$)/.test(request.url())) topologyChunks.push(request.url());
    });
    await page.goto('/nodes.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nodel-topology')).toHaveCount(1);
    expect(topologyChunks).toHaveLength(0);
    expect(counters.refreshes).toBe(0);
    await page.getByRole('button', { name: 'Topology' }).click();
    await expect.poll(() => topologyChunks.length).toBeGreaterThan(0);
    await expect.poll(() => counters.refreshes).toBeGreaterThan(0);
    await page.locator('nodel-topology [data-topology-mode]').selectOption('all-nodes');
    await expect(page.locator('nodel-topology [data-topology-canvas] .x6-node')).toHaveCount(1);

    await page.clock.install();
    await page.getByRole('button', { name: 'Locals' }).click();
    await expect(page.locator('nodel-page[title="Locals"]')).toHaveAttribute('active', '');
    const topologyRequestCountAfterLeaving = counters.requests.filter(isTopologyTraffic).length;
    await page.clock.fastForward(60_000);
    expect(counters.requests.filter(isTopologyTraffic)).toHaveLength(topologyRequestCountAfterLeaving);
  });

  test('shows a host authentication failure on the built nodes topology page without writes', async ({ page }) => {
    const requests: Array<{ method: string; path: string }> = [];
    await page.route('**/REST', async (route) => {
      recordRequest({ requests, refreshes: 0 }, route.request());
      await route.fulfill({ status: 401, json: { error: 'Fixture unauthorized' } });
    });
    await page.route('**/REST/nodeURLs', async (route) => {
      requests.push({ method: route.request().method(), path: new URL(route.request().url()).pathname });
      await route.fulfill({ json: [] });
    });
    const topology = await openBuiltTopology(page);
    await expect(topology.locator('[data-topology-status-message]')).toContainText('Partial');
    await expect(topology.locator('nodel-collapse[label="Diagnostics"]')).toContainText('local: Read unavailable');
    expect(requests).toContainEqual({ method: 'GET', path: '/REST' });
    expect(requests.every((request) => (request.method === 'GET' && request.path === '/REST')
      || (request.method === 'POST' && request.path === '/REST/nodeURLs'))).toBe(true);
  });

  test('renders configured owner connections in All Nodes view across unavailable references in a large inventory', async ({ page }) => {
    // Every Nodel endpoint is intercepted below; this is browser/UI evidence,
    // not a runtime-host integration check.
    const owner: FixtureNode = {
      name: 'AOwner',
      bindings: 4,
      assignmentRows: {
        'link-0': { node: 'AOffline', action: 'run' },
        'link-1': { node: 'NotAdvertised', action: 'run' },
        'link-2': { node: 'AInvalid', action: 'missing-action' },
        'link-3': { node: 'AInvalid' }
      }
    };
    const nodes: FixtureNode[] = [owner, { name: 'AOffline', fail: true }, { name: 'AInvalid' },
      ...Array.from({ length: 132 }, (_, index) => ({ name: `Inventory${String(index).padStart(3, '0')}` }))];
    const counters: FixtureCounters = { requests: [], refreshes: 0, actionReads: 0 };
    await installLocalFixtures(page, nodes, counters);
    const topology = await openBuiltTopology(page);
    const canvas = topology.locator('[data-topology-canvas]');
    const ownerCard = topologyCard(canvas, 'AOwner');

    // More than 128 entries are advertised. Inventory should still
    // materialize cards immediately; drawing configured relationships
    // must not depend on fully reading every advertised target.
    await expect(canvas.locator('.x6-node')).toHaveCount(136);
    await expect.poll(() => counters.actionReads).toBeGreaterThanOrEqual(31);
    expect(counters.actionReads).toBeLessThanOrEqual(32);
    expect(nodes.length).toBeGreaterThan(128);
    await expect(ownerCard).toBeVisible();
    await expect.poll(() => canvas.locator('.x6-edge').count()).toBeGreaterThanOrEqual(3);
    await expect(ownerCard.locator('.x6-port')).not.toHaveCount(0);
    expect(counters.requests.every((request) => isReadOnlyRequest(request, '(?:AOwner|AOffline|AInvalid|Inventory\\d{3}|NotAdvertised)'))).toBe(true);
  });

  test('folds alternative node spellings and addresses into one card', async ({ page }) => {
    const owner: FixtureNode = { name: 'Owner', bindings: 1, targets: ['Relay'] };
    const relay: FixtureNode = { name: 'Relay', bindings: 0 };
    const alternate: FixtureNode = { name: 'R-e-lay', bindings: 0 };
    const nodes = [owner, relay, alternate];
    const counters: FixtureCounters = { requests: [], refreshes: 0 };
    await installLocalFixtures(page, nodes, counters, () => [owner]);
    await page.route('**/REST/nodeURLs', async (route) => {
      counters.refreshes += 1;
      recordRequest(counters, route.request());
      await route.fulfill({ json: [
        { name: 'Relay', address: `${origin}/nodes/Relay/` },
        { name: 'R-e-lay', address: `${origin}/nodes/R-e-lay/` }
      ] });
    });
    const topology = await openBuiltTopology(page);
    const canvas = topology.locator('[data-topology-canvas]');
    await expect(canvas.locator('.x6-node')).toHaveCount(2);
    await expect(canvas.locator('.x6-node').filter({ hasText: /Relay|R-e-lay/ })).toHaveCount(1);
    await expect.poll(() => counters.requests.some((request) => /\/nodes\/(?:Relay|R-e-lay)\/REST\//i.test(request.path))).toBe(true);
    expect(counters.requests.every((request) => isReadOnlyRequest(request, '(?:Owner|R-e-lay|Relay)'))).toBe(true);
  });

  test('exercises a connected control/DSP workspace and the complete advertised palette', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-light-desktop', 'Workspace evidence is captured once in pinned Chromium.');
    test.setTimeout(120_000);
    const connected: FixtureNode[] = [
      { name: 'Control', bindings: 3, targets: ['DSP', 'DSP', 'Alarm'], eventAssignmentRows: { 'on-ready': { node: 'DSP', event: 'ready' } } },
      { name: 'DSP', actions: 3, events: ['ready'], bindings: 4, targets: ['Mixer', 'Filter', 'Scope', 'Control'] },
      { name: 'Mixer', bindings: 1, targets: ['Output'] },
      { name: 'Filter', bindings: 1, targets: ['Output'] },
      { name: 'Scope', bindings: 1, targets: ['Control'] },
      { name: 'Alarm', bindings: 1, targets: ['Control'] },
      { name: 'Output', bindings: 1, targets: ['Recorder'] },
      { name: 'Recorder', bindings: 1, targets: ['Control'] },
      ...Array.from({ length: 10 }, (_, index) => index === 9
        ? { name: `Sensor${String(index + 1).padStart(2, '0')}`, actions: 3, bindings: 0 }
        : { name: `Sensor${String(index + 1).padStart(2, '0')}`, bindings: 1, targets: [index === 7 ? 'Scope' : index === 8 ? 'Sensor10' : index % 2 ? 'DSP' : 'Mixer'] })
    ];
    const inventoryNodes: FixtureNode[] = Array.from({ length: 451 - connected.length }, (_, index) => ({
      name: `Inventory${String(index).padStart(3, '0')}`,
      actions: 0,
      bindings: 0
    }));
    const nodes = [...connected, ...inventoryNodes];
    const counters: FixtureCounters = { requests: [], refreshes: 0, actionReads: 0 };
    await installLocalFixtures(page, nodes, counters);
    const topology = await openBuiltTopology(page, false);
    const canvas = topology.locator('[data-topology-canvas]');
    await expect(topology.locator('[data-topology-status-message]')).toContainText('451 nodes discovered', { timeout: 30_000 });
    await expect.poll(() => counters.actionReads).toBeGreaterThan(0);
    await expect(topology.locator('[data-topology-mode] option:checked')).toHaveText('Relationships');
    await expect(canvas.locator('.x6-node')).toHaveCount(connected.length);
    await expect.poll(() => canvas.locator('.x6-edge').count()).toBeGreaterThan(0);
    for (const node of connected) await expect(topologyCard(canvas, node.name)).toHaveCount(1);
    await expect(canvas.locator('.x6-node').filter({ hasText: /Inventory[0-9]{3}/ })).toHaveCount(0);
    expect(inventoryNodes).toHaveLength(433);
    // Relationships mode renders the connected fixture by default, while all
    // unrelated advertisements remain available through the full inventory.
    const paletteSearch = topology.locator('[data-topology-palette-query]');

    // Select the control owner and prove the action/event namespaces stay distinct.
    await topology.locator('[data-topology-filter]').fill('Control');
    await topology.locator('[data-topology-search-results] [data-topology-search-index]').filter({ hasText: 'Control' }).first().click();
    const inspector = topology.locator('[data-topology-inspector]');
    await inspector.locator('[data-topology-inspector-tab="bindings"]').click();
    const controlBindings = topology.locator('[data-topology-inspector-content] [data-topology-select-type="binding"]');
    const eventBinding = controlBindings.filter({ hasText: 'on-ready · events' }).first();
    await expect(eventBinding).toBeVisible();
    await expect(controlBindings.filter({ hasText: 'link-0 · actions' }).first()).toBeVisible();
    await expect(controlBindings.filter({ hasText: 'link-1 · actions' }).first()).toBeVisible();
    await eventBinding.click();
    await expect(inspector.locator('[data-topology-inspector-content]')).toContainText('events');
    await expect(inspector.locator('[data-topology-inspector-content]')).toContainText('ready');

    // Move to the actual relationship bundle, expand it to member bindings, then inspect one member.
    await topology.locator('[data-topology-filter]').fill('Control');
    await topology.locator('[data-topology-search-results] [data-topology-search-index]').filter({ hasText: 'Control' }).first().click();
    await topology.locator('[data-topology-inspector-tab="bindings"]').click();
    // Overview collapses the two Control→DSP action aliases into a relationship bundle.
    await topology.locator('[data-topology-mode]').selectOption('overview');
    await expect.poll(() => page.evaluate(() => {
      const component = document.querySelector('nodel-topology') as unknown as { projectedView?: { bindingIdsByWire?: Map<string, readonly string[]> } };
      return [...(component.projectedView?.bindingIdsByWire?.values() ?? [])].some((members) => members.length > 1);
    })).toBe(true);
    await page.evaluate(() => {
      const component = document.querySelector('nodel-topology') as unknown as { projectedView?: { bindingIdsByWire?: Map<string, readonly string[]> }; canvas?: {
        domainWires?: Map<string, string>;
        graph?: {
        getCells(): Array<{ isEdge(): boolean }>;
        getCellById(id: string): { isEdge(): boolean } | null;
        trigger(event: string, args: { edge: { isEdge(): boolean } }): void;
      } } };
      const graph = component.canvas?.graph;
      const bundledWire = [...(component.projectedView?.bindingIdsByWire?.entries() ?? [])].find(([, members]) => members.length > 1)?.[0];
      const cellId = [...(component.canvas?.domainWires?.entries() ?? [])].find(([, domainId]) => domainId === bundledWire)?.[0];
      const edge = cellId ? graph?.getCellById(cellId) : null;
      if (!graph || !edge || !bundledWire) throw new Error('Expected a multi-binding overview wire to trigger its public selection event');
      graph.trigger('edge:click', { edge });
    });
    await expect(topology.locator('[data-topology-inspector-content]')).toContainText('Overview relationship bundle');
    const individualBinding = topology.locator('[data-topology-inspector-content] [data-topology-select-type="binding"]').filter({ hasText: 'link-0 · actions' }).first();
    await individualBinding.click();
    await expect(topology.locator('[data-topology-inspector-content]')).not.toContainText('Overview relationship bundle');
    await expect(topology.locator('[data-topology-inspector-content]')).toContainText('link-0');
    await topology.locator('[data-topology-mode]').selectOption('detailed');

    // Inventory beyond the former 451 display boundary is still searchable and placeable.
    await paletteSearch.fill('Inventory432');
    const paletteRow = topology.locator('[data-topology-palette-entries] .nodel-topology-palette-row').filter({ hasText: 'Inventory432' });
    await expect(paletteRow).toContainText('Inventory432');
    await expect(paletteRow).toContainText('advertised-only');
    expect(counters.requests.some((request) => /\/nodes\/Inventory432\/REST\//.test(request.path))).toBe(false);
    await paletteRow.getByRole('button', { name: 'Place' }).click();
    const placedCard = topologyCard(canvas, 'Inventory432');
    await expect(placedCard).toHaveCount(1);
    await expect(paletteRow.getByRole('button', { name: 'Remove' })).toBeVisible();

    // Revealing a node's port is presentation-only; it must not add any requests or write verbs.
    await topology.locator('[data-topology-filter]').fill('Sensor10');
    await topology.locator('[data-topology-search-results] [data-topology-search-index]').filter({ hasText: 'Sensor10' }).first().click();
    await topology.locator('[data-topology-inspector-tab="endpoints"]').click();
    const portReveal = topology.locator('[data-topology-reveal-endpoint]').filter({ hasText: 'action-2' }).first();
    await expect(portReveal).toBeVisible();
    await portReveal.click();
    await expect(canvas.locator('.x6-port text').filter({ hasText: 'action-2' })).toHaveCount(1);

    // Pin a manual position by dragging the placed target, then make sure refresh preserves it.
    const placedRect = placedCard.locator('rect');
    await expect(placedRect).toBeVisible();
    const bounds = await placedRect.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error('Placed node must have bounds before pin/refresh validation');
    const layout = async () => page.evaluate(() => {
      const entry = Object.entries(localStorage).find(([key]) => key.startsWith('nodel.topology.layout.v2:'));
      return entry ? JSON.parse(String(entry[1])) as { positions?: Record<string, { x: number; y: number }>; pinnedNodeIds?: string[] } : undefined;
    });
    await expect.poll(async () => (await layout())?.pinnedNodeIds?.some((id) => id.includes('inventory432'))).toBe(true);
    const placedNodeId = (await layout())?.pinnedNodeIds?.find((id) => id.includes('inventory432'));
    expect(placedNodeId).toBeTruthy();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 52, bounds.y + bounds.height / 2 + 32, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await layout())?.positions?.[placedNodeId!]).toBeDefined();
    const beforeRefresh = (await layout())?.positions?.[placedNodeId!];
    const refreshesBefore = counters.refreshes;
    await topology.locator('[data-topology-action="refresh"]').click();
    await expect.poll(() => counters.refreshes).toBeGreaterThan(refreshesBefore);
    await expect.poll(async () => (await layout())?.positions?.[placedNodeId!]).toEqual(beforeRefresh);
    await expect(placedCard).toHaveCount(1);

    // A real reload must restore the pinned workspace member and exact drag
    // position, while the connected group remains the default Relationships view.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Topology' }).click();
    await expect(topology.locator('[data-topology-status-message]')).toContainText('451 nodes discovered', { timeout: 30_000 });
    await expect(topology.locator('[data-topology-mode] option:checked')).toHaveText('Relationships');
    await expect(topology.locator('[data-topology-canvas] .x6-node')).toHaveCount(connected.length + 1);
    await expect(topologyCard(topology.locator('[data-topology-canvas]'), 'Control')).toHaveCount(1);
    await expect(topologyCard(topology.locator('[data-topology-canvas]'), 'Inventory432')).toHaveCount(1);
    await expect.poll(async () => (await layout())?.positions?.[placedNodeId!]).toEqual(beforeRefresh);
    const reloadedPaletteSearch = topology.locator('[data-topology-palette-query]');
    await reloadedPaletteSearch.fill('Inventory432');
    const reloadedPaletteRow = topology.locator('[data-topology-palette-entries] .nodel-topology-palette-row').filter({ hasText: 'Inventory432' });
    await expect(reloadedPaletteRow.getByRole('button', { name: 'Remove' })).toBeVisible();
    await reloadedPaletteRow.getByRole('button', { name: 'Remove' }).click();
    await expect(topologyCard(topology.locator('[data-topology-canvas]'), 'Inventory432')).toHaveCount(0);
    await topology.locator('[data-topology-mode]').selectOption('focus');
    await topology.locator('[data-topology-focus-direction]').selectOption('both');
    await topology.locator('[data-topology-focus-hops]').selectOption('1');
    await topology.locator('[data-topology-filter]').fill('Control');
    await topology.locator('[data-topology-search-results] [data-topology-search-index]').filter({ hasText: 'Control' }).first().click();
    await expect(topologyCard(topology.locator('[data-topology-canvas]'), 'DSP')).toHaveCount(1);
    await expect(topologyCard(topology.locator('[data-topology-canvas]'), 'Alarm')).toHaveCount(1);
    await expect(topology.locator('[data-topology-canvas] .x6-node').filter({ hasText: /Inventory[0-9]{3}/ })).toHaveCount(0);

    // Capture real connected shapes at both requested viewport sizes.
    await topology.locator('[data-topology-filter]').fill('Control');
    await topology.locator('[data-topology-search-results] [data-topology-search-index]').filter({ hasText: 'Control' }).first().click();
    await topology.locator('[data-topology-mode]').selectOption('focus');
    await topology.locator('[data-topology-focus-direction]').selectOption('both');
    await topology.locator('[data-topology-focus-hops]').selectOption('1');
    await topology.locator('[data-topology-action="fit-component"]').click();
    await topology.locator('[data-topology-action="fit"]').click();
    const evidenceDir = 'build/topology-workspace-evidence';
    await mkdir(evidenceDir, { recursive: true });
    for (const [width, height] of [[1920, 1080], [1366, 768]] as const) {
      await page.setViewportSize({ width, height });
      await topology.locator('[data-topology-action="fit"]').click();
      const visibleConnectedNodes = canvas.locator('.x6-node').filter({ hasText: /Control|DSP|Mixer|Filter|Scope/ });
      await expect(visibleConnectedNodes).toHaveCount(2);
      await expect(topologyCard(canvas, 'Control')).toBeVisible();
      await expect(topologyCard(canvas, 'DSP')).toBeVisible();
      await expect.poll(() => canvas.locator('.x6-edge').count()).toBeGreaterThan(0);
      await expect.poll(async () => {
        const canvasBounds = await canvas.boundingBox();
        const controlBounds = await topologyCard(canvas, 'Control').boundingBox();
        const dspBounds = await topologyCard(canvas, 'DSP').boundingBox();
        return Boolean(canvasBounds && controlBounds && dspBounds
          && controlBounds.x >= canvasBounds.x && controlBounds.x + controlBounds.width <= canvasBounds.x + canvasBounds.width
          && controlBounds.y >= canvasBounds.y && controlBounds.y + controlBounds.height <= canvasBounds.y + canvasBounds.height
          && dspBounds.x >= canvasBounds.x && dspBounds.x + dspBounds.width <= canvasBounds.x + canvasBounds.width
          && dspBounds.y >= canvasBounds.y && dspBounds.y + dspBounds.height <= canvasBounds.y + canvasBounds.height);
      }).toBe(true);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${evidenceDir}/topology-workspace-${width}x${height}.png`, fullPage: true });
    }

    await topology.locator('[data-topology-inspector] [data-topology-action="close-inspector"]').click();
    await expect(inspector).toBeHidden();
    await expect(topology.locator('[data-topology-filter]')).toBeFocused();
    const writes = counters.requests.filter((request) => !isReadOnlyRequest(request));
    expect(writes, JSON.stringify(writes)).toEqual([]);
    expect(counters.requests.every((request) => isReadOnlyRequest(request, '(?:Control|DSP|Mixer|Filter|Scope|Alarm|Output|Recorder|Sensor[0-9]{2}|Inventory[0-9]{3})'))).toBe(true);
    await testInfo.attach('topology-workspace-requests.json', { body: JSON.stringify(counters, null, 2), contentType: 'application/json' });
  });

  test('restores mounted Focus layout after transient drag, exit and an initially empty reload', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-light-desktop', 'Verify physical X6 drag in pinned Chromium.');
    const nodes: FixtureNode[] = [
      { name: 'FocusOwner', bindings: 1, targets: ['FocusTarget'] },
      { name: 'FocusTarget', bindings: 0 },
      { name: 'Unrelated', bindings: 0 }
    ];
    const counters: FixtureCounters = { requests: [], refreshes: 0 };
    await installLocalFixtures(page, nodes, counters, () => nodes, testInfo.project.use.baseURL);
    const topology = await openBuiltTopology(page, false);
    const canvas = topology.locator('[data-topology-canvas]');
    const owner = topologyCard(canvas, 'FocusOwner');
    const target = topologyCard(canvas, 'FocusTarget');
    const mode = topology.locator('[data-topology-mode]');
    const viewport = canvas.locator('.x6-graph-svg-viewport');
    const transform = (card: Locator) => card.getAttribute('transform');
    const drag = async (card: Locator, dx: number, dy: number) => {
      await expect.poll(() => cardIsInCanvas(card, true)).toBe(true);
      const bounds = await card.locator('rect').boundingBox();
      if (!bounds) throw new Error('Drag needs a mounted X6 rectangle');
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 6 });
      await page.mouse.up();
    };
    const layout = () => page.evaluate(() => {
      const entry = Object.entries(localStorage).find(([key]) => key.startsWith('nodel.topology.layout.v2:'));
      return entry ? JSON.parse(String(entry[1])) as {
        positions: Record<string, { x: number; y: number }>; pinnedNodeIds?: string[]; autoPositionedNodeIds?: string[];
        selectedNodeId?: string; focusRestoreState?: { selectedNodeId: string };
      } : undefined;
    });

    await expect(canvas.locator('.x6-edge')).toHaveCount(1);
    await topology.locator('[data-topology-filter]').fill('FocusOwner');
    await topology.getByRole('option', { name: 'FocusOwner · Node', exact: true }).click();
    await topology.locator('[data-topology-action="close-inspector"]').click();
    const original = await transform(owner);
    await drag(owner, -80, 70);
    await expect.poll(() => transform(owner)).not.toBe(original);
    const manual = await transform(owner);
    const normalTarget = await transform(target);
    const normalViewport = await transform(viewport);
    const mountedIdentity = await owner.getAttribute('data-cell-id');
    await expect.poll(async () => (await layout())?.pinnedNodeIds?.some((id) => id.includes('focusowner'))).toBe(true);
    const baseline = (await layout())!;
    expect(baseline.selectedNodeId).toContain('focusowner');

    await mode.selectOption('focus');
    await expect(owner).toHaveAttribute('data-cell-id', mountedIdentity!);
    await expect.poll(() => transform(owner)).not.toBe(manual);
    const focusTarget = await transform(target);
    await drag(target, 55, 45);
    await expect.poll(() => transform(target)).not.toBe(focusTarget);
    await expect.poll(async () => (await layout())?.focusRestoreState?.selectedNodeId).toBe(baseline.selectedNodeId);
    const savedFocus = (await layout())!;
    expect(savedFocus.positions).toEqual(baseline.positions);
    expect(savedFocus.pinnedNodeIds).toEqual(baseline.pinnedNodeIds);
    expect(savedFocus.autoPositionedNodeIds).toEqual(baseline.autoPositionedNodeIds);

    await mode.selectOption('detailed');
    await expect(owner).toHaveAttribute('data-cell-id', mountedIdentity!);
    await expect.poll(() => transform(owner)).toBe(manual);
    await expect.poll(() => transform(target)).toBe(normalTarget);
    await expect.poll(() => transform(viewport)).toBe(normalViewport);
    await mode.selectOption('focus');
    await expect.poll(async () => (await layout())?.focusRestoreState?.selectedNodeId).toBe(baseline.selectedNodeId);

    // Hold network discovery so the real controller publishes its initial empty loading graph.
    let finishDiscovery!: () => void;
    const releaseDiscovery = new Promise<void>((resolve) => { finishDiscovery = resolve; });
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      for (const pattern of ['**/REST', '**/REST/nodeURLs']) {
        await page.route(pattern, async (route) => { await releaseDiscovery; await route.fallback(); });
      }
      await page.getByRole('button', { name: 'Topology' }).click();
      await expect(mode).toHaveValue('focus');
      await expect(topology.locator('[data-topology-status-message]')).toContainText('Reading');
      await expect(canvas.locator('.x6-edge')).toHaveCount(0);
    } finally {
      finishDiscovery();
    }
    await expect(canvas.locator('.x6-edge')).toHaveCount(1);
    await expect(owner).toHaveClass(/\bis-selected\b/);
    await expect.poll(() => transform(owner)).not.toBe(manual);
    await expect.poll(() => transform(target)).toBe(focusTarget);
    await mode.selectOption('detailed');
    await expect.poll(() => transform(owner)).toBe(manual);
    await expect.poll(() => transform(target)).toBe(normalTarget);
    await expect.poll(() => transform(viewport)).toBe(normalViewport);
    await expect(topologyCard(canvas, 'Unrelated')).toHaveCount(0);

    await topology.locator('[data-topology-filter]').fill('Unrelated');
    await topology.getByRole('option', { name: 'Unrelated · Node', exact: true }).click();
    await expect(topologyCard(canvas, 'Unrelated')).toHaveCount(1);
    const paletteRow = topology.locator('.nodel-topology-palette-row').filter({ hasText: 'Unrelated' });
    await paletteRow.getByRole('button', { name: 'Remove' }).click();
    await expect(topologyCard(canvas, 'Unrelated')).toHaveCount(0);
    await expect(paletteRow.getByRole('button', { name: 'Place' })).toBeVisible();
    await topology.locator('[data-topology-action="reset"]').click();
    await mode.selectOption('all-nodes');
    await expect(topologyCard(canvas, 'Unrelated')).toHaveCount(1);
    await mode.selectOption('detailed');
    await expect(topologyCard(canvas, 'Unrelated')).toHaveCount(0);
  });

  test('preserves a placeholder card as its configured target becomes advertised', async ({ page }) => {
    const owner: FixtureNode = { name: 'Owner', bindings: 1, targets: ['Later'] };
    const later: FixtureNode = { name: 'Later', bindings: 0 };
    let laterAdvertised = false;
    const counters: FixtureCounters = { requests: [], refreshes: 0 };
    await installLocalFixtures(page, [owner, later], counters, () => laterAdvertised ? [owner, later] : [owner]);
    const topology = await openBuiltTopology(page);
    const canvas = topology.locator('[data-topology-canvas]');
    const placeholders = topology.locator('[data-topology-display="placeholders"]');
    await placeholders.check();
    const card = topologyCard(canvas, 'Later');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Unresolved reference');
    const placeholderCellIdentity = await card.getAttribute('data-cell-id');
    expect(placeholderCellIdentity).not.toBeNull();
    await expect(canvas.locator(`.x6-node[data-cell-id="${placeholderCellIdentity}"]`)).toHaveCount(1);
    const readModelPosition = async () => page.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) => candidate.startsWith('nodel.topology.layout.v2:'));
      const raw = key && localStorage.getItem(key);
      if (!raw) return undefined;
      const layout = JSON.parse(raw) as { positions?: Record<string, { x: number; y: number }> };
      return Object.entries(layout.positions ?? {}).find(([id]) => id.includes('later'))?.[1];
    });
    await expect.poll(readModelPosition).toBeDefined();
    const placeholderModelPosition = await readModelPosition();

    laterAdvertised = true;
    await topology.locator('[data-topology-action="refresh"]').click();
    await expect.poll(() => counters.refreshes).toBeGreaterThan(1);
    await expect(card).toContainText('Discovered');
    await expect(card).not.toContainText('Unresolved reference');
    const promotedCellIdentity = await card.getAttribute('data-cell-id');
    expect(promotedCellIdentity).toBeTruthy();
    await expect(canvas.locator(`.x6-node[data-cell-id="${promotedCellIdentity}"]`)).toHaveCount(1);
    await expect.poll(readModelPosition).toEqual(placeholderModelPosition);
    const promotedWire = canvas.locator('.x6-edge');
    await expect(promotedWire).toHaveCount(1);
    const wirePathLengths = await promotedWire.locator('path.connection').evaluateAll((paths) =>
      paths.map((path) => (path as SVGPathElement).getTotalLength()));
    expect(wirePathLengths.some((length) => length > 0)).toBe(true);
    await expect(topologyCard(canvas, 'Later')).toHaveCount(1);
    expect(counters.requests.every((request) => isReadOnlyRequest(request, '(?:Owner|Later)'))).toBe(true);
  });

  test('the built topology viewer shows browser-blocked mixed content from a secure host', async ({ page }) => {
    const hostNodes: FixtureNode[] = [];
    const counters: FixtureCounters = { requests: [], refreshes: 0 };
    await installLocalFixtures(page, hostNodes, counters);
    let mixedRequestCount = 0;
    const secureOrigin = 'https://localhost:4173';
    await page.route(`${secureOrigin}/**`, async (route) => {
      const requestUrl = new URL(route.request().url());
      const previewUrl = `${origin}${requestUrl.pathname}${requestUrl.search}`;
      const response = await route.fetch({ url: previewUrl });
      await route.fulfill({ response });
    });
    await page.route(`${secureOrigin}/REST`, async (route) => {
      counters.requests.push({ method: route.request().method(), path: '/REST' });
      await route.fulfill({ json: { nodes: {} } });
    });
    await page.route(`${secureOrigin}/REST/nodeURLs`, async (route) => {
      counters.refreshes += 1;
      counters.requests.push({ method: route.request().method(), path: '/REST/nodeURLs' });
      await route.fulfill({ json: [{ name: 'MixedRemote', address: 'http://mixed-topology.fixture.test/nodes/MixedRemote/' }] });
    });
    await page.route('http://mixed-topology.fixture.test/**', async (route) => {
      mixedRequestCount += 1;
      await route.fulfill({ json: route.request().url().endsWith('/actions') ? { run: { name: 'run' } } : {} });
    });
    await page.goto(`${secureOrigin}/nodes.html`);
    expect(await page.evaluate(() => isSecureContext)).toBe(true);
    await page.getByRole('button', { name: 'Topology' }).click();
    const topology = page.locator('nodel-topology');
    await expect(topology.locator('[data-topology-status-message]')).toContainText('Partial');
    await topology.locator('[data-topology-filter]').fill('MixedRemote');
    await topology.locator('[data-topology-search-results] [data-topology-search-index]').filter({ hasText: 'MixedRemote' }).first().click();
    await expect(topology.locator('[data-topology-inspector]')).toContainText('MixedRemote');
    const fetchOutcome = await page.evaluate(async () => fetch('http://mixed-topology.fixture.test/probe')
      .then(() => 'loaded', () => 'blocked'));
    expect(fetchOutcome).toBe('blocked');
    expect(mixedRequestCount).toBe(0);
  });
});
