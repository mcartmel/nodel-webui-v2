import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cardHeight,
  edgeCurve,
  edgeCurves,
  curveArrow,
  curvePoint,
  fixtureEdges,
  fixtureNodes,
  portPoint,
  type Point
} from '../../src/experiments/konva-canvas/fixture';

const experimentPath = process.env.KONVA_EXPERIMENT_PATH ?? '/topology-canvas.html';
const nodesById = new Map(fixtureNodes.map((node) => [node.id, node]));
const allCurves = fixtureEdges.flatMap((edge) => edgeCurves(edge, nodesById));
const graphLeft = Math.min(...fixtureNodes.map((node) => node.x), ...allCurves.flatMap((curve) => [curve.start.x, curve.control1.x, curve.control2.x, curve.end.x]));
const graphRight = Math.max(...fixtureNodes.map((node) => node.x + node.width), ...allCurves.flatMap((curve) => [curve.start.x, curve.control1.x, curve.control2.x, curve.end.x]));
const graphTop = Math.min(...fixtureNodes.map((node) => node.y));
const graphBottom = Math.max(
  ...fixtureNodes.map((node) => node.y + cardHeight(node)),
  ...allCurves.flatMap((curve) => [curve.start.y, curve.control1.y, curve.control2.y, curve.end.y])
);
const graphWidth = graphRight - graphLeft;
const graphHeight = graphBottom - graphTop;
const evidenceDirectory = resolve(process.cwd(), 'build/konva-evidence');

type Rect = { x: number; y: number; width: number; height: number };
type Camera = { x: number; y: number; scale: number };

async function stageBounds(page: Page): Promise<Rect> {
  const bounds = await page.locator('.canvas-stage').boundingBox();
  expect(bounds).not.toBeNull();
  return bounds!;
}

function initialCamera(bounds: Rect): Camera {
  const scale = Math.min(1, (bounds.width - 40) / graphWidth, (bounds.height - 36) / graphHeight);
  return {
    x: Math.round((bounds.width - graphWidth * scale) / 2 - graphLeft * scale),
    y: Math.round((bounds.height - graphHeight * scale) / 2 - graphTop * scale),
    scale
  };
}

function screenPoint(bounds: Rect, camera: Camera, world: Point): Point {
  return { x: bounds.x + camera.x + world.x * camera.scale, y: bounds.y + camera.y + world.y * camera.scale };
}

async function assertNoPageScroll(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  }));
  expect(metrics.x).toBe(0);
  expect(metrics.y).toBe(0);
  expect(metrics.width).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.height).toBeLessThanOrEqual(metrics.viewportHeight);
}

async function capture(page: Page, testInfo: TestInfo, state: string): Promise<void> {
  mkdirSync(evidenceDirectory, { recursive: true });
  const path = resolve(evidenceDirectory, `konva-${testInfo.project.name}-${state}.png`);
  await page.screenshot({
    path,
    fullPage: false,
    animations: 'disabled'
  });
  console.log(`Konva evidence PNG: ${path}`);
}

type LayerStats = { id: number; draws: number; width: number; height: number };

async function canvasSnapshot(page: Page): Promise<{ at: number; layers: LayerStats[] }> {
  return page.evaluate(() => {
    const instrumentedWindow = window as Window & {
      __konvaTestCanvasStats?: () => LayerStats[];
    };
    if (!instrumentedWindow.__konvaTestCanvasStats) throw new Error('Canvas draw instrumentation was not installed');
    return { at: performance.now(), layers: instrumentedWindow.__konvaTestCanvasStats() };
  });
}

async function canvasStats(page: Page): Promise<LayerStats[]> {
  return (await canvasSnapshot(page)).layers;
}

type NativeShapeIdentity = { id: string; nativeId: number; className: string };
type NativeSceneIdentity = { cards: NativeShapeIdentity[]; wires: NativeShapeIdentity[] };
type NativeSceneState = { camera: { x: number; y: number; scaleX: number; scaleY: number }; nodes: { id: string; x: number; y: number }[] };

