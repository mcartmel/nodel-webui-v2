import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, platform, release, arch, cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sizes = [9, 50, 150, 450];
// Independently derived from the nine-node authored motif's 14 edges and
// createFixture's rule to retain only links whose endpoints both exist.
const expectedEdges = new Map([[9, 14], [50, 77], [150, 232], [450, 700]]);
const repeats = Number(process.env.KONVA_BENCH_REPEATS ?? 3);
const viewport = { width: 1366, height: 768 };
const dpr = 1;
const baseUrl = process.env.KONVA_EXPERIMENT_URL;
const artifactPath = resolve(here, 'results.json');
const reportPath = resolve(here, 'report.md');

if (!baseUrl) throw new Error('Set KONVA_EXPERIMENT_URL to the loopback-only isolated static Konva preview URL.');
if (!Number.isInteger(repeats) || repeats < 3) throw new Error('KONVA_BENCH_REPEATS must be an integer >= 3.');
const origin = new URL(baseUrl).origin;
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error(`Refusing non-loopback host ${origin}; this benchmark must never target a production/live host.`);
}

const roundOrders = Array.from({ length: repeats }, (_, round) =>
  sizes.map((_, index) => sizes[(index + round) % sizes.length]));
const allRows = [];
const failures = [];
const startedAt = new Date().toISOString();

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function summarize(values) {
  values = values.filter((value) => Number.isFinite(value));
  return {
    n: values.length,
    p50: round(percentile(values, 0.5)),
    p95: round(percentile(values, 0.95)),
    max: round(Math.max(...values))
  };
}

function aggregateBySize(results) {
  return sizes.map((size) => {
    const selected = results.filter((row) => row.nodes === size);
    const summary = (pick) => summarize(selected.map(pick));
    const heapDeltaMiB = selected.map((row) => row.heapBytes.afterForcedGcGestures == null || row.heapBytes.afterForcedGcInitial == null
      ? null : (row.heapBytes.afterForcedGcGestures - row.heapBytes.afterForcedGcInitial) / 1024 / 1024);
    return {
      nodes: size,
      edges: selected[0]?.edges ?? null,
      samples: selected.length,
      renderReadyMs: summary((row) => row.renderReadyMs),
      idleTaskMs: summary((row) => row.idle.taskMs),
      idleCorePercentProxy: summary((row) => row.idle.taskCorePercentProxy),
      idleProcessCpuMs: summary((row) => row.idle.processCpuMs),
      idleProcessCorePercent: summary((row) => row.idle.processCorePercent),
      gestureTaskMs: summary((row) => row.gestures.taskMs),
      gestureCorePercentProxy: summary((row) => row.gestures.taskCorePercentProxy),
      gestureProcessCpuMs: summary((row) => row.gestures.processCpuMs),
      gestureProcessCorePercent: summary((row) => row.gestures.processCorePercent),
      gestureFrameP50Ms: summary((row) => row.gestures.frameIntervalsMs.p50),
      gestureFrameP95Ms: summary((row) => row.gestures.frameIntervalsMs.p95),
      gestureFrameMaxMs: summary((row) => row.gestures.frameIntervalsMs.max),
      gestureLongTasks: summary((row) => row.gestures.longTasks),
      gestureLongTaskDurationMs: summary((row) => row.gestures.longTaskDurationMs),
      postGcHeapInitialMiB: summary((row) => row.heapBytes.afterForcedGcInitial == null ? null : row.heapBytes.afterForcedGcInitial / 1024 / 1024),
      postGcHeapAfterGesturesMiB: summary((row) => row.heapBytes.afterForcedGcGestures == null ? null : row.heapBytes.afterForcedGcGestures / 1024 / 1024),
      postGcHeapDeltaMiB: summarize(heapDeltaMiB),
      initialAllFitScale: summary((row) => row.camera.initial.scale),
      canvasBackingRgbaLowerBoundBytes: selected[0]?.canvasBacking.rgbaBytesLowerBound ?? null
    };
  });
}

function round(value, digits = 2) {
  return value == null ? null : Number(value.toFixed(digits));
}

async function cdpTaskDuration(session) {
  const { metrics } = await session.send('Performance.getMetrics');
  return metrics.find(({ name }) => name === 'TaskDuration')?.value;
}

