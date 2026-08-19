import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function openCompletionEditor(page: Page, text: string, path = 'panel.html') {
  await page.route('**/REST/files', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ path }])
  }));
  await page.route('**/REST/files/contents?*', (route) => route.fulfill({ contentType: 'text/plain', body: text }));
  await page.goto('/components.html#Buttons', { waitUntil: 'domcontentloaded' });
  await page.locator('nodel-page[data-page-id="Buttons"][active]').waitFor();
  await page.evaluate((defaultPath) => {
    document.querySelector('#stage-2-completion-fixture')?.remove();
    const host = document.createElement('section');
    host.id = 'stage-2-completion-fixture';
    host.innerHTML = `<nodel-editor default-file="${defaultPath}"></nodel-editor>`;
    document.querySelector('nodel-page[active]')?.append(host);
  }, path);
  const content = page.locator('#stage-2-completion-fixture .cm-content');
  await expect(content).toBeVisible();
  await content.click();
  return content;
}

async function openCompletions(page: Page) {
  await page.keyboard.press('Control+Space');
  const options = page.locator('.cm-tooltip-autocomplete [role="option"]');
  await expect(options.first()).toBeVisible();
  return options;
}

async function chooseCompletion(options: Locator, label: string) {
  const option = options.filter({ hasText: label }).first();
  await expect(option).toBeVisible();
  await option.dispatchEvent('mousedown', { button: 0 });
}

async function chooseCompletionByKeyboard(page: Page, options: Locator, label: string, filter: string) {
  await page.keyboard.type(filter);
  const option = options.filter({ hasText: label }).first();
  await expect(option).toBeVisible();
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
}

async function editorText(content: Locator) {
  return (await content.locator('.cm-line').allTextContents()).join('\n');
}

async function tooltipColors(lintTooltip: Locator) {
  return lintTooltip.evaluate((tooltip) => {
    const host = document.querySelector<HTMLElement>('#stage-2-completion-fixture .nodel-editor-host');
    if (!host) {
      throw new Error('Missing editor host for lint tooltip color probe.');
    }
    const probe = document.createElement('div');
    probe.style.color = 'rgb(var(--nodel-fg))';
    probe.style.background = 'var(--nodel-popover-background, rgb(var(--nodel-surface-raised)))';
    probe.style.borderColor = 'rgb(var(--nodel-border))';
    host.append(probe);
    const expected = getComputedStyle(probe);
    const actual = getComputedStyle(tooltip);
    const colors = {
      actualBackground: actual.backgroundColor,
      actualBorder: actual.borderTopColor,
      actualForeground: actual.color,
      expectedBackground: expected.backgroundColor,
      expectedBorder: expected.borderTopColor,
      expectedForeground: expected.color
    };
    probe.remove();
    return colors;
  });
}

async function expectCompletionA11y(page: Page, projectName: string) {
  // CodeMirror keeps keyboard focus on the editor and controls its listbox
  // through aria-activedescendant, which this Safari-oriented rule cannot infer.
  const results = await new AxeBuilder({ page }).include('#stage-2-completion-fixture').disableRules(['scrollable-region-focusable']).analyze();
  expect(results.violations, projectName).toEqual([]);
}

