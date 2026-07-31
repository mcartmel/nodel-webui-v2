import { expect, test, type Page } from '@playwright/test';

async function openCatalogue(page: Page, pageId: string) {
  await page.goto(`/components.html#${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`nodel-page[data-page-id="${pageId}"][active]`).waitFor();
}

test.describe('retained control and layout parity', () => {
  test('formats live palette values and renders partial compact states', async ({ page }, testInfo) => {
    const screenshotOptions = { maxDiffPixels: testInfo.project.name === 'chromium-forced-colors' ? 1500 : 150 };
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await openCatalogue(page, 'PickersPrecision');
    const palette = page.locator('[data-catalogue-example="palette-native"] nodel-palette');
    await expect(palette).toHaveAttribute('data-format', 'hsl');
    await expect(palette).toHaveAttribute('data-live', 'true');
    await page.evaluate(() => {
      const element = document.querySelector('[data-catalogue-example="palette-native"] nodel-palette');
      element?.addEventListener('nodel-palette-change', (event) => {
        (window as typeof window & { paletteChange?: unknown }).paletteChange = (event as CustomEvent).detail;
      });
    });
    await palette.locator('.nodel-palette-value-input').fill('rgb(255, 0, 0)');
    await expect(palette).toHaveAttribute('value', '#ff0000');
    await expect.poll(() => page.evaluate(() => (window as typeof window & { paletteChange?: { arg?: unknown } }).paletteChange?.arg)).toBe('hsl(0, 100%, 50%)');
    await expect(palette.locator('.nodel-palette-custom')).toHaveScreenshot('palette-live-format.png', screenshotOptions);

    await openCatalogue(page, 'Media');
    const indicators = page.locator('[data-catalogue-example="media-status-indicators"] nodel-status-indicator');
    await expect(indicators.nth(4)).toHaveAttribute('data-state', 'partially-on');
    await expect(indicators.nth(5)).toHaveAttribute('data-state', 'partially-off');
    await expect(indicators.nth(5)).toHaveAttribute('data-partial-tone', 'info');
    await expect(indicators.nth(5).locator('.nodel-status-indicator-label')).toHaveText('Some off');
    await expect(indicators.nth(5)).toHaveAttribute('aria-label', 'Zone state');
    await expect(page.locator('[data-catalogue-example="media-status-indicators"]')).toHaveScreenshot('partial-status-indicators.png', screenshotOptions);
    expect(requests.some((url) => /REST\/actions/.test(url))).toBe(false);
  });

  test('auto-places select panels without changing keyboard or source order', async ({ page }, testInfo) => {
    const screenshotOptions = { maxDiffPixels: testInfo.project.name === 'chromium-forced-colors' ? 1500 : 150 };
    await openCatalogue(page, 'PickersPrecision');
    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'placement-fixture';
      fixture.style.cssText = 'position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:60';
      fixture.innerHTML = `
        <nodel-select placement="auto" label="Placement example">
          <nodel-button value="first">First</nodel-button>
          <nodel-button value="second">Second</nodel-button>
          <nodel-button value="third">Third</nodel-button>
        </nodel-select>
      `;
      document.querySelector('nodel-app')?.append(fixture);
    });
    const fixture = page.locator('#placement-fixture');
    const select = fixture.locator('nodel-select');
    const trigger = select.locator('.nodel-select-trigger');
    await trigger.click();
    await expect(select).toHaveAttribute('data-placement', 'top');
    const topGeometry = await page.evaluate(() => {
      const triggerRect = document.querySelector('#placement-fixture .nodel-select-trigger')!.getBoundingClientRect();
      const panelRect = document.querySelector('#placement-fixture .nodel-select-panel')!.getBoundingClientRect();
      return { panelBottom: Math.round(panelRect.bottom), triggerTop: Math.round(triggerRect.top) };
    });
    expect(topGeometry.panelBottom).toBeLessThanOrEqual(topGeometry.triggerTop);
    expect(await select.locator('nodel-button').allTextContents()).toEqual(['First', 'Second', 'Third']);
    await expect(fixture).toHaveScreenshot('select-auto-top.png', screenshotOptions);

    await fixture.evaluate((element) => {
      (element as HTMLElement).style.top = '6rem';
      (element as HTMLElement).style.bottom = 'auto';
      window.dispatchEvent(new Event('scroll'));
    });
    await expect(select).toHaveAttribute('data-placement', 'bottom');

    await fixture.evaluate((element) => element.remove());
    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'growth-placement-fixture';
      fixture.style.cssText = 'position:fixed;left:1rem;right:1rem;top:calc(100vh - 10rem);z-index:60';
      fixture.innerHTML = '<nodel-select placement="auto" label="Growing options"><nodel-button>First</nodel-button></nodel-select>';
      document.querySelector('nodel-app')?.append(fixture);
    });
    const growingSelect = page.locator('#growth-placement-fixture nodel-select');
    await growingSelect.locator('.nodel-select-trigger').click();
    await expect(growingSelect).toHaveAttribute('data-placement', 'bottom');
    await growingSelect.locator('.nodel-select-panel').evaluate((panel) => {
      for (let index = 2; index <= 12; index += 1) {
        const option = document.createElement('nodel-button');
        option.textContent = `Option ${index}`;
        panel.append(option);
      }
    });
    await expect(growingSelect).toHaveAttribute('data-placement', 'top');

    await openCatalogue(page, 'Responsive');
    const columns = page.locator('[data-catalogue-example="layout-responsive"] nodel-row').first().locator('nodel-column');
    expect(await columns.evaluateAll((elements) => elements.map((element) => element.textContent?.trim()))).toEqual(['Primary content', 'Supporting content']);
    const orders = await columns.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).order));
    const mobile = page.viewportSize()!.width < 768;
    expect(orders).toEqual(mobile ? ['2', '1'] : ['0', '0']);
    await expect(page.locator('[data-catalogue-example="layout-responsive"] nodel-row').first()).toHaveScreenshot('responsive-column-order.png', screenshotOptions);
  });
});
