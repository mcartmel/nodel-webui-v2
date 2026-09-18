import { expect, test, type Page } from '@playwright/test';

async function openCatalogue(page: Page, pageId: string) {
  await page.goto(`/components.html#${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`nodel-page[data-page-id="${pageId}"][active]`).waitFor();
}

test.describe('page authoring primitives', () => {
  test('renders memory-backed Markdown, clock, status links, and a semantic flow footer', async ({ page }, testInfo) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await openCatalogue(page, 'Markdown');
    const markdown = page.locator('[data-catalogue-example="markdown"] nodel-markdown');
    await expect(markdown.locator('h2')).toHaveText('Live operations');
    await expect(markdown.locator('li')).toHaveCount(2);
    await expect(markdown).toHaveScreenshot('markdown.png', {
      maxDiffPixels: testInfo.project.name === 'chromium-forced-colors' ? 1500 : 150
    });

    await openCatalogue(page, 'Clock');
    const clock = page.locator('[data-catalogue-example="clock"] nodel-clock');
    await expect(clock.locator('time')).toHaveAttribute('datetime', '2026-07-31T10:15:30.000Z');
    await expect(clock).toHaveScreenshot('clock.png', {
      maxDiffPixels: testInfo.project.name === 'chromium-forced-colors' ? 1500 : 150
    });

    await openCatalogue(page, 'StatusBlocks');
    const status = page.locator('[data-catalogue-example="status-links"] nodel-status');
    await expect(status.locator('nodel-link a')).toHaveAttribute('href', '#Text');
    await expect(status.locator('.nodel-status-shell')).not.toHaveAttribute('href', /.+/);
    await expect(status).toHaveScreenshot('status-links.png', {
      maxDiffPixels: testInfo.project.name === 'chromium-forced-colors' ? 1500 : 150
    });

    await openCatalogue(page, 'Footer');
    const footer = page.locator('[data-catalogue-example="footer-flow"] nodel-footer');
    await expect(footer.locator('footer')).toContainText('Normal-flow footer content');
    await expect(footer).toHaveAttribute('data-fixed', 'false');
    await expect(footer).toHaveScreenshot('footer-flow.png', {
      maxDiffPixels: testInfo.project.name === 'chromium-forced-colors' ? 1500 : 150
    });

    const footerLink = footer.locator('nodel-link a');
    await footerLink.focus();
    await expect(footerLink).toBeFocused();
    expect(requests.some((url) => /REST\/(actions|events|activity)/.test(url))).toBe(false);
  });

  test('fixed footers wrap, reserve content space, preserve focus, and clean up', async ({ page }) => {
    await openCatalogue(page, 'Footer');
    const app = page.locator('nodel-app');
    await expect(app).not.toHaveAttribute('data-fixed-footer', 'true');

    await page.evaluate(() => {
      const footer = document.createElement('nodel-footer');
      footer.id = 'fixed-footer-fixture';
      footer.setAttribute('fixed', '');
      footer.innerHTML = `
        <span>Persistent controls</span>
        <button type="button" class="nodel-button">Previous item</button>
        <button type="button" class="nodel-button">Current selection</button>
        <button type="button" class="nodel-button nodel-button-primary">Continue presentation</button>
      `;
      document.querySelector('nodel-app')?.append(footer);
    });

    const footer = page.locator('#fixed-footer-fixture');
    const shell = footer.locator('[data-footer-shell]');
    await expect(app).toHaveAttribute('data-fixed-footer', 'true');
    await expect(shell).toHaveCSS('position', 'fixed');
    await expect(shell).toHaveCSS('flex-wrap', 'wrap');
    await expect.poll(async () => page.evaluate(() => {
      const appElement = document.querySelector<HTMLElement>('nodel-app')!;
      const shellElement = document.querySelector<HTMLElement>('#fixed-footer-fixture [data-footer-shell]')!;
      return Math.round(Number.parseFloat(getComputedStyle(appElement).paddingBottom)) - Math.ceil(shellElement.getBoundingClientRect().height);
    })).toBe(0);

    const metrics = await page.evaluate(() => {
      const appElement = document.querySelector<HTMLElement>('nodel-app')!;
      const shellElement = document.querySelector<HTMLElement>('#fixed-footer-fixture [data-footer-shell]')!;
      const rules = Array.from(document.styleSheets).flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules);
        } catch {
          return [];
        }
      });
      return {
        footerHeight: Math.ceil(shellElement.getBoundingClientRect().height),
        paddingBottom: Math.round(Number.parseFloat(getComputedStyle(appElement).paddingBottom)),
        safeAreaRule: rules.some((rule) => rule.cssText.includes('nodel-footer[fixed]')
          && rule.cssText.includes('safe-area-inset-bottom')
          && rule.cssText.includes('safe-area-inset-left')
          && rule.cssText.includes('safe-area-inset-right'))
      };
    });
    expect(metrics.footerHeight).toBeGreaterThan(0);
    expect(metrics.paddingBottom).toBe(metrics.footerHeight);
    expect(metrics.safeAreaRule).toBe(true);

    const firstButton = footer.locator('button').first();
    const secondButton = footer.locator('button').nth(1);
    await firstButton.focus();
    await page.keyboard.press('Tab');
    await expect(secondButton).toBeFocused();
    await expect(shell).toHaveScreenshot('fixed-footer.png');

    await footer.evaluate((element) => element.remove());
    await expect(app).not.toHaveAttribute('data-fixed-footer', 'true');
    expect(await app.evaluate((element) => getComputedStyle(element).paddingBottom)).toBe('0px');
  });
});
