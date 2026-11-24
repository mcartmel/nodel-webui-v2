import { defineConfig } from '@playwright/test';

/** Separate opt-in lifecycle/performance acceptance for the Konva session layout. */
export default defineConfig({
  testDir: './experiments/konva-browser',
  testMatch: 'session-layout.pw.ts',
  outputDir: 'test-results/konva-session',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    channel: 'chromium',
    launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] },
    colorScheme: 'light',
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
});
