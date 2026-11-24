import { chromium } from '@playwright/test';
import { build } from 'vite';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Opt-in, loopback-only A/B evidence. No live host or external network.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const baselineRoot = '/tmp/kilo/konva-local-first-preview-baseline';
const repeats = Number(process.env.KONVA_ACCEPTANCE_REPEATS ?? 3);
// A filtered smoke run must never replace the decision matrix or its images.
const output = resolve(root, 'artifacts/konva-local/preview-acceptance',
  process.env.KONVA_ACCEPTANCE_SCENARIOS || repeats !== 3 ? `smoke-${Date.now()}-${process.pid}` : '.');
const viewports = [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }];
const budgets = [0, 1500, 3000];
const variants = [];
const rows = [];
const sourceFiles = [
  'topology-canvas.html', 'src/experiments/konva-canvas/style.css',
  'src/experiments/konva-canvas/main.ts', 'src/experiments/konva-canvas/fixture.ts',
  'src/experiments/konva-canvas/preview-coordinator.ts', 'src/experiments/konva-canvas/startup-shell.ts',
  'src/experiments/konva-canvas/local-placement.ts', 'src/experiments/konva-canvas/local-enrichment-projection.ts',
  'src/experiments/konva-canvas/preview-entry.ts', 'src/experiments/konva-canvas/card-footprint.ts'
];
const sourceHashes = {};
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'cache-control': 'no-store' } });

async function serve(directory) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const file = resolve(directory, `.${url.pathname === '/' ? '/topology-canvas.html' : url.pathname}`);
    const name = relative(directory, file);
    if (name === '..' || name.startsWith(`..${sep}`)) { response.writeHead(403).end(); return; }
    void readFile(file).then((content) => {
      response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(content);
    }, () => response.writeHead(404).end());
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => server.close(done)) };
}

async function buildCandidate(budget) {
  const outDir = `/tmp/kilo/konva-preview-acceptance-${budget}`;
  await build({ configFile: resolve(root, 'vite.konva.config.ts'), mode: 'konva-preview-test', root,
    build: { outDir, emptyOutDir: true }, define: { 'import.meta.env.VITE_KONVA_PREVIEW_MS': JSON.stringify(String(budget)) } });
  return outDir;
}

function fixture(scenario, origin) {
  const small = scenario === 'small';
  const deadlineProbe = scenario === 'deadline';
  const large = !small;
  const local = deadlineProbe ? [] : small ? ['Anchor', 'Peer'] : ['Anchor', 'Peer', 'Isolated', 'LocalOnly'];
  const refs = deadlineProbe ? [] : small ? ['TargetOne'] : Array.from({ length: 100 }, (_, i) => `Direct${String(i).padStart(3, '0')}`);
  const ads = deadlineProbe ? Array.from({ length: 450 }, (_, i) => `Ad${String(i).padStart(3, '0')}`)
    : small ? ['AdOne', 'AdTwo'] : scenario === 'large-settled' ? [] : Array.from({ length: 450 }, (_, i) => `Ad${String(i).padStart(3, '0')}`);
  const bindings = {
    Anchor: { actions: Object.fromEntries([['Call peer', { node: 'Peer', action: 'Respond' }], ...refs.map((name, i) => [`Direct ${i}`, { node: name, action: 'Respond' }])]) },
    Peer: { events: { 'Peer ready': { node: 'Anchor', event: 'Ready' } } }, Isolated: {}, LocalOnly: {}
  };
  return { small, large, local, refs, ads, nodes: Object.fromEntries(local.map((name) => [name, {}])), bindings, origin };
}

