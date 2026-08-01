import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const releaseProjects = new Set([
  'chromium-light-desktop',
  'firefox-light-desktop',
  'webkit-light-desktop'
]);

test.describe('no-build authored-page contract', () => {
  test('upgrades initial and later markup through stable built assets', async ({ page }, testInfo) => {
    test.skip(!releaseProjects.has(testInfo.project.name), 'The no-build contract runs once per browser engine.');

    const fixture = await readFile(resolve(process.cwd(), 'e2e/fixtures/no-build-authored-page.html'), 'utf8');
    const requests: string[] = [];
    const webSockets: string[] = [];
    page.on('request', (request) => requests.push(new URL(request.url()).pathname));
    page.on('websocket', (socket) => webSockets.push(socket.url()));
    await page.route('**/authored-page.contract.html', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: fixture
    }));

    await page.goto('/authored-page.contract.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);
    await expect(page.locator('#contract-button button')).toHaveText('Ready');
    await expect(page.locator('#contract-toggle button')).toHaveAttribute('role', 'switch');
    await expect(page.locator('nodel-markdown h2')).toHaveText('Stable assets');
    await expect(page.locator('script[data-nodel-runtime="memory"]')).toHaveCount(0);

    const definitions = await page.evaluate(() => [
      'nodel-app',
      'nodel-button',
      'nodel-toggle',
      'nodel-select',
      'nodel-markdown'
    ].map((name) => Boolean(customElements.get(name))));
    expect(definitions).toEqual([true, true, true, true, true]);

    await page.locator('#dynamic-contract').evaluate((host) => {
      host.innerHTML = `
        <nodel-group label="Inserted after startup">
          <nodel-select id="contract-select" value="A">
            <nodel-button value="A">Alpha</nodel-button>
            <nodel-button value="B">Beta</nodel-button>
          </nodel-select>
        </nodel-group>
      `;
    });
    const select = page.locator('#contract-select');
    await expect(select.locator('.nodel-select-value')).toHaveText('Alpha');
    await select.locator('.nodel-select-trigger').click();
    await select.locator('nodel-button[value="B"] button').click();
    await expect(select).toHaveAttribute('value', 'B');

    await expect.poll(() => requests.some((path) => path === '/v2/nodel-webui.css')).toBe(true);
    await expect.poll(() => requests.some((path) => path === '/v2/nodel-webui.js')).toBe(true);
    expect(requests.some((path) => path.startsWith('/src/'))).toBe(false);
    expect(requests.some((path) => path.includes('/REST'))).toBe(false);
    expect(webSockets).toEqual([]);
  });
});
