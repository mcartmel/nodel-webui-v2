import { expect, test, type Page } from '@playwright/test';

async function openCatalogue(page: Page, pageId: string) {
  await page.goto(`/components.html#${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`nodel-page[data-page-id="${pageId}"][active]`).waitFor();
}

test.describe('remote-aware links and filtered navigation', () => {
  test('keeps static catalogue links native, nested, and keyboard accessible', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await openCatalogue(page, 'ControlGrid');
    const link = page.locator('[data-catalogue-example="links-native-choices"] nodel-link');
    const anchor = link.locator('[data-nodel-link-anchor]');

    await expect(anchor).toHaveAttribute('href', '#Text');
    await expect(anchor.locator('nodel-icon')).toHaveCount(1);
    await anchor.focus();
    await expect(anchor).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/#Text$/);
    await expect(page.locator('nodel-page[data-page-id="Text"]')).toHaveAttribute('active', '');
    expect(requests.some((url) => /REST\/(nodeURLsForNode|remote)/.test(url))).toBe(false);
  });

  test('resolves explicit node and event-binding destinations', async ({ page }) => {
    await page.route('**/REST/remote', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ events: { DisplayStatus: { node: 'Bound Display', event: 'Status' } } })
    }));
    await page.route('**/REST/nodeURLsForNode', async (route) => {
      const request = route.request();
      const payload = request.postDataJSON() as { name: string };
      const origin = new URL(request.url()).origin;
      const entries = payload.name === 'Direct Display'
        ? [
            { node: 'Direct Display', address: 'https://remote.example/nodes/DirectDisplay/' },
            { node: 'Direct Display', address: `${origin}/nodes/DirectDisplay/` }
          ]
        : [{ node: 'Bound Display', address: 'https://bound.example/nodes/BoundDisplay/' }];
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(entries) });
    });
    await openCatalogue(page, 'ControlGrid');
    await page.evaluate(() => {
      const fixture = document.createElement('section');
      fixture.id = 'resolved-link-fixture';
      fixture.innerHTML = `
        <nodel-link id="direct-link" node="Direct Display"><nodel-icon name="info"></nodel-icon> Direct</nodel-link>
        <nodel-link id="binding-link" event-binding="DisplayStatus">Bound</nodel-link>
      `;
      document.querySelector('nodel-page[active]')?.append(fixture);
    });

    await expect(page.locator('#direct-link')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('#binding-link')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('#direct-link a')).toHaveAttribute('href', /\/nodes\/DirectDisplay\/$/);
    await expect(page.locator('#direct-link nodel-icon')).toHaveCount(1);
    await expect(page.locator('#binding-link a')).toHaveAttribute('href', 'https://bound.example/nodes/BoundDisplay/');
  });

  test('prefills the dedicated Network page from a Unicode query value', async ({ page }) => {
    const filters: string[] = [];
    await page.route('**/REST/nodeURLs', async (route) => {
      const payload = route.request().postDataJSON() as { filter: string };
      filters.push(payload.filter);
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([{ address: 'http://display:8085/nodes/DisplayUnit/', name: 'Display Ünit', host: 'display:8085' }])
      });
    });
    await page.route('http://display:8085/REST', (route) => route.fulfill({ status: 200, body: '{}' }));

    await page.goto('/nodes.html?filter=Display%20%C3%9Cnit&filter=Ignored#Network', { waitUntil: 'domcontentloaded' });
    const networkPage = page.locator('nodel-page[data-page-id="Network"]');
    await expect(networkPage).toHaveAttribute('active', '');
    await expect(networkPage.locator('.nodel-node-list-filter')).toHaveValue('Display Ünit');
    await expect(networkPage.locator('.nodel-node-list-item')).toContainText('Display Ünit');
    expect(filters.length).toBeGreaterThan(0);
    expect(filters.every((value) => value === 'Display Ünit')).toBe(true);
  });

  test('shows accessible loading and fallback-error states', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.endsWith('-desktop'), 'Link state baselines run once per desktop colour theme.');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/REST/nodeURLsForNode', async (route) => {
      await gate;
      await route.fulfill({ contentType: 'application/json', body: '[]' });
    });
    await openCatalogue(page, 'ControlGrid');
    await page.evaluate(() => {
      const fixture = document.createElement('section');
      fixture.id = 'link-state-fixture';
      fixture.className = 'nodel-card inline-flex p-4';
      fixture.innerHTML = '<nodel-link node="Unavailable Display"><nodel-icon name="warning"></nodel-icon> Open display</nodel-link>';
      document.querySelector('nodel-page[active]')?.append(fixture);
    });

    const link = page.locator('#link-state-fixture nodel-link');
    await expect(link).toHaveAttribute('data-state', 'loading');
    await expect(link.locator('a')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#link-state-fixture')).toHaveScreenshot('nodel-link-loading.png');
    release();

    await expect(link).toHaveAttribute('data-state', 'error');
    await expect(link.locator('a')).toHaveAttribute('href', '/nodes.html?filter=Unavailable%20Display#Network');
    await expect(link.locator('[role="status"]')).toContainText('Network node search');
    await expect(page.locator('#link-state-fixture')).toHaveScreenshot('nodel-link-fallback.png');
  });
});
