import { expect, test, type Page } from '@playwright/test';

async function serveNodeAssets(page: Page) {
  await page.route('**/nodes/Demo/v2/**', async (route) => {
    const sourceUrl = new URL(route.request().url());
    sourceUrl.pathname = sourceUrl.pathname.replace(/^\/nodes\/Demo/, '');
    const response = await page.request.get(sourceUrl.toString());
    await route.fulfill({ response });
  });
}

test.describe('catalogue Quickstart', () => {
  test('opens first and upgrades its copied scaffold below a node path', async ({ page }) => {
    const pageErrors: string[] = [];
    const requestFailures: string[] = [];
    const responses: Array<{ path: string; status: number }> = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) => requestFailures.push(request.url()));
    page.on('response', (response) => responses.push({
      path: new URL(response.url()).pathname,
      status: response.status()
    }));

    await page.goto('/components.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nodel-page[data-page-id="Quickstart"][active]')).toHaveCount(1);
    await expect(page.locator('[data-nav-page-id="Quickstart"][aria-current="page"]')).toHaveCount(1);

    const scaffold = await page.locator('[data-catalogue-quickstart-code] code').textContent();
    expect(scaffold).toContain('<nodel-app title="YOUR BROWSER TAB TITLE" theme="dark">');
    expect(scaffold).not.toContain('data-theme=');
    expect(scaffold).not.toContain('<title>');
    if (!scaffold) {
      throw new Error('Quickstart scaffold is empty.');
    }

    const failureStart = requestFailures.length;
    const responseStart = responses.length;
    await serveNodeAssets(page);
    await page.route('**/nodes/Demo/quickstart.html', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: scaffold
    }));
    await page.goto('/nodes/Demo/quickstart.html', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('link[href="./v2/nodel-webui.css"]')).toHaveCount(1);
    await expect(page.locator('script[src="./v2/nodel-webui.js"]')).toHaveCount(1);
    await expect(page.locator('nodel-app[data-nodel-app="true"]')).toHaveCount(1);
    await expect(page).toHaveTitle('YOUR BROWSER TAB TITLE');
    await expect(page.locator('[data-toolbar-title]')).toHaveText('YOUR TOOLBAR TITLE');
    await expect(page.locator('[data-nav-page-id="YOURNAVIGATIONTABTITLE"]')).toHaveText('YOUR NAVIGATION TAB TITLE');
    await expect(page.locator('nodel-title')).toHaveText('YOUR PAGE HEADING');
    await expect(page.locator('nodel-text')).toHaveText('Your content goes here.');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('nodel-app')).toHaveAttribute('theme', 'dark');
    await expect(page.locator('script[data-nodel-runtime="memory"]')).toHaveCount(0);
    await expect.poll(() => responses.slice(responseStart)).toEqual(expect.arrayContaining([
      { path: '/nodes/Demo/v2/nodel-webui.css', status: 200 },
      { path: '/nodes/Demo/v2/nodel-webui.js', status: 200 }
    ]));

    expect(pageErrors).toEqual([]);
    expect(requestFailures.slice(failureStart)).toEqual([]);
    expect(responses.slice(responseStart).filter((response) => response.path.startsWith('/nodes/Demo/v2/') && response.status >= 400)).toEqual([]);
    expect(await page.evaluate(() => performance.getEntriesByType('resource').some((entry) => entry.name.includes('/src/')))).toBe(false);
  });

  test('paints the fixed theme before the runtime upgrades the scaffold', async ({ page }) => {
    await page.goto('/components.html', { waitUntil: 'domcontentloaded' });
    const scaffold = await page.locator('[data-catalogue-quickstart-code] code').textContent();
    if (!scaffold) {
      throw new Error('Quickstart scaffold is empty.');
    }
    await serveNodeAssets(page);
    await page.route('**/nodes/Demo/v2/nodel-webui.js', (route) => route.abort());
    await page.route('**/nodes/Demo/quickstart.html', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: scaffold
    }));
    await page.goto('/nodes/Demo/quickstart.html', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('nodel-app[data-nodel-app]')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
    await expect.poll(() => page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return styles.colorScheme.split(/\s+/).includes('dark') && styles.getPropertyValue('--nodel-bg').trim() === '2 6 23';
    })).toBe(true);
  });

  test('paints an explicit light app ahead of a contradictory dark root', async ({ page }) => {
    await page.goto('/components.html', { waitUntil: 'domcontentloaded' });
    const scaffold = await page.locator('[data-catalogue-quickstart-code] code').textContent();
    if (!scaffold) {
      throw new Error('Quickstart scaffold is empty.');
    }
    const contradictoryScaffold = scaffold
      .replace('<html lang="en">', '<html lang="en" data-theme="dark">')
      .replace('<nodel-app title="YOUR BROWSER TAB TITLE" theme="dark">', '<nodel-app title="YOUR BROWSER TAB TITLE" theme="light">');
    await serveNodeAssets(page);
    await page.route('**/nodes/Demo/v2/nodel-webui.js', (route) => route.abort());
    await page.route('**/nodes/Demo/quickstart.html', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: contradictoryScaffold
    }));
    await page.goto('/nodes/Demo/quickstart.html', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('nodel-app[data-nodel-app]')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return styles.colorScheme.split(/\s+/).includes('light') && styles.getPropertyValue('--nodel-bg').trim() === '241 245 249';
    })).toBe(true);
  });

  test('keeps the Quickstart code surface inside a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/components.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nodel-page[data-page-id="Quickstart"][active]')).toHaveCount(1);
    const overflow = await page.evaluate(() => {
      const code = document.querySelector<HTMLElement>('[data-catalogue-quickstart-code]');
      const box = code?.getBoundingClientRect();
      return {
        document: document.documentElement.scrollWidth > window.innerWidth,
        codeFitsViewport: box ? box.x >= 0 && box.x + box.width <= window.innerWidth : false,
        codeScrollsInternally: code ? code.scrollWidth > code.clientWidth : false
      };
    });
    expect(overflow).toEqual({ document: false, codeFitsViewport: true, codeScrollsInternally: true });
  });
});
