import { expect, test, type Page } from '@playwright/test';

async function openV1Bridge(page: Page, path: string) {
  await page.goto('/components.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate((nextPath) => window.history.replaceState({}, '', nextPath), path);
  await page.setContent(`
    <!doctype html>
    <html>
      <head></head>
      <body>
        <nav class="navbar navbar-inverse">
          <div class="navbar-right"><p id="clock"></p></div>
        </nav>
      </body>
    </html>
  `);
  await page.addScriptTag({ url: '/v2/v1-bridge.js' });
  return page.locator('#nodel-ui-version-toggle-v1');
}

test.describe('V1 bridge', () => {
  test('links node XML pages to the sibling V2 page', async ({ page }) => {
    const control = await openV1Bridge(page, '/nodes/ExampleNode/index.xml');
    await expect(control).toHaveAttribute('aria-label', 'User interface version');
    await expect(control.locator('[aria-current="page"]')).toHaveText('V1');
    await expect(control.locator('a')).toHaveAttribute('href', 'nodel.html');
    await expect(control.locator('a')).toHaveText('V2');
  });

  for (const [path, href] of ([
    ['/locals.xml', '/nodes.html#Locals'],
    ['/nodes.xml', '/nodes.html#Network'],
    ['/diagnostics.xml', '/nodes.html#Diagnostics'],
    ['/toolkit.xml', '/toolkit.html']
  ] as const)) {
    test(`maps ${path} to its V2 equivalent`, async ({ page }) => {
      const control = await openV1Bridge(page, path);
      await expect(control.locator('a')).toHaveAttribute('href', href);
    });
  }

  test('keeps the alternate UI target at least 40 pixels square', async ({ page }) => {
    const control = await openV1Bridge(page, '/locals.xml');
    const box = await control.locator('a').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);
  });
});

test.describe('V2 version control', () => {
  test('keeps the host link synchronized with the active section', async ({ page }) => {
    await page.goto('/nodes.html#Locals', { waitUntil: 'domcontentloaded' });
    const control = page.locator('.nodel-ui-version-toggle');
    const legacyLink = control.locator('[data-nodel-v1-link="host"]');

    await expect(control.locator('[aria-current="page"]')).toHaveText('V2');
    await expect(legacyLink).toHaveAttribute('href', '/locals.xml');

    await page.evaluate(() => { window.location.hash = 'Network'; });
    await expect(legacyLink).toHaveAttribute('href', '/nodes.xml');

    const box = await legacyLink.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);
  });

  test('links the toolkit to its V1 page', async ({ page }) => {
    await page.goto('/toolkit.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-nodel-v1-link="toolkit"]')).toHaveAttribute('href', '/toolkit.xml');
  });
});
