import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import type * as CodeCopyModule from '../src/catalogue/code-copy';

type CopyCapture = {
  writes: string[];
  fallback: string[];
  modernReject: boolean;
  fallbackResult: boolean;
  defer: boolean;
  settlers: Array<(success: boolean) => void>;
};

type CopyObserverGuard = { armed: boolean; deliveries: number; captures: number; tripped: boolean };

let lifecycleBundle: Promise<string> | undefined;

async function openLifecycleFixture(page: Page) {
  // Scoped controllers are not a public runtime API. Exercise the actual source
  // and dependencies in native browsers without exposing a production test hook
  // or writing another build into the checkout's dist/generated asset trees.
  lifecycleBundle ??= build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: fileURLToPath(new URL('../src/catalogue/code-copy.ts', import.meta.url)), formats: ['es'] }
    }
  }).then((result) => {
    const output = Array.isArray(result) ? result[0] : result;
    if (!output || !('output' in output)) throw new Error('Expected in-memory lifecycle fixture bundle');
    const chunk = output.output.find((entry) => entry.type === 'chunk');
    if (!chunk) throw new Error('Missing lifecycle fixture entry');
    return chunk.code;
  });
  const source = await lifecycleBundle;
  await installCopyObserverGuard(page);
  await page.route('**/__copy-lifecycle.js', (route) => route.fulfill({ contentType: 'text/javascript', body: source }));
  await page.route('**/__copy-lifecycle.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Copy lifecycle</title></head><body></body></html>' }));
  await page.goto('/__copy-lifecycle.html');
}

async function installCopyObserverGuard(page: Page) {
  await page.addInitScript(() => {
    const guard: CopyObserverGuard = { armed: false, deliveries: 0, captures: 0, tripped: false };
    (window as unknown as { __copyObserverGuard: CopyObserverGuard }).__copyObserverGuard = guard;
    const NativeObserver = MutationObserver;
    window.MutationObserver = class extends NativeObserver {
      catalogue = false;
      constructor(callback: MutationCallback) {
        super((records, observer) => {
          if ((observer as { catalogue?: boolean }).catalogue && guard.armed && ++guard.deliveries > 30) {
            // Stop a regression before it starves the browser's task queue.
            guard.tripped = true;
            observer.disconnect();
            return;
          }
          callback(records, observer);
        });
      }
      override observe(target: Node, options?: MutationObserverInit) {
        this.catalogue ||= Boolean(options?.attributeFilter?.includes('data-catalogue-copy-disabled'));
        super.observe(target, options);
      }
      override takeRecords() {
        // Also bound loops that drain native records into queued reconciles.
        if (this.catalogue && guard.armed && ++guard.captures > 500) {
          guard.tripped = true;
          this.disconnect();
          return [];
        }
        return super.takeRecords();
      }
    };
  });
}

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
  return pre.locator('xpath=..').getByRole('button', { name: /^Copy code/ });
}