async function nativeSceneIdentity(page: Page): Promise<NativeSceneIdentity> {
  return page.evaluate(() => {
    type NativeShape = { id(): string; getClassName(): string; _id: number };
    type NativeStage = { find(selector: string): NativeShape[] };
    const stages = (window as Window & { Konva?: { stages?: NativeStage[] } }).Konva?.stages;
    const stage = stages?.[0];
    if (!stage) throw new Error('Konva native stage registry is unavailable');
    const read = (selector: string) => stage.find(selector)
      .map((shape) => ({ id: shape.id(), nativeId: shape._id, className: shape.getClassName() }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { cards: read('.topology-card'), wires: read('.topology-wire') };
  });
}

async function nativeSceneState(page: Page): Promise<NativeSceneState> {
  return page.evaluate(() => {
    type NativeShape = { id(): string; x(): number; y(): number };
    type NativeStage = { position(): Point; scaleX(): number; scaleY(): number; find(selector: string): NativeShape[] };
    const stages = (window as Window & { Konva?: { stages?: NativeStage[] } }).Konva?.stages;
    const stage = stages?.[0];
    if (!stage) throw new Error('Konva native stage registry is unavailable');
    const position = stage.position();
    return {
      camera: { x: position.x, y: position.y, scaleX: stage.scaleX(), scaleY: stage.scaleY() },
      nodes: stage.find('.topology-card').map((shape) => ({ id: shape.id(), x: shape.x(), y: shape.y() })).sort((a, b) => a.id.localeCompare(b.id))
    };
  });
}

type FrameSample = { requestedAt: number; firstFrameMs: number; frameIntervalMs: number };

async function sampleTwoFrames(page: Page): Promise<FrameSample> {
  return page.evaluate(() => new Promise((resolveFrame) => {
    const requestedAt = performance.now();
    requestAnimationFrame((firstFrameTimestamp) => {
      const firstFrameAt = performance.now();
      requestAnimationFrame((secondFrameTimestamp) => {
        resolveFrame({ requestedAt, firstFrameMs: firstFrameAt - requestedAt, frameIntervalMs: secondFrameTimestamp - firstFrameTimestamp });
      });
    });
  }));
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2;
}

async function canvasPixelHashes(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-stage canvas'));
    const hashes: string[] = [];
    for (const canvas of canvases) {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas pixel readback is unavailable');
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      hashes.push(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    }
    return hashes;
  });
}

async function assertPortGeometryAndInk(
  page: Page,
  positions: Map<string, Point>,
  camera: Camera,
  edgeIds?: ReadonlySet<string>
): Promise<{ surfaceColor: number[]; wireColor: number[]; backgroundColor: number[]; endpoints: number }> {
  const bounds = await stageBounds(page);
  const connected = fixtureEdges.filter((edge) => !edgeIds || edgeIds.has(edge.id))
    .filter((edge) => positions.size === 0 || positions.has(edge.from.nodeId) || positions.has(edge.to.nodeId));
  const samples = connected.flatMap((edge) => {
    const curve = edgeCurve(edge, nodesById, positions);
    const source = nodesById.get(edge.from.nodeId)!;
    const target = nodesById.get(edge.to.nodeId)!;
    const sourcePoint = portPoint(source, edge.from.portId, positions.get(source.id));
    const targetPoint = portPoint(target, edge.to.portId, positions.get(target.id));
    return [
      {
        edgeId: edge.id,
        endpoint: 'source',
        port: screenPoint(bounds, camera, sourcePoint),
        ink: screenPoint(bounds, camera, curvePoint(curve, 0.12))
      },
      {
        edgeId: edge.id,
        endpoint: 'target',
        port: screenPoint(bounds, camera, targetPoint),
        ink: screenPoint(bounds, camera, curvePoint(curve, 0.88))
      }
    ];
  });
  const result = await page.evaluate((points) => {
    const layers = Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-stage canvas'));
    if (layers.length !== 2) return { layers: layers.length, surface: [0, 0, 0], wireColor: [0, 0, 0], background: [0, 0, 0], samples: [] };
    const resolveColor = (token: string): number[] => {
      const context = document.createElement('canvas').getContext('2d');
      if (!context) return [0, 0, 0];
      const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
      context.fillStyle = /^(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color|#)/i.test(value) ? value : `rgb(${value})`;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
    };
    const read = (canvas: HTMLCanvasElement, point: Point, radius = 2, threshold = 96, centerDx = 0, centerDy = 0) => {
      const context = canvas.getContext('2d');
      if (!context) return null;
      const rect = canvas.getBoundingClientRect();
      const ratioX = canvas.width / rect.width;
      const ratioY = canvas.height / rect.height;
      const x = Math.round((point.x - rect.left) * ratioX) + centerDx;
      const y = Math.round((point.y - rect.top) * ratioY) + centerDy;
      let best: { rgba: number[]; dx: number; dy: number } | undefined;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const rgba = Array.from(context.getImageData(x + dx, y + dy, 1, 1).data);
          if (rgba[3]! > threshold && (!best || rgba[3]! > best.rgba[3]!)) best = { rgba, dx, dy };
        }
      }
      return best ?? null;
    };
    const surface = resolveColor('--nodel-surface');
    const wireColor = resolveColor('--nodel-muted');
    const background = resolveColor('--nodel-bg');
    const samples = points.map((point) => {
      const port = read(layers[1]!, point.port, 0);
      const wire = read(layers[0]!, point.ink, 3);
      const overlay = wire ? read(layers[1]!, point.ink, 0, -1, wire.dx, wire.dy) : null;
      if (!port || !wire || !overlay) return { edgeId: point.edgeId, endpoint: point.endpoint, port, wire, overlay, visibleContrast: 0 };
      const wireAlpha = wire.rgba[3]! / 255;
      const overlayAlpha = overlay.rgba[3]! / 255;
      const composite = background.map((_, index) => {
        const under = wire.rgba[index]! * wireAlpha + background[index]! * (1 - wireAlpha);
        return overlay.rgba[index]! * overlayAlpha + under * (1 - overlayAlpha);
      });
      const visibleContrast = Math.max(...composite.map((channel, index) => Math.abs(channel - background[index]!)));
      return { edgeId: point.edgeId, endpoint: point.endpoint, port, wire, overlay, visibleContrast };
    });
    return { layers: layers.length, surface, wireColor, background, samples };
  }, samples);
  expect(result.layers).toBe(2);
  expect(result.samples).toHaveLength(samples.length);
  expect(result.samples.length).toBeGreaterThan(0);
  for (const sample of result.samples) {
    expect(sample.port, `${sample.edgeId} ${sample.endpoint} port rim should have nonzero geometry`).not.toBeNull();
    expect(sample.port?.rgba.slice(0, 3), `${sample.edgeId} ${sample.endpoint} socket should match resolved surface color`).toEqual(result.surface);
    expect(sample.wire, `${sample.edgeId} ${sample.endpoint} Bezier should paint just outside the endpoint`).not.toBeNull();
    expect(sample.wire?.rgba.slice(0, 3).every((channel, index) => Math.abs(channel - result.wireColor[index]!) <= 3),
      `${sample.edgeId} ${sample.endpoint} visible wire should match resolved muted token ${result.wireColor.join(',')}`).toBe(true);
    expect(sample.overlay?.rgba[3], `${sample.edgeId} ${sample.endpoint} ink sample should be outside card fill and heavy shadow`).toBeLessThan(64);
    expect(sample.visibleContrast, `${sample.edgeId} ${sample.endpoint} composed ink should contrast against canvas background`).toBeGreaterThan(40);
  }
  return { surfaceColor: result.surface, wireColor: result.wireColor, backgroundColor: result.background, endpoints: result.samples.length };
}

