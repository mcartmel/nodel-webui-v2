import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const artifactDir = resolve('artifacts/konva-local');
const localInventory = {
  nodes: {
    Controller: {},
    'Touch Panel': {},
    Scheduler: {},
    'Idle Local': {}
  }
};

const ownerBindings: Record<string, unknown> = {
  Controller: {
    actions: {
      'Power On': { node: 'Projector Left', action: 'Power On' },
      'Self Call': { node: 'Controller', action: 'Self Call' }
    },
    events: { 'Power State': { node: 'Projector Left', event: 'Power State' } }
  },
  'Touch Panel': { actions: { 'Turn Projector On': { node: 'Projector Left', action: 'Power On' } } },
  Scheduler: { events: { 'Controller Ready': { node: 'Controller', event: 'Ready' } } },
  'Idle Local': {}
};

type RequestRecord = { method: string; pathname: string; search: string };
const experimentOrigin = new URL(process.env.KONVA_EXPERIMENT_URL ?? 'http://127.0.0.1:4181').origin;

type SelfLoopScene = {
  edgeId: string;
  groupPosition: { x: number; y: number };
  from: { x: number; y: number };
  to: { x: number; y: number };
  curves: Array<{ start: { x: number; y: number }; control1: { x: number; y: number }; control2: { x: number; y: number }; end: { x: number; y: number }; strokeStyle: string }>;
  screenMidpoint: { x: number; y: number };
  fromSocket: { fill: string; stroke: string };
  toSocket: { fill: string; stroke: string };
  otherSocket: { fill: string; stroke: string };
  accent: string;
};

async function readControllerSelfLoop(page: Page): Promise<SelfLoopScene> {
  return page.evaluate(() => {
    type NativeNode = {
      id(): string;
      name(): string;
      x(): number;
      y(): number;
      width(): number;
      text(): string;
      align(): string;
      fill(): string;
      stroke(): string;
      find(selector: string): NativeNode[];
      getAbsolutePosition(top?: NativeNode): { x: number; y: number };
      getSceneFunc(): (context: {
        beginPath(): void;
        moveTo(x: number, y: number): void;
        bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
        lineTo(x: number, y: number): void;
        closePath(): void;
        stroke(): void;
        fill(): void;
        strokeStyle: string;
        fillStyle: string;
        lineWidth: number;
      }, shape: NativeNode) => void;
    };
    type CurvePath = {
      start: { x: number; y: number };
      control1?: { x: number; y: number };
      control2?: { x: number; y: number };
      end?: { x: number; y: number };
      strokeStyle: string;
    };
    const stage = (window as Window & { Konva?: { stages?: NativeNode[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva native stage registry is unavailable');
    const cards = stage.find('.topology-card');
    const controller = cards.find((card) => card.find('Text').some((text) => text.text() === 'Controller'));
    if (!controller) throw new Error('Controller card was not found');
    const texts = controller.find('Text');
    const inputText = texts.find((text) => text.text() === 'Self Call' && text.align() === 'left');
    const outputText = texts.find((text) => text.text() === 'Self Call' && text.align() === 'right');
    const otherText = texts.find((text) => text.text() === 'Power On' && text.align() === 'right');
    if (!inputText || !outputText || !otherText) throw new Error('Expected local, remote, and unmatched port labels were not found');
    const background = controller.find('Rect').find((rect) => rect.width() > 100);
    if (!background) throw new Error('Controller background rectangle was not found');
    const cardWidth = background.width();
    const socketNear = (text: NativeNode, side: 'left' | 'right') => {
      const sockets = controller.find('Circle').filter((socket) => socket.name().startsWith('socket-'));
      const sideSockets = sockets.filter((socket) => side === 'left' ? socket.x() === 0 : socket.x() === cardWidth);
      const socket = sideSockets.find((candidate) => Math.abs(candidate.y() - text.y() - 7) < 0.1);
      if (!socket) throw new Error(`Could not match ${side} socket to ${text.text()} label`);
      return socket;
    };
    const inputSocket = socketNear(inputText, 'left');
    const outputSocket = socketNear(outputText, 'right');
    const otherSocket = socketNear(otherText, 'right');
    const from = outputSocket.getAbsolutePosition(stage);
    const to = inputSocket.getAbsolutePosition(stage);
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
    const paths: Array<{ id: string; curves: CurvePath[] }> = [];
    for (const wire of stage.find('.topology-wire')) {
      const curves: CurvePath[] = [];
      let current: CurvePath | undefined;
      const context = {
        strokeStyle: '', fillStyle: '', lineWidth: 0,
        beginPath() { current = undefined; },
        moveTo(x: number, y: number) { current = { start: { x, y }, strokeStyle: this.strokeStyle }; },
        bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
          if (current) {
            current.control1 = { x: c1x, y: c1y };
            current.control2 = { x: c2x, y: c2y };
            current.end = { x, y };
          }
        },
        lineTo() {}, closePath() {}, fill() {},
        stroke() { if (current?.control1 && current.control2 && current.end) curves.push({ ...current, strokeStyle: this.strokeStyle }); current = undefined; }
      };
      wire.getSceneFunc().call(wire, context, wire);
      const geometry = [...new Map(curves.map((curve) => [`${curve.start.x},${curve.start.y}:${curve.end?.x},${curve.end?.y}`, curve])).values()];
      paths.push({ id: wire.id(), curves: geometry });
    }
    const match = paths.find(({ curves }) => curves.length === 3 && curves[0]?.start && curves.at(-1)?.end
      && distance(curves[0].start, from) < 0.1 && distance(curves.at(-1)!.end!, to) < 0.1);
    if (!match) throw new Error('No rendered self-loop joins Controller Self Call output to its matching input socket');
    const screenCurve = match.curves[1]!;
    const inverse = 0.5;
    const point = {
      x: inverse ** 3 * screenCurve.start.x + 3 * inverse ** 2 * inverse * screenCurve.control1!.x + 3 * inverse * inverse ** 2 * screenCurve.control2!.x + inverse ** 3 * screenCurve.end!.x,
      y: inverse ** 3 * screenCurve.start.y + 3 * inverse ** 2 * inverse * screenCurve.control1!.y + 3 * inverse * inverse ** 2 * screenCurve.control2!.y + inverse ** 3 * screenCurve.end!.y
    };
    const rect = (stage as NativeNode & { container(): HTMLElement }).container().getBoundingClientRect();
    const stageTransform = stage as NativeNode & { x(): number; y(): number; scaleX(): number; scaleY(): number };
    const localPosition = controller.getAbsolutePosition(stage);
    const accentTokens = getComputedStyle(document.documentElement).getPropertyValue('--nodel-accent').trim() || '40 115 200';
    const actionTokens = getComputedStyle(document.documentElement).getPropertyValue('--nodel-topology-action').trim() || '37 99 235';
    const actionStrongTokens = getComputedStyle(document.documentElement).getPropertyValue('--nodel-topology-action-strong').trim() || '29 78 216';
    return {
      edgeId: match.id,
      groupPosition: localPosition,
      from,
      to,
      curves: match.curves.map((curve) => ({ ...curve, control1: curve.control1!, control2: curve.control2!, end: curve.end! })),
      screenMidpoint: { x: rect.left + stageTransform.x() + point.x * stageTransform.scaleX(), y: rect.top + stageTransform.y() + point.y * stageTransform.scaleY() },
      fromSocket: { fill: outputSocket.fill(), stroke: outputSocket.stroke() },
      toSocket: { fill: inputSocket.fill(), stroke: inputSocket.stroke() },
      otherSocket: { fill: otherSocket.fill(), stroke: otherSocket.stroke() },
      accent: `rgb(${accentTokens})`, action: `rgb(${actionTokens})`, actionStrong: `rgb(${actionStrongTokens})`
    };
  });
}

function apiPath(pathname: string): boolean {
  return pathname === '/REST' || pathname.startsWith('/REST/') || pathname.startsWith('/nodes/');
}

async function installGuard(page: Page, resolveApi: (route: Route, record: RequestRecord) => Promise<void>) {
  const requests: RequestRecord[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) {
      await route.abort('blockedbyclient');
      throw new Error(`External request blocked: ${request.method()} ${url.origin}${url.pathname}`);
    }
    if (!apiPath(url.pathname)) {
      await route.continue();
      return;
    }
    const record = { method: request.method(), pathname: url.pathname, search: url.search };
    requests.push(record);
    if (request.method() !== 'GET') {
      await route.abort('blockedbyclient');
      throw new Error(`Non-GET local API request blocked: ${request.method()} ${url.pathname}`);
    }
    await resolveApi(route, record);
  });
  return requests;
}

function jsonResponse(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

async function waitForLocalCanvas(page: Page) {
  await expect(page.locator('[data-fixture-summary]')).toContainText('4 local');
  await expect(page.locator('.canvas-failure')).toBeHidden();
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
}

async function openLocalFixture(page: Page, requests: RequestRecord[]) {
  await page.goto('/topology-canvas.html?source=local');
  await waitForLocalCanvas(page);
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    ...['Controller', 'IdleLocal', 'Scheduler', 'TouchPanel'].map((name) => ({ method: 'GET', pathname: `/nodes/${name}/REST/remote`, search: '' }))
  ]);
}

async function installLocalFixture(page: Page, options: { stalledOwners?: string[]; inventoryStatus?: number; emptyInventory?: boolean } = {}) {
  const stalled = new Set(options.stalledOwners ?? []);
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(options.inventoryStatus
        ? jsonResponse({ denied: true }, options.inventoryStatus)
        : jsonResponse(options.emptyInventory ? { nodes: {} } : localInventory));
      return;
    }
    const owner = decodeURIComponent(request.pathname.split('/')[2] ?? '');
    if (stalled.has(owner)) return;
    await route.fulfill(jsonResponse(ownerBindings[owner === 'TouchPanel' ? 'Touch Panel' : owner] ?? {}));
  });
  return requests;
}

test('synthetic graph remains network-silent and unchanged', async ({ page }) => {
  const requests = await installGuard(page, async (route, request) => {
    await route.abort('blockedbyclient');
    throw new Error(`Synthetic source attempted API access: ${request.method} ${request.pathname}`);
  });
  await page.goto('/topology-canvas.html?nodes=9');
  await expect(page.locator('[data-fixture-summary]')).toHaveText('9 nodes · 14 edges');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.getByLabel('Graph source')).toHaveValue('9');
  expect(requests).toEqual([]);
});

