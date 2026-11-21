import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Experiment-only source transform. Controls and each candidate are served by
// separate fresh pages; no product source or baseline artifact is rewritten.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const variants = (process.env.KONVA_CANDIDATES ?? 'control,perfectDrawDisabled,shadowForStrokeDisabled,groupCachedComplete').split(',');
const sizes = (process.env.KONVA_SIZES ?? '9,450').split(',').map(Number);
const themes = (process.env.KONVA_THEMES ?? 'light,dark').split(',');
const viewports = (process.env.KONVA_VIEWPORTS ?? '1366x768,1920x1080').split(',').map((value) => {
  const [width, height] = value.split('x').map(Number);
  return { width, height };
});
const repeats = Number(process.env.KONVA_REPEATS ?? 3);
const outputPath = resolve(here, process.env.KONVA_OUTPUT ?? 'candidate-results.json');
const rows = [];
const createdAt = new Date().toISOString();
let sourceSha256 = '';

function writeResults(complete) {
  writeFileSync(outputPath, `${JSON.stringify({
    schemaVersion: 2,
    createdAt,
    complete,
    chromium: browser?.version() ?? 'not-launched',
    sourcePath: 'src/experiments/konva-canvas/main.ts',
    sourceSha256,
    repeats, sizes, themes, viewports, variants,
    method: 'Fresh browser context per row; source transformed in-memory; five direct synchronous card-layer drawScene calls after readiness; SHA-256 hashes are readback of the two visible scene canvases only (wire scene layer and card scene layer), never Konva hit canvases; interactive checks use native Konva intersections and trusted browser clicks; every fixture wire endpoint is checked against its declared node/port and sampled for actual wire-layer scene ink; selected node/wire state and visible selection redraw are checked; complete-group cache, when tested, is applied after all children are constructed; cache bytes are scene+hit RGBA backing lower bounds, not a heap measurement.',
    rows
  }, null, 2)}\n`);
}

function plugin() {
  return { name: 'konva-card-candidate-only', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/experiments/konva-canvas/main.ts')) return null;
    const needle = "  const rect = new Konva.Rect({ x: 0, y: 0, width: node.width, height, fill: colors.surface, stroke: colors.border, strokeWidth: 1, cornerRadius: 10, shadowColor: '#142536', shadowBlur: 11, shadowOpacity: 0.1, shadowOffsetY: 3, ...(nodes.length > 9 ? { shadowForStrokeEnabled: false } : {}) });";
    const replacement = `  const __variant = new URLSearchParams(location.search).get('candidate') || 'control';\n  const rect = new Konva.Rect({ x: 0, y: 0, width: node.width, height, fill: colors.surface, stroke: colors.border, strokeWidth: 1, cornerRadius: 10, shadowColor: '#142536', shadowBlur: 11, shadowOpacity: 0.1, shadowOffsetY: 3, perfectDrawEnabled: __variant === 'perfectDrawDisabled' ? false : true, shadowForStrokeEnabled: __variant === 'shadowForStrokeDisabled' || (__variant === 'optimizedLargerOnly' && nodes.length > 9) ? false : true });`;
    if (!code.includes(needle)) throw new Error('Card rect transform did not match source');
    let transformed = code.replace(needle, replacement);
    transformed = transformed.replace('  group.on(\'click tap\', (event) => {', `  if (__variant === 'groupCachedComplete') group.cache({ pixelRatio: 1 });\n  group.on('click tap', (event) => {`);
    transformed = transformed.replace('initializeTheme();\ninitialize();', `initializeTheme();\ninitialize();\n(window as Window & { __konvaCandidateSnapshot?: () => unknown }).__konvaCandidateSnapshot = () => ({ nodes, edges, wireGeometry: Array.from(wireGeometry.entries()), selectedNode, selectedEdge });`);
    return { code: transformed, map: null };
  } };
}

