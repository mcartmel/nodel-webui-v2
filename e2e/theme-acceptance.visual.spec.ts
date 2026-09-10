import { expect, test, type Page, type TestInfo } from '@playwright/test';

const animationReset = `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }`;

function isCaptureProject(testInfo: TestInfo) {
  return testInfo.project.name.startsWith('chromium-') && !testInfo.project.name.includes('forced');
}

async function routeNodeFixture(page: Page) {
  await page.addInitScript(() => {
    class BlockedWebSocket { constructor() { throw new Error('Acceptance capture uses REST polling'); } }
    window.WebSocket = BlockedWebSocket as never;
  });
  const activity = [
    { seq: 1, timestamp: '2026-07-13T10:00:01Z', source: 'local', type: 'action', alias: 'Start', arg: { mode: 'safe' } },
    { seq: 2, timestamp: '2026-07-13T10:00:02Z', source: 'remote', type: 'event', alias: 'Temperature', arg: 21.5 },
    { seq: 3, timestamp: '2026-07-13T10:00:03Z', source: 'remote', type: 'actionBinding', alias: 'Start', arg: 'Demo' },
    { seq: 4, timestamp: '2026-07-13T10:00:04Z', source: 'unbound', type: 'eventBinding', alias: 'Alert', arg: 'Nominal' }
  ];
  await page.route('**/nodes/Demo/REST/activity?from=*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(activity) }));
  await page.route('**/nodes/Demo/REST/console?*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { seq: 1, timestamp: '2026-07-13T10:00:01Z', console: 'info', comment: 'Node started successfully' },
    { seq: 2, timestamp: '2026-07-13T10:00:02Z', console: 'out', comment: 'Ready for commands' }
  ]) }));
  await page.route('**/nodes/Demo/REST/', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: 'Demo', desc: '# Demo node\n\nA populated acceptance fixture with live operations.' }) }));
  await page.route('**/nodes/Demo/REST/actions', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    Start: { name: 'Start', title: 'Start node', desc: 'Start the node safely.', group: 'Lifecycle', schema: { type: 'object', properties: { mode: { type: 'string', title: 'Mode', enum: ['safe', 'fast'] } } } },
    Stop: { name: 'Stop', title: 'Stop node', desc: 'Stop the node.', group: 'Lifecycle', schema: { type: 'object', properties: { reason: { type: 'string', title: 'Reason' } } } }
  }) }));
  await page.route('**/nodes/Demo/REST/events', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    Temperature: { name: 'Temperature', title: 'Temperature', desc: 'Current temperature.', group: 'Telemetry', schema: { type: 'number', title: 'Degrees' } },
    Alert: { name: 'Alert', title: 'Alert', desc: 'Current alert text.', group: 'Telemetry', schema: { type: 'string', title: 'Message' } }
  }) }));
  await page.route('**/nodes/Demo/REST/params/schema', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'object', properties: {
    label: { type: 'string', title: 'Display label' },
    enabled: { type: 'boolean', title: 'Enabled' },
    nested: { type: 'object', title: 'Nested settings', properties: { threshold: { type: 'number', title: 'Threshold' } } }
  } }) }));
  await page.route('**/nodes/Demo/REST/params', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ label: 'Demo node', enabled: true, nested: { threshold: 42 } }) }));
  await page.route('**/nodes/Demo/REST/remote/schema', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'object', properties: { actions: { type: 'object', properties: { Start: { type: 'object', title: 'Start binding', desc: 'Starts Demo.', properties: { node: { type: 'string' }, action: { type: 'string', enum: ['Start'] } } } } }, events: { type: 'object', properties: { Alert: { type: 'object', title: 'Alert binding', desc: 'Reports alerts.', properties: { node: { type: 'string' }, event: { type: 'string', enum: ['Alert'] } } } } } } }) }));
  await page.route('**/nodes/Demo/REST/remote', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ actions: { Start: { node: 'Demo', action: 'Start' } }, events: { Alert: { node: 'Demo', event: 'Alert' } } }) }));
  await page.route('**/nodes/Demo/REST/files', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ path: 'script.py', size: 48 }]) }));
  await page.route('**/nodes/Demo/REST/files/contents?path=*', (route) => route.fulfill({ contentType: 'text/plain', body: '# Ready\nprint("demo")\nvalue = 42' }));
  await page.route('**/nodes/Demo/REST/hasRestarted*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ timestamp: null }) }));
  await page.route('**/nodes/Demo/nodel.html', async (route) => {
    const response = await page.request.get(new URL('/nodel.html', route.request().url()).toString());
    await route.fulfill({ response });
  });
  await page.route('**/nodes/Demo/v2/**', async (route) => {
    const sourceUrl = new URL(route.request().url());
    sourceUrl.pathname = sourceUrl.pathname.replace(/^\/nodes\/Demo/, '');
    const response = await page.request.get(sourceUrl.toString());
    await route.fulfill({ response });
  });
}