test.describe('Stage 2 CodeMirror completion regressions', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(!['chromium-light-desktop', 'chromium-dark-desktop'].includes(testInfo.project.name), 'Focused real-editor coverage runs in Chromium light and dark.');
  });

  test('keeps ordinary HTML and Nodel element completion together at a typed delimiter', async ({ page }) => {
    await openCompletionEditor(page, '<');
    const options = await openCompletions(page);
    await expect(options.filter({ hasText: 'div' }).first()).toBeVisible();
    await expect(options.filter({ hasText: 'nodel-button' }).first()).toBeVisible();
  });

  test('applies a Nodel element at a bare delimiter without duplicating it', async ({ page }) => {
    const content = await openCompletionEditor(page, '<');
    await chooseCompletion(await openCompletions(page), 'nodel-button');
    await expect.poll(() => editorText(content)).toMatch(/^<nodel-button/);
    await expect.poll(() => editorText(content)).not.toMatch(/^<</);
  });

  test('replaces a partial opening element name', async ({ page }) => {
    const content = await openCompletionEditor(page, '<nodel-b');
    const options = await openCompletions(page);
    await expect(options.filter({ hasText: 'nodel-button' }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect.poll(() => editorText(content)).toMatch(/^<nodel-button/);
    await expect.poll(() => editorText(content)).not.toMatch(/^<</);
  });

  test('keeps ordinary HTML attributes beside Nodel attributes', async ({ page }) => {
    await openCompletionEditor(page, '<nodel-button ');
    const options = await openCompletions(page);
    await expect(options.filter({ hasText: 'class' }).first()).toBeVisible();
    await expect(options.filter({ hasText: 'variant' }).first()).toBeVisible();
  });

  test('replaces a partially typed enum value', async ({ page }) => {
    const content = await openCompletionEditor(page, '<nodel-toggle value="o');
    await chooseCompletion(await openCompletions(page), 'off');
    await expect.poll(() => editorText(content)).toBe('<nodel-toggle value="off"');
  });

  test('completes a partial closing tag', async ({ page }) => {
    const content = await openCompletionEditor(page, '<nodel-button></nodel-b');
    await chooseCompletion(await openCompletions(page), 'nodel-button');
    await expect.poll(() => editorText(content)).toBe('<nodel-button></nodel-button>');
  });

  test('completes single-quoted values', async ({ page }) => {
    const content = await openCompletionEditor(page, "<nodel-toggle value='o");
    await chooseCompletion(await openCompletions(page), 'off');
    await expect.poll(() => editorText(content)).toBe("<nodel-toggle value='off'");
  });

  test('keeps attribute completion available beyond the former lookbehind bound', async ({ page }) => {
    const prefix = [
      '<nodel-button',
      '  aria-description="context" aria-description="context" aria-description="context"',
      '  aria-description="context" aria-description="context" aria-description="context"',
      '  aria-description="context" aria-description="context" aria-description="context"',
      '  aria-description="context" aria-description="context" aria-description="context"'
    ].join('\n') + '\n  ';
    const content = await openCompletionEditor(page, `${prefix}dis`);
    await chooseCompletion(await openCompletions(page), 'disabled');
    await expect.poll(() => editorText(content)).toBe(`${prefix}disabled`);
  });

  test('applies the page scaffold without literal placeholder tokens', async ({ page }) => {
    const content = await openCompletionEditor(page, '');
    await chooseCompletionByKeyboard(page, await openCompletions(page), 'nodel page scaffold', 'nodel page');
    await expect.poll(() => editorText(content)).not.toContain('${}');
    await page.keyboard.type('CURSOR');
    await expect.poll(() => editorText(content)).toMatch(/<nodel-column>\s+CURSOR\s+<\/nodel-column>/);
  });

  test('applies the custom page head without literal placeholder tokens', async ({ page }) => {
    const content = await openCompletionEditor(page, '');
    await chooseCompletionByKeyboard(page, await openCompletions(page), 'nodel custom page head', 'nodel custom');
    await expect.poll(() => editorText(content)).not.toContain('${}');
    await expect.poll(() => editorText(content)).toContain('<!doctype html>');
    await expect.poll(() => editorText(content)).toContain('<nodel-toolbar>');
    await expect.poll(() => editorText(content)).toContain('<nodel-row>');
  });

  test('offers contract phases, signal targets, aggregations, curated classes, and page fragments', async ({ page }) => {
    await openCompletionEditor(page, '<nodel-page nav-id="main"></nodel-page><nodel-button actions="Run:');
    await expect((await openCompletions(page)).filter({ hasText: 'press' }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('<nodel-button signals="Power:active(');
    await expect((await openCompletions(page)).filter({ hasText: 'any' }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('<div class="nodel-');
    const classes = await openCompletions(page);
    await expect(classes.filter({ hasText: 'nodel-button' }).first()).toBeVisible();
    await expect(classes.filter({ hasText: /^flex$/ }).first()).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('<nodel-page nav-id="main"></nodel-page><nodel-link href="#');
    await expect((await openCompletions(page)).filter({ hasText: 'main' }).first()).toBeVisible();
  });

  test('uses XML schema completion with Nodel binding hints', async ({ page }) => {
    const content = await openCompletionEditor(page, '<nodel-button signals="Power:a', 'panel.xml');
    await chooseCompletion(await openCompletions(page), 'active');
    await expect.poll(() => editorText(content)).toBe('<nodel-button signals="Power:active');
  });

  test('shows bounded non-blocking diagnostics and keeps completion UI accessible', async ({ page }, testInfo) => {
    const content = await openCompletionEditor(page, '<nodel-button variant="invalid"></nodel-button>');
    const initialTheme = testInfo.project.name === 'chromium-light-desktop' ? 'light' : 'dark';
    const app = page.locator('nodel-app');
    await expect(page.locator('html')).toHaveAttribute('data-theme', initialTheme);
    const diagnosticStatus = page.locator('#stage-2-completion-fixture [data-editor-diagnostic-status]');
    await expect(diagnosticStatus).toContainText('1 error');
    const diagnosticRange = page.locator('#stage-2-completion-fixture .cm-lintRange-error');
    await expect(diagnosticRange).toHaveCount(1);
    await diagnosticRange.hover();
    const lintTooltip = page.locator('#stage-2-completion-fixture .cm-tooltip-lint');
    await expect(lintTooltip).toBeVisible();
    await expect(lintTooltip).toContainText('Enum value is not supported.');
    const tooltipColorsBeforeThemeSwitch = await tooltipColors(lintTooltip);
    expect(tooltipColorsBeforeThemeSwitch.actualForeground).toBe(tooltipColorsBeforeThemeSwitch.expectedForeground);
    expect(tooltipColorsBeforeThemeSwitch.actualBackground).toBe(tooltipColorsBeforeThemeSwitch.expectedBackground);
    expect(tooltipColorsBeforeThemeSwitch.actualBorder).toBe(tooltipColorsBeforeThemeSwitch.expectedBorder);
    await expectCompletionA11y(page, testInfo.project.name);
    const oppositeTheme = initialTheme === 'light' ? 'dark' : 'light';
    await app.evaluate((element, theme) => element.setAttribute('theme', theme), oppositeTheme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', oppositeTheme);
    await expect(lintTooltip).toBeVisible();
    const tooltipColorsAfterThemeSwitch = await tooltipColors(lintTooltip);
    expect(tooltipColorsAfterThemeSwitch.actualForeground).toBe(tooltipColorsAfterThemeSwitch.expectedForeground);
    expect(tooltipColorsAfterThemeSwitch.actualBackground).toBe(tooltipColorsAfterThemeSwitch.expectedBackground);
    expect(tooltipColorsAfterThemeSwitch.actualBorder).toBe(tooltipColorsAfterThemeSwitch.expectedBorder);
    expect(tooltipColorsAfterThemeSwitch.actualForeground).not.toBe(tooltipColorsBeforeThemeSwitch.actualForeground);
    expect(tooltipColorsAfterThemeSwitch.actualBackground).not.toBe(tooltipColorsBeforeThemeSwitch.actualBackground);
    expect(tooltipColorsAfterThemeSwitch.actualBorder).not.toBe(tooltipColorsBeforeThemeSwitch.actualBorder);
    await app.evaluate((element, theme) => element.setAttribute('theme', theme), initialTheme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', initialTheme);
    await content.press('End');
    await content.pressSequentially(' ');
    await expect(page.locator('#stage-2-completion-fixture [data-editor-save]')).toBeEnabled();
    await content.press('Control+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
    await expectCompletionA11y(page, testInfo.project.name);
  });

  test('supports the Free profile-aware icon catalogue in HTML', async ({ page }) => {
    const content = await openCompletionEditor(page, '<nodel-icon name="televis');
    let options = await openCompletions(page);
    await expect(options.filter({ hasText: 'tv · classic solid' }).first()).toBeVisible();
    await expect(options.filter({ hasText: /duotone/i })).toHaveCount(0);

    await content.press('Control+A');
    await content.pressSequentially('<nodel-icon name="address-book" family="classic" style="');
    options = await openCompletions(page);
    await expect(options.filter({ hasText: 'regular' }).first()).toBeVisible();

    await page.keyboard.press('Escape');
    await content.press('Control+A');
    await content.pressSequentially('<nodel-icon name="power');
    options = await openCompletions(page);
    await expect(options.filter({ hasText: 'power' }).first()).toBeVisible();

  });

  test('applies an official Font Awesome alias as its canonical icon name', async ({ page }) => {
    const content = await openCompletionEditor(page, '<nodel-icon family="brands" name="innosoft');
    await chooseCompletion(await openCompletions(page), '42-group');
    await expect.poll(() => editorText(content)).toContain('name="42-group');
  });

  test('completes nodel-icon signal targets in HTML', async ({ page }) => {
    await openCompletionEditor(page, '<nodel-icon signals="Source:');
    const options = await openCompletions(page);
    await expect(options.filter({ hasText: 'name' }).first()).toBeVisible();
    await expect(options.filter({ hasText: 'family' }).first()).toBeVisible();
    await expect(options.filter({ hasText: 'style' }).first()).toBeVisible();
  });

  test('completes icon families and reports invalid HTML icon combinations', async ({ page }) => {
    await openCompletionEditor(page, '<nodel-icon name="github" family="');
    const options = await openCompletions(page);
    await expect(options.filter({ hasText: 'brands' }).first()).toBeVisible();
    await expect(options.filter({ hasText: /duotone/i })).toHaveCount(0);

    const brandContent = await openCompletionEditor(page, '<nodel-icon family="brands" name="gith');
    const brandOptions = await openCompletions(page);
    await expect(brandOptions.filter({ hasText: 'github' }).first()).toBeVisible();
    await chooseCompletion(brandOptions, 'github');
    await expect.poll(() => editorText(brandContent)).toContain('family="brands"');
    await expect.poll(() => editorText(brandContent)).toContain('name="github');
  });

  test('reports invalid HTML icon names and combinations', async ({ page }) => {
    await openCompletionEditor(page, '<nodel-icon name="not-a-public-icon" family="brands" style="solid" />');
    const diagnosticStatus = page.locator('#stage-2-completion-fixture [data-editor-diagnostic-status]');
    await expect(diagnosticStatus).toContainText('error');
    await expect(page.locator('#stage-2-completion-fixture .cm-lintRange-error')).toHaveCount(2);
  });

  test('supports the Free profile-aware icon catalogue in XML with invalid diagnostics', async ({ page }) => {
    const content = await openCompletionEditor(page, '<nodel-icon family="brands" name="', 'panel.xml');
    let options = await openCompletions(page);
    await expect(options.filter({ hasText: 'github' }).first()).toBeVisible();

    await page.keyboard.press('Escape');
    await content.press('Control+A');
    await content.pressSequentially('<nodel-icon name="address-book" family="classic" style="');
    options = await openCompletions(page);
    await expect(options.filter({ hasText: 'regular' }).first()).toBeVisible();

    await page.keyboard.press('Escape');
    await content.press('Control+A');
    await content.pressSequentially('<nodel-icon name="missing" family="brands" style="solid" />');
    const diagnosticStatus = page.locator('#stage-2-completion-fixture [data-editor-diagnostic-status]');
    await expect(diagnosticStatus).toContainText('error');
    await expect(page.locator('#stage-2-completion-fixture .cm-lintRange-error').first()).toBeVisible();
  });

  test('completes XML tv, Nodel aliases, families, signals, and excludes Pro-only options', async ({ page }) => {
    await openCompletionEditor(page, '<nodel-icon name="televis', 'panel.xml');
    let options = await openCompletions(page);
    await expect(options.filter({ hasText: 'tv · classic solid' }).first()).toBeVisible();
    await expect(options.filter({ hasText: /duotone/i })).toHaveCount(0);

    await openCompletionEditor(page, '<nodel-icon name="power', 'panel.xml');
    options = await openCompletions(page);
    await expect(options.filter({ hasText: 'power' }).first()).toBeVisible();

    await openCompletionEditor(page, '<nodel-icon name="github" family="', 'panel.xml');
    options = await openCompletions(page);
    await expect(options.filter({ hasText: 'brands' }).first()).toBeVisible();

    await openCompletionEditor(page, '<nodel-icon signals="Source:', 'panel.xml');
    options = await openCompletions(page);
    await expect(options.filter({ hasText: 'name' }).first()).toBeVisible();
    await expect(options.filter({ hasText: 'family' }).first()).toBeVisible();
    await expect(options.filter({ hasText: 'style' }).first()).toBeVisible();
  });

  test('applies an official XML Font Awesome alias canonically', async ({ page }) => {
    const content = await openCompletionEditor(page, '<nodel-icon family="brands" name="innosoft', 'panel.xml');
    await chooseCompletion(await openCompletions(page), '42-group');
    await expect.poll(() => editorText(content)).toContain('name="42-group');
  });

  test('reports invalid XML icon names and combinations', async ({ page }) => {
    await openCompletionEditor(page, '<nodel-icon name="not-a-public-icon" family="brands" style="solid" />', 'panel.xml');
    const diagnosticStatus = page.locator('#stage-2-completion-fixture [data-editor-diagnostic-status]');
    await expect(diagnosticStatus).toContainText('error');
    await expect(page.locator('#stage-2-completion-fixture .cm-lintRange-error')).toHaveCount(2);
  });
});
