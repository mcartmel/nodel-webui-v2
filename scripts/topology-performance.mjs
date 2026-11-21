import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(process.cwd());
const dist = resolve(process.env.TOPOLOGY_DIST ?? process.argv[2] ?? 'dist');
const output = resolve(process.env.TOPOLOGY_PERF_OUTPUT ?? 'build/topology-performance');
const scenario = process.env.TOPOLOGY_SCENARIO ?? '451';
const repeats = Math.max(5, Number(process.env.TOPOLOGY_REFRESHES ?? 5));
const viewport = { width: 1672, height: 941 };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const file = join(path, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  }))).flat();
}

if (!await stat(dist).catch(() => null)) throw new Error(`Dist not found: ${dist}; specify TOPOLOGY_DIST or pass a directory. The harness never builds.`);
const distFiles = await walk(dist);
if (!distFiles.some((file) => file.endsWith('nodes.html'))) throw new Error(`${dist} is not a webui dist (nodes.html missing)`);
const sourceFiles = (await walk(join(root, 'src'))).filter((file) => /\.(ts|tsx|css|html)$/.test(file));
const [sourceMtimes, distMtimes] = await Promise.all([Promise.all(sourceFiles.map(async (file) => (await stat(file)).mtimeMs)), Promise.all(distFiles.map(async (file) => (await stat(file)).mtimeMs))]);
const freshness = { sourceNewest: new Date(Math.max(...sourceMtimes)).toISOString(), distNewest: new Date(Math.max(...distMtimes)).toISOString(), sourceAppearsNewerThanDist: Math.max(...sourceMtimes) > Math.max(...distMtimes), note: 'Timestamp comparison is advisory; verify the chosen dist build provenance. No build was run.' };
let requests = 0;
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(dist, `.${pathname === '/' ? '/nodes.html' : pathname}`);
  if (file !== dist && !file.startsWith(`${dist}${sep}`)) { response.writeHead(403).end(); return; }
  response.setHeader('content-type', mime[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).on('error', () => { if (!response.headersSent) response.writeHead(404); response.end(); }).pipe(response);
});
await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;

function makeFixture(count) {
  const nodes = Array.from({ length: count }, (_, index) => ({ name: `Bench${String(index).padStart(3, '0')}`, bindings: 0, targets: [] }));
  // A connected realistic cluster of 18 within a larger 451-advertised inventory.
  for (let index = 0; index < 18; index += 1) {
    nodes[index].bindings = 2;
    nodes[index].targets = [`Bench${String((index + 1) % 18).padStart(3, '0')}`, `Bench${String((index + 5) % 18).padStart(3, '0')}`];
  }
  return nodes;
}
function object(nodes) { return Object.fromEntries(nodes.map(({ name }) => [name, { name }])); }
function definitions(names) { return Object.fromEntries(names.map((name) => [name, { name }])); }
function nodeData(node) {
  const bindings = Array.from({ length: node.bindings }, (_, index) => `link-${index}`);
  return { actionNames: ['run', 'stop'], properties: Object.fromEntries(bindings.map((name) => [name, { type: 'object' }])), assignments: Object.fromEntries(bindings.map((name, index) => [name, { node: node.targets[index], action: 'run' }])) };
}

async function installRoutes(page, state) {
  await page.route('**/REST', (route) => { requests += 1; return route.fulfill({ json: { nodes: object(state.nodes) } }); });
  await page.route('**/REST/nodeURLs', (route) => { requests += 1; state.refreshCalls += 1; return route.fulfill({ json: [] }); });
  await page.route('**/nodes/**/REST/**', (route) => {
    requests += 1;
    const url = new URL(route.request().url());
    const name = decodeURIComponent(url.pathname.split('/')[2] ?? '');
    const node = state.nodes.find((item) => item.name === name);
    if (!node) return route.fulfill({ status: 404, json: {} });
    const payload = nodeData(node);
    const endpoint = url.pathname.split('/REST/').at(-1);
    if (endpoint === 'actions') return route.fulfill({ json: definitions(payload.actionNames) });
    if (endpoint === 'events') return route.fulfill({ json: {} });
    if (endpoint === 'remote/schema') return route.fulfill({ json: { type: 'object', properties: { actions: { type: 'object', properties: payload.properties }, events: { type: 'object', properties: {} } } } });
    if (endpoint === 'remote') return route.fulfill({ json: { actions: payload.assignments, events: {} } });
    return route.fulfill({ status: 404, json: {} });
  });
}

