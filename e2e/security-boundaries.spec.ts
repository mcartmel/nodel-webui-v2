import { expect, test } from '@playwright/test';

test.describe('security boundaries', () => {
  test('rejects malicious discovery and build URLs without creating executable links', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-light-desktop', 'Focused boundary coverage runs once in Chromium.');

    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/build.json') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ version: 'unsafe', origin: 'javascript:alert(document.domain)', branch: 'main' })
        });
        return;
      }
      if (url.pathname === '/REST/nodeURLs') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify([{ node: 'Unsafe', address: 'javascript:alert(document.domain)' }])
        });
        return;
      }
      if (url.pathname === '/REST/diagnostics') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ hostname: 'SECURE-HOST' }) });
        return;
      }
      if (url.pathname === '/REST') {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ nodes: {} }) });
        return;
      }
      if (url.pathname.includes('/REST/')) {
        await route.fulfill({ contentType: 'application/json', body: '[]' });
        return;
      }
      await route.continue();
    });

    await page.goto('/nodes.html#Network', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nodel-page[data-page-id="Network"][active]')).toBeVisible();
    await expect(page.locator('nodel-page[data-page-id="Network"] .nodel-alert-danger')).toContainText('POST /REST/nodeURLs returned invalid data');
    await expect(page.locator('nodel-page[data-page-id="Network"] a')).toHaveCount(0);

    await page.goto('/nodes.html#Diagnostics', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nodel-page[data-page-id="Diagnostics"][active]')).toBeVisible();
    await expect(page.locator('nodel-diagnostics')).toContainText('SECURE-HOST');
    await expect(page.locator('nodel-diagnostics')).toContainText('Unavailable');

    const hrefs = await page.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    expect(hrefs.some((href) => href.trim().toLowerCase().startsWith('javascript:'))).toBe(false);
  });
});
