import { expect, test } from '@playwright/test';

test.describe('catalogue component references', () => {
  test('renders a keyboard-accessible semantic table with contained mobile overflow', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-light-desktop', 'Reference behavior is covered once in Chromium.');

    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/components.html#Buttons', { waitUntil: 'domcontentloaded' });
    await page.locator('nodel-page[data-page-id="Buttons"][active]').waitFor();

    const reference = page.locator('[data-catalogue-reference-for="nodel-button"]');
    const summary = reference.locator('.nodel-collapse-summary');
    await expect(summary).toContainText('nodel-button attributes');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(reference).toHaveAttribute('open', '');

    const table = page.getByRole('table', { name: 'nodel-button attributes' });
    await expect(table).toBeVisible();
    await expect(table.getByRole('columnheader')).toHaveText(['Attribute', 'Accepted value', 'Default', 'Description']);
    await expect(table.locator('[data-catalogue-reference-row="variant"]')).toContainText('primary');
    await expect(table.locator('[data-catalogue-reference-row="signals"]')).toHaveCount(1);
    await expect(table.locator('[data-catalogue-reference-row="visibility"]')).toContainText('common');

    const scrollRegion = page.getByRole('region', { name: 'nodel-button attribute table' });
    await scrollRegion.focus();
    await expect(scrollRegion).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scrollRegion.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

    const overflow = await reference.evaluate((element) => {
      const wrapper = element.querySelector<HTMLElement>('.nodel-catalogue-reference-table-scroll');
      return {
        pageContained: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        tableScrollable: Boolean(wrapper && wrapper.scrollWidth > wrapper.clientWidth)
      };
    });
    expect(overflow).toEqual({ pageContained: true, tableScrollable: true });
  });
});