const INSPECTOR = (expected) => {
  const observationStartMs = performance.now();
  const state = window;
  const stage = state.Konva?.stages?.[0];
  if (!stage) return { ready: false, readable: false, reason: 'stage-unavailable', cards: 0,
    visibleCardCount: 0, readableCardCount: 0, orphanCardCount: 0, wireCount: 0, tracedWireCount: 0, readableWireCount: 0,
    wireRows: [], hiddenTracedWireCount: 0, hiddenUntracedWireCount: 0, layers: [], classCounts: {}, shapeCount: 0, overlapPairs: [] };
  const list = (node) => {
    const result = [node];
    const children = typeof node.getChildren === 'function' ? node.getChildren() : [];
    for (const child of children) result.push(...list(child));
    return result;
  };
  const descendants = list(stage);
  const classCounts = {};
  for (const shape of descendants) classCounts[shape.getClassName()] = (classCounts[shape.getClassName()] ?? 0) + 1;
  const cards = stage.find('.topology-card');
  const stageRect = stage.content.getBoundingClientRect();
  const clip = { left: Math.max(0, stageRect.left), top: Math.max(0, stageRect.top), right: Math.min(innerWidth, stageRect.right), bottom: Math.min(innerHeight, stageRect.bottom) };
  for (let parent = stage.content.parentElement; parent; parent = parent.parentElement) {
    const rect = parent.getBoundingClientRect(), style = getComputedStyle(parent);
    if (style.overflowX !== 'visible') { clip.left = Math.max(clip.left, rect.left); clip.right = Math.min(clip.right, rect.right); }
    if (style.overflowY !== 'visible') { clip.top = Math.max(clip.top, rect.top); clip.bottom = Math.min(clip.bottom, rect.bottom); }
  }
  const inside = ({ x, y }) => x >= clip.left && x <= clip.right && y >= clip.top && y <= clip.bottom;
  const pointToScreen = (point) => ({ x: stageRect.left + point.x * stageRect.width / stage.width(), y: stageRect.top + point.y * stageRect.height / stage.height() });
  const boundsInStage = (node) => {
    const local = node.getClientRect({ skipTransform: true, skipStroke: true, skipShadow: true });
    const transform = node.getAbsoluteTransform(stage);
    const a = transform.point({ x: local.x, y: local.y });
    const b = transform.point({ x: local.x + local.width, y: local.y + local.height });
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  };
  const screenBounds = (node) => {
    const local = node.getClientRect({ skipTransform: true });
    const transform = node.getAbsoluteTransform();
    const points = [transform.point({ x: local.x, y: local.y }), transform.point({ x: local.x + local.width, y: local.y }),
      transform.point({ x: local.x, y: local.y + local.height }), transform.point({ x: local.x + local.width, y: local.y + local.height })].map(pointToScreen);
    return { left: Math.min(...points.map(({ x }) => x)), top: Math.min(...points.map(({ y }) => y)),
      right: Math.max(...points.map(({ x }) => x)), bottom: Math.max(...points.map(({ y }) => y)) };
  };
  const cardRows = cards.map((card) => {
    const title = card.find('Text').find((text) => text.text() && text.y() <= 28 && !['Local', 'Remote'].includes(text.text()));
    const body = card.findOne('Rect');
    const r = boundsInStage(body);
    const cardScreenRect = screenBounds(body);
    const titleRect = title ? boundsInStage(title) : undefined;
    const titleScreenRect = title ? screenBounds(title) : undefined;
    const visible = cardScreenRect.right > clip.left && cardScreenRect.left < clip.right && cardScreenRect.bottom > clip.top && cardScreenRect.top < clip.bottom;
    const readableTitle = Boolean(titleScreenRect && titleScreenRect.right - titleScreenRect.left >= 16 && titleScreenRect.bottom - titleScreenRect.top >= 10 &&
      titleScreenRect.left >= clip.left && titleScreenRect.right <= clip.right && titleScreenRect.top >= clip.top && titleScreenRect.bottom <= clip.bottom);
    const sockets = card.find('Circle').filter(shape => shape.isVisible() && /^(socket-|overflow-takeoff-)/.test(shape.name())).map(socket => ({ id: socket.name(), point: socket.getAbsoluteTransform(stage).point({ x: 0, y: 0 }) }));
    return { id: card.id(), title: title?.text() ?? '', rect: r, screenRect: cardScreenRect, titleRect: titleRect && { ...titleRect, screen: titleScreenRect }, visible, readableTitle, sockets };
  });
  const wireRows = stage.find('.topology-wire').filter((wire) => wire.visible()).map((wire) => {
    const curves = [];
    let start;
    const context = { strokeStyle: '', fillStyle: '', lineWidth: 1, beginPath() { start = undefined; },
      moveTo(x, y) { start = { x, y }; }, bezierCurveTo(x1, y1, x2, y2, x, y) { if (start) { curves.push({ start, c1: { x: x1, y: y1 }, c2: { x: x2, y: y2 }, end: { x, y } }); start = { x, y }; } },
      lineTo() {}, closePath() {}, stroke() {}, fill() {} };
    wire.getSceneFunc().call(wire, context, wire);
    const transform = wire.getAbsoluteTransform(stage);
    for (const curve of curves) for (const key of Object.keys(curve)) curve[key] = transform.point(curve[key]);
    const first = curves[0]?.start, last = curves.at(-1)?.end;
    const logical = JSON.parse(String.fromCharCode(...wire.id().slice(2).match(/.{4}/g).map(hex => parseInt(hex, 16))));
    const binding = expected[JSON.stringify(logical)];
    const nearest = (point, endpoint) => {
      let best;
      for (const card of cardRows.filter(card => card.title === endpoint?.title)) for (const socket of card.sockets) {
        if (socket.id !== `socket-${card.id}-${endpoint.portId}` && socket.id !== `overflow-takeoff-${endpoint.role}`) continue;
        const distance = Math.hypot(point.x - socket.point.x, point.y - socket.point.y);
        if (!best || distance < best.distance) best = { cardId: card.id, cardTitle: card.title, socketId: socket.id, point: socket.point, distance };
      }
      return best;
    };
    const source = first ? nearest(first, binding?.[0]) : undefined;
    const target = last ? nearest(last, binding?.[1]) : undefined;
    const traced = Boolean(source && target && source.distance < 1 && target.distance < 1 && source.cardId !== target.cardId);
    let lengthWorld = 0;
    const samples = [];
    for (const curve of curves) {
      let previous = curve.start;
      samples.push(previous);
      for (let n = 1; n <= 32; n++) {
        const t = n / 32, u = 1 - t;
        const point = { x: u ** 3 * curve.start.x + 3 * u * u * t * curve.c1.x + 3 * u * t * t * curve.c2.x + t ** 3 * curve.end.x,
          y: u ** 3 * curve.start.y + 3 * u * u * t * curve.c1.y + 3 * u * t * t * curve.c2.y + t ** 3 * curve.end.y };
        lengthWorld += Math.hypot(point.x - previous.x, point.y - previous.y); previous = point; samples.push(point);
      }
    }
    const hiddenByCards = cardRows.filter((card) => card.id !== source?.cardId && card.id !== target?.cardId &&
      samples.some((point) => point.x > card.rect.x && point.x < card.rect.x + card.rect.width && point.y > card.rect.y && point.y < card.rect.y + card.rect.height)).map(({ id, title }) => ({ id, title }));
    return { id: wire.id(), ownerId: wire.getAttr('ownerId'), bindingKind: wire.getAttr('bindingKind'), bindingAlias: wire.getAttr('bindingAlias'),
      lengthWorld, source: source && { cardId: source.cardId, cardTitle: source.cardTitle, socketId: source.socketId, distance: source.distance },
      target: target && { cardId: target.cardId, cardTitle: target.cardTitle, socketId: target.socketId, distance: target.distance },
      traced, hiddenByCards, hullInsideViewport: Boolean(curves.length && curves.every(curve => Object.values(curve).every(point => inside(pointToScreen(stage.getAbsoluteTransform().point(point)))))) };
  });
  const layers = stage.getLayers().map((layer) => {
    const canvas = layer.getNativeCanvasElement();
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || !canvas.width || !canvas.height || !canvas.getClientRects().length) return { name: layer.name(), visible: false, nonTransparentSamples: 0, sampledPixels: 0 };
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonTransparentSamples = 0, sampledPixels = 0;
    const stepX = Math.max(1, Math.floor(canvas.width / 256)), stepY = Math.max(1, Math.floor(canvas.height / 256));
    for (let y = 0; y < canvas.height; y += stepY) for (let x = 0; x < canvas.width; x += stepX) {
      sampledPixels++;
      if (data[(y * canvas.width + x) * 4 + 3]) nonTransparentSamples++;
    }
    return { name: layer.name(), visible: true, nonTransparentSamples, sampledPixels };
  });
  const visibleCards = cardRows.filter((card) => card.visible);
  const readableCards = cardRows.filter((card) => card.readableTitle);
  const readableWires = wireRows.filter((wire) => wire.traced && wire.hullInsideViewport && !wire.hiddenByCards.length && visibleCards.some((card) => card.id === wire.source?.cardId && card.readableTitle) && visibleCards.some((card) => card.id === wire.target?.cardId && card.readableTitle));
  const dedicatedViewportWireCount = readableWires.filter(wire => [wire.source, wire.target].every(endpoint => endpoint.socketId.startsWith('socket-'))).length;
  const readable = readableCards.length >= 2 && readableWires.length > 0 && ['cards', 'wires'].every(name => layers.some(layer => layer.name === name && layer.nonTransparentSamples > 0));
  const summary = document.querySelector('[data-topology-short-summary]')?.textContent ?? '';
  const detailedSummary = document.querySelector('[data-fixture-summary]')?.textContent ?? '';
  const header = document.querySelector('.experiment-header');
  const headerRect = header?.getBoundingClientRect();
  const titleRect = header?.firstElementChild?.getBoundingClientRect();
  const controls = header?.querySelector('.view-controls');
  const controlsRect = controls?.getBoundingClientRect();
  const summaryElement = header?.querySelector('[data-topology-short-summary]');
  const summaryRect = summaryElement?.getBoundingClientRect();
  const headerLayout = { viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
    headerWidth: headerRect?.width ?? 0, headerScrollWidth: header?.scrollWidth ?? 0, controlsScrollWidth: controls?.scrollWidth ?? 0,
    summaryText: summary, shortSummaryValid: /^[\d,]+ discovered · [\d,]+ shown/.test(summary), controls: controlsRect && { left: controlsRect.left, right: controlsRect.right, top: controlsRect.top, bottom: controlsRect.bottom },
    summary: summaryRect && { left: summaryRect.left, right: summaryRect.right, visible: getComputedStyle(summaryElement).display !== 'none' && summaryRect.width > 0 },
    controlsOverlapTitle: Boolean(titleRect && controlsRect && titleRect.left < controlsRect.right && titleRect.right > controlsRect.left && titleRect.top < controlsRect.bottom && titleRect.bottom > controlsRect.top),
    fitsViewport: Boolean(headerRect && header && headerRect.left >= 0 && headerRect.right <= innerWidth && header.scrollWidth <= header.clientWidth &&
      document.documentElement.scrollWidth <= innerWidth && controls && controls.scrollWidth <= controls.clientWidth && controlsRect && controlsRect.left >= headerRect.left && controlsRect.right <= headerRect.right &&
      titleRect && !((titleRect.left < controlsRect.right && titleRect.right > controlsRect.left) && (titleRect.top < controlsRect.bottom && titleRect.bottom > controlsRect.top)) &&
      summaryRect && getComputedStyle(summaryElement).display !== 'none' && summaryRect.width > 0 && /^[\d,]+ discovered · [\d,]+ shown/.test(summary)) };
  const scrim = document.querySelector('[data-topology-scrim]');
  const layoutStart = performance.getEntriesByName('topology:first-layout-start').at(-1)?.startTime;
  const layoutEnd = performance.getEntriesByName('topology:first-layout-end').at(-1)?.startTime;
  const result = { ready: true, readable, summary, detailedSummary, headerLayout, cards: cardRows.length, visibleCardCount: visibleCards.length, readableCardCount: readableCards.length,
    orphanCardCount: cardRows.filter((card) => !wireRows.some((wire) => wire.traced && (wire.source?.cardId === card.id || wire.target?.cardId === card.id))).length,
    hiddenTracedWireCount: wireRows.filter((wire) => wire.traced && wire.hiddenByCards.length).length,
    hiddenUntracedWireCount: wireRows.filter((wire) => !wire.traced && wire.hiddenByCards.length).length,
    wireCount: wireRows.length, tracedWireCount: wireRows.filter((wire) => wire.traced).length, readableWireCount: readableWires.length, dedicatedViewportWireCount,
     wireRows, clip, camera: { x: stage.x(), y: stage.y(), scale: stage.scaleX() }, placements: cardRows.map(({ title, rect, visible, readableTitle }) => ({ title, rect, visible, readableTitle })), layers, classCounts, shapeCount: descendants.length, overlapPairs: cardRows.flatMap((a, i) => cardRows.slice(i + 1).filter((b) =>
      a.rect.x < b.rect.x + b.rect.width && a.rect.x + a.rect.width > b.rect.x && a.rect.y < b.rect.y + b.rect.height && a.rect.y + a.rect.height > b.rect.y).map((b) => [a.id, b.id])),
    shellVisibleAtCapture: Boolean(scrim && !scrim.hidden && getComputedStyle(scrim).display !== 'none'),
    mapPaintMarkMs: performance.getEntriesByName('topology:first-map-painted').at(-1)?.startTime ?? null,
    firstLayoutStartMs: layoutStart ?? null, firstLayoutEndMs: layoutEnd ?? null,
    firstLayoutDurationMs: layoutStart !== undefined && layoutEnd !== undefined ? layoutEnd - layoutStart : null,
     observationStartMs, inspectorDurationMs: performance.now() - observationStartMs };
  return result;
};

