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

test.describe('Stage 2 CodeMirror completion regressions', () => {
  test.beforeEach(({}, testInfo) => {
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
    const diagnosticStatus = page.locator('#stage-2-completion-fixture [data-editor-diagnostic-status]');
    await expect(diagnosticStatus).toContainText('1 error');
    await expect(page.locator('#stage-2-completion-fixture .cm-lintRange-error')).toHaveCount(1);
    await content.press('End');
    await content.pressSequentially(' ');
    await expect(page.locator('#stage-2-completion-fixture [data-editor-save]')).toBeEnabled();
    await content.press('Control+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
    // CodeMirror keeps keyboard focus on the editor and controls its listbox
    // through aria-activedescendant, which this Safari-oriented rule cannot infer.
    const results = await new AxeBuilder({ page }).include('#stage-2-completion-fixture').disableRules(['scrollable-region-focusable']).analyze();
    expect(results.violations, testInfo.project.name).toEqual([]);
  });
});
