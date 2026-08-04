import { expect, test } from '@playwright/test';

const pages = ['index.htm', 'nodes.html', 'nodel.html', 'toolkit.html', 'components.html'];
const deployedAssets = JSON.parse(process.env.DEPLOYMENT_SMOKE_ASSETS ?? '[]') as string[];

test('serves the complete stable layout without development paths or broken V2 assets', async ({ page, request }) => {
  const failedAssets: string[] = [];
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.includes('/v2/') && response.status() >= 400) failedAssets.push(`${response.status()} ${pathname}`);
  });

  for (const entry of pages) {
    const response = await request.get(`/${entry}`);
    expect(response.status(), entry).toBe(200);
    const html = await response.text();
    if (entry !== 'index.htm') {
      expect(html, entry).toContain('./v2/nodel-webui.js');
      expect(html, entry).toContain('./v2/nodel-webui.css');
    }
    expect(html, entry).not.toMatch(/(?:\/src\/|localhost|vite\b)/i);
    await page.goto(`/${entry}`, { waitUntil: 'domcontentloaded' });
  }

  for (const asset of ['/v2/nodel-webui.js', '/v2/nodel-webui.css']) {
    expect((await request.get(asset)).status(), asset).toBe(200);
  }
  expect(deployedAssets).toContain('v2/nodel-webui.js');
  expect(deployedAssets).toContain('v2/nodel-webui.css');
  for (const asset of deployedAssets) {
    expect((await request.get(`/${asset}`)).status(), asset).toBe(200);
  }
  await page.waitForTimeout(250);
  expect(failedAssets).toEqual([]);
});

test('loads the catalogue memory runtime and keeps core offline shells recoverable', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/components.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('script[data-nodel-runtime="memory"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => Boolean(customElements.get('nodel-app')))).toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(customElements.get('nodel-button')))).toBe(true);

  for (const entry of ['nodes.html', 'nodel.html', 'toolkit.html']) {
    await page.goto(`/${entry}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nodel-app[offline-mode="overlay"]')).toHaveCount(1);
    await expect(page.locator('nodel-app')).toBeVisible();
  }
  expect(pageErrors).toEqual([]);
});
