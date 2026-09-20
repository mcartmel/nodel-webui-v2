import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

const patterns = [
  'carbon-fibre', 'checkerplate', 'brushed-metal', 'woven-fabric', 'diagonal-grain',
  'dotted-grid', 'hexagonal-mesh', 'ripples', 'concentric-waves'
] as const;
const patternDimensions = [
  ['carbon-fibre', 48, 48], ['checkerplate', 192, 192], ['brushed-metal', 768, 192],
  ['woven-fabric', 192, 192], ['diagonal-grain', 32, 32], ['dotted-grid', 48, 48],
  ['hexagonal-mesh', 60, 52], ['ripples', 240, 96], ['concentric-waves', 360, 240]
] as const;
const seamBases = [
  { css: '#202b38', rgb: [32, 43, 56] },
  { css: '#e8edf2', rgb: [232, 237, 242] }
] as const;
type SeamBase = { css: string; rgb: readonly [number, number, number] };
const releaseProjects = new Set(['chromium-light-desktop', 'firefox-light-desktop', 'webkit-light-desktop']);

async function openBackgroundCatalogue(page: Page) {
  await page.goto('/components.html#App', { waitUntil: 'domcontentloaded' });
  await page.locator('nodel-page[data-page-id="App"][active]').waitFor();
  const host = page.locator('[data-background-catalogue="backgrounds"]');
  await host.locator('nodel-select').first().locator('.nodel-select-trigger').waitFor({ state: 'visible' });
  return host;
}

function backgroundCopyButton(section: ReturnType<Page['locator']>, kind: 'app' | 'page') {
  return section.locator(`[data-background-markup="${kind}"]`).locator('xpath=preceding-sibling::*[1]//button');
}

function backgroundCopyStatus(section: ReturnType<Page['locator']>, kind: 'app' | 'page') {
  return section.locator(`[data-background-markup="${kind}"]`).locator('xpath=preceding-sibling::*[1]').locator('[data-catalogue-copy-status]');
}

async function chooseCatalogueOption(catalogue: ReturnType<Page['locator']>, action: string, value: string) {
  const select = catalogue.locator(`nodel-select[action="${action}"]`);
  await select.locator('.nodel-select-trigger').click();
  await select.locator(`nodel-button[value="${value}"]`).click();
}

async function backgroundStyle(app: ReturnType<Page['locator']>) {
  return app.evaluate((element: HTMLElement) => {
    const base = getComputedStyle(element, '::before');
    const pattern = getComputedStyle(element, '::after');
    return {
      active: element.dataset.backgroundActive,
      color: base.backgroundColor,
      image: base.backgroundImage,
      fit: base.backgroundSize,
      repeat: base.backgroundRepeat,
      position: base.backgroundPosition,
      brightness: base.filter,
      pattern: pattern.backgroundImage,
      opacity: pattern.opacity,
      patternSize: pattern.backgroundSize
    };
  });
}

async function installNavigationFixture(page: Page) {
  await page.goto('/components.html#App', { waitUntil: 'domcontentloaded' });
  await page.locator('nodel-app').first().waitFor();
  const app = page.locator('nodel-app').first();
  await app.evaluate((element: HTMLElement) => {
    element.querySelectorAll('[nav-id^="Background"]').forEach((child) => child.remove());
    const fixture = document.createElement('div');
    fixture.innerHTML = `
      <nodel-page nav-id="BackgroundDirect" title="Background direct" min-height="viewport" bleed>
        <nodel-control-grid fill columns="1"><nodel-button data-background-hit>Foreground action</nodel-button></nodel-control-grid>
        <div style="height: 1600px">Scrollable content</div>
      </nodel-page>
      <nodel-page nav-id="BackgroundGroup" title="Background group" background-color="#456">
        <nodel-page nav-id="BackgroundLeaf" title="Background leaf" background-pattern="ripples" background-pattern-strength="15"></nodel-page>
      </nodel-page>`;
    element.append(...Array.from(fixture.children));
  });
  await page.waitForTimeout(50);
  return app;
}