async function waitPainted(page, nodeCount, url) {
  const before = performance.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((expected) => {
    const stage = window.Konva?.stages?.[0];
    return stage && stage.find('.topology-card').length === expected && stage.find('.topology-wire').length > 0
      && document.querySelectorAll('.canvas-stage canvas').length === 2;
  }, nodeCount, { timeout: 120_000 });
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  return performance.now() - before;
}

async function heapBytes(page) {
  return page.evaluate(() => typeof performance.memory?.usedJSHeapSize === 'number'
    ? performance.memory.usedJSHeapSize : null);
}

async function processCpuSnapshot(browserCdp) {
  const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
  const processes = processInfo.map(({ type, id, cpuTime }) => ({ type, id, cpuTimeSeconds: cpuTime }));
  return {
    cpuTimeSeconds: processes.reduce((total, process) => total + (Number.isFinite(process.cpuTimeSeconds) ? process.cpuTimeSeconds : 0), 0),
    processCount: processes.length,
    processes
  };
}

async function beginGestureSampler(page, nodeId) {
  return page.evaluate((id) => {
    const stage = window.Konva?.stages?.[0];
    if (!stage) throw new Error('Missing native stage before gesture sample.');
    const record = { active: true, start: performance.now(), end: null, intervals: [], last: null, longTasks: [], dragEnd: null, panEnds: [], wheelScales: [], rafId: 0 };
    let observer;
    if (typeof PerformanceObserver === 'function') {
      observer = new PerformanceObserver((list) => {
        for (const item of list.getEntries()) record.longTasks.push({ start: item.startTime, duration: item.duration });
      });
      try { observer.observe({ type: 'longtask' }); } catch { observer = undefined; }
    }
    const onDragEnd = (event) => {
      if (event.target === stage) record.panEnds.push({ x: stage.x(), y: stage.y() });
      else if (event.target.id() === id) record.dragEnd = { x: event.target.x(), y: event.target.y() };
    };
    const onWheel = () => record.wheelScales.push(stage.scaleX());
    stage.on('dragend.kiloBench', onDragEnd);
    stage.on('wheel.kiloBench', onWheel);
    const tick = (timestamp) => {
      if (!record.active) return;
      if (timestamp >= record.start) {
        if (record.last != null) record.intervals.push(timestamp - record.last);
        record.last = timestamp;
      }
      record.rafId = requestAnimationFrame(tick);
    };
    record.rafId = requestAnimationFrame(tick);
    window.__konvaGestureRecord = record;
    return record.start;
  }, nodeId);
}

async function endGestureSampler(page) {
  return page.evaluate(() => {
    const record = window.__konvaGestureRecord;
    if (!record) throw new Error('Gesture frame sampler was not started.');
    record.end = performance.now();
    record.active = false;
    cancelAnimationFrame(record.rafId);
    const stage = window.Konva?.stages?.[0];
    stage?.off('.kiloBench');
    const longTasks = record.longTasks.filter((task) => task.start >= record.start && task.start + task.duration <= record.end);
    return {
      start: record.start,
      end: record.end,
      intervalsMs: record.intervals,
      longTasks,
      dragEnd: record.dragEnd,
      panEnds: record.panEnds,
      wheelScales: record.wheelScales
    };
  });
}

async function gestureGeometry(page, stageBox) {
  return page.evaluate(({ box }) => {
    const stage = window.Konva?.stages?.[0];
    if (!stage) throw new Error('Missing native stage.');
    const cards = stage.find('.topology-card');
    const wires = stage.find('.topology-wire');
    const canvases = [...document.querySelectorAll('.canvas-stage canvas')];
    const card = cards[0];
    const rect = card.getClientRect({ relativeTo: stage });
    const host = stage.container().getBoundingClientRect();
    let panStart;
    for (const [rx, ry] of [[0.96, 0.96], [0.05, 0.96], [0.96, 0.05], [0.05, 0.05], [0.5, 0.95]]) {
      const candidate = { x: box.width * rx, y: box.height * ry };
      if (!stage.getIntersection(candidate)) {
        panStart = { x: box.x + candidate.x, y: box.y + candidate.y };
        break;
      }
    }
    if (!panStart) throw new Error('No empty canvas point for a real pan gesture.');
    return {
      nodeCount: cards.length,
      edgeCount: wires.length,
      nodeIds: cards.map((shape) => shape.id()).sort(),
      edgeIds: wires.map((shape) => shape.id()).sort(),
      camera: { x: stage.x(), y: stage.y(), scale: stage.scaleX() },
      card: {
        id: card.id(),
        x: card.x(),
        y: card.y(),
        screen: {
          x: host.left + stage.x() + (rect.x + rect.width / 2) * stage.scaleX(),
          y: host.top + stage.y() + (rect.y + rect.height / 2) * stage.scaleY()
        }
      },
      panStart,
      wheelPoint: { x: box.x + box.width * 0.62, y: box.y + box.height * 0.46 },
      canvases: canvases.map((canvas) => ({ width: canvas.width, height: canvas.height })),
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }
    };
  }, { box: stageBox });
}

