import { expect, test, type Page } from '@playwright/test';

const actionAliases = ['Start', 'Stop', 'InvalidAction'];
const eventAliases = ['Alert', 'Quiet'];

async function routeBindingsFixture(page: Page) {
  await page.addInitScript(() => {
    class BlockedWebSocket { constructor() { throw new Error('Bindings workbench fixture uses REST polling'); } }
    window.WebSocket = BlockedWebSocket as never;
  });
  await page.route('**/nodes/Demo/nodel.html', async (route) => {
    const response = await page.request.get(new URL('/nodel.html', route.request().url()).toString());
    await route.fulfill({ response });
  });
  await page.route('**/nodes/Demo/v2/**', async (route) => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace(/^\/nodes\/Demo/, '');
    await route.fulfill({ response: await page.request.get(url.toString()) });
  });
  await page.route('**/nodes/Demo/REST/', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ name: 'Demo', nodes: { Demo: { name: 'Demo' } } })
  }));
  await page.route('**/nodes/Demo/REST/actions', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(Object.fromEntries(actionAliases.map((name) => [name, { name, title: `${name} action` }])))
  }));
  await page.route('**/nodes/Demo/REST/events', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(Object.fromEntries(eventAliases.map((name) => [name, { name, title: `${name} event` }])))
  }));
  await page.route('**/nodes/Demo/REST/remote/schema', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      type: 'object',
      properties: {
        fixtureMetadata: { type: 'string' },
        actions: { type: 'object', properties: Object.fromEntries(actionAliases.map((name) => [name, {
          type: 'object', title: `${name} binding`, desc: `${name} fixture description`,
          properties: { node: { type: 'string' }, action: { type: 'string', enum: actionAliases } }
        }])) },
        events: { type: 'object', properties: Object.fromEntries(eventAliases.map((name) => [name, {
          type: 'object', title: `${name} binding`,
          properties: { node: { type: 'string' }, event: { type: 'string', enum: eventAliases } }
        }])) }
      }
    })
  }));
  await page.route('**/nodes/Demo/REST/remote', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      fixtureMetadata: 'keep-this-metadata',
      actions: {
        Start: { node: 'Demo', action: 'Start', vendorActionMetadata: { retained: true } },
        Stop: { node: 'OtherNode', action: 'Stop' },
        InvalidAction: { node: 'Demo', action: 'InvalidAction' }
      },
      events: { Alert: { node: 'Demo', event: 'Alert' }, Quiet: { node: '', event: 'Quiet' } },
      vendorRootMetadata: { version: 7 }
    })
  }));
  await page.route('**/nodes/Demo/REST/activity?from=*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([
      { seq: 1, timestamp: '2026-09-01T10:00:00Z', source: 'remote', type: 'actionBinding', alias: 'Start', arg: 'Wired' },
      { seq: 2, timestamp: '2026-09-01T10:00:01Z', source: 'remote', type: 'actionBinding', alias: 'Stop', arg: 'Empty' },
      { seq: 3, timestamp: '2026-09-01T10:00:02Z', source: 'remote', type: 'eventBinding', alias: 'Alert', arg: 'Wired' }
    ])
  }));
  await page.route('**/nodes/Demo/REST/hasRestarted*', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ timestamp: null })
  }));
  await page.route('**/REST/nodeURLsForNode', (route) => {
    const { name } = route.request().postDataJSON() as { name?: string };
    const address = name === 'DirectNode'
      ? 'http://127.0.0.1:4173/nodes/DirectNode/'
      : 'javascript:alert(1)';
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{ node: name, address }])
    });
  });
  await page.route('**/REST/nodeURLs', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.route('**/nodes/Demo/REST/remote/save', (route) => route.fulfill({ status: 200, body: '' }));
}

async function openConfig(page: Page) {
  await routeBindingsFixture(page);
  await page.goto('/nodes/Demo/nodel.html', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-nav-page-id="Config"]').click();
  const bindings = page.locator('nodel-bindings');
  await expect(bindings.locator('[data-bindings-row-id]')).toHaveCount(5);
  await expect(bindings.locator('[data-bindings-section] > details').first()).toHaveCSS('overflow', 'visible');
  if ((page.viewportSize()?.width ?? Infinity) <= 900) {
    await expect(bindings.locator('.nodel-bindings-header').first()).toBeHidden();
  }
  return bindings;
}

