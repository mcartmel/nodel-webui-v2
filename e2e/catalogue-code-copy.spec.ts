import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

type CopyCapture = {
  writes: string[];
  fallback: string[];
  modernReject: boolean;
  fallbackResult: boolean;
  defer: boolean;
  settlers: Array<(success: boolean) => void>;
};

async function installClipboardCapture(page: Page) {
  await page.addInitScript(() => {
    const capture: CopyCapture = { writes: [], fallback: [], modernReject: false, fallbackResult: false, defer: false, settlers: [] };
    (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture = capture;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (value: string) => {
          capture.writes.push(value);
          if (capture.defer) return new Promise<void>((resolve, reject) => {
            capture.settlers.push((success) => success ? resolve() : reject(new Error('deferred clipboard rejection')));
          });
          return capture.modernReject ? Promise.reject(new Error('modern clipboard rejected')) : Promise.resolve();
        }
      }
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: (command: string) => {
        if (command !== 'copy') return false;
        const active = document.activeElement;
        capture.fallback.push(active instanceof HTMLTextAreaElement ? active.value : '');
        return capture.fallbackResult;
      }
    });
  });
}

async function openCatalogue(page: Page, pageId = 'Quickstart') {
  await page.goto(`/components.html#${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`nodel-page[data-page-id="${pageId}"][active]`).waitFor();
}

async function capture(page: Page) {
  return page.evaluate(() => (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture);
}

function copyButton(pre: ReturnType<Page['locator']>) {
  return pre.locator('xpath=preceding-sibling::*[1]').getByRole('button', { name: /^Copy code/ });
}

function copyStatus(pre: ReturnType<Page['locator']>) {
  return pre.locator('xpath=preceding-sibling::*[1]').locator('[data-catalogue-copy-status]');
}

async function saveCapture(region: Locator, testInfo: TestInfo, name: string) {
  const artifact = testInfo.outputPath(name);
  await region.screenshot({ path: artifact });
  await region.screenshot({ path: `build/catalogue-copy/final-review-fixes/${testInfo.project.name}-${name}` });
  await testInfo.attach(name, { path: artifact, contentType: 'image/png' });
}

test.describe('catalogue code copy', () => {
  test.beforeEach(async ({ page }) => {
    await installClipboardCapture(page);
  });

  test('inventories all authored blocks and excludes preview and reference code', async ({ page }, testInfo) => {
    await openCatalogue(page, 'AppShell');
    await expect.poll(() => page.locator('[data-background-markup] code').evaluateAll((codes) => codes.every((code) => Boolean(code.textContent?.trim())))).toBe(true);
    const inventory = await page.locator('pre.nodel-catalogue-code > code').evaluateAll((codes) => {
      const pres = codes.map((code) => code.parentElement!).filter((pre) => !pre.closest('[data-catalogue-example]'));
      const toolbars = pres.map((pre) => pre.previousElementSibling);
      const controls = toolbars.map((toolbar) => toolbar?.querySelector('button'));
      const statuses = toolbars.map((toolbar) => toolbar?.querySelector('[data-catalogue-copy-status]'));
      return {
        blocks: pres.length,
        toolbars: toolbars.filter((toolbar) => toolbar?.hasAttribute('data-catalogue-copy-toolbar')).length,
        buttons: toolbars.filter((toolbar) => toolbar?.querySelectorAll('button').length === 1).length,
        statuses: toolbars.filter((toolbar) => toolbar?.querySelectorAll('[data-catalogue-copy-status]').length === 1).length,
        uniqueButtons: new Set(controls).size,
        uniqueStatuses: new Set(statuses).size,
        toolbarAbovePre: pres.every((pre) => pre.previousElementSibling?.hasAttribute('data-catalogue-copy-toolbar')),
        meaningfulLabels: controls.every((button) => Boolean(button?.getAttribute('aria-label')?.startsWith('Copy code'))),
        quickstartLabel: document.querySelector('[data-catalogue-quickstart-code]')?.previousElementSibling?.querySelector('button')?.getAttribute('aria-label'),
        backgroundLabels: [...document.querySelectorAll<HTMLElement>('[data-background-markup]')].map((pre) => pre.previousElementSibling?.querySelector('button')?.getAttribute('aria-label')),
        insideExamples: document.querySelectorAll('[data-catalogue-example] [data-catalogue-copy-toolbar]').length,
        referenceCells: document.querySelectorAll('td [data-catalogue-copy-toolbar], th [data-catalogue-copy-toolbar]').length,
        duplicateIds: [...document.querySelectorAll('[id]')].map((element) => element.id).filter((id, index, ids) => ids.indexOf(id) !== index)
      };
    });
    expect(inventory).toEqual({ blocks: 56, toolbars: 56, buttons: 56, statuses: 56, uniqueButtons: 56, uniqueStatuses: 56, toolbarAbovePre: true, meaningfulLabels: true, quickstartLabel: 'Copy code: Quickstart', backgroundLabels: ['Copy code: Backgrounds, App', 'Copy code: Backgrounds, Page override'], insideExamples: 0, referenceCells: 0, duplicateIds: [] });
    await saveCapture(page.locator('nodel-page[data-page-id="AppShell"][active]'), testInfo, 'catalogue-inventory.png');
  });

  test('writes exact displayed text for Quickstart, nested templates, paired, and unpaired blocks', async ({ page }, testInfo) => {
    const cases = [
      { pageId: 'Quickstart', selector: '[data-catalogue-quickstart-code]' },
      { pageId: 'Templates', selector: '[data-catalogue-code-for="templates-shared"]' },
      { pageId: 'Buttons', selector: '[data-catalogue-code-for="buttons-variants"]' },
      { pageId: 'AppShell', selector: 'pre.nodel-catalogue-code:not([data-catalogue-code-for]):has-text("<nodel-shortcut")' }
    ];
    for (const current of cases) {
      await openCatalogue(page, current.pageId);
      const code = page.locator(`${current.selector} code`);
      const expected = await code.textContent();
      await copyButton(page.locator(current.selector)).click();
      await expect.poll(() => capture(page).then((result) => result.writes.at(-1))).toBe(expected);
      await expect(copyStatus(page.locator(current.selector))).toHaveText('Code copied to the clipboard.');
    }
    await openCatalogue(page, 'Templates');
    await saveCapture(page.locator('[data-catalogue-code-for="templates-shared"]').locator('xpath=..'), testInfo, 'catalogue-copy-representatives.png');
  });

  test('keeps both generated Backgrounds snippets independently valid and exact after recovery', async ({ page }, testInfo) => {
    await openCatalogue(page, 'AppShell');
    const section = page.locator('[data-background-catalogue-section]');
    const app = page.locator('[data-background-catalogue="backgrounds"]');
    const appPre = section.locator('[data-background-markup="app"]');
    const pagePre = section.locator('[data-background-markup="page"]');
    await expect(appPre.locator('code')).toContainText('<nodel-app');
    await expect(pagePre.locator('code')).toContainText('<nodel-page');

    const color = app.locator('[data-background-field="color"]');
    await color.fill('rgb(1 2 3 / .5)');
    await expect(color).toHaveAttribute('aria-invalid', 'true');
    await expect(copyButton(appPre)).toBeDisabled();
    await color.fill('#123456');
    await expect(copyButton(appPre)).toBeEnabled();
    const strength = app.locator('#background-strength-number');
    await strength.fill('');
    await expect(copyButton(appPre)).toBeDisabled();
    await strength.fill('40');
    await expect(copyButton(appPre)).toBeEnabled();

    for (const pre of [appPre, pagePre]) {
      const expected = await pre.locator('code').textContent();
      await copyButton(pre).click();
      await expect.poll(() => capture(page).then((result) => result.writes.at(-1))).toBe(expected);
    }
    const markup = await appPre.locator('code').textContent();
    expect(markup).toContain('background-color="rgb(18 52 86)"');
    expect(markup).not.toContain('<script');
    await saveCapture(section, testInfo, 'catalogue-background-copy.png');
  });

  test('supports real Tab keyboard activation, fallback payload/focus restoration, failure feedback, and pending isolation', async ({ page }) => {
    await openCatalogue(page, 'Quickstart');
    const pre = page.locator('[data-catalogue-quickstart-code]');
    const button = copyButton(pre);
    await page.evaluate(() => {
      const pre = document.querySelector<HTMLElement>('[data-catalogue-quickstart-code]');
      const toolbar = pre?.previousElementSibling;
      const anchor = document.createElement('a');
      anchor.href = '#catalogue-copy-tab-anchor';
      anchor.id = 'catalogue-copy-tab-anchor';
      anchor.textContent = 'Before copy';
      toolbar?.before(anchor);
    });
    const anchor = page.locator('#catalogue-copy-tab-anchor');
    await anchor.focus();
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    const focusRing = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      return { focusVisible: element.matches(':focus-visible'), outline: style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0, shadow: style.boxShadow !== 'none' };
    });
    expect(focusRing.focusVisible && (focusRing.outline || focusRing.shadow)).toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(() => capture(page).then((result) => result.writes.length)).toBe(1);
    await anchor.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect.poll(() => capture(page).then((result) => result.writes.length)).toBe(2);
    await page.evaluate(() => {
      const capture = (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
      capture.modernReject = true;
      capture.fallbackResult = true;
    });
    await anchor.focus();
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => capture(page).then((result) => result.fallback.length)).toBe(1);
    expect((await capture(page)).fallback[0]).toBe(await pre.locator('code').textContent());
    await expect(button).toBeFocused();

    await page.evaluate(() => {
      const capture = (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
      capture.fallbackResult = false;
    });
    await anchor.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(copyStatus(pre)).toContainText('Select the code and copy it manually.');

    await page.evaluate(() => {
      const capture = (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
      capture.modernReject = false;
      capture.fallbackResult = false;
      capture.defer = true;
    });
    await page.evaluate(() => {
      const capture = (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
      capture.writes.length = 0;
    });
    await button.click();
    await button.evaluate((element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await expect.poll(() => capture(page).then((result) => result.writes.length)).toBe(1);
    await expect(button).toBeDisabled();
    await page.evaluate(() => (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture.settlers[0]?.(true));
    await expect(button).toBeEnabled();
  });

  test('suppresses old deferred resolve and reject results across replacement and reattachment', async ({ page }) => {
    for (const oldResult of [true, false]) {
      await openCatalogue(page, 'Quickstart');
      const pre = page.locator('[data-catalogue-quickstart-code]');
      const button = copyButton(pre);
      await page.evaluate(() => {
        const capture = (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
        capture.defer = true;
      });
      await button.click();
      const oldStatus = await copyStatus(pre).elementHandle();
      await page.evaluate(() => {
        const pre = document.querySelector<HTMLElement>('[data-catalogue-quickstart-code]')!;
        const code = pre.querySelector('code')!;
        const replacement = code.cloneNode(true);
        const parent = pre.parentElement!;
        (window as unknown as { __catalogueReattach?: { parent: HTMLElement; pre: HTMLElement } }).__catalogueReattach = { parent, pre };
        code.replaceWith(replacement);
        pre.remove();
      });
      await expect(page.locator('[data-catalogue-quickstart-code]')).toHaveCount(0);
      await page.evaluate(() => {
        const reattach = (window as unknown as { __catalogueReattach?: { parent: HTMLElement; pre: HTMLElement } }).__catalogueReattach;
        reattach?.parent.append(reattach.pre);
      });
      await expect.poll(() => page.locator('[data-catalogue-quickstart-code]').evaluate((element) => element.previousElementSibling?.hasAttribute('data-catalogue-copy-toolbar'))).toBe(true);
      await page.evaluate((success) => {
        const capture = (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
        capture.settlers[0]?.(success);
      }, oldResult);
      await expect(copyStatus(page.locator('[data-catalogue-quickstart-code]'))).toHaveText('');
      expect(await oldStatus?.textContent()).toBe('');
      await page.evaluate(() => {
        const capture = (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
        capture.defer = false;
      });
      await page.locator('[data-catalogue-quickstart-code]').locator('xpath=preceding-sibling::*[1]').getByRole('button').click();
      await expect.poll(() => capture(page).then((result) => result.writes.length)).toBeGreaterThan(1);
    }
  });

  test('releases a disabled producer after a deferred copy settles', async ({ page }) => {
    await openCatalogue(page, 'AppShell');
    const pre = page.locator('[data-background-markup="app"]');
    const button = copyButton(pre);
    await page.evaluate(() => (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture.defer = true);
    await button.click();
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-background-markup="app"]')?.toggleAttribute('data-catalogue-copy-disabled', true));
    await page.evaluate(() => (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture.settlers[0]?.(false));
    await expect(button).toBeDisabled();
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-background-markup="app"]')?.removeAttribute('data-catalogue-copy-disabled'));
    await expect(button).toBeEnabled();
    await button.click();
    await expect.poll(() => capture(page).then((result) => result.writes.length)).toBe(2);
  });

  test('does not steal focus from a user after deferred resolve or reject', async ({ page }) => {
    for (const outcome of [true, false]) {
      await openCatalogue(page, 'Quickstart');
      const button = copyButton(page.locator('[data-catalogue-quickstart-code]'));
      await page.evaluate(() => {
        const capture = (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
        capture.defer = true;
      });
      await button.focus();
      await button.click();
      await page.evaluate(() => {
        document.querySelector('#catalogue-copy-user-focus')?.remove();
        const input = document.createElement('input');
        input.id = 'catalogue-copy-user-focus';
        document.body.append(input);
        input.focus();
      });
      await page.evaluate((success) => {
        const capture = (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
        capture.settlers[0]?.(success);
      }, outcome);
      await expect(page.locator('#catalogue-copy-user-focus')).toBeFocused();
    }
  });

  test('keeps mobile copy regions contained and wraps long failure feedback', async ({ page }, testInfo) => {
    await openCatalogue(page, 'Quickstart');
    const metrics = await page.locator('[data-catalogue-quickstart]').evaluate((section) => {
      const elements = [section, section.querySelector('[data-catalogue-quickstart-code]')?.previousElementSibling, section.querySelector('[data-catalogue-quickstart-code]'), section.querySelector('[data-catalogue-quickstart-code]')?.previousElementSibling?.querySelector('[data-catalogue-copy-status]')].filter((element): element is HTMLElement => element instanceof HTMLElement);
      const viewport = { width: innerWidth, height: innerHeight };
      return { viewport, bounds: elements.map((element) => { const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }; }), documentWidth: document.documentElement.scrollWidth, codeScrolls: (section.querySelector('[data-catalogue-quickstart-code]') as HTMLElement).scrollWidth > (section.querySelector('[data-catalogue-quickstart-code]') as HTMLElement).clientWidth };
    });
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport.width + 1);
    for (const box of metrics.bounds) {
      expect(box.left).toBeGreaterThanOrEqual(-1);
      expect(box.right).toBeLessThanOrEqual(metrics.viewport.width + 1);
    }
    if (testInfo.project.name.includes('mobile')) expect(metrics.codeScrolls).toBe(true);
    await page.evaluate(() => {
      const capture = (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
      capture.modernReject = true;
      capture.fallbackResult = false;
    });
    const button = copyButton(page.locator('[data-catalogue-quickstart-code]'));
    await button.click();
    await expect(copyStatus(page.locator('[data-catalogue-quickstart-code]'))).toContainText('Select the code and copy it manually.');
    expect(await copyStatus(page.locator('[data-catalogue-quickstart-code]')).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await saveCapture(page.locator('[data-catalogue-quickstart]'), testInfo, 'catalogue-quickstart-copy-region.png');
  });

  test('runs Axe over Quickstart and Backgrounds copy regions', async ({ page }) => {
    await openCatalogue(page, 'Quickstart');
    const quickstart = await new AxeBuilder({ page }).include('[data-catalogue-quickstart]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(quickstart.violations).toEqual([]);
    await openCatalogue(page, 'AppShell');
    const backgrounds = await new AxeBuilder({ page }).include('[data-background-catalogue-section]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(backgrounds.violations).toEqual([]);
  });

  test('does not add controls to ordinary pages or generate backend activity', async ({ page }) => {
    const requests: string[] = [];
    const websockets: string[] = [];
    const scripts: Array<{ url: string; body: string }> = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('websocket', (socket) => websockets.push(socket.url()));
    page.on('response', (response) => {
      if (response.request().resourceType() === 'script') void response.body().then((body) => scripts.push({ url: response.url(), body: body.toString() })).catch(() => undefined);
    });
    await openCatalogue(page, 'Buttons');
    await copyButton(page.locator('[data-catalogue-code-for="buttons-variants"]')).click();
    expect(requests.some((url) => /REST\/(actions|events|activity)/i.test(url))).toBe(false);
    expect(websockets).toEqual([]);
    await page.goto('/nodel.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-catalogue-copy-toolbar]')).toHaveCount(0);
    await expect.poll(() => scripts.length).toBeGreaterThan(0);
    const ordinaryScripts = scripts.filter(({ url }) => !url.includes('/components'));
    expect(ordinaryScripts.length).toBeGreaterThan(0);
    expect(ordinaryScripts.every(({ body }) => !body.includes('data-catalogue-copy-toolbar'))).toBe(true);
  });
});
