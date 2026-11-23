import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repeats = 5;
const auxiliary = Array.from({ length: 6 }, (_, index) => `Load${index + 1}`);
const cases = [
  { name: 'overlapping-entry-legs', source: 'Development', card: 'Development', from: { x: 80, y: 100 }, to: { x: 460, y: 100 }, high: false },
  { name: 'exterior-entry-legs', source: 'Telemetry', card: 'Telemetry', from: { x: 80, y: 320 }, to: { x: 460, y: 320 }, high: false },
  // Cards overlap, but neither socket is inside the other card. Teal and blue
  // share an exterior top rail before settlement, with separate vertical legs.
  { name: 'horizontal-overlap', source: 'Telemetry', card: 'Telemetry', from: { x: 80, y: 548 }, to: { x: 300, y: 548 }, high: false },
  { name: 'high-degree', source: 'Development', card: 'Example 2', from: { x: 120, y: 400 }, to: { x: 400, y: 400 }, high: true },
] as const;
type Scenario = (typeof cases)[number];
type Point = { x: number; y: number };
type Card = Point & { width: number; height: number };
type Cubic = [Point, Point, Point, Point];
type Wire = { id: string; kind: string; color: string; selected: boolean; cubics: Cubic[] };
type Scene = { camera: Point & { scale: number }; cards: Record<string, Card>; wires: Wire[] };
type Input = { trustedDragMoves: number; trustedPointerUp: boolean };
type Timing = {
  pointerUpToWireDrawMs: number | null;
  finalPositionDrawRelativeToUpMs: number | null;
  wireDrawsAfterUpMs: number[];
  dragFrameIntervalsMs: number[];
};
type TaskTrace = {
  supported: boolean;
  pointerDown: number | null;
  pointerUp: number | null;
  mouseUpCapture: number | null;
  firstWireDrawAfterUp: number | null;
  dragMoves: number[];
  settleMarks: Array<{ name: string; at: number }>;
  longTasks: Array<{ start: number; duration: number; name: string }>;
};

async function installFixture(page: Page, baseURL: string, { high, source }: Scenario) {
  const names = [source, 'Example 2', 'Frontend', 'Spare', ...(high ? auxiliary : [])];
  const responses: Record<string, unknown> = {
    '/REST': { nodes: Object.fromEntries(names.map((name) => [name, {}])) },
    [`/nodes/${source}/REST/remote`]: {},
    '/nodes/Spare/REST/remote': {},
    '/nodes/Example2/REST/remote': { events: { 'Observe deploy': { node: source, event: 'Deploy' } } },
    '/nodes/Frontend/REST/remote': {
      actions: {
        'Frontend Return A': { node: 'Example 2', action: 'Return A' },
        'Frontend Return B': { node: 'Example 2', action: 'Return B' },
      },
    },
  };
  if (high) for (const name of auxiliary) {
    // Deduplicate the target socket, but not the wires. Only the moved card's
    // degree rises: the three measured ports and both card outlines are unchanged.
    responses[`/nodes/${name}/REST/remote`] = { actions: Object.fromEntries(
      Array.from({ length: 4 }, (_, index) => [`Load ${index + 1}`, { node: 'Example 2', action: 'Return A' }]),
    ) };
  }
  const requests: string[] = [];
  const unexpected: string[] = [];
  const origin = new URL(baseURL).origin;
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const requestKey = `${method} ${url.pathname}`;
    if (url.origin === origin && method === 'GET') {
      if (!/^\/(?:REST(?:\/|$)|nodes\/)/.test(url.pathname)) return route.continue();
      if (Object.hasOwn(responses, url.pathname)) {
        requests.push(requestKey);
        return route.fulfill({ status: 200, json: responses[url.pathname] });
      }
    }
    unexpected.push(`${method} ${url.href}`);
    await route.abort('blockedbyclient');
  });
  return { names, requests, unexpected, expected: Object.keys(responses).map((path) => `GET ${path}`).sort() };
}