async function assertResolvedAccentPixel(page: Page, screen: Point): Promise<number[]> {
  const colors = await page.evaluate((point) => {
    const canvas = document.querySelectorAll<HTMLCanvasElement>('.canvas-stage canvas')[1];
    const context = canvas?.getContext('2d');
    const colorContext = document.createElement('canvas').getContext('2d');
    if (!canvas || !context || !colorContext) return { expected: [0, 0, 0], actual: null };
    const color = getComputedStyle(document.documentElement).getPropertyValue('--nodel-accent').trim();
    colorContext.fillStyle = /^(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color|#)/i.test(color) ? color : `rgb(${color})`;
    colorContext.fillRect(0, 0, 1, 1);
    const expected = Array.from(colorContext.getImageData(0, 0, 1, 1).data.slice(0, 3));
    const bounds = canvas.getBoundingClientRect();
    const x = Math.round((point.x - bounds.left) * canvas.width / bounds.width);
    const y = Math.round((point.y - bounds.top) * canvas.height / bounds.height);
    let actual: number[] | null = null;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const pixel = Array.from(context.getImageData(x + dx, y + dy, 1, 1).data);
        if (pixel[3]! > 128 && pixel.slice(0, 3).every((channel, index) => Math.abs(channel - expected[index]!) <= 3)) actual = pixel;
      }
    }
    return { expected, actual };
  }, screen);
  expect(colors.actual, `selection pixel should use resolved theme accent RGB ${colors.expected.join(',')}`).not.toBeNull();
  return colors.expected;
}

function assertNoCardOverlap(positions: Map<string, Point>): void {
  for (let i = 0; i < fixtureNodes.length; i += 1) {
    const left = fixtureNodes[i]!;
    const leftPosition = positions.get(left.id) ?? left;
    for (let j = i + 1; j < fixtureNodes.length; j += 1) {
      const right = fixtureNodes[j]!;
      const rightPosition = positions.get(right.id) ?? right;
      const overlaps = leftPosition.x < rightPosition.x + right.width
        && leftPosition.x + left.width > rightPosition.x
        && leftPosition.y < rightPosition.y + cardHeight(right)
        && leftPosition.y + cardHeight(left) > rightPosition.y;
      expect(overlaps, `${left.id} and ${right.id} should not overlap at the tested placement`).toBe(false);
    }
  }
}