test('local source is selected during pending inventory and can return to synthetic 9', async ({ page }) => {
  const requests = await installGuard(page, async () => new Promise<void>(() => {}));
  await page.goto('/topology-canvas.html?source=local', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Graph source')).toHaveValue('local');
  await expect(page.locator('[data-fixture-summary]')).toHaveText('Loading local configuration…');
  await expect(page.locator('[data-fixture-summary]')).not.toContainText('9 nodes');
  await page.getByLabel('Graph source').selectOption('9');
  await expect(page).toHaveURL(/nodes=9/);
  await expect(page).not.toHaveURL(/source=local/);
  await expect(page.locator('[data-fixture-summary]')).toHaveText('9 nodes · 14 edges');
  await expect(page.locator('.canvas-failure')).toBeHidden();
  expect(requests).toEqual([{ method: 'GET', pathname: '/REST', search: '' }]);
});

test('local mode uses only scoped GETs, renders local/reference cards and wires, and preserves gestures', async ({ page }) => {
  const requests = await installLocalFixture(page);
  await page.addInitScript(() => {
    const prototype = CanvasRenderingContext2D.prototype;
    const original = Object.getOwnPropertyDescriptor(prototype, 'fillText')?.value as CanvasRenderingContext2D['fillText'] | undefined;
    const originalCurve = Object.getOwnPropertyDescriptor(prototype, 'bezierCurveTo')?.value as CanvasRenderingContext2D['bezierCurveTo'] | undefined;
    if (!original || !originalCurve) throw new Error('Canvas text and curve methods are unavailable');
    prototype.fillText = function (text: string, x: number, y: number, ...rest: [number?]) {
      const transform = this.getTransform();
      const point = transform.transformPoint(new DOMPoint(x, y));
      const canvas = this.canvas;
      const bounds = canvas.getBoundingClientRect();
      const labels = ((window as Window & { __konvaLabels?: Array<{ text: string; x: number; y: number }> }).__konvaLabels ??= []);
      labels.push({ text: String(text), x: bounds.left + point.x * bounds.width / canvas.width, y: bounds.top + point.y * bounds.height / canvas.height });
      return Reflect.apply(original, this, [text, x, y, ...rest]);
    };
    prototype.bezierCurveTo = function (...coordinates: [number, number, number, number, number, number]) {
      const state = window as Window & { __konvaCurveCount?: number };
      state.__konvaCurveCount = (state.__konvaCurveCount ?? 0) + 1;
      return Reflect.apply(originalCurve, this, coordinates);
    };
  });
  await openLocalFixture(page, requests);
  await expect(page.locator('[data-fixture-summary]')).toContainText('5 configured');
  await expect(page.locator('.experiment-header h1')).toHaveText('Local network topology');

  // Screenshots are evidence outputs, not checked-in baselines.
  await mkdir(artifactDir, { recursive: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await assertLocalLoopFitsViewport(page);
  await page.screenshot({ path: resolve(artifactDir, 'local-mode-1366x768.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await assertLocalLoopFitsViewport(page);
  await page.screenshot({ path: resolve(artifactDir, 'local-mode-1920x1080.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: resolve(artifactDir, 'local-mode-dark.png'), animations: 'disabled' });
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  const labels = await page.evaluate(() => (window as Window & { __konvaLabels?: Array<{ text: string; x: number; y: number }> }).__konvaLabels ?? []);
  for (const name of ['Controller', 'Touch Panel', 'Scheduler', 'Idle Local', 'Projector Left']) {
    expect(labels.some((label) => label.text === name), `rendered card title ${name}`).toBe(true);
  }
  for (const state of ['Local', 'Referenced · not inspected']) {
    expect(labels.some((label) => label.text === state), `rendered state ${state}`).toBe(true);
  }
  // Five configured connections render as four ordinary curves plus the
  // three-segment exterior self-loop; both scene and hit canvases paint them.
  expect(await page.evaluate(() => (window as Window & { __konvaCurveCount?: number }).__konvaCurveCount ?? 0)).toBeGreaterThanOrEqual(14);

  // Zoom, pan the stage in empty space, then select and drag a rendered card.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const stage = page.locator('.canvas-stage');
  const bounds = await stage.boundingBox();
  if (!bounds) throw new Error('Canvas stage has no bounds');
  await page.mouse.move(bounds.x + 16, bounds.y + 16);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 72, bounds.y + 66, { steps: 4 });
  await page.mouse.up();
  const updatedLabels = await page.evaluate(() => (window as Window & { __konvaLabels?: Array<{ text: string; x: number; y: number }> }).__konvaLabels ?? []);
  const controller = [...updatedLabels].reverse().find((label) => label.text === 'Controller');
  expect(controller, 'Controller remains rendered after zoom and pan').toBeDefined();
  if (!controller) return;
  const loopBeforeMove = await readControllerSelfLoop(page);
  const beforeSelection = await page.screenshot();
  await page.mouse.click(controller.x + 35, controller.y - 10);
  const afterSelection = await page.screenshot();
  expect(afterSelection.equals(beforeSelection), 'physical card click changes selected rendering').toBe(false);
  await page.mouse.move(controller.x + 35, controller.y - 10);
  await page.mouse.down();
  await page.mouse.move(controller.x + 75, controller.y + 18, { steps: 5 });
  await page.mouse.up();
  const draggedLabels = await page.evaluate(() => (window as Window & { __konvaLabels?: Array<{ text: string; x: number; y: number }> }).__konvaLabels ?? []);
  const movedController = [...draggedLabels].reverse().find((label) => label.text === 'Controller');
  expect(movedController?.x).toBeGreaterThan(controller.x + 20);
  expect(movedController?.y).toBeGreaterThan(controller.y + 10);
  const movedLoop = await readControllerSelfLoop(page);
  expect(movedLoop.edgeId).toBe(loopBeforeMove.edgeId);
  expect(movedLoop.groupPosition.x).toBeGreaterThan(loopBeforeMove.groupPosition.x + 20);
  expect(movedLoop.groupPosition.y).toBeGreaterThan(loopBeforeMove.groupPosition.y + 10);
  expect(Math.hypot(movedLoop.curves[0]!.start.x - movedLoop.from.x, movedLoop.curves[0]!.start.y - movedLoop.from.y)).toBeLessThan(0.1);
  expect(Math.hypot(movedLoop.curves.at(-1)!.end.x - movedLoop.to.x, movedLoop.curves.at(-1)!.end.y - movedLoop.to.y)).toBeLessThan(0.1);
  const beforeWireSelection = await page.screenshot();
  await page.mouse.click(movedLoop.screenMidpoint.x, movedLoop.screenMidpoint.y);
  const afterWireSelection = await page.screenshot();
  expect(afterWireSelection.equals(beforeWireSelection), 'physical wire click changes selected wire and socket rendering').toBe(false);
  const selectedLoop = await readControllerSelfLoop(page);
  expect(selectedLoop.edgeId).toBe(movedLoop.edgeId);
  expect(selectedLoop.curves.every((curve) => curve.strokeStyle === selectedLoop.actionStrong)).toBe(true);
  expect(selectedLoop.fromSocket.fill).toBe('rgb(255 255 255)');
  expect(selectedLoop.fromSocket.stroke).toBe(selectedLoop.actionStrong);
  expect(selectedLoop.toSocket.fill).toBe(selectedLoop.actionStrong);
  expect(selectedLoop.toSocket.stroke).toBe(selectedLoop.actionStrong);
  expect(selectedLoop.otherSocket.fill).not.toBe(selectedLoop.actionStrong);
  expect(requests).toHaveLength(5);
});

test('physical wire selection keeps a shared socket highlighted through theme and view reset', async ({ page }) => {
  const requests = await installGuard(page, async (route, { pathname }) => {
    if (pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { Alpha: {}, Bravo: {} } }));
    } else if (pathname === '/nodes/Alpha/REST/remote' || pathname === '/nodes/Bravo/REST/remote') {
      await route.fulfill(jsonResponse({ actions: { Call: { node: 'Receiver', action: 'Accept' } } }));
    } else {
      throw new Error(`Unexpected shared-socket fixture request ${pathname}`);
    }
  });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('[data-fixture-summary]')).toHaveText('2 local · 1 referenced · 2 configured');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);

  const inspect = () => page.evaluate(async () => {
    // Konva schedules hit-canvas redraws after a camera or selection change.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    type Point = { x: number; y: number };
    type PathContext = Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'bezierCurveTo' | 'lineTo' | 'closePath' | 'stroke' | 'fill' | 'strokeStyle'>;
    type Shape = {
      id(): string; name(): string; text(): string; fill(): string; stroke(): string;
      find(selector: string): Shape[]; getAbsolutePosition(top: Shape): Point;
      getSceneFunc(): (context: PathContext, shape: Shape) => void;
    };
    type Stage = Shape & {
      getContent(): HTMLElement; getIntersection(point: Point): Shape | null;
      getAbsoluteTransform(): { point(point: Point): Point };
      x(): number; y(): number; scaleX(): number; width(): number; height(): number;
    };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage unavailable');
    const socket = (title: string) => {
      const card = stage.find('.topology-card').find((item) => item.find('Text').some((text) => text.text() === title));
      const sockets = card?.find('Circle').filter((circle) => circle.name().startsWith('socket-'));
      if (sockets?.length !== 1) throw new Error(`Expected one socket on ${title}`);
      const terminal = sockets[0]!;
      return { point: terminal.getAbsolutePosition(stage), paint: { fill: terminal.fill(), stroke: terminal.stroke() } };
    };
    const alpha = socket('Alpha');
    const bravo = socket('Bravo');
    const shared = socket('Receiver');
    const bounds = stage.getContent().getBoundingClientRect();
    const wires = stage.find('.topology-wire').map((wire) => {
      let start = { x: 0, y: 0 };
      const curves: Array<{ start: Point; end: Point; midpoint: Point }> = [];
      const context: PathContext = {
        strokeStyle: '',
        moveTo(x, y) { start = { x, y }; },
        bezierCurveTo(a, b, c, d, x, y) {
          curves.push({ start, end: { x, y }, midpoint: { x: (start.x + 3 * a + 3 * c + x) / 8, y: (start.y + 3 * b + 3 * d + y) / 8 } });
        },
        beginPath() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}
      };
      wire.getSceneFunc().call(wire, context, wire);
      const geometry = [...new Map(curves.map((curve) => [`${curve.start.x},${curve.start.y}:${curve.end.x},${curve.end.y}`, curve])).values()];
      const curve = geometry[0];
      if (geometry.length !== 1 || !curve) throw new Error('Expected one direct curve per shared-socket wire');
      const point = stage.getAbsoluteTransform().point(curve.midpoint);
      return {
        id: wire.id(), start: curve.start, end: curve.end,
        // The hit canvas uses stage-relative pixels; Playwright uses viewport pixels.
        hit: stage.getIntersection(point)?.id(),
        click: { x: bounds.left + point.x * bounds.width / stage.width(), y: bounds.top + point.y * bounds.height / stage.height() },
        // The custom scene function paints the selection, not the shape's stroke attribute.
        stroke: context.strokeStyle
      };
    });
    const samePoint = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 0.1;
    const from = (source: typeof alpha) => {
      const wire = wires.find((item) => samePoint(item.start, source.point) && samePoint(item.end, shared.point));
      if (!wire) throw new Error('No rendered wire joins the source to the shared Receiver socket');
      return wire;
    };
    if (wires.length !== 2) throw new Error(`Expected two wires, got ${wires.length}`);
    const style = getComputedStyle(document.documentElement);
    const color = (token: string) => `rgb(${style.getPropertyValue(`--nodel-${token}`).trim()})`;
    return {
      wires: { alpha: from(alpha), bravo: from(bravo) },
      sockets: { alpha: alpha.paint, bravo: bravo.paint, shared: shared.paint },
      accent: color('accent'), muted: color('muted'), surface: color('surface'),
      action: color('topology-action'), actionStrong: color('topology-action-strong'),
      camera: { x: stage.x(), y: stage.y(), scale: stage.scaleX() }
    };
  });

  const assertSelection = (scene: Awaited<ReturnType<typeof inspect>>, selected?: 'alpha' | 'bravo') => {
    const socketPaint = (active: boolean) => ({
      fill: scene.surface,
      stroke: active ? scene.actionStrong : scene.action
    });
    for (const key of ['alpha', 'bravo'] as const) {
      expect(scene.wires[key].stroke, `${key} wire paint`).toBe(selected === key ? scene.actionStrong : scene.action);
      expect(scene.sockets[key], `${key} private socket paint`).toEqual(socketPaint(selected === key));
    }
    expect(scene.sockets.shared, 'shared Receiver local-action socket paint').toEqual({
      fill: selected !== undefined ? scene.actionStrong : scene.action,
      stroke: selected !== undefined ? scene.actionStrong : scene.action
    });
  };

  const initial = await inspect();
  assertSelection(initial);
  expect(initial.wires.alpha.id).not.toBe(initial.wires.bravo.id);
  for (const key of ['alpha', 'bravo'] as const) {
    const wire = initial.wires[key];
    expect(wire.hit, `${key} midpoint hits its own wire`).toBe(wire.id);
    await page.mouse.click(wire.click.x, wire.click.y);
    assertSelection(await inspect(), key);
  }

  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const dark = await inspect();
  expect(dark.accent).not.toBe(initial.accent);
  assertSelection(dark, 'bravo');

  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect((await inspect()).camera.scale).toBeGreaterThan(initial.camera.scale);
  await page.getByRole('button', { name: 'Reset view' }).click();
  const reset = await inspect();
  expect(reset.camera).toEqual(initial.camera);
  assertSelection(reset, 'bravo');
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Alpha/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/Bravo/REST/remote', search: '' }
  ]);
});

async function assertLocalLoopFitsViewport(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const bounds = await page.locator('.canvas-stage').boundingBox();
  if (!bounds) throw new Error('Canvas stage has no bounds');
  const loop = await page.evaluate(() => {
    type NativeText = { text(): string; getParent(): { y(): number } };
    type NativeStage = { y(): number; scaleY(): number; find(selector: string): NativeText[] };
    const stage = (window as Window & { Konva?: { stages?: NativeStage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva native stage registry is unavailable');
    const title = stage.find('Text').find((shape) => shape.text() === 'Controller');
    if (!title) throw new Error('Controller card title was not found');
    // local fixture's exterior loop uses control y = card top - 98 world px.
    return { controlY: stage.y() + (title.getParent().y() - 98) * stage.scaleY() };
  });
  // Controller's exterior self-loop is the uppermost local curve. Its Bezier
  // controls must stay within the fit margin after Reset at either viewport.
  expect(loop.controlY, JSON.stringify({ bounds, loop })).toBeGreaterThanOrEqual(16);
  expect(loop.controlY, JSON.stringify({ bounds, loop })).toBeLessThan(bounds.height - 16);
}

test('confirmed empty inventory differs from denied inventory failure', async ({ page }) => {
  const requests = await installLocalFixture(page, { emptyInventory: true });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-failure')).toContainText('No local or referenced nodes');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  expect(requests).toEqual([{ method: 'GET', pathname: '/REST', search: '' }]);

  await page.unrouteAll({ behavior: 'wait' });
  const deniedRequests = await installLocalFixture(page, { inventoryStatus: 403 });
  await page.reload();
  await expect(page.locator('.canvas-failure')).toContainText('could not be loaded from this page origin');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(0);
  await expect(page.getByLabel('Graph source')).toHaveValue('local');
  await expect(page.locator('[data-fixture-summary]')).toHaveText('Local configuration unavailable');
  await expect(page.locator('[data-fixture-summary]')).not.toContainText('9 nodes');
  expect(deniedRequests).toEqual([{ method: 'GET', pathname: '/REST', search: '' }]);

  await page.getByLabel('Graph source').selectOption('9');
  await expect(page).toHaveURL(/nodes=9/);
  await expect(page).not.toHaveURL(/source=local/);
  await expect(page.locator('[data-fixture-summary]')).toHaveText('9 nodes · 14 edges');
  await expect(page.locator('.canvas-failure')).toBeHidden();
  expect(deniedRequests).toEqual([{ method: 'GET', pathname: '/REST', search: '' }]);
});

test('local stage mount failure remains visible and selector still returns to synthetic 9', async ({ page }) => {
  const requests = await installLocalFixture(page);
  await page.addInitScript(() => {
    if (new URLSearchParams(window.location.search).get('source') !== 'local') return;
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: class {
        constructor() { throw new Error('forced mount failure'); }
      }
    });
  });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-failure')).toContainText('Local topology canvas could not be rendered.');
  await expect(page.locator('.canvas-failure')).toBeVisible();
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(0);
  await expect(page.getByLabel('Graph source')).toHaveValue('local');
  await expect(page.locator('[data-fixture-summary]')).not.toContainText('5 configured');
  await expect(page.locator('[data-fixture-summary]')).not.toContainText('configured');
  await expect(page.locator('[data-fixture-summary]')).not.toContainText('4 local');
  await expect(page.locator('[data-fixture-summary]')).not.toContainText('9 nodes');
  expect(requests).toHaveLength(5);

  await page.getByLabel('Graph source').selectOption('9');
  await expect(page).toHaveURL(/nodes=9/);
  await expect(page).not.toHaveURL(/source=local/);
  await expect(page.locator('[data-fixture-summary]')).toHaveText('9 nodes · 14 edges');
  expect(requests).toHaveLength(5);
});

test('a denied owner read remains unread while a successful empty owner is confirmed local', async ({ page }) => {
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { 'Denied Owner': {}, 'Empty Owner': {} } }));
    } else if (request.pathname === '/nodes/DeniedOwner/REST/remote') {
      await route.fulfill(jsonResponse({ error: 'do not expose this detail' }, 403));
    } else if (request.pathname === '/nodes/EmptyOwner/REST/remote') {
      await route.fulfill(jsonResponse({}));
    } else {
      throw new Error(`Unexpected local-mode request ${request.pathname}`);
    }
  });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-fixture-summary]')).toContainText('2 local');
  await expect(page.locator('[data-fixture-summary]')).toContainText('1 local unread');
  await expect(page.locator('[data-fixture-summary]')).toContainText('0 configured');
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/DeniedOwner/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/EmptyOwner/REST/remote', search: '' }
  ]);
});

