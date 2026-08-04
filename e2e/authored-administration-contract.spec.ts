import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const administrationPath = '/nodes/Demo/administration.contract.html';

async function serveNodeAssets(page: Page) {
  await page.route('**/nodes/Demo/v2/**', async (route) => {
    const sourceUrl = new URL(route.request().url());
    sourceUrl.pathname = sourceUrl.pathname.replace(/^\/nodes\/Demo/, '');
    const response = await page.request.get(sourceUrl.toString());
    await route.fulfill({ response });
  });
}

test.describe('no-build authored administration contract', () => {
  test('renders parameter, binding, and editor components from a static authored page', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-light-desktop', 'The administration contract is focused on the light desktop project.');

    await page.addInitScript(() => {
      class BlockedWebSocket {
        constructor() {
          throw new Error('WebSocket blocked for authored administration contract');
        }
      }
      window.WebSocket = BlockedWebSocket as never;
    });

    const fixture = await readFile(resolve(process.cwd(), 'e2e/fixtures/no-build-administration-authored-page.html'), 'utf8');
    await serveNodeAssets(page);
    await page.route(`**${administrationPath}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: fixture
      });
    });

    const requests: string[] = [];
    const requestFailures: string[] = [];
    const webSockets: string[] = [];
    const responseStatuses = new Map<string, number[]>();
    const pageErrors: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('requestfailed', (request) => requestFailures.push(request.url()));
    page.on('websocket', (socket) => webSockets.push(socket.url()));
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      const pathname = new URL(response.url()).pathname;
      const statuses = responseStatuses.get(pathname) ?? [];
      statuses.push(response.status());
      responseStatuses.set(pathname, statuses);
    });

    await page.route('**/nodes/Demo/REST/activity?from=*', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]'
    }));
    await page.route('**/nodes/Demo/REST/', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: 'Demo' })
    }));
    await page.route('**/nodes/Demo/REST/params/schema', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'object',
        properties: {
          label: { type: 'string', title: 'Display label', required: true },
          connectOnStart: {
            type: 'boolean',
            title: 'Connect on start',
            desc: 'Automatically connect when the node starts.'
          }
        }
      })
    }));
    await page.route('**/nodes/Demo/REST/params', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ label: 'Fixture value', connectOnStart: true })
    }));
    await page.route('**/nodes/Demo/REST/remote/schema', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'object',
        properties: {
          actions: {
            type: 'object',
            properties: {
              Start: {
                type: 'object',
                title: 'Start action',
                desc: 'Representative schema row',
                properties: {
                  node: { type: 'string' },
                  action: { type: 'string' }
                }
              }
            }
          }
        }
      })
    }));
    await page.route('**/nodes/Demo/REST/remote', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ actions: { Start: { node: 'Demo', action: 'Start' } } })
    }));
    await page.route('**/nodes/Demo/REST/files', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ path: 'script.py', size: 15 }])
    }));
    await page.route('**/nodes/Demo/REST/files/contents?path=*', (route) => route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: 'print("fixture")'
    }));

    await page.goto(administrationPath, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nodel-app')).toHaveAttribute('data-nodel-app', 'true');
    await expect(page.locator('link[href*="v2/nodel-webui.css"]')).toHaveCount(1);
    await expect.poll(() => responseStatuses.get('/nodes/Demo/v2/nodel-webui.css')?.includes(200) ?? false).toBe(true);
    await expect.poll(() => responseStatuses.get('/nodes/Demo/v2/nodel-webui.js')?.includes(200) ?? false).toBe(true);

    const params = page.locator('nodel-params');
    await expect(params.locator('[data-params-form] .nodel-field')).toHaveValue('Fixture value');
    await expect(params).toContainText('Display label');
    const checkboxLabel = params.locator('.nodel-schema-check', { hasText: 'Connect on start' });
    const checkbox = checkboxLabel.getByRole('checkbox');
    const checkboxTitle = checkboxLabel.locator('.nodel-schema-control-stack > .font-medium');
    await expect(checkbox).toBeChecked();
    const [checkboxBox, titleBox] = await Promise.all([checkbox.boundingBox(), checkboxTitle.boundingBox()]);
    expect(checkboxBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(Math.abs(
      (checkboxBox!.y + checkboxBox!.height / 2) - (titleBox!.y + titleBox!.height / 2)
    )).toBeLessThanOrEqual(1);

    const bindings = page.locator('nodel-bindings');
    await expect(bindings.locator('[data-bindings-section="actions"]')).toContainText('Start action');
    await expect(bindings.locator('[data-bindings-row-id]').first()).toContainText('Representative schema row');

    const editor = page.locator('nodel-editor');
    await expect(editor.locator('.cm-editor')).toBeVisible();
    await expect(editor.locator('[data-editor-file-picker] option:checked')).toContainText('script.py');
    await expect(editor.locator('.cm-line')).toContainText('print("fixture")');

    for (const chunk of ['nodel-params-', 'nodel-bindings-', 'nodel-editor-']) {
      expect(requests.filter((url) => new RegExp(`/v2/chunks/${chunk}[^/]+\\.js$`).test(new URL(url).pathname))).toHaveLength(1);
    }
    expect(requests.filter((url) => /\/v2\/chunks\/jsviews-[^/]+\.js$/.test(new URL(url).pathname))).toHaveLength(1);
    expect(requests.filter((url) => /\/v2\/chunks\/codemirror-editor-[^/]+\.js$/.test(new URL(url).pathname))).toHaveLength(1);
    expect(requests.some((url) => /\/v2\/chunks\/auto-[^/]+\.js$/.test(new URL(url).pathname))).toBe(false);
    expect(requestFailures.filter((url) => new URL(url).pathname.includes('/v2/'))).toEqual([]);
    expect(webSockets).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