async function gestureSample(browser, browserCdp, nodeCount, repetition, sizePosition) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  const blockedRest = [];
  const external = [];
  const localRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (/\/REST(?:\/|$)/i.test(url.pathname)) {
      blockedRest.push(url.href);
      await route.abort('blockedbyclient');
    } else if (url.origin !== origin) {
      external.push(url.href);
      await route.abort('blockedbyclient');
    } else {
      localRequests.push(url.href);
      await route.continue();
    }
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');
  const url = new URL(`/topology-canvas.html?nodes=${nodeCount}&bench=${repetition}-cold`, origin).href;
  const renderReadyMs = await waitPainted(page, nodeCount, url);
  const box = await page.locator('.canvas-stage').boundingBox();
  if (!box) throw new Error('Canvas stage has no visible bounds.');
  const ready = await gestureGeometry(page, box);
  if (ready.nodeCount !== nodeCount || ready.nodeIds.length !== nodeCount || new Set(ready.nodeIds).size !== nodeCount) {
    throw new Error(`Native Konva cards expected ${nodeCount} unique IDs, got ${ready.nodeCount}.`);
  }
  if (ready.edgeCount !== expectedEdges.get(nodeCount) || ready.edgeIds.length !== ready.edgeCount || new Set(ready.edgeIds).size !== ready.edgeCount) {
    throw new Error(`Native Konva wires expected ${expectedEdges.get(nodeCount)} unique IDs, got ${ready.edgeCount}.`);
  }
  if (ready.viewport.width !== viewport.width || ready.viewport.height !== viewport.height || ready.viewport.dpr !== dpr) {
    throw new Error(`Viewport/DPR mismatch: ${JSON.stringify(ready.viewport)}.`);
  }

  await cdp.send('HeapProfiler.collectGarbage');
  const heapInitial = await heapBytes(page);
  await page.waitForTimeout(600); // Let GC and first paint settle before passive idle.

  // Passive interval: no page.evaluate, rAF sampler, scene snapshot, or UI interaction.
  const idleWallStart = performance.now();
  const idleTaskBefore = await cdpTaskDuration(cdp);
  const idleProcessBefore = await processCpuSnapshot(browserCdp);
  await page.waitForTimeout(2_200);
  const idleProcessAfter = await processCpuSnapshot(browserCdp);
  const idleTaskAfter = await cdpTaskDuration(cdp);
  const idleWallMs = performance.now() - idleWallStart;
  const idleTaskSeconds = idleTaskAfter - idleTaskBefore;
  const idleProcessSeconds = idleProcessAfter.cpuTimeSeconds - idleProcessBefore.cpuTimeSeconds;

  const gestureProcessWallStart = performance.now();
  const gestureProcessBefore = await processCpuSnapshot(browserCdp);
  const gestureTaskBefore = await cdpTaskDuration(cdp);
  await beginGestureSampler(page, ready.card.id);
  await page.mouse.move(ready.card.screen.x, ready.card.screen.y);
  await page.mouse.down();
  await page.mouse.move(ready.card.screen.x + 32, ready.card.screen.y + 24);
  await page.mouse.up();
  await page.mouse.move(ready.panStart.x, ready.panStart.y);
  await page.mouse.down();
  await page.mouse.move(ready.panStart.x - 28, ready.panStart.y - 19);
  await page.mouse.up();
  await page.mouse.move(ready.panStart.x, ready.panStart.y);
  await page.mouse.down();
  await page.mouse.move(ready.panStart.x + 28, ready.panStart.y + 19);
  await page.mouse.up();
  await page.mouse.move(ready.wheelPoint.x, ready.wheelPoint.y);
  await page.mouse.wheel(0, -180);
  await page.mouse.wheel(0, -180);
  const gestureEnd = await endGestureSampler(page);
  const gestureTaskAfter = await cdpTaskDuration(cdp);
  const gestureProcessAfter = await processCpuSnapshot(browserCdp);
  const gestureProcessWallMs = performance.now() - gestureProcessWallStart;
  const gestureTaskSeconds = gestureTaskAfter - gestureTaskBefore;
  const gestureProcessSeconds = gestureProcessAfter.cpuTimeSeconds - gestureProcessBefore.cpuTimeSeconds;

  // Read back actual geometry only after the timed interval has closed.
  const after = await page.evaluate((nodeId) => {
    const stage = window.Konva.stages[0];
    const card = stage.findOne(`#${nodeId}`);
    const canvases = [...document.querySelectorAll('.canvas-stage canvas')];
    return {
      node: { x: card.x(), y: card.y() },
      camera: { x: stage.x(), y: stage.y(), scale: stage.scaleX() },
      canvases: canvases.map((canvas) => ({ width: canvas.width, height: canvas.height }))
    };
  }, ready.card.id);
  await cdp.send('HeapProfiler.collectGarbage');
  const heapAfterGestures = await heapBytes(page);

  const dragAchievedWorld = gestureEnd.dragEnd
    ? { x: gestureEnd.dragEnd.x - ready.card.x, y: gestureEnd.dragEnd.y - ready.card.y } : null;
  let priorCamera = { x: ready.camera.x, y: ready.camera.y };
  const panAchievedPx = gestureEnd.panEnds.map((camera) => {
    const delta = { x: camera.x - priorCamera.x, y: camera.y - priorCamera.y };
    priorCamera = camera;
    return delta;
  });
  const wheelZoomRatios = [];
  let priorScale = ready.camera.scale;
  for (const scale of gestureEnd.wheelScales) {
    wheelZoomRatios.push(scale / priorScale);
    priorScale = scale;
  }
  const gestureWallMs = gestureEnd.end - gestureEnd.start;
  const backingPixels = after.canvases.reduce((total, canvas) => total + canvas.width * canvas.height, 0);
  const result = {
    nodes: nodeCount,
    edges: ready.edgeCount,
    repetition,
    orderPosition: sizePosition,
    cacheState: 'cold-fresh-context',
    renderReadyMs: round(renderReadyMs),
    idle: {
      wallMs: round(idleWallMs),
      taskMs: round(idleTaskSeconds * 1000),
      taskCorePercentProxy: round(idleTaskSeconds / (idleWallMs / 1000) * 100),
      processCpuMs: round(idleProcessSeconds * 1000),
      processCorePercent: round(idleProcessSeconds / (idleWallMs / 1000) * 100),
      processCountBefore: idleProcessBefore.processCount,
      processCountAfter: idleProcessAfter.processCount
    },
    gestures: {
      wallMs: round(gestureWallMs),
      taskMs: round(gestureTaskSeconds * 1000),
      taskCorePercentProxy: round(gestureTaskSeconds / (gestureWallMs / 1000) * 100),
      processCpuMs: round(gestureProcessSeconds * 1000),
      processWallMs: round(gestureProcessWallMs),
      processCorePercent: round(gestureProcessSeconds / (gestureProcessWallMs / 1000) * 100),
      dragRequestedPx: { x: 32, y: 24 },
      dragAchievedWorld,
      panRequestedPxPerGesture: [{ x: -28, y: -19 }, { x: 28, y: 19 }],
      panAchievedPx,
      wheelDeltaYPerGesture: -180,
      wheelZoomRatios,
      zoomRatio: round(after.camera.scale / ready.camera.scale, 5),
      frameIntervalsMs: summarize(gestureEnd.intervalsMs),
      longTasks: gestureEnd.longTasks.length,
      longTaskDurationMs: round(gestureEnd.longTasks.reduce((sum, task) => sum + task.duration, 0))
    },
    heapBytes: { afterForcedGcInitial: heapInitial, afterForcedGcGestures: heapAfterGestures },
    camera: { initial: ready.camera, afterGestures: after.camera },
    canvasBacking: {
      layers: after.canvases,
      backingPixels,
      rgbaBytesLowerBound: backingPixels * 4,
      limitation: 'Visible RGBA canvas backing lower bound only; excludes Konva hit canvases, GPU duplicates and compositor storage.'
    },
    errors,
    blockedRest,
    external,
    localRequestCount: localRequests.length
  };

  if (errors.length || blockedRest.length || external.length) {
    throw new Error(`Isolation/runtime validation failed: ${JSON.stringify({ errors, blockedRest, external })}`);
  }
  if (!dragAchievedWorld || Math.abs(dragAchievedWorld.x) < 1 || Math.abs(dragAchievedWorld.y) < 1) {
    throw new Error(`Native card drag did not move: ${JSON.stringify(dragAchievedWorld)}.`);
  }
  if (panAchievedPx.length !== 2 || panAchievedPx.some(({ x, y }) => Math.abs(x) < 10 || Math.abs(y) < 10)) {
    throw new Error(`Native stage pan did not move: ${JSON.stringify(panAchievedPx)}.`);
  }
  if (wheelZoomRatios.length !== 2 || wheelZoomRatios.some((ratio) => ratio <= 1)) {
    throw new Error(`Wheel zoom not applied: ${JSON.stringify(wheelZoomRatios)}.`);
  }
  await context.close();
  return result;
}

