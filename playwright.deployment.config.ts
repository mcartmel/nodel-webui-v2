import { defineConfig } from '@playwright/test';

const previewUrl = process.env.DEPLOYMENT_SMOKE_PREVIEW_URL;
const managedUrl = process.env.DEPLOYMENT_SMOKE_MANAGED_URL;

if (!previewUrl || !managedUrl) {
  throw new Error('Deployment smoke URLs must be provided by scripts/run-deployment-smoke.mjs');
}

export default defineConfig({
  testDir: './e2e/deployment',
  outputDir: 'test-results/deployment-smoke',
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/deployment-smoke' }]],
  use: {
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'deploy-preview', use: { baseURL: previewUrl } },
    { name: 'managed-layout', use: { baseURL: managedUrl } }
  ]
});
