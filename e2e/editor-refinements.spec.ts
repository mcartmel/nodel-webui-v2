import { AxeBuilder } from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

async function openEditorFixture(page: Page, defaultFile: string, fixture: EditorFixture, beforeMount?: () => Promise<void>, importFailure = false) {
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
  await beforeMount?.();
  await page.evaluate((path) => {
    const fixtureNode = document.createElement('section');
    fixtureNode.id = 'stage-8-editor-fixture';
    fixtureNode.className = 'nodel-card p-4';
    fixtureNode.innerHTML = `<nodel-editor default-file="${path}"></nodel-editor>`;
    document.querySelector('nodel-page[active]')?.append(fixtureNode);
  }, defaultFile);
  const editor = page.locator('#stage-8-editor-fixture nodel-editor');
  await expect(editor.locator(importFailure ? '[data-editor-retry-import]' : '.cm-editor')).toBeVisible();
  if (!importFailure) await expect(editor.locator('[data-editor-file-picker] option:checked')).toContainText(defaultFile);
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

function expectControlRows(
  controls: Array<{ name?: string | undefined; x?: number; y?: number; width?: number; height?: number }>,
  container: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  description: string
) {
  const positioned = controls.map((control) => ({
    name: control.name ?? description,
    x: control.x!,
    y: control.y!,
    right: control.x! + control.width!,
    bottom: control.y! + control.height!,
    width: control.width!,
    height: control.height!
  }));
  for (const control of positioned) {
    expect(control.x, `${description} ${control.name} container left`).toBeGreaterThanOrEqual(container.x - 1);
    expect(control.right, `${description} ${control.name} container right`).toBeLessThanOrEqual(container.x + container.width + 1);
    expect(control.y, `${description} ${control.name} container top`).toBeGreaterThanOrEqual(container.y - 1);
    expect(control.bottom, `${description} ${control.name} container bottom`).toBeLessThanOrEqual(container.y + container.height + 1);
    expect(control.x, `${description} ${control.name} viewport left`).toBeGreaterThanOrEqual(-1);
    expect(control.right, `${description} ${control.name} viewport right`).toBeLessThanOrEqual(viewport.width + 1);
    expect(control.y, `${description} ${control.name} viewport top`).toBeGreaterThanOrEqual(-1);
    expect(control.bottom, `${description} ${control.name} viewport bottom`).toBeLessThanOrEqual(viewport.height + 1);
  }

  const rows: typeof positioned[] = [];
  for (const control of [...positioned].sort((first, second) => first.y - second.y)) {
    const row = rows.find((candidate) => Math.abs(candidate[0]!.y - control.y) <= 1);
    if (row) row.push(control);
    else rows.push([control]);
  }
  for (const [rowIndex, row] of rows.entries()) {
    const first = row[0]!;
    for (const control of row.slice(1)) {
      expect(Math.abs(control.y - first.y), `${description} row ${rowIndex} top alignment`).toBeLessThanOrEqual(1);
      expect(Math.abs(control.bottom - first.bottom), `${description} row ${rowIndex} bottom alignment`).toBeLessThanOrEqual(1);
    }
    const ordered = [...row].sort((left, right) => left.x - right.x);
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index - 1]!.right, `${description} row ${rowIndex} controls do not overlap: ${JSON.stringify([ordered[index - 1], ordered[index]])}`).toBeLessThanOrEqual(ordered[index]!.x + 1);
    }
  }
  for (let first = 0; first < positioned.length; first += 1) {
    for (const second of positioned.slice(first + 1)) {
      const a = positioned[first]!;
      const overlapsX = a.x < second.right && second.x < a.right;
      const overlapsY = a.y < second.bottom && second.y < a.bottom;
      expect(overlapsX && overlapsY, `${description} ${a.name} does not overlap ${second.name}`).toBe(false);
    }
  }
}