async function sample(browser, port, variant, size, theme, viewport, repeat) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce' });
  await context.addInitScript((name) => localStorage.setItem('nodel.theme', name), theme);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/topology-canvas.html?nodes=${size}&candidate=${variant}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((expected) => window.Konva?.stages?.[0]?.find('.topology-card').length === expected, size);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const details = await page.evaluate(async (expected) => {
    const stage = window.Konva.stages[0];
    const cardLayer = stage.getLayers()[1];
    const cards = stage.find('.topology-card');
    const wires = stage.find('.topology-wire');
    const snapshot = window.__konvaCandidateSnapshot();
    const fixtureNodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const wireGeometry = new Map(snapshot.wireGeometry);
    const stagePoint = (point) => stage.getAbsoluteTransform().point(point);
    const bezier = (curve, t) => {
      const u = 1 - t;
      return {
        x: u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.control1.x + 3 * u * t ** 2 * curve.control2.x + t ** 3 * curve.end.x,
        y: u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.control1.y + 3 * u * t ** 2 * curve.control2.y + t ** 3 * curve.end.y
      };
    };
    const portPoint = (node, id) => {
      const port = node.ports.find((item) => item.id === id);
      const sidePorts = node.ports.filter((item) => item.side === port.side);
      const index = sidePorts.findIndex((item) => item.id === id);
      return { x: node.x + (port.side === 'left' ? 0 : node.width), y: node.y + 76 + index * 26 + 13 };
    };
    const endpointGeometryChecks = snapshot.edges.map((edge) => {
      const curves = wireGeometry.get(edge.id)?.curves;
      const fromNode = fixtureNodes.get(edge.from.nodeId);
      const toNode = fixtureNodes.get(edge.to.nodeId);
      const from = portPoint(fromNode, edge.from.portId);
      const to = portPoint(toNode, edge.to.portId);
      const start = curves?.[0]?.start;
      const end = curves?.at(-1)?.end;
      return Boolean(start && end && Math.hypot(start.x - from.x, start.y - from.y) < 0.001 && Math.hypot(end.x - to.x, end.y - to.y) < 0.001);
    });
    const hostBounds = stage.container().getBoundingClientRect();
    const wireCanvas = document.querySelector('.canvas-stage canvas');
    const wireContext = wireCanvas.getContext('2d');
    const wireBounds = wireCanvas.getBoundingClientRect();
    const inkSamples = snapshot.edges.map((edge) => {
      const curves = wireGeometry.get(edge.id).curves;
      return [bezier(curves[0], 0.12), bezier(curves.at(-1), 0.88)].map((point) => {
        const screen = stagePoint(point);
        const x = Math.round((screen.x + hostBounds.left - wireBounds.left) * wireCanvas.width / wireBounds.width);
        const y = Math.round((screen.y + hostBounds.top - wireBounds.top) * wireCanvas.height / wireBounds.height);
        let alpha = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          if (x + dx >= 0 && y + dy >= 0 && x + dx < wireCanvas.width && y + dy < wireCanvas.height) {
            alpha = Math.max(alpha, wireContext.getImageData(x + dx, y + dy, 1, 1).data[3]);
          }
        }
        return alpha;
      });
    });
    const rects = cards.map((group) => {
      const rect = group.findOne('Rect');
      const box = rect.getClientRect();
      return [group.id(), group.x(), group.y(), box.x, box.y, box.width, box.height];
    });
    const visibleSceneCanvasHashes = [];
    const sceneCanvases = [...document.querySelectorAll('.canvas-stage canvas')];
    const hashScenes = async () => {
      const hashes = [];
      for (const canvas of sceneCanvases) {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
        hashes.push(Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''));
      }
      return hashes;
    };
    visibleSceneCanvasHashes.push(...await hashScenes());
    const times = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      cardLayer.drawScene();
      times.push(performance.now() - start);
    }
    const groupCanvases = cards.reduce((sum, group) => sum + (group.isCached() ? 1 : 0), 0);
    const cacheBacking = cards.reduce((sum, group) => {
      if (!group.isCached()) return sum;
      const cache = group._getCanvasCache();
      return sum + (cache ? ((cache.scene?.width ?? 0) * (cache.scene?.height ?? 0) + (cache.hit?.width ?? 0) * (cache.hit?.height ?? 0)) * 4 : 0);
    }, 0);
    const expectedWires = expected === 9 ? 14 : 700;
    const card = cards[0];
    const firstNode = fixtureNodes.get(card.id());
    const cardPoint = stagePoint({ x: card.x() + firstNode.width / 2, y: card.y() + 30 });
    const cardHit = stage.getIntersection(cardPoint);
    const cardId = card.id();
    const cardRect = card.findOne('Rect');
    const cardHashBefore = (await hashScenes())[1];
    return {
      fixtureCounts: { nodes: cards.length, wires: wires.length, expectedWires },
      cardShapeCounts: cards.map((group) => group.getChildren().length),
      rects,
      visibleSceneCanvasHashes,
      drawSceneMs: times,
      cacheGroups: cards.reduce((sum, group) => sum + Number(group.isCached()), 0),
      estimatedGroupCacheBytes: cacheBacking,
      cacheEstimateScope: 'scene + hit RGBA backing only; filter canvases (currently zero-sized), GPU copies, and compositor storage excluded; this is an RGBA lower bound, not a heap measurement',
      layers: sceneCanvases.length,
      endpointGeometry: { checked: endpointGeometryChecks.length, passed: endpointGeometryChecks.filter(Boolean).length },
      endpointInk: { checked: inkSamples.flat().length, passed: inkSamples.flat().filter((alpha) => alpha > 0).length, minimumAlpha: Math.min(...inkSamples.flat()) },
      cardHit: { targetId: cardId, hitId: cardHit?.getParent()?.id() ?? cardHit?.id() ?? null },
      cardSelection: { click: { x: hostBounds.left + cardPoint.x, y: hostBounds.top + cardPoint.y }, beforeHash: cardHashBefore, strokeBefore: cardRect.stroke() }
    };
  }, size);
  await page.mouse.click(details.cardSelection.click.x, details.cardSelection.click.y);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const afterNode = await page.evaluate(async () => {
    const snapshot = window.__konvaCandidateSnapshot();
    const cards = window.Konva.stages[0].find('.topology-card');
    const canvasHashes = [];
    for (const canvas of document.querySelectorAll('.canvas-stage canvas')) {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      canvasHashes.push(Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''));
    }
    return { selectedNode: snapshot.selectedNode, selectedEdge: snapshot.selectedEdge, rectStroke: cards[0].findOne('Rect').stroke(), visibleSceneCanvasHashes: canvasHashes };
  });
  const wireTarget = await page.evaluate(() => {
    const stage = window.Konva.stages[0];
    const snapshot = window.__konvaCandidateSnapshot();
    const geometry = new Map(snapshot.wireGeometry);
    for (const edge of snapshot.edges) for (const curve of geometry.get(edge.id)?.curves ?? []) {
      for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const u = 1 - t;
        const point = stage.getAbsoluteTransform().point({
          x: u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.control1.x + 3 * u * t ** 2 * curve.control2.x + t ** 3 * curve.end.x,
          y: u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.control1.y + 3 * u * t ** 2 * curve.control2.y + t ** 3 * curve.end.y
        });
        if (stage.getIntersection(point)?.id() === edge.id) {
          return { id: edge.id, world: { x: point.x / stage.scaleX() - stage.x() / stage.scaleX(), y: point.y / stage.scaleY() - stage.y() / stage.scaleY() } };
        }
      }
    }
    return null;
  });
  if (!wireTarget) throw new Error(`No native-hit wire sample for ${variant}/${size}`);
  const wireClick = await page.evaluate(async (target) => {
    const stage = window.Konva.stages[0];
    const scale = 1.6;
    const point = { x: Math.round(stage.width() / 2), y: Math.round(stage.height() / 2) };
    stage.scale({ x: scale, y: scale });
    stage.position({ x: point.x - target.world.x * scale, y: point.y - target.world.y * scale });
    stage.draw();
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const hit = stage.getIntersection(point);
    const bounds = stage.container().getBoundingClientRect();
    return { id: target.id, x: bounds.left + point.x, y: bounds.top + point.y, nativeHitId: hit?.id() ?? null, scale };
  }, wireTarget);
  const beforeWire = await page.evaluate(async () => {
    const hashes = [];
    for (const canvas of document.querySelectorAll('.canvas-stage canvas')) {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      hashes.push(Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''));
    }
    return hashes;
  });
  await page.mouse.click(wireClick.x, wireClick.y);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const afterWire = await page.evaluate(async () => {
    const snapshot = window.__konvaCandidateSnapshot();
    const hashes = [];
    for (const canvas of document.querySelectorAll('.canvas-stage canvas')) {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      hashes.push(Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''));
    }
    return { selectedNode: snapshot.selectedNode, selectedEdge: snapshot.selectedEdge, visibleSceneCanvasHashes: hashes };
  });
    details.semantics = {
    nodeSelected: afterNode.selectedNode === details.cardHit.targetId && afterNode.selectedEdge === undefined,
    nodeHit: details.cardHit.hitId === details.cardHit.targetId,
    nodeSelectionVisible: JSON.stringify(afterNode.visibleSceneCanvasHashes[1]) !== JSON.stringify(details.visibleSceneCanvasHashes[1]),
    wireHit: wireClick.nativeHitId === wireClick.id,
    wireSelected: afterWire.selectedEdge === wireClick.id && afterWire.selectedNode === undefined,
    wireSelectionVisible: afterWire.visibleSceneCanvasHashes[0] !== beforeWire[0],
    endpointHighlightVisible: afterWire.visibleSceneCanvasHashes[1] !== beforeWire[1],
    selectedWireId: wireClick.id
  };
  details.wireSelectionSceneHashes = { before: beforeWire, after: afterWire.visibleSceneCanvasHashes };
  const failedSemantics = Object.entries(details.semantics).filter(([key, value]) => key !== 'selectedWireId' && value !== true).map(([key]) => key);
  details.validation = {
    fixtureCounts: details.fixtureCounts.nodes === size && details.fixtureCounts.wires === details.fixtureCounts.expectedWires,
    twoVisibleSceneLayers: details.layers === 2,
    endpointGeometry: details.endpointGeometry.passed === details.endpointGeometry.checked,
    endpointSceneInk: details.endpointInk.passed === details.endpointInk.checked,
    interactions: failedSemantics.length === 0,
    failedSemantics
  };
  await context.close();
  if (errors.length) throw new Error(`${variant}/${size}/${theme}: ${errors.join('; ')}`);
  return { variant, size, theme, viewport, repeat, ...details };
}

let server;
let browser;
try {
  server = await createServer({ configFile: resolve(root, 'vite.konva.config.ts'), plugins: [plugin()], server: { host: '127.0.0.1', port: 0, strictPort: false, open: false } });
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  sourceSha256 = createHash('sha256').update(readFileSync(resolve(root, 'src/experiments/konva-canvas/main.ts'))).digest('hex');
  for (let repeat = 0; repeat < repeats; repeat++) {
    // Rotate variant order so warming / machine drift does not always favor a candidate.
    const order = variants.slice(repeat).concat(variants.slice(0, repeat));
    for (const size of sizes) for (const theme of themes) for (const viewport of viewports) for (const variant of order) {
      rows.push(await sample(browser, server.config.server.port, variant, size, theme, viewport, repeat));
      writeResults(false);
      console.log(`candidate ${variant} nodes=${size} theme=${theme} viewport=${viewport.width}x${viewport.height} run=${repeat + 1}`);
    }
  }
  writeResults(true);
} finally {
  await browser?.close();
  await server?.close();
}