async function assertNativeHit(page: Page, screen: Point, shapeId: string): Promise<void> {
  await page.mouse.move(screen.x, screen.y);
  const hit = await page.evaluate(() => {
    type NativeShape = { id(): string; getClassName(): string };
    type NativeStage = { getPointerPosition(): Point | null; getIntersection(point: Point): NativeShape | null };
    const konva = (window as Window & { Konva?: { stages?: NativeStage[] } }).Konva;
    const stage = konva?.stages?.[0];
    const pointer = stage?.getPointerPosition();
    const shape = pointer ? stage?.getIntersection(pointer) : null;
    return shape ? { id: shape.id(), className: shape.getClassName() } : null;
  });
  expect(hit, `Konva native hit graph at physical click ${JSON.stringify(screen)}`).toEqual({ id: shapeId, className: 'Shape' });
}

async function assertVisibleArrow(page: Page, bounds: Rect, camera: Camera, edgeId: string): Promise<void> {
  const edge = fixtureEdges.find((item) => item.id === edgeId)!;
  const curve = edgeCurves(edge, nodesById).at(-1)!;
  const arrow = curveArrow(curve)!;
  const arrowPoint = (leftWeight: number, rightWeight: number): Point => {
    const tipWeight = 1 - leftWeight - rightWeight;
    return screenPoint(bounds, camera, {
      x: arrow.tip.x * tipWeight + arrow.left.x * leftWeight + arrow.right.x * rightWeight,
      y: arrow.tip.y * tipWeight + arrow.left.y * leftWeight + arrow.right.y * rightWeight
    });
  };
  const shoulders = [arrowPoint(0.69, 0.14), arrowPoint(0.14, 0.69)];
  const contact = Array.from({ length: 19 }, (_, i) => screenPoint(bounds, camera, curvePoint(curve, arrow.t + (i - 14) * 0.005)));
  const alpha = await page.evaluate(({ shoulders, contact }) => {
    const layers = document.querySelectorAll<HTMLCanvasElement>('.canvas-stage canvas');
    const read = (canvas: HTMLCanvasElement, { x, y }: Point) => {
      const bounds = canvas.getBoundingClientRect();
      return canvas.getContext('2d')!.getImageData(
        Math.floor((x - bounds.left) * canvas.width / bounds.width),
        Math.floor((y - bounds.top) * canvas.height / bounds.height), 1, 1
      ).data[3]!;
    };
    return {
      shoulders: shoulders.map((point) => read(layers[0]!, point)),
      contact: contact.map((point) => read(layers[0]!, point)),
      cards: [...shoulders, ...contact].map((point) => read(layers[1]!, point))
    };
  }, { shoulders, contact });
  expect(Math.min(...alpha.shoulders), `${edgeId} arrowhead should have ink on both sides of its shaft`).toBeGreaterThan(90);
  expect(Math.min(...alpha.contact), `${edgeId} shaft should have continuous ink through the arrowhead`).toBeGreaterThan(52);
  expect(Math.max(...alpha.cards), `${edgeId} arrowhead should not be covered by a card or its shadow`).toBeLessThan(64);

  const body = arrowPoint(0.35, 0.35);
  await assertNativeHit(page, body, edgeId);
  // Temporarily remove the wide shaft hit stroke to prove the triangle itself paints a hit shape.
  const triangleHit = await page.evaluate(({ point, edgeId }) => {
    type NativeWire = { id(): string; strokeEnabled(value: boolean): void; getLayer(): { drawHit(): void } };
    type NativeStage = { findOne(selector: string): NativeWire; getIntersection(point: Point): NativeWire | null };
    const stage = (window as Window & { Konva?: { stages: NativeStage[] } }).Konva?.stages[0];
    if (!stage) throw new Error('Konva native stage registry is unavailable');
    const wire = stage.findOne(`#${edgeId}`);
    wire.strokeEnabled(false);
    try {
      wire.getLayer().drawHit();
      return stage.getIntersection(point)?.id();
    } finally {
      wire.strokeEnabled(true);
      wire.getLayer().drawHit();
    }
  }, { point: { x: body.x - bounds.x, y: body.y - bounds.y }, edgeId });
  expect(triangleHit, `${edgeId} arrowhead should be hittable without the shaft hit stroke`).toBe(edgeId);
}