test.describe('editor refinements', () => {
  test('host density sizes editor-owned chrome without changing CodeMirror', async ({ page }, testInfo) => {
    const fixture: EditorFixture = {
      files: [{ path: 'script.py' }],
      contents: new Map([['script.py', 'print("hello")']]),
      saves: []
    };
    const editor = await openEditorFixture(page, 'script.py', fixture);
    await editor.scrollIntoViewIfNeeded();
    const picker = editor.locator('[data-editor-file-picker]');
    const toolbarControls = [
      picker,
      editor.locator('[data-editor-refresh]'),
      editor.locator('[data-editor-toggle-add]'),
      editor.locator('.nodel-editor-toolbar > label:has([data-editor-upload])'),
      editor.locator('[data-editor-default]'),
      editor.locator('[data-editor-save]'),
      editor.locator('[data-editor-delete]')
    ];
    const fileInput = editor.locator('[data-editor-upload]');
    const cmEditor = editor.locator('.cm-editor');
    const cmContent = editor.locator('.cm-content');
    await cmContent.click();
    await page.keyboard.press('Control+f');
    const searchPanel = cmEditor.locator('.cm-search');
    await expect(searchPanel).toBeVisible();
    const searchPanelGeometry = await searchPanel.locator('input, button').evaluateAll((controls) => controls.map((control) => {
      const box = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      return { width: box.width, height: box.height, fontSize: style.fontSize, lineHeight: style.lineHeight };
    }));
    const originalCodeMirror = await cmEditor.evaluate((element) => ({
      fontSize: getComputedStyle(element).fontSize,
      lineHeight: getComputedStyle(element).lineHeight,
      height: element.getBoundingClientRect().height
    }));
    const geometry: Record<string, unknown> = { codeMirror: originalCodeMirror, modes: {} };

    for (const [mode, className, expected] of [['default', '', 36], ['compact', 'nodel-controls-compact', 36], ['touch', 'nodel-controls-touch', 56]] as const) {
      await editor.evaluate((element, value) => {
        element.classList.remove('nodel-controls-compact', 'nodel-controls-touch');
        if (value) element.classList.add(value);
      }, className);
      const toolbar = await Promise.all(toolbarControls.map(async (control) => {
        const box = await control.boundingBox();
        expect(box!.height, `${mode} ${await control.getAttribute('aria-label') ?? await control.textContent()}`).toBeCloseTo(expected, 0);
        return { name: await control.getAttribute('aria-label') ?? (await control.textContent())?.trim(), ...box };
      }));
      expectControlRows(toolbar, (await editor.locator('.nodel-editor-toolbar').boundingBox())!, page.viewportSize()!, `${mode} editor toolbar`);
      await expect(fileInput).toBeAttached();
      await expect(fileInput).toHaveClass(/\bsr-only\b/);
      expect(await fileInput.evaluate((input) => ({
        position: getComputedStyle(input).position,
        clip: getComputedStyle(input).clip,
        width: input.getBoundingClientRect().width,
        height: input.getBoundingClientRect().height
      }))).toMatchObject({ position: 'absolute', clip: 'rect(0px, 0px, 0px, 0px)', width: 1, height: 1 });
      (geometry.modes as Record<string, unknown>)[mode] = { toolbar, fileInputClass: await fileInput.getAttribute('class') };
      expect(await cmEditor.evaluate((element) => ({
        fontSize: getComputedStyle(element).fontSize,
        lineHeight: getComputedStyle(element).lineHeight,
        height: element.getBoundingClientRect().height
      }))).toEqual(originalCodeMirror);
      expect(await searchPanel.locator('input, button').evaluateAll((controls) => controls.map((control) => {
        const box = control.getBoundingClientRect();
        const style = getComputedStyle(control);
        return { width: box.width, height: box.height, fontSize: style.fontSize, lineHeight: style.lineHeight };
      }))).toEqual(searchPanelGeometry);
    }

    await page.keyboard.press('Escape');
    await expect(searchPanel).toBeHidden();
    const originalViewport = page.viewportSize()!;
    await page.setViewportSize({ width: 320, height: originalViewport.height });
    await editor.scrollIntoViewIfNeeded();
    const narrowToolbar = await Promise.all(toolbarControls.map(async (control) => {
      const box = await control.boundingBox();
      expect(box!.height, `320px touch ${await control.getAttribute('aria-label') ?? await control.textContent()}`).toBeCloseTo(56, 0);
      return { name: await control.getAttribute('aria-label') ?? (await control.textContent())?.trim(), ...box };
    }));
    expectControlRows(narrowToolbar, (await editor.locator('.nodel-editor-toolbar').boundingBox())!, page.viewportSize()!, '320px touch editor toolbar');
    geometry.narrow320TouchToolbar = narrowToolbar;
    await page.setViewportSize(originalViewport);
    await editor.scrollIntoViewIfNeeded();
    await editor.evaluate((element) => element.classList.remove('nodel-controls-touch'));
    await cmContent.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' # draft');
    const draft = await cmContent.textContent();
    const selection = await page.evaluate(() => {
      const range = getSelection();
      return { text: range?.anchorNode?.textContent, anchor: range?.anchorOffset, focus: range?.focusOffset };
    });
    await editor.evaluate((element) => element.classList.add('nodel-controls-touch'));
    await expect(cmContent).toContainText('# draft');
    expect(await cmContent.textContent()).toBe(draft);
    await expect(cmContent).toBeFocused();
    expect(await page.evaluate(() => {
      const range = getSelection();
      return { text: range?.anchorNode?.textContent, anchor: range?.anchorOffset, focus: range?.focusOffset };
    })).toEqual(selection);
    expect(fixture.saves).toEqual([]);

    await editor.locator('[data-editor-toggle-add]').click();
    const path = editor.locator('[data-editor-add-path]');
    const create = editor.locator('[data-editor-create-empty]');
    const cancel = editor.locator('[data-editor-cancel-add]');
    const addTouch = await Promise.all([path, create, cancel].map(async (control) => {
      const box = await control.boundingBox();
      expect(box!.height).toBeCloseTo(56, 0);
      return { name: await control.getAttribute('data-editor-add-path') !== null ? 'path' : (await control.textContent())?.trim(), ...box };
    }));
    expectControlRows(addTouch, (await editor.locator('.nodel-editor-add').boundingBox())!, page.viewportSize()!, 'touch editor add form');
    await editor.evaluate((element) => element.classList.replace('nodel-controls-touch', 'nodel-controls-compact'));
    const addCompact = await Promise.all([path, create, cancel].map(async (control) => {
      const box = await control.boundingBox();
      expect(box!.height).toBeCloseTo(36, 0);
      return { name: await control.getAttribute('data-editor-add-path') !== null ? 'path' : (await control.textContent())?.trim(), ...box };
    }));
    expectControlRows(addCompact, (await editor.locator('.nodel-editor-add').boundingBox())!, page.viewportSize()!, 'compact editor add form');
    geometry.addForm = { touch: addTouch, compact: addCompact };
    await expect(path).toHaveValue('');
    expect(fixture.saves).toEqual([]);
    const evidenceDirectory = resolve(process.cwd(), 'build/admin-density/editor-extension/implementation', testInfo.project.name);
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(resolve(evidenceDirectory, 'geometry.json'), `${JSON.stringify(geometry, null, 2)}\n`);
  });

  test('failed editor import keeps Retry density-scoped in both modes', async ({ page }, testInfo) => {
    const fixture: EditorFixture = {
      files: [{ path: 'script.py' }],
      contents: new Map([['script.py', 'print("hello")']]),
      saves: []
    };
    let shouldFailImport = true;
    const editor = await openEditorFixture(page, 'script.py', fixture, async () => {
      await page.route('**/chunks/codemirror-editor-*.js', async (route) => {
        if (shouldFailImport) {
          shouldFailImport = false;
          await route.abort();
          return;
        }
        await route.continue();
      });
    }, true);
    const retry = editor.locator('[data-editor-retry-import]');
    await expect(retry).toBeVisible();
    expect(await retry.getAttribute('class')).toContain('nodel-editor-control');
    const compactHeight = (await retry.boundingBox())!.height;
    expect(compactHeight).toBeCloseTo(36, 0);
    await editor.evaluate((element) => element.classList.add('nodel-controls-touch'));
    const touchHeight = (await retry.boundingBox())!.height;
    expect(touchHeight).toBeCloseTo(56, 0);

    const evidenceDirectory = resolve(process.cwd(), 'build/admin-density/editor-extension/implementation', testInfo.project.name);
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(resolve(evidenceDirectory, 'retry-import.json'), `${JSON.stringify({ retryCompactHeight: compactHeight, retryTouchHeight: touchHeight, visibleImportError: (await editor.locator('.nodel-editor-status').textContent())?.trim() }, null, 2)}\n`);
  });

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