function snapshot(page) {
  return page.evaluate(() => {
    const identity = window.__topologyIdentity ??= { refs: new WeakMap(), next: 1 };
    const id = (value) => {
      if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
      if (!identity.refs.has(value)) identity.refs.set(value, identity.next++);
      return identity.refs.get(value);
    };
    const host = document.querySelector('nodel-topology');
    const adapter = host?.canvas;
    const graph = adapter?.graph;
    const nodes = graph?.getNodes?.() ?? [];
    const edges = graph?.getEdges?.() ?? [];
    const map = adapter?.nodeIds;
    const firstDomain = map instanceof Map ? map.keys().next().value : undefined;
    const firstOpaque = firstDomain === undefined ? undefined : map.get(firstDomain);
    const firstCell = firstOpaque ? graph?.getCellById(firstOpaque) : undefined;
    const firstDom = host?.querySelector('.x6-node');
    const edgeMap = adapter?.wireIds;
    const firstWireDomain = edgeMap instanceof Map ? edgeMap.keys().next().value : undefined;
    const firstWireOpaque = firstWireDomain === undefined ? undefined : edgeMap.get(firstWireDomain);
    const firstWire = firstWireOpaque ? graph?.getCellById(firstWireOpaque) : undefined;
    const nodeIdentities = map instanceof Map ? [...map].flatMap(([domain, opaque]) => {
      const cell = graph?.getCellById(opaque);
      return cell ? [{ domain, cell: id(cell), dom: id(graph?.findViewByCell(cell)?.container) }] : [];
    }) : [];
    const wireIdentities = edgeMap instanceof Map ? [...edgeMap].flatMap(([domain, opaque]) => {
      const cell = graph?.getCellById(opaque);
      return cell ? [{ domain, cell: id(cell), dom: id(graph?.findViewByCell(cell)?.container) }] : [];
    }) : [];
    return { x6Model: { nodes: nodes.length, wires: edges.length }, mounted: { nodes: host?.querySelectorAll('[data-topology-canvas] .x6-node').length ?? 0, wires: host?.querySelectorAll('[data-topology-canvas] .x6-edge').length ?? 0 }, dom: { all: document.querySelectorAll('*').length, svg: document.querySelectorAll('svg').length, svgElements: document.querySelectorAll('svg *').length }, identity: { nodeDomain: firstDomain, nodeCell: id(firstCell), nodeDom: id(firstDom), wireDomain: firstWireDomain, wireCell: id(firstWire), wireDom: id(host?.querySelector('.x6-edge')), nodes: nodeIdentities, wires: wireIdentities }, status: host?.querySelector('[data-topology-status-message]')?.textContent?.trim() ?? '' };
  });
}

function compareIdentities(before, after) {
  const compare = (oldItems, newItems) => {
    const oldByDomain = new Map(oldItems.map((item) => [item.domain, item]));
    const newByDomain = new Map(newItems.map((item) => [item.domain, item]));
    let retainedCells = 0;
    let retainedDom = 0;
    for (const [domain, current] of newByDomain) {
      const previous = oldByDomain.get(domain);
      if (previous?.cell && previous.cell === current.cell) retainedCells += 1;
      if (previous?.dom && previous.dom === current.dom) retainedDom += 1;
    }
    return { before: oldItems.length, after: newItems.length, retainedCells, retainedDom, replacedCells: Math.min(oldItems.length, newItems.length) - retainedCells, replacedDom: Math.min(oldItems.length, newItems.length) - retainedDom, added: [...newByDomain.keys()].filter((domain) => !oldByDomain.has(domain)).length, removed: [...oldByDomain.keys()].filter((domain) => !newByDomain.has(domain)).length };
  };
  return { nodes: compare(before.nodes, after.nodes), wires: compare(before.wires, after.wires) };
}

