import { defineConfig } from '@playwright/test';

const baseURL = process.env.KONVA_EXPERIMENT_URL;

if (!baseURL) {
  throw new Error(
    'Set KONVA_EXPERIMENT_URL to the local Konva experiment preview URL; this opt-in suite never starts the regular app.'
  );
}

export default defineConfig({
  testDir: '.',
  testMatch: 'canvas.pw.ts',
  outputDir: '../../artifacts/konva-browser-test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    // Headless shell disables BFCache at the browser delegate level.
    channel: 'chromium',
    launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] },
    colorScheme: 'light',
    deviceScaleFactor: 1,
    viewport: { width: 1366, height: 768 },
    screenshot: 'off',
    trace: 'off',
    video: 'off'
  },
  projects: [
    {
      name: '1366x768',
      use: { viewport: { width: 1366, height: 768 } }
    },
    {
      name: '1920x1080',
      use: { viewport: { width: 1920, height: 1080 } }
    }
  ]
});
