import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

type Rgb = { blue: number; green: number; red: number; alpha?: number };
type Box = { height: number; width: number; x: number; y: number };
type BoundarySample = { box: Box; borderWidth: number; name: string; surface: string };
type StatusSample = { box: Box; name: string; surface: string };

const representativeViews: Array<{ pageId: string; selector: string; openReference?: boolean }> = [
  { pageId: 'Quickstart', selector: '[data-catalogue-quickstart]' },
  { pageId: 'Buttons', selector: '[data-catalogue-example="buttons-variants"]' },
  { pageId: 'Buttons', selector: '[data-catalogue-reference-for="nodel-button"]', openReference: true },
  { pageId: 'PickersPrecision', selector: '[data-catalogue-example="select-stepper"]' },
  { pageId: 'PickersPrecision', selector: '[data-catalogue-example="readouts-edge"]' },
  { pageId: 'PickersPrecision', selector: '[data-catalogue-example="palette-native"]' },
  { pageId: 'FadersMeters', selector: '[data-catalogue-example="faders-compound-fader"]' },
  { pageId: 'Media', selector: '[data-catalogue-example="media-status-blocks"]' },
  { pageId: 'Media', selector: '[data-catalogue-example="media-qr-codes"]' },
  { pageId: 'Media', selector: '[data-catalogue-example="media-status-indicators"]' },
  { pageId: 'Text', selector: '[data-catalogue-example="content-text-surface"]' }
];