test('saved nine-card plan remains interactive and visually stable', async ({ page }, testInfo) => {
  const previewOrigin = new URL(process.env.KONVA_EXPERIMENT_URL as string).origin;
  const unexpectedRequests: string[] = [];
  const restRequests: string[] = [];

  await page.addInitScript(() => {
    const counts = new WeakMap<HTMLCanvasElement, { id: number; draws: number }>();
    let nextId = 1;
    const clearRectDescriptor = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'clearRect');
    if (!clearRectDescriptor) throw new Error('Canvas clearRect method is unavailable');
    const originalClear = clearRectDescriptor.value as CanvasRenderingContext2D['clearRect'];
    CanvasRenderingContext2D.prototype.clearRect = function (...args: [number, number, number, number]) {
      let stat = counts.get(this.canvas);
      if (!stat) {
        stat = { id: nextId, draws: 0 };
        nextId += 1;
        counts.set(this.canvas, stat);
      }
      stat.draws += 1;
      return Reflect.apply(originalClear, this, args);
    };
    (window as Window & { __konvaTestCanvasStats?: () => LayerStats[] }).__konvaTestCanvasStats = () =>
      Array.from(document.querySelectorAll<HTMLCanvasElement>('.canvas-stage canvas')).map((canvas) => {
        const stat = counts.get(canvas);
        return { id: stat?.id ?? 0, draws: stat?.draws ?? 0, width: canvas.width, height: canvas.height };
      });
  });

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (/\/REST(?:\/|$)/i.test(url.pathname)) {
      restRequests.push(url.href);
      await route.abort('blockedbyclient');
      return;
    }
    if (url.origin !== previewOrigin) {
      unexpectedRequests.push(url.href);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  await page.goto(experimentPath, { waitUntil: 'networkidle' });
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Room network' })).toBeVisible();
  await assertNoPageScroll(page);

  const bounds = await stageBounds(page);
  // Self-loop fit bounds must not move the historical synthetic composition.
  expect(graphTop).toBe(100);
  const camera = initialCamera(bounds);
  const positions = new Map<string, Point>();
  const canvasIdentities = await canvasStats(page);
  const nativeIdentities = await nativeSceneIdentity(page);
  const dragFrames: FrameSample[] = [];
  expect(canvasIdentities).toHaveLength(2);
  expect(canvasIdentities.map((layer) => layer.id)).not.toContain(0);
  expect(nativeIdentities.cards.map((shape) => shape.id)).toEqual(fixtureNodes.map((node) => node.id).sort());
  expect(nativeIdentities.cards).toHaveLength(9);
  expect(nativeIdentities.wires.map((shape) => shape.id)).toEqual(fixtureEdges.map((edge) => edge.id).sort());
  expect(nativeIdentities.wires).toHaveLength(14);
  assertNoCardOverlap(positions);
  const initialColors = await assertPortGeometryAndInk(page, positions, camera);
  await page.mouse.move(0, 0);
  await capture(page, testInfo, 'unselected');
  const initialScene = await canvasPixelHashes(page);

  // Drag Schedule downward through the connection field into a tight but non-overlapping lane.
  const schedule = fixtureNodes[0]!;
  const scheduleCenter = screenPoint(bounds, camera, { x: schedule.x + schedule.width / 2, y: schedule.y + cardHeight(schedule) / 2 });
  await page.mouse.move(scheduleCenter.x, scheduleCenter.y);
  await page.mouse.down();
  for (const [dx, dy] of [[8, 48], [12, 112], [16, 208], [22, 320]] as const) {
    await page.mouse.move(scheduleCenter.x + dx, scheduleCenter.y + dy, { steps: 2 });
    dragFrames.push(await sampleTwoFrames(page));
    positions.set(schedule.id, { x: schedule.x + dx / camera.scale, y: schedule.y + dy / camera.scale });
    assertNoCardOverlap(positions);
    await assertPortGeometryAndInk(page, positions, camera);
    expect(await nativeSceneIdentity(page)).toEqual(nativeIdentities);
  }
  await page.mouse.up();

  // Zoom about a real pointer, pan on empty background, then drag a second card.
  const panStart = { x: bounds.x + bounds.width * 0.92, y: bounds.y + bounds.height * 0.88 };
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.wheel(0, -140);
  const zoomFactor = 1.07;
  const zoomed = {
    scale: camera.scale * zoomFactor,
    x: panStart.x - bounds.x - ((panStart.x - bounds.x - camera.x) / camera.scale) * camera.scale * zoomFactor,
    y: panStart.y - bounds.y - ((panStart.y - bounds.y - camera.y) / camera.scale) * camera.scale * zoomFactor
  };
  await sampleTwoFrames(page);
  await assertPortGeometryAndInk(page, positions, zoomed);
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panStart.x - 34, panStart.y - 25, { steps: 4 });
  await sampleTwoFrames(page);
  await page.mouse.up();
  const panned: Camera = { ...zoomed, x: zoomed.x - 34, y: zoomed.y - 25 };
  await assertPortGeometryAndInk(page, positions, panned);
  await assertNoPageScroll(page);

  const target = nodesById.get('touch-panel')!;
  const targetCenter = screenPoint(bounds, panned, { x: target.x + target.width / 2, y: target.y + cardHeight(target) / 2 });
  await page.mouse.move(targetCenter.x, targetCenter.y);
  await page.mouse.down();
  for (const amount of [0.25, 0.5, 0.75, 1] as const) {
    const dx = 36 * panned.scale * amount;
    const dy = 8 * panned.scale * amount;
    await page.mouse.move(targetCenter.x + dx, targetCenter.y + dy, { steps: 2 });
    dragFrames.push(await sampleTwoFrames(page));
    positions.set(target.id, { x: target.x + 36 * amount, y: target.y + 8 * amount });
    assertNoCardOverlap(positions);
    await assertPortGeometryAndInk(page, positions, panned);
    expect(await nativeSceneIdentity(page)).toEqual(nativeIdentities);
  }
  await page.mouse.up();

  // The two scene layers are retained through all updates; reset restores camera, not geometry.
  const afterGestures = await canvasStats(page);
  expect(afterGestures.map((layer) => layer.id)).toEqual(canvasIdentities.map((layer) => layer.id));
  expect(await nativeSceneIdentity(page)).toEqual(nativeIdentities);
  const movedState = await nativeSceneState(page);
  const schedulePosition = movedState.nodes.find((node) => node.id === 'schedule')!;
  expect(schedulePosition.x).not.toBe(fixtureNodes[0]!.x);
  expect(schedulePosition.y).not.toBe(fixtureNodes[0]!.y);
  await page.getByRole('button', { name: 'Reset view' }).click();
  const resetState = await nativeSceneState(page);
  expect(resetState.camera).toEqual({ x: camera.x, y: camera.y, scaleX: camera.scale, scaleY: camera.scale });
  expect(resetState.nodes).toEqual(movedState.nodes);
  const afterReset = await canvasStats(page);
  expect(afterReset.map((layer) => layer.id)).toEqual(canvasIdentities.map((layer) => layer.id));
  expect(await nativeSceneIdentity(page)).toEqual(nativeIdentities);

  // Exercise repeated navigation and confirm the static fixture identities are stable.
  const nodeIds = fixtureNodes.map((node) => node.id);
  const edgeIds = fixtureEdges.map((edge) => edge.id);
  for (let cycle = 0; cycle < 2; cycle += 1) {
    await page.goto(experimentPath, { waitUntil: 'networkidle' });
    await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
    expect(fixtureNodes.map((node) => node.id)).toEqual(nodeIds);
    expect(fixtureEdges.map((edge) => edge.id)).toEqual(edgeIds);
    await page.getByRole('button', { name: 'Reset view' }).click();
  }
  await page.mouse.move(0, 0);
  await page.waitForTimeout(50);
  const reloadedIdentities = await nativeSceneIdentity(page);
  expect(reloadedIdentities.cards.map((shape) => shape.id)).toEqual(nodeIds.slice().sort());
  expect(reloadedIdentities.wires.map((shape) => shape.id)).toEqual(edgeIds.slice().sort());
  const reloadedScene = await canvasPixelHashes(page);
  expect(reloadedScene).toEqual(initialScene);

  // Measure the exact idle interval and report real per-layer draw deltas.
  await page.waitForTimeout(350);
  const idleBefore = await canvasSnapshot(page);
  await page.waitForTimeout(1_000);
  const idleAfter = await canvasSnapshot(page);
  const idleDrawDeltas = idleAfter.layers.map((layer, index) => layer.draws - idleBefore.layers[index]!.draws);
  expect(idleDrawDeltas).toEqual([0, 0]);
  console.log(`Konva drag samples ${JSON.stringify(dragFrames)}`);
  expect(dragFrames).toHaveLength(8);
  expect(dragFrames.every((sample) => Number.isFinite(sample.firstFrameMs) && sample.firstFrameMs >= 0
    && Number.isFinite(sample.frameIntervalMs) && sample.frameIntervalMs >= 0)).toBe(true);
  const frameIntervals = dragFrames.map((sample) => sample.frameIntervalMs);
  const firstFrameDelays = dragFrames.map((sample) => sample.firstFrameMs);
  console.log(`Konva metrics ${JSON.stringify({
    viewport: testInfo.project.name,
    initialEdges: fixtureEdges.length,
    initialEndpointChecks: initialColors.endpoints,
    resolvedWireRGB: initialColors.wireColor,
    nativeCardShapes: nativeIdentities.cards.length,
    nativeWireShapes: nativeIdentities.wires.length,
    dragSamples: dragFrames.length,
    firstFrameMedianMs: Number(median(firstFrameDelays).toFixed(2)),
    firstFrameMaxMs: Number(Math.max(...firstFrameDelays).toFixed(2)),
    frameIntervalMedianMs: Number(median(frameIntervals).toFixed(2)),
    frameIntervalMaxMs: Number(Math.max(...frameIntervals).toFixed(2)),
    idleIntervalMs: Number((idleAfter.at - idleBefore.at).toFixed(1)),
    idleDraws: { before: idleBefore.layers.map((layer) => layer.draws), after: idleAfter.layers.map((layer) => layer.draws), delta: idleDrawDeltas },
    layerCanvasSizes: idleAfter.layers.map(({ width, height }) => [width, height])
  })}`);

  // Wire hit testing and selected-card screenshot are both trusted pointer clicks.
  const cleanBounds = await stageBounds(page);
  const cleanCamera = initialCamera(cleanBounds);
  const firstEdge = fixtureEdges.find((edge) => edge.id === 'controller-projector-a')!;
  const wireCurve = edgeCurve(firstEdge, nodesById);
  const wireClick = screenPoint(cleanBounds, cleanCamera, curvePoint(wireCurve, 0.5));
  await assertNativeHit(page, wireClick, firstEdge.id);
  await assertVisibleArrow(page, cleanBounds, cleanCamera, firstEdge.id);
  await assertVisibleArrow(page, cleanBounds, cleanCamera, 'panel-status');
  await assertVisibleArrow(page, cleanBounds, cleanCamera, 'controller-volume');
  const drawsBeforeWireClick = await canvasStats(page);
  await page.mouse.click(wireClick.x, wireClick.y);
  await page.waitForTimeout(50);
  const drawsAfterWireClick = await canvasStats(page);
  expect(drawsAfterWireClick.map((layer) => layer.draws)).not.toEqual(drawsBeforeWireClick.map((layer) => layer.draws));
  const sourceAccent = await assertResolvedAccentPixel(page, screenPoint(cleanBounds, cleanCamera, portPoint(nodesById.get(firstEdge.from.nodeId)!, firstEdge.from.portId)));
  const targetAccent = await assertResolvedAccentPixel(page, screenPoint(cleanBounds, cleanCamera, portPoint(nodesById.get(firstEdge.to.nodeId)!, firstEdge.to.portId)));
  expect(targetAccent).toEqual(sourceAccent);
  expect(await nativeSceneIdentity(page)).toEqual(reloadedIdentities);
  const schedulePoint = screenPoint(cleanBounds, cleanCamera, { x: schedule.x + schedule.width / 2, y: schedule.y + cardHeight(schedule) / 2 });
  await page.mouse.click(schedulePoint.x, schedulePoint.y);
  await page.waitForTimeout(60);
  const cardAccent = await assertResolvedAccentPixel(page, screenPoint(cleanBounds, cleanCamera, { x: schedule.x + schedule.width / 2, y: schedule.y }));
  expect(cardAccent).toEqual(sourceAccent);
  await assertPortGeometryAndInk(page, new Map([[schedule.id, { x: schedule.x, y: schedule.y }]]), cleanCamera);
  expect(await nativeSceneIdentity(page)).toEqual(reloadedIdentities);
  await capture(page, testInfo, 'selected-node');

  expect(restRequests).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
  await assertNoPageScroll(page);
  console.log(`Konva resolved selection accent RGB ${sourceAccent.join(',')}`);
});