async function runPage(browser, variant, viewport, repeat, order, scenario) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const fixtureData = fixture(scenario.name, variant.origin);
  const pageErrors = [];
  const requests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__acceptanceLongTasks = [];
    let prior = false, priorButton = false;
    function feedbackFrame() {
      const scrim = document.querySelector('[data-topology-scrim]');
      const button = document.querySelector('[data-topology-show-now]');
      const shown = Boolean(scrim?.getClientRects().length), usable = Boolean(shown && button?.getClientRects().length && !button.disabled);
      if (shown && prior) window.__feedbackFrameMs ??= performance.now();
      if (usable && priorButton) window.__showNowFrameMs ??= performance.now();
      prior = shown; priorButton = usable;
      if (performance.now() < 3500 && !(window.__feedbackFrameMs && (window.__showNowFrameMs || window.__acceptanceRelease))) requestAnimationFrame(feedbackFrame);
    }
    requestAnimationFrame(feedbackFrame);
    window.__acceptanceRelease = null;
    window.addEventListener('topology-preview-release', (event) => { window.__acceptanceRelease = { reason: event.detail?.reason, at: event.detail.at }; });
    try { new PerformanceObserver((list) => window.__acceptanceLongTasks.push(...list.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration }))))
      .observe({ type: 'longtask', buffered: true }); }
    catch { window.__acceptanceLongTaskObserverAvailable = false; }
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== variant.origin) { await route.abort('blockedbyclient'); pageErrors.push(`external blocked ${request.method()} ${url.origin}`); return; }
    if (!url.pathname.startsWith('/REST') && !url.pathname.startsWith('/nodes/')) { await route.continue(); return; }
    const item = { method: request.method(), path: url.pathname, query: url.search, lookupName: url.pathname === '/REST/nodeURLsForNode' ? request.postDataJSON().name : undefined, wallStart: Date.now(), finished: false };
    requests.push(item);
    const owner = decodeURIComponent(url.pathname.split('/')[2] ?? '');
    try {
      if (request.method() === 'GET' && url.pathname === '/REST') {
        await sleep(scenario.large ? 140 : 110);
        await route.fulfill(json({ nodes: fixtureData.nodes }));
      } else if (request.method() === 'POST' && url.pathname === '/REST/nodeURLs') {
        if (scenario.failed) await route.fulfill(json({ error: 'fixture inventory failure' }, 503));
        else { await sleep(scenario.delayedInventory ? 6_000 : scenario.largeSettled ? 80 : scenario.large ? 4_500 : 900);
          await route.fulfill(json(fixtureData.ads.map((node) => ({ node, address: `${variant.origin}/nodes/${node}/` })))); }
      } else if (request.method() === 'POST' && url.pathname === '/REST/nodeURLsForNode') {
        const body = request.postDataJSON(); await sleep(20);
        const known = fixtureData.refs.includes(body.name) || fixtureData.ads.includes(body.name);
        await route.fulfill(json(known ? [{ node: body.name, address: `${variant.origin}/nodes/${body.name}/` }] : []));
      } else if (request.method() === 'GET' && url.pathname.startsWith('/nodes/')) {
        const ownerDelay = owner === 'Anchor' ? 45 : owner === 'Peer' ? 65 : 15;
        await sleep(ownerDelay);
        await route.fulfill(json(fixtureData.bindings[owner] ?? {}));
      } else { await route.fulfill(json({ error: `unexpected fixture request ${request.method()} ${url.pathname}` }, 404)); }
      item.finished = true;
      item.wallFinish = Date.now();
    } catch (error) {
      item.error = String(error);
      throw error;
    }
  });
  const expected = {};
  const key = (name) => `simple:${name.toLowerCase().replaceAll(' ', '')}`; // ASCII-only synthetic fixture.
  for (const [owner, definitions] of Object.entries(fixtureData.bindings)) for (const [plural, entries] of Object.entries(definitions)) for (const [alias, assignment] of Object.entries(entries)) {
    const kind = plural.slice(0, -1);
    const port = (title, local, label) => ({ title, role: local ? 'local' : 'alias', portId: `p-${Buffer.from(JSON.stringify(['port', key(title), `${local ? 'local' : 'remote'}-${kind}`, key(label)]), 'utf16le').swap16().toString('hex')}` });
    const endpoints = [port(owner, false, alias), port(assignment.node, true, assignment[kind])];
    expected[JSON.stringify(['binding', key(owner), kind, key(alias)])] = kind === 'action' ? endpoints : endpoints.reverse();
  }
  // Install before navigation; identical two consecutive rAF eligibility checks
  // for frozen and candidate. One synchronous inspection; never backdate it
  // to an earlier snapshot or charge pixel-read time to the paint estimate.
  if (!scenario.deadline) await page.addInitScript({ content: `(() => {
    let previous = false;
    function frame() {
      const stage = window.Konva?.stages?.[0], scrim = document.querySelector('[data-topology-scrim]');
      const eligible = Boolean((!scrim || !scrim.getClientRects().length) && stage?.findOne('.topology-wire') && stage.findOne('.topology-card'));
      if (eligible && previous) { window.__acceptanceScene = (${INSPECTOR.toString()})(${JSON.stringify(expected)}); return; }
      previous = eligible; requestAnimationFrame(frame);
    } requestAnimationFrame(frame);
  })();` });
  const url = `${variant.origin}/topology-canvas.html?source=local`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const navigationTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  const shellAtDom = await page.evaluate(() => {
    const scrim = document.querySelector('[data-topology-scrim]');
    const button = document.querySelector('[data-topology-show-now]');
    return { supported: Boolean(scrim && button), scrimVisible: Boolean(scrim && !scrim.hidden && getComputedStyle(scrim).display !== 'none'), showNowEnabled: Boolean(button && !button.disabled) };
  });
  let readableWaitError;
  if (scenario.deadline) {
    if (shellAtDom.supported) await page.waitForFunction(() => window.topologyStartupShell?.released, null, { polling: 25, timeout: 6_000 });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    readableWaitError = 'Empty local inventory: no connected map is expected; this row only validates navigation-relative deadline release.';
  } else {
    await page.waitForFunction(() => Boolean(window.__acceptanceScene), null, { timeout: 15_000 });
  }
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const paint = await page.evaluate(() => ({ now: performance.now(), mark: performance.getEntriesByName('topology:first-map-painted').at(-1)?.startTime ?? null }));
  const screenshot = `${scenario.name}-${variant.label}-${viewport.width}x${viewport.height}-r${repeat}.png`;
  await mkdir(output, { recursive: true });
  const longTasksAtCapture = await page.evaluate(() => (window.__acceptanceLongTasks ?? []).filter(task => task.start + task.duration <= (window.__acceptanceScene?.observationStartMs ?? performance.now())));
  const nativeScene = scenario.deadline ? await page.evaluate(INSPECTOR, expected) : await page.evaluate(() => window.__acceptanceScene);
  if (variant.budget !== undefined && nativeScene.ready && !nativeScene.headerLayout?.fitsViewport) throw new Error(`Candidate header/toolbar clipped or overlapping at ${viewport.width}x${viewport.height}: ${JSON.stringify(nativeScene.headerLayout)}`);
  const firstMount = await page.evaluate(() => performance.getEntriesByName('topology:initial-membership')[0]?.detail ?? null);
  if (firstMount) firstMount.prematureUnconnected = firstMount.unconnected.filter(title => Object.values(expected).some(pair => pair.some(endpoint => endpoint.title === title)));
  const captureWallMs = navigationTimeOrigin + (nativeScene.observationStartMs ?? paint.now);
  const requestsAtCapture = requests.filter(request => request.wallStart <= captureWallMs).map(({ method, path, query, wallStart, wallFinish }) => ({ method, path, query,
    startMs: Math.round(wallStart - navigationTimeOrigin), finishedAtCapture: wallFinish !== undefined && wallFinish <= captureWallMs }));

  await page.screenshot({ path: resolve(output, screenshot), animations: 'disabled' });
  // Do not backdate a later complete fan-out to the first map's paint mark.
  let matchedScene;
  if (scenario.name === 'large') {
    await page.waitForFunction(n => window.Konva.stages[0].find('.topology-wire').length === n, Object.keys(expected).length);
    matchedScene = await page.evaluate(INSPECTOR, expected);
    if (matchedScene.tracedWireCount !== Object.keys(expected).length || matchedScene.orphanCardCount !== 2 || matchedScene.overlapPairs.length) throw new Error(`Incomplete or overlapping matched cohort: ${variant.label}`);
  }
  let settlement;
  if (scenario.settle || scenario.failed) {
    if (scenario.failed) {
      await page.waitForFunction(() => {
        const text = document.querySelector('[data-fixture-summary]')?.textContent ?? '';
        return text.includes('HTTP inventory failed') && text.includes('scheduler settled');
      }, null, { timeout: 90_000 });
    } else {
      await page.waitForFunction(() => {
        const text = document.querySelector('[data-fixture-summary]')?.textContent ?? '';
        return text.includes('scheduler settled') && text.includes('0 queued') && text.includes('inventory coverage complete');
      }, null, { timeout: 180_000 });
    }
    const drainDeadline = Date.now() + 10_000;
    while (requests.some((request) => !request.finished) && Date.now() < drainDeadline) await sleep(10);
    if (requests.some((request) => !request.finished)) throw new Error(`Requests remain in flight after settled fixture: ${scenario.name}`);
    settlement = await page.locator('[data-fixture-summary]').textContent();
  }
  const shell = await page.evaluate(() => {
    const summary = document.querySelector('[data-fixture-summary]')?.textContent ?? '';
    const scrim = document.querySelector('[data-topology-scrim]');
    return { visible: Boolean(scrim && !scrim.hidden && getComputedStyle(scrim).display !== 'none'), summary,
      releaseReason: window.topologyStartupShell?.releaseReason ?? null };
  });
  const requestRows = requests.map((request) => ({ method: request.method, path: request.path, query: request.query, lookupName: request.lookupName,
    startMs: Math.round(request.wallStart - navigationTimeOrigin), finishMs: request.wallFinish ? Math.round(request.wallFinish - navigationTimeOrigin) : null, finished: request.finished }));
  const release = await page.evaluate(() => window.__acceptanceRelease);
  const feedback = await page.evaluate(() => ({ shellFrameMs: window.__feedbackFrameMs ?? null, showNowFrameMs: window.__showNowFrameMs ?? null }));
  const row = { scenario: scenario.name, variant: variant.label, budgetMs: variant.budget ?? null, repeat, counterbalancedOrder: order,
    viewport: { ...viewport, dpr: 1 }, screenshot, firstMount, readableObservedMs: nativeScene.readable ? Math.round(nativeScene.observationStartMs) : null,
    paintBasis: 'same two-rAF eligible scene check, timestamp before geometry/ink inspection; screenshot follows, not atomic',
    readableWaitError, feedback, matchedScene, mapPaintMarkMs: paint.mark,
    releaseReason: shell.releaseReason ?? (variant.budget === undefined ? 'baseline-no-preview-latch' : null), releaseMs: release?.at ?? null,
    navigationToReleaseMs: release?.at === undefined ? null : Math.round(release.at), shellAtDom, shellStillVisibleAfterReadability: shell.visible, nativeScene,
    requestsAtCapture, requestCountAtCapture: requestsAtCapture.length, requests: requestRows,
    settledSummary: settlement ?? null, startedRequestsAtCapture: requestsAtCapture.length,
    incompleteRequestsAtCapture: requestsAtCapture.filter((request) => !request.finishedAtCapture).length,
    longTaskCount: longTasksAtCapture.length, longTaskDurationMs: longTasksAtCapture.reduce((sum, item) => sum + item.duration, 0), pageErrors };
  rows.push(row);
  await writeFile(resolve(output, 'progress.json'), `${JSON.stringify({ complete: false, rows }, null, 2)}\n`);
  await context.close();
  return row;
}

