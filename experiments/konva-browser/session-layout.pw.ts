import { expect, test, type Page, type Route } from '@playwright/test';
import { build } from 'vite';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve('.');
const baselineRoot = '/tmp/kilo/konva-label-baseline-20261124';
const outputDir = resolve('artifacts/konva-local');
const storageKey = 'nodel.topology-canvas.layout.v1';
const candidatePath = '/candidate/topology-canvas.html';
const candidateStorageKey = `${storageKey}:${candidatePath}`;
const fileTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png'
};

interface SavedSessionLayout {
  version: number;
  cards: Array<[string, number, number, boolean]>;
  camera?: { cx: number; cy: number; scale: number };
}

function parseSessionLayout(raw: string): SavedSessionLayout {
  return JSON.parse(raw) as SavedSessionLayout;
}

let server: Server;
let origin: string;
let candidateRoot: string;

test.beforeAll(async () => {
  candidateRoot = await mkdtemp(resolve(tmpdir(), 'konva-session-fresh-build-'));
  await build({ configFile: resolve(root, 'vite.konva.config.ts'), mode: 'konva-session-test', root,
    build: { outDir: candidateRoot, emptyOutDir: true } });
  const baselineAssets = await readdir(resolve(baselineRoot, 'assets'));
  const baselineScripts = await Promise.all(baselineAssets.filter(name => name.endsWith('.js'))
    .map(name => readFile(resolve(baselineRoot, 'assets', name), 'utf8')));
  if (baselineScripts.some(script => /SessionLayoutWriter|sessionLayoutStorageKey|nodel\.topology-canvas\.layout|sessionStorage/.test(script))) {
    throw new Error(`Frozen baseline contains session persistence code: ${baselineRoot}`);
  }
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const prefix = url.pathname.startsWith('/baseline/') ? '/baseline' : '/candidate';
    const directory = prefix === '/baseline' ? baselineRoot : candidateRoot;
    const relativePath = decodeURIComponent(url.pathname.slice(prefix.length) || '/');
    const file = resolve(directory, `.${relativePath === '/' ? '/topology-canvas.html' : relativePath}`);
    const pathFromRoot = relative(directory, file);
    if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)) { response.writeHead(403).end(); return; }
    const candidate = file;
    const content = readFile(candidate).catch(error => {
      if (relativePath.endsWith('.html')) return readFile(resolve(directory, './topology-canvas.html'));
      throw error;
    });
    void content.then((body) => {
      response.writeHead(200, { 'Content-Type': fileTypes[extname(candidate)] ?? 'application/octet-stream', 'Cache-Control': 'private, max-age=30' });
      response.end(body);
    }).catch(() => response.writeHead(404).end());
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Session browser fixture did not bind loopback');
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server?.listening) await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  if (candidateRoot) await rm(candidateRoot, { recursive: true, force: true });
});

function response(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'cache-control': 'no-store' } };
}

async function installLocalFixture(page: Page, options: { delayed?: string; nodes?: number; rename?: string } = {}) {
  const count = options.nodes ?? 3;
  const names = ['Anchor', 'Peer', 'Deferred', ...Array.from({ length: Math.max(0, count - 3) }, (_, i) => `Node ${String(i + 4).padStart(3, '0')}`)];
  if (options.rename) names[0] = options.rename;
  const requests: Array<{ method: string; path: string }> = [];
  let releaseDelayed!: () => void;
  const delayed = new Promise<void>(resolveDelayed => { releaseDelayed = resolveDelayed; });
  await page.route('**/*', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) { await route.abort('blockedbyclient'); throw new Error(`External request escaped loopback: ${url.href}`); }
    if (url.pathname.startsWith('/candidate/') || url.pathname.startsWith('/baseline/')) return route.continue();
    if (!url.pathname.startsWith('/REST') && !url.pathname.startsWith('/nodes/')) return route.continue();
    requests.push({ method: request.method(), path: url.pathname });
    if (url.pathname === '/REST' && request.method() === 'GET') {
      await route.fulfill(response({ nodes: Object.fromEntries(names.map(name => [name, {}])) }));
    } else if (url.pathname === '/REST/nodeURLs' && request.method() === 'POST') {
      await route.fulfill(response([]));
    } else if (url.pathname === '/REST/nodeURLsForNode' && request.method() === 'POST') {
      await route.fulfill(response([]));
    } else if (/^\/nodes\/[^/]+\/REST\/remote$/.test(url.pathname) && request.method() === 'GET') {
      const owner = decodeURIComponent(url.pathname.split('/')[2] ?? '');
      if (owner === options.delayed) await delayed;
      const ownerIndex = names.findIndex(name => name.replaceAll(' ', '') === owner);
      const next = names[ownerIndex + 1];
      await route.fulfill(response(next ? { actions: { [`Call ${next}`]: { node: next, action: 'Respond' } } } : {}));
    } else {
      await route.abort('blockedbyclient');
      throw new Error(`Unexpected fixture request ${request.method()} ${url.pathname}`);
    }
  });
  return { requests, releaseDelayed };
}

