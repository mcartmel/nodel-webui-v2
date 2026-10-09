import { expect, test } from '@playwright/test';

test('closed host log preview follows newest entries and remains safe at narrow widths', async ({ page }) => {
  let updated = false;
  await page.route('**/REST/logs**', async (route) => {
    const entries = !updated
      ? [{ seq: 2, timestamp: '2026-01-01T00:00:02Z', level: 'INFO', message: 'Initial newest' }, { seq: 1, timestamp: '2026-01-01T00:00:01Z', level: 'INFO', message: 'Initial entry' }]
      : [{ seq: 3, timestamp: '2026-01-01T00:00:03Z', level: 'WARN', message: '<img src=x> ' + 'long message '.repeat(30) }];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entries) });
  });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/nodes.html#Diagnostics');
  const collapse = page.locator('nodel-collapse').filter({ has: page.locator('nodel-host-log') });
  const details = collapse.locator('details');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(collapse.locator('[data-collapse-preview]')).toContainText('Initial newest');
  updated = true;
  await expect(collapse.locator('[data-collapse-preview]')).toContainText('<img src=x>');
  await expect(collapse.locator('[data-collapse-preview] img')).toHaveCount(0);
  await expect(page.locator('nodel-host-log img')).toHaveCount(0);
  await expect(collapse.locator('[data-collapse-preview]')).toBeVisible();
  await details.locator('summary').click();
  await expect(collapse.locator('.nodel-host-log-line').last()).toContainText('<img src=x>');
  await details.locator('summary').click();
  await expect(collapse.locator('[data-collapse-preview]')).toContainText('<img src=x>');
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    await expect(collapse.locator('[data-collapse-preview]')).toBeVisible();
  }
});