interface KonvaShape {
  id(): string;
  name(): string;
  text(): string;
  x(): number;
  y(): number;
  width(): number;
  height(): number;
  position(value: Point): void;
  fire(type: string): void;
  on(type: string, listener: (event: { evt: Event }) => void): void;
  find(selector: string): KonvaShape[];
  getLayer(): KonvaShape;
  getSceneFunc(): (ctx: unknown, shape: KonvaShape) => void;
  getAttr(name: string): string;
  stroke(): string;
}
interface KonvaStage extends KonvaShape {
  scale(value: Point): void;
  scaleX(): number;
  batchDraw(): void;
  getContent(): HTMLElement;
  getIntersection(point: Point): KonvaShape | null;
}
type GeometryCount = { attempted: Record<string, number>; committed: Record<string, number> };
type LedgerPhase = 'setup' | 'drag' | 'drop' | 'pan' | 'zoom' | 'unrelated' | 'selection';
type Allocation = { bucketCount: number; candidateCount: number; comparisonCount: number; budgetFallbackCount: number; fallbackCount: number };
type Settlement = Allocation & { phase: LedgerPhase; kind: string; incident: string[]; offsets: Array<Point & { entryX?: number }> };
type CapProbe = { limits: { trialsPerGroup: number; comparisonsPerGroup: number; comparisonsPerSettlement: number; maxShift: number }; single: Allocation; batch: Allocation };
type Ledger = { phase: LedgerPhase; counts: Partial<Record<LedgerPhase, GeometryCount>>; settlements: Settlement[] };
declare global {
  interface Window {
    __laneDrop?: { read(): Scene; capture(): { lastDrag: Scene | null; input: Input; timing: Timing }; hit(point: Point): string | null; click: { id: string; trusted: boolean } | null };
    __laneLedger?: Ledger & { geometry(id: string, committed: boolean): void; settle(kind: string, edges: { id: string }[], result: Allocation & { descriptors: Map<string, { offset: Point & { entryX?: number } }> }): void };
    __laneCapProbe?: () => CapProbe;
    __laneTaskMark?: (name: string) => void;
    __laneTasks?: () => TaskTrace;
  }
}

async function installLedger(page: Page) {
  await page.addInitScript(() => {
    window.__laneLedger = {
      phase: 'setup', counts: {}, settlements: [],
      geometry(id, committed) {
        const count = this.counts[this.phase] ??= { attempted: {}, committed: {} };
        const target = committed ? count.committed : count.attempted;
        target[id] = (target[id] ?? 0) + 1;
      },
      settle(kind, edges, { descriptors, ...count }) {
        this.settlements.push({ ...count, phase: this.phase, kind, incident: edges.map(({ id }) => id), offsets: [...descriptors.values()].map(({ offset }) => offset) });
      },
    };
  });
}

