import { expect, test, type Page } from '@playwright/test';

async function openCatalogue(page: Page, pageId: string) {
  await page.goto(`/components.html#${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`nodel-page[data-page-id="${pageId}"][active]`).waitFor();
}

test.describe('catalogue in-memory runtime', () => {
  test('catalogue uses canonical public Free examples and preserves the Nodel alias', async ({ page }) => {
    await openCatalogue(page, 'Media');
    const examples = page.locator('[data-catalogue-example="media-standalone-media"] nodel-icon');
    await expect(examples).toHaveCount(4);
    await expect(examples.nth(0)).toHaveAttribute('data-name', 'tv');
    await expect(examples.nth(0)).toHaveAttribute('data-family', 'classic');
    await expect(examples.nth(0)).toHaveAttribute('data-style', 'solid');
    await expect(examples.nth(1)).toHaveAttribute('data-name', 'address-book');
    await expect(examples.nth(1)).toHaveAttribute('data-style', 'regular');
    await expect(examples.nth(2)).toHaveAttribute('data-name', 'github');
    await expect(examples.nth(2)).toHaveAttribute('data-family', 'brands');
    await expect(examples.nth(3)).toHaveAttribute('data-name', 'power');
    await expect(page.locator('nodel-icon[family="duotone"], nodel-icon[family="sharp"], nodel-icon[family="sharp-duotone"]')).toHaveCount(0);
  });

  test('loads catalogue icons from an authored page without remote Font Awesome requests', async ({ page }) => {
    const requests: string[] = [];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:4173') {
        await route.continue();
      } else {
        await route.abort();
      }
    });
    page.on('request', request => requests.push(request.url()));
    await page.route('**/authored-stage-2.html', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><script type="module" src="./v2/nodel-webui.js"></script><nodel-icon name="tv"></nodel-icon><nodel-icon name="address-book" family="classic" style="regular"></nodel-icon><nodel-icon name="github" family="brands"></nodel-icon>'
    }));
    await page.goto('/authored-stage-2.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nodel-icon')).toHaveCount(3);
    await expect(page.locator('nodel-icon').nth(0)).toHaveAttribute('data-icon-state', 'ready');
    await expect(page.locator('nodel-icon').nth(1)).toHaveAttribute('data-icon-state', 'ready');
    await expect(page.locator('nodel-icon').nth(2)).toHaveAttribute('data-icon-state', 'ready');
    expect(requests.some(url => /fontawesome|kit.fontawesome|use\.fontawesome/.test(url))).toBe(false);
  });

  test('covers standalone and button icon presentation, fallback accessibility, and inactive deferral', async ({ page }, testInfo) => {
    await page.route('**/icon-surface.html', route => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><script type="module" src="./v2/nodel-webui.js"></script><nodel-icon id="standalone" name="tv" tone="danger" size="lg" alt="Television"></nodel-icon><nodel-button id="icon-button" aria-label="Open television"><nodel-icon name="tv" size="sm"></nodel-icon></nodel-button><nodel-icon id="missing" name="not-a-real-icon" alt="Unavailable icon"></nodel-icon><nodel-page id="inactive" hidden><nodel-icon id="deferred" name="address-book" family="classic" style="regular"></nodel-icon></nodel-page>'
    }));
    await page.goto('/icon-surface.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#standalone')).toHaveAttribute('data-icon-state', 'ready');
    await expect(page.locator('#standalone')).toHaveAttribute('data-tone', 'danger');
    await expect(page.locator('#standalone')).toHaveAttribute('data-size', 'lg');
    await expect(page.locator('#standalone')).toHaveAttribute('role', 'img');
    await expect(page.locator('#standalone')).toHaveAttribute('aria-label', 'Television');
    await expect(page.locator('#icon-button button')).toHaveAttribute('aria-label', 'Open television');
    await expect(page.locator('#icon-button nodel-icon')).toHaveAttribute('data-size', 'sm');
    await expect(page.locator('#missing')).toHaveAttribute('data-icon-state', 'fallback');
    await expect(page.locator('#missing')).toHaveAttribute('aria-label', 'Unavailable icon');
    await expect(page.locator('#deferred')).toHaveAttribute('data-icon-state', 'loading');
    await page.locator('#inactive').evaluate(element => element.removeAttribute('hidden'));
    await expect(page.locator('#deferred')).toHaveAttribute('data-icon-state', 'ready');
    if (testInfo.project.name === 'chromium-forced-colors') {
      expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
      await expect(page.locator('#icon-button button')).toBeVisible();
    }
  });

  test('starts in memory and closes the loop between actions and signals', async ({ page }) => {
    const requests: string[] = [];
    const websockets: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('websocket', (websocket) => websockets.push(websocket.url()));

    await openCatalogue(page, 'ControlGrid');
    await expect(page.locator('script[data-nodel-runtime="memory"]')).toHaveCount(1);

    await expect(page.locator('[data-catalogue-example="dynamic-options"] nodel-select')).toHaveAttribute('data-options-state', 'ready');
    await expect(page.locator('[data-catalogue-example="dynamic-options"] nodel-select nodel-button')).toHaveText(['HDMI 1', 'HDMI 2', 'USB-C', 'Chromecast', 'TV', 'Signage']);
    await expect(page.locator('[data-catalogue-example="dynamic-options"] nodel-segmented')).toHaveAttribute('data-options-state', 'ready');

    const dynamicSelect = page.locator('[data-catalogue-example="dynamic-options"] nodel-select');
    await dynamicSelect.locator('.nodel-select-trigger').click();
    await dynamicSelect.locator('nodel-button[value="TV"] button').click();

    await expect(dynamicSelect.locator('.nodel-select-value')).toHaveText('TV');
    await openCatalogue(page, 'PickersPrecision');
    await expect(page.locator('[data-catalogue-example="select-stepper"] nodel-select .nodel-select-value')).toHaveText('TV');

    await openCatalogue(page, 'TogglesSegmented');
    const power = page.locator('[data-catalogue-example="toggles-actions-confirm"] nodel-toggle').first();
    await expect(power).toHaveAttribute('data-state', 'off');
    await power.locator('button').click();
    await expect(power).toHaveAttribute('data-state', 'on');

    await openCatalogue(page, 'Templates');
    const generatedButton = page.locator('[data-catalogue-example="templates-repeated-controls"] nodel-button').first();
    await generatedButton.locator('button').click();
    await expect(generatedButton).toHaveAttribute('data-active', 'true');

    await openCatalogue(page, 'Media');
    const network = page.locator('[data-catalogue-example="media-status-blocks"] nodel-status').filter({ hasText: 'Network' });
    await expect(network).toHaveAttribute('data-state', 'warning');
    await network.locator('nodel-button').click();
    await expect(network).toHaveAttribute('data-state', 'success');
    await expect(network).toContainText('Network ready');

    expect(requests.some((url) => /REST\/(actions|activity)/.test(url))).toBe(false);
    expect(websockets.some((url) => url.includes('/nodes/'))).toBe(false);
  });

  test('keeps the memory override active when the catalogue is served below a node path', async ({ page }) => {
    await page.route('**/nodes/Demo/components.html*', async (route) => {
      const sourceUrl = new URL('/components.html', route.request().url());
      const response = await page.request.get(sourceUrl.toString());
      await route.fulfill({ response });
    });
    await page.route('**/nodes/Demo/v2/**', async (route) => {
      const sourceUrl = new URL(route.request().url());
      sourceUrl.pathname = sourceUrl.pathname.replace(/^\/nodes\/Demo/, '');
      const response = await page.request.get(sourceUrl.toString());
      await route.fulfill({ response });
    });

    const requests: string[] = [];
    const websockets: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('websocket', (websocket) => websockets.push(websocket.url()));
    await page.goto('/nodes/Demo/components.html#TogglesSegmented', { waitUntil: 'domcontentloaded' });
    await page.locator('nodel-page[data-page-id="TogglesSegmented"][active]').waitFor();

    const power = page.locator('[data-catalogue-example="toggles-actions-confirm"] nodel-toggle').first();
    await power.locator('button').click();
    await expect(power).toHaveAttribute('data-state', 'on');
    expect(requests.some((url) => /REST\/(actions|activity)/.test(url))).toBe(false);
    expect(websockets.some((url) => url.includes('/nodes/'))).toBe(false);
  });

  test('drives exact and aggregated visibility without backend requests', async ({ page }) => {
    const requests: string[] = [];
    const websockets: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('websocket', (websocket) => websockets.push(websocket.url()));

    await openCatalogue(page, 'Visibility');
    const single = page.getByText('Single exact value: Presentation', { exact: true });
    const plural = page.getByText('Multiple exact values: Presentation or Preview', { exact: true });
    const any = page.getByText('Any: mode is Presentation or source is Signage', { exact: true });
    const all = page.getByText('All: mode is Presentation and source is Signage', { exact: true });

    await expect(single).toBeHidden();
    await expect(plural).toBeHidden();
    await expect(any).toBeHidden();
    await expect(all).toBeHidden();

    await page.locator('nodel-button', { hasText: 'Presentation mode' }).locator('button').click();
    await expect(single).toBeVisible();
    await expect(plural).toBeVisible();
    await expect(any).toBeVisible();
    await expect(all).toBeHidden();

    await page.locator('nodel-button', { hasText: 'Signage source' }).locator('button').click();
    await expect(all).toBeVisible();

    await page.locator('nodel-button', { hasText: 'Auto mode' }).locator('button').click();
    await expect(single).toBeHidden();
    await expect(plural).toBeHidden();
    await expect(any).toBeVisible();
    await expect(all).toBeHidden();

    await page.locator('nodel-button', { hasText: 'HDMI source' }).locator('button').click();
    await expect(any).toBeHidden();
    expect(requests.some((url) => /REST\/(actions|activity)/.test(url))).toBe(false);
    expect(websockets.some((url) => url.includes('/nodes/'))).toBe(false);
  });

  test('gates a catalogue action behind code confirmation', async ({ page }) => {
    const requests: string[] = [];
    const websockets: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('websocket', (websocket) => websockets.push(websocket.url()));
    await openCatalogue(page, 'TogglesSegmented');

    const shutdown = page.locator('[data-catalogue-example="toggles-actions-confirm"] nodel-group').filter({ hasText: 'Shutdown' }).locator('nodel-toggle');
    const trigger = shutdown.locator('button');
    await expect(shutdown).toHaveAttribute('data-state', 'off');
    await trigger.click();

    const host = page.locator('nodel-confirm-host');
    await expect(host).toBeVisible();
    await expect(host.locator('.nodel-confirm-code-status')).toHaveText('Operator code ready.');
    await expect(host.locator('.nodel-confirm-code-status')).toHaveClass(/\bsr-only\b/);
    await expect(host.locator('[data-confirm-action="confirm"]')).toBeDisabled();
    await expect(shutdown).toHaveAttribute('data-state', 'off');
    expect(await host.evaluate((element) => element.innerHTML.includes('0420'))).toBe(false);

    for (const digit of ['0', '4', '2', '1']) {
      await host.locator(`[data-confirm-code-digit="${digit}"]`).click();
    }
    await expect(host.locator('[data-confirm-action="confirm"]')).toBeDisabled();
    await host.locator('[data-confirm-action="backspace"]').click();
    await host.locator('[data-confirm-code-digit="0"]').click();
    await expect(host.locator('[data-confirm-action="confirm"]')).toBeEnabled();
    await host.locator('[data-confirm-action="confirm"]').click();

    await expect(host).toBeHidden();
    await expect(shutdown).toHaveAttribute('data-state', 'on');
    await expect(trigger).toBeFocused();
    expect(requests.some((url) => /REST\/(actions|activity)/.test(url))).toBe(false);
    expect(websockets.some((url) => url.includes('/nodes/'))).toBe(false);
  });
});