test('real 10-second cutoff publishes one partial snapshot and ignores late owner responses', async ({ page }) => {
  const requests: RequestRecord[] = [];
  let releaseLate: (() => Promise<void>) | undefined;
  let inventoryStartedAt: number | undefined;
  const ownerNames = Array.from({ length: 21 }, (_, index) => `Owner ${String(index).padStart(2, '0')}`);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    if (!apiPath(url.pathname)) return route.continue();
    const record = { method: request.method(), pathname: url.pathname, search: url.search };
    requests.push(record);
    if (record.method !== 'GET') return route.abort('blockedbyclient');
    if (url.pathname === '/REST') {
      inventoryStartedAt = Date.now();
      return route.fulfill(jsonResponse({ nodes: Object.fromEntries(ownerNames.map((name) => [name, {}])) }));
    }
    const owner = decodeURIComponent(url.pathname.split('/')[2] ?? '');
    if (owner === 'Owner00') return route.fulfill(jsonResponse({ actions: { 'Power On': { node: 'Projector Left', action: 'Power On' } } }));
    if (owner === 'Owner01') return route.fulfill(jsonResponse({}));
    if (owner === 'Owner14') return new Promise<void>((resolve) => { releaseLate = async () => { try { await route.fulfill(jsonResponse({ actions: { Late: { node: 'Owner 00', action: 'Late' } } })); } catch { /* The cutoff has already aborted this request. */ } finally { resolve(); } }; });
    // This route deliberately never settles before the actual wall-clock deadline.
    return new Promise<void>(() => {});
  });

  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator('[data-fixture-summary]')).toContainText('19 local unread', { timeout: 15_000 });
  const elapsed = Date.now() - (inventoryStartedAt ?? Date.now());
  expect(elapsed).toBeGreaterThanOrEqual(9_500);
  expect(elapsed).toBeLessThan(15_000);
  await expect(page.locator('[data-fixture-summary]')).toContainText('21 local');
  const afterCutoff = [...requests];
  expect(afterCutoff.filter(({ pathname }) => pathname === '/REST')).toHaveLength(1);
  expect(afterCutoff.filter(({ pathname }) => pathname.endsWith('/REST/remote'))).toHaveLength(18);
  for (const name of ['Owner18', 'Owner19', 'Owner20']) {
    expect(afterCutoff.some(({ pathname }) => pathname === `/nodes/${name}/REST/remote`)).toBe(false);
  }
  await releaseLate?.();
  await page.waitForTimeout(100);
  expect(requests).toEqual(afterCutoff);
  await expect(page.locator('[data-fixture-summary]')).toContainText('19 local unread');
});

test('a true source close unload aborts local bootstrap before it can publish', async ({ page, context }) => {
  const requests: RequestRecord[] = [];
  let ownerStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { ownerStarted = resolve; });
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input.toString() : input.url, location.href);
      if (url.pathname.startsWith('/nodes/')) {
        init?.signal?.addEventListener('abort', () => {
          try { localStorage.setItem('__konvaLocalOwnerAbort', 'true'); } catch { /* Browser storage is optional in a test. */ }
        }, { once: true });
      }
      return originalFetch(input, init);
    };
    window.addEventListener('pagehide', (event) => {
      try { localStorage.setItem('__konvaLocalPageHidePersisted', String(event.persisted)); } catch { /* Browser storage is optional in a test. */ }
    });
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    if (!apiPath(url.pathname)) return route.continue();
    requests.push({ method: request.method(), pathname: url.pathname, search: url.search });
    if (url.pathname === '/REST') return route.fulfill(jsonResponse({ nodes: { Controller: {} } }));
    ownerStarted?.();
    return new Promise<void>(() => {});
  });
  await page.goto('/topology-canvas.html?source=local');
  await started;
  await page.close();
  const statePage = await context.newPage();
  await statePage.goto('/topology-canvas.html?nodes=9');
  await expect.poll(() => statePage.evaluate(() => ({
    unloaded: localStorage.getItem('__konvaLocalPageHidePersisted'),
    aborted: localStorage.getItem('__konvaLocalOwnerAbort')
  }))).toEqual({ unloaded: 'false', aborted: 'true' });
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Controller/REST/remote', search: '' }
  ]);
  await statePage.close();
});

test('reciprocal actions with shared display name keep typed endpoints through physical card swaps', async ({ page }) => {
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { 'Example Frontend': {}, 'Example 2': {} } }));
    } else if (request.pathname === '/nodes/ExampleFrontend/REST/remote') {
      await route.fulfill(jsonResponse({
        actions: { Preset: { node: 'Example 2', action: 'power' } }
      }));
    } else if (request.pathname === '/nodes/Example2/REST/remote') {
      await route.fulfill(jsonResponse({ actions: { LogLevel: { node: 'Example Frontend', action: 'Preset' } } }));
    } else {
      throw new Error(`Unexpected reciprocal-wire fixture request ${request.pathname}`);
    }
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-fixture-summary]')).toContainText('2 configured');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  const inspect = () => page.evaluate(() => {
    type Pt = { x: number; y: number };
    type Shape = {
      id(): string; name(): string; x(): number; y(): number; width(): number; height(): number; text(): string; align(): string;
      getAttr(name: string): unknown;
      fill(): string; stroke(): string; getAbsolutePosition(top?: Shape): Pt; find(selector: string): Shape[];
      getSceneFunc(): (context: {
        beginPath(): void; moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
        lineTo(x: number, y: number): void; closePath(): void; stroke(): void; fill(): void; fillStyle: string; strokeStyle: string; lineWidth: number;
      }, shape: Shape) => void;
    };
    type Stage = Shape & {
      getContent(): HTMLElement; getAbsoluteTransform(): { point(point: Pt): Pt }; scaleX(): number;
      getLayers(): Array<{ name(): string; getNativeCanvasElement(): HTMLCanvasElement }>;
    };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva native stage registry is unavailable');
    const cards = stage.find('.topology-card');
    const card = (name: string) => cards.find((item) => item.find('Text').some((text) => text.text() === name));
    const frontend = card('Example Frontend');
    const example2 = card('Example 2');
    if (!frontend || !example2) throw new Error('Reciprocal fixture cards were not rendered');
    const endpoint = (owner: Shape, label: string, side: 'left' | 'right') => {
      const text = owner.find('Text').find((item) => item.text() === label && item.align() === (side === 'left' ? 'left' : 'right'));
      if (!text) throw new Error(`Missing ${side} ${label} endpoint label`);
      const socket = owner.find('Circle').find((item) => item.name().startsWith('socket-') && item.x() === (side === 'left' ? 0 : owner.find('Rect').find((rect) => rect.width() > 100)!.width()) && Math.abs(item.y() - text.y() - 7) < 0.1);
      if (!socket) throw new Error(`Missing ${side} ${label} socket`);
      return { label, side, point: socket.getAbsolutePosition(stage), socket: { id: socket.name(), fill: socket.fill(), stroke: socket.stroke() } };
    };
    const feAction = endpoint(frontend, 'Preset', 'right');
    const feLocalPreset = endpoint(frontend, 'Preset', 'left');
    const exPower = endpoint(example2, 'power', 'left');
    const exLogLevel = endpoint(example2, 'LogLevel', 'right');
    const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const candidates: Array<{ id: string; curves: Array<{ start: Pt; control1: Pt; control2: Pt; end: Pt }>; arrow?: Pt[]; color: string }> = [];
    for (const wire of stage.find('.topology-wire')) {
      const curves: Array<{ start: Pt; control1: Pt; control2: Pt; end: Pt }> = [];
      let start: Pt | undefined;
      let control1: Pt | undefined;
      let control2: Pt | undefined;
      let end: Pt | undefined;
      let move: Pt | undefined;
      let lines: Pt[] = [];
      let arrow: Pt[] | undefined;
      const context = {
        strokeStyle: '', fillStyle: '', lineWidth: 0,
        beginPath() { move = undefined; lines = []; },
        moveTo(x: number, y: number) { move = { x, y }; start = move; },
        bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) { control1 = { x: a, y: b }; control2 = { x: c, y: d }; end = { x, y }; },
        lineTo(x: number, y: number) { lines.push({ x, y }); },
        closePath() {},
        stroke() { if (start && control1 && control2 && end) curves.push({ start, control1, control2, end }); },
        fill() { if (move && lines.length === 2) arrow = [move, ...lines]; }
      };
      wire.getSceneFunc().call(wire, context, wire);
      candidates.push({ id: wire.id(), curves, ...(arrow ? { arrow } : {}), color: context.strokeStyle });
    }
    const byTerminals = (from: Pt, to: Pt) => {
      const match = candidates.find((candidate) => candidate.curves.length > 0
        && distance(candidate.curves[0]!.start, from) < 0.1 && distance(candidate.curves.at(-1)!.end, to) < 0.1);
      if (!match) throw new Error(`No drawn directed wire from ${from.x},${from.y} to ${to.x},${to.y}`);
      return match;
    };
    const layers = [...stage.getContent().querySelectorAll('canvas')];
    const [wireLayer, cardLayer] = stage.getLayers();
    if (layers.length !== 2 || wireLayer?.name() !== 'wires' || cardLayer?.name() !== 'cards'
      || layers[0] !== wireLayer.getNativeCanvasElement() || layers[1] !== cardLayer.getNativeCanvasElement()) {
      throw new Error('Expected visible wire canvas followed by visible card canvas in DOM paint order');
    }
    const firstLayer = layers[0];
    const bounds = firstLayer.getBoundingClientRect();
    for (const layer of layers) {
      const box = layer.getBoundingClientRect();
      const style = getComputedStyle(layer);
      if (style.visibility !== 'visible' || style.display === 'none' || style.opacity !== '1' || !box.width || !box.height
        || box.x !== bounds.x || box.y !== bounds.y || box.width !== bounds.width || box.height !== bounds.height
        || layer.width !== firstLayer.width || layer.height !== firstLayer.height) {
        throw new Error('The two scene canvases must be visible and share the same display and bitmap bounds');
      }
    }
    const transform = stage.getAbsoluteTransform();
    const screen = (point: Pt): Pt => {
      const projected = transform.point(point);
      return { x: bounds.left + projected.x * bounds.width / stage.width(), y: bounds.top + projected.y * bounds.height / stage.height() };
    };
    const rectangle = (owner: Shape) => {
      const body = owner.find('Rect')[0]!;
      const worldMin = body.getAbsolutePosition(stage);
      const worldMax = { x: worldMin.x + body.width(), y: worldMin.y + body.height() };
      return { worldMin, worldMax, screenMin: screen(worldMin), screenMax: screen(worldMax) };
    };
    const rectangles = { frontend: rectangle(frontend), example2: rectangle(example2) };
    const composite = document.createElement('canvas');
    composite.width = firstLayer.width;
    composite.height = firstLayer.height;
    const context = composite.getContext('2d', { willReadFrequently: true });
    const wireContext = firstLayer.getContext('2d');
    const cardContext = layers[1].getContext('2d');
    if (!context || !wireContext || !cardContext) throw new Error('Canvas compositing context is unavailable');
    // Preserve browser layer order. Both canvases are visible: wires first,
    // then opaque cards/sockets that can occlude a bad route.
    for (const layer of layers) context.drawImage(layer, 0, 0);
    const sample = (point: Pt, expectedColor: string) => {
      const screenPoint = screen(point);
      const pixelX = Math.round((screenPoint.x - bounds.left) * composite.width / bounds.width);
      const pixelY = Math.round((screenPoint.y - bounds.top) * composite.height / bounds.height);
      const match = expectedColor.match(/\d+/g)?.map(Number);
      if (!match || match.length < 3) throw new Error(`Cannot parse rendered color ${expectedColor}`);
      if (match.slice(0, 3).every((channel) => channel > 245)) throw new Error('Refusing white card-fill color as wire-ink evidence');
      const inkHits = (layer: CanvasRenderingContext2D) => {
        const data = layer.getImageData(pixelX - 3, pixelY - 3, 7, 7).data;
        let hits = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3]! > 0 && Math.abs(data[i]! - match[0]!) < 30 && Math.abs(data[i + 1]! - match[1]!) < 30 && Math.abs(data[i + 2]! - match[2]!) < 30) hits += 1;
        }
        return hits;
      };
      const hits = inkHits(context);
      // Wire-only ink is diagnostic, never a substitute for composited ink.
      return { hits, screenPoint, ...(hits ? {} : {
        worldPoint: point, bitmapPoint: { x: pixelX, y: pixelY }, wireLayerHits: inkHits(wireContext),
        cardPixel: Array.from(cardContext.getImageData(pixelX, pixelY, 1, 1).data)
      }) };
    };
    const preset = byTerminals(feAction.point, exPower.point);
    const logLevel = byTerminals(exLogLevel.point, feLocalPreset.point);
    const evidence = (wire: typeof preset, source: ReturnType<typeof endpoint>, target: ReturnType<typeof endpoint>) => {
      const curvePoint = (curve: typeof wire.curves[number], t: number) => {
        const u = 1 - t;
        return { x: u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.control1.x + 3 * u * t ** 2 * curve.control2.x + t ** 3 * curve.end.x,
          y: u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.control1.y + 3 * u * t ** 2 * curve.control2.y + t ** 3 * curve.end.y };
      };
      // Sample inside each segment, away from both socket/arrow joins. The
      // second visible canvas contains nodes/cards and is composited above
      // these wires, so a hidden route segment fails the pixel check.
      const pathSamples = wire.curves.flatMap((curve) => [0.15, 0.35, 0.5, 0.65, 0.85].map((t) => curvePoint(curve, t)));
      const checks = pathSamples.map((point) => sample(point, wire.color));
      const arrow = wire.arrow?.reduce((sum, point) => ({ x: sum.x + point.x / 3, y: sum.y + point.y / 3 }), { x: 0, y: 0 });
      const arrowPixels = arrow ? sample(arrow, wire.color) : { hits: 0, screenPoint: screen(wire.curves.at(-1)!.end) };
      const middleCurve = wire.curves[Math.floor(wire.curves.length / 2)]!;
      const socketPixels = (item: ReturnType<typeof endpoint>) => [
        sample({ x: item.point.x + 3.5, y: item.point.y }, item.socket.stroke),
        sample({ x: item.point.x - 3.5, y: item.point.y }, item.socket.stroke),
        sample({ x: item.point.x, y: item.point.y + 3.5 }, item.socket.stroke),
        sample({ x: item.point.x, y: item.point.y - 3.5 }, item.socket.stroke)
      ];
      return {
        curves: wire.curves, checks, arrowPixels, midpoint: screen(curvePoint(middleCurve, 0.5)), arrow: arrowPixels.screenPoint,
        sourceSocketPixels: socketPixels(source),
        targetSocketPixels: socketPixels(target)
      };
    };
    const style = getComputedStyle(document.documentElement);
    const tokens = (name: string, fallback: string) => style.getPropertyValue(`--nodel-${name}`).trim() || fallback;
    return {
      cards: { frontend: rectangles.frontend.screenMin, example2: rectangles.example2.screenMin, scale: stage.scaleX(), rectangles },
      wires: { preset: { id: preset.id, color: preset.color, source: feAction, target: exPower, ...evidence(preset, feAction, exPower) }, logLevel: { id: logLevel.id, color: logLevel.color, source: exLogLevel, target: feLocalPreset, ...evidence(logLevel, exLogLevel, feLocalPreset) } },
      bindingKind: 'action',
      colors: {
        accent: `rgb(${tokens('accent', '40 115 200')})`,
        action: `rgb(${tokens('topology-action', '37 99 235')})`,
        actionStrong: `rgb(${tokens('topology-action-strong', '29 78 216')})`,
        surface: `rgb(${tokens('surface', '255 255 255')})`
      }, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    };
  });

  const frame = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const initial = await inspect();
  await mkdir(artifactDir, { recursive: true });
  const screenshot = (state: string) => page.screenshot({ path: resolve(artifactDir, `reciprocal-actions-${state}.png`), animations: 'disabled' });
  expect(initial.cards.scale).toBe(1); // One physical pixel is one world pixel in this fixture.
  expect(initial.wires.preset.id).not.toBe(initial.wires.logLevel.id);
  expect(initial.wires.preset.source.label).toBe('Preset');
  expect(initial.wires.preset.source.side).toBe('right');
  expect(initial.wires.preset.target.label).toBe('power');
  expect(initial.wires.preset.target.side).toBe('left');
  expect(initial.wires.logLevel.source.label).toBe('LogLevel');
  expect(initial.wires.logLevel.source.side).toBe('right');
  expect(initial.wires.logLevel.target.label).toBe('Preset');
  expect(initial.wires.logLevel.target.side).toBe('left');
  expect(initial.wires.preset.source.label).toBe(initial.wires.logLevel.target.label);
  expect(initial.wires.preset.source.socket.id).not.toBe(initial.wires.logLevel.target.socket.id);
  for (const wire of Object.values(initial.wires)) {
    expect(wire.id).toMatch(/^e-(?:[0-9a-f]{4})+$/);
    expect(wire.id.length % 2).toBe(0);
  }
  const width = initial.cards.rectangles.frontend.worldMax.x - initial.cards.rectangles.frontend.worldMin.x;
  const centerX = width / 2;
  const headerY = 24;
  // Move one card down first. For both horizontal drags, the cards stay
  // physically disjoint even when their X intervals completely overlap.
  await page.mouse.move(initial.cards.frontend.x + centerX, initial.cards.frontend.y + headerY);
  await page.mouse.down();
  await page.mouse.move(initial.cards.frontend.x + centerX, initial.cards.example2.y + headerY + 140, { steps: 8 });
  await page.mouse.up();
  await frame();
  const before = await inspect();
  await screenshot('before');
  expect(before.cards.frontend.y - before.cards.example2.y).toBe(140);
  const assertDirect = (key: 'preset' | 'logLevel', scene: typeof before) => {
    const wire = scene.wires[key];
    expect(wire.curves, `${key} is one compact direct cubic`).toHaveLength(1);
    const curve = wire.curves[0]!;
    expect(curve.start).toEqual(wire.source.point);
    expect(curve.end).toEqual(wire.target.point);
    expect(curve.start.x).toBeLessThan(curve.end.x);
    expect(curve.control1.x).toBeGreaterThanOrEqual(curve.start.x);
    expect(curve.control1.x).toBeLessThanOrEqual(curve.control2.x);
    expect(curve.control2.x).toBeLessThanOrEqual(curve.end.x);
    expect(curve.control1.y).toBe(curve.start.y);
    expect(curve.control2.y).toBe(curve.end.y);
    // With horizontal endpoint tangents this compact cubic stays between the
    // real socket rows; it cannot loop around either card or reverse in X.
    let previousX = curve.start.x;
    for (const t of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      const u = 1 - t;
      const x = u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.control1.x + 3 * u * t ** 2 * curve.control2.x + t ** 3 * curve.end.x;
      const y = u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.control1.y + 3 * u * t ** 2 * curve.control2.y + t ** 3 * curve.end.y;
      expect(x, `${key} is monotone at t=${t}`).toBeGreaterThan(previousX);
      expect(x, `${key} is monotone at t=${t}`).toBeLessThan(curve.end.x);
      expect(y, `${key} remains within the two projected socket rows`).toBeGreaterThanOrEqual(Math.min(curve.start.y, curve.end.y));
      expect(y, `${key} remains within the two projected socket rows`).toBeLessThanOrEqual(Math.max(curve.start.y, curve.end.y));
      previousX = x;
    }
  };
  const assertExterior = (key: 'preset' | 'logLevel', scene: typeof before) => {
    const wire = scene.wires[key];
    expect(wire.curves.length, `${key} routes outside the opposing cards`).toBeGreaterThan(1);
    expect(wire.curves[0]!.start).toEqual(wire.source.point);
    expect(wire.curves.at(-1)!.end).toEqual(wire.target.point);
    const maxDetour = Math.max(...wire.curves.flatMap((curve) => [curve.control1.y, curve.control2.y]))
      - Math.min(...wire.curves.flatMap((curve) => [curve.control1.y, curve.control2.y]));
    expect(maxDetour, `${key} has a visibly exterior rail`).toBeGreaterThan(30);
  };
  const initialDirectKey = before.cards.example2.x < before.cards.frontend.x ? 'logLevel' : 'preset';
  const initialExteriorKey = initialDirectKey === 'logLevel' ? 'preset' : 'logLevel';
  assertDirect(initialDirectKey, before);
  assertExterior(initialExteriorKey, before);
  const assertPainted = (scene: typeof before) => {
    for (const key of ['preset', 'logLevel'] as const) {
      const wire = scene.wires[key];
      expect(wire.id).toBe(before.wires[key].id);
      const missingInk = wire.checks.filter((check) => check.hits === 0);
      expect(missingInk, `${key} is painted along the route; missing samples: ${JSON.stringify(missingInk)}`).toHaveLength(0);
      expect(wire.arrowPixels.hits, `${key} arrowhead is painted`).toBeGreaterThan(0);
      expect(wire.sourceSocketPixels.some((sample) => sample.hits > 0)).toBe(true);
      expect(wire.targetSocketPixels.some((sample) => sample.hits > 0)).toBe(true);
    }
    expect(Math.abs(scene.wires.preset.midpoint.y - scene.wires.logLevel.midpoint.y)).toBeGreaterThan(14);
  };
  const visibilitySamples: Array<typeof before> = [before];
  let capturedOverlap = false;

  const drag = async (start: typeof before, offsets: number[]) => {
    const y = start.cards.frontend.y + headerY;
    await page.mouse.move(start.cards.frontend.x + centerX, y);
    await page.mouse.down();
    let previous = start;
    for (const x of offsets) {
      const previousOffset = previous.cards.frontend.x - previous.cards.example2.x;
      await page.mouse.move(before.cards.example2.x + x + centerX, y, { steps: Math.max(1, Math.ceil(Math.abs(previousOffset - x) / 40)) });
      await frame();
      const current = await inspect();
      expect(current.cards.frontend.x - current.cards.example2.x).toBe(x);
      visibilitySamples.push(current);
      if (x === 0 && !capturedOverlap) {
        await screenshot('during-overlap');
        capturedOverlap = true;
      }
      if (Math.abs(x - previousOffset) === 1) {
        for (const key of ['preset', 'logLevel'] as const) {
          const a = previous.wires[key].midpoint;
          const b = current.wires[key].midpoint;
          expect(Math.hypot(a.x - b.x, a.y - b.y), `${key} midpoint at ${previousOffset}→${x}`).toBeLessThanOrEqual(1.01);
        }
      }
      previous = current;
    }
    await page.mouse.up();
    return previous;
  };

  const startsRight = before.cards.frontend.x > before.cards.example2.x;
  const gap40 = await drag(before, [startsRight ? 258 : -258]);
  const spatiallyForwardKey = startsRight ? 'logLevel' : 'preset';
  const forwardWire = gap40.wires[spatiallyForwardKey];
  expect(Math.abs(forwardWire.target.point.x - forwardWire.source.point.x), 'projected output/input sockets have a 40px clear gap').toBe(40);
  expect(Math.abs(gap40.cards.frontend.y - gap40.cards.example2.y)).toBe(140);
  await screenshot('gap-40');
  assertDirect(spatiallyForwardKey, gap40);
  assertExterior(spatiallyForwardKey === 'logLevel' ? 'preset' : 'logLevel', gap40);
  const thresholds = [218, 217, 0, -217, -218];
  const crossed = await drag(gap40, startsRight ? [...thresholds, -290] : [...thresholds.slice().reverse(), 290]);
  const swappedDirectKey = crossed.cards.example2.x < crossed.cards.frontend.x ? 'logLevel' : 'preset';
  expect(swappedDirectKey, 'crossing the cards swaps which directed route is direct').not.toBe(initialDirectKey);
  assertDirect(swappedDirectKey, crossed);
  assertExterior(swappedDirectKey === 'logLevel' ? 'preset' : 'logLevel', crossed);
  await screenshot('after');
  // Cross back over both branch boundaries, then park with overlapping X
  // ranges so the two rails must both be available in the Konva hit canvas.
  const returned = await drag(crossed, startsRight ? [...thresholds.slice().reverse(), 290] : [...thresholds, -290]);
  const overlapped = await drag(returned, [120]);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const stageBounds = await page.locator('.canvas-stage').boundingBox();
  if (!stageBounds) throw new Error('Canvas stage has no bounds for pan interaction');
  await page.mouse.move(stageBounds.x + 18, stageBounds.y + 18);
  await page.mouse.down();
  await page.mouse.move(stageBounds.x + 48, stageBounds.y + 42, { steps: 3 });
  await page.mouse.up();
  await frame();
  const zoomedAndPanned = await inspect();
  expect(zoomedAndPanned.cards.scale).toBeGreaterThan(1);
  expect(zoomedAndPanned.wires.preset.midpoint).not.toEqual(overlapped.wires.preset.midpoint);
  for (const key of ['preset', 'logLevel'] as const) {
    const chosen = zoomedAndPanned.wires[key];
    const other = key === 'preset' ? 'logLevel' : 'preset';
    await page.mouse.click(chosen.midpoint.x, chosen.midpoint.y);
    await frame();
    const selected = await inspect();
    visibilitySamples.push(selected);
    expect(selected.bindingKind).toBe('action');
    expect(selected.wires[key].color).toBe(selected.colors.actionStrong);
    expect(selected.wires[other].color).toBe(selected.colors.action);
    for (const endpoint of ['source', 'target'] as const) {
      const selectedSocket = selected.wires[key][endpoint].socket;
      const otherSocket = selected.wires[other][endpoint].socket;
      expect(selectedSocket.stroke).toBe(selected.colors.actionStrong);
      expect(selectedSocket.fill).toBe(endpoint === 'target' ? selected.colors.actionStrong : selected.colors.surface);
      expect(otherSocket.stroke).toBe(selected.colors.action);
      expect(otherSocket.fill).toBe(endpoint === 'target' ? selected.colors.action : selected.colors.surface);
    }
    await screenshot(`selected-${key}`);
  }
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
      { method: 'GET', pathname: '/nodes/Example2/REST/remote', search: '' },
      { method: 'GET', pathname: '/nodes/ExampleFrontend/REST/remote', search: '' }
  ]);
  // Run the composited-pixel assertions after captures and physical clicks so
  // a failure still leaves before/gap/after evidence for visual diagnosis.
  for (const key of ['preset', 'logLevel'] as const) {
    const missingInk = gap40.wires[key].checks.filter((check) => check.hits === 0);
    expect(missingInk, `${key} stays visible along every segment at dy=140 / port gap=40; cards: ${JSON.stringify(gap40.cards.rectangles)}; missing: ${JSON.stringify(missingInk)}`).toHaveLength(0);
  }
  for (const scene of visibilitySamples) assertPainted(scene);
});

