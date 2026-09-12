import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

function isDesktopThemeProject(testInfo: TestInfo) {
  return testInfo.project.name === 'chromium-light-desktop' || testInfo.project.name === 'chromium-dark-desktop';
}

function isDarkDisclosureProject(testInfo: TestInfo) {
  return isDesktopThemeProject(testInfo)
    || testInfo.project.name === 'firefox-light-desktop'
    || testInfo.project.name === 'webkit-light-desktop';
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
      insideViewport: rect.left >= 0 && rect.top >= 0
        && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
    };
  });
  expect(result.hasVisibleFocus).toBe(true);
  expect(result.insideViewport).toBe(true);
  expect(result.clippingFailures).toEqual([]);
}

async function expectHighContrastFocus(control: Locator) {
  await tabTo(control.page(), control);
  await expect(control).toHaveCSS('outline-width', '3px');
  await expectFocusIsNotClipped(control);
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

  test('uses solid surfaces without transparency effects', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Preference checks run once for each desktop colour theme.');

    await openCatalogue(page, 'ControlGrid');
    await page.locator('[data-nav-group-id="Controls"]').click();
    const groupSurfaces = page.locator('[data-catalogue-example="control-grid-group-surfaces"]');
    const card = groupSurfaces.locator('.nodel-group-shell[data-surface="card"]');
    const panel = groupSurfaces.locator('.nodel-group-shell[data-surface="panel"]');
    const toolbar = page.locator('nodel-toolbar');
    const popover = page.locator('#nodel-menu-Controls');
    const control = page.locator('[data-catalogue-example="control-grid-fixed-columns"] button');
    for (const surface of [card, panel, toolbar, popover, control]) {
      await expect(surface).toHaveCSS('background-image', 'none');
    }
    await expect(popover).toHaveCSS('backdrop-filter', 'none');
    await tabTo(page, control);
    await expectFocusIsNotClipped(control);
  });

  test('keeps embedded collapse surfaces flat', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Surface checks run once for each desktop colour theme.');

    await openCatalogue(page, 'Collapse');
    const collapses = page.locator('[data-catalogue-example="layout-collapse"] .nodel-collapse');
    await expect(collapses.first()).toBeVisible();
    for (const collapse of await collapses.all()) {
      await expect(collapse).toHaveCSS('box-shadow', 'none');
    }
  });

  test('matches disclosure state surfaces and isolates nested previews', async ({ page }, testInfo) => {
    test.skip(!isDarkDisclosureProject(testInfo), 'Disclosure surface checks run once for each desktop colour theme and engine.');
    await openCatalogue(page, 'Collapse');
    const dark = testInfo.project.name.includes('dark') || testInfo.project.name.includes('firefox') || testInfo.project.name.includes('webkit');
    if (dark && !testInfo.project.name.includes('dark')) {
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    }
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.dataset.themeDisclosureFixture = '';
      host.innerHTML = `
        <details class="nodel-collapse nodel-panel" open data-disclosure="panel">
          <summary class="nodel-collapse-summary"><span class="nodel-collapse-label">Panel</span><span class="nodel-collapse-preview">Panel preview</span><span class="nodel-collapse-icon"></span></summary>
          <div class="nodel-collapse-content">
            <details class="nodel-collapse nodel-card" data-disclosure="nested">
              <summary class="nodel-collapse-summary"><span class="nodel-collapse-label">Nested</span><span class="nodel-collapse-preview">Nested preview</span><span class="nodel-collapse-icon"></span></summary>
              <div class="nodel-collapse-content">Nested content</div>
            </details>
          </div>
        </details>
        <details class="nodel-collapse nodel-card" data-disclosure="card">
          <summary class="nodel-collapse-summary"><span class="nodel-collapse-label">Card</span><span class="nodel-collapse-preview">Card preview</span><span class="nodel-collapse-icon"></span></summary>
          <div class="nodel-collapse-content">Card content</div>
        </details>
        <details class="nodel-collapse nodel-panel" style="--nodel-panel-background: rgb(12 34 56)" open data-disclosure="custom">
          <summary class="nodel-collapse-summary"><span class="nodel-collapse-label">Custom</span></summary>
          <div class="nodel-collapse-content">Custom token content</div>
        </details>
        <details class="nodel-collapse" style="background: rgb(18 52 86)" open data-disclosure="inline">
          <summary class="nodel-collapse-summary"><span class="nodel-collapse-label">Inline</span></summary>
          <div class="nodel-collapse-content">Inline content</div>
        </details>`;
      document.querySelector('nodel-page[active]')?.append(host);
    });

    const fixture = page.locator('[data-theme-disclosure-fixture]');
    const panel = fixture.locator('[data-disclosure="panel"]');
    const nested = fixture.locator('[data-disclosure="nested"]');
    const card = fixture.locator('[data-disclosure="card"]');
    const custom = fixture.locator('[data-disclosure="custom"]');
    const inline = fixture.locator('[data-disclosure="inline"]');
    const panelSummary = panel.locator(':scope > .nodel-collapse-summary');
    const nestedSummary = nested.locator(':scope > .nodel-collapse-summary');
    const cardSummary = card.locator(':scope > .nodel-collapse-summary');
    const customSummary = custom.locator(':scope > .nodel-collapse-summary');
    const inlineSummary = inline.locator(':scope > .nodel-collapse-summary');
    const panelBackground = dark ? 'rgb(38, 38, 38)' : 'rgb(255, 255, 255)';
    const cardClosedBackground = dark ? 'rgb(48, 48, 48)' : 'rgb(238, 238, 238)';
    const closedHoverBackground = dark ? 'rgb(56, 56, 56)' : 'rgb(228, 228, 228)';

    await expect(panel).toHaveCSS('background-color', panelBackground);
    await expect(panelSummary).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(panelSummary).toHaveCSS('border-bottom-left-radius', '0px');
    await expect(nested.locator('.nodel-collapse-preview')).toBeVisible();
    await expect(cardSummary).toHaveCSS('background-color', cardClosedBackground);
    await expect(custom).toHaveCSS('background-color', 'rgb(12, 34, 56)');
    await expect(customSummary).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(inline).toHaveCSS('background-color', 'rgb(18, 52, 86)');
    await expect(inlineSummary).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    await cardSummary.hover();
    await expect(cardSummary).toHaveCSS('background-color', closedHoverBackground);
    const closedRest = await cardSummary.evaluate((element) => getComputedStyle(element).backgroundColor);
    await cardSummary.evaluate((element) => (element as HTMLElement).scrollIntoView({ block: 'center' }));
    const cardBox = await cardSummary.boundingBox();
    if (!cardBox) throw new Error('Missing closed disclosure summary box.');
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await expect.poll(() => cardSummary.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(closedRest);
    await page.mouse.up();
    await expect(card).toHaveAttribute('open', '');
    await cardSummary.click();
    await expect(card).not.toHaveAttribute('open', '');

    await nestedSummary.hover();
    await expect(nestedSummary).toHaveCSS('background-color', closedHoverBackground);
    await nestedSummary.click();
    await expect(nestedSummary).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(nested.locator('.nodel-collapse-preview')).toBeHidden();

    await panelSummary.hover();
    await expect(panelSummary).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const panelRest = await panelSummary.evaluate((element) => getComputedStyle(element).backgroundColor);
    const panelBox = await panelSummary.boundingBox();
    if (!panelBox) throw new Error('Missing open disclosure summary box.');
    await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2);
    await page.mouse.down();
    await expect.poll(() => panelSummary.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(panelRest);
    await page.mouse.up();
    await panelSummary.click();
    if (testInfo.project.name === 'firefox-light-desktop') {
      await panelSummary.focus();
    } else {
      await tabTo(page, panelSummary);
    }
    await expect(panelSummary).toBeFocused();
    if (testInfo.project.name !== 'firefox-light-desktop') {
      await expect(panelSummary).toHaveCSS('box-shadow', /inset/);
    }

    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(panelSummary).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(panelSummary).toBeFocused();
    await expect(panel).toHaveAttribute('open', '');
    await expect(nested).toHaveAttribute('open', '');
  });

  test('keeps disclosure colours and focus usable in forced colours', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-forced-colors', 'Forced-colours disclosure checks run in the dedicated project.');
    await openCatalogue(page, 'Collapse');

    const system = await page.evaluate(() => {
      const resolveSystemColor = (value: string, property: 'background-color' | 'color') => {
        const reference = document.createElement('span');
        reference.style.position = 'fixed';
        reference.style.visibility = 'hidden';
        reference.style.left = '-9999px';
        reference.style.top = '-9999px';
        if (property === 'background-color') {
          reference.style.backgroundColor = value;
        } else {
          reference.style.color = value;
        }
        document.body.append(reference);
        const computed = getComputedStyle(reference);
        const resolved = property === 'background-color' ? computed.backgroundColor : computed.color;
        reference.remove();
        return resolved;
      };

      return {
        canvas: resolveSystemColor('Canvas', 'background-color'),
        canvasText: resolveSystemColor('CanvasText', 'color'),
        highlight: resolveSystemColor('Highlight', 'color')
      };
    });

    await page.evaluate(() => {
      const host = document.createElement('div');
      host.dataset.themeDisclosureFixture = '';
      host.innerHTML = `
        <details class="nodel-collapse nodel-panel" data-disclosure="panel">
          <summary class="nodel-collapse-summary">
            <span class="nodel-collapse-label">Panel disclosure</span>
            <span class="nodel-collapse-icon"></span>
          </summary>
          <div class="nodel-collapse-content">Panel disclosure content</div>
        </details>
        <details class="nodel-collapse nodel-card" data-disclosure="card">
          <summary class="nodel-collapse-summary">
            <span class="nodel-collapse-label">Card disclosure</span>
            <span class="nodel-collapse-icon"></span>
          </summary>
          <div class="nodel-collapse-content">Card disclosure content</div>
        </details>`;
      document.querySelector('nodel-page[data-page-id="Collapse"][active]')?.append(host);
    });

    const fixture = page.locator('[data-theme-disclosure-fixture]');
    const disclosures = ['panel', 'card'];

    for (const name of disclosures) {
      const disclosure = fixture.locator(`[data-disclosure="${name}"]`);
      const summary = disclosure.locator(':scope > .nodel-collapse-summary');

      await expect(disclosure).toHaveCSS('background-color', system.canvas);
      await expect(summary).toHaveCSS('background-color', system.canvas);
      await expect(summary).toHaveCSS('color', system.canvasText);

      const closedBg = await summary.evaluate((element) => getComputedStyle(element).backgroundColor);
      const closedColor = await summary.evaluate((element) => getComputedStyle(element).color);
      expect(closedBg).toBe(system.canvas);
      expect(closedColor).toBe(system.canvasText);

      const summaryRect = await summary.boundingBox();
      if (!summaryRect) throw new Error(`Missing forced-colours summary box for ${name} disclosure.`);
      await page.mouse.move(summaryRect.x + summaryRect.width / 2, summaryRect.y + summaryRect.height / 2);

      await page.mouse.down();
      const pressedBg = await summary.evaluate((element) => getComputedStyle(element).backgroundColor);
      const pressedColor = await summary.evaluate((element) => getComputedStyle(element).color);
      expect(pressedBg).toBe(system.canvas);
      expect(pressedColor).toBe(system.canvasText);
      await page.mouse.up();

      await disclosure.evaluate((element) => element.setAttribute('open', ''));
      await expect(disclosure).toHaveAttribute('open', '');
      await expect(summary).toHaveCSS('background-color', system.canvas);
      await expect(summary).toHaveCSS('color', system.canvasText);
      const openBg = await summary.evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(openBg).toBe(system.canvas);

      await page.mouse.move(summaryRect.x + summaryRect.width / 2, summaryRect.y + summaryRect.height / 2);
      await page.mouse.down();
      const openPressedBg = await summary.evaluate((element) => getComputedStyle(element).backgroundColor);
      const openPressedColor = await summary.evaluate((element) => getComputedStyle(element).color);
      expect(openPressedBg).toBe(system.canvas);
      expect(openPressedColor).toBe(system.canvasText);
      await page.mouse.up();
      await disclosure.evaluate((element) => element.setAttribute('open', ''));
      await expect(disclosure).toHaveAttribute('open', '');
      await expect(summary).toHaveCSS('background-color', system.canvas);
      await expect(summary).toHaveCSS('color', system.canvasText);

      await tabTo(page, summary);
      await expect(summary).toBeFocused();
      await expect(summary).toHaveCSS('outline-width', '3px');
      const focusColor = await summary.evaluate((element) => getComputedStyle(element).outlineColor);
      expect(focusColor).toBe(system.highlight);

      await disclosure.evaluate((element) => element.removeAttribute('open'));
      await expect(disclosure).not.toHaveAttribute('open', '');
    }
  });

  test('uses stronger focus outlines for the default button in increased contrast', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Preference checks run once for each desktop colour theme.');

    await setMediaFeature(page, 'prefers-contrast', 'more');
    const supported = await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches);
    test.skip(!supported, 'This Chromium build cannot emulate prefers-contrast.');

    await openCatalogue(page, 'Buttons');
    const defaultButton = page.locator('[data-catalogue-example="buttons-variants"]').getByRole('button', { name: 'Default' });
    await expectHighContrastFocus(defaultButton);
  });

  test('uses stronger focus outlines for ControlGrid controls in increased contrast', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Preference checks run once for each desktop colour theme.');

    await setMediaFeature(page, 'prefers-contrast', 'more');
    const supported = await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches);
    test.skip(!supported, 'This Chromium build cannot emulate prefers-contrast.');

    await openCatalogue(page, 'ControlGrid');
    const field = page.locator('[data-catalogue-example="links-native-choices"] .nodel-field');
    const link = page.locator('[data-catalogue-example="links-native-choices"] .nodel-link');
    const choice = page.locator('.nodel-choice').first();
    await expectHighContrastFocus(field);
    await expectHighContrastFocus(link);
    await expectHighContrastFocus(choice);
    await page.locator('[data-nav-group-id="Controls"]').click();
    await expectHighContrastFocus(page.locator('#nodel-menu-Controls .nodel-menu-item').first());
  });

  test('uses stronger focus outlines for the segmented option in increased contrast', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Preference checks run once for each desktop colour theme.');

    await setMediaFeature(page, 'prefers-contrast', 'more');
    const supported = await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches);
    test.skip(!supported, 'This Chromium build cannot emulate prefers-contrast.');

    await openCatalogue(page, 'TogglesSegmented');
    const segmentedOption = page.locator('[data-catalogue-example="toggles-segmented-choices"] nodel-segmented').first().locator('button').first();
    await expectHighContrastFocus(segmentedOption);
  });

  test('uses stronger focus outlines for the vertical fader in increased contrast', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Preference checks run once for each desktop colour theme.');

    await setMediaFeature(page, 'prefers-contrast', 'more');
    const supported = await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches);
    test.skip(!supported, 'This Chromium build cannot emulate prefers-contrast.');

    await openCatalogue(page, 'FadersMeters');
    const fader = page.locator('[data-catalogue-example="faders-vertical"] .nodel-fader-track').nth(1);
    await expectHighContrastFocus(fader);
  });

  test('uses stronger focus outlines for the disclosure in increased contrast', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Preference checks run once for each desktop colour theme.');

    await setMediaFeature(page, 'prefers-contrast', 'more');
    const supported = await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches);
    test.skip(!supported, 'This Chromium build cannot emulate prefers-contrast.');

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
    const link = page.locator('[data-catalogue-example="links-native-choices"] .nodel-link');
    const choice = page.locator('.nodel-choice');
    const field = page.locator('[data-catalogue-example="links-native-choices"] .nodel-field');
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
