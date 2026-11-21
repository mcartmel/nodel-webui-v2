import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const outputFlag = args.indexOf('--out');
const outputPath = outputFlag >= 0 ? args[outputFlag + 1] : undefined;
if (outputFlag >= 0) args.splice(outputFlag, 2);
const [baselinePath, candidatePath] = args;
if (!baselinePath || !candidatePath) throw new Error('Usage: node scripts/compare-topology-performance.mjs <baseline.json> <candidate.json> [--out comparison.json]');
const [baseline, candidate] = await Promise.all([baselinePath, candidatePath].map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
if (baseline.fixture?.name !== candidate.fixture?.name) throw new Error('Cannot compare different fixture scenarios.');
const get = (report, mode) => report.runs.find((run) => run.mode === mode);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const metricsFor = (run) => ({
  initialDiscoveryToSettledMs: run.initialDiscoveryToSettledMs,
  inventoryCompletionMs: run.inventoryCompletionMs,
  stableRefreshWallMedianMs: median(run.stableRefreshes.map((sample) => sample.wallMs)),
  stableRefreshTaskSecondsMedian: median(run.stableRefreshes.map((sample) => sample.rendererTaskDurationSeconds)),
  idleTaskSecondsPerFiveSeconds: run.idle.rendererTaskDurationSeconds,
  postGcHeapUsedBytes: run.stableMemoryAfter.jsHeapUsedBytesAfterGC,
  mountedNodes: run.finalBaseline.mounted.nodes,
  mountedWires: run.finalBaseline.mounted.wires,
  interactionMaxLongTaskMs: run.interaction.maxLongTaskMs,
  interactionFramesOver25ms: run.interaction.framesOver25ms
});
const results = ['detailed', 'all-nodes'].map((mode) => {
  const before = get(baseline, mode);
  const after = get(candidate, mode);
  if (!before || !after) throw new Error(`Both reports must contain ${mode} results.`);
  const a = metricsFor(before);
  const b = metricsFor(after);
  return { mode, baseline: a, candidate: b, delta: Object.fromEntries(Object.keys(a).map((key) => {
    const delta = a[key] === null || b[key] === null ? null : Number((b[key] - a[key]).toFixed(3));
    const percent = a[key] === null || b[key] === null || a[key] === 0 ? null : Number((((b[key] - a[key]) / a[key]) * 100).toFixed(2));
    return [key, { absolute: delta, percent }];
  })) };
});
const report = { baseline: { generatedAt: baseline.generatedAt, browser: baseline.browser, dist: baseline.dist.path }, candidate: { generatedAt: candidate.generatedAt, browser: candidate.browser, dist: candidate.dist.path }, fixture: baseline.fixture, results };
const json = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  const output = resolve(outputPath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, json);
  console.log(JSON.stringify({ comparison: output }));
} else console.log(json);
