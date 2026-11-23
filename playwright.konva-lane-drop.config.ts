import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const externalURL = process.env.KONVA_EXPERIMENT_URL;
const baselineDist = '/tmp/kilo/konva-baseline-20261123';
const dist = resolve(process.env.KONVA_LANE_DIST ?? baselineDist);
const baseURL = externalURL ?? `http://127.0.0.1:${process.env.KONVA_LANE_PORT ?? '4293'}`;
const profile = process.env.KONVA_LANE_PROFILE ?? 'full';
if (!['full', 'low-repeat', 'long-tasks'].includes(profile)) throw new Error('Unknown KONVA_LANE_PROFILE.');
const preview = new URL(baseURL);
if (preview.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(preview.hostname)) {
  throw new Error('Lane-drop tests are restricted to an HTTP loopback preview.');
}
if (externalURL && process.env.KONVA_LANE_DIST) throw new Error('Choose KONVA_EXPERIMENT_URL or KONVA_LANE_DIST, not both.');
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export default defineConfig({
  testDir: './experiments/konva-browser',
  testMatch: 'lane-drop.pw.ts',
  metadata: { dist: externalURL ? null : dist, baseline: !externalURL && dist === baselineDist, instrumented: process.env.KONVA_LANE_INSTRUMENTED === '1', profile },
  outputDir: '/tmp/kilo/konva-lane-drop-playwright-results',
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [['list']],
  webServer: externalURL ? undefined : {
    command: `python3 -m http.server ${preview.port} --bind 127.0.0.1 --directory ${quote(dist)}`,
    url: `${preview.origin}/topology-canvas.html`,
    reuseExistingServer: false,
    stderr: 'ignore',
  },
  use: {
    baseURL,
    browserName: 'chromium',
    channel: 'chromium',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    // Tracing instruments the gesture and skews its frame timings.
    trace: process.env.KONVA_LANE_TRACE === '1' ? 'retain-on-failure' : 'off',
  },
});