function writeReport(results, env) {
  const aggregate = aggregateBySize(results);
  const rows = aggregate.map((row) => `| ${row.nodes} | ${row.edges ?? '—'} | ${row.initialAllFitScale.p50} | ${row.renderReadyMs.p50}/${row.renderReadyMs.p95} | ${row.idleTaskMs.p50} / ${row.idleCorePercentProxy.p50}; ${row.idleProcessCpuMs.p50} / ${row.idleProcessCorePercent.p50} | ${row.gestureTaskMs.p50} / ${row.gestureCorePercentProxy.p50}; ${row.gestureProcessCpuMs.p50} / ${row.gestureProcessCorePercent.p50} | ${row.gestureFrameP50Ms.p50} / ${row.gestureFrameP95Ms.p50} / ${row.gestureFrameMaxMs.p50} | ${row.gestureLongTasks.p50} | ${row.postGcHeapInitialMiB.p50?.toFixed(2) ?? 'n/a'} → ${row.postGcHeapAfterGesturesMiB.p50?.toFixed(2) ?? 'n/a'} | ${(row.canvasBackingRgbaLowerBoundBytes / 1024 / 1024).toFixed(2)} |`);
  const tick = String.fromCharCode(96);
  const text = `# Opt-in Konva browser benchmark\n\n`
    + `Run started ${startedAt} and completed ${env.completedAt ?? 'see results.json'}. This is an isolated static Konva canvas experiment, not the production app or a live Nodel host.\n\n`
    + `## Environment and method\n\n`
    + `- Host: ${env.hostname}; ${env.platform} ${env.release} (${env.arch}); CPU: ${env.cpu}; Node ${process.version}; Playwright ${env.playwrightVersion}; Chrome for Testing ${env.chromiumVersion}\n`
    + `- Fixed viewport: ${viewport.width}x${viewport.height}, DPR ${dpr}, Chromium headless; ${repeats} fresh-context repeats per size in counterbalanced cyclic order: ${roundOrders.map((order) => order.join('/')).join(', ')}. One browser/context at a time; no profiler; route interception disables HTTP cache, so each sample is a single cold navigation. No warm-HTTP claim.\n`
    + `- Render readiness is native scene count + both canvases + two requestAnimationFrame callbacks after DOMContentLoaded. Passive idle is 2.2 s after GC/settle; no page-side evaluation, scene snapshot or rAF sampler runs inside it. Task CPU uses CDP Performance TaskDuration; process CPU independently sums cpuTime across Chrome processes returned by SystemInfo.getProcessInfo at interval endpoints. Each is also divided by wall time for a one-core proxy.\n`
    + `- The rAF interval sampler and Long Task observer run only during actual pointer gestures; stored timestamps are clipped to that start/stop window. No full-scene enumeration occurs during the gesture. Small start/stop hooks record achieved drag, pan and zoom. Heap columns are absolute ` + '`performance.memory.usedJSHeapSize`' + ` after explicit CDP GC before idle and after gestures.\n`
    + `- Canvas backing RGBA bytes are a lower bound only; they do not include GPU duplication, hit canvases, compositing, allocator fragmentation or browser overhead. “All fit” shows the entire synthetic scene in the initial viewport; table scale and raw camera values show that node labels become progressively less legible at large counts.\n`
    + `- Gesture windows include input handlers/redraw and small sampler hooks; process CPU is independent of renderer TaskDuration but is not attributable to one subsystem. Frame intervals reflect scheduling gaps, not input latency. Visible canvas backing RGBA bytes are a lower bound; hit canvases/GPU/compositor storage are not counted.\n\n`
    + `## Aggregate (median across three fresh-context runs)\n\n`
    + `Render is p50/p95 ms; CPU cells are task-ms / %one-core proxy; process CPU is summed Chrome-tree CPU-ms / %one-core; frame is p50/p95/max ms; heap reports absolute initial → after-gesture MiB.\n\n`
    + `| Nodes | Native edges | All-fit zoom | Render-ready p50/p95 ms | Idle task CPU-ms / %core; process CPU-ms / %core | Gesture task CPU-ms / %core; process CPU-ms / %core | Gesture rAF p50/p95/max ms | Long tasks | Post-GC JS heap initial → after MiB | Canvas lower-bound MiB |\n|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n\n`
    + `## Reproduction\n\n`
    + `1. From repository root, build only the isolated static page: ${tick}npm run build:experiment:konva${tick}\n`
    + `2. Serve only that output on loopback (use any free port): ${tick}npm run preview:experiment:konva -- --host 127.0.0.1 --port 4179 --strictPort${tick}\n`
    + `3. In a second terminal: ${tick}KONVA_EXPERIMENT_URL=http://127.0.0.1:4179 node experiments/konva-browser/benchmark.mjs${tick}\n\n`
    + `REST and external requests are blocked; only isolated same-origin static assets are allowed. The runner makes no production edits. Any failed sample is retained in JSON.\n`;
  writeFileSync(reportPath, text);
}

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const chromiumVersion = browser.version();
  const browserCdp = await browser.newBrowserCDPSession();
  try {
    for (let repetition = 0; repetition < repeats; repetition += 1) {
      for (const [position, size] of roundOrders[repetition % roundOrders.length].entries()) {
        try {
          const row = await gestureSample(browser, browserCdp, size, repetition, position);
          allRows.push(row);
          console.log(`bench nodes=${size} edges=${row.edges} repeat=${repetition + 1}/${repeats} done`);
        } catch (error) {
          failures.push({ nodes: size, repetition, position, error: String(error?.stack ?? error) });
          console.error(`bench FAILED nodes=${size} repeat=${repetition + 1}: ${error?.message ?? error}`);
          throw error;
        }
      }
    }
  } finally {
    await browserCdp.detach();
    await browser.close();
  }

  const completedAt = new Date().toISOString();
  const lock = JSON.parse(readFileSync(resolve(here, '../../package-lock.json'), 'utf8'));
  const env = {
    hostname: hostname(), platform: platform(), release: release(), arch: arch(),
    cpu: cpus()[0]?.model ?? 'unknown', chromium: chromium.executablePath(), chromiumVersion,
    playwrightVersion: lock.packages?.['node_modules/@playwright/test']?.version ?? 'unknown', completedAt
  };
  const results = {
    schemaVersion: 1,
    startedAt,
    completedAt,
    method: { sizes, repeats, roundOrders, viewport, dpr, baseUrl, cache: 'one cold navigation per fresh context; Playwright route interception disables HTTP cache; no warm-HTTP samples' },
    environment: env,
    aggregate: aggregateBySize(allRows),
    limitations: [
      'No production/live host is contacted; REST and external network requests are blocked.',
      'CDP TaskDuration is a browser main-thread task-time proxy, not whole-process CPU or power measurement; gesture windows include bounded page-side probes/redraws, while Playwright driver waiting is wall time.',
      'SystemInfo cpuTime summed over the Chromium process tree is independent of renderer-main-thread TaskDuration.',
      'Frame sampling runs only during pointer gestures and reflects browser scheduling/compositor effects, not direct input latency.',
      'JS heap is reported as absolute post-GC bytes before idle and after gestures; canvas RGBA is a lower bound excluding hit canvases, GPU copies and compositor storage.',
      'Every cold navigation uses a fresh context; static server startup is excluded.'
    ],
    samples: allRows,
    failures
  };
  mkdirSync(here, { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(results, null, 2)}\n`);
  writeReport(allRows, env);
}

main().catch((error) => {
  const failed = { schemaVersion: 1, startedAt, failedAt: new Date().toISOString(), method: { sizes, repeats, roundOrders, viewport, dpr, baseUrl }, failures: [...failures, { error: String(error?.stack ?? error) }], partialSamples: allRows };
  writeFileSync(artifactPath, `${JSON.stringify(failed, null, 2)}\n`);
  process.exitCode = 1;
});