test('size selector navigates between complete deterministic fixtures', async ({ page }) => {
  const url = new URL(experimentPath, process.env.KONVA_EXPERIMENT_URL);
  url.searchParams.set('nodes', '9');
  await page.goto(url.href, { waitUntil: 'networkidle' });
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect(page.locator('[data-fixture-summary]')).toHaveText('9 nodes · 14 edges');
  expect((await nativeSceneIdentity(page)).cards).toHaveLength(9);
  expect((await nativeSceneIdentity(page)).wires).toHaveLength(14);

  await page.getByLabel('Graph source').selectOption('50');
  await expect(page).toHaveURL(/(?:\?|&)nodes=50(?:&|$)/);
  await expect(page.locator('[data-fixture-summary]')).toHaveText('50 nodes · 77 edges');
  expect((await nativeSceneIdentity(page)).cards).toHaveLength(50);
  expect((await nativeSceneIdentity(page)).wires).toHaveLength(77);

  await page.getByLabel('Graph source').selectOption('9');
  await expect(page).toHaveURL(/(?:\?|&)nodes=9(?:&|$)/);
  await expect(page.locator('[data-fixture-summary]')).toHaveText('9 nodes · 14 edges');
  expect((await nativeSceneIdentity(page)).cards).toHaveLength(9);
  expect((await nativeSceneIdentity(page)).wires).toHaveLength(14);
});