let browser;
const servers = [];
try {
  await mkdir(output, { recursive: true });
  const provenance = await readFile(resolve(baselineRoot, 'PROVENANCE.txt'), 'utf8');
  const hashes = await readFile(resolve(baselineRoot, 'SHA256SUMS'), 'utf8');
  const baseline = await serve(baselineRoot); servers.push(baseline);
  variants.push({ label: 'local-first-baseline', origin: baseline.origin });
  for (const budget of budgets) {
    const server = await serve(await buildCandidate(budget)); servers.push(server);
    variants.push({ label: `preview-${budget}ms`, budget, origin: server.origin });
  }
  for (const file of sourceFiles) sourceHashes[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const allScenarios = [
    { name: 'small', large: false, repeat: repeats, viewports },
    { name: 'large', large: true, repeat: repeats, viewports },
    { name: 'deadline', large: true, delayedInventory: true, deadline: true, repeat: 1, viewports },
    { name: 'large-settled', large: true, largeSettled: true, settle: true, repeat: 1, viewports: [viewports[0]] },
    { name: 'large-failed-inventory', large: true, failed: true, repeat: 1, viewports: [viewports[0]] }
  ];
  const requestedScenarios = process.env.KONVA_ACCEPTANCE_SCENARIOS?.split(',');
  const scenarios = requestedScenarios ? allScenarios.filter(({ name }) => requestedScenarios.includes(name)) : allScenarios;
  for (const scenario of scenarios) for (let repeat = 1; repeat <= scenario.repeat; repeat++) {
    const offset = (repeat - 1) % variants.length;
    const order = [...variants.slice(offset), ...variants.slice(0, offset)];
    for (const viewport of scenario.viewports) for (const variant of order) {
      const row = await runPage(browser, variant, viewport, repeat, order.map((candidate) => candidate.label), scenario);
      console.log(`${scenario.name} ${row.variant} ${viewport.width}x${viewport.height} run=${repeat}: readable=${row.nativeScene.readable} release=${row.releaseReason} observed=${row.readableObservedMs}ms`);
    }
  }
  const settledRows = rows.filter(({ scenario }) => scenario === 'large-settled');
  const requestCounts = (row) => {
    const counts = new Map();
    for (const request of row.requests) {
      const key = `${request.method} ${request.path} ${request.query} ${request.lookupName ?? ''}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
  };
  const settledSignature = settledRows[0] ? JSON.stringify(requestCounts(settledRows[0])) : '';
  const settlementParity = settledRows.map((row) => ({ variant: row.variant, requests: row.requests.length, allFinished: row.requests.every((request) => request.finished),
    sameRequestPopulation: JSON.stringify(requestCounts(row)) === settledSignature, counts: requestCounts(row), summary: row.settledSummary }));
  const wireComparisons = Object.entries(rows.reduce((groups, row) => {
    const key = `${row.scenario}/${row.viewport.width}x${row.viewport.height}/run${row.repeat}`;
    (groups[key] ??= []).push(row);
    return groups;
  }, {})).map(([key, group]) => {
    const maps = group.map((row) => [row.variant, new Map((row.matchedScene ?? row.nativeScene).wireRows.filter((wire) => wire.traced).map((wire) => [wire.id, wire.lengthWorld]))]);
    const common = maps.length ? [...maps[0][1].keys()].filter((id) => maps.every(([, values]) => values.has(id))) : [];
    const p90 = (values) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * 0.9) - 1)] : null;
    return { key, commonWireCount: common.length, p90LengthWorldByVariant: Object.fromEntries(maps.map(([name, values]) => [name, p90(common.map((id) => values.get(id)))])),
      hiddenWireCountByVariant: Object.fromEntries(group.map((row) => [row.variant, (row.matchedScene ?? row.nativeScene).hiddenTracedWireCount])),
      hiddenPathCardIntersectionsByVariant: Object.fromEntries(group.map((row) => [row.variant, (row.matchedScene ?? row.nativeScene).wireRows.reduce((sum, wire) => sum + wire.hiddenByCards.length, 0)])) };
  });
  const quantiles = values => {
    const sorted = values.filter(Number.isFinite).sort((a,b) => a-b);
    const q = p => sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null;
    return { n: sorted.length, p50: q(0.5), p95: q(0.95) };
  };
  const timingsByViewport = ['small', 'large'].flatMap(scenario => viewports.flatMap(({width}) => variants.map(({label}) => {
    const set = rows.filter(row => row.scenario === scenario && row.viewport.width === width && row.variant === label);
    return { scenario, width, variant: label, readableMs: quantiles(set.map(row => row.readableObservedMs)), releaseMs: quantiles(set.map(row => row.releaseMs)),
      feedbackMs: quantiles(set.map(row => row.feedback.shellFrameMs)), usableShowNowMs: quantiles(set.map(row => row.feedback.showNowFrameMs)),
      inspectionMs: quantiles(set.map(row => row.nativeScene.inspectorDurationMs)), layoutMs: quantiles(set.map(row => row.nativeScene.firstLayoutDurationMs)),
      longTaskMs: quantiles(set.map(row => row.longTaskDurationMs)) };
  })));
  const report = { schemaVersion: 4, createdAt: new Date().toISOString(), complete: true, timingsByViewport,
    method: 'Fresh Chromium contexts; one post-handoff scene observation, not earliest readable paint. World-space configured card-to-takeoff traces include shared overflow roles. Viewport proxy additionally requires fully contained titles and curve control hull, ink on both layers and no sampled nonendpoint body crossings. Neither endpoint matching nor sampled ink proves individual pixel legibility.',
    browser: browser.version(), node: process.version, platform: process.platform, arch: process.arch, baseline: { path: baselineRoot, provenance, sha256sums: hashes }, sourceHashes,
    budgets, repeats, viewports, scenarios: scenarios.map(({ name, repeat }) => ({ name, repeat })), settlementParity, wireComparisons,
    failedInventory: rows.filter(({ scenario }) => scenario === 'large-failed-inventory').map((row) => ({ variant: row.variant, summary: row.settledSummary, requests: row.requests })), rows,
    limitations: ['Large handoff observations and matched 102-wire observations are separate; large-settled supplies full request parity for 104 nodes only.', 'Layer backing ink is not a compositor/physical display measurement and cannot identify a single binding at a shared takeoff.', 'Hidden paths are sampled geometry, 32 points per cubic against non-endpoint card bodies; intersections can be missed. No z-buffer coverage claim.', 'Synthetic fixture and delays do not represent a live Nodel server. No live host, external origin or full product build.'] };
  await writeFile(resolve(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  await rm(resolve(output, 'progress.json'), { force: true });
  await writeFile(resolve(output, 'README.txt'), `Reproduce: KONVA_ACCEPTANCE_REPEATS=3 node scripts/konva-preview-acceptance.mjs\n\nLoopback fixtures only. Candidate bundles: /tmp/kilo/konva-preview-acceptance-{0,1500,3000}; frozen baseline: ${baselineRoot}. See report.md and results.json (placements per row); screenshots follow scene inspection.\n`);
} finally {
  await browser?.close();
  await Promise.all(servers.map((server) => server.close()));
}
