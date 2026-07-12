import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

type Rgb = { blue: number; green: number; red: number; alpha?: number };
type Box = { height: number; width: number; x: number; y: number };
type BoundarySample = { box: Box; borderWidth: number; name: string; surface: string };
type StatusSample = { box: Box; name: string; surface: string };

const representativeViews = [
  { pageId: 'Buttons', selector: '[data-catalogue-example="buttons-variants"]' },
  { pageId: 'PickersPrecision', selector: '[data-catalogue-example="select-stepper"]' },
  { pageId: 'FadersMeters', selector: '[data-catalogue-example="faders-compound-fader"]' },
  { pageId: 'Media', selector: '[data-catalogue-example="media-status-blocks"]' },
  { pageId: 'Text', selector: '[data-catalogue-example="content-text-surface"]' }
];

async function openCatalogue(page: Page, pageId: string) {
  await page.goto(`/components.html#${pageId}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`nodel-page[data-page-id="${pageId}"][active]`).waitFor();
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });
}

function isDesktopThemeProject(testInfo: TestInfo) {
  return testInfo.project.name === 'chromium-light-desktop' || testInfo.project.name === 'chromium-dark-desktop';
}

function parseRgb(value: string): Rgb {
  const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
  if (parts.length < 3) {
    throw new Error(`Expected an RGB colour, received ${value}`);
  }

  return { red: parts[0], green: parts[1], blue: parts[2], alpha: parts[3] ?? 1 };
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
  const [lighter, darker] = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
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
    red: png.data[offset],
    green: png.data[offset + 1],
    blue: png.data[offset + 2],
    alpha: png.data[offset + 3] / 255
  };
}

function sampleBoundary(png: PNG, box: Box, borderWidth: number) {
  const y = box.y + box.height / 2;
  const edge = box.x + box.width;
  const surface = readPixel(png, edge + 4, y);
  const candidates = Array.from({ length: Math.max(3, Math.ceil(borderWidth) + 2) }, (_, index) =>
    readPixel(png, edge + 1 - index, y));
  const border = candidates.sort((left, right) => contrastRatio(right, surface) - contrastRatio(left, surface))[0];

  return { border, surface };
}

function sampleStatusMark(png: PNG, box: Box) {
  const y = box.y + box.height / 2;
  const surface = readPixel(png, box.x - 4, y);
  const candidates = Array.from({ length: 4 }, (_, index) => readPixel(png, box.x - 1 + index, y));
  const mark = candidates.sort((left, right) => contrastRatio(right, surface) - contrastRatio(left, surface))[0];

  return { mark, surface };
}

test.describe('catalogue accessibility', () => {
  test('has no axe violations in representative catalogue views in each theme', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Axe runs once for each desktop colour theme.');

    for (const view of representativeViews) {
      await openCatalogue(page, view.pageId);
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
});