test('event subscribers select only their exact typed binding through real exposed wire hit points', async ({ page }) => {
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { 'Example 1': {}, 'Example 2': {}, 'Example Frontend': {} } }));
    } else if (request.pathname === '/nodes/Example1/REST/remote') {
      await route.fulfill(jsonResponse({ events: { Gate2Input1: { node: 'Example 2', event: 'LogLevel' } } }));
    } else if (request.pathname === '/nodes/Example2/REST/remote') {
      await route.fulfill(jsonResponse({}));
    } else if (request.pathname === '/nodes/ExampleFrontend/REST/remote') {
      await route.fulfill(jsonResponse({ events: {
        Preset: { node: 'Example 2', event: 'LogLevel' },
        Switch: { node: 'Example 1', event: 'Gate1Output' }
      } }));
    } else {
      throw new Error(`Unexpected event-selection fixture request ${request.pathname}`);
    }
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('[data-fixture-summary]')).toContainText('3 configured');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);

  type Point = { x: number; y: number };
  type Endpoint = { node: string; port: string; kind: string; side: 'left' | 'right'; point: Point; fill: string; stroke: string };
  type Curve = { start: Point; control1: Point; control2: Point; end: Point };
  type Wire = { id: string; kind: string; owner: string; from: Endpoint; to: Endpoint; color: string; width: number; curves: Curve[]; painted?: number[]; candidates?: Point[]; click?: Point; hit?: string };
  type Scene = { wires: Record<'upstream' | 'preset' | 'switch', Wire>; sockets: Endpoint[]; cardIds: Record<string, string>; example1Bounds: { x: number; y: number; right: number; bottom: number }; example1Header: Point; colors: { event: string; strong: string; surface: string } };
  const inspect = (probeHits = false): Promise<Scene> => page.evaluate((probe) => {
    type Pt = { x: number; y: number };
    type Shape = {
      id(): string; name(): string; x(): number; y(): number; text(): string; align(): string; fill(): string; stroke(): string; getAttr(name: string): unknown;
      getAbsolutePosition(top?: Shape): Pt; find(selector: string): Shape[];
      getSceneFunc(): (context: {
        beginPath(): void; moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
        lineTo(x: number, y: number): void; closePath(): void; stroke(): void; fill(): void; fillStyle: string; strokeStyle: string; lineWidth: number;
      }, shape: Shape) => void;
    };
    type Stage = Shape & {
      getContent(): HTMLElement; getAbsoluteTransform(): { point(point: Pt): Pt }; scaleX(): number; width(): number; height(): number;
      getIntersection(point: Pt): Shape | null;
    };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage unavailable');
    const cards = stage.find('.topology-card');
    const cardName = (card: Shape) => card.find('Text').find((text) => text.align() === 'left' && text.getAbsolutePosition(stage).y < card.getAbsolutePosition(stage).y + 40)?.text();
    const cardIds = Object.fromEntries(cards.map((card) => [cardName(card) ?? '<unlabelled>', card.id()]));
    const example1Card = cards.find((card) => cardName(card) === 'Example 1');
    const example1Body = example1Card?.find('Rect').find((rect) => rect.width() > 100);
    if (!example1Card || !example1Body) throw new Error('Example 1 body bounds are unavailable');
    const example1Origin = example1Body.getAbsolutePosition(stage);
    const headerWorld = stage.getAbsoluteTransform().point({ x: example1Origin.x + 80, y: example1Origin.y + 20 });
    const contentRect = stage.getContent().getBoundingClientRect();
    const example1Header = { x: contentRect.left + headerWorld.x * contentRect.width / stage.width(), y: contentRect.top + headerWorld.y * contentRect.height / stage.height() };
    const sockets: Endpoint[] = cards.flatMap((card) => {
      const owner = cardName(card);
      if (!owner) return [];
      const labels = card.find('Text');
      return card.find('Circle').filter((socket) => socket.name().startsWith('socket-')).map((socket) => {
        const side = socket.x() === 0 ? 'left' : 'right';
        const label = labels.find((text) => text.align() === side && Math.abs(text.y() + 7 - socket.y()) < 0.1);
        return { node: owner, port: label?.text() ?? '<unlabelled>', kind: String(socket.getAttr('localKind') ?? ''), side,
          point: socket.getAbsolutePosition(stage), fill: socket.fill(), stroke: socket.stroke() };
      });
    });
    const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const endpointFor = (point: Pt) => {
      const match = sockets.find((socket) => distance(socket.point, point) < 0.1);
      if (!match) throw new Error(`Wire endpoint ${point.x},${point.y} does not resolve to a rendered socket`);
      return match;
    };
    const rect = stage.getContent().getBoundingClientRect();
    const transform = stage.getAbsoluteTransform();
    const screen = (point: Pt) => {
      const scaled = transform.point(point);
      return { x: rect.left + scaled.x * rect.width / stage.width(), y: rect.top + scaled.y * rect.height / stage.height() };
    };
    const wires: Wire[] = stage.find('.topology-wire').filter((wire) => wire.getAttr('bindingKind') === 'event').map((wire) => {
      const curves: Array<{ start: Pt; control1: Pt; control2: Pt; end: Pt }> = [];
      let start: Pt | undefined;
      let color = '';
      let width = 0;
      const context = {
        strokeStyle: '', fillStyle: '', lineWidth: 0,
        beginPath() { start = undefined; },
        moveTo(x: number, y: number) { start = { x, y }; },
        bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) { if (start) curves.push({ start, control1: { x: a, y: b }, control2: { x: c, y: d }, end: { x, y } }); },
        lineTo() {}, closePath() {}, fill() {},
        stroke() { color = this.strokeStyle; width = this.lineWidth; }
      };
      wire.getSceneFunc().call(wire, context, wire);
      if (curves.length === 0) throw new Error(`Event wire ${wire.id()} rendered no curves`);
      const candidates = curves.flatMap((curve) => [0.2, 0.4, 0.6, 0.8].map((t) => {
        const u = 1 - t;
        return screen({
          x: u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.control1.x + 3 * u * t ** 2 * curve.control2.x + t ** 3 * curve.end.x,
          y: u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.control1.y + 3 * u * t ** 2 * curve.control2.y + t ** 3 * curve.end.y
        });
      }));
      return { id: wire.id(), kind: 'event', owner: String(wire.getAttr('ownerId')), from: endpointFor(curves[0]!.start),
        to: endpointFor(curves.at(-1)!.end), color, width, curves, candidates };
    });
    const by = (source: string, sourcePort: string, target: string, targetPort: string) => {
      const matches = wires.filter((wire) => wire.from.node === source && wire.from.port === sourcePort && wire.to.node === target && wire.to.port === targetPort);
      if (matches.length !== 1) throw new Error(`Expected one event wire ${source}.${sourcePort} → ${target}.${targetPort}, got ${matches.length}`);
      return matches[0]!;
    };
    const selected = {
       upstream: by('Example 2', 'LogLevel', 'Example 1', 'Gate2Input1'),
       preset: by('Example 2', 'LogLevel', 'Example Frontend', 'Preset'),
       switch: by('Example 1', 'Gate1Output', 'Example Frontend', 'Switch')
    };
    if (wires.length !== 3 || new Set(Object.values(selected).map((wire) => wire.id)).size !== 3) {
      throw new Error(`Expected exactly three uniquely identified event bindings, got ${wires.length}`);
    }
    const content = stage.getContent();
    const [wireCanvas, cardCanvas] = [...content.querySelectorAll('canvas')];
    if (!wireCanvas || !cardCanvas) throw new Error('Expected both composited scene canvases');
    const composite = document.createElement('canvas');
    composite.width = wireCanvas.width;
    composite.height = wireCanvas.height;
    const compositeContext = composite.getContext('2d', { willReadFrequently: true });
    const wireContext = wireCanvas.getContext('2d', { willReadFrequently: true });
    if (!compositeContext || !wireContext) throw new Error('Canvas pixel inspection unavailable');
    compositeContext.drawImage(wireCanvas, 0, 0);
    compositeContext.drawImage(cardCanvas, 0, 0);
    const canvasBounds = wireCanvas.getBoundingClientRect();
    for (const wire of wires) {
      const rgb = wire.color.match(/\d+/g)?.map(Number);
      if (!rgb || rgb.length < 3) throw new Error(`Cannot read wire color ${wire.color}`);
      wire.painted = wire.curves.flatMap((curve) => [0.2, 0.5, 0.8].map((t) => {
        const u = 1 - t;
        const point = screen({
          x: u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.control1.x + 3 * u * t ** 2 * curve.control2.x + t ** 3 * curve.end.x,
          y: u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.control1.y + 3 * u * t ** 2 * curve.control2.y + t ** 3 * curve.end.y
        });
        const x = Math.round((point.x - canvasBounds.left) * composite.width / canvasBounds.width);
        const y = Math.round((point.y - canvasBounds.top) * composite.height / canvasBounds.height);
        const pixels = compositeContext.getImageData(x - 2, y - 2, 5, 5).data;
        let hits = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3]! > 0 && Math.abs(pixels[index]! - rgb[0]!) < 30 && Math.abs(pixels[index + 1]! - rgb[1]!) < 30 && Math.abs(pixels[index + 2]! - rgb[2]!) < 30) hits += 1;
        }
        return hits;
      }));
    }
    if (!probe) for (const wire of Object.values(selected)) delete wire.candidates;
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => style.getPropertyValue(`--nodel-${name}`).trim() || fallback;
    return { wires: selected, sockets, cardIds,
      example1Bounds: { x: example1Origin.x, y: example1Origin.y, right: example1Origin.x + example1Body.width(), bottom: example1Origin.y + example1Body.height() }, example1Header, colors: {
      event: `rgb(${token('topology-event', '13 148 136')})`, strong: `rgb(${token('topology-event-strong', '15 118 110')})`,
      surface: `rgb(${token('surface', '255 255 255')})`
    } };
  }, probeHits);

  const frame = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const initial = await inspect(true);
  await mkdir(artifactDir, { recursive: true });
  const initialScreenshot = resolve(artifactDir, 'local-mode-auto-initial.png');
  await page.screenshot({ path: initialScreenshot, animations: 'disabled' });
  expect(initial.wires.upstream.from).toMatchObject({ node: 'Example 2', port: 'LogLevel', side: 'right' });
  expect(initial.wires.upstream.to).toMatchObject({ node: 'Example 1', port: 'Gate2Input1', side: 'left' });
  expect(initial.wires.preset.from).toMatchObject({ node: 'Example 2', port: 'LogLevel', side: 'right' });
  expect(initial.wires.preset.to).toMatchObject({ node: 'Example Frontend', port: 'Preset', side: 'left' });
  expect(initial.wires.switch.from).toMatchObject({ node: 'Example 1', port: 'Gate1Output', side: 'right' });
  expect(initial.wires.switch.to).toMatchObject({ node: 'Example Frontend', port: 'Switch', side: 'left' });
  expect(new Set(Object.values(initial.wires).map((wire) => wire.id)).size).toBe(3);
  for (const wire of Object.values(initial.wires)) {
    for (const candidate of wire.candidates ?? []) {
      await page.mouse.move(candidate.x, candidate.y);
      const hit = await page.evaluate(() => {
        type HitShape = { id(): string };
        type HitStage = { getPointerPosition(): Point | null; getIntersection(point: Point): HitShape | null };
        const stage = (window as Window & { Konva?: { stages?: HitStage[] } }).Konva?.stages?.[0];
        const pointer = stage?.getPointerPosition();
        return pointer ? stage?.getIntersection(pointer)?.id() : undefined;
      });
      if (hit === wire.id) { wire.click = candidate; wire.hit = hit; break; }
    }
    expect(wire.hit, `${wire.id} has a unique visible click point whose native hit is that exact edge`).toBe(wire.id);
  }
  expect(initial.wires.upstream.owner).toBe(initial.cardIds['Example 1']);
  expect(initial.wires.preset.owner).toBe(initial.cardIds['Example Frontend']);
  expect(initial.wires.switch.owner).toBe(initial.cardIds['Example Frontend']);
  expect(initial.wires.upstream.from).toMatchObject({ node: 'Example 2', port: 'LogLevel', kind: 'local-event', side: 'right' });
  expect(initial.wires.upstream.to).toMatchObject({ node: 'Example 1', port: 'Gate2Input1', kind: 'remote-event', side: 'left' });
  expect(initial.wires.preset.from).toMatchObject({ node: 'Example 2', port: 'LogLevel', kind: 'local-event', side: 'right' });
  expect(initial.wires.preset.to).toMatchObject({ node: 'Example Frontend', port: 'Preset', kind: 'remote-event', side: 'left' });
  expect(initial.wires.switch.from).toMatchObject({ node: 'Example 1', port: 'Gate1Output', kind: 'local-event', side: 'right' });
  expect(initial.wires.switch.to).toMatchObject({ node: 'Example Frontend', port: 'Switch', kind: 'remote-event', side: 'left' });
  for (const wire of Object.values(initial.wires)) {
    expect(wire.id).not.toBe('');
    expect(wire.hit).toBe(wire.id);
    expect(wire.color).toBe(initial.colors.event);
    expect(wire.width).toBe(1.6);
  }
  expect(initial.wires.preset.from.point).toEqual(initial.wires.upstream.from.point);
  expect(initial.wires.preset.to.point).not.toEqual(initial.wires.upstream.to.point);
  for (const [key, wire] of Object.entries(initial.wires)) {
    expect(wire.painted, `${key} remains visible after cards composite above wires`).toBeDefined();
    expect(wire.painted!.every((hits) => hits > 0), `${key} visible composite pixels ${JSON.stringify(wire.painted)}`).toBe(true);
  }
  const bypass = initial.wires.preset;
  for (const curve of bypass.curves) {
    for (const t of [0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9]) {
      const u = 1 - t;
      const x = u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.control1.x + 3 * u * t ** 2 * curve.control2.x + t ** 3 * curve.end.x;
      const y = u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.control1.y + 3 * u * t ** 2 * curve.control2.y + t ** 3 * curve.end.y;
      const bounds = initial.example1Bounds;
      expect(x < bounds.x - 16 || x > bounds.right + 16 || y < bounds.y - 16 || y > bounds.bottom + 16,
        `Preset bypass stays outside Example 1 padded body at t=${t}: ${x},${y} vs ${JSON.stringify(bounds)}`).toBe(true);
    }
  }

  const assertSelection = (scene: Scene, selected?: keyof Scene['wires']) => {
    const selectedWire = selected ? scene.wires[selected] : undefined;
    for (const [key, wire] of Object.entries(scene.wires) as Array<[keyof Scene['wires'], Wire]>) {
      expect(wire.color, `${key} wire hue`).toBe(key === selected ? scene.colors.strong : scene.colors.event);
      expect(wire.width, `${key} stroke width`).toBe(key === selected ? 3.2 : 1.6);
    }
    const activeSocketIds = new Set(selectedWire ? [
      `${selectedWire.from.node}.${selectedWire.from.port}`,
      `${selectedWire.to.node}.${selectedWire.to.port}`
    ] : []);
    for (const socket of scene.sockets) {
      const active = activeSocketIds.has(`${socket.node}.${socket.port}`);
      expect(socket.stroke, `${socket.node}.${socket.port} stroke`).toBe(active ? scene.colors.strong : scene.colors.event);
      expect(socket.fill, `${socket.node}.${socket.port} endpoint role`).toBe(socket.kind === 'local-event'
        ? active ? scene.colors.strong : scene.colors.event
        : scene.colors.surface);
    }
    expect(scene.sockets.filter((socket) => activeSocketIds.has(`${socket.node}.${socket.port}`))).toHaveLength(selected ? 2 : 0);
    if (selected) {
      expect(selectedWire?.from.fill).toBe(scene.colors.strong);
      expect(selectedWire?.to.fill).toBe(scene.colors.surface);
    }
  };
  assertSelection(initial);
  await mkdir(artifactDir, { recursive: true });
  for (const key of ['upstream', 'preset', 'switch'] as const) {
    const wire = initial.wires[key];
    if (!wire.click) throw new Error(`Missing trusted click point for ${key}`);
    await page.mouse.click(wire.click.x, wire.click.y);
    await frame();
    const selected = await inspect();
    expect(selected.wires[key].color, `${key} is the selected binding`).toBe(selected.colors.strong);
    assertSelection(selected, key);
    await page.screenshot({ path: resolve(artifactDir, `event-selected-${key}.png`), animations: 'disabled' });
  }
  const bypassBeforeDrag = JSON.stringify((await inspect()).wires.preset.curves);
  await page.mouse.move(initial.example1Header.x, initial.example1Header.y);
  await page.mouse.down();
  await page.mouse.move(initial.example1Header.x + 35, initial.example1Header.y + 25, { steps: 4 });
  await page.mouse.up();
  await frame();
  const afterExample1Drag = await inspect();
  expect(JSON.stringify(afterExample1Drag.wires.preset.curves), 'the unrelated Example 2→Frontend bypass does not continuously reroute').toBe(bypassBeforeDrag);
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Example1/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/Example2/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/ExampleFrontend/REST/remote', search: '' }
  ]);
});