async function arrange(page: Page, scenario: Scenario, names: string[], diagnostics: boolean, taskProfile: boolean) {
  const placements: Record<string, Point> = {
    'Example 2': { x: 400, y: 400 }, Frontend: { x: 850, y: 400 }, [scenario.source]: { x: 460, y: 100 },
    [scenario.card]: scenario.from,
    Spare: { x: 1300, y: 30 },
  };
  if (scenario.high) auxiliary.forEach((name, index) => {
    placements[name] = { x: 1080 + (index % 2) * 270, y: 290 + Math.floor(index / 2) * 190 };
  });
  return page.evaluate(({ positions, names, card, to, diagnostics, taskProfile }) => {
    const stage = (window as Window & { Konva?: { stages: KonvaStage[] } }).Konva?.stages[0];
    if (!stage) throw new Error('Missing Konva stage');
    const cards = new Map(stage.find('.topology-card').map((group) => {
      const name = group.find('Text').map((text) => text.text()).find((label) => names.includes(label));
      const rect = group.find('Rect').find((shape) => shape.width() > 100);
      if (!name || !rect) throw new Error(`Missing card title or outline: ${group.id()}`);
      return [name, { group, rect }] as const;
    }));
    for (const [name, point] of Object.entries(positions)) {
      const entry = cards.get(name);
      if (!entry) throw new Error(`Missing fixture card ${name}`);
      // Setup only: go through the app's move handler, not a fake positions map.
      entry.group.fire('dragstart');
      entry.group.position(point);
      entry.group.fire('dragmove');
      entry.group.fire('dragend');
    }
    // Same camera, world-to-screen delta and on-canvas hit target across builds.
    stage.position({ x: 120, y: 80 });
    stage.scale({ x: 1, y: 1 });
    stage.batchDraw();
    const read = (): Scene => ({
      camera: { x: stage.x(), y: stage.y(), scale: stage.scaleX() },
      cards: Object.fromEntries([...cards].map(([name, { group, rect }]) => [name,
        { x: group.x(), y: group.y(), width: rect.width(), height: rect.height() },
      ])),
      wires: stage.find('.topology-wire').map((wire) => {
        const cubics: Cubic[] = [];
        let path: Cubic[] = [];
        let cursor: Point;
        let selected = false;
        const ctx = {
          lineWidth: 0,
          beginPath() { path = []; },
          moveTo(x: number, y: number) { cursor = { x, y }; },
          lineTo(x: number, y: number) {
            const end = { x, y };
            path.push([cursor, cursor, end, end]);
            cursor = end;
          },
          bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
            const end = { x, y };
            path.push([cursor, { x: x1, y: y1 }, { x: x2, y: y2 }, end]);
            cursor = end;
          },
          stroke() { if (this.lineWidth !== 5.2) cubics.push(...path); selected ||= this.lineWidth === 3.2; },
          closePath() {},
          fill() {}, // Arrow paths are filled, not centerlines.
        };
        wire.getSceneFunc().call(wire, ctx, wire);
        return { id: wire.id(), kind: wire.getAttr('bindingKind'), color: wire.stroke(), cubics, selected };
      }),
    });
    const wireLayer = stage.find('.topology-wire')[0]!.getLayer();
    const { group, rect } = cards.get(card)!;
    const bounds = stage.getContent().getBoundingClientRect();
    const start = { x: bounds.left + stage.x() + group.x() + rect.width() / 2, y: bounds.top + stage.y() + group.y() + rect.height() / 2 };
    const dx = to.x - group.x();
    const dy = to.y - group.y();
    for (const { x, y } of [start, { x: start.x + dx, y: start.y + dy }]) {
      if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom) throw new Error('Gesture outside Konva canvas');
    }
    let pointerUp: number | undefined;
    let active = false;
    let previousFrame: number | undefined;
    let lastDrag: Scene | null = null;
    let finalMove = false;
    let finalPositionDraw: number | undefined;
    const trace: TaskTrace | null = taskProfile ? {
      supported: PerformanceObserver.supportedEntryTypes.includes('longtask'),
      pointerDown: null, pointerUp: null, mouseUpCapture: null, firstWireDrawAfterUp: null,
      dragMoves: [], settleMarks: [], longTasks: [],
    } : null;
    if (trace) {
      const record = (entries: PerformanceEntry[]) => {
        for (const { startTime: start, duration, name } of entries) trace.longTasks.push({ start, duration, name });
      };
      const observer = trace.supported ? new PerformanceObserver((list) => record(list.getEntries())) : null;
      observer?.observe({ type: 'longtask' });
      document.addEventListener('mouseup', (event) => { if (event.isTrusted) trace.mouseUpCapture = performance.now(); }, { capture: true, once: true });
      window.__laneTaskMark = (name) => trace.settleMarks.push({ name, at: performance.now() });
      window.__laneTasks = () => {
        if (observer) record(observer.takeRecords());
        observer?.disconnect();
        return trace;
      };
    }
    const input: Input = { trustedDragMoves: 0, trustedPointerUp: false };
    const timing: Timing = { pointerUpToWireDrawMs: null, finalPositionDrawRelativeToUpMs: null, wireDrawsAfterUpMs: [], dragFrameIntervalsMs: [] };
    group.on('dragmove.laneDrop', ({ evt }) => {
      if (evt?.isTrusted) {
        input.trustedDragMoves += 1;
        trace?.dragMoves.push(performance.now());
        if (Math.abs(group.x() - to.x) < 0.01 && Math.abs(group.y() - to.y) < 0.01) {
          finalMove = true;
          if (diagnostics) lastDrag = read();
        }
      }
    });
    document.addEventListener('pointerdown', (event) => {
      active = event.isTrusted;
      if (trace && active) trace.pointerDown = performance.now();
    }, { capture: true, once: true });
    document.addEventListener('pointerup', (event) => {
      input.trustedPointerUp = event.isTrusted;
      pointerUp = performance.now();
      if (trace && event.isTrusted) trace.pointerUp = pointerUp;
      active = false;
      if (window.__laneLedger) window.__laneLedger.phase = 'drop';
    }, { capture: true, once: true });
    wireLayer.on('draw.laneDrop', () => {
      const now = performance.now();
      if (finalMove) finalPositionDraw ??= now;
      if (pointerUp === undefined) return;
      if (trace) trace.firstWireDrawAfterUp ??= now;
      const elapsed = now - pointerUp;
      timing.pointerUpToWireDrawMs ??= elapsed;
      timing.wireDrawsAfterUpMs.push(elapsed);
    });
    const frame = (now: number) => {
      if (active && previousFrame !== undefined) timing.dragFrameIntervalsMs.push(now - previousFrame);
      previousFrame = active ? now : undefined;
      if (pointerUp === undefined) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const hit = ({ x, y }: Point) => stage.getIntersection({ x: stage.x() + x * stage.scaleX(), y: stage.y() + y * stage.scaleX() })?.id() ?? null;
    window.__laneDrop = { read, hit, click: null, capture: () => {
      if (finalPositionDraw !== undefined && pointerUp !== undefined) timing.finalPositionDrawRelativeToUpMs = finalPositionDraw - pointerUp;
      return { lastDrag, input, timing };
    } };
    if (diagnostics) for (const wire of stage.find('.topology-wire')) wire.on('click.laneDrop', ({ evt }) => {
      window.__laneDrop!.click = { id: wire.id(), trusted: evt.isTrusted };
    });
    if (window.__laneLedger) window.__laneLedger.phase = 'drag';
    return { start, dx, dy, origin: { x: bounds.left + stage.x(), y: bounds.top + stage.y() } };
  }, { positions: placements, names, card: scenario.card, to: scenario.to, diagnostics, taskProfile });
}