async function renderedTileMetrics(page: Page, url: string, width: number, height: number, base: SeamBase = seamBases[0]) {
  await page.evaluate(({ base, image, w, h }) => {
    const element = document.createElement('div');
    element.dataset.backgroundSeamProbe = 'true';
    element.style.cssText = `position:fixed;left:0;top:0;width:${w * 2}px;height:${h * 2}px;background:${base.css} url("${image}") repeat;background-size:${w}px ${h}px;z-index:2147483647`;
    document.body.append(element);
  }, { base, image: url, w: width, h: height });
  const probe = page.locator('[data-background-seam-probe]');
  await page.evaluate(async (image) => {
    const asset = new Image();
    asset.src = image;
    await asset.decode();
  }, url);
  // Force the oversized fixed probe into the compositor before measuring its pixels.
  await probe.screenshot();
  const png = PNG.sync.read(await probe.screenshot());
  const difference = (first: number, second: number) => {
    let total = 0;
    for (let channel = 0; channel < 3; channel += 1) total += Math.abs(png.data[first * 4 + channel]! - png.data[second * 4 + channel]!);
    return total / 3;
  };
  let changedPixels = 0;
  let repeatedDifference = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * png.width + x;
      if (png.data[pixel * 4] !== base.rgb[0] || png.data[pixel * 4 + 1] !== base.rgb[1] || png.data[pixel * 4 + 2] !== base.rgb[2]) changedPixels += 1;
      repeatedDifference += difference(pixel, pixel + width);
      repeatedDifference += difference(pixel, pixel + height * png.width);
    }
  }
  const transitionProfiles = (vertical: boolean) => {
    const size = vertical ? width : height;
    const length = vertical ? height * 2 : width * 2;
    const profile = (coordinate: number) => {
      const values = new Int16Array(length * 3);
      for (let along = 0; along < length; along += 1) {
        const before = vertical
          ? along * png.width + coordinate - 1
          : (coordinate - 1) * png.width + along;
        const after = vertical ? before + 1 : before + png.width;
        for (let channel = 0; channel < 3; channel += 1) {
          values[along * 3 + channel] = png.data[after * 4 + channel]! - png.data[before * 4 + channel]!;
        }
      }
      return values;
    };
    const interior = Array.from({ length: size - 1 }, (_, index) => profile(index + 1));
    const seam = profile(size);
    const equal = (first: Int16Array, second: Int16Array) => {
      for (let index = 0; index < first.length; index += 1) {
        if (first[index] !== second[index]) return false;
      }
      return true;
    };
    const distance = (first: Int16Array, second: Int16Array) => {
      // RGB transition deltas are signed, so opposite edge bars cannot masquerade as matching contrast.
      const histogram = new Uint32Array(1531);
      for (let along = 0; along < length; along += 1) {
        const offset = along * 3;
        const sum = Math.abs(first[offset]! - second[offset]!)
          + Math.abs(first[offset + 1]! - second[offset + 1]!)
          + Math.abs(first[offset + 2]! - second[offset + 2]!);
        histogram[sum] = histogram[sum]! + 1;
      }
      const percentileIndex = Math.floor((length - 1) * .9);
      let seen = 0;
      for (let sum = 0; sum < histogram.length; sum += 1) {
        seen += histogram[sum]!;
        if (seen > percentileIndex) return sum / 3;
      }
      return 0;
    };
    const nearestDistance = (target: Int16Array, excluded = -1) => {
      let nearest = Infinity;
      for (let index = 0; index < interior.length; index += 1) {
        if (index === excluded) continue;
        const candidate = interior[index]!;
        if (equal(target, candidate)) return 0;
        nearest = Math.min(nearest, distance(target, candidate));
      }
      return nearest;
    };
    const representativeCount = Math.min(24, interior.length);
    const baselineDistances = Array.from({ length: representativeCount }, (_, sample) => {
      const index = representativeCount === 1
        ? 0
        : Math.round(sample * (interior.length - 1) / (representativeCount - 1));
      return nearestDistance(interior[index]!, index);
    }).sort((first, second) => first - second);
    const interiorBaseline = baselineDistances[Math.floor((baselineDistances.length - 1) * .9)] ?? 0;
    const seamDistance = nearestDistance(seam);
    return {
      distance: seamDistance,
      interiorBaseline,
      ratio: seamDistance / Math.max(interiorBaseline, 1)
    };
  };
  const verticalSeamProfile = transitionProfiles(true);
  const horizontalSeamProfile = transitionProfiles(false);
  await probe.evaluate((element) => element.remove());
  return {
    changedPixels,
    horizontalSeamProfile,
    repeatedDifference: repeatedDifference / (width * height * 2),
    verticalSeamProfile
  };
}

async function repeatedBoundaryInk(page: Page, url: string, width: number, height: number, base: SeamBase) {
  return page.evaluate(async ({ url, width, height, base }) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const sample = (vertical: boolean) => {
      const canvas = document.createElement('canvas');
      canvas.width = vertical ? 12 : Math.min(width, 640);
      canvas.height = vertical ? Math.min(height, 480) : 12;
      const context = canvas.getContext('2d')!;
      context.fillStyle = base.css;
      context.fillRect(0, 0, canvas.width, canvas.height);
      const seam = 6;
      const x = vertical ? seam - width : 0;
      const y = vertical ? 0 : seam - height;
      for (let drawY = y - height; drawY < canvas.height; drawY += height) {
        for (let drawX = x - width; drawX < canvas.width; drawX += width) context.drawImage(image, drawX, drawY, width, height);
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let changed = 0;
      let maximumContrast = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const contrast = (Math.abs(pixels[offset]! - base.rgb[0]) + Math.abs(pixels[offset + 1]! - base.rgb[1]) + Math.abs(pixels[offset + 2]! - base.rgb[2])) / 3;
        if (contrast > 1) changed += 1;
        maximumContrast = Math.max(maximumContrast, contrast);
      }
      return { changed, maximumContrast };
    };
    return { horizontal: sample(false), vertical: sample(true) };
  }, { url, width, height, base });
}

function expectContinuousTexture(metrics: Awaited<ReturnType<typeof renderedTileMetrics>>, label: string) {
  expect.soft(metrics.changedPixels, `${label} must decode to visible texture pixels`).toBeGreaterThan(8);
  expect.soft(metrics.repeatedDifference, `${label} must repeat identically on both axes`).toBeLessThan(1);
  expect.soft(metrics.verticalSeamProfile.ratio, `${label} vertical seam must resemble the texture's interior transitions`).toBeLessThanOrEqual(2);
  expect.soft(metrics.horizontalSeamProfile.ratio, `${label} horizontal seam must resemble the texture's interior transitions`).toBeLessThanOrEqual(2);
}

function textureIsContinuous(metrics: Awaited<ReturnType<typeof renderedTileMetrics>>) {
  return metrics.changedPixels > 8 && metrics.repeatedDifference < 1
    && metrics.verticalSeamProfile.ratio <= 2 && metrics.horizontalSeamProfile.ratio <= 2;
}