for (const returnCount of [2, 3, 4]) test(`${returnCount} same-direction returns keep separate painted rails and independent physical selection`, async ({ page }) => {
  const returnSpecs = [
    { key: 'alpha', output: 'Return Alpha', input: 'Return Input Alpha' },
    { key: 'bravo', output: 'Return Bravo', input: 'Return Input Bravo' },
    { key: 'charlie', output: 'Return Charlie', input: 'Return Input Charlie' },
    { key: 'delta', output: 'Return Delta', input: 'Return Input Delta' }
  ].slice(0, returnCount);
  const returns = returnSpecs.map(({ key }) => key);
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { Source: {}, Target: {} } }));
    } else if (request.pathname === '/nodes/Source/REST/remote') {
      await route.fulfill(jsonResponse({
        actions: { Forward: { node: 'Target', action: 'Forward Input' } }
      }));
    } else if (request.pathname === '/nodes/Target/REST/remote') {
      await route.fulfill(jsonResponse({
        actions: Object.fromEntries(returnSpecs.map(({ output, input }) => [output, { node: 'Source', action: input }]))
      }));
    } else {
      throw new Error(`Unexpected parallel-return fixture request ${request.pathname}`);
    }
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-fixture-summary]')).toContainText(`${returnSpecs.length + 1} configured`);
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  type Point = { x: number; y: number };
  type RouteScene = {
    id: string;
    source: { label: string; point: Point; socket: { id: string; fill: string; stroke: string } };
    target: { label: string; point: Point; socket: { id: string; fill: string; stroke: string } };
    curves: Array<{ start: Point; control1: Point; control2: Point; end: Point }>;
    color: string;
    arrowColor: string;
    rail: { start: Point; end: Point; midpoint: Point; pixels: number; leftLeg: Point; rightLeg: Point };
  };
  type Scene = { scale: number; accent: string; routes: Record<string, RouteScene>; socketStates: Record<string, { fill: string; stroke: string }> };
  const inspect = (): Promise<Scene> => page.evaluate((returnSpecs): Scene => {
    type Pt = { x: number; y: number };
    type Shape = {
      id(): string; name(): string; x(): number; y(): number; width(): number; height(): number; text(): string; align(): string;
      fill(): string; stroke(): string; getAbsolutePosition(top?: Shape): Pt; find(selector: string): Shape[];
      getSceneFunc(): (context: {
        beginPath(): void; moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
        lineTo(x: number, y: number): void; closePath(): void; stroke(): void; fill(): void; fillStyle: string; strokeStyle: string; lineWidth: number;
      }, shape: Shape) => void;
    };
    type Layer = { name(): string; getNativeCanvasElement(): HTMLCanvasElement };
    type Stage = Shape & {
      getContent(): HTMLElement; getAbsoluteTransform(): { point(point: Pt): Pt }; scaleX(): number; width(): number; height(): number;
      getLayers(): Layer[]; container(): HTMLElement;
    };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva native stage registry is unavailable');
    const cards = stage.find('.topology-card');
    const card = (name: string) => cards.find((item) => item.find('Text').some((text) => text.text() === name));
    const sourceCard = card('Source');
    const targetCard = card('Target');
    if (!sourceCard || !targetCard) throw new Error('Parallel-return fixture cards were not rendered');
    const endpoint = (owner: Shape, label: string, side: 'left' | 'right') => {
      const text = owner.find('Text').find((item) => item.text() === label && item.align() === side);
      if (!text) throw new Error(`Missing ${side} ${label} endpoint label`);
      const body = owner.find('Rect').find((item) => item.width() > 100);
      const socket = owner.find('Circle').find((item) => item.name().startsWith('socket-')
        && item.x() === (side === 'left' ? 0 : body?.width()) && Math.abs(item.y() - text.y() - 7) < 0.1);
      if (!socket) throw new Error(`Missing ${side} ${label} socket`);
      return { label, point: socket.getAbsolutePosition(stage), socket: { id: socket.name(), fill: socket.fill(), stroke: socket.stroke() } };
    };
    const expected: Record<string, { source: ReturnType<typeof endpoint>; target: ReturnType<typeof endpoint> }> = {
      forward: { source: endpoint(sourceCard, 'Forward', 'right'), target: endpoint(targetCard, 'Forward Input', 'left') }
    };
    for (const { key, output, input } of returnSpecs) expected[key] = {
      source: endpoint(targetCard, output, 'right'), target: endpoint(sourceCard, input, 'left')
    };
    const layers = [...stage.getContent().querySelectorAll('canvas')];
    const [wireLayer, cardLayer] = stage.getLayers();
    if (layers.length !== 2 || wireLayer?.name() !== 'wires' || cardLayer?.name() !== 'cards'
      || layers[0] !== wireLayer.getNativeCanvasElement() || layers[1] !== cardLayer.getNativeCanvasElement()) {
      throw new Error('Expected visible wire canvas followed by visible card canvas in DOM paint order');
    }
    const firstLayer = layers[0];
    const bounds = firstLayer.getBoundingClientRect();
    for (const layer of layers) {
      const box = layer.getBoundingClientRect();
      const style = getComputedStyle(layer);
      if (style.visibility !== 'visible' || style.display === 'none' || style.opacity !== '1' || !box.width || !box.height
        || box.x !== bounds.x || box.y !== bounds.y || box.width !== bounds.width || box.height !== bounds.height
        || layer.width !== firstLayer.width || layer.height !== firstLayer.height) throw new Error('Visible scene layers do not share identical bounds');
    }
    const composite = document.createElement('canvas');
    composite.width = firstLayer.width;
    composite.height = firstLayer.height;
    const pixels = composite.getContext('2d', { willReadFrequently: true });
    if (!pixels) throw new Error('Composited canvas readback is unavailable');
    for (const layer of layers) pixels.drawImage(layer, 0, 0);
    const transform = stage.getAbsoluteTransform();
    const screen = (point: Pt): Pt => {
      const projected = transform.point(point);
      return { x: bounds.left + projected.x * bounds.width / stage.width(), y: bounds.top + projected.y * bounds.height / stage.height() };
    };
    const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const style = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => style.getPropertyValue(`--nodel-${name}`).trim() || fallback;
    const accent = `rgb(${token('accent', '40 115 200')})`;
    const action = `rgb(${token('topology-action', '37 99 235')})`;
    const actionStrong = `rgb(${token('topology-action-strong', '29 78 216')})`;
    const surface = `rgb(${token('surface', '255 255 255')})`;
    const routes: Record<string, RouteScene> = {};
    const used = new Set<string>();
    for (const [key, terminals] of Object.entries(expected)) {
      const candidates: Array<{ wire: Shape; curves: Array<{ start: Pt; control1: Pt; control2: Pt; end: Pt }>; color: string; arrowColor: string }> = [];
      for (const wire of stage.find('.topology-wire')) {
        const curves: Array<{ start: Pt; control1: Pt; control2: Pt; end: Pt }> = [];
        let current: { start: Pt; control1?: Pt; control2?: Pt; end?: Pt } | undefined;
        let color = '';
        let arrowColor = '';
        const context = {
          strokeStyle: '', fillStyle: '', lineWidth: 0,
          beginPath() { current = undefined; },
          moveTo(x: number, y: number) { current = { start: { x, y } }; },
          bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
            if (current) { current.control1 = { x: a, y: b }; current.control2 = { x: c, y: d }; current.end = { x, y }; }
          },
           lineTo() {}, closePath() {}, fill() { arrowColor = this.fillStyle; },
          stroke() {
            color = this.strokeStyle;
            if (current?.control1 && current.control2 && current.end) curves.push({ ...current, control1: current.control1, control2: current.control2, end: current.end });
          }
        };
         wire.getSceneFunc().call(wire, context, wire);
         if (curves.length && distance(curves[0]!.start, terminals.source.point) < 0.1 && distance(curves.at(-1)!.end, terminals.target.point) < 0.1) candidates.push({ wire, curves, color, arrowColor });
      }
      if (candidates.length !== 1 || used.has(candidates[0]!.wire.id())) throw new Error(`Expected exactly one unclaimed rendered wire for ${key}, got ${candidates.length}`);
      const candidate = candidates[0]!;
      used.add(candidate.wire.id());
       const segment = candidate.curves.reduce((longest, curve) => distance(curve.start, curve.end) > distance(longest.start, longest.end) ? curve : longest);
       const verticalLegs = candidate.curves.filter((curve) => Math.abs(curve.start.x - curve.end.x) < 0.1
         && Math.abs(curve.start.y - curve.end.y) > 20).sort((a, b) => a.start.x - b.start.x);
       const legMidpoint = (curve: typeof verticalLegs[number]) => screen({ x: curve.start.x, y: (curve.start.y + curve.end.y) / 2 });
      const midpoint = { x: (segment.start.x + segment.end.x) / 2, y: (segment.start.y + segment.end.y) / 2 };
      const viewport = screen(midpoint);
      const pixelX = Math.round((viewport.x - bounds.left) * composite.width / bounds.width);
      const pixelY = Math.round((viewport.y - bounds.top) * composite.height / bounds.height);
      const rgb = candidate.color.match(/\d+/g)?.map(Number);
      if (!rgb || rgb.length < 3) throw new Error(`Unrecognized wire ink ${candidate.color}`);
      let painted = false;
      for (let y = -3; y <= 3; y += 1) for (let x = -3; x <= 3; x += 1) {
        const pixel = pixels.getImageData(pixelX + x, pixelY + y, 1, 1).data;
        if (pixel[3]! > 0 && rgb.slice(0, 3).every((channel, index) => Math.abs(pixel[index]! - channel) < 30)) painted = true;
      }
      routes[key] = {
         id: candidate.wire.id(), source: terminals.source, target: terminals.target, curves: candidate.curves, color: candidate.color, arrowColor: candidate.arrowColor,
         rail: { start: screen(segment.start), end: screen(segment.end), midpoint: screen(midpoint), pixels: distance(screen(segment.start), screen(segment.end)) * devicePixelRatio,
           leftLeg: verticalLegs.length >= 2 ? legMidpoint(verticalLegs[0]!) : screen(midpoint),
           rightLeg: verticalLegs.length >= 2 ? legMidpoint(verticalLegs.at(-1)!) : screen(midpoint) }
      };
      if (!painted) throw new Error(`The composited wire/card layers do not paint the ${key} rail midpoint`);
    }
    const socketStates: Record<string, { fill: string; stroke: string }> = {};
    for (const cardItem of cards) for (const socket of cardItem.find('Circle').filter((item) => item.name().startsWith('socket-'))) {
      socketStates[socket.name()] = { fill: socket.fill(), stroke: socket.stroke() };
    }
    return { scale: stage.scaleX(), accent, action, actionStrong, surface, routes, socketStates };
  }, returnSpecs);

  const frame = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const beforeMove = await inspect();
  expect(beforeMove.scale).toBe(1);
  const target = await page.evaluate(() => {
    type Shape = { text(): string; getParent(): { x(): number; y(): number } };
    type Stage = { find(selector: string): Shape[] };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    const title = stage?.find('Text').find((shape) => shape.text() === 'Target');
    if (!title) throw new Error('Target title is unavailable');
    const group = title.getParent();
    return { x: group.x(), y: group.y() };
  });
  const sourcePosition = await page.evaluate(() => {
    type Shape = { text(): string; getParent(): { x(): number; y(): number } };
    type Stage = { find(selector: string): Shape[] };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    const title = stage?.find('Text').find((shape) => shape.text() === 'Source');
    if (!title) throw new Error('Source title is unavailable');
    const group = title.getParent();
    return { x: group.x(), y: group.y() };
  });
  const separatedTargetX = sourcePosition.x + 80;
  const camera = await page.evaluate(() => {
    type Stage = { x(): number; y(): number; scaleX(): number };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage camera is unavailable');
    return { x: stage.x(), y: stage.y(), scale: stage.scaleX() };
  });
  const scale = camera.scale;
  const bounds = await page.locator('.canvas-stage').boundingBox();
  if (!bounds) throw new Error('Canvas stage has no bounds');
  const screenPoint = (point: Point) => ({ x: bounds.x + camera.x + point.x * scale, y: bounds.y + camera.y + point.y * scale });
  const targetHeader = screenPoint({ x: target.x + 100, y: target.y + 24 });
  await page.mouse.move(targetHeader.x, targetHeader.y);
  await page.mouse.down();
  await page.mouse.move(targetHeader.x + sourcePosition.x - target.x + 80, targetHeader.y + sourcePosition.y - target.y + 350, { steps: 12 });
  await page.mouse.up();
  await frame();
  const initial = await inspect();
  expect(initial.scale).toBe(1);
  for (const key of returns) {
    expect(initial.routes[key]!.rail.pixels, `${key} long rail is measured at 100%`).toBeGreaterThan(220);
  }
  const laneYs = returns.map((key) => initial.routes[key]!.rail.midpoint.y).sort((a, b) => a - b);
   for (let index = 1; index < laneYs.length; index += 1) {
    expect(laneYs[index]! - laneYs[index - 1]!, 'composited long-rail lane spacing stays usable at 100%').toBeGreaterThanOrEqual(10);
    expect(laneYs[index]! - laneYs[index - 1]!).toBeLessThanOrEqual(14);
   }
   for (const side of ['leftLeg', 'rightLeg'] as const) {
     const xs = returns.map((key) => initial.routes[key]!.rail[side].x).sort((a, b) => a - b);
     for (let index = 1; index < xs.length; index += 1) {
       expect(xs[index]! - xs[index - 1]!, `${side} rendered X lane spacing is approximately 12px`).toBeGreaterThanOrEqual(10);
       expect(xs[index]! - xs[index - 1]!).toBeLessThanOrEqual(14);
     }
   }
  expect(initial.routes.forward!.curves.length, 'reciprocal forward path is rendered as curves').toBeGreaterThan(0);
  expect(new Set(returns.map((key) => initial.routes[key]!.id)).size).toBe(returns.length);

  const dragTargetX = async (x: number) => {
    const cardPosition = await page.evaluate(() => {
      type Shape = { text(): string; getParent(): { x(): number; y(): number } };
      type Stage = { find(selector: string): Shape[] };
      const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
      const title = stage?.find('Text').find((shape) => shape.text() === 'Target');
      if (!title) throw new Error('Target title is unavailable during the crossing drag');
      const group = title.getParent();
      return { x: group.x(), y: group.y() };
    });
    // Move from a known point inside Target's header; x is the new card origin.
    const from = screenPoint({ x: cardPosition.x + 100, y: cardPosition.y + 24 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + (x - cardPosition.x) * scale, from.y, { steps: 12 });
    await page.mouse.up();
    await frame();
  };
  await dragTargetX(sourcePosition.x - 80);
  const crossed = await inspect();
  for (const key of returns) expect(crossed.routes[key]!.id).toBe(initial.routes[key]!.id);
  await dragTargetX(separatedTargetX);
  const returned = await inspect();
  for (const key of ['forward', ...returns] as const) {
    expect(returned.routes[key]!.id).toBe(initial.routes[key]!.id);
    expect(returned.routes[key]!.curves).toEqual(initial.routes[key]!.curves);
  }

   await mkdir(artifactDir, { recursive: true });
   const screenshot = (name: string) => page.screenshot({ path: resolve(artifactDir, `parallel-return-${name}.png`), animations: 'disabled' });
   await screenshot('rails-before-selection');
   const forward = returned.routes.forward!;
   await page.mouse.click(forward.rail.midpoint.x, forward.rail.midpoint.y);
   await frame();
   const selectedForward = await inspect();
    expect(selectedForward.routes.forward!.color).toBe(selectedForward.actionStrong);
    expect(selectedForward.routes.forward!.arrowColor).toBe(selectedForward.actionStrong);
    for (const endpoint of ['source', 'target'] as const) {
      const socket = selectedForward.routes.forward![endpoint].socket;
      expect(selectedForward.socketStates[socket.id]!.fill).toBe(endpoint === 'target' ? selectedForward.actionStrong : selectedForward.surface);
      expect(selectedForward.socketStates[socket.id]!.stroke).toBe(selectedForward.actionStrong);
    }
    for (const key of returns) {
      expect(selectedForward.routes[key]!.color).toBe(selectedForward.action);
      expect(selectedForward.routes[key]!.arrowColor).toBe(selectedForward.action);
   }
   await screenshot('selected-forward');
   for (const key of returns) {
    const forwardBefore = returned.routes.forward!.curves;
    const route = returned.routes[key]!;
     await page.mouse.click(route.rail.midpoint.x, route.rail.midpoint.y);
    await frame();
    const selected = await inspect();
     expect(selected.routes[key]!.color).toBe(selected.actionStrong);
     for (const other of ['forward', ...returns].filter((candidate) => candidate !== key)) {
       expect(selected.routes[other]!.color, `${key} click does not select ${other}`).toBe(selected.action);
    }
    expect(selected.routes.forward!.curves, `${key} selection leaves reciprocal forward curve geometry unchanged`).toEqual(forwardBefore);
    for (const endpoint of ['source', 'target'] as const) {
      const activeSocket = selected.routes[key]![endpoint].socket;
       expect(selected.socketStates[activeSocket.id]!.stroke).toBe(selected.actionStrong);
       expect(selected.socketStates[activeSocket.id]!.fill).toBe(endpoint === 'target' ? selected.actionStrong : selected.surface);
      for (const other of ['forward', ...returns].filter((candidate) => candidate !== key)) {
        for (const otherEndpoint of ['source', 'target'] as const) {
          const otherSocket = selected.routes[other]![otherEndpoint].socket;
          if (otherSocket.id === activeSocket.id) continue;
           expect(selected.socketStates[otherSocket.id]!.stroke, `${key} click leaves ${other} ${otherEndpoint} socket alone`).toBe(selected.action);
        }
      }
    }
     await screenshot(`selected-${key}`);
   }
   // Exercise real Playwright mouse input on both vertical legs of every
   // return path. Unlike horizontal-rail clicks, these verify the close X-lanes
   // are individually hittable and that selection paints the arrow and both
   // terminal sockets without selecting a neighboring wire.
   for (const key of returns) for (const side of ['leftLeg', 'rightLeg'] as const) {
     const route = returned.routes[key]!;
     await page.mouse.click(route.rail[side].x, route.rail[side].y);
     await frame();
     const selected = await inspect();
      expect(selected.routes[key]!.color, `${key} ${side} wire is selected by a physical click`).toBe(selected.actionStrong);
      expect(selected.routes[key]!.arrowColor, `${key} ${side} arrowhead is selected`).toBe(selected.actionStrong);
      for (const other of ['forward', ...returns].filter((candidate) => candidate !== key)) {
        expect(selected.routes[other]!.color, `${key} ${side} click does not select ${other}`).toBe(selected.action);
        expect(selected.routes[other]!.arrowColor, `${key} ${side} click leaves ${other} arrow alone`).toBe(selected.action);
      }
      for (const endpoint of ['source', 'target'] as const) {
        const socket = selected.routes[key]![endpoint].socket;
        expect(selected.socketStates[socket.id]!.fill).toBe(endpoint === 'target' ? selected.actionStrong : selected.surface);
        expect(selected.socketStates[socket.id]!.stroke).toBe(selected.actionStrong);
     }
     await screenshot(`selected-${key}-${side}-vertical-leg`);
   }
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Source/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/Target/REST/remote', search: '' }
  ]);
});

