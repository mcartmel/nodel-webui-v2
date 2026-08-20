import { expect, test, type Locator, type Page } from '@playwright/test';

async function openCatalogue(page: Page, pageId: string) {
  await page.goto(`/components.html#${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`nodel-page[data-page-id="${pageId}"][active]`).waitFor();
}

async function expectFocusIsNotClipped(control: Locator) {
  const result = await control.evaluate((element) => {
    const splitShadowLayers = (shadow: string) => {
      const layers: string[] = [];
      let depth = 0;
      let start = 0;
      for (let index = 0; index < shadow.length; index += 1) {
        const character = shadow.charAt(index);
        if (character === '(') depth += 1;
        if (character === ')') depth -= 1;
        if (character === ',' && depth === 0) {
          layers.push(shadow.slice(start, index).trim());
          start = index + 1;
        }
      }
      layers.push(shadow.slice(start).trim());
      return layers.filter(Boolean);
    };

    const parseColorAlpha = (color: string) => {
      const normalized = color.trim().toLowerCase();
      if (normalized === 'transparent') return 0;
      const body = normalized.match(/^[a-z]+\((.*)\)$/)?.[1];
      if (!body) return 1;
      const alphaToken = body.includes('/') ? body.split('/').at(-1) : body.split(',').length === 4 ? body.split(',').at(-1) : null;
      if (!alphaToken) return 1;
      const alpha = Number.parseFloat(alphaToken);
      if (Number.isFinite(alpha)) return alphaToken.includes('%') ? alpha / 100 : alpha;
      return 1;
    };

    const parseShadowExtents = (layer: string) => {
      if (/(^|\s)inset(\s|$)/i.test(layer)) return null;
      const color = layer.match(/(?:rgba?|hsla?)\([^)]*\)|\btransparent\b/i)?.[0];
      if (color && parseColorAlpha(color) <= 0) return null;
      const lengths = [...layer.replace(/(?:rgba?|hsla?)\([^)]*\)/gi, '').matchAll(/(-?\d*\.?\d+)px/g)]
        .map((match) => Number.parseFloat(match[1] ?? ''));
      if (lengths.length < 2) return null;
      const [offsetX = 0, offsetY = 0, rawBlur = 0, spread = 0] = lengths;
      const blur = Math.max(0, rawBlur);
      const blurAndSpread = blur + spread;
      const extents = {
        bottom: Math.max(0, blurAndSpread + offsetY),
        left: Math.max(0, blurAndSpread - offsetX),
        right: Math.max(0, blurAndSpread + offsetX),
        top: Math.max(0, blurAndSpread - offsetY)
      };
      return Object.values(extents).some((extent) => extent > 0) ? extents : null;
    };

    const style = getComputedStyle(element);
    const hasFocusVisible = element.matches(':focus-visible');
    const outlineWidth = Number.parseFloat(style.outlineWidth);
    const outlineOffset = Number.parseFloat(style.outlineOffset);
    const hasOutline = hasFocusVisible
      && style.outlineStyle !== 'none'
      && Number.isFinite(outlineWidth)
      && outlineWidth > 0
      && parseColorAlpha(style.outlineColor) > 0;

    const shadowLayers = hasFocusVisible && style.boxShadow !== 'none'
      ? splitShadowLayers(style.boxShadow).map((layer) => parseShadowExtents(layer)).filter((layer) => layer !== null)
      : [];
    const hasOuterShadow = shadowLayers.length > 0;

    const focusExtents = { bottom: 0, left: 0, right: 0, top: 0 };
    if (hasOutline && Number.isFinite(outlineOffset)) {
      const extent = Math.max(0, outlineWidth + outlineOffset);
      focusExtents.top = extent;
      focusExtents.right = extent;
      focusExtents.bottom = extent;
      focusExtents.left = extent;
    }
    for (const layer of shadowLayers) {
      focusExtents.top = Math.max(focusExtents.top, layer.top);
      focusExtents.right = Math.max(focusExtents.right, layer.right);
      focusExtents.bottom = Math.max(focusExtents.bottom, layer.bottom);
      focusExtents.left = Math.max(focusExtents.left, layer.left);
    }

    const rect = element.getBoundingClientRect();
    const expanded = {
      bottom: rect.bottom + focusExtents.bottom,
      left: rect.left - focusExtents.left,
      right: rect.right + focusExtents.right,
      top: rect.top - focusExtents.top
    };
    const clippingFailures: string[] = [];
    if (focusExtents.top > 0 || focusExtents.right > 0 || focusExtents.bottom > 0 || focusExtents.left > 0) {
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
      hasVisibleFocus: hasOutline || hasOuterShadow,
      insideViewport: rect.left >= 0 && rect.top >= 0
        && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
    };
  });
  expect(result.hasVisibleFocus).toBe(true);
  expect(result.insideViewport).toBe(true);
  expect(result.clippingFailures).toEqual([]);
}

test.describe('retained control and layout parity', () => {
  test('formats live palette values and renders partial compact states', async ({ page }, testInfo) => {
    const screenshotOptions = { maxDiffPixels: testInfo.project.name === 'chromium-forced-colors' ? 1500 : 150 };
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await openCatalogue(page, 'PickersPrecision');
    const palette = page.locator('[data-catalogue-example="palette-native"] nodel-palette');
    await expect(palette).toHaveAttribute('data-format', 'hsl');
    await expect(palette).toHaveAttribute('data-live', 'true');
    await expect(palette).toHaveAttribute('data-value-field', 'readonly');
    await expect(palette.locator('.nodel-palette-value-input')).toHaveAttribute('readonly', '');
    await expect(palette.locator('.nodel-palette-value-label > span')).toHaveCSS('position', 'absolute');
    const customControlHeights = await palette.locator('.nodel-palette-custom-input, .nodel-palette-value-input, .nodel-palette-custom-button').evaluateAll((elements) => (
      elements.map((element) => element.getBoundingClientRect().height)
    ));
    expect(Math.max(...customControlHeights) - Math.min(...customControlHeights)).toBeLessThanOrEqual(1);
    expect(Math.min(...customControlHeights)).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => {
      const element = document.querySelector('[data-catalogue-example="palette-native"] nodel-palette');
      element?.addEventListener('nodel-palette-change', (event) => {
        (window as typeof window & { paletteChange?: unknown }).paletteChange = (event as CustomEvent).detail;
      });
    });
    await palette.locator('.nodel-palette-custom-input').fill('#ff0000');
    await expect(palette).toHaveAttribute('value', '#ff0000');
    await expect(palette.locator('.nodel-palette-value-input')).toHaveValue('hsl(0, 100%, 50%)');
    await expect.poll(() => page.evaluate(() => (window as typeof window & { paletteChange?: { arg?: unknown } }).paletteChange?.arg)).toBe('hsl(0, 100%, 50%)');
    await expect(palette.locator('.nodel-palette-custom')).toHaveScreenshot('palette-live-format.png', screenshotOptions);

    await openCatalogue(page, 'Media');
    const indicators = page.locator('[data-catalogue-example="media-status-indicators"] nodel-status-indicator');
    await expect(indicators.nth(4)).toHaveAttribute('data-state', 'partially-on');
    await expect(indicators.nth(5)).toHaveAttribute('data-state', 'partially-off');
    await expect(indicators.nth(5)).toHaveAttribute('data-partial-tone', 'info');
    await expect(indicators.nth(5).locator('.nodel-status-indicator-label')).toHaveText('Some off');
    await expect(indicators.nth(5)).toHaveAttribute('aria-label', 'Zone state');
    await expect(page.locator('[data-catalogue-example="media-status-indicators"]')).toHaveScreenshot('partial-status-indicators.png', screenshotOptions);
    expect(requests.some((url) => /REST\/actions/.test(url))).toBe(false);
  });

  test('auto-places select panels without changing keyboard or source order', async ({ page }, testInfo) => {
    const screenshotOptions = { maxDiffPixels: testInfo.project.name === 'chromium-forced-colors' ? 1500 : 150 };
    await openCatalogue(page, 'PickersPrecision');
    const sourceSelect = page.locator('[data-catalogue-example="select-stepper"] nodel-select');
    for (const value of ['HDMI 2', 'USB-C']) {
      await sourceSelect.locator('.nodel-select-trigger').click();
      await sourceSelect.locator(`nodel-button[value="${value}"] button`).click();
    }
    await sourceSelect.locator('.nodel-select-trigger').click();
    const sourceOptionStates = await sourceSelect.locator('nodel-button').evaluateAll((options) => options.map((option) => ({
      active: option.hasAttribute('active'),
      tone: option.getAttribute('tone'),
      variant: option.getAttribute('variant')
    })));
    expect(sourceOptionStates).toEqual([
      { active: false, tone: null, variant: null },
      { active: false, tone: null, variant: null },
      { active: true, tone: 'soft', variant: 'primary' }
    ]);
    await sourceSelect.locator('.nodel-select-trigger').click();
    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'placement-fixture';
      fixture.className = 'nodel-panel';
      fixture.style.cssText = 'position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:60;padding-top:12rem';
      fixture.innerHTML = `
        <nodel-select placement="auto" label="Placement example">
          <nodel-button value="first">First</nodel-button>
          <nodel-button value="second">Second</nodel-button>
          <nodel-button value="third">Third</nodel-button>
        </nodel-select>
      `;
      document.querySelector('nodel-app')?.append(fixture);
    });
    const fixture = page.locator('#placement-fixture');
    const select = fixture.locator('nodel-select');
    const trigger = select.locator('.nodel-select-trigger');
    await trigger.click();
    await expect(select).toHaveAttribute('data-placement', 'top');
    const topGeometry = await page.evaluate(() => {
      const triggerRect = document.querySelector('#placement-fixture .nodel-select-trigger')!.getBoundingClientRect();
      const panelRect = document.querySelector('#placement-fixture .nodel-select-panel')!.getBoundingClientRect();
      return { panelBottom: Math.round(panelRect.bottom), triggerTop: Math.round(triggerRect.top) };
    });
    expect(topGeometry.panelBottom).toBeLessThanOrEqual(topGeometry.triggerTop);
    expect(await select.locator('nodel-button').allTextContents()).toEqual(['First', 'Second', 'Third']);
    await expect(fixture).toHaveScreenshot('select-auto-top.png', screenshotOptions);

    await fixture.evaluate((element) => {
      (element as HTMLElement).style.top = '6rem';
      (element as HTMLElement).style.bottom = 'auto';
      window.dispatchEvent(new Event('scroll'));
    });
    await expect(select).toHaveAttribute('data-placement', 'bottom');

    await fixture.evaluate((element) => element.remove());
    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'growth-placement-fixture';
      fixture.style.cssText = 'position:fixed;left:1rem;right:1rem;top:calc(100vh - 10rem);z-index:60';
      fixture.innerHTML = '<nodel-select placement="auto" label="Growing options"><nodel-button>First</nodel-button></nodel-select>';
      document.querySelector('nodel-app')?.append(fixture);
    });
    const growingSelect = page.locator('#growth-placement-fixture nodel-select');
    await growingSelect.locator('.nodel-select-trigger').click();
    await expect(growingSelect).toHaveAttribute('data-placement', 'bottom');
    await growingSelect.locator('.nodel-select-panel').evaluate((panel) => {
      for (let index = 2; index <= 12; index += 1) {
        const option = document.createElement('nodel-button');
        option.textContent = `Option ${index}`;
        panel.append(option);
      }
    });
    await expect(growingSelect).toHaveAttribute('data-placement', 'top');

    await openCatalogue(page, 'Responsive');
    const columns = page.locator('[data-catalogue-example="layout-responsive"] nodel-row').first().locator('nodel-column');
    expect(await columns.evaluateAll((elements) => elements.map((element) => element.textContent?.trim()))).toEqual(['Primary content', 'Supporting content']);
    const orders = await columns.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).order));
    const mobile = page.viewportSize()!.width < 768;
    expect(orders).toEqual(mobile ? ['2', '1'] : ['0', '0']);
    await expect(page.locator('[data-catalogue-example="layout-responsive"] nodel-row').first()).toHaveScreenshot('responsive-column-order.png', screenshotOptions);
  });

  test('keeps semantic button tiers and node-menu icon controls geometrically safe', async ({ page }) => {
    await page.goto('/nodel.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nodel-app')).toBeVisible();

    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.dataset.geometryContract = 'semantic-buttons';
      fixture.style.cssText = 'position:fixed;left:0;top:0;display:flex;gap:4px;z-index:100';
      fixture.innerHTML = `
        <button class="nodel-button" type="button">Standard</button>
        <button class="nodel-button nodel-button-compact" type="button">Compact</button>
        <button class="nodel-button nodel-button-touch" type="button">Touch</button>
      `;
      document.body.append(fixture);
    });

    const tierGeometry = await page.locator('[data-geometry-contract="semantic-buttons"] button').evaluateAll((buttons) => (
      buttons.map((button) => ({
        height: button.getBoundingClientRect().height,
        minHeight: getComputedStyle(button).minHeight
      }))
    ));
    expect(tierGeometry.map(({ minHeight }) => minHeight)).toEqual(['44px', '36px', '56px']);
    expect(tierGeometry[0]?.height).toBeGreaterThanOrEqual(44);
    expect(tierGeometry[1]?.height).toBeGreaterThanOrEqual(36);
    expect(tierGeometry[2]?.height).toBeGreaterThanOrEqual(56);

    const trigger = page.locator('[data-node-menu-open]');
    await expect(trigger).toBeVisible();
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(triggerBox?.width).toBeGreaterThanOrEqual(44);
    expect(triggerBox?.height).toBeGreaterThanOrEqual(44);
    expect(triggerBox?.width).toBeCloseTo(triggerBox?.height ?? 0, 0);

    await trigger.click();
    const close = page.locator('[data-node-menu-close]');
    await expect(close).toBeVisible();
    const closeBox = await close.boundingBox();
    expect(closeBox).not.toBeNull();
    expect(closeBox?.width).toBeGreaterThanOrEqual(44);
    expect(closeBox?.height).toBeGreaterThanOrEqual(44);
    expect(closeBox?.width).toBeCloseTo(closeBox?.height ?? 0, 0);
  });

  test('grows vertical fader tracks while preserving intrinsic and explicit sizing', async ({ page }) => {
    await page.goto('/nodel.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nodel-app')).toBeVisible();

    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.dataset.geometryContract = 'vertical-fader-height';
      fixture.style.cssText = 'position:fixed;left:0;top:0;width:48rem;height:36rem;display:flex;gap:1rem;align-items:stretch;padding:1rem;z-index:100';
      fixture.innerHTML = `
        <nodel-group label="Tall nudged" style="height:32rem;width:10rem">
          <nodel-fader nudge="5">
            <nodel-meter value="50"></nodel-meter>
            <nodel-status-indicator state="on" label="Active"></nodel-status-indicator>
            <nodel-button>Mute</nodel-button>
          </nodel-fader>
        </nodel-group>
        <div data-fader-slot="plain" style="height:32rem;width:10rem">
          <nodel-fader></nodel-fader>
        </div>
        <div data-fader-slot="explicit" style="height:32rem;width:10rem">
          <nodel-fader nudge="5" style="--nodel-fader-length:10rem"></nodel-fader>
        </div>
        <div data-fader-slot="explicit-plain" style="height:32rem;width:10rem">
          <nodel-fader style="--nodel-fader-length-no-increment:9rem"></nodel-fader>
        </div>
      `;
      document.body.append(fixture);

      const intrinsic = document.createElement('div');
      intrinsic.dataset.faderSlot = 'intrinsic';
      intrinsic.style.cssText = 'position:absolute;left:-10000px;top:0;display:flex;gap:1rem;align-items:flex-start';
      intrinsic.innerHTML = '<nodel-fader nudge="5"></nodel-fader><nodel-fader></nodel-fader>';
      fixture.append(intrinsic);

      const floor = document.createElement('div');
      floor.dataset.faderSlot = 'floor';
      floor.style.cssText = 'position:absolute;left:-10000px;top:20rem;display:flex;gap:1rem';
      floor.innerHTML = '<nodel-fader nudge="5" style="--nodel-fader-length:2rem"></nodel-fader><nodel-fader style="--nodel-fader-length-no-increment:2rem"></nodel-fader>';
      fixture.append(floor);

      const horizontal = document.createElement('nodel-fader');
      horizontal.setAttribute('orientation', 'horizontal');
      horizontal.dataset.faderSlot = 'horizontal';
      horizontal.style.cssText = 'position:absolute;left:0;top:34rem;width:12rem;height:2.5rem';
      fixture.append(horizontal);
    });

    const geometry = await page.evaluate(() => {
      const root = document.querySelector('[data-geometry-contract="vertical-fader-height"]')!;
      const rect = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
      const track = (selector: string) => root.querySelector(`${selector} .nodel-fader-track`)!.getBoundingClientRect();
      const nudged = root.querySelector('nodel-group nodel-fader')!;
      const control = nudged.querySelector('.nodel-fader-control')!.getBoundingClientRect();
      const up = nudged.querySelector('.nodel-fader-nudge-up')!.getBoundingClientRect();
      const down = nudged.querySelector('.nodel-fader-nudge-down')!.getBoundingClientRect();
      const plain = root.querySelector('[data-fader-slot="plain"] nodel-fader')!;
      const plainControl = plain.querySelector('.nodel-fader-control')!.getBoundingClientRect();
      const rail = nudged.querySelector('.nodel-fader-rail')!.getBoundingClientRect();
      const railChildren = [...nudged.querySelectorAll('.nodel-fader-rail > *')].map((child) => {
        const childRect = child.getBoundingClientRect();
        return { top: childRect.top, bottom: childRect.bottom, left: childRect.left, right: childRect.right };
      });
      const intrinsic = root.querySelector('[data-fader-slot="intrinsic"]')!;
      const intrinsicControls = [...intrinsic.querySelectorAll('nodel-fader .nodel-fader-control')].map((controlNode) => controlNode.getBoundingClientRect());
      const nudgedTrack = nudged.querySelector<HTMLElement>('.nodel-fader-track')!;
      nudgedTrack.focus();
      const floorTracks = [...root.querySelectorAll('[data-fader-slot="floor"] .nodel-fader-track')]
        .map((trackNode) => trackNode.getBoundingClientRect().height);
      return {
        control: { top: control.top, bottom: control.bottom, left: control.left, right: control.right },
        buttons: { top: up.top, bottom: down.bottom },
        plainControl: { top: plainControl.top, bottom: plainControl.bottom },
        plainTrack: track('[data-fader-slot="plain"] nodel-fader'),
        nudgedTrack: { top: nudgedTrack.getBoundingClientRect().top, bottom: nudgedTrack.getBoundingClientRect().bottom, height: nudgedTrack.getBoundingClientRect().height },
        explicitTrack: track('[data-fader-slot="explicit"] nodel-fader').height,
        explicitPlainTrack: track('[data-fader-slot="explicit-plain"] nodel-fader').height,
        intrinsicControls,
        rail: { top: rail.top, bottom: rail.bottom, left: rail.left, right: rail.right },
        railChildren,
        floorTracks,
        horizontal: {
          control: rect('[data-fader-slot="horizontal"] .nodel-fader-control'),
          track: rect('[data-fader-slot="horizontal"] .nodel-fader-track')
        }
      };
    });

    expect(geometry.buttons.top).toBeCloseTo(geometry.control.top, 0);
    expect(geometry.buttons.bottom).toBeCloseTo(geometry.control.bottom, 0);
    expect(geometry.nudgedTrack.height).toBeGreaterThan(192);
    expect(geometry.nudgedTrack.top).toBeGreaterThanOrEqual(geometry.control.top - 1);
    expect(geometry.nudgedTrack.bottom).toBeLessThanOrEqual(geometry.control.bottom + 1);
    expect(geometry.plainTrack.height).toBeGreaterThan(192);
    expect(geometry.plainTrack.top).toBeCloseTo(geometry.plainControl.top, 0);
    expect(geometry.plainTrack.bottom).toBeCloseTo(geometry.plainControl.bottom, 0);
    expect(geometry.intrinsicControls[0]?.height).toBeCloseTo(geometry.intrinsicControls[1]?.height ?? 0, 0);
    for (const child of geometry.railChildren) {
      expect(child.top).toBeGreaterThanOrEqual(geometry.rail.top - 1);
      expect(child.bottom).toBeLessThanOrEqual(geometry.rail.bottom + 1);
      expect(child.left).toBeGreaterThanOrEqual(geometry.rail.left - 1);
      expect(child.right).toBeLessThanOrEqual(geometry.rail.right + 1);
    }
    for (let index = 1; index < geometry.railChildren.length; index += 1) {
      expect(geometry.railChildren[index]?.top).toBeGreaterThanOrEqual((geometry.railChildren[index - 1]?.bottom ?? 0) - 1);
    }
    expect(geometry.rail.left).toBeGreaterThanOrEqual(geometry.control.right - 1);
    expect(geometry.floorTracks[0]).toBeCloseTo(128, 0);
    expect(geometry.floorTracks[1]).toBeCloseTo(128, 0);
    expect(geometry.explicitTrack).toBeCloseTo(160, 0);
    expect(geometry.explicitPlainTrack).toBeCloseTo(144, 0);
    expect(geometry.horizontal.track.height).toBeCloseTo(40, 0);
    expect(geometry.horizontal.track.width).toBeCloseTo(geometry.horizontal.control.width, 0);
    expect(geometry.horizontal.track.left).toBeCloseTo(geometry.horizontal.control.left, 0);
    expect(geometry.horizontal.track.right).toBeCloseTo(geometry.horizontal.control.right, 0);
    await expectFocusIsNotClipped(page.locator('[data-geometry-contract="vertical-fader-height"] nodel-group .nodel-fader-track'));
  });
});
