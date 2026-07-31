import { expect, test, type TestInfo } from '@playwright/test';

function isDesktopThemeProject(testInfo: TestInfo) {
  return testInfo.project.name === 'chromium-light-desktop' || testInfo.project.name === 'chromium-dark-desktop';
}

test.describe('add-node autocomplete', () => {
  test('renders recipe and duplicate-node suggestions in both themes', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Autocomplete baselines run once for each desktop colour theme.');

    await page.route('**/REST/recipes/list', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{ path: 'Recipes/Starter Projector' }])
    }));
    await page.route('**/REST/nodeURLs', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{ node: 'Existing Projector', address: 'http://equipment/nodes/Existing%20Projector/', host: 'equipment' }])
    }));

    await page.goto('/nodes.html#Locals', { waitUntil: 'domcontentloaded' });
    const addNode = page.locator('nodel-add-node');
    await addNode.locator('.nodel-add-node-toggle').click();
    const panel = addNode.locator('.nodel-add-node-panel');
    const panelHeightBefore = (await panel.boundingBox())?.height;

    const input = addNode.locator('.nodel-add-node-template');
    await input.fill('Projector');
    const autocomplete = addNode.locator('.nodel-template-autocomplete');
    await expect(autocomplete).toBeVisible();
    await expect.poll(() => autocomplete.evaluate((element) => getComputedStyle(element).position)).toBe('absolute');
    await expect.poll(() => autocomplete.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
    const panelHeightAfter = (await panel.boundingBox())?.height;
    expect(panelHeightAfter).toBeCloseTo(panelHeightBefore ?? 0, 1);
    await expect(autocomplete.getByText('Recipes', { exact: true })).toBeVisible();
    await expect(autocomplete.getByText('Existing Nodes', { exact: true })).toBeVisible();
    await expect(autocomplete.locator('.nodel-add-node-result-secondary')).toHaveCount(2);
    await expect(autocomplete).toHaveScreenshot('add-node-autocomplete.png');

    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(addNode.locator('.nodel-template-selected')).toContainText('Recipe: Recipes/Starter Projector');
  });

  test('renders duplicate options and partial-copy warning across display modes', async ({ page }) => {
    await page.route('**/REST/recipes/list', (route) => route.fulfill({
      contentType: 'application/json',
      body: '[]'
    }));
    await page.route('**/REST/nodeURLs', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{ node: 'Existing Projector', address: 'http://equipment/nodes/Existing%20Projector/', host: 'equipment' }])
    }));
    await page.route('http://equipment/nodes/Existing%20Projector/REST/files', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{ path: 'projector.png' }, { path: 'unavailable.zip' }, { path: 'nodeConfig.json' }])
    }));
    await page.route('http://equipment/nodes/Existing%20Projector/REST/files/contents?path=*', (route) => route.fulfill({
      contentType: 'application/octet-stream',
      body: 'fixture'
    }));
    await page.route('**/REST/newNode', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
    await page.route('**/nodes/ProjectorCopy/REST/', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
    await page.route('**/nodes/ProjectorCopy/REST/files/save?path=*', (route) => {
      const path = new URL(route.request().url()).searchParams.get('path');
      if (path === 'unavailable.zip') {
        return route.fulfill({
          status: 507,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Destination storage rejected this file.' })
        });
      }
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    });

    await page.goto('/nodes.html#Locals', { waitUntil: 'domcontentloaded' });
    const addNode = page.locator('nodel-add-node');
    await addNode.locator('.nodel-add-node-toggle').click();
    await addNode.locator('.nodel-add-node-name').fill('Projector Copy');
    const templateInput = addNode.locator('.nodel-add-node-template');
    await templateInput.fill('Existing Projector');
    const sourceOption = addNode.locator('.nodel-template-autocomplete .nodel-menu-item');
    await expect(sourceOption).toHaveCount(1);
    await sourceOption.click();

    const copyConfiguration = addNode.locator('[data-add-node-copy-config]');
    await expect(copyConfiguration).toBeVisible();
    await expect(copyConfiguration).not.toBeChecked();
    await addNode.locator('button[type="submit"]').click();

    const warning = addNode.locator('.nodel-add-node-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('unavailable.zip');
    await expect(warning).toContainText('HTTP 507');
    await expect(addNode.locator('.nodel-template-selected')).toContainText('Node: Existing Projector');
    await expect(addNode.locator('.nodel-add-node-panel')).toHaveScreenshot('add-node-partial-copy.png');
  });

  test('redirects to a completely duplicated node by default', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-light-desktop', 'Default redirect behavior needs one browser project.');

    await page.route('**/REST/recipes/list', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
    await page.route('**/REST/nodeURLs', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{ node: 'Existing Projector', address: 'http://equipment/nodes/Existing%20Projector/', host: 'equipment' }])
    }));
    await page.route('http://equipment/nodes/Existing%20Projector/REST/files', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }));
    await page.route('**/REST/newNode', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
    await page.route('**/nodes/CompleteCopy/REST/', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
    await page.route('**/nodes/CompleteCopy/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Complete Copy</title>' }));

    await page.goto('/nodes.html#Locals', { waitUntil: 'domcontentloaded' });
    const addNode = page.locator('nodel-add-node');
    await addNode.locator('.nodel-add-node-toggle').click();
    await addNode.locator('.nodel-add-node-name').fill('Complete Copy');
    const templateInput = addNode.locator('.nodel-add-node-template');
    await templateInput.fill('Existing Projector');
    const sourceOption = addNode.locator('.nodel-template-autocomplete .nodel-menu-item');
    await expect(sourceOption).toHaveCount(1);
    await sourceOption.click();
    await addNode.locator('button[type="submit"]').click();

    await page.waitForURL('**/nodes/CompleteCopy/');
  });
});
