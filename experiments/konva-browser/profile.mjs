import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { cpus, hostname, platform, release } from 'node:os';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicitly profile-only source transform. It serves a transient instrumented
// variant from memory; no application or benchmark source is edited.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const baselineCommit = 'a07bb09ea6d2d0214a7bf667c4d566558de7ab9f';
const pinnedInputs = {
  'src/experiments/konva-canvas/main.ts': '1edb3084549f76196c4ffe26f97e792f8b48755b',
  'src/experiments/konva-canvas/fixture.ts': 'd5161cc889b2ac3359bee36a9434d1b523426781',
  'src/experiments/konva-canvas/style.css': 'c2710f1c8f2ede5c1c8cc612abf42e8b6dde9c5d',
  'src/theme/theme.ts': '87dc011f4c555db4046ea0d291a1dbd127d91e0e',
  'topology-canvas.html': '142a533cc907ed7a16fe70689aba1890f048cddb',
  'vite.konva.config.ts': 'e011ab096302a6fdfc99f250ae4c0348ff7b489d',
  'package-lock.json': '8d02f7274f0b53689ecf120b4679b440f44887b7'
};
const runId = `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${process.pid}`;
const runDirectory = resolve(here, 'profile-runs', runId);
const output = resolve(runDirectory, 'profile-results.json');
const artifacts = resolve(runDirectory, 'profile-evidence');
const sizes = [9, 50, 150, 450];
const modes = ['full', 'nodes-only', 'wires-only'];
const themes = ['light', 'dark'];
const viewport = { width: 1366, height: 768 };
const repeats = Number(process.env.KONVA_PROFILE_REPEATS ?? 1);
const samples = [];

if (!Number.isInteger(repeats) || repeats < 1) throw new Error('KONVA_PROFILE_REPEATS must be an integer >= 1.');

function verifyPinnedBaseline() {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (head !== baselineCommit) throw new Error(`Refusing to profile: HEAD ${head} is not pinned baseline ${baselineCommit}.`);
  for (const [file, expected] of Object.entries(pinnedInputs)) {
    const actual = execFileSync('git', ['hash-object', file], { cwd: root, encoding: 'utf8' }).trim();
    if (actual !== expected) throw new Error(`Refusing to profile: ${file} blob ${actual} does not match pinned baseline blob ${expected}.`);
  }
}

verifyPinnedBaseline();
mkdirSync(resolve(here, 'profile-runs'), { recursive: true });
// Deliberately exclusive: reruns always get a fresh path and never replace raw data.
mkdirSync(runDirectory, { recursive: false });

function round(n) { return Number(n.toFixed(3)); }

