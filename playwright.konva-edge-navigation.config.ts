import { defineConfig } from '@playwright/test';

const baseURL = process.env.KONVA_EXPERIMENT_URL;

if (!baseURL) {
  throw new Error('Set KONVA_EXPERIMENT_URL to a static loopback Konva preview URL for this opt-in suite.');
}
const previewURL = new URL(baseURL);
if (previewURL.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(previewURL.hostname)) {
  throw new Error('Edge-navigation browser acceptance is restricted to an HTTP loopback preview.');
}

export default defineConfig({
  testDir: './experiments/konva-browser',
  testMatch: 'edge-navigation.pw.ts',
  outputDir: 'test-results/konva-edge-navigation',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 12_000 },
  reporter: [['list']],
  use: {
    baseURL,
    browserName: 'chromium',
    channel: 'chromium',
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
});
