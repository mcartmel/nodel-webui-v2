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

    const input = addNode.locator('.nodel-add-node-template');
    await input.fill('Projector');
    const autocomplete = addNode.locator('.nodel-template-autocomplete');
    await expect(autocomplete).toBeVisible();
    await expect(autocomplete.getByText('Recipes', { exact: true })).toBeVisible();
    await expect(autocomplete.getByText('Existing Nodes', { exact: true })).toBeVisible();
    await expect(autocomplete.locator('.nodel-add-node-result-secondary')).toHaveCount(2);
    await expect(autocomplete).toHaveScreenshot('add-node-autocomplete.png');

    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(addNode.locator('.nodel-template-selected')).toContainText('Recipe: Recipes/Starter Projector');
  });
});
