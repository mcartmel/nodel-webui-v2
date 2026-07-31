import { expect, test, type Page } from '@playwright/test';

async function openCatalogue(page: Page, pageId: string) {
  await page.goto(`/components.html#${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`nodel-page[data-page-id="${pageId}"][active]`).waitFor();
}

test.describe('catalogue in-memory runtime', () => {
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
});