const inspect = (page: Page) => page.evaluate(() => window.__laneDrop!.read());
const waitFrames = (page: Page, count: number) => page.evaluate((count) => new Promise<void>((done) => {
  const next = () => { if (--count === 0) done(); else requestAnimationFrame(next); };
  requestAnimationFrame(next);
}), count);

function endpointCard(scene: Scene, point: Point, side: 'left' | 'right') {
  const names = Object.entries(scene.cards).filter(([, card]) =>
    Math.abs(point.x - card.x - (side === 'right' ? card.width : 0)) < 0.01 && point.y >= card.y && point.y <= card.y + card.height,
  ).map(([name]) => name);
  expect(names, `card ${side} socket at ${JSON.stringify(point)}`).toHaveLength(1);
  return names[0]!;
}

const round = (value: number) => Number(value.toFixed(4));
const intervalOverlap = (a: { top: number; bottom: number }, b: { top: number; bottom: number }) =>
  round(Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)));

function geometry(scene: Scene, scenario: Scenario) {
  const example = scene.cards['Example 2']!;
  const dev = scene.cards[scenario.source]!;
  const wires = scene.wires.map((wire) => {
    const start = wire.cubics[0]![0];
    const end = wire.cubics.at(-1)![3];
    return { ...wire, from: endpointCard(scene, start, 'right'), to: endpointCard(scene, end, 'left'), socketGap: round(end.x - start.x) };
  });
  const incoming = wires.filter((wire) => wire.to === 'Example 2');
  const entry = (wire: (typeof incoming)[number]) => {
    // Search backwards from the target for the last actual straight vertical
    // centerline. All four cubic points must have this X; do not count elbows,
    // control hull extrema, source legs or arrows as a reserved target rail.
    const cubic = wire.cubics.findLast(([start, c1, c2, end]) => start.x < example.x &&
      [c1, c2, end].every(({ x }) => Math.abs(x - start.x) < 0.001) && Math.abs(end.y - start.y) > 0.001);
    if (!cubic) return null;
    const [start, , , end] = cubic;
    return { x: round(start.x), top: round(Math.min(start.y, end.y)), bottom: round(Math.max(start.y, end.y)), clearance: round(example.x - start.x) };
  };
  const horizontal = (wire: (typeof incoming)[number]) => {
    const cubic = wire.cubics.filter(([start, a, b, end]) => Math.abs(start.x - end.x) > 100 &&
      (start.y <= example.y || start.y >= example.y + example.height) && [a, b, end].every(({ y }) => Math.abs(y - start.y) < 0.001),
    ).sort(([s1, , , e1], [s2, , , e2]) => Math.abs(e2.x - s2.x) - Math.abs(e1.x - s1.x))[0];
    if (!cubic) return null;
    const [start, , , end] = cubic;
    const side = start.y <= example.y ? 'top' : start.y >= example.y + example.height ? 'bottom' : 'neither';
    const offset = side === 'top' ? example.y - start.y : start.y - example.y - example.height;
    return { y: round(start.y), left: round(Math.min(start.x, end.x)), right: round(Math.max(start.x, end.x)), side, offset: round(offset) };
  };
  const teal = incoming.find((wire) => wire.kind === 'event' && wire.from === scenario.source)!;
  const blue = incoming.filter((wire) => wire.kind === 'action' && wire.from === 'Frontend');
  expect(teal).toBeDefined();
  expect(blue).toHaveLength(2);
  const tealLeg = entry(teal);
  const tealRail = horizontal(teal);
  const blueLegs = blue.map((wire) => ({ id: wire.id, color: wire.color, socketGap: wire.socketGap, leg: entry(wire), horizontal: horizontal(wire) }));
  return {
    movedOverlap: {
      x: round(Math.max(0, Math.min(example.x + example.width, dev.x + dev.width) - Math.max(example.x, dev.x))),
      y: intervalOverlap({ top: example.y, bottom: example.y + example.height }, { top: dev.y, bottom: dev.y + dev.height }),
    },
    incidentDegree: Object.fromEntries(Object.keys(scene.cards).map((name) => [name, wires.filter((wire) => wire.from === name || wire.to === name).length])),
    teal: { id: teal.id, color: teal.color, socketGap: teal.socketGap, leg: tealLeg, horizontal: tealRail },
    blue: blueLegs,
    sharedVerticalInterval: blueLegs.map(({ leg }) => !leg || !tealLeg ? null : {
      xSeparation: round(Math.abs(tealLeg.x - leg.x)), yOverlap: intervalOverlap(tealLeg, leg),
    }),
    sharedHorizontalInterval: blueLegs.map(({ horizontal }) => !horizontal || !tealRail ? null : {
      sameSide: horizontal.side === tealRail.side, ySeparation: round(Math.abs(horizontal.y - tealRail.y)),
      xOverlap: round(Math.max(0, Math.min(horizontal.right, tealRail.right) - Math.max(horizontal.left, tealRail.left))),
    }),
  };
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted.length ? sorted[Math.ceil(p * sorted.length) - 1]! : null;
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), samples };
}