test.describe('authored background rendering', () => {
  test('writes labelled dark and light nine-pattern refinement sheets', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-forced-colors', 'Forced-colours intentionally disables decorative background effects.');
    await page.goto('/components.html', { waitUntil: 'domcontentloaded' });
    const app = page.locator('nodel-app').first();
    await expect(app).toHaveAttribute('data-nodel-app', 'true');
    const patternUrls: Record<string, string> = {};
    for (const pattern of patterns) {
      await app.evaluate((element, selectedPattern) => {
        element.setAttribute('background-color', '#202b38');
        element.setAttribute('background-pattern', selectedPattern);
        element.setAttribute('background-pattern-strength', '25');
        element.setAttribute('background-pattern-scale', '100');
      }, pattern);
      patternUrls[pattern] = await app.evaluate((element) => getComputedStyle(element, '::after').backgroundImage);
    }

    for (const base of [
      { name: 'dark', color: '#202b38' },
      { name: 'light', color: '#e8edf2' }
    ]) {
      for (const strength of [25, 100] as const) {
        await page.evaluate(({ base, patternUrls, dimensions, strength }) => {
        const sheet = document.createElement('div');
        sheet.style.cssText = `position:fixed;left:0;top:0;width:1062px;height:706px;display:grid;grid-template-columns:repeat(3,350px);grid-template-rows:repeat(3,230px);gap:6px;padding:6px;background:${base.color};z-index:2147483647`;
        for (const [pattern, width, height] of dimensions) {
          const tile = document.createElement('div');
          tile.style.cssText = `position:relative;width:350px;height:230px;background:${base.color}`;
          const texture = document.createElement('div');
          texture.style.cssText = `position:absolute;inset:0;background-image:${patternUrls[pattern]};background-repeat:repeat;background-size:${width}px ${height}px;opacity:${strength / 100}`;
          const label = document.createElement('span');
          label.textContent = `${pattern} ${strength}%`;
          label.style.cssText = 'position:absolute;left:12px;bottom:10px;padding:4px 7px;background:rgba(0,0,0,.64);color:#fff;font:600 14px/1.2 system-ui,sans-serif;letter-spacing:.02em;border-radius:3px;z-index:1';
          tile.append(texture, label);
          sheet.append(tile);
        }
        document.body.append(sheet);
        }, { base, patternUrls, dimensions: patternDimensions, strength });
        const sheet = page.locator('body > div').last();
        await expect(sheet).toBeVisible();
        const artifact = testInfo.outputPath(`${base.name}-${strength}-contact-sheet.png`);
        await sheet.screenshot({ path: artifact });
        await testInfo.attach(`${base.name}-${strength}-contact-sheet`, { path: artifact, contentType: 'image/png' });
        await sheet.evaluate((element) => element.remove());
      }
    }
  });

  test('renders the fixed base and texture layers from built v2 assets', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-forced-colors', 'Forced-colours intentionally disables decorative background effects.');
    await page.goto('/components.html', { waitUntil: 'domcontentloaded' });
    const app = page.locator('nodel-app');
    await expect(app).toHaveAttribute('data-nodel-app', 'true');

    await app.evaluate((element) => {
      element.setAttribute('background-color', 'rgb(32 43 56)');
      element.setAttribute('background-pattern', 'concentric-waves');
      element.setAttribute('background-pattern-strength', '40');
      element.setAttribute('background-brightness', '65');
      element.setAttribute('background-pattern-scale', '150');
      element.setAttribute('background-image-fit', 'tile');
      element.setAttribute('background-image-position', '50% 30%');
    });

    await expect(app).toHaveAttribute('data-background-active', 'true');
    await expect.poll(() => app.evaluate((element) => {
      const before = getComputedStyle(element, '::before');
      const after = getComputedStyle(element, '::after');
      return {
        color: before.backgroundColor,
        brightness: before.filter,
        repeat: before.backgroundRepeat,
        position: before.backgroundPosition,
        pattern: after.backgroundImage,
        opacity: after.opacity,
        size: after.backgroundSize
      };
    })).toMatchObject({
      color: 'rgb(32, 43, 56)',
      brightness: 'brightness(0.65)',
      repeat: 'repeat',
      position: '50% 30%',
      opacity: '0.4',
      size: '540px 360px'
    });

    await app.evaluate((element) => {
      element.setAttribute('background-pattern-strength', '0');
      element.setAttribute('background-pattern', 'none');
    });
    await expect.poll(() => app.evaluate((element) => getComputedStyle(element, '::after').opacity)).toBe('0');
  });

  test('catalogue configurator updates locally, escapes markup, and reports clipboard failure', async ({ page }, testInfo) => {
    const requests: string[] = [];
    const websockets: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('websocket', (websocket) => websockets.push(websocket.url()));
    await page.goto('/components.html#App', { waitUntil: 'domcontentloaded' });
    const example = page.locator('[data-background-catalogue="backgrounds"]');
    const section = page.locator('[data-background-catalogue-section]');
    await expect(example.locator('nodel-select').first().locator('nodel-button')).toHaveCount(10);
    await expect(example.locator('nodel-select').first()).toHaveAttribute('value', 'carbon-fibre');
    await expect(example.locator('[data-background-field="patternStrength"]').first()).toHaveValue('25');
    await expect(example.locator('[data-background-field="patternStrength"]').nth(1)).toHaveValue('25');
    await expect(example.locator('[data-background-field="brightness"]').first()).toHaveValue('100');
    await expect(example.locator('[data-background-field="brightness"]').nth(1)).toHaveValue('100');
    await expect(example.locator('[data-background-field="patternScale"]').first()).toHaveValue('100');
    await expect(example.locator('[data-background-field="patternScale"]').nth(1)).toHaveValue('100');
    if (['chromium-light-desktop', 'chromium-dark-desktop', 'chromium-light-mobile', 'chromium-dark-mobile'].includes(testInfo.project.name)) {
      const normalArtifact = testInfo.outputPath('backgrounds-normal.png');
      await section.screenshot({ path: normalArtifact });
      await testInfo.attach('backgrounds-normal', { path: normalArtifact, contentType: 'image/png' });
      await example.locator('nodel-select').first().locator('.nodel-select-trigger').click();
      const openArtifact = testInfo.outputPath('backgrounds-pattern-open.png');
      await section.screenshot({ path: openArtifact });
      await testInfo.attach('backgrounds-pattern-open', { path: openArtifact, contentType: 'image/png' });
      await page.keyboard.press('Escape');
    }

    const color = example.locator('[data-background-field="color"]');
    await color.fill('');
    await color.pressSequentially('#abc');
    await expect(color).toHaveValue('#abc');
    await expect(section.locator('[data-background-markup="app"]')).toContainText('background-color="rgb(170 187 204)"');
    await color.pressSequentially('def');
    await expect(color).toHaveValue('#abcdef');
    await expect(section.locator('[data-background-markup="app"]')).toContainText('background-color="rgb(171 205 239)"');
    await color.fill('');
    await color.pressSequentially('rgb(1 2 3)');
    await expect(color).toHaveValue('rgb(1 2 3)');
    await expect(color).toBeFocused();
    await example.locator('nodel-select').first().locator('.nodel-select-trigger').click();
    await example.locator('nodel-select').first().locator('nodel-button[value="ripples"]').click();
    await expect(example.locator('[data-background-preview]')).toHaveAttribute('data-background-active', 'true');
    await example.locator('[data-background-field="patternStrength"]').first().fill('40');
    await expect(example.locator('[data-background-field="patternStrength"]').nth(1)).toHaveValue('40');
    await example.locator('[data-background-field="brightness"]').nth(1).fill('65');
    await expect(example.locator('[data-background-field="brightness"]').first()).toHaveValue('65');

    await example.locator('[data-background-field="image"]').fill('./images/a&b.png');
    await expect(section.locator('[data-background-markup="app"]')).toContainText('a&amp;b.png');
    await color.fill('rgb(1 2 3 / .5)');
    await expect(color).toHaveAttribute('aria-invalid', 'true');
    await expect.poll(() => color.evaluate((input) => !(input as HTMLInputElement).checkValidity())).toBe(true);
    await expect(example.locator('[data-background-color-error]')).toContainText('Enter an opaque RGB');
    await expect(backgroundCopyButton(section, 'app')).toBeDisabled();
    await example.locator('nodel-palette nodel-button[value="#f0f3f5"] button').click();
    await expect(color).toHaveValue('rgb(240 243 245)');
    await expect(color).toHaveAttribute('aria-invalid', 'false');
    await expect(backgroundCopyButton(section, 'app')).toBeEnabled();
    await color.fill('invalid');
    await example.locator('nodel-button[arg="theme"] button').click();
    await expect(color).toHaveValue('theme');
    await expect(color).toHaveAttribute('aria-invalid', 'false');
    await expect(section.locator('[data-background-markup="page"]')).toContainText('background-color="theme"');
    await expect(backgroundCopyButton(section, 'app')).toBeEnabled();
    await color.fill('#010203');
    await expect(color).toHaveAttribute('aria-invalid', 'false');
    await expect.poll(() => color.evaluate((input) => (input as HTMLInputElement).checkValidity())).toBe(true);
    await expect(backgroundCopyButton(section, 'app')).toBeEnabled();
    await expect(example.locator('nodel-palette .nodel-palette-value-input')).toHaveValue('#010203');
    await example.locator('nodel-palette .nodel-palette-custom-input').fill('#a1b2c3');
    await example.locator('nodel-palette .nodel-palette-custom-button').click();
    await expect(color).toHaveValue('rgb(161 178 195)');
    await expect(example.locator('nodel-palette .nodel-palette-value-input')).toHaveValue('#a1b2c3');
    const strengthNumber = example.locator('#background-strength-number');
    await strengthNumber.fill('');
    await chooseCatalogueOption(example, 'SetCatalogueBackgroundPattern', 'checkerplate');
    await expect(strengthNumber).toHaveValue('');
    await expect(strengthNumber).toHaveAttribute('aria-invalid', 'true');
    await expect(example.locator('[data-background-number-error="patternStrength"]')).toContainText('Enter a number');
    await expect(backgroundCopyButton(section, 'app')).toBeDisabled();
    await strengthNumber.fill('150');
    await expect(strengthNumber).toHaveValue('150');
    await expect(example.locator('#background-strength-range')).toHaveValue('100');
    await expect(section.locator('[data-background-markup="app"]')).toContainText('background-pattern-strength="100"');
    await expect(backgroundCopyButton(section, 'app')).toBeEnabled();
    await strengthNumber.press('Enter');
    await expect(strengthNumber).toHaveValue('100');
    const scaleNumber = example.locator('#background-scale-number');
    await scaleNumber.fill('');
    await scaleNumber.pressSequentially('1');
    await expect(scaleNumber).toHaveValue('1');
    await expect(example.locator('#background-scale-range')).toHaveValue('25');
    await scaleNumber.pressSequentially('50');
    await expect(scaleNumber).toHaveValue('150');
    await expect(example.locator('#background-scale-range')).toHaveValue('150');
    const brightnessNumber = example.locator('#background-brightness-number');
    await brightnessNumber.fill('');
    await brightnessNumber.pressSequentially('150');
    await expect(brightnessNumber).toHaveValue('150');
    await expect(example.locator('#background-brightness-range')).toHaveValue('150');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('blocked')) } });
      Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    });
    await backgroundCopyButton(section, 'app').click();
    await expect(backgroundCopyStatus(section, 'app')).toContainText('Clipboard access failed');
    await expect(backgroundCopyStatus(section, 'page')).toHaveText('');
    expect(requests.some((url) => /REST\/(actions|activity)/i.test(url))).toBe(false);
    expect(websockets).toEqual([]);
  });

  test('keeps generated blocks in-section and remounts after actual catalogue replacement', async ({ page }) => {
    const example = await openBackgroundCatalogue(page);
    const section = page.locator('[data-background-catalogue-section]');
    await page.evaluate(() => {
      (window as Window & { __backgroundReplacementCopies?: string[] }).__backgroundReplacementCopies = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (text: string) => { (window as Window & { __backgroundReplacementCopies?: string[] }).__backgroundReplacementCopies?.push(text); return Promise.resolve(); } }
      });
    });
    const structure = await section.evaluate((element) => {
      const examples = element.querySelector('[data-background-catalogue="backgrounds"]')!;
      const blocks = Array.from(element.querySelectorAll<HTMLElement>('[data-background-markup]'));
      return {
        count: blocks.length,
        standard: blocks.every((block) => block.matches('pre.nodel-catalogue-code')),
        outsideExamples: blocks.every((block) => !examples.contains(block)),
        parityIds: blocks.map((block) => block.dataset.catalogueCodeFor).filter(Boolean)
      };
    });
    expect(structure).toEqual({ count: 2, standard: true, outsideExamples: true, parityIds: [] });

    await example.locator('[data-background-field="color"]').fill('#345678');
    await page.evaluate(() => {
      const current = document.querySelector<HTMLElement>('[data-background-catalogue-section]')!;
      const replacement = current.cloneNode(true) as HTMLElement;
      const replacementHost = replacement.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
      replacementHost.replaceChildren();
      delete replacementHost.dataset.backgroundCatalogueMounted;
      for (const code of replacement.querySelectorAll('[data-background-markup] code')) code.textContent = '';
      const parent = current.parentElement!;
      (window as Window & { __removedBackgroundHost?: HTMLElement }).__removedBackgroundHost = current.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]')!;
      current.remove();
      parent.append(replacement);
    });

    const replacement = page.locator('[data-background-catalogue-section]');
    const replacementHost = replacement.locator('[data-background-catalogue="backgrounds"]');
    await replacementHost.locator('[data-background-preview]').waitFor();
    await expect(replacementHost).toHaveAttribute('data-background-catalogue-mounted', 'pending');
    expect(await page.evaluate(() => (window as Window & { __removedBackgroundHost?: HTMLElement }).__removedBackgroundHost?.dataset.backgroundCatalogueMounted)).toBeUndefined();
    await expect(replacement.locator('[data-background-markup="app"]')).toContainText('background-color="rgb(52 86 120)"');
    await expect.poll(() => replacement.locator('[data-background-markup]').evaluateAll((blocks) => blocks.every((block) => {
      const toolbar = block.previousElementSibling;
      return toolbar?.hasAttribute('data-catalogue-copy-toolbar') && toolbar.querySelectorAll('button').length === 1 && toolbar.querySelectorAll('[data-catalogue-copy-status]').length === 1;
    }))).toBe(true);
    for (const kind of ['app', 'page'] as const) {
      const pre = replacement.locator(`[data-background-markup="${kind}"]`);
      const expected = await pre.locator('code').textContent();
      await backgroundCopyButton(replacement, kind).click();
      await expect.poll(() => page.evaluate(() => (window as Window & { __backgroundReplacementCopies?: string[] }).__backgroundReplacementCopies?.at(-1))).toBe(expected);
      await expect(backgroundCopyStatus(replacement, kind)).toHaveText('Code copied to the clipboard.');
    }
  });

  test('preserves an explicit RGB page colour over a conflicting app colour', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-forced-colors', 'Forced-colours intentionally replaces authored background colours with Canvas.');
    await page.goto('/components.html#App', { waitUntil: 'domcontentloaded' });
    const section = page.locator('[data-background-catalogue-section]');
    await expect(section.locator('[data-background-markup="app"]')).toContainText('background-color="rgb(32 43 56)"');
    const markup = await section.locator('[data-background-markup="page"]').textContent();
    expect(markup).toContain('background-color="rgb(32 43 56)"');
    expect(markup).not.toContain('background-color="theme"');
    await page.evaluate((pageMarkup) => {
      const app = document.createElement('nodel-app');
      app.dataset.generatedBackgroundApp = '';
      app.setAttribute('background-color', '#123456');
      app.innerHTML = pageMarkup ?? '';
      document.body.append(app);
      app.querySelector('nodel-page')?.setAttribute('active', '');
    }, markup);
    await expect.poll(() => backgroundStyle(page.locator('nodel-app[data-generated-background-app]')).then((style) => style.color)).toBe('rgb(32, 43, 56)');
  });

  test('generates an explicit theme page reset over a conflicting app colour', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-forced-colors', 'Forced-colours intentionally replaces authored background colours with Canvas.');
    const example = await openBackgroundCatalogue(page);
    const section = page.locator('[data-background-catalogue-section]');
    await example.locator('[data-background-field="color"]').fill('theme');
    const markup = await section.locator('[data-background-markup="page"]').textContent();
    expect(markup).toContain('background-color="theme"');
    await page.evaluate((pageMarkup) => {
      document.documentElement.style.setProperty('--nodel-bg', '7 8 9');
      const app = document.createElement('nodel-app');
      app.dataset.generatedBackgroundApp = '';
      app.setAttribute('background-color', '#123456');
      app.innerHTML = pageMarkup ?? '';
      document.body.append(app);
      app.querySelector('nodel-page')?.setAttribute('active', '');
    }, markup);
    await expect.poll(() => backgroundStyle(page.locator('nodel-app[data-generated-background-app]')).then((style) => style.color)).toBe('rgb(7, 8, 9)');
  });

  test('loads every pattern asset and keeps texture strength independent', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-forced-colors', 'Forced-colours intentionally disables decorative background effects.');
    const catalogue = await openBackgroundCatalogue(page);
    const app = catalogue.locator('[data-background-preview]');
    const urls = new Set<string>();
    for (const pattern of patterns) {
      await chooseCatalogueOption(catalogue, 'SetCatalogueBackgroundPattern', pattern);
      const style = await backgroundStyle(app);
      expect(style.pattern, pattern).toMatch(/^url\(/);
      expect(style.opacity).toBe('0.25');
      urls.add(style.pattern);
    }
    expect(urls.size).toBe(patterns.length);
    for (const [pattern, width, height] of patternDimensions) {
      const image = await catalogue.locator(`[data-background-pattern-swatch="${pattern}"]`).evaluate((element) => getComputedStyle(element).backgroundImage);
      for (const base of seamBases) {
        const metrics = await renderedTileMetrics(page, image.slice(5, -2), width, height, base);
        expectContinuousTexture(metrics, `${pattern} on ${base.css}`);
        if (pattern === 'brushed-metal') {
          expect.soft(
            Math.max(metrics.verticalSeamProfile.ratio, metrics.horizontalSeamProfile.ratio),
            `native stochastic grain on ${base.css} must remain within its own interior variation`
          ).toBeLessThanOrEqual(2);
        }
      }
    }
    const swatches = catalogue.locator('[data-background-pattern-swatch]');
    await expect(swatches).toHaveCount(10);
    const swatchImages = await swatches.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundImage));
    expect(swatchImages.slice(0, patterns.length).every((image) => image.startsWith('url('))).toBe(true);
    await catalogue.locator('[aria-label="Texture reference"]').screenshot({ path: testInfo.outputPath('background-pattern-contact-sheet.png') });
    await chooseCatalogueOption(catalogue, 'SetCatalogueBackgroundPattern', 'none');
    await expect.poll(() => backgroundStyle(app).then((style) => style.pattern)).toBe('none');
  });

  test('calibrates texture seams against sharp motifs, broken edges, and boundary clipping', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-forced-colors', 'Forced-colours intentionally disables decorative background effects.');
    const catalogue = await openBackgroundCatalogue(page);
    const periodicSharpTwill = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><defs><pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse"><path fill="#fff" fill-opacity=".45" d="M0 0h12v6H0zm12 6h12v6H12zM0 12h12v6H0zm12 6h12v6H12z"/><path fill="#000" fill-opacity=".35" d="M12 0h12v6H12zM0 6h12v6H0zm12 12h12v6H12zM0 18h12v6H0z"/></pattern></defs><rect width="48" height="48" fill="url(#p)"/></svg>')}`;
    for (const base of seamBases) {
      const periodicMetrics = await renderedTileMetrics(page, periodicSharpTwill, 48, 48, base);
      expectContinuousTexture(periodicMetrics, `periodic sharp twill calibration on ${base.css}`);
      expect.soft(periodicMetrics.verticalSeamProfile.distance).toBe(0);
      expect.soft(periodicMetrics.horizontalSeamProfile.distance).toBe(0);
    }
    const originalCheckerplate = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><path fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="18" d="M-20 20 20-20m0 80 40-40m0 80 40-40"/><path fill="none" stroke="#000" stroke-opacity=".35" stroke-width="18" d="M-20 60 60-20m0 80 40-40"/></svg>')}`;
    for (const base of seamBases) {
      const originalMetrics = await renderedTileMetrics(page, originalCheckerplate, 80, 80, base);
      expect(textureIsContinuous(originalMetrics), `the original checkerplate must fail on ${base.css}`).toBe(false);
      expect(
        Math.max(originalMetrics.verticalSeamProfile.ratio, originalMetrics.horizontalSeamProfile.ratio),
        `the original checkerplate must exceed the relative seam limit on ${base.css}`
      ).toBeGreaterThan(2);
    }
    for (const { color, base } of [
      { color: '#fff', base: seamBases[0] },
      { color: '#000', base: seamBases[1] }
    ]) {
      const broken = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><path fill="${color}" fill-opacity=".35" d="M0 0h8v64H0z"/></svg>`)}`;
      const brokenMetrics = await renderedTileMetrics(page, broken, 64, 64, base);
      expect(brokenMetrics.changedPixels).toBeGreaterThan(8);
      expect(brokenMetrics.repeatedDifference).toBeLessThan(1);
      expect(textureIsContinuous(brokenMetrics), `the translucent ${color} control must fail on ${base.css}`).toBe(false);
      expect(
        Math.max(brokenMetrics.verticalSeamProfile.ratio, brokenMetrics.horizontalSeamProfile.ratio),
        `the translucent ${color} edge must exceed the signed-profile limit on ${base.css}`
      ).toBeGreaterThan(2);
    }
    const concentricImage = await catalogue.locator('[data-background-pattern-swatch="concentric-waves"]').evaluate((element) => getComputedStyle(element).backgroundImage);
    const concentricUrl = concentricImage.slice(5, -2);
    const oldClippedConcentric = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 720 480"><defs><clipPath id="safe"><rect x="2" y="2" width="716" height="476"/></clipPath></defs><g clip-path="url(#safe)" fill="none" stroke="#fff" stroke-width="2"><path d="M-720 24C-520-46-200-46 0 24S520 94 720 24S1240-46 1440 24"/></g></svg>')}`;
    // Transition profiles cannot detect two matching blank edges, so boundary ink remains a separate requirement.
    for (const scale of [1, 4]) {
      const width = 360 * scale;
      const height = 240 * scale;
      const metrics = await repeatedBoundaryInk(page, concentricUrl, width, height, seamBases[0]);
      expect.soft(metrics.vertical.changed, `concentric vertical boundary ink at ${scale * 100}%`).toBeGreaterThan(12);
      expect.soft(metrics.horizontal.changed, `concentric horizontal boundary ink at ${scale * 100}%`).toBeGreaterThan(12);
      expect.soft(metrics.vertical.maximumContrast, `concentric vertical contrast at ${scale * 100}%`).toBeGreaterThan(4);
      expect.soft(metrics.horizontal.maximumContrast, `concentric horizontal contrast at ${scale * 100}%`).toBeGreaterThan(4);
      const oldMetrics = await repeatedBoundaryInk(page, oldClippedConcentric, width, height, seamBases[0]);
      expect(oldMetrics.vertical.changed > 12 && oldMetrics.horizontal.changed > 12, `old clipped concentric must expose blank boundaries at ${scale * 100}%`).toBe(false);
    }
    if (testInfo.project.name === 'chromium-light-desktop') {
      for (const [baseName, base] of [['dark', seamBases[0]], ['light', seamBases[1]]] as const) {
        for (const scale of [1, 4]) {
          await page.evaluate(({ base, image, scale }) => {
            const probe = document.createElement('div');
            probe.dataset.concentricSeamReview = '';
            probe.style.cssText = `position:fixed;inset:0 auto auto 0;width:720px;height:480px;z-index:2147483647;background-color:${base};background-image:url("${image}");background-repeat:repeat;background-size:${360 * scale}px ${240 * scale}px;background-position:${360 * scale}px ${240 * scale}px`;
            document.body.append(probe);
          }, { base: base.css, image: concentricUrl, scale });
          const artifact = testInfo.outputPath(`concentric-${baseName}-${scale * 100}-seams.png`);
          await page.locator('[data-concentric-seam-review]').screenshot({ path: artifact });
          await testInfo.attach(`concentric-${baseName}-${scale * 100}-seams`, { path: artifact, contentType: 'image/png' });
          await page.locator('[data-concentric-seam-review]').evaluate((element) => element.remove());
        }
      }
    }
  });

  test('resolves app, group, and leaf inheritance through navigation and removals', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-forced-colors', 'Forced-colours changes decorative computed styles; rendering is covered separately.');
    const app = await installNavigationFixture(page);
    await app.evaluate((element: HTMLElement) => {
      element.setAttribute('background-color', '#123456');
      element.setAttribute('background-pattern', 'dotted-grid');
      element.setAttribute('background-brightness', '65');
    });
    await page.evaluate(() => { window.location.hash = '#BackgroundLeaf'; });
    await page.locator('nodel-page[data-page-id="BackgroundLeaf"][active]').waitFor();
    await expect.poll(() => backgroundStyle(app)).toMatchObject({ color: 'rgb(68, 85, 102)', pattern: expect.stringMatching(/^url\(/), opacity: '0.15', brightness: 'brightness(0.65)' });

    await page.evaluate(() => { window.location.hash = '#BackgroundDirect'; });
    await page.locator('nodel-page[data-page-id="BackgroundDirect"][active]').waitFor();
    await expect.poll(() => backgroundStyle(app)).toMatchObject({ color: 'rgb(18, 52, 86)', pattern: expect.stringMatching(/^url\(/), opacity: '0.25' });

    await app.evaluate((element: HTMLElement) => {
      element.querySelectorAll('[nav-id^="Background"]').forEach((child) => child.remove());
      const leaf = element.querySelector('[data-page-id="BackgroundLeaf"]');
      leaf?.removeAttribute('background-pattern');
      element.setAttribute('background-pattern', 'none');
    });
    await expect.poll(() => backgroundStyle(app).then((style) => style.active)).toBe('true');
    await app.evaluate((element: HTMLElement) => {
      for (const name of ['background-color', 'background-pattern', 'background-brightness']) element.removeAttribute(name);
    });
    await expect.poll(() => backgroundStyle(app).then((style) => style.active)).toBe('false');
  });

  test('supports image composition, fit, position, and adjustment extremes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-forced-colors', 'Forced-colours intentionally disables decorative background effects.');
    const catalogue = await openBackgroundCatalogue(page);
    const app = catalogue.locator('[data-background-preview]');
    await expect.poll(() => backgroundStyle(app).then((style) => style.patternSize)).toBe('48px 48px');
    const image = catalogue.locator('[data-background-field="image"]');
    await image.fill('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjxwYXRoIGZpbGw9InJlZCIgZD0iTTAgMGgxVjFIMHoiLz48L3N2Zz4=');
    await chooseCatalogueOption(catalogue, 'SetCatalogueBackgroundFit', 'contain');
    await chooseCatalogueOption(catalogue, 'SetCatalogueBackgroundPosition', '50% 30%');
    await catalogue.locator('[data-background-field="brightness"]').first().fill('0');
    await catalogue.locator('[data-background-field="patternStrength"]').first().fill('100');
    await catalogue.locator('[data-background-field="patternScale"]').first().fill('400');
    await expect.poll(() => backgroundStyle(app)).toMatchObject({ fit: 'contain', repeat: 'no-repeat', position: '50% 30%', brightness: 'brightness(0)', opacity: '1', patternSize: '192px 192px' });
    await chooseCatalogueOption(catalogue, 'SetCatalogueBackgroundFit', 'tile');
    await expect.poll(() => backgroundStyle(app)).toMatchObject({ fit: 'auto', repeat: 'repeat' });
    await image.fill('javascript:alert(1)');
    await expect.poll(() => backgroundStyle(app).then((style) => style.image)).toBe('none');
    await expect(page.locator('[data-background-markup="app"]')).not.toContainText('javascript');
  });

  test('keeps viewport, bleed, fill, fixed footer, menus, overlays, and controls above the backdrop', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-forced-colors', 'Forced-colours intentionally disables decorative background effects.');
    const app = await installNavigationFixture(page);
    await app.evaluate((element: HTMLElement) => {
      element.setAttribute('background-color', '#18232e');
      element.setAttribute('background-pattern', 'carbon-fibre');
      element.setAttribute('background-pattern-strength', '40');
      element.setAttribute('background-brightness', '65');
      const footer = document.createElement('nodel-footer');
      footer.setAttribute('fixed', '');
      footer.innerHTML = '<nodel-button data-footer-hit>Footer action</nodel-button>';
      element.append(footer);
      (window as Window & { __backgroundHits?: number }).__backgroundHits = 0;
      element.addEventListener('click', (event) => {
        if ((event.target as Element).closest('[data-background-hit], [data-footer-hit]')) {
          const target = window as Window & { __backgroundHits?: number };
          target.__backgroundHits = (target.__backgroundHits ?? 0) + 1;
        }
      });
    });
    await page.evaluate(() => { window.location.hash = '#BackgroundDirect'; });
    await page.locator('nodel-page[data-page-id="BackgroundDirect"][active]').waitFor();
    const activePage = app.locator('nodel-page[data-page-id="BackgroundDirect"][active]');
    await expect(activePage).toHaveAttribute('min-height', 'viewport');
    await expect(activePage).toHaveAttribute('bleed', '');
    await expect(activePage).toHaveAttribute('data-min-height', 'viewport');
    await expect(activePage).toHaveAttribute('data-bleed', 'true');
    const grid = activePage.locator('nodel-control-grid');
    await expect(grid).toHaveAttribute('fill', '');
    await expect(grid).toHaveCSS('display', 'grid');
    await expect(grid).toHaveCSS('flex-grow', '1');
    await expect(activePage.locator('[data-page-content]')).toHaveCSS('padding-left', '0px');
    await expect(app).toHaveAttribute('data-fixed-footer', 'true');
    await expect(app.locator('nodel-footer[fixed] [data-footer-shell]')).toHaveCSS('position', 'fixed');
    await expect.poll(() => backgroundStyle(app)).toMatchObject({ brightness: 'brightness(0.65)', opacity: '0.4' });
    const foreground = activePage.locator('[data-background-hit] button');
    await expect(foreground).toHaveCSS('filter', 'none');
    await expect(foreground).toHaveCSS('opacity', '1');
    await foreground.click();
    await app.locator('[data-footer-hit] button').click();
    expect(await page.evaluate(() => (window as Window & { __backgroundHits?: number }).__backgroundHits)).toBe(2);
    const before = await app.evaluate((element) => getComputedStyle(element, '::before').position);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(before).toBe('fixed');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.locator('[data-nav-group-id="BackgroundGroup"]').click();
    const menu = page.locator('#nodel-menu-BackgroundGroup');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.nodel-menu-item').first()).toBeEnabled();
    await app.evaluate((element: HTMLElement) => element.dispatchEvent(new CustomEvent('nodel-toast', { bubbles: true, detail: { message: 'Backdrop toast', persistent: true } })));
    const toast = page.locator('nodel-toast-host .nodel-toast');
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Dismiss notification' }).click();
    await app.evaluate((element: HTMLElement) => element.dispatchEvent(new CustomEvent('nodel-confirm', { bubbles: true, detail: { text: 'Layer test', resolve: () => undefined } })));
    await expect(page.locator('nodel-confirm-host .nodel-confirm-dialog')).toBeVisible();
    await expect(page.locator('nodel-confirm-host .nodel-confirm-dialog')).toBeInViewport();
    await page.locator('nodel-confirm-host button[data-confirm-action="cancel"]').click();
    await app.evaluate((element) => element.setAttribute('offline-mode', 'overlay'));
    await context.setOffline(true);
    await expect(app.locator('nodel-connectivity-host [role="alert"]')).toBeVisible();
    await foreground.click();
    expect(await page.evaluate(() => (window as Window & { __backgroundHits?: number }).__backgroundHits)).toBe(3);
    await context.setOffline(false);
    await expect(app.locator('nodel-connectivity-host')).toBeHidden();
  });

  test('disables decorative effects under forced colours and preserves hit targets', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-forced-colors', 'This assertion is specific to forced colours.');
    await page.goto('/components.html', { waitUntil: 'domcontentloaded' });
    const app = page.locator('nodel-app').first();
    await app.evaluate((element: HTMLElement) => {
      element.setAttribute('background-color', '#123456');
      element.setAttribute('background-pattern', 'hexagonal-mesh');
    });
    await expect.poll(() => backgroundStyle(app)).toMatchObject({ color: 'rgb(255, 255, 255)', image: 'none', pattern: 'none', opacity: '0' });
    const button = page.locator('nodel-toolbar button').first();
    await expect(button).toBeEnabled();
    await button.click();
  });

  test('supports keyboard selection, successful clipboard copy, and selectable generated markup', async ({ page }, testInfo) => {
    const nativeClipboard = testInfo.project.name.startsWith('chromium');
    if (nativeClipboard) await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    else {
      await page.addInitScript(() => {
        (window as Window & { __backgroundCopies?: string[] }).__backgroundCopies = [];
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: (text: string) => { (window as Window & { __backgroundCopies?: string[] }).__backgroundCopies?.push(text); return Promise.resolve(); } }
        });
      });
    }
    const catalogue = await openBackgroundCatalogue(page);
    const section = page.locator('[data-background-catalogue-section]');
    await expect(page.locator('pre.nodel-catalogue-code > code')).toHaveCount(69);
    await expect(page.locator('[data-catalogue-copy-toolbar]')).toHaveCount(69);
    const patternSelect = catalogue.locator('nodel-select[action="SetCatalogueBackgroundPattern"]');
    await patternSelect.locator('.nodel-select-trigger').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(patternSelect).toHaveAttribute('value', 'checkerplate');
    const expected = await section.locator('[data-background-markup="app"] code').textContent();
    await backgroundCopyButton(section, 'app').click();
    await expect(backgroundCopyStatus(section, 'app')).toContainText('Code copied');
    if (nativeClipboard) await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected);
    else await expect.poll(() => page.evaluate(() => (window as Window & { __backgroundCopies?: string[] }).__backgroundCopies?.at(-1))).toBe(expected);
    const markup = section.locator('[data-background-markup="app"]');
    await expect(markup).toContainText('<nodel-app');
    await expect(markup).toHaveAttribute('tabindex', '0');
    await expect(markup).toContainText('background-pattern="checkerplate"');
  });

  test('has no axe violations in the Backgrounds example', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-light-desktop' && testInfo.project.name !== 'chromium-dark-desktop' && testInfo.project.name !== 'chromium-forced-colors', 'Axe runs in representative Chromium projects.');
    await openBackgroundCatalogue(page);
    const section = page.locator('[data-background-catalogue-section]');
    await expect(section.locator('[data-background-markup] code')).toHaveCount(2);
    await expect.poll(() => section.locator('[data-background-markup] code').evaluateAll((codes) => codes.every((code) => Boolean(code.textContent?.trim())))).toBe(true);
    const results = await new AxeBuilder({ page })
      .include('[data-background-catalogue-section]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations, 'Backgrounds example should have no axe violations').toEqual([]);
  });

  test('loads relative authored images from root and nested no-build pages', async ({ page }, testInfo) => {
    test.skip(!releaseProjects.has(testInfo.project.name), 'Runs once per pinned browser engine.');
    const imageRequests: string[] = [];
    await page.route('**/v2/assets/authored-background.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path fill="red" d="M0 0h2v2H0z"/></svg>' }));
    await page.route('**/nodes/Demo/v2/**', async (route) => {
      const sourceUrl = new URL(route.request().url());
      sourceUrl.pathname = sourceUrl.pathname.replace(/^\/nodes\/Demo/, '');
      await route.fulfill({ response: await page.request.get(sourceUrl.toString()) });
    });
    page.on('request', (request) => {
      if (request.url().includes('authored-background.svg')) imageRequests.push(new URL(request.url()).pathname);
    });
    for (const authoredPath of ['/background-root.html', '/nodes/Demo/background-nested.html']) {
      await page.route(`**${authoredPath}`, (route) => route.fulfill({
        contentType: 'text/html',
        body: '<link rel="stylesheet" href="./v2/nodel-webui.css"><script type="module" src="./v2/nodel-webui.js"></script><nodel-app background-image="./v2/assets/authored-background.svg" background-pattern="carbon-fibre"></nodel-app>'
      }));
      await page.goto(authoredPath, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('nodel-app')).toHaveAttribute('data-background-active', 'true');
      await expect.poll(() => page.locator('nodel-app').evaluate((element) => getComputedStyle(element, '::before').backgroundImage)).toContain('authored-background.svg');
    }
    expect(imageRequests).toEqual(['/v2/assets/authored-background.svg', '/nodes/Demo/v2/assets/authored-background.svg']);
  });
});