async function settled(page, expectedNodes) {
  await page.waitForFunction((count) => {
    const host = document.querySelector('nodel-topology');
    const status = host?.querySelector('[data-topology-status-message]')?.textContent ?? '';
    const graph = host?.canvas?.graph;
    return host?.update?.phase === 'idle' && !/reading|loading|discovering/i.test(status)
      && graph?.getNodes?.().length === count
      && host.querySelectorAll('[data-topology-canvas] .x6-node').length === count;
  }, expectedNodes, { timeout: 120_000 });
  await page.evaluate(() => new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))));
  await delay(300);
}
async function idlePaint(page) {
  await page.waitForFunction(() => document.querySelector('nodel-topology')?.update?.phase === 'idle', null, { timeout: 120_000 });
  await page.evaluate(() => new Promise((resolvePromise) => requestAnimationFrame(() => requestAnimationFrame(resolvePromise))));
  await delay(300);
}

async function metrics(cdp) {
  const { metrics: rows } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(rows.map(({ name, value }) => [name, value]));
}
function delta(after, before, key) { return Number(((after[key] ?? 0) - (before[key] ?? 0)).toFixed(6)); }
async function memory(page, cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const dom = await page.evaluate(() => ({ nodes: document.querySelectorAll('*').length, svg: document.querySelectorAll('svg').length, svgElements: document.querySelectorAll('svg *').length }));
  return { dom, jsHeapUsedBytesAfterGC: heap.usedSize, jsHeapTotalBytes: heap.totalSize };
}
async function profile(cdp, fn) {
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await cdp.send('Profiler.start');
  const before = await metrics(cdp);
  const start = performance.now();
  await fn();
  const wallMs = performance.now() - start;
  const after = await metrics(cdp);
  const { profile: cpuProfile } = await cdp.send('Profiler.stop');
  const samples = cpuProfile.samples ?? [];
  const counts = new Map();
  for (const id of samples) counts.set(id, (counts.get(id) ?? 0) + 1);
  const nodes = new Map(cpuProfile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of cpuProfile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const stacks = [...counts].map(([id, sampleCount]) => {
    const stack = [];
    for (let current = id; current !== undefined; current = parents.get(current)) {
      const frame = nodes.get(current)?.callFrame;
      if (frame) stack.push(`${frame.functionName || '(anonymous)'}${frame.url ? ` @ ${frame.url.split('/').at(-1)}` : ''}`);
    }
    return { sampleCount, leaf: stack[0], stack: stack.slice(0, 7).reverse() };
  }).sort((a, b) => b.sampleCount - a.sampleCount).slice(0, 20);
  return { wallMs: Number(wallMs.toFixed(2)), rendererTaskDurationSeconds: delta(after, before, 'TaskDuration'), rendererScriptDurationSeconds: delta(after, before, 'ScriptDuration'), cpuSamples: samples.length, topSampledStacks: stacks };
}
async function traceTimeline(cdp, fn) {
  const completed = new Promise((resolvePromise) => cdp.once('Tracing.tracingComplete', resolvePromise));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing', transferMode: 'ReturnAsStream' });
  await fn();
  await cdp.send('Tracing.end');
  const { stream } = await completed;
  let traceText = '';
  let eof = false;
  while (!eof) {
    const chunk = await cdp.send('IO.read', { handle: stream, size: 1024 * 1024 });
    traceText += chunk.data;
    eof = Boolean(chunk.eof);
  }
  await cdp.send('IO.close', { handle: stream });
  const events = JSON.parse(traceText).traceEvents ?? [];
  const counts = new Map();
  for (const event of events) {
    if (event.ph !== 'X' || !Number.isFinite(event.dur)) continue;
    const key = `${event.cat ?? ''}:${event.name ?? ''}`;
    const value = counts.get(key) ?? { count: 0, durationMs: 0 };
    value.count += 1;
    value.durationMs += event.dur / 1000;
    counts.set(key, value);
  }
  return [...counts].map(([event, value]) => ({ event, count: value.count, durationMs: Number(value.durationMs.toFixed(3)) }))
    .sort((a, b) => b.durationMs - a.durationMs).slice(0, 30);
}

const browser = await chromium.launch({ headless: true, args: ['--disable-background-timer-throttling'] });
const runResults = [];
try {
  const count = scenario === 'dense100' ? 100 : scenario === 'dense1065' ? 100 : 451;
  const initialNodes = makeFixture(count);
  if (scenario === 'dense1065') for (let index = 0; index < count; index += 1) {
    initialNodes[index].bindings = index < 65 ? 11 : 10;
    initialNodes[index].targets = Array.from({ length: initialNodes[index].bindings }, (_, edge) => `Bench${String((index + edge + 1) % count).padStart(3, '0')}`);
  }
  for (const mode of ['detailed', 'all-nodes']) {
    const state = { nodes: structuredClone(initialNodes), refreshCalls: 0 };
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: 'light', serviceWorkers: 'block' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const inspected = new Set();
    const pageErrors = [];
    const blockedRequests = [];
    page.on('pageerror', () => pageErrors.push('page-error'));
    await context.route('**/*', (route) => {
      let url;
      try { url = new URL(route.request().url()); } catch { blockedRequests.push('invalid-url'); return route.abort(); }
      if (url.origin !== origin || url.username || url.password || url.hash) {
        blockedRequests.push(`${url.origin}${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.enable');
    await page.addInitScript(() => {
      window.__topologyPerf = { longTasks: [], eventLatency: [], rafDeltas: [], rafLast: 0 };
      try { new PerformanceObserver((list) => window.__topologyPerf.longTasks.push(...list.getEntries().map((entry) => entry.duration))).observe({ type: 'longtask', buffered: true }); } catch { /* Browser may not expose Long Tasks. */ }
      try { new PerformanceObserver((list) => window.__topologyPerf.eventLatency.push(...list.getEntries().map((entry) => ({ name: entry.name, duration: entry.duration, processingStart: entry.processingStart, startTime: entry.startTime })))).observe({ type: 'event', buffered: true, durationThreshold: 16 }); } catch { /* Browser may not expose Event Timing. */ }
      const tick = (time) => { if (window.__topologyPerf.rafLast) window.__topologyPerf.rafDeltas.push(time - window.__topologyPerf.rafLast); window.__topologyPerf.rafLast = time; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    page.on('request', (request) => {
      const match = request.url().match(/\/nodes\/([^/]+)\/REST\/actions(?:\?|$)/);
      if (match) inspected.add(decodeURIComponent(match[1]));
    });
    await installRoutes(page, state);
    const start = performance.now();
    const topology = page.locator('nodel-topology');
    const initialRender = await profile(cdp, async () => {
      await page.goto(`${origin}/nodes.html`, { waitUntil: 'domcontentloaded' });
      await topology.waitFor({ state: 'attached', timeout: 30_000 });
      await page.getByRole('button', { name: 'Topology' }).click();
      await topology.locator('[data-topology-status]').waitFor({ state: 'visible', timeout: 120_000 });
      // Canonical built-topology fixture contract: the status host and view-mode select
      // are exposed by openBuiltTopology() in e2e/tests/topology-redesign-step7.spec.ts.
      await topology.locator('[data-topology-mode]').selectOption(mode, { timeout: 30_000 });
      // Inventory mounts all-nodes immediately; relationships renders the connected subgraph.
      await page.waitForFunction(() => !!document.querySelector('nodel-topology [data-topology-canvas] .x6-node'), null, { timeout: 120_000 });
      await settled(page, mode === 'all-nodes' ? count : 18);
    });
    const initialDiscoveryToSettledMs = performance.now() - start;
    // Exhaust rotating 32-owner action inventory first. Keep this separate from the stable-refresh series.
    const inventoryStart = performance.now();
    while (inspected.size < count) {
      const prior = state.refreshCalls;
      const requested = page.waitForResponse((response) => new URL(response.url()).pathname === '/REST/nodeURLs');
      await topology.locator('[data-topology-action="refresh"]').click();
      await requested;
      await idlePaint(page);
      await delay(150);
      if (state.refreshCalls === prior) throw new Error('Refresh did not reach local fixture');
      if (performance.now() - inventoryStart > 180_000) throw new Error(`Rotating inventory did not complete: ${inspected.size}/${count}`);
    }
    await settled(page, mode === 'all-nodes' ? count : 18);
    const inventoryCompletionMs = performance.now() - inventoryStart;
    const initialInventoryOwnersRead = inspected.size;

    const otherMode = mode === 'all-nodes' ? 'detailed' : 'all-nodes';
    const modeSwitches = [];
    for (const [from, to, expected] of [[mode, otherMode, otherMode === 'all-nodes' ? count : 18], [otherMode, mode, mode === 'all-nodes' ? count : 18]]) {
      const switchProfile = await profile(cdp, async () => {
        await topology.locator('[data-topology-mode]').selectOption(to);
        await settled(page, expected);
      });
      modeSwitches.push({ from, to, ...switchProfile });
    }

    const baseline = await snapshot(page);
    const noOpRefreshes = [];
    const noOpBeforeMemory = await memory(page, cdp);
    for (let index = 0; index < repeats; index += 1) {
      const observerStart = await page.evaluate(() => ({ longTasks: window.__topologyPerf.longTasks.length, raf: window.__topologyPerf.rafDeltas.length }));
      let refreshWallMs = 0;
      const runRefresh = async () => {
        const refreshStarted = performance.now();
        const refreshResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/REST/nodeURLs');
        await topology.locator('[data-topology-action="refresh"]').click();
        await refreshResponse;
        await idlePaint(page);
        refreshWallMs = performance.now() - refreshStarted;
      };
      let renderingTimeline;
      const sample = index === 0
        ? await profile(cdp, async () => { renderingTimeline = await traceTimeline(cdp, runRefresh); })
        : await profile(cdp, runRefresh);
      sample.wallMs = Number(refreshWallMs.toFixed(2));
      const after = await snapshot(page);
      const observer = await page.evaluate((startAt) => {
        const longTasks = window.__topologyPerf.longTasks.slice(startAt.longTasks);
        const frames = window.__topologyPerf.rafDeltas.slice(startAt.raf);
        return { longTaskCount: longTasks.length, maxLongTaskMs: Math.max(0, ...longTasks), rafFrames: frames.length, framesOver25ms: frames.filter((value) => value > 25).length };
      }, observerStart);
      noOpRefreshes.push({ iteration: index + 1, ...sample, ...(renderingTimeline ? { renderingTimeline } : {}), ...observer, identityRetained: { nodeCell: baseline.identity.nodeCell === after.identity.nodeCell, nodeDom: baseline.identity.nodeDom === after.identity.nodeDom, wireCell: baseline.identity.wireCell === after.identity.wireCell, wireDom: baseline.identity.wireDom === after.identity.wireDom }, graphIdentityDelta: compareIdentities(baseline.identity, after.identity), counts: after });
    }
    const stableMemory = await memory(page, cdp);

    const idleLongTasksBefore = await page.evaluate(() => window.__topologyPerf.longTasks.splice(0));
    const idleBefore = await metrics(cdp);
    await delay(5000);
    const idleAfter = await metrics(cdp);
    const idleLongTasks = await page.evaluate(() => window.__topologyPerf.longTasks.splice(0));
    const idle = { intervalMs: 5000, rendererTaskDurationSeconds: delta(idleAfter, idleBefore, 'TaskDuration'), rendererScriptDurationSeconds: delta(idleAfter, idleBefore, 'ScriptDuration'), longTaskCount: idleLongTasks.length, maxLongTaskMs: Math.max(0, ...idleLongTasks), discardedPriorLongTasks: idleLongTasksBefore.length };

    const canvas = topology.locator('[data-topology-canvas]');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Topology canvas has no visible bounds for interaction profile');
    const visibleNode = await canvas.locator('.x6-node').first().boundingBox();
    if (!visibleNode) throw new Error('No mounted card available for drag interaction');
    const eventStart = await page.evaluate(() => ({ longTasks: window.__topologyPerf.longTasks.length, latencies: window.__topologyPerf.eventLatency.length, raf: window.__topologyPerf.rafDeltas.length }));
    const interaction = await profile(cdp, async () => {
      await page.mouse.move(visibleNode.x + visibleNode.width / 2, visibleNode.y + visibleNode.height / 2);
      await page.mouse.down();
      await page.mouse.move(visibleNode.x + visibleNode.width / 2 + 55, visibleNode.y + visibleNode.height / 2 + 35, { steps: 6 });
      await page.mouse.up();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -480);
      await page.keyboard.up('Control');
      await delay(750);
    });
    const interactionMetrics = await page.evaluate((initial) => {
      const raf = window.__topologyPerf.rafDeltas.slice(initial.raf);
      const longs = window.__topologyPerf.longTasks.slice(initial.longTasks);
      const events = window.__topologyPerf.eventLatency.slice(initial.latencies);
      return { longTaskCount: longs.length, maxLongTaskMs: Math.max(0, ...longs), inputEvents: events.length, maxEventDurationMs: Math.max(0, ...events.map((entry) => entry.duration)), rafFrames: raf.length, meanFrameIntervalMs: raf.length ? raf.reduce((sum, value) => sum + value, 0) / raf.length : null, framesOver25ms: raf.filter((value) => value > 25).length, framesOver50ms: raf.filter((value) => value > 50).length };
    }, eventStart);

    // One separate real inventory addition; no-op refreshes above remain uncontaminated.
    const changedNode = { name: 'BenchAdded', bindings: 0, targets: [] };
    state.nodes.push(changedNode);
    state.nodes[0].bindings += 1;
    state.nodes[0].targets.push(changedNode.name);
    const changedStarted = performance.now();
    const changedResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/REST/nodeURLs');
    const changedRefresh = await profile(cdp, async () => {
      await topology.locator('[data-topology-action="refresh"]').click();
      await changedResponse;
      await idlePaint(page);
    });
    let changedAfter = await snapshot(page);
    // Assignment reads rotate in bounded batches. Keep refreshing only in this
    // separate genuine-change phase until both the new card and its new wire arrive.
    const additionConvergence = [];
    const additionTarget = mode === 'all-nodes' ? count + 1 : 19;
    const additionVisible = () => changedAfter.x6Model.nodes >= additionTarget && changedAfter.x6Model.wires > baseline.x6Model.wires;
    for (let cycle = 0; !additionVisible() && cycle < 20; cycle += 1) {
      const response = page.waitForResponse((item) => new URL(item.url()).pathname === '/REST/nodeURLs');
      const timing = await profile(cdp, async () => {
        await topology.locator('[data-topology-action="refresh"]').click();
        await response;
        await idlePaint(page);
      });
      changedAfter = await snapshot(page);
      additionConvergence.push({ cycle: cycle + 1, ...timing, counts: changedAfter });
    }
    const teardownBefore = await memory(page, cdp);
    await page.getByRole('button', { name: 'Locals' }).click().catch(() => {});
    await delay(300);
    const hiddenTopology = await memory(page, cdp);
    await topology.evaluate((element) => element.remove());
    await delay(500);
    const hiddenTeardown = await memory(page, cdp);
    runResults.push({ scenario, mode, advertisedNodes: count, connectedNodes: 18, initialDiscoveryToSettledMs: Number(initialDiscoveryToSettledMs.toFixed(2)), initialRenderProfile: initialRender, inventoryCompletionMs: Number(inventoryCompletionMs.toFixed(2)), inventoryOwnersRead: initialInventoryOwnersRead, modeSwitches, stableRefreshes: noOpRefreshes, stableMemoryBefore: noOpBeforeMemory, stableMemoryAfter: stableMemory, idle, interaction: { ...interaction, ...interactionMetrics }, genuineAddition: { rendered: additionVisible(), wallMs: Number((performance.now() - changedStarted).toFixed(2)), profile: changedRefresh, identityRetained: { nodeCell: baseline.identity.nodeCell === changedAfter.identity.nodeCell, nodeDom: baseline.identity.nodeDom === changedAfter.identity.nodeDom, wireCell: baseline.identity.wireCell === changedAfter.identity.wireCell, wireDom: baseline.identity.wireDom === changedAfter.identity.wireDom }, graphIdentityDelta: compareIdentities(baseline.identity, changedAfter.identity), counts: changedAfter, convergenceRefreshes: additionConvergence }, memory: { beforeTeardown: teardownBefore, afterHidden: hiddenTopology, afterTeardown: hiddenTeardown }, pageRequests: requests, blockedRequests, pageErrors, finalBaseline: baseline });
    await context.close();
  }
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), machine: { platform: process.platform, arch: process.arch, cpus: (await import('node:os')).cpus().map((cpu) => cpu.model).filter((value, index, all) => all.indexOf(value) === index), cpuCount: (await import('node:os')).availableParallelism?.() ?? (await import('node:os')).cpus().length, memoryBytes: (await import('node:os')).totalmem(), node: process.version }, browser: { name: 'Chromium', version: browser.version(), headless: true, viewport, deviceScaleFactor: 1 }, fixture: { name: scenario, advertisedNodes: scenario.startsWith('dense') ? 100 : 451, connectedNodes: scenario.startsWith('dense') ? 100 : 18, stableRefreshes: repeats }, dist: { path: dist, ...freshness }, methodology: { noLiveReads: true, allNodelRequestsIntercepted: true, taskDuration: 'CDP Performance TaskDuration delta; renderer main-thread task time proxy, not isolated CPU process time', cpuProfile: 'CDP sampling profiler at 1ms; frames are sampled stacks, browser render/layout may appear separately', memory: 'CDP V8 heap after explicit GC plus DOM counts at checkpoints; not total renderer/process memory', settle: 'status leaves Reading/Loading, expected graph count, two animation frames, 300ms quiescence', instrumentation: 'long-task/Event Timing observers and RAF delta sampler run throughout; DOM/model census only at snapshots, not during idle', limitations: 'headless Chromium; machine load, font/GPU/browser versions affect results; Event Timing may omit short interactions; model introspection is adapter-specific; timestamps only advisory for build freshness' }, runs: runResults };
    await mkdir(output, { recursive: true });
    const reportPath = join(output, `topology-${scenario}-${Date.now()}.json`);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const summary = runResults.map((run) => ({ mode: run.mode, initialMs: run.initialDiscoveryToSettledMs, stableRefreshMedianMs: median(run.stableRefreshes.map((entry) => entry.wallMs)), idleTaskSeconds: run.idle.rendererTaskDurationSeconds, nodes: run.finalBaseline.x6Model.nodes, wires: run.finalBaseline.x6Model.wires, postGcHeapBytes: run.stableMemoryAfter.jsHeapUsedBytesAfterGC, interactionLongTasks: run.interaction.longTaskCount, interactionMaxLongTaskMs: run.interaction.maxLongTaskMs }));
  console.log(JSON.stringify({ report: reportPath, distFreshness: freshness, summary }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
}

function median(values) { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; }
