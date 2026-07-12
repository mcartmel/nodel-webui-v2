import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

function isDesktopThemeProject(testInfo: TestInfo) {
  return testInfo.project.name === 'chromium-light-desktop' || testInfo.project.name === 'chromium-dark-desktop';
}

async function setMediaFeature(page: Page, name: string, value: string) {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setEmulatedMedia', { features: [{ name, value }] });
}

async function openCatalogue(page: Page, pageId: string) {
  await page.goto(`/components.html#${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`nodel-page[data-page-id="${pageId}"][active]`).waitFor();
}

async function tabTo(page: Page, target: Locator, maxTabs = 80) {
  await target.waitFor();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => document.activeElement === element)) {
      return;
    }
  }
  throw new Error(`Could not reach ${await target.evaluate((element) => element.outerHTML)} by pressing Tab ${maxTabs} times.`);
}

async function expectFocusIsNotClipped(control: Locator) {
  const result = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    const hasOutline = style.outlineStyle !== 'none'
      && Number.parseFloat(style.outlineWidth) > 0
      && style.outlineColor !== 'transparent'
      && style.outlineColor !== 'rgba(0, 0, 0, 0)';
    const hasBoxShadow = style.boxShadow !== 'none';
    const ringExtent = hasOutline
      ? Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)
      : hasBoxShadow && !style.boxShadow.includes('inset') ? 4 : 0;
    const rect = element.getBoundingClientRect();
    const expanded = {
      bottom: rect.bottom + ringExtent,
      left: rect.left - ringExtent,
      right: rect.right + ringExtent,
      top: rect.top - ringExtent
    };
    const clippingFailures: string[] = [];
    if (ringExtent > 0) {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        const ancestorRect = ancestor.getBoundingClientRect();
        const clipsX = ancestorStyle.overflowX !== 'visible';
        const clipsY = ancestorStyle.overflowY !== 'visible';
        if ((clipsX && (expanded.left < ancestorRect.left || expanded.right > ancestorRect.right))
          || (clipsY && (expanded.top < ancestorRect.top || expanded.bottom > ancestorRect.bottom))) {
          clippingFailures.push(`${ancestor.tagName.toLowerCase()}.${ancestor.className}`);
        }
      }
    }
    return {
      clippingFailures,
      hasVisibleFocus: hasOutline || hasBoxShadow,
      insideViewport: expanded.left >= 0 && expanded.top >= 0
        && expanded.right <= window.innerWidth && expanded.bottom <= window.innerHeight
    };
  });
  expect(result.hasVisibleFocus).toBe(true);
  expect(result.insideViewport).toBe(true);
  expect(result.clippingFailures).toEqual([]);
}

test.describe('theme first paint and preferences', () => {
  for (const scenario of [
    { name: 'stored dark overrides a light system theme', stored: 'dark', system: 'light', expected: 'dark' },
    { name: 'uses a dark system theme without storage', stored: null, system: 'dark', expected: 'dark' },
    { name: 'ignores malformed storage for a dark system theme', stored: 'invalid', system: 'dark', expected: 'dark' },
    { name: 'falls back when storage access is blocked', stored: null, system: 'dark', expected: 'dark', blockStorage: true },
    { name: 'keeps an explicit root light theme over storage and system dark', stored: 'dark', system: 'dark', root: 'light', expected: 'light' }
  ]) {
    test(`sets ${scenario.name} before a delayed stylesheet completes`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium-light-desktop', 'First-paint matrix runs once on the light desktop project.');
      await setMediaFeature(page, 'prefers-color-scheme', scenario.system);
      await page.addInitScript((options) => {
        if (options.blockStorage) {
          const getItem = Storage.prototype.getItem;
          Storage.prototype.getItem = function(key) {
            if (key === 'nodel.theme') throw new DOMException('Storage is blocked', 'SecurityError');
            return getItem.call(this, key);
          };
        } else if (options.stored === null) {
          window.localStorage.removeItem('nodel.theme');
        } else {
          window.localStorage.setItem('nodel.theme', options.stored);
        }
      }, scenario);

      if (scenario.root) {
        await page.route('**/components.html*', async (route) => {
          const response = await route.fetch();
          const body = (await response.text())
            .replace(/<html([^>]*)>/, '<html$1 data-theme="light">');
          await route.fulfill({ response, body });
        });
      }
      let releaseStylesheet!: () => void;
      const stylesheetBlocked = new Promise<void>((resolve) => { releaseStylesheet = resolve; });
      let markStylesheetRequested!: () => void;
      const stylesheetRequested = new Promise<void>((resolve) => { markStylesheetRequested = resolve; });
      await page.route('**/v2/nodel-webui.css*', async (route) => {
        markStylesheetRequested();
        await stylesheetBlocked;
        await route.continue();
      });
      let navigation: Promise<unknown> | undefined;
      try {
        navigation = page.goto('/components.html', { waitUntil: 'commit' });
        await stylesheetRequested;
        await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, scenario.expected);
        await expect(page.locator('html')).toHaveAttribute('data-theme', scenario.expected);
      } finally {
        releaseStylesheet();
        await navigation;
        await page.waitForLoadState('domcontentloaded');
        await page.unroute('**/v2/nodel-webui.css*');
        await page.unroute('**/components.html*');
      }
    });
  }

  test('uses solid surfaces for reduced transparency when Chromium emulation supports it', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Preference checks run once for each desktop colour theme.');

    await setMediaFeature(page, 'prefers-reduced-transparency', 'reduce');
    const supported = await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches);
    test.skip(!supported, 'This Chromium build cannot emulate prefers-reduced-transparency.');
    await openCatalogue(page, 'ControlGrid');
    await page.locator('[data-nav-group-id="Controls"]').click();
    const card = page.locator('.nodel-card').first();
    const panel = page.locator('.nodel-panel').first();
    const toolbar = page.locator('nodel-toolbar');
    const popover = page.locator('#nodel-menu-Controls');
    const control = page.locator('[data-catalogue-example="control-grid-fixed-columns"] button');
    for (const surface of [card, panel, toolbar, popover, control]) {
      await expect(surface).toHaveCSS('background-image', 'none');
    }
    await expect(popover).toHaveCSS('backdrop-filter', 'blur(0px)');
    await tabTo(page, control);
    await expectFocusIsNotClipped(control);
  });

  test('uses stronger control boundaries and focus outlines for increased contrast', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Preference checks run once for each desktop colour theme.');

    await setMediaFeature(page, 'prefers-contrast', 'more');
    const supported = await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches);
    test.skip(!supported, 'This Chromium build cannot emulate prefers-contrast.');

    const expectHighContrastFocus = async (control: Locator) => {
      await tabTo(page, control);
      await expect(control).toHaveCSS('outline-width', '3px');
      await expectFocusIsNotClipped(control);
    };

    await openCatalogue(page, 'Buttons');
    const defaultButton = page.locator('[data-catalogue-example="buttons-variants"]').getByRole('button', { name: 'Default' });
    await expectHighContrastFocus(defaultButton);

    await openCatalogue(page, 'ControlGrid');
    const boundaryMatrix = page.locator('[data-catalogue-example="control-boundary-matrix"]');
    const field = boundaryMatrix.locator('.nodel-field').first();
    const link = page.locator('.nodel-link').first();
    const choice = page.locator('.nodel-choice').first();
    await expectHighContrastFocus(field);
    await expectHighContrastFocus(link);
    await expectHighContrastFocus(choice);
    await page.locator('[data-nav-group-id="Controls"]').click();
    await expectHighContrastFocus(page.locator('#nodel-menu-Controls .nodel-menu-item').first());

    await openCatalogue(page, 'TogglesSegmented');
    const segmentedOption = page.locator('[data-catalogue-example="toggles-segmented-choices"] nodel-segmented').first().locator('button').first();
    await expectHighContrastFocus(segmentedOption);

    await openCatalogue(page, 'FadersMeters');
    const fader = page.locator('[data-catalogue-example="faders-vertical"] .nodel-fader-track').nth(1);
    await expectHighContrastFocus(fader);

    await openCatalogue(page, 'Collapse');
    const disclosure = page.locator('[data-catalogue-example="layout-collapse"] .nodel-collapse-summary').first();
    await expectHighContrastFocus(disclosure);
  });

  test('keeps representative catalogue controls reachable by Tab with unclipped focus', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Keyboard matrix runs once for each desktop colour theme.');
    await openCatalogue(page, 'Buttons');
    const buttons = page.locator('[data-catalogue-example="buttons-variants"] button');
    await tabTo(page, buttons.nth(0));
    await expectFocusIsNotClipped(buttons.nth(0));

    await openCatalogue(page, 'ControlGrid');
    const link = page.locator('.nodel-link');
    const choice = page.locator('.nodel-choice');
    const field = page.locator('[data-catalogue-example="control-boundary-matrix"] .nodel-field').first();
    await tabTo(page, link);
    await expectFocusIsNotClipped(link);
    await tabTo(page, choice);
    await expectFocusIsNotClipped(choice);
    await tabTo(page, field);
    await expectFocusIsNotClipped(field);
    await page.locator('[data-nav-group-id="Controls"]').click();
    const menuItems = page.locator('#nodel-menu-Controls .nodel-menu-item');
    await tabTo(page, menuItems.nth(0));
    await expectFocusIsNotClipped(menuItems.nth(0));

    await openCatalogue(page, 'TogglesSegmented');
    const segmentedOptions = page.locator('[data-catalogue-example="toggles-segmented-choices"] nodel-segmented').first().locator('button');
    await tabTo(page, segmentedOptions.nth(0));
    await expectFocusIsNotClipped(segmentedOptions.nth(0));

    await openCatalogue(page, 'FadersMeters');
    const faderTracks = page.locator('[data-catalogue-example="faders-vertical"] .nodel-fader-track');
    await tabTo(page, faderTracks.nth(1));
    await expectFocusIsNotClipped(faderTracks.nth(1));

    await openCatalogue(page, 'Collapse');
    const disclosures = page.locator('[data-catalogue-example="layout-collapse"] .nodel-collapse-summary');
    await tabTo(page, disclosures.nth(0));
    await expectFocusIsNotClipped(disclosures.nth(0));
  });

  test('keeps a representative focus treatment visible in forced colours', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-forced-colors', 'Forced-colours check runs in the dedicated project.');
    await openCatalogue(page, 'Buttons');
    const button = page.locator('[data-catalogue-example="buttons-variants"]').getByRole('button', { name: 'Default' });
    await tabTo(page, button);
    await expect(button).toHaveCSS('outline-width', '3px');
    await expectFocusIsNotClipped(button);
  });
});