test('event binding keeps Example 2.LogLevel directed to Example Frontend.Preset', async ({ page }) => {
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { 'Example Frontend': {}, 'Example 2': {} } }));
    } else if (request.pathname === '/nodes/ExampleFrontend/REST/remote') {
      await route.fulfill(jsonResponse({ events: { Preset: { node: 'Example 2', event: 'LogLevel' } } }));
    } else if (request.pathname === '/nodes/Example2/REST/remote') {
      await route.fulfill(jsonResponse({}));
    } else {
      throw new Error(`Unexpected event-direction fixture request ${request.pathname}`);
    }
  });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-fixture-summary]')).toContainText('1 configured');

  const edge = await page.evaluate(() => {
    type Pt = { x: number; y: number };
    type Shape = {
      id(): string; name(): string; x(): number; y(): number; width(): number; text(): string; align(): string;
      getAbsolutePosition(top?: Shape): Pt; find(selector: string): Shape[];
      getSceneFunc(): (context: {
        beginPath(): void; moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
        lineTo(x: number, y: number): void; closePath(): void; stroke(): void; fill(): void; fillStyle: string; strokeStyle: string;
      }, shape: Shape) => void;
    };
    const stage = (window as Window & { Konva?: { stages?: Shape[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage is unavailable');
    const cards = stage.find('.topology-card');
    const card = (name: string) => cards.find((item) => item.find('Text').some((text) => text.text() === name));
    const frontend = card('Example Frontend');
    const example2 = card('Example 2');
    if (!frontend || !example2) throw new Error('Event fixture cards were not rendered');
    const endpoint = (owner: Shape, label: string, side: 'left' | 'right') => {
      const text = owner.find('Text').find((item) => item.text() === label && item.align() === side);
      if (!text) throw new Error(`Missing ${side} ${label}`);
      const rect = owner.find('Rect').find((item) => item.width() > 100);
      const socket = owner.find('Circle').find((item) => item.name().startsWith('socket-')
        && item.x() === (side === 'left' ? 0 : rect?.width()) && Math.abs(item.y() - text.y() - 7) < 0.1);
      if (!socket) throw new Error(`Missing ${side} ${label} socket`);
      return { point: socket.getAbsolutePosition(stage), socket: socket.name() };
    };
    const source = endpoint(example2, 'LogLevel', 'right');
    const target = endpoint(frontend, 'Preset', 'left');
    const wires = stage.find('.topology-wire');
    if (wires.length !== 1) throw new Error(`Expected one event wire, got ${wires.length}`);
    let start: Pt | undefined;
    let control1: Pt | undefined;
    let control2: Pt | undefined;
    let end: Pt | undefined;
    let arrowMove: Pt | undefined;
    let arrowLines: Pt[] = [];
    const context = {
      strokeStyle: '', fillStyle: '',
      beginPath() { arrowMove = undefined; arrowLines = []; },
      moveTo(x: number, y: number) { if (!start) start = { x, y }; arrowMove = { x, y }; },
      bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) { control1 = { x: a, y: b }; control2 = { x: c, y: d }; end = { x, y }; },
      lineTo(x: number, y: number) { arrowLines.push({ x, y }); },
      closePath() {}, stroke() {}, fill() {}
    };
    const wire = wires[0]!;
    wire.getSceneFunc().call(wire, context, wire);
    if (!start || !control1 || !control2 || !end) throw new Error('Event path geometry was not painted');
    const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    const bounds = (stage as Shape & { container(): HTMLElement }).container().getBoundingClientRect();
    const transform = stage as Shape & { x(): number; y(): number; scaleX(): number; scaleY(): number };
    const screen = (point: Pt) => ({ x: bounds.left + transform.x() + point.x * transform.scaleX(), y: bounds.top + transform.y() + point.y * transform.scaleY() });
    const layers = [...(stage as Shape & { container(): HTMLElement }).container().querySelectorAll('canvas')];
    if (layers.length !== 2 || layers.some((layer) => !(layer instanceof HTMLCanvasElement))) throw new Error('Visible wire and node/card canvases are missing');
    const firstLayer = layers[0] as HTMLCanvasElement;
    const composite = document.createElement('canvas');
    composite.width = firstLayer.width;
    composite.height = firstLayer.height;
    const pixels = composite.getContext('2d');
    if (!pixels) throw new Error('Scene canvas readback is unavailable');
    for (const layer of layers) pixels.drawImage(layer, 0, 0);
    const sample = (point: Pt, expected: string) => {
      const viewport = screen(point);
      const x = Math.round((viewport.x - bounds.left) * composite.width / bounds.width);
      const y = Math.round((viewport.y - bounds.top) * composite.height / bounds.height);
      const rgb = expected.match(/\d+/g)?.map(Number);
      if (!rgb || rgb.length < 3) throw new Error(`Unrecognized event stroke color ${expected}`);
      if (rgb.slice(0, 3).every((channel) => channel > 245)) throw new Error('Refusing white card-fill color as wire-ink evidence');
      let hits = 0;
      for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
        if (pixels.getImageData(x + dx, y + dy, 1, 1).data.slice(0, 3).every((value, channel) => Math.abs(value - rgb[channel]!) < 30)) hits += 1;
      }
      return hits;
    };
    const middle = { x: (start.x + 3 * control1.x + 3 * control2.x + end.x) / 8, y: (start.y + 3 * control1.y + 3 * control2.y + end.y) / 8 };
    const arrow = arrowMove && arrowLines.length === 2
      ? { x: (arrowMove.x + arrowLines[0]!.x + arrowLines[1]!.x) / 3, y: (arrowMove.y + arrowLines[0]!.y + arrowLines[1]!.y) / 3 }
      : undefined;
    return {
      id: wire.id(), source, target,
      sourceStartDistance: distance(start, source.point), targetEndDistance: distance(end, target.point),
      midpointHits: sample(middle, context.strokeStyle), arrowHits: arrow ? sample(arrow, context.strokeStyle) : 0
    };
  });
  expect(edge.id).toMatch(/^e-/);
  expect(edge.source.socket).toContain('socket-');
  expect(edge.target.socket).toContain('socket-');
  expect(edge.sourceStartDistance).toBeLessThan(0.1);
  expect(edge.targetEndDistance).toBeLessThan(0.1);
  expect(edge.midpointHits).toBeGreaterThan(0);
  expect(edge.arrowHits).toBeGreaterThan(0);
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Example2/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/ExampleFrontend/REST/remote', search: '' }
  ]);
});

