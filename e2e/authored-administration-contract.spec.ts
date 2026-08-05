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
    await page.setViewportSize({ width: 1068, height: 700 });

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
    const consoleErrors: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('requestfailed', (request) => requestFailures.push(request.url()));
    page.on('websocket', (socket) => webSockets.push(socket.url()));
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`${message.text()} ${message.location().url}`.trim());
    });
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
    await page.route('**/nodes/Demo/REST/hasRestarted*', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ timestamp: null })
    }));
    await page.route('**/nodes/Demo/REST/', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: 'Demo', nodes: { Demo: { name: 'Demo' } } })
    }));
    await page.route('**/nodes/Demo/REST/actions', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Start: { name: 'Start', title: 'Start' } })
    }));
    await page.route('**/REST', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ nodes: { Demo: { name: 'Demo' } } })
    }));
    await page.route('**/REST/nodeURLs', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ node: 'Demo', address: 'http://localhost/nodes/Demo/', host: 'localhost' }])
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
          },
          topicSignals: {
            type: 'array',
            title: 'Topic signals',
            desc: 'Creates Nodel signals from MQTT topics. Items: {name, topic, type, title, group, qos}. Types: string, boolean, integer, number, json, and binary.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                topic: { type: 'string' }
              }
            }
          }
        }
      })
    }));
    await page.route('**/nodes/Demo/REST/params', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ label: 'Fixture value', connectOnStart: true, topicSignals: [] })
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
                  action: { type: 'string', enum: ['Start'] }
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
    const paramsPanel = params.locator('[data-params-form]');
    const paramsFieldset = paramsPanel.locator('fieldset').first();
    const topicSignals = params.locator('[data-schema-kind="array"] .nodel-collapse').first();
    await expect(paramsFieldset).toHaveCSS('min-width', '0px');
    await expect(topicSignals).toContainText('Topic signals');
    const [panelBox, fieldsetBox, fieldBox, topicSignalsBox] = await Promise.all([
      paramsPanel.boundingBox(),
      paramsFieldset.boundingBox(),
      params.locator('.nodel-field').first().boundingBox(),
      topicSignals.boundingBox()
    ]);
    expect(panelBox).not.toBeNull();
    for (const box of [fieldsetBox, fieldBox, topicSignalsBox]) {
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
    }

    const bindings = page.locator('nodel-bindings');
    await expect(bindings.locator('[data-bindings-section="actions"]')).toContainText('Start action');
    const bindingRow = bindings.locator('[data-bindings-row-id]').first();
    await expect(bindingRow).toContainText('Representative schema row');
    const bindingNode = bindingRow.locator('[data-bindings-node]');
    await bindingNode.fill('De');
    const nodeOption = bindingRow.locator('[data-bindings-option="node"]');
    await expect(nodeOption).toBeVisible();
    await nodeOption.click();
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    await expect(bindingNode).toHaveValue('Demo');
    const bindingTarget = bindingRow.locator('[data-bindings-target]');
    await bindingTarget.fill('Sta');
    const targetOption = bindingRow.locator('[data-bindings-option="target"]');
    await expect(targetOption).toBeVisible();
    await targetOption.click();
    await expect(bindingTarget).toHaveValue('Start');
    await bindingTarget.fill('MissingAction');
    await expect(bindingTarget).toHaveAttribute('aria-invalid', 'true');
    const bindingError = bindingRow.getByRole('alert');
    await expect(bindingError).toBeVisible();
    const [bindingTargetBox, bindingErrorBox] = await Promise.all([
      bindingTarget.boundingBox(),
      bindingError.boundingBox()
    ]);
    expect(bindingTargetBox).not.toBeNull();
    expect(bindingErrorBox).not.toBeNull();
    expect(bindingErrorBox!.y).toBeGreaterThanOrEqual(bindingTargetBox!.y + bindingTargetBox!.height);

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
    expect(consoleErrors).toEqual([]);
  });
});
