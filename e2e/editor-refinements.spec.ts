import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

type EditorFixture = {
  files: Array<{ path: string }>;
  contents: Map<string, string>;
  saves: Array<{ body: Buffer | null; path: string }>;
};

function isDesktopThemeProject(testInfo: TestInfo) {
  return testInfo.project.name === 'chromium-light-desktop' || testInfo.project.name === 'chromium-dark-desktop';
}

async function selectEditorFileByVisibleLabel(picker: Locator, path: string) {
  const option = picker.locator('option').filter({ hasText: path }).first();
  await picker.selectOption({ label: await option.textContent() ?? path });
}

async function openEditorFixture(page: Page, defaultFile: string, fixture: EditorFixture) {
  await page.route('**/REST/files', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(fixture.files)
  }));
  await page.route('**/REST/files/contents?*', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') ?? '';
    return route.fulfill({ contentType: 'text/plain', body: fixture.contents.get(path) ?? '' });
  });
  await page.route('**/REST/files/save?*', async (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') ?? '';
    const body = route.request().postDataBuffer();
    fixture.saves.push({ body, path });
    if (!fixture.files.some((file) => file.path === path)) {
      fixture.files.push({ path });
    }
    fixture.contents.set(path, body?.toString() ?? '');
    await route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await page.goto('/components.html#Buttons', { waitUntil: 'domcontentloaded' });
  await page.locator('nodel-page[data-page-id="Buttons"][active]').waitFor();
  await page.evaluate((path) => {
    const fixtureNode = document.createElement('section');
    fixtureNode.id = 'stage-8-editor-fixture';
    fixtureNode.className = 'nodel-card p-4';
    fixtureNode.innerHTML = `<nodel-editor default-file="${path}"></nodel-editor>`;
    document.querySelector('nodel-page[active]')?.append(fixtureNode);
  }, defaultFile);
  const editor = page.locator('#stage-8-editor-fixture nodel-editor');
  await expect(editor.locator('.cm-editor')).toBeVisible();
  await expect(editor.locator('[data-editor-file-picker] option:checked')).toContainText(defaultFile);
  await expect(editor.locator('[data-editor-reload-status]')).toBeHidden();
  return editor;
}

async function dispatchFileDrag(page: Page, type: 'dragenter' | 'dragleave' | 'drop', files: Array<{ content: string; name: string; type: string }>) {
  return page.locator('#stage-8-editor-fixture nodel-editor').evaluate((element, payload) => {
    const transfer = new DataTransfer();
    for (const file of payload.files) {
      transfer.items.add(new File([file.content], file.name, { type: file.type }));
    }
    const event = new DragEvent(payload.type, { bubbles: true, cancelable: true, dataTransfer: transfer });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, { files, type });
}

test.describe('editor refinements', () => {
  test('stages one dropped file with a visible target and editable path', async ({ page }, testInfo) => {
    const fixture: EditorFixture = {
      files: [{ path: 'script.py' }],
      contents: new Map([['script.py', 'print("hello")']]),
      saves: []
    };
    const editor = await openEditorFixture(page, 'script.py', fixture);
    const file = [{ content: '<nodel-app></nodel-app>', name: 'panel.html', type: 'text/html' }];
    expect(await dispatchFileDrag(page, 'dragenter', file)).toBe(true);
    await expect(editor.locator('[data-editor-drop-target]')).toBeVisible();
    const screenshotOptions = { maxDiffPixels: testInfo.project.name === 'chromium-forced-colors' ? 1500 : 150 };
    await expect(editor.locator('.nodel-editor-body')).toHaveScreenshot('editor-drop-target.png', screenshotOptions);

    await page.keyboard.press('Escape');
    await expect(editor.locator('[data-editor-drop-target]')).toBeHidden();
    expect(await dispatchFileDrag(page, 'dragenter', file)).toBe(true);

    expect(await dispatchFileDrag(page, 'drop', file)).toBe(true);
    await expect(editor.locator('[data-editor-drop-target]')).toBeHidden();
    await expect(editor.locator('[data-editor-add-path]')).toHaveValue('panel.html');
    await expect(editor.locator('[data-editor-create-empty]')).toHaveText('Upload');
    expect(fixture.saves).toEqual([]);
    await editor.locator('[data-editor-add-path]').fill('content/panel.html');

    if (isDesktopThemeProject(testInfo)) {
      const results = await new AxeBuilder({ page }).include('#stage-8-editor-fixture').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(results.violations).toEqual([]);
    }

    await editor.locator('[data-editor-create-empty]').click();
    await expect.poll(() => fixture.saves.map((save) => save.path)).toContain('content/panel.html');
    const firstSave = fixture.saves[0];
    expect(firstSave?.body?.toString()).toBe('<nodel-app></nodel-app>');
    await expect(editor.locator('[data-editor-file-picker] option:checked')).toHaveText('content/panel.html');
    await expect(editor.locator('.cm-content')).toContainText('<nodel-app></nodel-app>');

    const nativeUpload = { buffer: Buffer.from('native'), mimeType: 'text/plain', name: 'native.txt' };
    await editor.locator('[data-editor-upload]').setInputFiles(nativeUpload);
    await expect(editor.locator('[data-editor-add-path]')).toHaveValue('native.txt');
    await expect.poll(() => editor.locator('[data-editor-upload]').evaluate((input) => (input as HTMLInputElement).files?.length ?? -1)).toBe(0);
    await editor.locator('[data-editor-cancel-add]').click();
    await editor.locator('[data-editor-upload]').setInputFiles(nativeUpload);
    await expect(editor.locator('[data-editor-add-path]')).toHaveValue('native.txt');
    await expect.poll(() => editor.locator('[data-editor-upload]').evaluate((input) => (input as HTMLInputElement).files?.length ?? -1)).toBe(0);
    await editor.locator('[data-editor-cancel-add]').click();

    const multiple = [
      { content: 'a', name: 'a.txt', type: 'text/plain' },
      { content: 'b', name: 'b.txt', type: 'text/plain' }
    ];
    expect(await dispatchFileDrag(page, 'drop', multiple)).toBe(true);
    await expect(editor.locator('.nodel-editor-status')).toContainText('Drop one file at a time.');
    expect(fixture.saves).toHaveLength(1);
  });

  test('loads retained syntax modes only when matching files are selected', async ({ page }) => {
    const fixture: EditorFixture = {
      files: [
        { path: 'Example.java' },
        { path: 'build.groovy' },
        { path: 'query.sql' },
        { path: 'deploy.sh' },
        { path: 'settings.yaml' }
      ],
      contents: new Map([
        ['Example.java', 'public class Example { private int value = 1; }'],
        ['build.groovy', 'def value = true\nprintln value'],
        ['query.sql', 'SELECT name FROM devices WHERE active = true;'],
        ['deploy.sh', '#!/bin/sh\nif true; then echo "ready"; fi'],
        ['settings.yaml', 'value: true']
      ]),
      saves: []
    };
    const scripts: string[] = [];
    page.on('response', (response) => {
      if (response.request().resourceType() === 'script') {
        scripts.push(response.url());
      }
    });
    const editor = await openEditorFixture(page, 'settings.yaml', fixture);
    await expect(editor.locator('.cm-content')).not.toHaveAttribute('data-language');
    expect(scripts.some((url) => /groovy-.*\.js/.test(url))).toBe(false);
    expect(scripts.some((url) => /shell-.*\.js/.test(url))).toBe(false);
    const initialLanguageChunks = scripts.filter((url) => /\/chunks\/index-.*\.js/.test(url)).length;

    await selectEditorFileByVisibleLabel(editor.locator('[data-editor-file-picker]'), 'Example.java');
    await expect(editor.locator('.cm-content')).toHaveAttribute('data-language', 'java');
    await expect.poll(() => scripts.filter((url) => /\/chunks\/index-.*\.js/.test(url)).length).toBeGreaterThan(initialLanguageChunks);
    const beforeSqlChunks = scripts.filter((url) => /\/chunks\/index-.*\.js/.test(url)).length;

    for (const path of ['build.groovy', 'query.sql', 'deploy.sh']) {
      await selectEditorFileByVisibleLabel(editor.locator('[data-editor-file-picker]'), path);
      await expect.poll(() => editor.locator('.cm-line').allTextContents()).toEqual(fixture.contents.get(path)!.split('\n'));
      await expect(editor.locator('.cm-content')).toHaveAttribute('data-language', path === 'build.groovy' ? 'groovy' : path === 'query.sql' ? 'sql' : 'shell');
      if (path === 'query.sql') {
        await expect.poll(() => scripts.filter((url) => /\/chunks\/index-.*\.js/.test(url)).length).toBeGreaterThan(beforeSqlChunks);
      }
    }
    expect(scripts.some((url) => /groovy-.*\.js/.test(url))).toBe(true);
    expect(scripts.some((url) => /shell-.*\.js/.test(url))).toBe(true);

    await selectEditorFileByVisibleLabel(editor.locator('[data-editor-file-picker]'), 'settings.yaml');
    await expect(editor.locator('.cm-content')).toContainText('value: true');
    await expect(editor.locator('.cm-content')).not.toHaveAttribute('data-language');
  });
});