async function proveSelection(page: Page, scene: Scene, scenario: Scenario, origin: Point, evidenceDir: string, label: string) {
  const measured = geometry(scene, scenario);
  const wires = [measured.teal, ...measured.blue];
  const horizontal = scenario.name === 'horizontal-overlap';
  if (wires.some((wire) => !(horizontal ? wire.horizontal : wire.leg))) return [];
  const low = Math.max(...wires.map((wire) => horizontal ? wire.horizontal!.left : wire.leg!.top));
  const high = Math.min(...wires.map((wire) => horizontal ? wire.horizontal!.right : wire.leg!.bottom));
  if (high - low <= 2) return [];
  const midpoint = Math.round((low + high) / 2);
  const names = ['teal', 'blue-a', 'blue-b'];
  const nameOf = (id: string | null | undefined) => id == null ? null : names[wires.findIndex((wire) => wire.id === id)] ?? 'other';
  const results = [];
  for (const [index, wire] of wires.entries()) {
    const point = horizontal ? { x: midpoint, y: wire.horizontal!.y } : { x: wire.leg!.x, y: midpoint };
    const hit = await page.evaluate((point) => {
      window.__laneDrop!.click = null;
      if (window.__laneLedger) window.__laneLedger.phase = 'selection';
      return window.__laneDrop!.hit(point);
    }, point);
    await page.mouse.click(origin.x + point.x, origin.y + point.y);
    const response = await page.evaluate(() => ({ click: window.__laneDrop!.click, selected: window.__laneDrop!.read().wires.filter((wire) => wire.selected).map(({ id }) => id) }));
    const matched = hit === wire.id && response.click?.id === wire.id && response.click.trusted && response.selected.length === 1 && response.selected[0] === wire.id;
    const screenshot = `${label}-${scenario.name}-select-${names[index]}.png`;
    await page.screenshot({ path: resolve(evidenceDir, screenshot) });
    results.push({ wire: names[index], point, hit: nameOf(hit), clicked: nameOf(response.click?.id), selected: response.selected.map(nameOf), trusted: response.click?.trusted ?? false, matched, screenshot });
  }
  return results;
}

async function auditNonDragMoves(page: Page, origin: Point) {
  const panStart = { x: origin.x - 80, y: origin.y + 125 };
  const phase = (phase: LedgerPhase) => page.evaluate((phase) => { window.__laneLedger!.phase = phase; }, phase);
  const before = await inspect(page);
  await phase('pan');
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panStart.x + 35, panStart.y + 27, { steps: 3 });
  await page.mouse.up();
  const panned = await inspect(page);
  expect(panned.camera).not.toEqual(before.camera);
  await phase('zoom');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const zoomed = await inspect(page);
  expect(zoomed.camera.scale).toBeGreaterThan(panned.camera.scale);
  const spare = zoomed.cards.Spare!;
  const { x, y, scale } = zoomed.camera;
  const start = { x: origin.x - before.camera.x + x + (spare.x + spare.width / 2) * scale, y: origin.y - before.camera.y + y + (spare.y + spare.height / 2) * scale };
  await phase('unrelated');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 35, start.y + 30, { steps: 3 });
  await page.mouse.up();
  await waitFrames(page, 2);
  const after = await inspect(page);
  expect(after.cards.Spare).not.toEqual(spare);
  expect(after.camera).toEqual(zoomed.camera);
  expect(after.wires).toEqual(zoomed.wires);
  const ledger = await page.evaluate(() => {
    const { counts, settlements } = window.__laneLedger!;
    delete counts.setup;
    return { counts, settlements: settlements.filter((entry) => entry.phase !== 'setup') };
  });
  return { ledger, camera: { before: before.camera, panned: panned.camera, zoomed: zoomed.camera }, unrelatedCardMoved: true, unrelatedWiresUnchanged: true };
}