function profilePlugin() {
  return {
    name: 'konva-profile-only-instrumentation',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/experiments/konva-canvas/main.ts')) return null;
      let transformed = code;
      transformed = transformed.replace(
        'const { nodes, edges } = createFixture(nodeCount);',
        `const __profileStart = performance.now();\nconst { nodes, edges } = createFixture(nodeCount);\nwindow.__konvaProfile = { construction: {}, calls: {}, draws: {}, query: { calls: 0, ms: 0 } };\nwindow.__konvaProfile.construction.fixtureMs = performance.now() - __profileStart;\nconst __profileMode = new URLSearchParams(location.search).get('profileMode') || 'full';`
      );
      transformed = transformed.replace(
        'function updateWireGeometry(edge: FixtureEdge): void {\n  const curves = edgeCurves(edge, nodeById);\n  const terminal = curves.at(-1);\n  wireGeometry.set(edge.id, { curves, arrow: terminal && curveArrow(terminal) });\n}',
        `function updateWireGeometry(edge: FixtureEdge): void {\n  const __start = performance.now();\n  const curves = edgeCurves(edge, nodeById);\n  const terminal = curves.at(-1);\n  wireGeometry.set(edge.id, { curves, arrow: terminal && curveArrow(terminal) });\n  const __calls = window.__konvaProfile.calls;\n  __calls.updateWireGeometry = __calls.updateWireGeometry || { calls: 0, elapsedMs: 0 };\n  __calls.updateWireGeometry.calls++; __calls.updateWireGeometry.elapsedMs += performance.now() - __start;\n}`
      );
      transformed = transformed.replace(
        '    for (const edge of edges) {\n      const shape = makeWire(edge);\n      wireLayer.add(shape);\n    }\n    for (const node of nodes) {\n      const group = makeCard(node);\n      cardGroups.set(node.id, group);\n      cardLayer.add(group);\n    }',
        `    const __buildStart = performance.now();\n    if (__profileMode !== 'nodes-only') for (const edge of edges) {\n      const shape = makeWire(edge);\n      wireLayer.add(shape);\n    }\n    window.__konvaProfile.construction.wiresMs = performance.now() - __buildStart;\n    const __nodesStart = performance.now();\n    if (__profileMode !== 'wires-only') for (const node of nodes) {\n      const group = makeCard(node);\n      cardGroups.set(node.id, group);\n      cardLayer.add(group);\n    }\n    window.__konvaProfile.construction.nodesMs = performance.now() - __nodesStart;\n    window.__konvaProfile.construction.completeMs = performance.now() - __profileStart;`
      );
      const atInit = `const __profileDraw = (prototype, method, layerName, kind) => {\n  const original = prototype[method];\n  prototype[method] = function(...args) {\n    const start = performance.now();\n    try { return Reflect.apply(original, this, args); } finally {\n      const key = layerName(this) + ':' + kind;\n      const bucket = window.__konvaProfile.draws[key] || (window.__konvaProfile.draws[key] = { calls: 0, ms: 0 });\n      bucket.calls++; bucket.ms += performance.now() - start;\n    }\n  };\n};\n__profileDraw(Konva.Layer.prototype, 'drawScene', (layer) => layer.name() || 'unnamed', 'scene');\n__profileDraw(Konva.Layer.prototype, 'drawHit', (layer) => layer.name() || 'unnamed', 'hit');\nconst __originalIntersection = Konva.Stage.prototype.getIntersection;\nKonva.Stage.prototype.getIntersection = function(...args) {\n  const start = performance.now();\n  try { return Reflect.apply(__originalIntersection, this, args); } finally { window.__konvaProfile.query.calls++; window.__konvaProfile.query.ms += performance.now() - start; }\n};\n`;
      const shapeInstrumentation = `const __shapeCategory = (shape) => {\n  if (shape.name().split(/\\s+/).includes('topology-wire')) return 'wire';\n  if (shape.getClassName() === 'Text') return 'node-text';\n  if (shape.shadowBlur && shape.shadowBlur() > 0) return 'node-card-shadow';\n  return 'node-shape';\n};\n__profileDraw(Konva.Shape.prototype, 'drawScene', (shape) => __shapeCategory(shape), 'scene-shape');\n__profileDraw(Konva.Shape.prototype, 'drawHit', (shape) => __shapeCategory(shape), 'hit-shape');\n`;
      transformed = transformed.replace('const host = document.querySelector<HTMLElement>(\'#diagram\');', `${atInit}${shapeInstrumentation}\nconst host = document.querySelector<HTMLElement>('#diagram');`);
      transformed = transformed.replace('initializeTheme();\ninitialize();', `initializeTheme();\ninitialize();\nwindow.__konvaProfile.construction.initializeReturnedAt = performance.now();`);
      if (transformed === code || !transformed.includes('__profileMode')) throw new Error(`Profile transform failed to match baseline main.ts: ${id}`);
      return { code: transformed, map: null };
    }
  };
}

function summarizeCpu(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const frame = nodes.get(profile.samples[i]);
    const delta = profile.timeDeltas?.[i] ?? 0;
    const name = frame?.functionName || '(anonymous)';
    self.set(name, (self.get(name) ?? 0) + delta);
  }
  return [...self].map(([functionName, microseconds]) => ({ functionName, sampleMs: round(microseconds / 1000) }))
    .sort((a, b) => b.sampleMs - a.sampleMs).slice(0, 20);
}