test('Room Controller action and event aliases keep typed direction and paint through swaps', async ({ page }) => {
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { 'Room Controller': {}, Projector: {} } }));
    } else if (request.pathname === '/nodes/RoomController/REST/remote') {
      await route.fulfill(jsonResponse({
        actions: { 'Projector On': { node: 'Projector', action: 'Power On' } },
        events: { 'Projector Ready': { node: 'Projector', event: 'Ready' } }
      }));
    } else if (request.pathname === '/nodes/Projector/REST/remote') {
      await route.fulfill(jsonResponse({ events: { 'Room Ready': { node: 'Room Controller', event: 'Ready' } } }));
    } else {
      throw new Error(`Unexpected Room Controller fixture request ${request.pathname}`);
    }
  });
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-fixture-summary]')).toContainText('3 configured');
  await page.getByRole('button', { name: 'Reset view' }).click();

  type Point = { x: number; y: number };
  type Endpoint = { node: string; label: string; side: 'left' | 'right'; point: Point; socket: string; localKind?: string; fill: string; stroke: string };
  type Link = { id: string; ownerId: string; kind: string; source: Endpoint; target: Endpoint; start: Point; end: Point; midpoint: Point; midpointClick: Point; arrow: Point; color: string; arrowColor: string };
  const inspect = () => page.evaluate(() => {
    type Shape = {
      id(): string; name(): string; text(): string; align(): string; x(): number; y(): number; width(): number;
      fill(): string; stroke(): string; getAttr(name: string): unknown; getAbsolutePosition(top?: Shape): Point; find(selector: string): Shape[];
      getSceneFunc(): (context: { beginPath(): void; moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void; lineTo(x: number, y: number): void; closePath(): void; stroke(): void; fill(): void; strokeStyle: string; fillStyle: string }, shape: Shape) => void;
    };
    type Point = { x: number; y: number };
    const stage = (window as Window & { Konva?: { stages?: Shape[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage is unavailable');
    const cards = stage.find('.topology-card');
    const cardFor = (name: string) => cards.find((card) => card.find('Text').some((text) => text.text() === name));
    const endpoint = (node: string, label: string, side: 'left' | 'right'): Endpoint => {
      const card = cardFor(node);
      if (!card) throw new Error(`Missing ${node} card`);
      const text = card.find('Text').find((item) => item.text() === label && item.align() === side);
      if (!text) throw new Error(`Missing ${node}.${label} ${side} port`);
      const body = card.find('Rect').find((rect) => rect.width() > 100);
      const socket = card.find('Circle').find((item) => item.name().startsWith('socket-')
        && item.x() === (side === 'left' ? 0 : body?.width()) && Math.abs(item.y() - text.y() - 7) < 0.1);
      if (!socket) throw new Error(`Missing socket for ${node}.${label}`);
      return { node, label, side, point: socket.getAbsolutePosition(stage), socket: socket.name(), localKind: socket.getAttr('localKind') as string | undefined, fill: socket.fill(), stroke: socket.stroke() };
    };
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
    const paths = stage.find('.topology-wire').map((wire) => {
      let start: Point | undefined; let end: Point | undefined; let control1: Point | undefined; let control2: Point | undefined; let arrowMove: Point | undefined; const arrowLines: Point[] = [];
      const context = {
        strokeStyle: '', fillStyle: '',
        beginPath() { arrowMove = undefined; arrowLines.length = 0; },
        moveTo(x: number, y: number) { start ??= { x, y }; arrowMove = { x, y }; },
        bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) { control1 = { x: a, y: b }; control2 = { x: c, y: d }; end = { x, y }; },
        lineTo(x: number, y: number) { arrowLines.push({ x, y }); }, closePath() {}, stroke() {}, fill() {}
      };
      wire.getSceneFunc().call(wire, context, wire);
      if (!start || !control1 || !control2 || !end || !arrowMove || arrowLines.length !== 2) throw new Error('Wire path or arrowhead missing');
      const midpoint = { x: (start.x + 3 * control1.x + 3 * control2.x + end.x) / 8, y: (start.y + 3 * control1.y + 3 * control2.y + end.y) / 8 };
      const route = { id: wire.id(), ownerId: wire.getAttr('ownerId') as string, kind: wire.getAttr('bindingKind') as string, start, end,
        midpoint, midpointClick: midpoint, arrow: { x: (arrowMove.x + arrowLines[0]!.x + arrowLines[1]!.x) / 3, y: (arrowMove.y + arrowLines[0]!.y + arrowLines[1]!.y) / 3 }, color: context.strokeStyle, arrowColor: context.fillStyle };
      return route;
    });
    const match = (source: Endpoint, target: Endpoint, owner: string, kind: string): Link => {
      const path = paths.find((candidate) => candidate.ownerId === cardFor(owner)?.id() && candidate.kind === kind
        && distance(candidate.start, source.point) < 0.1 && distance(candidate.end, target.point) < 0.1);
      if (!path) throw new Error(`No ${kind} path for ${owner}: ${source.node}.${source.label} → ${target.node}.${target.label}`);
      return { ...path, source, target };
    };
    const links = {
      action: match(endpoint('Room Controller', 'Projector On', 'right'), endpoint('Projector', 'Power On', 'left'), 'Room Controller', 'action'),
      controllerEvent: match(endpoint('Projector', 'Ready', 'right'), endpoint('Room Controller', 'Projector Ready', 'left'), 'Room Controller', 'event'),
      projectorEvent: match(endpoint('Room Controller', 'Ready', 'right'), endpoint('Projector', 'Room Ready', 'left'), 'Projector', 'event')
    };
    const style = getComputedStyle(document.documentElement);
    const color = (name: string) => `rgb(${style.getPropertyValue(`--nodel-${name}`).trim()})`;
    const rect = stage.find('.topology-card').find((card) => card.find('Text').some((item) => item.text() === 'Room Controller'))!.getAbsolutePosition(stage);
    return { links, colors: { action: color('topology-action'), actionStrong: color('topology-action-strong'), event: color('topology-event'), eventStrong: color('topology-event-strong'), surface: color('surface') }, room: rect };
  });
  const screenshots = (name: string) => page.screenshot({ path: resolve(artifactDir, `room-controller-${name}.png`), animations: 'disabled' });
  await mkdir(artifactDir, { recursive: true });
  const initial = await inspect();
  expect(initial.links.action.source).toMatchObject({ node: 'Room Controller', side: 'right' });
  expect(initial.links.action.target).toMatchObject({ node: 'Projector', side: 'left', localKind: 'local-action' });
  expect(initial.links.controllerEvent.source).toMatchObject({ node: 'Projector', side: 'right', localKind: 'local-event' });
  expect(initial.links.controllerEvent.target).toMatchObject({ node: 'Room Controller', side: 'left' });
  expect(initial.links.projectorEvent.source).toMatchObject({ node: 'Room Controller', side: 'right', localKind: 'local-event' });
  expect(initial.links.projectorEvent.target).toMatchObject({ node: 'Projector', side: 'left' });
  expect(initial.links.action.color).toBe(initial.colors.action);
  expect(initial.links.action.arrowColor).toBe(initial.colors.action);
  for (const link of [initial.links.controllerEvent, initial.links.projectorEvent]) {
    expect(link.color).toBe(initial.colors.event);
    expect(link.arrowColor).toBe(initial.colors.event);
    expect(Math.hypot(link.arrow.x - link.end.x, link.arrow.y - link.end.y)).toBeLessThan(Math.hypot(link.arrow.x - link.start.x, link.arrow.y - link.start.y));
  }
  expect(initial.links.action.source.fill).toBe(initial.colors.surface); // remote-action alias is hollow
  expect(initial.links.action.target.fill).toBe(initial.colors.action); // provisional local action is filled
  expect(initial.links.controllerEvent.source.fill).toBe(initial.colors.event); // local event source is filled
  expect(initial.links.controllerEvent.target.fill).toBe(initial.colors.surface); // remote-event alias is hollow
  expect(initial.links.projectorEvent.source.fill).toBe(initial.colors.event);
  expect(initial.links.projectorEvent.target.fill).toBe(initial.colors.surface);
  await screenshots('light-before');
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await screenshots('dark-before');
  const dark = await inspect();
  expect(dark.links.action.color).toBe(dark.colors.action);
  expect(dark.links.controllerEvent.color).toBe(dark.colors.event);
  const selectedEvent = initial.links.projectorEvent;
  const eventClick = await page.evaluate(({ point }) => {
    type Point = { x: number; y: number };
    type Stage = { getAbsoluteTransform(): { point(point: Point): Point }; container(): HTMLElement; width(): number; height(): number };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage unavailable');
    const rect = stage.container().getBoundingClientRect();
    const transformed = stage.getAbsoluteTransform().point(point);
    return { x: rect.left + transformed.x * rect.width / stage.width(), y: rect.top + transformed.y * rect.height / stage.height() };
  }, { point: selectedEvent.arrow });
  await page.mouse.click(eventClick.x, eventClick.y);
  let selected = await inspect();
  expect(selected.links.projectorEvent.color).toBe(selected.colors.eventStrong);
  expect(selected.links.projectorEvent.arrowColor).toBe(selected.colors.eventStrong);
  expect(selected.links.projectorEvent.target.fill).toBe(selected.colors.surface);
  expect(selected.links.projectorEvent.target.stroke).toBe(selected.colors.eventStrong);
  expect(selected.links.action.color).toBe(selected.colors.action);
  expect(selected.links.controllerEvent.color).toBe(selected.colors.event);
  await screenshots('dark-selected-projector-event');
  const projector = await page.evaluate(() => {
    type Shape = { text(): string; getParent(): { x(): number; y(): number } };
    const stage = (window as Window & { Konva?: { stages?: { find(selector: string): Shape[] }[] } }).Konva?.stages?.[0];
    const title = stage?.find('Text').find((item) => item.text() === 'Projector');
    if (!title) throw new Error('Projector title unavailable');
    return { x: title.getParent().x(), y: title.getParent().y() };
  });
  const stageBox = await page.locator('.canvas-stage').boundingBox();
  if (!stageBox) throw new Error('Canvas stage has no bounds');
  const current = await page.evaluate(() => {
    type Shape = { x(): number; y(): number; text(): string; getParent(): { x(): number; y(): number } };
    const stage = (window as Window & { Konva?: { stages?: { find(selector: string): Shape[] }[] } }).Konva?.stages?.[0];
    const title = stage?.find('Text').find((item) => item.text() === 'Room Controller');
    if (!title) throw new Error('Room Controller title unavailable');
    const group = title.getParent(); return { x: group.x(), y: group.y() };
  });
  await page.mouse.move(stageBox.x + current.x + 110, stageBox.y + current.y + 24);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + projector.x + 110, stageBox.y + projector.y + 24, { steps: 8 });
  await page.mouse.up();
  selected = await inspect();
  expect(selected.links.action.id).toBe(initial.links.action.id);
  expect(selected.links.controllerEvent.id).toBe(initial.links.controllerEvent.id);
  expect(selected.links.projectorEvent.id).toBe(initial.links.projectorEvent.id);
  expect(selected.links.projectorEvent.color).toBe(selected.colors.eventStrong);
  expect(selected.links.projectorEvent.arrowColor).toBe(selected.colors.eventStrong);
  expect(selected.links.projectorEvent.target.fill).toBe(selected.colors.surface);
  expect(selected.links.projectorEvent.target.stroke).toBe(selected.colors.eventStrong);
  expect(selected.links.action.color).toBe(selected.colors.action);
  expect(selected.links.action.arrowColor).toBe(selected.colors.action);
  expect(selected.links.controllerEvent.color).toBe(selected.colors.event);
  expect(selected.links.controllerEvent.arrowColor).toBe(selected.colors.event);
  expect(Math.hypot(selected.links.projectorEvent.arrow.x - selected.links.projectorEvent.end.x, selected.links.projectorEvent.arrow.y - selected.links.projectorEvent.end.y))
    .toBeLessThan(Math.hypot(selected.links.projectorEvent.arrow.x - selected.links.projectorEvent.start.x, selected.links.projectorEvent.arrow.y - selected.links.projectorEvent.start.y));
  await screenshots('dark-selected-projector-event-swapped');
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await screenshots('light-selected-projector-event-swapped');
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Projector/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/RoomController/REST/remote', search: '' }
  ]);
});