async function waitForPopulatedActivity(page: Page) {
  await expect(page.locator('nodel-description')).toContainText('populated acceptance fixture');
  await expect(page.locator('nodel-console .nodel-console-line')).toHaveCount(2);
  await expect(page.locator('[data-console-input]')).toHaveCount(1);
  const actSigSections = page.locator('nodel-actsig details.nodel-actsig-section');
  await expect(actSigSections).toHaveCount(2);
  await actSigSections.first().locator('summary').click();
  await expect(page.locator('nodel-actsig details[open] .nodel-actsig-form')).toHaveCount(2);
  await expect(page.locator('nodel-log .nodel-log-row')).toHaveCount(4);
}

test.describe('theme acceptance captures', () => {
  test.use({ timezoneId: 'UTC' });

  test('captures populated Activity and Config surfaces', async ({ page }, testInfo) => {
    test.skip(!isCaptureProject(testInfo), 'Acceptance captures run in Chromium light/dark desktop and mobile projects.');
    await routeNodeFixture(page);
    await page.goto('/nodes/Demo/nodel.html', { waitUntil: 'domcontentloaded' });
    await page.addStyleTag({ content: animationReset });
    await expect(page.locator('nodel-page[active]').first()).toBeVisible();
    await waitForPopulatedActivity(page);
    await expect(page.locator('[data-console-input]')).toHaveCSS('background-color', /rgb/);
    await page.locator('nodel-collapse').filter({ hasText: 'Console' }).locator('summary').click();
    await page.locator('nodel-collapse').filter({ hasText: 'Recipe' }).locator('summary').click();
    await page.locator('nodel-actsig details[open] details.nodel-schema-root-object > summary').first().click();
    await expect(page.locator('nodel-console .nodel-console-line', { hasText: 'Ready for commands' })).toBeVisible();
    await expect(page.locator('nodel-editor .cm-line', { hasText: 'print' })).toBeVisible();
    await expect(page.locator('nodel-actsig details[open] details.nodel-schema-root-object[open]')).toContainText('Mode');
    await expect(page.locator('nodel-actsig details[open] .nodel-actsig-form')).toHaveCount(2);
    await expect(page.locator('nodel-actsig details.nodel-actsig-section:not([open])')).toHaveCount(1);
    await page.evaluate(async () => { await document.fonts?.ready; });
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot('activity-populated.png', { fullPage: true, maxDiffPixels: 150 });

    await page.locator('[data-nav-page-id="Config"]').click();
    await expect(page.locator('nodel-page[title="Config"][active]')).toBeVisible();
    await expect(page.locator('nodel-bindings [data-bindings-row-id]')).toHaveCount(2);
    await expect(page.locator('nodel-bindings')).toContainText('Start binding');
    await expect(page.locator('nodel-params')).toContainText('Nested settings');
    await page.locator('nodel-page[title="Config"] nodel-collapse > details > summary').click();
    await expect(page.locator('nodel-params .nodel-field')).toHaveCount(1);
    await page.getByText('Nested settings', { exact: true }).click();
    await expect(page.locator('nodel-params .nodel-field')).toHaveCount(2);
    await expect(page.locator('nodel-params .nodel-field').nth(1)).toHaveValue('42');
    await page.evaluate(async () => { await document.fonts?.ready; });
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot('config-populated.png', { fullPage: true, maxDiffPixels: 150 });
  });
});