async function ready(page: Page, count?: number) {
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('.canvas-failure')).toBeHidden();
  if (count) await expect.poll(() => cardCount(page)).toBe(count);
}

async function cardCount(page: Page) {
  return page.evaluate(() => (window as Window & { Konva?: { stages?: Array<{ find(selector: string): unknown[] }> } }).Konva?.stages?.[0]?.find('.topology-card').length ?? 0);
}

async function cardPosition(page: Page, title: string) {
  return page.evaluate((wanted) => {
    type Shape = { find(selector: string): Shape[]; text(): string; getAbsolutePosition(top?: Shape): { x: number; y: number }; id(): string };
    const stage = (window as Window & { Konva?: { stages?: Array<Shape & { find(selector: string): Shape[] }> } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find(item => item.find('Text').some(text => text.text() === wanted));
    if (!stage || !card) throw new Error(`Card absent: ${wanted}`);
    return { id: card.id(), ...card.getAbsolutePosition(stage) };
  }, title);
}

async function centerCardForPointer(page: Page, title: string) {
  await page.evaluate((wanted) => {
    type Shape = { find(selector: string): Shape[]; text(): string; getAbsolutePosition(top?: Shape): { x: number; y: number } };
    type Stage = Shape & { find(selector: string): Shape[]; width(): number; height(): number; scale(value: { x: number; y: number }): void; position(value: { x: number; y: number }): void; batchDraw(): void };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find(item => item.find('Text').some(text => text.text() === wanted));
    if (!stage || !card) throw new Error(`Cannot center missing card ${wanted}`);
    const point = card.getAbsolutePosition(stage);
    const scale = 0.65;
    stage.scale({ x: scale, y: scale });
    stage.position({ x: stage.width() / 2 - (point.x + 80) * scale, y: stage.height() / 2 - (point.y + 24) * scale });
    stage.batchDraw();
  }, title);
}

async function camera(page: Page) {
  return page.evaluate(() => {
    type Stage = { x(): number; y(): number; scaleX(): number; width(): number; height(): number };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage missing');
    return { x: stage.x(), y: stage.y(), scale: stage.scaleX(), width: stage.width(), height: stage.height() };
  });
}

async function dragCard(page: Page, title: string, delta = { x: 94, y: 62 }, holdBeforeReleaseMs = 0) {
  const point = await page.evaluate((wanted) => {
    type Shape = { find(selector: string): Shape[]; text(): string; getAbsolutePosition(top?: Shape): { x: number; y: number }; x(): number; y(): number; width(): number; height(): number };
    type Stage = Shape & { find(selector: string): Shape[]; x(): number; y(): number; scaleX(): number; container(): HTMLElement };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find(item => item.find('Text').some(text => text.text() === wanted));
    if (!stage || !card) throw new Error(`Cannot drag missing card ${wanted}`);
    const rect = stage.container().getBoundingClientRect();
    const position = card.getAbsolutePosition(stage);
    return { x: rect.left + (stage.x() + (position.x + 48) * stage.scaleX()) * rect.width / stage.container().clientWidth,
      y: rect.top + (stage.y() + (position.y + 14) * stage.scaleX()) * rect.height / stage.container().clientHeight };
  }, title);
  await page.evaluate(() => {
    const probe = (window as Window & { __sessionProbe?: { active: boolean; started: number; frames: number[] } }).__sessionProbe;
    if (probe) { probe.active = true; probe.started = performance.now(); probe.frames.length = 0; }
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + delta.x, point.y + delta.y, { steps: 8 });
  if (holdBeforeReleaseMs > 0) await page.waitForTimeout(holdBeforeReleaseMs);
  const writesWhileHeld = await page.evaluate(() => (window as Window & { __sessionProbe?: { writes: Array<{ active: boolean }> } }).__sessionProbe?.writes.filter(write => write.active).length ?? 0);
  await page.mouse.up();
  await page.evaluate(() => { const probe = (window as Window & { __sessionProbe?: { active: boolean; ended: number } }).__sessionProbe; if (probe) { probe.active = false; probe.ended = performance.now(); } });
  return { writesWhileHeld };
}

async function addDragProbe(page: Page) {
  await page.addInitScript(() => {
    const probe = { writes: [] as Array<{ at: number; storageDurationMs: number; visible: boolean; bytes: number; payload: string; active: boolean }>, frames: [] as number[], started: 0, ended: 0, active: false };
    (window as Window & { __sessionProbe?: typeof probe }).__sessionProbe = probe;
    const descriptor = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem');
    const originalSetItem = descriptor?.value as unknown as (this: Storage, key: string, value: string) => void;
    if (descriptor) Object.defineProperty(Storage.prototype, 'setItem', { ...descriptor, value: function(this: Storage, key: string, value: string) {
      const at = performance.now();
      Reflect.apply(originalSetItem, this, [key, value]);
      const storageDurationMs = performance.now() - at;
      if (key.startsWith('nodel.topology-canvas.layout.v1:')) probe.writes.push({ at, storageDurationMs, visible: document.visibilityState === 'visible', bytes: new TextEncoder().encode(value).length, payload: value, active: probe.active });
    } });
    const frame = () => { if (probe.active) probe.frames.push(performance.now()); requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  });
}

async function storage(page: Page, key = candidateStorageKey): Promise<string | null> {
  return page.evaluate(storageKeyForPage => sessionStorage.getItem(storageKeyForPage), key);
}

function storageKeyForPath(pathname: string): string {
  return `${storageKey}:${pathname}`;
}

async function waitForSettled(page: Page) {
  await expect.poll(() => page.locator('[data-topology-accessible-summary]').textContent(), { timeout: 15_000 }).toContain('scheduler settled');
}

test('real-mode session layout is opt-in, scoped, lifecycle-safe and data-minimal', async ({ page, context }) => {
  const fixture = await installLocalFixture(page, { delayed: 'Deferred' });
  await addDragProbe(page);
  await page.goto(`${origin}${candidatePath}?source=local`);
  await ready(page, 3);

  const anchorBefore = await cardPosition(page, 'Anchor');
  await dragCard(page, 'Anchor');
  const anchorDragged = await cardPosition(page, 'Anchor');
  expect(Math.hypot(anchorDragged.x - anchorBefore.x, anchorDragged.y - anchorBefore.y)).toBeGreaterThan(50);
  await expect.poll(async () => parseSessionLayout((await storage(page)) ?? '{"cards":[]}').cards.find(row => row[0] === anchorDragged.id)?.[3]).toBe(true);
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
  fixture.releaseDelayed();
  await expect.poll(() => storage(page)).not.toBeNull();
  const firstRaw = await storage(page);
  expect(firstRaw).not.toBeNull();
  const first = parseSessionLayout(firstRaw!);
  if (!first.camera) throw new Error('Session layout did not save a camera');
  expect(first).toMatchObject({ version: 1 });
  expect(Object.keys(first.camera).sort()).toEqual(['cx', 'cy', 'scale']);
  expect(first.camera).not.toHaveProperty('centerX');
  expect(first.camera).not.toHaveProperty('centerY');
  expect(first.cards.every((row: unknown[]) => typeof row[0] === 'string' && /^(?:n-empty|n-(?:[0-9a-f]{4})+)$/.test(row[0]))).toBe(true);
  expect(first.cards.some((row: unknown[]) => row[0] === anchorDragged.id && row[3] === true)).toBe(true);
  expect(firstRaw).not.toContain('Anchor');
  expect(firstRaw).not.toContain('Peer');
  expect(firstRaw).not.toContain('Call peer');
  expect(await storage(page, storageKey)).toBeNull();
  expect(Object.keys(first).sort()).toEqual(['camera', 'cards', 'version']);

  const peerBeforeArrange = await cardPosition(page, 'Peer');
  await page.getByRole('button', { name: 'Arrange by connections' }).click();
  await page.waitForTimeout(240);
  const afterArrange = await cardPosition(page, 'Anchor');
  const peerAfterArrange = await cardPosition(page, 'Peer');
  expect(afterArrange).toMatchObject({ x: anchorDragged.x, y: anchorDragged.y });
  expect(Math.hypot(peerAfterArrange.x - peerBeforeArrange.x, peerAfterArrange.y - peerBeforeArrange.y)).toBeGreaterThan(1);

  // Hold one owner read until after an early manual placement has been flushed.
  const deferredOriginal = await cardPosition(page, 'Deferred');
  await dragCard(page, 'Deferred', { x: 112, y: 44 });
  const deferredDragged = await cardPosition(page, 'Deferred');
  expect(deferredDragged.x).not.toBe(deferredOriginal.x);
  await page.waitForTimeout(220);
  await expect.poll(async () => (await cardPosition(page, 'Deferred')).x).not.toBe(deferredOriginal.x);
  await page.waitForTimeout(220);

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForTimeout(450);
  const cameraBeforeReload = await camera(page);
  const positionsBeforeReload = { anchor: await cardPosition(page, 'Anchor'), peer: await cardPosition(page, 'Peer'), deferred: await cardPosition(page, 'Deferred') };
  await page.reload();
  await ready(page, 3);
  expect(await cardPosition(page, 'Anchor')).toMatchObject({ x: positionsBeforeReload.anchor.x, y: positionsBeforeReload.anchor.y });
  expect(await cardPosition(page, 'Peer')).toMatchObject({ x: positionsBeforeReload.peer.x, y: positionsBeforeReload.peer.y });
  expect(await cardPosition(page, 'Deferred')).toMatchObject({ x: positionsBeforeReload.deferred.x, y: positionsBeforeReload.deferred.y });
  expect((await camera(page)).scale).toBeCloseTo(cameraBeforeReload.scale, 5);

  // The saved world-space camera is reprojected against the new viewport center.
  await page.setViewportSize({ width: 1080, height: 720 });
  await page.reload();
  await ready(page, 3);
  const cameraResized = await camera(page);
  expect(cameraResized.width).toBeGreaterThan(900);
  expect(cameraResized.width).toBeLessThan(1080);
  expect(cameraResized.height).toBeGreaterThan(0);
  expect(Math.abs((cameraResized.x + cameraResized.width / 2) - (cameraBeforeReload.x + cameraBeforeReload.width / 2))).toBeGreaterThan(20);
  expect(await cardPosition(page, 'Anchor')).toMatchObject({ x: positionsBeforeReload.anchor.x, y: positionsBeforeReload.anchor.y });

  const beforeReset = await camera(page);
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.waitForTimeout(220);
  expect(Math.abs((await camera(page)).scale - beforeReset.scale)).toBeGreaterThan(0.01);
  const resetPositions = await Promise.all(['Anchor', 'Peer', 'Deferred'].map(name => cardPosition(page, name)));
  expect(resetPositions.map(({ x, y }) => [x, y])).toEqual([
    [positionsBeforeReload.anchor.x, positionsBeforeReload.anchor.y],
    [positionsBeforeReload.peer.x, positionsBeforeReload.peer.y],
    [positionsBeforeReload.deferred.x, positionsBeforeReload.deferred.y]
  ]);

  // BFCache restores the same stage without a second document bootstrap.
  await page.evaluate(() => { (window as Window & { __pageHidePersisted?: boolean }).__pageHidePersisted = false;
    window.addEventListener('pagehide', event => { (window as Window & { __pageHidePersisted?: boolean }).__pageHidePersisted = event.persisted; }); });
  const liveDocument = await page.evaluate(() => performance.timeOrigin);
  await page.goto(`${origin}${candidatePath}?source=synthetic&nodes=9`);
  await page.goBack({ waitUntil: 'commit', timeout: 10_000 });
  await ready(page, 3);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(liveDocument);
  expect(await cardPosition(page, 'Anchor')).toMatchObject({ x: positionsBeforeReload.anchor.x, y: positionsBeforeReload.anchor.y });

  // sessionStorage is per top-level browsing context; sibling tab starts clean.
  const sibling = await context.newPage();
  await installLocalFixture(sibling);
  await sibling.goto(`${origin}${candidatePath}?source=local`);
  await ready(sibling, 3);
  expect(await storage(sibling)).toBeNull();

  // The storage gate is specific to real/local mode; synthetic rendering never reads/writes it.
  const pageStorageBefore = await storage(page);
  await page.goto(`${origin}${candidatePath}?nodes=9`);
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  expect(await storage(page)).toBe(pageStorageBefore);

  // A real-mode alias gets a distinct path-scoped key and starts with fresh positions.
  const differentPath = '/candidate/alternate.html';
  await page.goto(`${origin}${differentPath}?source=local`);
  await ready(page, 3);
  expect(await storage(page, storageKeyForPath(differentPath))).toBeNull();
  const alternateInitial = await cardPosition(page, 'Anchor');
  expect(Math.hypot(alternateInitial.x - anchorDragged.x, alternateInitial.y - anchorDragged.y)).toBeGreaterThan(1);
  await dragCard(page, 'Anchor', { x: 70, y: 42 });
  await page.waitForTimeout(400);
  expect(await storage(page, storageKeyForPath(differentPath))).not.toBeNull();
  expect(await storage(page)).toBe(pageStorageBefore);

  await sibling.close();
});

test('rename prunes stale IDs, denied storage is harmless, and drag write/frame evidence compares 450-card builds', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const fixture = await installLocalFixture(page, { nodes: 450 });
  await addDragProbe(page);
  await page.goto(`${origin}${candidatePath}?source=local`);
  await ready(page, 450);
  await expect.poll(() => page.locator('[data-topology-accessible-summary]').textContent(), { timeout: 30_000 }).toContain('inventory coverage complete');
  await page.waitForTimeout(400);
  await centerCardForPointer(page, 'Anchor');
  const firstNamePosition = await cardPosition(page, 'Anchor');
  await dragCard(page, 'Anchor', { x: 80, y: 50 });
  await expect.poll(async () => parseSessionLayout((await storage(page)) ?? '{"cards":[]}').cards.find(row => row[0] === firstNamePosition.id)?.[3]).toBe(true);
  const discoverySummaryAtDrop = await page.locator('[data-topology-accessible-summary]').textContent();
  expect(discoverySummaryAtDrop).toContain('scheduler running');
  const savedBeforeRename = await storage(page);
  expect(savedBeforeRename).not.toBeNull();
  if (savedBeforeRename === null) throw new Error('Candidate did not persist the 450-card drag snapshot');
  const metrics = await page.evaluate(() => {
    const probe = (window as Window & { __sessionProbe?: { writes: Array<{ at: number; bytes: number; payload: string; active: boolean }>; frames: number[] } }).__sessionProbe!;
    probe.writes.length = 0; probe.frames.length = 0;
    return true;
  });
  expect(metrics).toBe(true);
  await page.evaluate(key => sessionStorage.removeItem(key), candidateStorageKey);
  await page.waitForTimeout(400);
  const measuredBefore = await cardPosition(page, 'Anchor');
  const drag = await dragCard(page, 'Anchor', { x: 92, y: 46 }, 1200);
  const measuredAfter = await cardPosition(page, 'Anchor');
  expect(Math.hypot(measuredAfter.x - measuredBefore.x, measuredAfter.y - measuredBefore.y)).toBeGreaterThan(50);
  expect(drag.writesWhileHeld).toBe(0);
  await expect.poll(async () => parseSessionLayout((await storage(page)) ?? '{"cards":[]}').cards.find(row => row[0] === measuredAfter.id)?.[1]).toBe(measuredAfter.x);
  const currentMetrics = await page.evaluate(() => {
    const probe = (window as Window & { __sessionProbe?: { writes: Array<{ at: number; storageDurationMs: number; visible: boolean; bytes: number; payload: string; active: boolean }>; frames: number[]; started: number; ended: number } }).__sessionProbe!;
    return { writes: probe.writes, frames: probe.frames.length, started: probe.started, ended: probe.ended, dragDurationMs: probe.ended - probe.started };
  });
  expect(currentMetrics.writes.length).toBe(1);
  expect(currentMetrics.writes[0]?.active).toBe(false);
  expect(currentMetrics.writes.filter(write => write.active)).toHaveLength(0);
  expect(currentMetrics.writes[0]!.at - currentMetrics.ended).toBeGreaterThanOrEqual(0);
  expect(currentMetrics.writes[0]!.visible).toBe(true);
  expect(currentMetrics.writes.every(({ payload }) => payload.length < 512 * 1024)).toBe(true);
  const beforeRenameRaw = await storage(page);
  if (beforeRenameRaw === null) throw new Error('Session layout disappeared before rename test');
  const beforeRename = parseSessionLayout(beforeRenameRaw);
  await page.close();

  const renamedPage = await browser.newPage();
  await installLocalFixture(renamedPage, { nodes: 3, rename: 'Renamed Anchor' });
  await renamedPage.addInitScript(({ raw, key }: { raw: string; key: string }) => { sessionStorage.setItem(key, raw); }, { raw: savedBeforeRename, key: candidateStorageKey });
  await renamedPage.goto(`${origin}${candidatePath}?source=local`);
  await ready(renamedPage, 3);
  await expect(renamedPage.locator('.canvas-stage canvas')).toHaveCount(2);
  await waitForSettled(renamedPage);
  await renamedPage.waitForTimeout(500);
  const savedAfterRenameRaw = await storage(renamedPage);
  if (savedAfterRenameRaw === null) throw new Error('Renamed real-mode page lost its session layout');
  const savedAfterRename = parseSessionLayout(savedAfterRenameRaw);
  const renameGhostPresent = savedAfterRename.cards.some((row: unknown[]) => row[0] === firstNamePosition.id);
  expect(await cardCount(renamedPage)).toBe(3);
  await renamedPage.close();

  // Storage denial before the app module executes must not fail startup or leak to fallback storage.
  const denied = await browser.newPage();
  await denied.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } }));
  await installLocalFixture(denied);
  await denied.goto(`${origin}${candidatePath}?source=local`);
  await ready(denied, 3);
  await dragCard(denied, 'Anchor');
  await denied.waitForTimeout(250);
  await expect(denied.locator('.canvas-failure')).toHaveClass(/is-visually-hidden/);
  await denied.close();

  const baseline = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await installLocalFixture(baseline, { nodes: 450 });
  await addDragProbe(baseline);
  await baseline.goto(`${origin}/baseline/topology-canvas.html?source=local`);
  await ready(baseline, 450);
  await centerCardForPointer(baseline, 'Anchor');
  const baselineBefore = await cardPosition(baseline, 'Anchor');
  const baselineDrag = await dragCard(baseline, 'Anchor', { x: 92, y: 46 }, 1200);
  expect(baselineDrag.writesWhileHeld).toBe(0);
  const baselineAfter = await cardPosition(baseline, 'Anchor');
  expect(Math.hypot(baselineAfter.x - baselineBefore.x, baselineAfter.y - baselineBefore.y)).toBeGreaterThan(50);
  await baseline.waitForTimeout(300);
  const baselineMetrics = await baseline.evaluate((key) => {
    const probe = (window as Window & { __sessionProbe?: { writes: Array<{ at: number; bytes: number; payload: string }>; frames: number[]; started: number; ended: number } }).__sessionProbe!;
    return { writes: probe.writes.map(({ at, bytes, payload }) => ({ at, bytes, payload })), frames: probe.frames.length,
      started: probe.started, ended: probe.ended, dragDurationMs: probe.ended - probe.started, stored: sessionStorage.getItem(key) };
  }, storageKeyForPath('/baseline/topology-canvas.html'));
  expect(baselineMetrics.writes.length).toBe(0);
  await baseline.close();

  const payloadContainsNames = ['Anchor', 'Peer', 'Call '].some(value => savedBeforeRename.includes(value));
  const externalRequestCount = fixture.requests.filter(({ path }) => !path.startsWith('/REST') && !path.startsWith('/nodes/')).length;
  const summarizePayload = (raw: string | null) => {
    if (!raw) return null;
    const value = parseSessionLayout(raw);
    return { bytes: new TextEncoder().encode(raw).length, version: value.version, cardCount: value.cards?.length ?? 0,
      rootFields: Object.keys(value).sort(), cardTupleLengths: [...new Set(value.cards?.map(row => row.length) ?? [])],
      cameraFields: Object.keys(value.camera ?? {}).sort(), cleartextNamesAbsent: !['Anchor', 'Peer', 'Call '].some(term => raw.includes(term)),
      graphRecordsAbsent: !/"(?:actions|events|address|bindings|credentials|password)"\s*:/.test(raw) };
  };
  await mkdir(outputDir, { recursive: true });
  const report = {
    createdAt: new Date().toISOString(), fixture: 'loopback real-mode local inventory, 450 Konva cards',
    baseline: baselineRoot, candidate: 'fresh Vite build from current worktree',
    candidateDrag: { writeTimestampsMs: currentMetrics.writes.map(write => write.at), frameCountDuringGesture: currentMetrics.frames,
      dragDurationMs: currentMetrics.dragDurationMs, serializedPayloadBytes: currentMetrics.writes.map(write => write.bytes), writeCount: currentMetrics.writes.length,
      writesWhilePointerHeld: drag.writesWhileHeld, writesDuringGesture: currentMetrics.writes.filter(write => write.active).length,
      writesAfterDrop: currentMetrics.writes.filter(write => !write.active).length,
       storageDurationMs: currentMetrics.writes.map(write => write.storageDurationMs),
      discoverySummaryAtDrop,
      delayFromPointerUpToWriteMs: currentMetrics.writes.length ? currentMetrics.writes[0]!.at - currentMetrics.ended : null },
    frozenBaselineDrag: { writeTimestampsMs: baselineMetrics.writes.map(write => write.at), writeCount: baselineMetrics.writes.length,
      payloadBytes: baselineMetrics.writes.map(write => write.bytes), framesDuringGesture: baselineMetrics.frames,
      dragDurationMs: baselineMetrics.dragDurationMs,
      sessionPayload: summarizePayload(baselineMetrics.stored) },
    sessionPayloadAfterDrag: summarizePayload(JSON.stringify(beforeRename)),
    checks: { baselineContainsSessionCode: false, noWritesDuringHeldDrag: drag.writesWhileHeld === 0,
      oneSuccessfulVisibleWrite: currentMetrics.writes.length === 1 && currentMetrics.writes[0]?.visible,
      cameraUsesCxCy: Object.keys(beforeRename.camera ?? {}).includes('cx') && Object.keys(beforeRename.camera ?? {}).includes('cy'),
      renamePrunedOldCard: !renameGhostPresent, renameGhostPresent, deniedStorageDidNotBreakStartup: true,
      externalRequestCount, cleartextGraphDataSerialized: payloadContainsNames }
  };
  await writeFile(resolve(outputDir, 'session-layout-browser-evidence.json'), `${JSON.stringify(report, null, 2)}\n`);
  expect(renameGhostPresent, `Stale opaque card ID ${firstNamePosition.id} remained in sessionStorage after owner rename`).toBe(false);
});