function rowByTitle(bindings: ReturnType<Page['locator']>, title: string) {
  return bindings.locator('[data-bindings-row-id]').filter({ hasText: title });
}

test.describe('bindings workbench regressions', () => {
  test('selection shortcuts replace scope and filter changes prune without selecting new matches', async ({ page }) => {
    const bindings = await openConfig(page);
    const start = rowByTitle(bindings, 'Start binding');
    const stop = rowByTitle(bindings, 'Stop binding');
    await bindings.getByRole('button', { name: /Select all/ }).click();
    await expect(bindings.locator('[data-bindings-row-select]:checked')).toHaveCount(5);
    await bindings.locator('[data-bindings-filter]').fill('Start');
    await expect(bindings.locator('[data-bindings-row-id]')).toHaveCount(1);
    await expect(start.locator('[data-bindings-row-select]')).toBeChecked();
    await bindings.getByRole('button', { name: 'Clear filters' }).click();
    await expect(bindings.locator('[data-bindings-row-select]:checked')).toHaveCount(1);
    await expect(stop.locator('[data-bindings-row-select]')).not.toBeChecked();
    await bindings.getByRole('button', { name: /Select all/ }).click();
    await expect(bindings.locator('[data-bindings-row-select]:checked')).toHaveCount(5);
    await bindings.locator('[data-bindings-status-filter]').selectOption('Unwired');
    await bindings.getByRole('button', { name: 'Select filtered' }).click();
    await expect(bindings.locator('[data-bindings-row-select]:checked')).toHaveCount(1);
    await expect(stop.locator('[data-bindings-row-select]')).toBeChecked();
    await bindings.getByRole('button', { name: 'Clear filters' }).click();
    await bindings.getByRole('button', { name: /Select Unset/ }).click();
    await expect(bindings.locator('[data-bindings-row-select]:checked')).toHaveCount(1);
    await expect(rowByTitle(bindings, 'Quiet binding').locator('[data-bindings-row-select]')).toBeChecked();
  });

  test('retains result membership while editing, then explicitly refreshes; filtering opens sections until manually collapsed', async ({ page }) => {
    const bindings = await openConfig(page);
    if ((page.viewportSize()?.width ?? 0) > 900) {
      const toolbar = bindings.locator('.nodel-bindings-toolbar-panel');
      await expect(toolbar).toHaveCSS('padding-top', '16px');
      const widths = await Promise.all([
        bindings.locator('[data-bindings-status-filter]'),
        bindings.locator('[data-bindings-clear-filter]'),
        bindings.locator('[data-bindings-refresh]'),
        bindings.locator('[data-bindings-apply-node]'),
        bindings.locator('[data-bindings-suggest]'),
        bindings.locator('[data-bindings-apply-suggestions]')
      ].map((element) => element.evaluate((node) => node.getBoundingClientRect().width)));
      for (const width of widths.slice(1)) expect(width).toBeCloseTo(widths[0]!, 0);
      const selectionWidths = await Promise.all(['visible', 'unset', 'clear'].map((mode) => bindings.locator(`[data-bindings-select="${mode}"]`).evaluate((element) => element.getBoundingClientRect().width)));
      for (const width of selectionWidths.slice(1)) expect(width).toBeCloseTo(selectionWidths[0]!, 0);
    }
    const filter = bindings.locator('[data-bindings-filter]');
    await filter.fill('Demo');
    const events = bindings.locator('[data-bindings-section="events"]');
    await expect(events).toHaveAttribute('open', '');
    await expect(filter).toBeFocused();
    await events.locator('summary').click();
    await expect(events).not.toHaveAttribute('open', '');
    const startRow = rowByTitle(bindings, 'Start binding');
    await startRow.locator('[data-bindings-node]').fill('DraftNode');
    await expect(startRow).toBeVisible();
    await expect(startRow).toHaveAttribute('data-bindings-row-id', /.+/);
    await expect(bindings.getByText(/Results changed/)).toBeVisible();
    await expect(events).not.toHaveAttribute('open', '');
    await bindings.getByRole('button', { name: 'Refresh results' }).click();
    await expect(bindings.locator('[data-bindings-row-id]')).toHaveCount(2);
    await expect(events).toHaveAttribute('open', '');
  });

  test('saves hidden edits and metadata, and local revert confirms/restores the current baseline', async ({ page }) => {
    const bindings = await openConfig(page);
    const metadata = bindings.locator('.nodel-bindings-meta');
    await expect(metadata).toContainText('5 bindings');
    await expect(metadata).not.toContainText('selected');
    await expect(bindings.locator('.nodel-bindings-help')).toHaveCount(0);
    await expect(bindings).not.toContainText('Selection replaces checked rows within results');
    let payload: Record<string, unknown> | undefined;
    await page.route('**/nodes/Demo/REST/remote/save', async (route) => {
      payload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 200, body: '' });
    });
    const stop = rowByTitle(bindings, 'Stop binding');
    await expect(stop).toBeVisible();
    await stop.locator('[data-bindings-node]').fill('EditedHiddenNode');
    await bindings.locator('[data-bindings-filter]').fill('Start');
    await expect(bindings.getByText(/outside|hidden/i)).toBeVisible();
    await bindings.getByRole('button', { name: /Save changes/ }).click();
    await expect.poll(() => payload).toBeDefined();
    expect(payload).toMatchObject({
      fixtureMetadata: 'keep-this-metadata',
      vendorRootMetadata: { version: 7 },
      actions: { Stop: { node: 'EditedHiddenNode' } }
    });
    expect((payload?.actions as Record<string, Record<string, unknown>> | undefined)?.Start?.vendorActionMetadata).toEqual({ retained: true });

    await bindings.getByRole('button', { name: 'Clear filters' }).click();
    await expect(stop.locator('[data-bindings-node]')).toHaveValue('EditedHiddenNode');
    await stop.locator('[data-bindings-node]').fill('LaterDraft');
    await bindings.getByRole('button', { name: 'Revert changes' }).click();
    const confirmation = page.getByRole('dialog');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(/changed|discard/i);
    await confirmation.getByRole('button', { name: /revert/i }).click();
    await expect(stop.locator('[data-bindings-node]')).toHaveValue('EditedHiddenNode');
    await expect(bindings.getByRole('button', { name: /Save changes/ })).toBeDisabled();
  });

  test('reveals invalid rows, resolves safe direct links, and keeps mobile controls within viewport', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('forced'), 'Mobile workbench layout is covered by Chromium mobile projects.');
    const directLookups: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/REST/nodeURLsForNode')) {
        const body = request.postDataJSON() as { name?: string };
        if (body.name) directLookups.push(body.name);
      }
    });
    const bindings = await openConfig(page);
    if (testInfo.project.name === 'chromium-dark-desktop' || testInfo.project.name === 'chromium-dark-mobile') {
      await bindings.screenshot({ path: `build/bindings-tools/bindings-${testInfo.project.name}.png` });
    }
    const configPage = page.locator('nodel-page[title="Config"][active]');
    const pageContent = configPage.locator('[data-page-content]');
    await expect(configPage).toHaveAttribute('title', 'Config');
    await expect(page.locator('[data-nav-page-id="Config"]')).toContainText('Config');
    for (const control of [
      bindings.locator('[data-bindings-filter]'),
      bindings.locator('[data-bindings-status-filter]'),
      bindings.locator('[data-bindings-bulk-node]'),
      bindings.locator('[data-bindings-node]').first(),
      bindings.locator('[data-bindings-target]').first(),
      bindings.locator('[data-bindings-select="visible"]')
    ]) {
      const effectiveTitle = await control.evaluate((element) => {
        const titledAncestor = element.closest<HTMLElement>('[title]');
        return { title: titledAncestor?.getAttribute('title'), isControl: titledAncestor === element };
      });
      expect(effectiveTitle).toEqual({ title: '', isControl: false });
    }
    const pageContentTitle = await pageContent.getAttribute('title');
    expect(pageContentTitle).toBe('');
    await expect.poll(() => directLookups.filter((name) => name === 'Demo')).toHaveLength(1);
    const desktopStart = rowByTitle(bindings, 'Start binding');
    const desktopNode = desktopStart.locator('[data-bindings-node]');
    const desktopTarget = desktopStart.locator('[data-bindings-target]');
    const desktopLink = desktopStart.locator('[data-bindings-open-node]');
    await expect(desktopLink).toBeVisible();
    const desktopNodeBounds = await desktopNode.boundingBox();
    const desktopTargetBounds = await desktopTarget.boundingBox();
    const desktopLinkBounds = await desktopLink.boundingBox();
    if ((page.viewportSize()?.width ?? 0) > 900) {
      expect(desktopNodeBounds?.y).toBeCloseTo(desktopTargetBounds?.y ?? Infinity, 0);
    }
    expect(desktopLinkBounds?.y).toBeGreaterThanOrEqual((desktopNodeBounds?.y ?? 0) - 0.5);
    expect((desktopLinkBounds?.y ?? Infinity) + (desktopLinkBounds?.height ?? 0)).toBeLessThanOrEqual((desktopNodeBounds?.y ?? 0) + (desktopNodeBounds?.height ?? 0) + 0.5);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(bindings.locator('.nodel-bindings-header').first()).toBeHidden();
    const fieldBounds = await bindings.locator('[data-bindings-bulk-node]').boundingBox();
    const buttonBounds = await bindings.locator('[data-bindings-apply-node]').boundingBox();
    expect(buttonBounds?.x).toBeCloseTo(fieldBounds?.x ?? Infinity, 0);
    const invalid = rowByTitle(bindings, 'InvalidAction binding');
    await invalid.locator('[data-bindings-target]').fill('UnsupportedAction');
    await bindings.locator('[data-bindings-filter]').fill('no matching row');
    await bindings.getByRole('button', { name: 'Show invalid bindings' }).click();
    await expect(invalid).toBeVisible();
    await expect(invalid.locator('[data-bindings-target]')).toBeFocused();

    const start = rowByTitle(bindings, 'Start binding');
    const node = start.locator('[data-bindings-node]');
    const nodeField = start.locator('.nodel-bindings-node-field');
    const nodeFieldBounds = await nodeField.boundingBox();
    await node.fill('');
    await expect(start.locator('[data-bindings-open-node]')).toBeHidden();
    const initiallyEmptyRowHeight = (await start.boundingBox())?.height;
    await node.fill('DirectNode');
    const directLink = bindings.getByRole('link', { name: 'Open node DirectNode' });
    await expect(directLink).toHaveAttribute('href', 'http://127.0.0.1:4173/nodes/DirectNode/');
    await node.fill('DraftNode');
    const openNode = bindings.getByRole('link', { name: 'Open node DraftNode' });
    await expect(openNode).toBeVisible();
    await expect(openNode).toHaveAttribute('href', /nodes\.html.*filter=DraftNode.*#Network/i);
    const openNodeTitle = 'Open this node, or search Network when a direct address is unavailable';
    await expect(openNode).toHaveAttribute('title', openNodeTitle);
    const effectiveOpenNodeTitle = await openNode.evaluate((element) => {
      const titledAncestor = element.closest<HTMLElement>('[title]');
      return { title: titledAncestor?.getAttribute('title'), isControl: titledAncestor === element };
    });
    expect(effectiveOpenNodeTitle).toEqual({ title: openNodeTitle, isControl: true });
    await expect(openNode.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await expect(openNode).not.toContainText('Open node');
    const linkBounds = await openNode.boundingBox();
    const currentInputBounds = await node.boundingBox();
    const inputPaddingRight = Number.parseFloat(await node.evaluate((input) => getComputedStyle(input).paddingRight));
    expect(linkBounds?.x).toBeGreaterThanOrEqual((nodeFieldBounds?.x ?? 0) - 0.5);
    expect((linkBounds?.x ?? Infinity) + (linkBounds?.width ?? 0)).toBeLessThanOrEqual((nodeFieldBounds?.x ?? 0) + (nodeFieldBounds?.width ?? 0) + 0.5);
    expect(linkBounds?.y).toBeGreaterThanOrEqual((currentInputBounds?.y ?? 0) - 0.5);
    expect((linkBounds?.y ?? Infinity) + (linkBounds?.height ?? 0)).toBeLessThanOrEqual((currentInputBounds?.y ?? 0) + (currentInputBounds?.height ?? 0) + 0.5);
    expect((linkBounds?.y ?? 0) + (linkBounds?.height ?? 0) / 2).toBeCloseTo((currentInputBounds?.y ?? 0) + (currentInputBounds?.height ?? 0) / 2, 0);
    expect(inputPaddingRight).toBeGreaterThanOrEqual((linkBounds?.width ?? 0) - 0.5);
    const rowHeightWithLink = (await start.boundingBox())?.height;
    expect(rowHeightWithLink).toBeCloseTo(initiallyEmptyRowHeight ?? Infinity, 0);
    const targetBounds = await start.locator('[data-bindings-target]').boundingBox();
    expect(currentInputBounds?.x).toBeCloseTo(targetBounds?.x ?? Infinity, 0);
    expect(currentInputBounds?.height).toBeCloseTo(targetBounds?.height ?? Infinity, 0);
    const longNodeName = `Node-${'LongDestination'.repeat(6)}`;
    await node.fill(longNodeName);
    await expect(bindings.getByRole('link', { name: `Open node ${longNodeName}` })).toBeVisible();
    await bindings.getByRole('button', { name: /Select all/ }).click();
    await expect(bindings.locator('.nodel-bindings-meta')).toContainText('5 selected; 2 changed');
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const clearBounds = await bindings.locator('[data-bindings-clear-filter]').boundingBox();
      const refreshBounds = await bindings.locator('[data-bindings-refresh]').boundingBox();
      expect((clearBounds?.y ?? Infinity) + (clearBounds?.height ?? 0)).toBeCloseTo((refreshBounds?.y ?? Infinity) + (refreshBounds?.height ?? 0), 0);
      await expect(bindings.locator('[data-bindings-clear-filter]')).toBeVisible();
      await expect(bindings.locator('[data-bindings-refresh]')).toBeVisible();
      const selectionWidths = await Promise.all(['visible', 'unset', 'clear'].map((mode) => bindings.locator(`[data-bindings-select="${mode}"]`).evaluate((element) => element.getBoundingClientRect().width)));
      for (const width of selectionWidths.slice(1)) expect(width).toBeCloseTo(selectionWidths[0]!, 0);
      const selection = await Promise.all(['visible', 'unset', 'clear'].map((mode) => bindings.locator(`[data-bindings-select="${mode}"]`).evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
      }))));
      for (const button of selection) {
        expect(button.height).toBeCloseTo(selection[0]!.height, 0);
        expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
      }
      expect(selection[0]!.height).toBeCloseTo(36, 0);
      await expect(bindings.locator('.nodel-bindings-mobile-label').first()).toBeVisible();
      const bulkActions = bindings.locator('.nodel-bindings-bulk-actions > button');
      for (const button of await bulkActions.all()) {
        const bounds = await button.boundingBox();
        expect(bounds?.width).toBeGreaterThanOrEqual(120);
        expect(await button.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(await button.evaluate((element) => element.clientWidth + 1));
      }
      await testInfo.attach(`bindings-layout-${width}`, {
        body: await bindings.screenshot(),
        contentType: 'image/png'
      });
    }

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    for (const row of await bindings.locator('[data-bindings-row-id]').all()) {
      await expect(row.locator('[data-bindings-node]')).toHaveAttribute('aria-label', /.+/);
      await expect(row.locator('[data-bindings-target]')).toHaveAttribute('aria-label', /.+/);
    }
  });

  test('reconciles a delayed direct link after filtering its row out and back in', async ({ page }) => {
    const bindings = await openConfig(page);
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    let requests = 0;
    await page.route('**/REST/nodeURLsForNode', async (route) => {
      const { name } = route.request().postDataJSON() as { name?: string };
      if (name !== 'DelayedNode') return route.fallback();
      requests += 1;
      await delayed;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ node: name, address: new URL('/nodes/DelayedNode/', page.url()).href }]) }).catch(() => {});
    });
    const start = rowByTitle(bindings, 'Start binding');
    await start.locator('[data-bindings-node]').fill('DelayedNode');
    await expect.poll(() => requests).toBe(1);
    await bindings.locator('[data-bindings-filter]').fill('Stop');
    await expect(start).toHaveCount(0);
    await bindings.getByRole('button', { name: 'Clear filters' }).click();
    await expect(start).toBeVisible();
    release();
    await expect(start.getByRole('link', { name: 'Open node DelayedNode' })).toHaveAttribute('href', new URL('/nodes/DelayedNode/', page.url()).href);
  });
});