async function launchCase(browser, size, mode, theme, repeat, screenshot = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce' });
  await context.addInitScript((themeName) => localStorage.setItem('nodel.theme', themeName), theme);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await cdp.send('Profiler.start');
  const url = `http://127.0.0.1:${server.config.server.port}/topology-canvas.html?nodes=${size}&profileMode=${mode}`;
  const navigationStart = performance.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((expected) => {
    const stage = window.Konva?.stages?.[0];
    const wires = stage?.find('.topology-wire').length ?? 0;
    return stage && stage.find('.topology-card').length === expected.cards
      && (expected.hasWires ? wires > 0 : wires === 0)
      && document.querySelectorAll('.canvas-stage canvas').length === 2;
  }, { cards: mode === 'wires-only' ? 0 : size, hasWires: mode !== 'nodes-only' }, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll('.canvas-stage canvas').length === 2);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const stageReadyWallMs = round(performance.now() - navigationStart);
  const { profile: constructionProfile } = await cdp.send('Profiler.stop');
  const initial = await page.evaluate(() => {
    const stage = window.Konva.stages[0];
    const box = stage.container().getBoundingClientRect();
    const card = stage.find('.topology-card')[0];
    const rect = card?.getClientRect({ relativeTo: stage });
    let empty;
    for (const [x, y] of [[0.96, 0.96], [0.05, 0.96], [0.96, 0.05], [0.05, 0.05], [0.5, 0.95]]) {
      const point = { x: box.width * x, y: box.height * y };
      if (!stage.getIntersection(point)) { empty = { x: box.left + point.x, y: box.top + point.y }; break; }
    }
    return {
      camera: { x: stage.x(), y: stage.y(), scale: stage.scaleX() },
      box: { x: box.left, y: box.top, width: box.width, height: box.height },
      card: card ? { id: card.id(), x: card.x(), y: card.y(), cx: box.left + stage.x() + (rect.x + rect.width / 2) * stage.scaleX(), cy: box.top + stage.y() + (rect.y + rect.height / 2) * stage.scaleY() } : null,
      empty,
      cards: stage.find('.topology-card').length,
      wires: stage.find('.topology-wire').length,
      profile: window.__konvaProfile
    };
  });
  if (screenshot) {
    mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: resolve(artifacts, `baseline-${size}-${theme}.png`), fullPage: false, animations: 'disabled' });
  }

  const phases = [];
  const exercise = async (name, work, validate) => {
    const before = await page.evaluate(() => {
      const stage = window.Konva.stages[0];
      const card = stage.find('.topology-card')[0];
      return { camera: { x: stage.x(), y: stage.y(), scale: stage.scaleX() }, card: card ? { x: card.x(), y: card.y() } : null };
    });
    await page.evaluate(() => { window.__konvaProfile.draws = {}; window.__konvaProfile.query = { calls: 0, ms: 0 }; window.__konvaProfile.calls = {}; });
    await cdp.send('Profiler.start');
    const start = performance.now();
    await work();
    const wallMs = performance.now() - start;
    const { profile } = await cdp.send('Profiler.stop');
    const after = await page.evaluate(() => {
      const stage = window.Konva.stages[0];
      return { camera: { x: stage.x(), y: stage.y(), scale: stage.scaleX() }, card: stage.find('.topology-card')[0] ? { x: stage.find('.topology-card')[0].x(), y: stage.find('.topology-card')[0].y() } : null, draws: window.__konvaProfile.draws, calls: window.__konvaProfile.calls, query: window.__konvaProfile.query };
    });
    const cameraDelta = { x: after.camera.x - before.camera.x, y: after.camera.y - before.camera.y, scale: after.camera.scale - before.camera.scale };
    phases.push({ name, dispatchWallMs: round(wallMs), cpuTopSelf: summarizeCpu(profile), cameraBefore: before.camera, cameraAfter: after.camera, cameraDelta, ...after, verified: validate(after, before) });
  };
  const dragPossible = Boolean(initial.card);
  if (dragPossible) await exercise('drag', async () => {
    await page.mouse.move(initial.card.cx, initial.card.cy); await page.mouse.down();
    await page.mouse.move(initial.card.cx + 48, initial.card.cy + 32, { steps: 12 }); await page.mouse.up();
  }, (state, before) => state.card && before.card && Math.abs(state.card.x - before.card.x) > 1 && Math.abs(state.card.y - before.card.y) > 1);
  else phases.push({ name: 'drag', status: 'N/A: wire-only constructs zero card groups; no draggable node exists' });
  if (initial.empty) await exercise('pan', async () => {
    await page.mouse.move(initial.empty.x, initial.empty.y); await page.mouse.down();
    await page.mouse.move(initial.empty.x - 42, initial.empty.y - 29, { steps: 10 }); await page.mouse.up();
  }, (state, before) => Math.abs(state.camera.x - before.camera.x) > 5 && Math.abs(state.camera.y - before.camera.y) > 5);
  await exercise('zoom', async () => {
    const p = { x: initial.box.x + initial.box.width * 0.62, y: initial.box.y + initial.box.height * 0.45 };
    await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, -240);
  }, (state, before) => Math.abs(state.camera.scale - before.camera.scale) > 0.001);

  await cdp.send('Profiler.start');
  const hitQuery = await page.evaluate(() => {
    const stage = window.Konva.stages[0];
    const layer = stage.getLayers()[0];
    const queryBefore = { ...window.__konvaProfile.query };
    const start = performance.now();
    let hits = 0;
    for (let i = 0; i < 200; i++) if (stage.getIntersection({ x: (i * 37) % stage.width(), y: (i * 61) % stage.height() })) hits++;
    const queryAfter = { ...window.__konvaProfile.query };
    return { iterations: 200, hitCount: hits, dispatchWallMs: performance.now() - start, wrappedDelta: { calls: queryAfter.calls - queryBefore.calls, elapsedMs: queryAfter.ms - queryBefore.ms }, queryBefore, queryAfter, layerName: layer.name() };
  });
  const { profile: queryProfile } = await cdp.send('Profiler.stop');
  const final = {
    size, mode, theme, repeat, cards: initial.cards, wires: initial.wires,
    construction: initial.profile.construction, constructionCpuTopSelf: summarizeCpu(constructionProfile), stageReadyWallMs,
    drawCallsBeforeGestures: initial.profile.draws, hitQuery: { ...hitQuery, cpuTopSelf: summarizeCpu(queryProfile) }, phases, errors
  };
  await context.close();
  if (errors.length) throw new Error(`Browser errors for ${size}/${mode}/${theme}: ${errors.join('; ')}`);
  for (const phase of phases) if (phase.verified === false) throw new Error(`Unverified ${phase.name} for ${size}/${mode}/${theme}: ${JSON.stringify(phase)}`);
  return final;
}