test('System stays selected and repaints the canvas until a stored theme overrides it', async ({ page, context }) => {
  await page.goto(experimentPath);
  const root = page.locator('html');
  const theme = page.getByRole('combobox', { name: 'Theme' });
  const storedTheme = () => page.evaluate(() => localStorage.getItem('nodel.theme'));
  await expect(theme).toHaveValue('system');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await sampleTwoFrames(page);
  const lightScene = await canvasPixelHashes(page);
  const camera = initialCamera(await stageBounds(page));

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(theme).toHaveValue('system');
  expect(await storedTheme()).toBeNull();
  await sampleTwoFrames(page);
  const darkScene = await canvasPixelHashes(page);
  expect(darkScene[0]).not.toBe(lightScene[0]);
  expect(darkScene[1]).not.toBe(lightScene[1]);
  await assertPortGeometryAndInk(page, new Map(), camera);

  await theme.selectOption('light');
  expect(await storedTheme()).toBe('light');
  await page.reload();
  await expect(theme).toHaveValue('light');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await sampleTwoFrames(page);
  await expect(root).toHaveAttribute('data-theme', 'light');
  expect(await canvasPixelHashes(page)).toEqual(lightScene);

  await theme.selectOption('system');
  expect(await storedTheme()).toBeNull();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'light');

  const otherTab = await context.newPage();
  await otherTab.goto(experimentPath);
  await otherTab.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect(theme).toHaveValue('dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await otherTab.getByRole('combobox', { name: 'Theme' }).selectOption('system');
  await expect(theme).toHaveValue('system');
  await expect(root).toHaveAttribute('data-theme', 'light');
  await otherTab.close();
});

