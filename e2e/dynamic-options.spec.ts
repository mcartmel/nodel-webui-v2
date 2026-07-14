import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

type ActivityEntry = { alias: string; arg: unknown; seq: number };
const animationReset = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

function isDesktopThemeProject(testInfo: TestInfo) {
  return testInfo.project.name === 'chromium-light-desktop' || testInfo.project.name === 'chromium-dark-desktop';
}

function isDesktopOrForcedColoursProject(testInfo: TestInfo) {
  return isDesktopThemeProject(testInfo) || testInfo.project.name === 'chromium-forced-colors';
}

function isForcedColoursProject(testInfo: TestInfo) {
  return testInfo.project.name === 'chromium-forced-colors';
}

async function readButtonPaint(button: Locator) {
  return button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundImage: style.backgroundImage,
      borderTopColor: style.borderTopColor,
      color: style.color,
      filter: style.filter
    };
  });
}

async function openNodeBackedCatalogue(page: Page, activityEntries: ActivityEntry[], liveEntries: ActivityEntry[] = []) {
  let liveDelivered = false;
  await page.addInitScript(() => {
    class BlockedWebSocket {
      constructor() {
        throw new Error('WebSocket blocked for polling test');
      }
    }
    window.WebSocket = BlockedWebSocket as never;
  });

  await page.route('**/nodes/Demo/REST/activity?from=*', async (route) => {
    const url = new URL(route.request().url());
    const from = url.searchParams.get('from');
    const sourceEntries = from === '-1' ? activityEntries : (!liveDelivered ? liveEntries : []);
    if (from !== '-1') {
      liveDelivered = true;
    }
    const responseEntries = sourceEntries.map((entry) => ({
        seq: entry.seq,
        timestamp: `2026-07-13T00:00:0${entry.seq}Z`,
        source: 'local',
        type: 'event',
        alias: entry.alias,
        arg: entry.arg
      }));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(responseEntries) });
  });

  await page.goto('/components.html#PickersPrecision', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.history.replaceState(null, '', '/nodes/Demo/components.html#PickersPrecision');
  });
  await page.locator('nodel-page[data-page-id="PickersPrecision"][active]').waitFor();
  await page.addStyleTag({ content: animationReset });
}