test('single backward non-reciprocal edge has a visible socket stub before turning', async ({ page }) => {
  const requests = await installGuard(page, async (route, request) => {
    if (request.pathname === '/REST') {
      await route.fulfill(jsonResponse({ nodes: { 'Example Frontend': {}, 'Example 2': {} } }));
    } else if (request.pathname === '/nodes/ExampleFrontend/REST/remote') {
      await route.fulfill(jsonResponse({ actions: { Preset: { node: 'Example 2', action: 'power' } } }));
    } else if (request.pathname === '/nodes/Example2/REST/remote') {
      await route.fulfill(jsonResponse({}));
    } else {
      throw new Error(`Unexpected one-way corridor fixture request ${request.pathname}`);
    }
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('[data-fixture-summary]')).toContainText('1 configured');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  const geometry = await page.evaluate(() => {
    type Point = { x: number; y: number };
    type Shape = {
      id(): string; name(): string; x(): number; y(): number; width(): number; text(): string; align(): string;
      getAbsolutePosition(top?: Shape): Point; find(selector: string): Shape[];
      getSceneFunc(): (context: { beginPath(): void; moveTo(x: number, y: number): void;
        bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void;
        lineTo(x: number, y: number): void; closePath(): void; stroke(): void; fill(): void;
        strokeStyle: string; fillStyle: string; lineWidth: number }, shape: Shape) => void;
    };
    type Stage = Shape & { getContent(): HTMLElement; width(): number; height(): number; getAbsoluteTransform(): { point(point: Point): Point };
      getLayers(): Array<{ name(): string; getNativeCanvasElement(): HTMLCanvasElement }> };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva native stage registry is unavailable');
    const cards = stage.find('.topology-card');
    const card = (name: string) => cards.find((item) => item.find('Text').some((text) => text.text() === name));
    const source = card('Example Frontend');
    const target = card('Example 2');
    if (!source || !target) throw new Error('One-way fixture cards were not rendered');
    const socket = (owner: Shape, label: string, side: 'left' | 'right') => {
      const text = owner.find('Text').find((item) => item.text() === label && item.align() === (side === 'left' ? 'left' : 'right'));
      const rect = owner.find('Rect').find((item) => item.width() > 100);
      if (!text || !rect) throw new Error(`Missing ${side} ${label} endpoint`);
      const result = owner.find('Circle').find((item) => item.name().startsWith('socket-')
        && item.x() === (side === 'left' ? 0 : rect.width()) && Math.abs(item.y() - text.y() - 7) < 0.1);
      if (!result) throw new Error(`Missing ${side} ${label} socket`);
      return result.getAbsolutePosition(stage);
    };
    const from = socket(source, 'Preset', 'right');
    const to = socket(target, 'power', 'left');
    let current: { start: Point; control1?: Point; control2?: Point; end?: Point } | undefined;
    let activePath: Array<{ start: Point; control1: Point; control2: Point; end: Point }> | undefined;
    const curves: Array<{ start: Point; control1: Point; control2: Point; end: Point }> = [];
    const context = {
      strokeStyle: '', fillStyle: '', lineWidth: 0,
      beginPath() { current = undefined; },
      moveTo(x: number, y: number) { current = { start: { x, y } }; },
      bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
        if (current) { current.control1 = { x: a, y: b }; current.control2 = { x: c, y: d }; current.end = { x, y }; }
      },
      lineTo() {}, closePath() {}, fill() {},
      stroke() {
        if (current?.control1 && current.control2 && current.end) {
          const curve = current as { start: Point; control1: Point; control2: Point; end: Point };
          curves.push(curve);
          activePath?.push(curve);
        }
      }
    };
    const matches = stage.find('.topology-wire').filter((wire) => {
      const path: typeof curves = [];
      activePath = path;
      wire.getSceneFunc().call(wire, context, wire);
      activePath = undefined;
      if (!path.length) return false;
      const first = path[0]!.start;
      const last = path.at(-1)!.end;
      return Math.hypot(first.x - from.x, first.y - from.y) < 0.1 && Math.hypot(last.x - to.x, last.y - to.y) < 0.1;
    });
    if (matches.length !== 1) throw new Error(`Expected one directed wire, found ${matches.length}`);
    const wire = matches[0]!;
    wire.getSceneFunc().call(wire, context, wire);
    const route = curves.filter((curve) => curve.end && (curve.end.x !== curve.start.x || curve.end.y !== curve.start.y));
    if (!route.length) throw new Error('The wire scene produced no cubic geometry');
    const layers = stage.getLayers();
    if (layers.length !== 2 || layers[0]!.name() !== 'wires' || layers[1]!.name() !== 'cards') throw new Error('Expected wire and card canvas layers');
    const canvas = layers[0]!.getNativeCanvasElement();
    const bounds = canvas.getBoundingClientRect();
    const transform = stage.getAbsoluteTransform();
    const screen = (point: Point) => {
      const p = transform.point(point);
      return { x: bounds.left + p.x * bounds.width / stage.width(), y: bounds.top + p.y * bounds.height / stage.height() };
    };
    const composite = document.createElement('canvas'); composite.width = canvas.width; composite.height = canvas.height;
    const pixels = composite.getContext('2d', { willReadFrequently: true });
    const cardCanvas = layers[1]!.getNativeCanvasElement();
    if (!pixels) throw new Error('Canvas pixel readback is unavailable');
    pixels.drawImage(canvas, 0, 0); pixels.drawImage(cardCanvas, 0, 0);
    const directionX = Math.sign(route[0]!.end.x - route[0]!.start.x);
    const stubPoint = { x: from.x + directionX * 9, y: from.y };
    const viewport = screen(stubPoint);
    const px = Math.round((viewport.x - bounds.left) * composite.width / bounds.width);
    const py = Math.round((viewport.y - bounds.top) * composite.height / bounds.height);
    let ink = 0;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
      const pixel = pixels.getImageData(px + dx, py + dy, 1, 1).data;
      if (pixel[3]! > 0 && !(pixel[0]! > 245 && pixel[1]! > 245 && pixel[2]! > 245)) ink += 1;
    }
    return { from, to, curves: route, ink };
  });
  expect(geometry.curves[0]!.start).toEqual(geometry.from);
  expect(geometry.curves.at(-1)!.end).toEqual(geometry.to);
  expect(geometry.curves[0]!.end.x - geometry.curves[0]!.start.x).toBeGreaterThanOrEqual(12);
  expect(geometry.ink).toBeGreaterThan(0);
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Example2/REST/remote', search: '' },
    { method: 'GET', pathname: '/nodes/ExampleFrontend/REST/remote', search: '' }
  ]);
});

test('BFCache suspends and restores a local bootstrap without duplicate discovery', async ({ page }) => {
  const requests: RequestRecord[] = [];
  await page.addInitScript(() => {
    window.addEventListener('pageshow', (event) => {
      (window as Window & { __restoredFromBfCache?: boolean }).__restoredFromBfCache = event.persisted;
    });
  });
  let ownerStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { ownerStarted = resolve; });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== experimentOrigin) return route.abort('blockedbyclient');
    if (!apiPath(url.pathname)) return route.continue();
    requests.push({ method: request.method(), pathname: url.pathname, search: url.search });
    if (url.pathname === '/REST') return route.fulfill(jsonResponse({ nodes: { Controller: {} } }));
    ownerStarted?.();
    return new Promise<void>(() => {});
  });
  await page.goto('/topology-canvas.html?source=local');
  await started;
  await page.goto('/topology-canvas.html?nodes=9');
  await expect(page.locator('[data-fixture-summary]')).toHaveText('9 nodes · 14 edges');
  await page.goBack({ waitUntil: 'commit' });
  await expect.poll(() => page.evaluate(() => (window as Window & { __restoredFromBfCache?: boolean }).__restoredFromBfCache)).toBe(true);
  await expect(page).toHaveTitle(/Local network topology/);
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2, { timeout: 5_000 });
  await expect(page.locator('[data-fixture-summary]')).toContainText('1 local unread');
  expect(requests).toEqual([
    { method: 'GET', pathname: '/REST', search: '' },
    { method: 'GET', pathname: '/nodes/Controller/REST/remote', search: '' }
  ]);
});