function copyStatus(pre: ReturnType<Page['locator']>) {
  return pre.locator('xpath=..').locator('[data-catalogue-copy-status]');
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
    await openCatalogue(page, 'App');
    await expect.poll(() => page.locator('[data-background-markup] code').evaluateAll((codes) => codes.every((code) => Boolean(code.textContent?.trim())))).toBe(true);
    const inventory = await page.locator('pre.nodel-catalogue-code > code').evaluateAll((codes) => {
      const pres = codes.map((code) => code.parentElement!).filter((pre) => !pre.closest('[data-catalogue-example]'));
      const containers = pres.map((pre) => pre.parentElement);
      const controls = containers.map((container) => container?.querySelector('button'));
      const statuses = containers.map((container) => container?.querySelector('[data-catalogue-copy-status]'));
      return {
        blocks: pres.length,
        containers: containers.filter((container) => container?.hasAttribute('data-catalogue-copy-container')).length,
        buttons: containers.filter((container) => container?.querySelectorAll('button').length === 1).length,
        statuses: containers.filter((container) => container?.querySelectorAll('[data-catalogue-copy-status]').length === 1).length,
        uniqueButtons: new Set(controls).size,
        uniqueStatuses: new Set(statuses).size,
        iconOnly: controls.every((button) => Boolean(button?.querySelector('svg[data-icon="copy"]')) && button?.textContent?.trim() === ''),
        meaningfulLabels: controls.every((button) => Boolean(button?.getAttribute('aria-label')?.startsWith('Copy code')) && button?.getAttribute('title') === button?.getAttribute('aria-label')),
        quickstartLabel: document.querySelector('[data-catalogue-quickstart-code]')?.parentElement?.querySelector('button')?.getAttribute('aria-label'),
        backgroundLabels: [...document.querySelectorAll<HTMLElement>('[data-background-markup]')].map((pre) => pre.parentElement?.querySelector('button')?.getAttribute('aria-label')),
        insideExamples: document.querySelectorAll('[data-catalogue-example] [data-catalogue-copy-container]').length,
        referenceCells: document.querySelectorAll('td [data-catalogue-copy-container], th [data-catalogue-copy-container]').length,
        duplicateIds: [...document.querySelectorAll('[id]')].map((element) => element.id).filter((id, index, ids) => ids.indexOf(id) !== index)
      };
    });
    expect(inventory).toEqual({ blocks: 70, containers: 70, buttons: 70, statuses: 70, uniqueButtons: 70, uniqueStatuses: 70, iconOnly: true, meaningfulLabels: true, quickstartLabel: 'Copy code: Quickstart', backgroundLabels: ['Copy code: Backgrounds, App', 'Copy code: Backgrounds, Page override'], insideExamples: 0, referenceCells: 0, duplicateIds: [] });
    await saveCapture(page.locator('nodel-page[data-page-id="App"][active]'), testInfo, 'catalogue-inventory.png');
  });

  test('writes exact displayed text for Quickstart, nested templates, paired, and unpaired blocks', async ({ page }, testInfo) => {
    const cases = [
      { pageId: 'Quickstart', selector: '[data-catalogue-quickstart-code]' },
      { pageId: 'Templates', selector: '[data-catalogue-code-for="templates-shared"]' },
      { pageId: 'Buttons', selector: '[data-catalogue-code-for="buttons-variants"]' },
      { pageId: 'Readouts', selector: '[data-catalogue-purpose="single-display-composition"]' },
      { pageId: 'PageSizing', selector: '[data-catalogue-purpose="viewport-page-layout"]' },
      { pageId: 'KeyboardShortcuts', selector: 'pre.nodel-catalogue-code:not([data-catalogue-code-for]):has-text("<nodel-shortcut")' }
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

  test('reveals the icon on hover or focus and keeps it visible on touch devices', async ({ page }, testInfo) => {
    await openCatalogue(page, 'Quickstart');
    const pre = page.locator('[data-catalogue-quickstart-code]');
    const container = pre.locator('xpath=..');
    const button = copyButton(pre);
    const device = await page.evaluate(() => ({ hover: matchMedia('(hover: hover)').matches, coarse: matchMedia('(pointer: coarse)').matches }));
    const opacity = () => button.evaluate((element) => getComputedStyle(element).opacity);

    if (testInfo.project.name.includes('mobile') || device.coarse) {
      expect(await opacity()).toBe('1');
    } else if (device.hover) {
      expect(await opacity()).toBe('0');
      await pre.hover({ position: { x: 20, y: 30 } });
      await expect.poll(opacity).toBe('1');
      await page.mouse.move(0, 0);
      await expect.poll(opacity).toBe('0');
    }

    await button.focus();
    await expect.poll(opacity).toBe('1');
    const buttonBox = await button.boundingBox();
    const containerBox = await container.boundingBox();
    const preBox = await pre.boundingBox();
    const position = await button.evaluate((element) => getComputedStyle(element).position);
    const topPadding = await pre.evaluate((element) => getComputedStyle(element).paddingTop);
    expect(buttonBox).not.toBeNull();
    expect(containerBox).not.toBeNull();
    expect(preBox).not.toBeNull();
    expect(position).toBe('absolute');
    expect(topPadding).toBe('16px');
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(preBox!.x + preBox!.width - 4);
    expect(buttonBox!.y).toBeGreaterThanOrEqual(preBox!.y + 4);
    expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(preBox!.y + preBox!.height);
    await page.evaluate(() => {
      const pre = document.querySelector<HTMLElement>('[data-catalogue-quickstart-code]')!;
      pre.scrollLeft = pre.scrollWidth;
    });
    const scrolledButtonBox = await button.boundingBox();
    expect(scrolledButtonBox).not.toBeNull();
    expect(Math.abs(scrolledButtonBox!.x - buttonBox!.x)).toBeLessThanOrEqual(1);
    await expect(button).toBeVisible();
    await button.press('Enter');
    await expect.poll(() => capture(page).then((result) => result.writes.length)).toBe(1);

    await pre.evaluate((element) => element.setAttribute('data-catalogue-copy-disabled', ''));
    await expect(button).toBeDisabled();
    if (device.hover) {
      await page.mouse.move(0, 0);
      await expect.poll(opacity).toBe('0');
      await pre.hover({ position: { x: 20, y: 30 } });
    }
    await expect.poll(opacity).toBe('0.55');
    await pre.evaluate((element) => element.removeAttribute('data-catalogue-copy-disabled'));
    await expect(button).toBeEnabled();
  });

  test('respects reduced-motion preference for the copy-button transition', async ({ page }) => {
    await openCatalogue(page, 'Quickstart');
    const button = copyButton(page.locator('[data-catalogue-quickstart-code]'));
    const transition = () => button.evaluate((element) => {
      const style = getComputedStyle(element);
      return { property: style.transitionProperty, duration: style.transitionDuration };
    });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(transition).toEqual({ property: 'none', duration: '0s' });

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(transition).toEqual({ property: 'opacity', duration: '0.12s' });
  });

  test('disposes pending copy when its enclosing Quickstart section is removed and reattached', async ({ page }) => {
    await openCatalogue(page, 'Quickstart');
    const pre = page.locator('[data-catalogue-quickstart-code]');
    await page.evaluate(() => {
      (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture.defer = true;
    });
    await copyButton(pre).click();
    await page.evaluate(() => {
      const section = document.querySelector<HTMLElement>('[data-catalogue-quickstart]')!;
      (window as unknown as Window & { __detachedQuickstart?: HTMLElement }).__detachedQuickstart = section;
      section.remove();
    });
    await expect(page.locator('[data-catalogue-quickstart-code]')).toHaveCount(0);
    await page.evaluate(() => {
      const section = (window as unknown as Window & { __detachedQuickstart?: HTMLElement }).__detachedQuickstart;
      if (section) document.querySelector('nodel-page[active]')?.append(section);
    });
    const reattachedPre = page.locator('[data-catalogue-quickstart-code]');
    await expect(reattachedPre).toHaveCount(1);
    await expect(reattachedPre.locator('xpath=..').getByRole('button')).toHaveCount(1);
    await page.evaluate(() => {
      const capture = (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
      capture.settlers[0]?.(true);
    });
    await expect(copyStatus(reattachedPre)).toHaveText('');
    await page.evaluate(() => {
      (window as unknown as Window & { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture.defer = false;
    });
    await copyButton(reattachedPre).click();
    await expect.poll(() => capture(page).then((result) => result.writes.length)).toBeGreaterThan(1);
  });

  for (const target of ['ancestor', 'pre', 'container'] as const) {
    test(`quiesces across macrotasks after same-turn ${target} detach/reattach`, async ({ page }) => {
      await installCopyObserverGuard(page);
      await openCatalogue(page, 'Quickstart');
      for (const outcome of [true, false]) {
        const result = await page.evaluate(async ({ target, outcome }) => {
          const capture = (window as unknown as { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
          const guard = (window as unknown as { __copyObserverGuard: CopyObserverGuard }).__copyObserverGuard;
          const section = document.querySelector<HTMLElement>('[data-catalogue-quickstart]')!;
          const pre = section.querySelector<HTMLElement>('[data-catalogue-quickstart-code]')!;
          const code = pre.querySelector('code')!;
          const oldButton = pre.parentElement!.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]')!;
          capture.defer = true;
          oldButton.focus();
          oldButton.click();
          const settleOld = capture.settlers.at(-1)!;
          const node = target === 'ancestor' ? section : target === 'pre' ? pre : pre.parentElement!;
          const parent = node.parentElement!;
          guard.deliveries = 0;
          guard.captures = 0;
          guard.armed = true;
          // The enhancer observes the whole document, including unrelated lazy
          // catalogue rendering. Quiescence concerns this copy region only.
          let regionDeliveries = 0;
          const monitor = new MutationObserver(() => { regionDeliveries += 1; });
          monitor.observe(section, { childList: true, subtree: true });
          node.remove();
          parent.append(node);
          await new Promise((resolve) => setTimeout(resolve, 0));
          const currentButton = pre.parentElement!.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]');
          const firstDeliveries = regionDeliveries;
          await new Promise((resolve) => setTimeout(resolve, 0));
          const quiescent = regionDeliveries === firstDeliveries;
          settleOld(outcome);
          await new Promise((resolve) => setTimeout(resolve, 0));
          const staleFeedback = pre.parentElement!.querySelector('[data-catalogue-copy-status]')?.textContent;
          const writesBefore = capture.writes.length;
          oldButton.click();
          const oldButtonInactive = capture.writes.length === writesBefore;
          capture.defer = false;
          currentButton?.click();
          await new Promise((resolve) => setTimeout(resolve, 0));
          guard.armed = false;
          monitor.disconnect();
          return {
            bounded: !guard.tripped, quiescent,
            replaced: currentButton !== oldButton,
            stable: pre.parentElement!.querySelector('[data-catalogue-copy-button]') === currentButton,
            controls: section.querySelectorAll('[data-catalogue-copy-button]').length,
            containers: section.querySelectorAll('[data-catalogue-copy-container]').length,
            sourcePreserved: pre.querySelector('code') === code,
            staleFeedback, oldButtonInactive,
            freshCopy: capture.writes.length === writesBefore + 1 && capture.writes.at(-1) === code.textContent,
            freshFeedback: pre.parentElement!.querySelector('[data-catalogue-copy-status]')?.textContent
          };
        }, { target, outcome });
        expect(result).toEqual({ bounded: true, quiescent: true, replaced: true, stable: true, controls: 1, containers: 1, sourcePreserved: true, staleFeedback: '', oldButtonInactive: true, freshCopy: true, freshFeedback: 'Code copied to the clipboard.' });
      }
    });
  }

  for (const order of ['source-first', 'destination-first'] as const) {
    test(`quiesces on scoped transfers in native ${order} observer order`, async ({ page }) => {
      await openLifecycleFixture(page);
      const results = await page.evaluate(async (order) => {
        const moduleUrl = '/__copy-lifecycle.js';
        const { enhanceCatalogueCodeCopy } = await import(moduleUrl) as typeof CodeCopyModule;
        const guard = (window as unknown as { __copyObserverGuard: CopyObserverGuard }).__copyObserverGuard;
        const capture = (window as unknown as { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
        const results = [];
        for (const target of ['ancestor', 'pre', 'container']) {
          const first = document.createElement('section');
          const second = document.createElement('section');
          first.innerHTML = '<article><pre class="nodel-catalogue-code"><code>native transfer</code></pre></article>';
          document.body.append(first, second);
          const disposers = order === 'source-first'
            ? [enhanceCatalogueCodeCopy(first), enhanceCatalogueCodeCopy(second)]
            : [enhanceCatalogueCodeCopy(second), enhanceCatalogueCodeCopy(first)];
          const pre = first.querySelector('pre')!;
          const oldButton = first.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]')!;
          capture.defer = true;
          oldButton.click();
          const settleOld = capture.settlers.at(-1)!;
          guard.deliveries = 0;
          guard.captures = 0;
          guard.armed = true;
          second.append(target === 'ancestor' ? first.querySelector('article')! : target === 'pre' ? pre : pre.parentElement!);
          await new Promise((resolve) => setTimeout(resolve, 0));
          const button = second.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]');
          const deliveries = guard.deliveries;
          await new Promise((resolve) => setTimeout(resolve, 0));
          const quiescent = deliveries === guard.deliveries;
          settleOld(true);
          await new Promise((resolve) => setTimeout(resolve, 0));
          const staleFeedback = second.querySelector('[data-catalogue-copy-status]')?.textContent;
          capture.defer = false;
          const writes = capture.writes.length;
          oldButton.click();
          const inactive = capture.writes.length === writes;
          button?.click();
          await new Promise((resolve) => setTimeout(resolve, 0));
          results.push({ target, bounded: !guard.tripped, quiescent, replaced: button !== oldButton, stable: second.querySelector('[data-catalogue-copy-button]') === button, controls: second.querySelectorAll('[data-catalogue-copy-button]').length, oldControls: first.querySelectorAll('[data-catalogue-copy-container]').length, staleFeedback, inactive, freshCopy: capture.writes.length === writes + 1 });
          guard.armed = false;
          for (const dispose of disposers) dispose();
          first.remove();
          second.remove();
        }
        return results;
      }, order);
      expect(results).toEqual(['ancestor', 'pre', 'container'].map((target) => ({ target, bounded: true, quiescent: true, replaced: true, stable: true, controls: 1, oldControls: 0, staleFeedback: '', inactive: true, freshCopy: true })));
    });
  }

  test('preserves an adopted clone scoped root and authored siblings in a native browser', async ({ page }) => {
    await openLifecycleFixture(page);
    const result = await page.evaluate(async () => {
      const moduleUrl = '/__copy-lifecycle.js';
      const { enhanceCatalogueCodeCopy } = await import(moduleUrl) as typeof CodeCopyModule;
      const section = document.createElement('section');
      section.innerHTML = '<pre class="nodel-catalogue-code"><code>clone root</code></pre>';
      document.body.append(section);
      const dispose = enhanceCatalogueCodeCopy(section);
      const clone = section.querySelector('[data-catalogue-copy-container]')!.cloneNode(true) as HTMLElement;
      dispose();
      const sibling = document.createElement('aside');
      sibling.textContent = 'Authored sibling';
      clone.append(sibling);
      document.body.append(clone);
      const pre = clone.querySelector('pre');
      const disposeClone = enhanceCatalogueCodeCopy(clone);
      disposeClone();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { connected: clone.isConnected, prePreserved: clone.querySelector('pre') === pre, siblingPreserved: sibling.parentElement === clone, controls: clone.querySelectorAll('[data-catalogue-copy-button], [data-catalogue-copy-status]').length };
    });
    expect(result).toEqual({ connected: true, prePreserved: true, siblingPreserved: true, controls: 0 });
  });

  for (const position of ['before', 'after'] as const) {
    test(`quiesces with independent controls for a pre-only clone inserted ${position} its source`, async ({ page }) => {
      await installCopyObserverGuard(page);
      await openCatalogue(page, 'Quickstart');
      const result = await page.evaluate(async (position) => {
        const capture = (window as unknown as { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
        const guard = (window as unknown as { __copyObserverGuard: CopyObserverGuard }).__copyObserverGuard;
        const section = document.querySelector<HTMLElement>('[data-catalogue-quickstart]')!;
        const pre = section.querySelector<HTMLPreElement>('pre')!;
        const code = pre.querySelector('code');
        const originalButton = pre.parentElement!.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]')!;
        capture.defer = true;
        originalButton.click();
        const settleOriginal = capture.settlers.at(-1)!;
        const clone = pre.cloneNode(true) as HTMLPreElement;
        clone.querySelector('code')!.textContent = 'cloned source';
        guard.armed = true;
        let deliveries = 0;
        const monitor = new MutationObserver(() => { deliveries += 1; });
        monitor.observe(section, { childList: true, subtree: true });
        if (position === 'before') pre.before(clone);
        else pre.after(clone);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const settled = deliveries;
        await new Promise((resolve) => setTimeout(resolve, 0));
        const quiescent = settled === deliveries;
        const cloneButton = clone.parentElement!.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]');
        capture.defer = false;
        cloneButton?.click();
        settleOriginal(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const pendingPreserved = pre.parentElement!.querySelector('[data-catalogue-copy-status]')?.textContent === 'Code copied to the clipboard.';
        originalButton.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        guard.armed = false;
        monitor.disconnect();
        return {
          bounded: !guard.tripped, quiescent,
          distinct: pre.parentElement !== clone.parentElement && !pre.parentElement!.contains(clone) && !clone.parentElement!.contains(pre),
          originalControl: originalButton.isConnected && pre.parentElement!.querySelector('[data-catalogue-copy-button]') === originalButton,
          containers: section.querySelectorAll('[data-catalogue-copy-container]').length,
          controls: [pre, clone].map((node) => node.parentElement!.querySelectorAll('[data-catalogue-copy-button]').length),
          sourcePreserved: pre.querySelector('code') === code,
          orderPreserved: section.querySelectorAll('pre')[position === 'before' ? 0 : 1] === clone,
          pendingPreserved, independentPayloads: capture.writes.length === 3 && capture.writes[0] === code?.textContent && capture.writes[1] === 'cloned source' && capture.writes[2] === code?.textContent
        };
      }, position);
      expect(result).toEqual({ bounded: true, quiescent: true, distinct: true, originalControl: true, containers: 2, controls: [1, 1], sourcePreserved: true, orderPreserved: true, pendingPreserved: true, independentPayloads: true });
    });
  }

  test('quiesces when a surviving overlapping wrapper root claims a released document-owned block', async ({ page }) => {
    await openLifecycleFixture(page);
    const results = await page.evaluate(async () => {
      const moduleUrl = '/__copy-lifecycle.js';
      const { enhanceCatalogueCodeCopy } = await import(moduleUrl) as typeof CodeCopyModule;
      const capture = (window as unknown as { __catalogueCopyCapture: CopyCapture }).__catalogueCopyCapture;
      const guard = (window as unknown as { __copyObserverGuard: CopyObserverGuard }).__copyObserverGuard;
      const results = [];
      for (const outcome of [true, false]) {
        const section = document.createElement('section');
        section.innerHTML = '<pre class="nodel-catalogue-code"><code>overlapping source</code></pre>';
        document.body.append(section);
        const disposeDocument = enhanceCatalogueCodeCopy(document);
        const pre = section.querySelector('pre')!;
        const wrapper = pre.parentElement!;
        const sibling = document.createElement('aside');
        wrapper.append(sibling);
        const oldButton = wrapper.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]')!;
        const disposeWrapper = enhanceCatalogueCodeCopy(wrapper);
        capture.defer = true;
        oldButton.click();
        const settleOld = capture.settlers.at(-1)!;
        guard.deliveries = 0;
        guard.captures = 0;
        guard.armed = true;
        if (!outcome) {
          // Handoff must not depend on disposal generating chrome mutations.
          oldButton.remove();
          wrapper.querySelector('[data-catalogue-copy-status]')!.remove();
          await new Promise((resolve) => setTimeout(resolve, 0));
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        disposeDocument();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const button = wrapper.querySelector<HTMLButtonElement>('[data-catalogue-copy-button]');
        const deliveries = guard.deliveries;
        await new Promise((resolve) => setTimeout(resolve, 0));
        const quiescent = deliveries === guard.deliveries;
        settleOld(outcome);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const staleFeedback = wrapper.querySelector('[data-catalogue-copy-status]')?.textContent;
        const writes = capture.writes.length;
        oldButton.click();
        const inactive = capture.writes.length === writes;
        capture.defer = false;
        button?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const claimed = wrapper.querySelectorAll('[data-catalogue-copy-button]').length === 1 && button !== oldButton && wrapper.querySelector('[data-catalogue-copy-button]') === button;
        disposeWrapper();
        await new Promise((resolve) => setTimeout(resolve, 0));
        results.push({ bounded: !guard.tripped, quiescent, claimed, staleFeedback, inactive, freshCopy: capture.writes.length === writes + 1 && capture.writes.at(-1) === 'overlapping source', rootPreserved: wrapper.isConnected && pre.parentElement === wrapper && sibling.parentElement === wrapper, cleanedUp: !wrapper.querySelector('[data-catalogue-copy-button], [data-catalogue-copy-status]') });
        guard.armed = false;
        section.remove();
      }
      return results;
    });
    expect(results).toEqual([true, false].map(() => ({ bounded: true, quiescent: true, claimed: true, staleFeedback: '', inactive: true, freshCopy: true, rootPreserved: true, cleanedUp: true })));
  });

  for (const scoped of [false, true]) for (const position of ['before', 'after'] as const) for (const focused of ['button', 'pre', 'selection'] as const) {
    test(`preserves ${focused}, sibling layout and cleanup for five ${position} clones (${scoped ? 'scoped shell' : 'generated wrapper'})`, async ({ page }) => {
      await openLifecycleFixture(page);
      const result = await page.evaluate(async ({ scoped, position, focused }) => {
        const moduleUrl = '/__copy-lifecycle.js';
        const { enhanceCatalogueCodeCopy } = await import(/* @vite-ignore */ moduleUrl) as typeof CodeCopyModule;
        const guard = (window as unknown as { __copyObserverGuard: CopyObserverGuard }).__copyObserverGuard;
        const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
        const section = document.createElement('section');
        section.innerHTML = '<aside>Before</aside><pre tabindex="0" class="nodel-catalogue-code"><code>Manual copy selection\nwith a second line</code></pre><aside>After</aside>';
        const style = document.createElement('style');
        style.textContent = 'section > * + *, [data-test-shell] > * + * { margin-top: 24px } pre { margin: 0 } [data-catalogue-copy-container] { position: relative }';
        document.head.append(style);
        document.body.append(section);
        const pre = section.querySelector('pre')!;
        let root: HTMLElement = section;
        if (scoped) {
          root = document.createElement('div');
          root.setAttribute('data-catalogue-copy-container', '');
          root.setAttribute('data-test-shell', '');
          pre.before(root);
          root.append(pre);
        }
        const dispose = enhanceCatalogueCodeCopy(root);
        await tick();
        const originalWrapper = pre.parentElement!;
        const button = originalWrapper.querySelector<HTMLButtonElement>('button')!;
        const text = pre.querySelector('code')!.firstChild!;
        const selection = getSelection()!;
        const expected: HTMLPreElement[] = [pre];
        const states = [];
        guard.armed = true;
        for (let i = 0; i < 5; i++) {
          (focused === 'button' ? button : pre).focus();
          if (focused === 'selection') selection.setBaseAndExtent(text, 3, text, text.textContent!.length - 2);
          const selected = selection.toString();
          const clone = pre.cloneNode(true) as HTMLPreElement;
          expected.splice(expected.indexOf(pre) + (position === 'after' ? 1 : 0), 0, clone);
          pre[position](clone);
          await tick();
          const deliveries = guard.deliveries;
          const captures = guard.captures;
          await tick();
          const wrappers = expected.map((node) => node.parentElement!);
          states.push({
            focus: document.activeElement === (focused === 'button' ? button : pre),
            selection: focused !== 'selection' || (selection.toString() === selected && selection.anchorNode === text && selection.anchorOffset === 3 && selection.focusOffset === text.textContent!.length - 2),
            stationary: scoped || pre.parentElement === originalWrapper,
            siblings: wrappers.every((wrapper) => wrapper.parentElement === root),
            gap: wrappers.slice(1).every((wrapper, index) => wrapper.getBoundingClientRect().top - wrappers[index]!.getBoundingClientRect().bottom >= 23),
            order: [...root.querySelectorAll('pre')].every((node, index) => node === expected[index]),
            controls: wrappers.every((wrapper) => wrapper.querySelectorAll('button').length === 1),
            quiet: !guard.tripped && guard.deliveries === deliveries && guard.captures === captures
          });
        }
        dispose();
        await tick();
        return { states, clean: expected.every((node) => node.parentElement === root) && root.querySelectorAll('div, button, [data-catalogue-copy-status]').length === 0,
          authored: section.firstElementChild?.textContent === 'Before' && section.lastElementChild?.textContent === 'After', bounded: !guard.tripped };
      }, { scoped, position, focused });
      expect(result).toEqual({ states: Array.from({ length: 5 }, () => ({ focus: true, selection: true, stationary: true, siblings: true, gap: true, order: true, controls: true, quiet: true })), clean: true, authored: true, bounded: true });
    });
  }

  test('keeps reported snippets readable and copies their exact source', async ({ page }, testInfo) => {
    for (const current of [
      { pageId: 'Icons', selector: '[data-catalogue-code-for="icons-options"]', root: '<nodel-control-grid' },
      { pageId: 'Faders', selector: '[data-catalogue-code-for="faders-horizontal"]', root: '<nodel-control-grid' }
    ]) {
      await openCatalogue(page, current.pageId);
      const pre = page.locator(current.selector);
      const code = await pre.locator('code').textContent();
      const lines = code?.split('\n') ?? [];
      expect(lines[0]).toContain(current.root);
      expect(lines[0]).not.toMatch(/^\s/);
      expect(lines[1]).toMatch(/^ {2}<nodel-/);
      expect(lines.at(-1)).toMatch(/^<\//);
      if (current.pageId === 'Faders') expect(code).toContain('increment=""');
      await copyButton(pre).click();
      await expect.poll(() => capture(page).then((result) => result.writes.at(-1))).toBe(code);
      await saveCapture(pre, testInfo, `catalogue-code-formatting-${current.pageId}.png`);
    }
  });

  test('keeps both generated Backgrounds snippets independently valid and exact after recovery', async ({ page }, testInfo) => {
    await openCatalogue(page, 'App');
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
      const container = pre?.parentElement;
      const anchor = document.createElement('a');
      anchor.href = '#catalogue-copy-tab-anchor';
      anchor.id = 'catalogue-copy-tab-anchor';
      anchor.textContent = 'Before copy';
      container?.insertBefore(anchor, container.querySelector('button'));
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
        const parent = pre.parentElement!.parentElement!;
        (window as unknown as { __catalogueReattach?: { parent: HTMLElement; pre: HTMLElement } }).__catalogueReattach = { parent, pre };
        code.replaceWith(replacement);
        pre.remove();
      });
      await expect(page.locator('[data-catalogue-quickstart-code]')).toHaveCount(0);
      await page.evaluate(() => {
        const reattach = (window as unknown as { __catalogueReattach?: { parent: HTMLElement; pre: HTMLElement } }).__catalogueReattach;
        reattach?.parent.append(reattach.pre);
      });
      await expect.poll(() => page.locator('[data-catalogue-quickstart-code]').evaluate((element) => element.parentElement?.hasAttribute('data-catalogue-copy-container'))).toBe(true);
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
      await page.locator('[data-catalogue-quickstart-code]').locator('xpath=..').getByRole('button').click();
      await expect.poll(() => capture(page).then((result) => result.writes.length)).toBeGreaterThan(1);
    }
  });

  test('releases a disabled producer after a deferred copy settles', async ({ page }) => {
    await openCatalogue(page, 'App');
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
      const elements = [section, section.querySelector('[data-catalogue-quickstart-code]')?.parentElement, section.querySelector('[data-catalogue-quickstart-code]'), section.querySelector('[data-catalogue-quickstart-code]')?.parentElement?.querySelector('[data-catalogue-copy-status]')].filter((element): element is HTMLElement => element instanceof HTMLElement);
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
    await openCatalogue(page, 'App');
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
    await expect(page.locator('[data-catalogue-copy-container]')).toHaveCount(0);
    await expect.poll(() => scripts.length).toBeGreaterThan(0);
    const ordinaryScripts = scripts.filter(({ url }) => !url.includes('/components'));
    expect(ordinaryScripts.length).toBeGreaterThan(0);
    expect(ordinaryScripts.every(({ body }) => !body.includes('data-catalogue-copy-container'))).toBe(true);
  });
});
