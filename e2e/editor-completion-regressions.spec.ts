import { expect, test, type Locator, type Page } from '@playwright/test';

async function openCompletionEditor(page: Page, text: string) {
  await page.route('**/REST/files', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ path: 'panel.html' }])
  }));
  await page.route('**/REST/files/contents?*', (route) => route.fulfill({ contentType: 'text/plain', body: text }));
  await page.goto('/components.html#Buttons', { waitUntil: 'domcontentloaded' });
  await page.locator('nodel-page[data-page-id="Buttons"][active]').waitFor();
  await page.evaluate(() => {
    const host = document.createElement('section');
    host.id = 'stage-2-completion-fixture';
    host.innerHTML = '<nodel-editor default-file="panel.html"></nodel-editor>';
    document.querySelector('nodel-page[active]')?.append(host);
  });
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
  await option.click();
}

async function editorText(content: Locator) {
  return (await content.locator('.cm-line').allTextContents()).join('\n');
}

// Stage 0 preserves these known-red acceptance cases without breaking a
// deployable baseline. Stage 2 removes the skip as it replaces the adapter.
test.describe.skip('Stage 2 CodeMirror completion regressions', () => {
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
    await chooseCompletion(await openCompletions(page), 'nodel-button');
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
    await expect.poll(() => editorText(content)).toBe('<nodel-toggle value="off');
  });

  test('completes a partial closing tag', async ({ page }) => {
    const content = await openCompletionEditor(page, '<nodel-button></nodel-b');
    await chooseCompletion(await openCompletions(page), 'nodel-button');
    await expect.poll(() => editorText(content)).toBe('<nodel-button></nodel-button');
  });

  test('completes single-quoted values', async ({ page }) => {
    const content = await openCompletionEditor(page, "<nodel-toggle value='o");
    await chooseCompletion(await openCompletions(page), 'off');
    await expect.poll(() => editorText(content)).toBe("<nodel-toggle value='off");
  });

  test('keeps attribute completion available beyond the former lookbehind bound', async ({ page }) => {
    const prefix = `<nodel-button ${'aria-description="context" '.repeat(8)}`;
    const content = await openCompletionEditor(page, `${prefix}dis`);
    await chooseCompletion(await openCompletions(page), 'disabled');
    await expect.poll(() => editorText(content)).toBe(`${prefix}disabled=""`);
  });

  test('applies the page scaffold without literal placeholder tokens', async ({ page }) => {
    const content = await openCompletionEditor(page, '');
    await chooseCompletion(await openCompletions(page), 'nodel page scaffold');
    await expect.poll(() => editorText(content)).not.toContain('${}');
  });

  test('applies the custom page head without literal placeholder tokens', async ({ page }) => {
    const content = await openCompletionEditor(page, '');
    await chooseCompletion(await openCompletions(page), 'nodel custom page head');
    await expect.poll(() => editorText(content)).not.toContain('${}');
  });
});
