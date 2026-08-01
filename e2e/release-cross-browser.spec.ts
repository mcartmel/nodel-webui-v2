import { expect, test, type Page, type TestInfo } from '@playwright/test';

const releaseProjects = new Set(['chromium-light-desktop', 'firefox-light-desktop', 'webkit-light-desktop']);
const crossEngineVisualProjects = new Set(['firefox-light-desktop', 'webkit-light-desktop']);

function skipOutsideReleaseMatrix(testInfo: TestInfo) {
  test.skip(!releaseProjects.has(testInfo.project.name), 'Cross-browser release gate runs once per browser engine.');
}

async function openCatalogue(page: Page, pageId: string) {
  await page.goto(`/components.html#${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`nodel-page[data-page-id="${pageId}"][active]`).waitFor();
}

test.describe('cross-browser release gate', () => {
  test('@cross-browser closes the catalogue action and signal loop without backend traffic', async ({ page }, testInfo) => {
    skipOutsideReleaseMatrix(testInfo);
    const requests: string[] = [];
    const websockets: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('websocket', (websocket) => websockets.push(websocket.url()));

    await openCatalogue(page, 'ControlGrid');
    await expect(page.locator('script[data-nodel-runtime="memory"]')).toHaveCount(1);
    const select = page.locator('[data-catalogue-example="dynamic-options"] nodel-select');
    await expect(select).toHaveAttribute('data-options-state', 'ready');
    await select.locator('.nodel-select-trigger').click();
    await select.locator('nodel-button[value="TV"] button').click();
    await expect(select.locator('.nodel-select-value')).toHaveText('TV');

    await openCatalogue(page, 'PagePrimitives');
    const example = page.locator('[data-catalogue-example="content-page-primitives"]');
    await expect(example.locator('nodel-markdown h2')).toHaveText('Live operations');
    await expect(example.locator('nodel-clock time')).toHaveAttribute('datetime', '2026-07-31T10:15:30.000Z');
    await expect(example.locator('nodel-footer')).toHaveAttribute('data-fixed', 'false');
    expect(requests.some((url) => /REST\/(actions|events|activity)/.test(url))).toBe(false);
    expect(websockets.some((url) => url.includes('/nodes/'))).toBe(false);
  });

  test('@cross-browser renders representative authored primitives', async ({ page }, testInfo) => {
    test.skip(!crossEngineVisualProjects.has(testInfo.project.name), 'Chromium visual coverage is provided by the exhaustive theme/device projects.');
    await openCatalogue(page, 'PagePrimitives');
    const example = page.locator('[data-catalogue-example="content-page-primitives"]');
    await page.evaluate(async () => {
      await document.fonts?.ready;
    });
    // Firefox and WebKit resolve system fonts differently across supported Linux distributions.
    await expect(example).toHaveScreenshot('release-authored-primitives.png', {
      maxDiffPixels: 6000,
      maxDiffPixelRatio: 0.016
    });
  });
});