test('Back and Forward restore the retained stage and live controls from BFCache', async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener('pageshow', (event) => {
      const { dataset } = document.documentElement;
      if (event.persisted) dataset.restored = String(Number(dataset.restored ?? '0') + 1);
    });
  });
  const stageScale = () => page.evaluate(() => {
    const konva = (window as Window & { Konva?: { stages: Array<{ scaleX(): number }> } }).Konva;
    return konva?.stages[0]?.scaleX();
  });
  const first = new URL(experimentPath, process.env.KONVA_EXPERIMENT_URL);
  const second = new URL(first);
  second.searchParams.set('history', 'forward');
  const scene = page.locator('.canvas-stage canvas');
  const root = page.locator('html');
  const zoomIn = page.getByRole('button', { name: 'Zoom in' });

  await page.goto(first.href);
  const firstScale = initialCamera(await stageBounds(page)).scale;
  await expect.poll(stageScale).toBeCloseTo(firstScale, 8);
  await zoomIn.click();
  const zoomedFirst = firstScale * 1.15;
  await expect.poll(stageScale).toBeCloseTo(zoomedFirst, 8);
  await page.goto(second.href);
  await expect.poll(stageScale).toBeCloseTo(firstScale, 8);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  const zoomedSecond = firstScale / 1.15;
  await expect.poll(stageScale).toBeCloseTo(zoomedSecond, 8);

  for (let restore = 1; restore <= 2; restore += 1) {
    await page.goBack({ waitUntil: 'commit' });
    await expect(page).toHaveURL(first.href);
    await expect(root).toHaveAttribute('data-restored', String(restore));
    await expect(scene).toHaveCount(2);
    await expect.poll(stageScale).toBeCloseTo(zoomedFirst, 8);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect.poll(stageScale).toBeCloseTo(firstScale, 8);
    await zoomIn.click();
    await expect.poll(stageScale).toBeCloseTo(zoomedFirst, 8);

    await page.goForward({ waitUntil: 'commit' });
    await expect(page).toHaveURL(second.href);
    await expect(root).toHaveAttribute('data-restored', String(restore));
    await expect(scene).toHaveCount(2);
    await expect.poll(stageScale).toBeCloseTo(zoomedSecond, 8);
  }
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect(scene).toHaveCount(0);
  expect(await stageScale()).toBeUndefined();
});