async function runTrial(page: Page, baseURL: string, scenario: Scenario, diagnostics: boolean, instrumented: boolean, taskProfile: boolean, evidenceDir: string, label: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (instrumented) await installLedger(page);
  const fixture = await installFixture(page, baseURL, scenario);
  const html = await page.goto('/topology-canvas.html?source=local');
  expect(html?.ok()).toBe(true);
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-fixture-summary]')).toContainText(`${scenario.high ? 27 : 3} configured`);
  const scriptURL = await page.locator('script[type="module"][src]').first().evaluate((script: HTMLScriptElement) => script.src);
  expect(new URL(scriptURL).origin).toBe(new URL(baseURL).origin);
  const script = await page.request.get(scriptURL);
  expect(script.ok()).toBe(true);
  const build = { script: new URL(scriptURL).pathname, sha256: createHash('sha256').update(await script.body()).digest('hex') };
  const { start, dx, dy, origin } = await arrange(page, scenario, fixture.names, diagnostics, taskProfile);
  const inputSession = await page.context().newCDPSession(page);
  await waitFrames(page, 2);
  const before = diagnostics ? await inspect(page) : null;
  const screenshots = diagnostics && !instrumented ? ['before', 'during', 'after'].map((phase) => `${label}-${scenario.name}-${phase}.png`) : [];
  if (screenshots[0]) await page.screenshot({ path: resolve(evidenceDir, screenshots[0]) });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 7; step += 1) {
    await page.mouse.move(start.x + dx * step / 8, start.y + dy * step / 8);
    await waitFrames(page, 1);
  }
  // Queue the final two trusted browser inputs together on one protocol session.
  // Awaiting a move before sending the release can let Chromium paint first.
  await waitFrames(page, 1);
  const end = { x: start.x + dx, y: start.y + dy };
  const moveToDestination = () => inputSession.send('Input.dispatchMouseEvent', { ...end, type: 'mouseMoved', buttons: 1 });
  const releaseAtDestination = () => inputSession.send('Input.dispatchMouseEvent', { ...end, type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1 });
  if (diagnostics) {
    await moveToDestination();
    if (screenshots[1]) await page.screenshot({ path: resolve(evidenceDir, screenshots[1]) });
    await releaseAtDestination();
  } else await Promise.all([moveToDestination(), releaseAtDestination()]);
  await waitFrames(page, 12);
  const { lastDrag, input, timing } = await page.evaluate(() => window.__laneDrop!.capture());
  const taskTrace = taskProfile ? await page.evaluate(() => window.__laneTasks!()) : null;
  if (taskTrace) {
    expect(taskTrace.supported).toBe(true);
    expect(taskTrace.pointerUp).not.toBeNull();
    expect(taskTrace.mouseUpCapture).not.toBeNull();
    expect(taskTrace.dragMoves).toHaveLength(8);
    expect(taskTrace.settleMarks.map(({ name }) => name)).toEqual(instrumented ? ['settle-start', 'allocator-end', 'settle-end'] : []);
  }
  expect(input).toEqual({ trustedDragMoves: 8, trustedPointerUp: true });
  expect(timing.finalPositionDrawRelativeToUpMs).not.toBeNull();
  expect(timing.dragFrameIntervalsMs.length).toBeGreaterThan(0);
  expect(fixture.unexpected).toEqual([]);
  expect([...fixture.requests].sort()).toEqual(fixture.expected);
  expect(errors).toEqual([]);
  if (!before) return { timing, build, detail: null, taskTrace };
  expect(lastDrag).not.toBeNull();
  const settled = await inspect(page);
  if (screenshots[2]) await page.screenshot({ path: resolve(evidenceDir, screenshots[2]) });
  expect(before.cards[scenario.card]).toMatchObject(scenario.from);
  expect(settled.cards[scenario.card]).toMatchObject(scenario.to);
  expect(settled.camera).toEqual(before.camera);
  expect(Object.fromEntries(Object.entries(settled.cards).filter(([name]) => name !== scenario.card)))
    .toEqual(Object.fromEntries(Object.entries(before.cards).filter(([name]) => name !== scenario.card)));
  const measurements = { before: geometry(before, scenario), lastDrag: geometry(lastDrag!, scenario), settled: geometry(settled, scenario) };
  const blueGeometry = (scene: Scene) => scene.wires.filter(({ id }) => measurements.settled.blue.some((wire) => wire.id === id)).map(({ cubics }) => cubics);
  const blueDropUnchanged = JSON.stringify(blueGeometry(lastDrag!)) === JSON.stringify(blueGeometry(settled));
  const blueThroughoutUnchanged = blueDropUnchanged && JSON.stringify(blueGeometry(before)) === JSON.stringify(blueGeometry(lastDrag!));
  expect(lastDrag!.cards[scenario.card]).toMatchObject(scenario.to);
  expect(lastDrag!.camera).toEqual(before.camera);
  expect(measurements.settled.incidentDegree[scenario.card]).toBe(scenario.high ? 27 : 1);
  expect(measurements.settled.movedOverlap.x).toBeGreaterThan(32);
  expect(measurements.settled.teal.socketGap).toBeLessThan(-32);
  if (scenario.source === 'Telemetry') expect(measurements.settled.movedOverlap.y).toBeGreaterThan(0);
  else expect(measurements.settled.movedOverlap.y).toBe(0);
  const selection = instrumented || scenario.high ? [] : await proveSelection(page, settled, scenario, origin, evidenceDir, label);
  const audit = instrumented ? await auditNonDragMoves(page, origin) : null;
  const capProbe = instrumented && scenario.high ? await page.evaluate(() => window.__laneCapProbe!()) : null;
  expect(fixture.unexpected).toEqual([]);
  expect(errors).toEqual([]);
  return { timing, build, detail: { screenshots, input, measurements, blueDropUnchanged, blueThroughoutUnchanged, dragCameraUnchanged: true, selection, audit, capProbe }, taskTrace };
}