async function openCatalogue(page: Page, pageId: string) {
  await page.goto(`/components.html#${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`nodel-page[data-page-id="${pageId}"][active]`).waitFor();
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });
}

async function setMediaFeature(page: Page, name: string, value: string) {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setEmulatedMedia', { features: [{ name, value }] });
}

function isDesktopThemeProject(testInfo: TestInfo) {
  return testInfo.project.name === 'chromium-light-desktop' || testInfo.project.name === 'chromium-dark-desktop';
}

function isDarkThemeEngineProject(testInfo: TestInfo) {
  return isDesktopThemeProject(testInfo)
    || testInfo.project.name === 'firefox-light-desktop'
    || testInfo.project.name === 'webkit-light-desktop';
}

function isAxeProject(testInfo: TestInfo) {
  return isDesktopThemeProject(testInfo) || testInfo.project.name === 'chromium-forced-colors';
}

function parseRgb(value: string): Rgb {
  const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
  if (parts.length < 3) {
    throw new Error(`Expected an RGB colour, received ${value}`);
  }

  const [red, green, blue] = parts;
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`Expected an RGB colour, received ${value}`);
  }
  return { red, green, blue, alpha: parts[3] ?? 1 };
}

function applyBrightness(colour: Rgb, filter: string): Rgb {
  const factor = Number(filter.match(/brightness\(([^)]+)\)/)?.[1] ?? 1);
  return {
    red: Math.min(255, colour.red * factor),
    green: Math.min(255, colour.green * factor),
    blue: Math.min(255, colour.blue * factor)
  };
}

function composite(foreground: Rgb, background: Rgb): Rgb {
  const alpha = foreground.alpha ?? 1;
  return {
    red: foreground.red * alpha + background.red * (1 - alpha),
    green: foreground.green * alpha + background.green * (1 - alpha),
    blue: foreground.blue * alpha + background.blue * (1 - alpha)
  };
}

function relativeLuminance({ red, green, blue }: Rgb) {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrastRatio(left: Rgb, right: Rgb) {
  const luminances = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  const lighter = luminances[0];
  const darker = luminances[1];
  if (lighter === undefined || darker === undefined) {
    throw new Error('Expected two luminance values.');
  }
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbLabel({ red, green, blue }: Rgb) {
  return `rgb(${red} ${green} ${blue})`;
}

function readPixel(png: PNG, x: number, y: number): Rgb {
  const pixelX = Math.max(0, Math.min(png.width - 1, Math.round(x)));
  const pixelY = Math.max(0, Math.min(png.height - 1, Math.round(y)));
  const offset = (pixelY * png.width + pixelX) * 4;

  return {
    red: png.data[offset] ?? 0,
    green: png.data[offset + 1] ?? 0,
    blue: png.data[offset + 2] ?? 0,
    alpha: (png.data[offset + 3] ?? 255) / 255
  };
}

function sampleBoundary(png: PNG, box: Box, borderWidth: number) {
  const y = box.y + box.height / 2;
  const edge = box.x + box.width;
  const surface = readPixel(png, edge + 4, y);
  const candidates = Array.from({ length: Math.max(3, Math.ceil(borderWidth) + 2) }, (_, index) =>
    readPixel(png, edge + 1 - index, y));
  const border = candidates.sort((left, right) => contrastRatio(right, surface) - contrastRatio(left, surface))[0];
  if (border === undefined) {
    throw new Error('Missing boundary sample.');
  }

  return { border, surface };
}

function sampleStatusMark(png: PNG, box: Box) {
  const y = box.y + box.height / 2;
  const surface = readPixel(png, box.x - 4, y);
  const candidates = Array.from({ length: 4 }, (_, index) => readPixel(png, box.x - 1 + index, y));
  const mark = candidates.sort((left, right) => contrastRatio(right, surface) - contrastRatio(left, surface))[0];
  if (mark === undefined) {
    throw new Error('Missing status sample.');
  }

  return { mark, surface };
}

test.describe('catalogue accessibility', () => {
  test('has no axe violations in representative catalogue views in each theme', async ({ page }, testInfo) => {
    test.skip(!isAxeProject(testInfo), 'Axe runs once for each desktop colour theme and the opened reference in forced colours.');

    const views = testInfo.project.name === 'chromium-forced-colors'
      ? representativeViews.filter((view) => view.openReference)
      : representativeViews;
    for (const view of views) {
      await openCatalogue(page, view.pageId);
      if (view.openReference) {
        const summary = page.locator(`${view.selector} .nodel-collapse-summary`);
        await summary.click();
        if (testInfo.project.name === 'chromium-forced-colors') {
          const region = page.locator(`${view.selector} .nodel-catalogue-reference-table-scroll`);
          await summary.focus();
          await page.keyboard.press('Tab');
          await expect(region).toBeFocused();
          const outline = await region.evaluate((element) => {
            const style = getComputedStyle(element);
            return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
          });
          expect(outline.style).not.toBe('none');
          expect(outline.width).toBeGreaterThanOrEqual(3);
        }
      }
      const results = await new AxeBuilder({ page })
        .include(view.selector)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(results.violations, `${view.pageId} should have no axe violations`).toEqual([]);
    }
  });

  test('keeps resting control borders at 3:1 over supported surfaces', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Border checks run once for each desktop colour theme.');

    await openCatalogue(page, 'Buttons');
    const colours = await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.innerHTML = `
        <button class="nodel-button">Button</button>
        <input class="nodel-field" value="Field" />
        <a class="nodel-list-item">List item</a>
        <button class="nodel-select-trigger">Select</button>
        <button class="nodel-stepper-button">Step</button>
        <button class="nodel-pad-button">Pad</button>
        <button class="nodel-toggle-track">Toggle track</button>
        <button class="nodel-fader-nudge">Nudge</button>
        <button class="nodel-theme-switch">Theme</button>
      `;
      fixture.style.display = 'none';
      document.body.append(fixture);
      const rootStyle = getComputedStyle(document.documentElement);
      const controls = Array.from(fixture.querySelectorAll<HTMLElement>(':scope > *')).map((element) => {
        const style = getComputedStyle(element);
        return { border: style.borderTopColor, borderWidth: Number.parseFloat(style.borderTopWidth), name: element.className };
      });
      fixture.remove();
      return {
        controls,
        surfaces: ['--nodel-bg', '--nodel-surface', '--nodel-surface-raised'].map((name) => `rgb(${rootStyle.getPropertyValue(name).trim()})`)
      };
    });

    for (const control of colours.controls) {
      const border = parseRgb(control.border);
      expect(control.borderWidth, `${control.name} needs a visible border`).toBeGreaterThan(0);
      for (const surfaceValue of colours.surfaces) {
        const surface = parseRgb(surfaceValue);
        const renderedBorder = composite(border, surface);
        expect(contrastRatio(renderedBorder, surface), `${control.name} on ${surfaceValue}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test('keeps edge-ring decoration out of the tree and progress distinguishable', async ({ page }, testInfo) => {
    test.skip(!isAxeProject(testInfo), 'Edge-ring accessibility checks run in desktop and forced-colours projects.');

    await openCatalogue(page, 'PickersPrecision');
    if (isDesktopThemeProject(testInfo)) {
      await setMediaFeature(page, 'prefers-contrast', 'more');
      expect(await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches)).toBe(true);
    }
    const ring = page.locator('[data-catalogue-example="readouts-edge"] nodel-readout').first();
    await expect(ring).toHaveAttribute('role', 'meter');
    await expect(ring).toHaveAttribute('aria-label', 'Brightness: 72%');
    await expect(ring.locator('.nodel-readout-edge-visual')).toHaveAttribute('aria-hidden', 'true');
    await expect(ring.locator('.nodel-readout-value')).toHaveText('72%');

    const styles = await ring.evaluate((element) => {
      const track = element.querySelector<SVGPathElement>('.nodel-readout-edge-track');
      const progress = element.querySelector<SVGPathElement>('.nodel-readout-edge-progress');
      const trackStyle = track ? getComputedStyle(track) : null;
      const progressStyle = progress ? getComputedStyle(progress) : null;
      const rootStyle = getComputedStyle(document.documentElement);
      let background = '';
      let ancestor: Element | null = element;
      while (ancestor) {
        const colour = getComputedStyle(ancestor).backgroundColor;
        const alpha = colour.match(/rgba?\([^)]*[,/]\s*([\d.]+)%?\s*\)$/)?.[1];
        if (colour !== 'transparent' && (alpha === undefined || Number(alpha) > 0)) {
          background = colour;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (!background) background = `rgb(${rootStyle.getPropertyValue('--nodel-body-background').trim()})`;
      const colourReference = (colour: string) => {
        const reference = document.createElement('span');
        reference.style.cssText = `position:fixed;color:${colour};visibility:hidden`;
        document.body.append(reference);
        const value = getComputedStyle(reference).color;
        reference.remove();
        return value;
      };
      return {
        background,
        trackStroke: trackStyle?.stroke,
        progressStroke: progressStyle?.stroke,
        trackWidth: Number.parseFloat(trackStyle?.strokeWidth ?? '0'),
        progressWidth: Number.parseFloat(progressStyle?.strokeWidth ?? '0'),
        trackDasharray: trackStyle?.strokeDasharray,
        progressDasharray: progress?.style.strokeDasharray.replace(',', ' ').replace(/\s+/g, ' ').trim(),
        warningToken: `rgb(${rootStyle.getPropertyValue('--nodel-warning-fill').trim()})`,
        dangerToken: `rgb(${rootStyle.getPropertyValue('--nodel-danger-fill').trim()})`,
        forcedColours: matchMedia('(forced-colors: active)').matches,
        canvasText: colourReference('CanvasText'),
        highlight: colourReference('Highlight')
      };
    });
    expect(styles.trackStroke).not.toBe('none');
    expect(styles.progressStroke).not.toBe('none');
    if (isDesktopThemeProject(testInfo)) {
      expect(contrastRatio(parseRgb(styles.trackStroke!), parseRgb(styles.background))).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(parseRgb(styles.progressStroke!), parseRgb(styles.background))).toBeGreaterThanOrEqual(3);
      expect(styles.trackWidth).toBeLessThan(styles.progressWidth);
      expect(styles.trackDasharray).not.toBe('none');
      const progressDasharray = styles.progressDasharray?.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      expect(progressDasharray[0]).toBeCloseTo(0.72, 5);
      expect(progressDasharray[1]).toBeCloseTo(1, 5);
      const thresholdColours = await page.evaluate(() => {
        const fixture = document.createElement('div');
        fixture.innerHTML = `
          <nodel-readout label="Warning" type="percent" visual="ring" ring-layout="edge" warn="50" value="75"></nodel-readout>
          <nodel-readout label="Danger" type="percent" visual="ring" ring-layout="edge" danger="50" value="75"></nodel-readout>`;
        document.body.append(fixture);
        const progress = Array.from(fixture.querySelectorAll<SVGPathElement>('.nodel-readout-edge-progress'))
          .map((element) => getComputedStyle(element).stroke);
        fixture.remove();
        const rootStyle = getComputedStyle(document.documentElement);
        return {
          progress,
          warning: `rgb(${rootStyle.getPropertyValue('--nodel-warning-fill').trim()})`,
          danger: `rgb(${rootStyle.getPropertyValue('--nodel-danger-fill').trim()})`
        };
      });
      expect(parseRgb(thresholdColours.progress[0]!)).toEqual(parseRgb(thresholdColours.warning));
      expect(parseRgb(thresholdColours.progress[1]!)).toEqual(parseRgb(thresholdColours.danger));
      expect(contrastRatio(parseRgb(thresholdColours.progress[0]!), parseRgb(styles.background))).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(parseRgb(thresholdColours.progress[1]!), parseRgb(styles.background))).toBeGreaterThanOrEqual(3);
    }
    if (styles.forcedColours) {
      expect(styles.trackStroke).toBe(styles.canvasText);
      expect(styles.progressStroke).toBe(styles.highlight);
      const progressDasharray = styles.progressDasharray?.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      expect(progressDasharray[0]).toBeCloseTo(0.72, 5);
      expect(progressDasharray[1]).toBeCloseTo(1, 5);
      expect(styles.progressStroke).not.toBe('none');
    }
  });

  test('measures marked control and inactive-status boundaries in rendered surface fixtures', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Pixel checks run once for each desktop colour theme at 1x scale.');

    await openCatalogue(page, 'Buttons');

    const fixture = await page.evaluate(() => {
      const pageContent = document.querySelector<HTMLElement>('nodel-page[data-page-id="Buttons"][active] [data-page-content]');
      if (!pageContent) {
        throw new Error('Missing active Buttons catalogue page.');
      }

      const matrix = document.createElement('div');
      matrix.className = 'grid gap-4 md:grid-cols-2';
      matrix.dataset.generatedBoundaryMatrix = '';

      const surfaces = [
        { className: 'p-5', name: 'body' },
        { className: 'nodel-card p-5', name: 'card' },
        { className: 'nodel-panel p-5', name: 'panel' },
        { className: 'nodel-popover p-5', name: 'popover' }
      ];

      for (const definition of surfaces) {
        const surface = document.createElement('section');
        surface.className = definition.className;
        surface.dataset.boundarySurface = definition.name;
        const samples = document.createElement('div');
        samples.className = 'grid gap-3';
        samples.dataset.generatedBoundarySamples = '';
        samples.innerHTML = `
          <button class="nodel-button" data-boundary-control="button">Button</button>
          <input class="nodel-field" data-boundary-control="field" value="Field" />
          <button class="nodel-list-item" data-boundary-control="list-item">List item</button>
          <button class="nodel-select-trigger" data-boundary-control="select-trigger">Select</button>
          <button class="nodel-toggle-track" data-boundary-control="toggle-track" aria-label="Toggle">&nbsp;</button>
          <button class="nodel-stepper-button" data-boundary-control="stepper">Step</button>
          <button class="nodel-pad-button" data-boundary-control="pad">Pad</button>
          <button class="nodel-fader-nudge" data-boundary-control="fader-nudge" aria-label="Nudge">−</button>
          <button class="nodel-theme-switch" data-boundary-control="theme-switch" aria-label="Theme">&nbsp;</button>
          <span class="nodel-status-scale"><span data-status-track-sample="inactive"></span></span>
        `;
        for (const control of samples.querySelectorAll<HTMLElement>('[data-boundary-control]')) {
          control.style.borderWidth = '2px';
          control.style.boxShadow = 'none';
        }
        const status = samples.querySelector<HTMLElement>('[data-status-track-sample]');
        if (status) {
          status.style.borderWidth = '2px';
          status.style.boxShadow = 'none';
        }
        surface.append(samples);
        matrix.append(surface);
      }
      pageContent.prepend(matrix);

      const asBox = (element: Element): Box => {
        const { height, width, x, y } = element.getBoundingClientRect();
        return { height, width, x: x + window.scrollX, y: y + window.scrollY };
      };
      const surfaceFor = (element: Element) => element.closest<HTMLElement>('[data-boundary-surface]')?.dataset.boundarySurface;
      const controls = Array.from(matrix.querySelectorAll<HTMLElement>('[data-boundary-control]')).map((element, index): BoundarySample => {
        const style = getComputedStyle(element);
        const surface = surfaceFor(element);
        if (!surface) {
          throw new Error(`Control ${index + 1} is not inside a marked boundary surface.`);
        }
        return {
          box: asBox(element),
          borderWidth: Number.parseFloat(style.borderTopWidth),
          name: element.dataset.boundaryControl || `${element.tagName.toLowerCase()} ${index + 1}`,
          surface
        };
      });
      const statuses = Array.from(matrix.querySelectorAll<HTMLElement>('[data-status-track-sample]')).map((element, index): StatusSample => {
        const surface = surfaceFor(element);
        if (!surface) {
          throw new Error(`Status mark ${index + 1} is not inside a marked boundary surface.`);
        }
        return {
          box: asBox(element),
          name: element.dataset.statusTrackSample || `${element.tagName.toLowerCase()} ${index + 1}`,
          surface
        };
      });

      return { controls, statuses };
    });

    const expectedSurfaces = ['body', 'card', 'panel', 'popover'];
    for (const surface of expectedSurfaces) {
      expect(fixture.controls.filter((control) => control.surface === surface), `${surface} fixture needs marked controls`).not.toHaveLength(0);
      expect(fixture.statuses.filter((status) => status.surface === surface), `${surface} fixture needs an inactive status sample`).not.toHaveLength(0);
    }

    const png = PNG.sync.read(await page.screenshot({ fullPage: true, scale: 'css' }));
    for (const control of fixture.controls) {
      expect(control.borderWidth, `${control.name} needs a visible rendered border`).toBeGreaterThan(0);
      const { border, surface } = sampleBoundary(png, control.box, control.borderWidth);
      expect(
        contrastRatio(border, surface),
        `${control.name} boundary on ${control.surface}: ${rgbLabel(border)} against ${rgbLabel(surface)}`
      ).toBeGreaterThanOrEqual(3);
    }

    for (const status of fixture.statuses) {
      const { mark, surface } = sampleStatusMark(png, status.box);
      expect(contrastRatio(mark, surface), `${status.name} inactive mark on ${status.surface}`).toBeGreaterThanOrEqual(3);
    }
  });

  test('keeps neutral text, placeholder, preview, and status colours readable', async ({ page }, testInfo) => {
    test.skip(!isDarkThemeEngineProject(testInfo), 'Neutral text checks run once for each desktop colour theme and engine.');
    await openCatalogue(page, 'Media');
    if (testInfo.project.name.includes('firefox') || testInfo.project.name.includes('webkit')) {
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    }
    const colours = await page.evaluate(async () => {
      const fixture = document.createElement('div');
       fixture.innerHTML = `
        <div class="nodel-panel" data-colour-surface>
          <span data-colour-text>Readable text</span>
          <input class="nodel-field" placeholder="Placeholder" data-colour-field />
          <a class="nodel-link" href="#colour">Link</a>
          <details class="nodel-collapse"><summary class="nodel-collapse-summary"><span class="nodel-collapse-preview">Preview</span></summary></details>
          ${['accent', 'info', 'success', 'warning', 'danger'].map((tone) => `<button class="nodel-button nodel-button-${tone === 'accent' ? 'primary' : tone}" data-colour-fill="${tone}">${tone} fill</button>`).join('')}
          ${['success', 'info', 'warning', 'danger'].map((state) => `<nodel-status state="${state}" label="${state}" message="${state} status"></nodel-status>`).join('')}
          <nodel-status-indicator data-colour-indicator state="on" value="on" show-state-label></nodel-status-indicator>
        </div>`;
        document.body.append(fixture);
      await customElements.whenDefined('nodel-status');
      await customElements.whenDefined('nodel-status-indicator');
      const surface = fixture.querySelector<HTMLElement>('[data-colour-surface]');
      const read = (element: Element, pseudo?: string) => {
        const style = getComputedStyle(element, pseudo);
        let background = style.backgroundColor;
        if (background === 'transparent' || background === 'rgba(0, 0, 0, 0)') {
          let ancestor = element.parentElement;
          while (ancestor && (background === 'transparent' || background === 'rgba(0, 0, 0, 0)')) {
            background = getComputedStyle(ancestor).backgroundColor;
            ancestor = ancestor.parentElement;
          }
        }
        return { color: style.color, background, opacity: Number(style.opacity) };
      };
      if (!surface) throw new Error('Missing colour fixture surface.');
      const surfaceStyle = getComputedStyle(surface);
      const field = fixture.querySelector('[data-colour-field]');
      const preview = fixture.querySelector('.nodel-collapse-preview');
      const text = fixture.querySelector('[data-colour-text]');
      const link = fixture.querySelector('.nodel-link');
      const fills = Array.from(fixture.querySelectorAll('[data-colour-fill]'));
      const indicatorLabels = Array.from(fixture.querySelectorAll('[data-colour-indicator] .nodel-status-indicator-label'));
      const statusShells = Array.from(fixture.querySelectorAll('.nodel-status-shell'));
      if (!field || !preview || !text || !link || fills.length !== 5 || statusShells.length !== 4 || indicatorLabels.length !== 1) {
        throw new Error(`Missing colour fixture node: fills=${fills.length}, statuses=${statusShells.length}, indicators=${indicatorLabels.length}.`);
      }
      const tokenShape = ['--nodel-bg', '--nodel-fg', '--nodel-surface', '--nodel-surface-raised', '--nodel-muted', '--nodel-border', '--nodel-status-off', '--nodel-status-track-background', '--nodel-status-track-border', '--nodel-backdrop']
        .map((name) => [name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()]);
      const values = {
        background: surfaceStyle.backgroundColor,
        field: read(field, '::placeholder'),
        fills: fills.map((fill) => ({ name: fill.getAttribute('data-colour-fill'), ...read(fill) })),
        indicator: read(indicatorLabels[0]!),
        link: read(link),
        preview: read(preview),
        statusFills: statusShells.map((shell) => {
          const state = shell.closest('nodel-status')?.getAttribute('state') ?? '';
          const fill = shell.querySelector(`[data-status-step="${state}"]`);
          if (!fill) throw new Error(`Missing active ${state} status mark.`);
          const base = document.createElement('span');
          base.style.background = 'var(--nodel-status-base-background)';
          shell.append(base);
          const result = { name: state, mark: read(fill).background, background: read(base).background };
          base.remove();
          return result;
        }),
        text: read(text),
        tokenShape
      };
      fixture.remove();
      return values;
    });
    for (const item of [colours.text, colours.field, colours.link, colours.preview, colours.indicator]) {
      const foreground = parseRgb(item.color);
      foreground.alpha = (foreground.alpha ?? 1) * item.opacity;
      const itemBackground = /rgb|rgba/.test(item.background) ? parseRgb(item.background) : parseRgb(colours.background);
      expect(contrastRatio(composite(foreground, itemBackground), itemBackground), `${item.color} on ${item.background}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const item of colours.fills) {
      const foreground = parseRgb(item.color);
      const itemBackground = parseRgb(item.background);
      expect(contrastRatio(composite(foreground, itemBackground), itemBackground), `${item.name} fill`).toBeGreaterThanOrEqual(4.5);
    }
    for (const item of colours.statusFills) {
      expect(contrastRatio(parseRgb(item.mark), parseRgb(item.background)), `${item.name} status mark`).toBeGreaterThanOrEqual(3);
    }
    for (const [name, value] of colours.tokenShape) {
      expect(value, `${name} must remain a channel triplet`).toMatch(/^\d+\s+\d+\s+\d+$/);
    }
  });

  test('keeps rendered solid semantic button states readable through filters', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Solid button state checks run once per desktop colour theme.');
    await openCatalogue(page, 'Buttons');
    if (testInfo.project.name === 'chromium-dark-desktop') {
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    }
    const fixture = page.locator('[data-catalogue-example="buttons-variants"]').first();
    await fixture.evaluate((container) => {
      const sample = document.createElement('div');
      sample.dataset.solidStateFixture = '';
      sample.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:8px';
      for (const tone of ['primary', 'info', 'success', 'warning', 'danger']) {
        const button = document.createElement('button');
        button.className = `nodel-button nodel-button-${tone}`;
        button.dataset.tone = tone;
        button.textContent = tone;
        sample.append(button);
      }
      container.append(sample);
    });
    const buttons = page.locator('[data-solid-state-fixture] button');
    const states = ['rest', 'hover', 'pressed'] as const;
    for (const button of await buttons.all()) {
      for (const state of states) {
        if (state === 'hover') await button.hover();
        const box = await button.boundingBox();
        if (!box) throw new Error('Missing solid button box.');
        if (state === 'pressed') {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
        }
        await page.waitForTimeout(250);
        const rendered = await page.screenshot({ scale: 'css' });
        const png = PNG.sync.read(rendered);
        const buttonBackground = readPixel(png, box.x + box.width - 6, box.y + box.height / 2);
        const surrounding = readPixel(png, box.x - 4, box.y + box.height / 2);
        const styles = await button.evaluate((element) => ({ color: getComputedStyle(element).color, filter: getComputedStyle(element).filter }));
        const text = applyBrightness(parseRgb(styles.color), styles.filter);
        expect(contrastRatio(buttonBackground, surrounding), `${await button.getAttribute('data-tone')} ${state} background`).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(text, buttonBackground), `${await button.getAttribute('data-tone')} ${state} text`).toBeGreaterThanOrEqual(4.5);
        if (state === 'pressed') await page.mouse.up();
      }
    }
  });
});
