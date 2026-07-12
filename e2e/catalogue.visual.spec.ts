import { expect, test, type Page, type TestInfo } from '@playwright/test';

const animationReset = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

async function openCatalogue(page: Page, pageId: string) {
  await page.goto(`/components.html#${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`nodel-page[data-page-id="${pageId}"][active]`).waitFor();
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });
  await page.addStyleTag({ content: animationReset });
}

async function captureCatalogueExample(page: Page, pageId: string, exampleId: string, screenshot: string) {
  await openCatalogue(page, pageId);
  const example = page.locator(`[data-catalogue-example="${exampleId}"]`);
  await expect(example).toBeVisible();
  await expect(example).toHaveScreenshot(screenshot);
}

function isDesktopThemeProject(testInfo: TestInfo) {
  return testInfo.project.name === 'chromium-light-desktop' || testInfo.project.name === 'chromium-dark-desktop';
}

function isForcedColoursProject(testInfo: TestInfo) {
  return testInfo.project.name === 'chromium-forced-colors';
}

test.describe('catalogue visual regressions', () => {
  test('captures representative control variants', async ({ page }, testInfo) => {
    test.skip(isForcedColoursProject(testInfo), 'Forced-colours uses assertions instead of pixel baselines.');

    await captureCatalogueExample(page, 'Buttons', 'buttons-variants', 'buttons-variants.png');
    await captureCatalogueExample(page, 'TogglesSegmented', 'toggles-switch-states', 'toggle-states.png');
    await captureCatalogueExample(page, 'TogglesSegmented', 'toggles-segmented-choices', 'segmented-choices.png');
    await captureCatalogueExample(page, 'PickersPrecision', 'select-stepper', 'pickers-and-stepper.png');
    await captureCatalogueExample(page, 'PickersPrecision', 'readouts', 'readouts.png');
    await captureCatalogueExample(page, 'FadersMeters', 'faders-compound-fader', 'faders-and-meters.png');
    await captureCatalogueExample(page, 'Media', 'media-status-blocks', 'status-variants.png');
    await captureCatalogueExample(page, 'Text', 'content-text-surface', 'content-surfaces.png');
    await captureCatalogueExample(page, 'ControlGrid', 'feedback-states', 'feedback-states.png');
  });

  test('keeps the mobile toolbar in view and captures its open group menu', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes('mobile'), 'This geometry check is specific to the narrow viewport.');

    await openCatalogue(page, 'TogglesSegmented');
    const toolbar = page.locator('nodel-toolbar');
    await expect(toolbar).toBeVisible();

    const hasHorizontalOverflow = await toolbar.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(hasHorizontalOverflow).toBe(false);

    await page.locator('[data-nav-group-id="Controls"]').click();
    const menu = page.locator('#nodel-menu-Controls');
    await expect(menu).toBeVisible();

    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390);

    await expect(page).toHaveScreenshot('toolbar-open-group-mobile.png');

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const scrolledMenuBox = await menu.boundingBox();
    expect(scrolledMenuBox).not.toBeNull();
    expect(scrolledMenuBox!.y).toBeGreaterThanOrEqual(0);
  });

  test('keeps narrow navigation scrollable through portrait and landscape', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.includes('mobile'), 'This geometry check is specific to narrow viewports.');

    await page.setViewportSize({ width: 320, height: 568 });
    await openCatalogue(page, 'TogglesSegmented');
    const nav = page.locator('[data-toolbar-nav-list]');
    const documentOverflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(documentOverflows).toBe(false);

    const navMetrics = await nav.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      return { clientWidth: element.clientWidth, scrollLeft: element.scrollLeft, scrollWidth: element.scrollWidth };
    });
    expect(navMetrics.scrollWidth).toBeGreaterThan(navMetrics.clientWidth);
    expect(navMetrics.scrollLeft).toBeGreaterThan(0);

    await page.locator('[data-nav-group-id="Controls"]').click();
    await page.setViewportSize({ width: 568, height: 320 });
    const menu = page.locator('#nodel-menu-Controls');
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(568);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(320);
  });

  test('captures the remaining catalogue states and public overlays', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Focused state baselines run for the desktop themes.');

    await page.route('**/REST/actions/CatalogueBusy/call', () => new Promise<void>(() => {}));
    await openCatalogue(page, 'ControlGrid');
    const states = page.locator('[data-catalogue-example="control-data-states"]');
    await states.locator('[data-catalogue-busy] button').click();
    await expect(states.locator('[data-catalogue-busy] button')).toHaveClass(/is-busy/);
    await expect(states.locator('[data-catalogue-partial-toggle] button')).toHaveAttribute('aria-checked', 'mixed');
    await expect(states.locator('.nodel-editor-status')).toBeVisible();
    await expect(states.locator('[data-catalogue-console-empty] .nodel-console-empty')).toBeVisible();
    await expect(states.locator('[data-catalogue-log-empty] .nodel-log-empty')).toBeVisible();
    await expect(states).toHaveScreenshot('control-data-states.png');

    await captureCatalogueExample(page, 'ControlGrid', 'surface-hierarchy', 'surface-hierarchy.png');

    await page.locator('nodel-app').evaluate((app) => {
      app.dispatchEvent(new CustomEvent('nodel-confirm', {
        bubbles: true,
        cancelable: true,
        detail: { title: 'Confirm catalogue action', text: 'This dialog is opened through the public event.', tone: 'warning', resolve: () => {} }
      }));
    });
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Confirm' })).toBeFocused();
    await expect(page).toHaveScreenshot('confirm-dialog.png');
    await confirm.getByRole('button', { name: 'Cancel' }).click();

    await page.locator('nodel-app').evaluate((app) => {
      app.dispatchEvent(new CustomEvent('nodel-toast', {
        bubbles: true,
        detail: { message: 'Catalogue notification', detail: 'Opened through the public event.', tone: 'success', persistent: true }
      }));
    });
    const toast = page.locator('.nodel-toast');
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Dismiss notification' }).focus();
    await expect(toast).toHaveScreenshot('toast.png');
  });

  test('renders the readout ring fallback without masks', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Focused fallback baselines run for the desktop themes.');

    await openCatalogue(page, 'PickersPrecision');
    await page.addStyleTag({ content: `
      nodel-readout[data-visual='ring'] .nodel-readout-visual { -webkit-mask: none !important; mask: none !important; }
      nodel-readout[data-visual='ring'] .nodel-readout-visual::after { display: block !important; }
    ` });
    const readouts = page.locator('[data-catalogue-example="readouts"]');
    const ring = readouts.locator('nodel-readout[data-visual="ring"]').first();
    await expect(ring).toBeVisible();
    await expect(ring.locator('.nodel-readout-value')).toBeVisible();
    const fallback = await ring.locator('.nodel-readout-visual').evaluate((element) => {
      const visual = getComputedStyle(element);
      const centre = getComputedStyle(element, '::after');
      return { centreBackground: centre.backgroundColor, centreDisplay: centre.display, height: element.clientHeight, width: element.clientWidth, mask: visual.maskImage, webkitMask: visual.webkitMaskImage };
    });
    const surface = await page.locator('html').evaluate((element) => getComputedStyle(element).getPropertyValue('--nodel-surface').trim());
    expect(fallback.centreDisplay).not.toBe('none');
    expect(fallback.centreBackground.replace(/[\s,]/g, '')).toBe(`rgb(${surface})`.replace(/[\s,]/g, ''));
    expect(fallback.height).toBe(fallback.width);
    expect(fallback.mask).toBe('none');
    expect(fallback.webkitMask).toBe('none');
    await expect(readouts).toHaveScreenshot('readout-mask-fallback.png');
  });
  test('keeps forced-colours controls visible and usable', async ({ page }, testInfo) => {
    test.skip(!isForcedColoursProject(testInfo), 'Forced-colours assertions run in the dedicated project.');

    await openCatalogue(page, 'Buttons');
    const variants = page.locator('[data-catalogue-example="buttons-variants"]');
    await expect(variants.locator('button')).toHaveCount(8);
    await expect(variants.getByRole('button', { name: 'Primary' })).toBeVisible();

    expect(testInfo.project.use.contextOptions?.forcedColors).toBe('active');
    const forcedColoursActive = await page.evaluate(() => matchMedia('(forced-colors: active)').matches);
    expect(forcedColoursActive).toBe(true);

    const border = await variants.getByRole('button', { name: 'Default' }).evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.borderTopColor, width: Number.parseFloat(style.borderTopWidth) };
    });
    expect(border.width).toBeGreaterThan(0);
    expect(border.color).not.toBe('rgba(0, 0, 0, 0)');

    const highlight = await page.evaluate(() => {
      const sample = document.createElement('div');
      sample.style.background = 'Highlight';
      document.body.append(sample);
      const color = getComputedStyle(sample).backgroundColor;
      sample.remove();
      return color;
    });
    const primaryBackground = await variants.getByRole('button', { name: 'Primary' }).evaluate(
      (element) => getComputedStyle(element).backgroundColor
    );
    expect(primaryBackground).toBe(highlight);

    await openCatalogue(page, 'TogglesSegmented');
    const segmentedActive = page.locator('nodel-segmented nodel-button[active] button').first();
    await expect(segmentedActive).toBeVisible();
    await expect(segmentedActive).toHaveCSS('background-color', highlight);

    await page.locator('[data-nav-group-id="Controls"]').click();
    const activeMenuItem = page.locator('#nodel-menu-Controls .nodel-menu-item-active');
    await expect(activeMenuItem).toBeVisible();
    await expect(activeMenuItem).toHaveCSS('background-color', highlight);
  });
});