let server;
let browser;
let chromeVersion = 'unknown';
try {
  server = await createServer({
    configFile: resolve(root, 'vite.konva.config.ts'),
    plugins: [profilePlugin()],
    server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
    preview: { host: '127.0.0.1' }
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  chromeVersion = browser.version();
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const size of sizes) {
      for (const mode of modes) {
        for (const theme of themes) {
          const row = await launchCase(browser, size, mode, theme, repeat, repeat === 0 && mode === 'full' && (size === 9 || size === 450));
          samples.push(row);
          const checkpoint = {
            schemaVersion: 2, createdAt: new Date().toISOString(), sourceBaseline: baselineCommit, sourceBlobs: pinnedInputs,
            method: { sizes, modes, themes, repeats, viewport, dpr: 1, chrome: chromeVersion, host: { hostname: hostname(), platform: platform(), release: release(), cpu: cpus()[0]?.model },
              profiling: 'CDP V8 CPU sampling at 1ms; per-layer JS drawScene/drawHit wrapper timings; pre/post delta around a 200-call Stage.getIntersection probe; source transform wraps updateWireGeometry and construction segments. Interaction timings are Playwright dispatch wall, not settled paint.',
              nativeVsJs: 'Layer and shape draw durations are JS/Konva submission time. V8 samples do not capture all GPU/native raster work; no raster time is inferred from JS method timings.',
              isolation: 'Transient Vite dev server bound to 127.0.0.1, source transform in memory only; no REST; no app/source/benchmark/results changes.',
              variants: 'nodes-only omits makeWire calls and adds zero wire shapes; wires-only omits makeCard calls and adds zero card groups. Never-constructed, not hidden rendering.',
              probes: 'No forced GC or canvas pixel readback in timed windows. Screenshot capture is outside measurements; V8 profiler is enabled during startup, gestures and hit queries.' },
            samples
          };
          writeFileSync(output, `${JSON.stringify(checkpoint, null, 2)}\n`);
          console.log(`profile nodes=${size} mode=${mode} theme=${theme} repeat=${repeat + 1}/${repeats} complete`);
        }
      }
    }
  }
} finally {
  await browser?.close();
  await server?.close();
}

const result = {
  schemaVersion: 2,
  createdAt: new Date().toISOString(),
  sourceBaseline: baselineCommit,
  sourceBlobs: pinnedInputs,
  method: {
    sizes, modes, themes, repeats, viewport, dpr: 1, chrome: chromeVersion,
    host: { hostname: hostname(), platform: platform(), release: release(), cpu: cpus()[0]?.model },
    profiling: 'CDP V8 CPU sampling at 1ms; per-layer JS drawScene/drawHit wrapper timings; pre/post delta around a 200-call Stage.getIntersection probe; source transform wraps updateWireGeometry and construction segments. Interaction timings are Playwright dispatch wall, not settled paint.',
    nativeVsJs: 'Layer drawScene/drawHit durations are JS/Konva submission time. Native raster/compositor cost is separately represented only where present in V8 CPU profiles, which do not capture all GPU/native work; no raster time is inferred from JS method timings.',
    isolation: 'Transient Vite dev server bound to 127.0.0.1, source transform in memory only; no REST; no app/source/benchmark/results changes.',
    variants: 'nodes-only omits makeWire calls and adds zero wire shapes; wires-only omits makeCard calls and adds zero card groups. This is never-constructed, not hidden/visibility-disabled rendering.',
    probes: 'No forced GC or canvas pixel readback in measured windows. Screenshot capture occurs outside timed intervals. Browser CPU profiler is enabled for construction, gestures and hit query; interpret as instrumented profile data.'
  },
  samples
};
mkdirSync(artifacts, { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Wrote new run directory ${runDirectory}`);