test.describe('dynamic options', () => {
  test('renders activity-backed options with native semantics and shared actions', async ({ page }, testInfo) => {
    test.skip(isForcedColoursProject(testInfo), 'Forced-colours coverage focuses on state treatment.');

    let sourcePayload: unknown = null;
    let modePayload: unknown = null;
    await page.route('**/nodes/Demo/REST/actions/SetSource/call', async (route) => {
      sourcePayload = route.request().postDataJSON();
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.route('**/nodes/Demo/REST/actions/SetMode/call', async (route) => {
      modePayload = route.request().postDataJSON();
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await openNodeBackedCatalogue(page, [
      { seq: 1, alias: 'AvailableSources', arg: [{ value: 'hdmi1', label: 'HDMI 1' }, { value: 'hdmi2', label: 'HDMI 2' }] },
      { seq: 2, alias: 'CurrentSource', arg: 'hdmi2' },
      { seq: 3, alias: 'AvailableModes', arg: ['Auto', { key: 'manual', value: 'Manual' }] },
      { seq: 4, alias: 'CurrentMode', arg: 'Auto' }
    ]);
    await page.locator('nodel-page[data-page-id="PickersPrecision"][active] [data-page-content]').evaluate((pageContent) => {
      const fixture = document.createElement('section');
      fixture.dataset.dynamicOptionsFixture = '';
      fixture.innerHTML = `
        <nodel-control-grid columns="1" md="2">
          <nodel-group label="Dynamic source">
            <nodel-select options-signal="AvailableSources" signal="CurrentSource" action="SetSource">
              <nodel-button value="Fallback">Fallback source</nodel-button>
            </nodel-select>
          </nodel-group>
          <nodel-group label="Dynamic mode">
            <nodel-segmented orientation="vertical" signals="AvailableModes:options; CurrentMode:value" action="SetMode">
              <nodel-button value="Auto">Auto</nodel-button>
            </nodel-segmented>
          </nodel-group>
        </nodel-control-grid>
      `;
      pageContent.prepend(fixture);
    });

    const fixture = page.locator('[data-dynamic-options-fixture]');
    const select = fixture.locator('nodel-select');
    const segmented = fixture.locator('nodel-segmented');
    await expect(select).toHaveAttribute('data-options-state', 'ready');
    await expect(segmented).toHaveAttribute('data-options-state', 'ready');
    await expect(select.locator('.nodel-select-value')).toHaveText('HDMI 2');
    await expect(select.locator('nodel-button')).toHaveText(['HDMI 1', 'HDMI 2']);
    await expect(segmented.locator('nodel-button')).toHaveText(['Auto', 'Manual']);

    await select.locator('.nodel-select-trigger').focus();
    await page.keyboard.press('ArrowDown');
    await expect(select.locator('nodel-button[value="hdmi2"] button')).toBeFocused();
    await expect(select.locator('nodel-button[value="hdmi2"] button')).toHaveAttribute('role', 'option');
    await expect(select.locator('nodel-button[value="hdmi2"] button')).toHaveAttribute('aria-selected', 'true');
    await expect(segmented.locator('nodel-button[value="Auto"] button')).toHaveAttribute('role', 'radio');
    await expect(segmented.locator('nodel-button[value="Auto"] button')).toHaveAttribute('aria-checked', 'true');

    await segmented.locator('nodel-button[value="Auto"] button').focus();
    await page.keyboard.press('ArrowDown');
    await expect(segmented.locator('nodel-button[value="manual"] button')).toBeFocused();
    await expect.poll(() => modePayload).toEqual({ arg: 'manual' });

    const axe = await new AxeBuilder({ page }).include('[data-dynamic-options-fixture]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(axe.violations).toEqual([]);

    await select.locator('nodel-button[value="hdmi1"] button').click();
    await expect.poll(() => sourcePayload).toEqual({ arg: 'hdmi1' });
  });

  test('preserves active segmented contrast on hover in light mode', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-light-desktop', 'Regression targets light desktop hover contrast.');

    await openNodeBackedCatalogue(page, [
      { seq: 1, alias: 'AvailableModes', arg: ['Auto', 'Manual'] },
      { seq: 2, alias: 'CurrentMode', arg: 'Auto' }
    ]);
    await page.locator('nodel-page[data-page-id="PickersPrecision"][active] [data-page-content]').evaluate((pageContent) => {
      const fixture = document.createElement('section');
      fixture.dataset.segmentedHoverFixture = '';
      fixture.innerHTML = '<nodel-segmented options-signal="AvailableModes" signal="CurrentMode"></nodel-segmented>';
      pageContent.prepend(fixture);
    });

    const activeButton = page.locator('[data-segmented-hover-fixture] nodel-segmented nodel-button[value="Auto"] button');
    await expect(activeButton).toBeVisible();
    await expect(activeButton).toHaveAttribute('aria-checked', 'true');
    const rest = await readButtonPaint(activeButton);

    await activeButton.hover();
    const hovered = await readButtonPaint(activeButton);

    expect(hovered.backgroundImage).not.toBe(rest.backgroundImage);
    expect(hovered.backgroundImage).toContain('linear-gradient');
    expect(hovered.borderTopColor).not.toBe(rest.borderTopColor);
    expect(hovered.color).toBe(rest.color);
    expect(hovered.filter).toBe('none');
  });

  test('keeps loading, fallback, empty, and error states accessible', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'coverage', description: isDesktopOrForcedColoursProject(testInfo) ? 'desktop/forced-colours state coverage' : 'mobile state coverage' });

    await openNodeBackedCatalogue(page, [
      { seq: 1, alias: 'ReadySources', arg: ['HDMI 1'] },
      { seq: 2, alias: 'EmptySources', arg: [] },
      { seq: 3, alias: 'BadSources', arg: ['A', 'A'] },
      { seq: 4, alias: 'ReadyModes', arg: ['Auto'] },
      { seq: 5, alias: 'EmptyModes', arg: [] },
      { seq: 6, alias: 'BadModes', arg: ['Auto', 'Auto'] }
    ]);
    await page.locator('nodel-page[data-page-id="PickersPrecision"][active] [data-page-content]').evaluate((pageContent) => {
      const fixture = document.createElement('section');
      fixture.dataset.dynamicOptionsStateFixture = '';
      fixture.innerHTML = `
        <nodel-control-grid columns="1" md="2">
          <nodel-select options-signal="ReadySources"></nodel-select>
          <nodel-select options-signal="MissingSources"></nodel-select>
          <nodel-select options-signal="FallbackSources">
            <nodel-button value="Fallback">Fallback source</nodel-button>
          </nodel-select>
          <nodel-select options-signal="EmptySources"></nodel-select>
          <nodel-select options-signal="BadSources"></nodel-select>
          <nodel-segmented options-signal="ReadyModes"></nodel-segmented>
          <nodel-segmented options-signal="MissingModes">
            <nodel-button value="Fallback">Fallback mode</nodel-button>
          </nodel-segmented>
          <nodel-segmented options-signal="EmptyModes"></nodel-segmented>
          <nodel-segmented options-signal="BadModes"></nodel-segmented>
        </nodel-control-grid>
      `;
      pageContent.prepend(fixture);
    });

    const fixture = page.locator('[data-dynamic-options-state-fixture]');
    const controls = fixture.locator('nodel-select');
    const segmented = fixture.locator('nodel-segmented');
    await expect(controls.nth(0)).toHaveAttribute('data-options-state', 'ready');
    await expect(controls.nth(1)).toHaveAttribute('data-options-state', 'loading');
    await expect(controls.nth(1).locator('.nodel-options-status')).toHaveText('Loading options...');
    await expect(controls.nth(2)).toHaveAttribute('data-options-state', 'loading');
    await expect(controls.nth(2).locator('nodel-button')).toHaveText('Fallback source');
    await expect(controls.nth(2).locator('.nodel-options-status')).toBeHidden();
    await expect(controls.nth(3)).toHaveAttribute('data-options-state', 'empty');
    await expect(controls.nth(3).locator('.nodel-options-status')).toHaveText('No options');
    await expect(controls.nth(4)).toHaveAttribute('data-options-state', 'error');
    await expect(controls.nth(4).locator('.nodel-options-status')).toHaveText('Options unavailable');
    await expect(segmented.nth(0)).toHaveAttribute('data-options-state', 'ready');
    await expect(segmented.nth(1)).toHaveAttribute('data-options-state', 'loading');
    await expect(segmented.nth(1).locator('nodel-button')).toHaveText('Fallback mode');
    await expect(segmented.nth(2)).toHaveAttribute('data-options-state', 'empty');
    await expect(segmented.nth(2).locator('.nodel-options-status')).toHaveText('No options');
    await expect(segmented.nth(3)).toHaveAttribute('data-options-state', 'error');
    await expect(segmented.nth(3).locator('.nodel-options-status')).toHaveText('Options unavailable');

    await controls.nth(0).locator('.nodel-select-trigger').focus();
    await expect(controls.nth(0).locator('.nodel-select-trigger')).toBeFocused();
    const focusBox = await controls.nth(0).locator('.nodel-select-trigger').boundingBox();
    expect(focusBox?.x).toBeGreaterThanOrEqual(0);
    expect(focusBox?.y).toBeGreaterThanOrEqual(0);

    const axe = await new AxeBuilder({ page }).include('[data-dynamic-options-state-fixture]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(axe.violations).toEqual([]);
  });

  test('reconciles dynamic replacements from later activity polls', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Polling replacement path is covered once for each desktop colour theme.');

    await openNodeBackedCatalogue(page, [
      { seq: 1, alias: 'AvailableSources', arg: ['HDMI 1', 'HDMI 2'] },
      { seq: 2, alias: 'CurrentSource', arg: 'HDMI 1' },
      { seq: 3, alias: 'AvailableModes', arg: ['Auto', 'Manual'] },
      { seq: 4, alias: 'CurrentMode', arg: 'Auto' }
    ], [
      { seq: 5, alias: 'AvailableSources', arg: [{ value: 'usb-c', label: 'USB-C' }, { value: 'hdmi3', label: 'HDMI 3' }] },
      { seq: 6, alias: 'CurrentSource', arg: 'hdmi3' },
      { seq: 7, alias: 'AvailableModes', arg: [{ key: 'eco', value: 'Eco' }, { key: 'boost', value: 'Boost' }] },
      { seq: 8, alias: 'CurrentMode', arg: 'boost' }
    ]);
    await page.locator('nodel-page[data-page-id="PickersPrecision"][active] [data-page-content]').evaluate((pageContent) => {
      const fixture = document.createElement('section');
      fixture.dataset.dynamicOptionsReplaceFixture = '';
      fixture.innerHTML = `
        <nodel-control-grid columns="1" md="2">
          <nodel-select options-signal="AvailableSources" signal="CurrentSource"></nodel-select>
          <nodel-segmented options-signal="AvailableModes" signal="CurrentMode"></nodel-segmented>
        </nodel-control-grid>
      `;
      pageContent.prepend(fixture);
    });

    const fixture = page.locator('[data-dynamic-options-replace-fixture]');
    await expect(fixture.locator('nodel-select nodel-button')).toHaveText(['HDMI 1', 'HDMI 2']);
    await expect(fixture.locator('nodel-segmented nodel-button')).toHaveText(['Auto', 'Manual']);
    await expect(fixture.locator('nodel-select nodel-button')).toHaveText(['USB-C', 'HDMI 3'], { timeout: 3000 });
    await expect(fixture.locator('nodel-select .nodel-select-value')).toHaveText('HDMI 3');
    await expect(fixture.locator('nodel-segmented nodel-button')).toHaveText(['Eco', 'Boost']);
    await expect(fixture.locator('nodel-segmented nodel-button[value="boost"] button')).toHaveAttribute('aria-checked', 'true');
  });

  test('captures dynamic option state treatment', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Focused visual baseline runs for desktop colour themes.');

    await openNodeBackedCatalogue(page, [
      { seq: 1, alias: 'ReadySources', arg: ['HDMI 1'] },
      { seq: 2, alias: 'EmptySources', arg: [] },
      { seq: 3, alias: 'BadSources', arg: ['A', 'A'] },
      { seq: 4, alias: 'EmptyModes', arg: [] },
      { seq: 5, alias: 'BadModes', arg: ['Auto', 'Auto'] }
    ]);
    await page.locator('nodel-page[data-page-id="PickersPrecision"][active] [data-page-content]').evaluate((pageContent) => {
      const fixture = document.createElement('section');
      fixture.dataset.dynamicOptionsVisualFixture = '';
      fixture.className = 'nodel-panel p-4';
      fixture.innerHTML = `
        <nodel-control-grid columns="1" md="2">
          <nodel-select options-signal="MissingSources"></nodel-select>
          <nodel-select options-signal="EmptySources"></nodel-select>
          <nodel-select options-signal="BadSources"></nodel-select>
          <nodel-segmented options-signal="MissingModes"></nodel-segmented>
          <nodel-segmented options-signal="EmptyModes"></nodel-segmented>
          <nodel-segmented options-signal="BadModes"></nodel-segmented>
        </nodel-control-grid>
      `;
      pageContent.prepend(fixture);
    });

    const fixture = page.locator('[data-dynamic-options-visual-fixture]');
    await expect(fixture.locator('nodel-select').nth(0)).toHaveAttribute('data-options-state', 'loading');
    await expect(fixture.locator('nodel-select').nth(1)).toHaveAttribute('data-options-state', 'empty');
    await expect(fixture.locator('nodel-select').nth(2)).toHaveAttribute('data-options-state', 'error');
    await expect(fixture.locator('nodel-segmented').nth(0)).toHaveAttribute('data-options-state', 'loading');
    await expect(fixture.locator('nodel-segmented').nth(1)).toHaveAttribute('data-options-state', 'empty');
    await expect(fixture.locator('nodel-segmented').nth(2)).toHaveAttribute('data-options-state', 'error');
    await expect(fixture).toHaveScreenshot('dynamic-option-states.png');
  });
});