test('measure real card lane drops and record comparable baseline evidence', async ({ browser, baseURL, viewport }, info) => {
  const { baseline, dist, instrumented, profile } = info.config.metadata as { baseline: boolean; dist: string | null; instrumented: boolean; profile: 'full' | 'low-repeat' | 'long-tasks' };
  const label = baseline ? 'baseline' : instrumented ? 'instrumented' : 'candidate';
  const evidenceDir = resolve(process.env.KONVA_LANE_EVIDENCE_DIR ?? 'artifacts/konva-local/lane-drop/final');
  await mkdir(evidenceDir, { recursive: true });
  type Trial = Awaited<ReturnType<typeof runTrial>>;
  const summary = [];
  const builds = [];
  const selectedCases = profile === 'full' ? cases : profile === 'low-repeat' ? [cases[0]] : [cases[0], cases[3]];
  for (const scenario of selectedCases) {
    const trials: Trial[] = [];
    const hasDiagnostic = profile === 'full';
    const count = profile === 'low-repeat' ? 12 : instrumented && hasDiagnostic ? 1 : repeats + Number(hasDiagnostic);
    for (let trial = 0; trial < count; trial += 1) await test.step(`${scenario.name} ${hasDiagnostic && trial === 0 ? 'diagnostics' : trial + 1}`, async () => {
      const page = await browser.newPage({ baseURL, viewport, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' });
      try { trials.push(await runTrial(page, baseURL!, scenario, hasDiagnostic && trial === 0, instrumented, profile === 'long-tasks', evidenceDir, label)); }
      finally { await page.close(); }
    });
    builds.push(...trials.map(({ build }) => build));
    const diagnostic = hasDiagnostic ? trials[0] : undefined;
    const timed = hasDiagnostic ? trials.slice(1) : trials;
    summary.push({
      scenario: scenario.name, card: scenario.card, timedTrials: timed.length, ...diagnostic?.detail,
      timing: instrumented && hasDiagnostic ? null : {
        noWireDrawAfterUp: timed.filter((row) => row.timing.pointerUpToWireDrawMs === null).length,
        pointerUpToWireDrawMs: stats(timed.flatMap((row) => row.timing.pointerUpToWireDrawMs ?? [])),
        finalPositionDrawRelativeToUpMs: stats(timed.flatMap((row) => row.timing.finalPositionDrawRelativeToUpMs ?? [])),
        dragFrameIntervalsMs: stats(timed.flatMap((row) => row.timing.dragFrameIntervalsMs)),
        perTrial: timed.map(({ timing }) => ({ draw: timing.pointerUpToWireDrawMs, frames: stats(timing.dragFrameIntervalsMs) })),
      },
      ...(profile === 'long-tasks' ? { tasks: timed.map(({ taskTrace }) => taskTrace) } : {}),
    });
  }
  const path = resolve(evidenceDir, `lane-drop-${label}${profile === 'full' ? '' : `-${profile}`}.json`);
  await writeFile(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), dist, build: builds[0], chromium: browser.version(), viewport, dpr: 1, profile,
    timingProtocol: profile === 'long-tasks'
      ? 'Diagnostic only: Long Tasks API and trusted pointer-up/mouse-up/first draw, sampled separately from clean timings. Candidate additionally marks allocator start/end and full settlement end in the test-only bundle. All timestamps use the same performance.now() origin.'
      : 'Timed runs exclude all screenshots, path reads, and in-app counters. Browser performance.now from trusted pointer-up capture to Konva wire-layer scene draw; RAF intervals sampled while held. Final move and release queued together as trusted Chromium inputs. Null means no post-release wire draw; signed final-destination draw time still recorded.', summary }, null, 2)}\n`);
  console.log(`Lane-drop evidence: ${path}`);
  expect(new Set(builds.map(({ sha256 }) => sha256)).size).toBe(1);
  for (const { scenario, measurements, selection, audit, capProbe, blueThroughoutUnchanged } of summary) {
    if (!measurements) continue;
    if (scenario !== 'high-degree') {
      expect.soft(blueThroughoutUnchanged, scenario).toBe(true);
      expect.soft(measurements.settled.blue.map(({ leg }) => leg?.clearance).sort(), scenario).toEqual([36, 48]);
    }
    if (scenario === 'horizontal-overlap') for (const shared of measurements.settled.sharedHorizontalInterval) {
      expect.soft(shared?.sameSide, scenario).toBe(true);
      expect.soft(shared?.xOverlap, scenario).toBeGreaterThan(100);
      if (!baseline) expect.soft(shared?.ySeparation, scenario).toBeGreaterThanOrEqual(12);
    }
    if (scenario === 'horizontal-overlap') {
      expect.soft(measurements.lastDrag.teal.horizontal?.y, scenario).toBe(368);
      expect.soft(measurements.settled.teal.horizontal?.y, scenario).toBe(baseline ? 368 : 380);
    }
    if (scenario === 'overlapping-entry-legs' || scenario === 'exterior-entry-legs') {
      expect.soft(measurements.lastDrag.teal.leg?.clearance, scenario).toBe(scenario === 'overlapping-entry-legs' ? 32 : 36);
      expect.soft(measurements.settled.teal.leg?.clearance, scenario).toBe(baseline ? (scenario === 'overlapping-entry-legs' ? 32 : 36) : 24);
      for (const shared of measurements.settled.sharedVerticalInterval) expect.soft(shared?.yOverlap, scenario).toBeGreaterThan(0);
    }
    if (scenario !== 'high-degree' && !baseline && !instrumented) expect.soft(selection?.map(({ matched }) => matched), scenario).toEqual([true, true, true]);
    if (!audit) continue;
    const { counts, settlements } = audit.ledger;
    expect.soft(settlements.map(({ phase }) => phase), scenario).toEqual(['drop']);
    const drop = settlements.find(({ phase }) => phase === 'drop');
    expect.soft(drop?.incident.length, scenario).toBe(scenario === 'high-degree' ? 27 : 1);
    expect.soft(drop?.bucketCount, scenario).toBeGreaterThan(0);
    expect.soft(drop?.candidateCount, scenario).toBeGreaterThan(0);
    expect.soft(drop?.comparisonCount, scenario).toBeGreaterThan(0);
    expect.soft(drop?.comparisonCount, scenario).toBeLessThanOrEqual(2048);
    for (const phase of ['drag', 'drop'] as const) expect.soft(Object.keys(counts[phase]?.attempted ?? {}).sort(), `${scenario} ${phase} incident only`).toEqual([...drop!.incident].sort());
    for (const phase of ['pan', 'zoom', 'unrelated'] as const) expect.soft(counts[phase], `${scenario} ${phase}`).toBeUndefined();
    if (capProbe) {
      expect.soft(capProbe.single.comparisonCount).toBe(capProbe.limits.comparisonsPerGroup);
      expect.soft(capProbe.single.budgetFallbackCount).toBe(1);
      expect.soft(capProbe.batch.comparisonCount).toBe(capProbe.limits.comparisonsPerSettlement);
      expect.soft(capProbe.batch.budgetFallbackCount).toBeGreaterThan(1);
    }
  }
});
