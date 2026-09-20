import { expect, test } from '@playwright/test';

const leafRoutes = [
  'Quickstart',
  'App', 'Toolbar', 'Pages', 'Footer', 'ThemeToggle', 'RowsColumns', 'ControlGridSpacer', 'Groups', 'Collapse', 'Templates',
  'Buttons', 'Toggles', 'SegmentedChoices', 'Select', 'Faders', 'Steppers', 'DirectionalPads', 'Palette', 'KeyboardShortcuts',
  'Titles', 'Text', 'Markdown', 'Images', 'Icons', 'QRCodes', 'Readouts', 'Meters', 'StatusIndicators', 'StatusBlocks', 'Clock', 'HostIcon', 'Links',
  'PageSizing', 'ActionsSignals', 'Visibility', 'DynamicOptions', 'Appearance', 'Confirmations'
];

test.describe('catalogue desktop navigation', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium-light-desktop', 'Navigation matrix runs once in Chromium.');
    await page.goto('/components.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nodel-page[data-page-id="Quickstart"][active]')).toHaveCount(1);
  });

  test('reaches every canonical leaf route and preserves browser history', async ({ page }) => {
    for (const route of leafRoutes) {
      await page.goto(`/components.html#${route}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator(`nodel-page[data-page-id="${route}"][active]`)).toHaveCount(1);
      await expect(page.locator(`[data-nav-page-id="${route}"][aria-current="page"]`)).toHaveCount(1);
    }

    await page.goto('/components.html#Quickstart');
    await expect(page.locator('nodel-page[data-page-id="Quickstart"][active]')).toHaveCount(1);
    await page.goto('/components.html#Buttons');
    await expect(page.locator('nodel-page[data-page-id="Buttons"][active]')).toHaveCount(1);
    await page.locator('[data-nav-group-id="Controls"]').click();
    await page.keyboard.press('End');
    await expect(page.locator('#nodel-menu-Controls [data-nav-page-id="KeyboardShortcuts"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('nodel-page[data-page-id="KeyboardShortcuts"][active]')).toHaveCount(1);

    await page.goBack();
    await expect(page.locator('nodel-page[data-page-id="Quickstart"][active]')).toHaveCount(1);
    await page.goForward();
    await expect(page.locator('nodel-page[data-page-id="KeyboardShortcuts"][active]')).toHaveCount(1);
  });

  test('bounds a long desktop group menu and keeps its last item reachable', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 400 });
    await page.goto('/components.html#Quickstart', { waitUntil: 'domcontentloaded' });
    const menu = page.locator('#nodel-menu-DisplayContent');
    await page.locator('[data-nav-group-id="DisplayContent"]').click();
    await expect(menu).toBeVisible();

    const metrics = await menu.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        top: box.top,
        bottom: box.bottom,
        viewportHeight: window.innerHeight,
        overflowY: getComputedStyle(element).overflowY
      };
    });
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    expect(metrics.top).toBeGreaterThanOrEqual(-1);
    expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(metrics.overflowY).toBe('auto');

    const lastItem = menu.locator('[data-nav-page-id="Links"]');
    await menu.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const lastItemBox = await lastItem.boundingBox();
    const menuBox = await menu.boundingBox();
    if (!lastItemBox || !menuBox) {
      throw new Error('Expected the scrolled last menu item and menu bounds.');
    }
    if (lastItemBox.y < menuBox.y - 1 || lastItemBox.y + lastItemBox.height > menuBox.y + menuBox.height + 1) {
      throw new Error('The last menu item is not reachable within the bounded menu.');
    }
  });
});

test.describe('catalogue mobile navigation', () => {
  test.use({ hasTouch: true });

  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium-light-mobile', 'Touch navigation runs once in Chromium mobile.');
    await page.setViewportSize({ width: 568, height: 320 });
    await page.goto('/components.html#Quickstart', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nodel-page[data-page-id="Quickstart"][active]')).toHaveCount(1);
  });

  test('keeps long group menus scrollable and touch-selectable', async ({ page }) => {
    const menu = page.locator('#nodel-menu-DisplayContent');
    await page.locator('[data-nav-group-id="DisplayContent"]').tap();
    await expect(menu).toBeVisible();
    const metrics = await menu.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    await menu.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await menu.locator('[data-nav-page-id="Links"]').tap();
    await expect(page.locator('nodel-page[data-page-id="Links"][active]')).toHaveCount(1);
  });
});
