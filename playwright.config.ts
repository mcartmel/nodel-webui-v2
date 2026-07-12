import { defineConfig } from '@playwright/test';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  forbidOnly: isCI,
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 2 : 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      // Native system font rasterization differs slightly between Linux images.
      maxDiffPixels: 100,
      scale: 'css'
    }
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    colorScheme: 'light',
    contextOptions: {
      reducedMotion: 'reduce'
    },
    deviceScaleFactor: 1,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run preview -- --port 4173',
    url: 'http://127.0.0.1:4173/components.html',
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [
    {
      name: 'chromium-light-desktop',
      use: { colorScheme: 'light', viewport: { width: 1440, height: 1000 } }
    },
    {
      name: 'chromium-dark-desktop',
      use: { colorScheme: 'dark', viewport: { width: 1440, height: 1000 } }
    },
    {
      name: 'chromium-light-mobile',
      use: { colorScheme: 'light', hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } }
    },
    {
      name: 'chromium-dark-mobile',
      use: { colorScheme: 'dark', hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } }
    },
    {
      name: 'chromium-forced-colors',
      use: {
        colorScheme: 'light',
        contextOptions: { forcedColors: 'active' },
        viewport: { width: 1440, height: 1000 }
      }
    }
  ]
});
