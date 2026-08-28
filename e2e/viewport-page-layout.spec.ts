import { expect, test, type Page } from '@playwright/test';

async function loadEntry(page: Page) {
  await page.goto('/nodel.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('nodel-app')).toBeVisible();
}

async function addFixture(page: Page, html: string, options: { fixed?: boolean; expectViewport?: boolean } = {}) {
  await page.evaluate(({ html, fixed }) => {
    for (const child of document.body.children) {
      if (child.localName === 'nodel-app') (child as HTMLElement).hidden = true;
    }
    const fixture = document.createElement('div');
    fixture.dataset.viewportFixture = 'true';
    fixture.style.cssText = fixed
      ? 'position:fixed;inset:0;z-index:100;pointer-events:none;'
      : 'position:relative;z-index:100;';
    fixture.innerHTML = html;
    document.body.append(fixture);
  }, { html, fixed: options.fixed ?? true });
  const fixture = page.locator('[data-viewport-fixture]');
  if (options.expectViewport ?? true) {
    await expect(fixture.locator('nodel-page').first()).toHaveAttribute('data-min-height', 'viewport');
  }
  return fixture;
}

async function boxes(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
  }));
}

async function edgeGeometry(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const svg = element.querySelector<SVGSVGElement>('.nodel-readout-edge-visual')!;
    const path = element.querySelector<SVGPathElement>('.nodel-readout-edge-track')!;
    const matrix = svg.querySelector('g')!.getScreenCTM()!;
    const length = path.getTotalLength();
    const points = [0, 0.05, 0.5, 1].map((fraction) => {
      const point = path.getPointAtLength(length * fraction);
      return { x: point.x, y: point.y };
    });
    const screen = points.map(({ x, y }) => ({
      x: matrix.a * x + matrix.c * y + matrix.e,
      y: matrix.b * x + matrix.d * y + matrix.f
    }));
    const rect = svg.getBoundingClientRect();
    return {
      points,
      screen,
      length,
      scale: { x: Math.hypot(matrix.a, matrix.b), y: Math.hypot(matrix.c, matrix.d) },
      drawnSide: Math.min(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)) * 240,
      center: { x: matrix.a * 120 + matrix.c * 120 + matrix.e, y: matrix.b * 120 + matrix.d * 120 + matrix.f },
      rect,
      value: element.querySelector('.nodel-readout-value')!.getBoundingClientRect(),
      fontSize: Number.parseFloat(getComputedStyle(element.querySelector('.nodel-readout-value')!).fontSize),
      content: element.querySelector<HTMLElement>('.nodel-readout-content')!.getBoundingClientRect(),
      contentClient: { width: element.querySelector<HTMLElement>('.nodel-readout-content')!.clientWidth, height: element.querySelector<HTMLElement>('.nodel-readout-content')!.clientHeight },
      contentScroll: { width: element.querySelector<HTMLElement>('.nodel-readout-content')!.scrollWidth, height: element.querySelector<HTMLElement>('.nodel-readout-content')!.scrollHeight },
      valueClient: { width: element.querySelector<HTMLElement>('.nodel-readout-value')!.clientWidth, height: element.querySelector<HTMLElement>('.nodel-readout-value')!.clientHeight },
      valueScroll: { width: element.querySelector<HTMLElement>('.nodel-readout-value')!.scrollWidth, height: element.querySelector<HTMLElement>('.nodel-readout-value')!.scrollHeight }
    };
  });
}

test.describe('viewport page layout geometry', () => {
  test('fills a 480x480 direct grid with six controls in three equal rows', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 480, height: 480 });
    const fixture = await addFixture(page, `
      <nodel-app>
        <nodel-page title="Grid" min-height="viewport">
        <nodel-control-grid fill columns="2" style="--nodel-control-grid-gap:8px">
          <nodel-button>A</nodel-button><nodel-button>B</nodel-button><nodel-button>C</nodel-button>
          <nodel-button>D</nodel-button><nodel-button>E</nodel-button><nodel-button>F</nodel-button>
        </nodel-control-grid>
        </nodel-page>
      </nodel-app>`);
    const result = await fixture.evaluate((root) => {
      const page = root.querySelector('nodel-page')!;
      const grid = root.querySelector('nodel-control-grid')!;
      const buttons = [...root.querySelectorAll('nodel-button')].map((button) => button.getBoundingClientRect());
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      return { scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight, viewport, page: page.getBoundingClientRect(), grid: grid.getBoundingClientRect(), buttons };
    });
    expect(result.scrollHeight).toBeLessThanOrEqual(result.clientHeight);
    expect(result.page.height).toBeCloseTo(480, 0);
    for (const rect of [result.grid, ...result.buttons]) {
      expect(rect.left).toBeGreaterThanOrEqual(result.page.left - 1);
      expect(rect.right).toBeLessThanOrEqual(result.page.right + 1);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.bottom).toBeLessThanOrEqual(result.viewport.height + 1);
    }
    expect(result.grid.height).toBeGreaterThan(350);
    expect(Math.max(...result.buttons.map((button) => button.height)) - Math.min(...result.buttons.map((button) => button.height))).toBeLessThanOrEqual(1);
    expect(Math.min(...result.buttons.map((button) => button.height))).toBeGreaterThan(100);
    expect(new Set(result.buttons.map((button) => Math.round(button.top))).size).toBe(3);
  });

  test('fills a standalone viewport page with a direct fill group', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 480, height: 480 });
    const fixture = await addFixture(page, `
      <nodel-page title="Group" min-height="viewport">
        <nodel-group fill><nodel-button>Fill</nodel-button></nodel-group>
      </nodel-page>`);
    const result = await fixture.evaluate((root) => {
      const page = root.querySelector('nodel-page')!.getBoundingClientRect();
      const group = root.querySelector('nodel-group')!.getBoundingClientRect();
      return { page, group };
    });
    expect(result.page.height).toBeCloseTo(480, 0);
    expect(result.group.height).toBeGreaterThan(400);
  });

  test('propagates row height through two span-6 columns without structural fill attributes', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 480, height: 480 });
    const fixture = await addFixture(page, `
      <nodel-app>
        <nodel-page title="Columns" min-height="viewport">
        <nodel-row>
          <nodel-column span="6"><nodel-control-grid fill columns="1"><nodel-button>A</nodel-button><nodel-button>B</nodel-button><nodel-button>C</nodel-button></nodel-control-grid></nodel-column>
          <nodel-column span="6"><nodel-control-grid fill columns="1"><nodel-button>D</nodel-button><nodel-button>E</nodel-button><nodel-button>F</nodel-button></nodel-control-grid></nodel-column>
        </nodel-row>
        </nodel-page>
      </nodel-app>`);
    const result = await fixture.evaluate((root) => {
      const row = root.querySelector('nodel-row')!.getBoundingClientRect();
      const columns = [...root.querySelectorAll('nodel-column')].map((column) => column.getBoundingClientRect());
      const grids = [...root.querySelectorAll('nodel-control-grid')].map((grid) => grid.getBoundingClientRect());
      return { row, columns, grids, rowFill: root.querySelector('nodel-row')!.hasAttribute('fill'), columnFill: [...root.querySelectorAll('nodel-column')].some((column) => column.hasAttribute('fill')) };
    });
    expect(result.rowFill).toBe(false);
    expect(result.columnFill).toBe(false);
    expect(Math.abs(result.columns[0]!.height - result.row.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.grids[0]!.height - result.columns[0]!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.grids[0]!.height - result.grids[1]!.height)).toBeLessThanOrEqual(1);
  });

  test('keeps unfilled and competing groups in natural row flow', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 720, height: 640 });
    const fixture = await addFixture(page, `
      <nodel-page title="Row flow" min-height="viewport">
        <nodel-row>
          <nodel-column span="4">
            <nodel-group><nodel-button>Natural</nodel-button></nodel-group>
            <nodel-group><nodel-button>Following</nodel-button></nodel-group>
          </nodel-column>
          <nodel-column span="4">
            <nodel-group fill><nodel-button>Competing fill</nodel-button></nodel-group>
            <nodel-group><nodel-button>Visible sibling</nodel-button></nodel-group>
          </nodel-column>
          <nodel-column span="4">
            <nodel-group fill><nodel-button>Sole fill</nodel-button></nodel-group>
          </nodel-column>
        </nodel-row>
      </nodel-page>`);
    const result = await fixture.evaluate((root) => {
      const columns = [...root.querySelectorAll('nodel-column')];
      const groups = [...root.querySelectorAll('nodel-group')].map((group) => group.getBoundingClientRect());
      return {
        fills: columns.map((column) => column.hasAttribute('data-fill-child')),
        columns: columns.map((column) => column.getBoundingClientRect()),
        groups
      };
    });
    expect(result.fills).toEqual([false, false, true]);
    expect(result.groups[1]!.top).toBeGreaterThanOrEqual(result.groups[0]!.bottom - 1);
    expect(result.groups[3]!.top).toBeGreaterThanOrEqual(result.groups[2]!.bottom - 1);
    expect(result.groups[1]!.bottom).toBeLessThanOrEqual(result.columns[0]!.bottom + 1);
    expect(result.groups[3]!.bottom).toBeLessThanOrEqual(result.columns[1]!.bottom + 1);
    expect(Math.abs(result.groups[4]!.height - result.columns[2]!.height)).toBeLessThanOrEqual(1);
  });

  test('splits direct rows after natural heading content', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 720, height: 640 });
    await addFixture(page, `
      <nodel-app>
        <nodel-page title="Rows" min-height="viewport">
        <h1 style="height:40px">Heading</h1>
        <nodel-row><nodel-column><nodel-button>One</nodel-button></nodel-column></nodel-row>
        <nodel-row><nodel-column><nodel-button>Two</nodel-button></nodel-column></nodel-row>
        </nodel-page>
      </nodel-app>`);
    const rows = await boxes(page, '[data-viewport-fixture] nodel-row');
    expect(Math.abs(rows[0]!.height - rows[1]!.height)).toBeLessThanOrEqual(1);
    expect(Math.min(...rows.map((row) => row.height))).toBeGreaterThan(200);
    expect(rows[0]!.top).toBeGreaterThan(40);
  });

  test('reserves toolbar and fixed footer exactly once', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 320, height: 640 });
    const fixture = await addFixture(page, `
      <nodel-app>
        <nodel-toolbar title="Narrow toolbar">
          <button type="button">Action</button>
          <span>Generated navigation content</span>
        </nodel-toolbar>
        <nodel-page title="Toolbar page" min-height="viewport">
          <nodel-control-grid fill columns="1"><nodel-button>Action</nodel-button></nodel-control-grid>
        </nodel-page>
        <nodel-page title="Another page">Another</nodel-page>
        <nodel-footer fixed><span>Footer content</span></nodel-footer>
      </nodel-app>`);
    const app = fixture.locator('nodel-app');
    const shell = fixture.locator('[data-footer-shell]');
    await expect(app).toHaveAttribute('data-fixed-footer', 'true');
    await expect(shell).toBeVisible();
    await expect(shell).toHaveCSS('position', 'fixed');
    const result = await fixture.evaluate((root) => {
      const toolbarShell = root.querySelector('.nodel-toolbar-shell')!.getBoundingClientRect();
      const brand = root.querySelector('[data-toolbar-brand]')!.getBoundingClientRect();
      const nav = root.querySelector('[data-toolbar-nav]')!.getBoundingClientRect();
      const actions = root.querySelector('[data-toolbar-actions]')!.getBoundingClientRect();
      const page = root.querySelector('nodel-page')!.getBoundingClientRect();
      const footer = root.querySelector('[data-footer-shell]')!.getBoundingClientRect();
      const button = root.querySelector('nodel-button')!.getBoundingClientRect();
      return { toolbarShell, brand, nav, actions, page, footer, button, scrollHeight: document.documentElement.scrollHeight };
    });
    expect(result.brand.top).toBeLessThan(result.actions.bottom);
    expect(result.actions.top).toBeLessThan(result.brand.bottom);
    expect(result.nav.top).toBeGreaterThanOrEqual(result.brand.bottom - 1);
    expect(result.page.top).toBeGreaterThanOrEqual(result.toolbarShell.bottom - 1);
    expect(result.button.bottom).toBeLessThanOrEqual(result.footer.top + 1);
    expect(result.scrollHeight).toBeLessThanOrEqual(641);
    expect(result.toolbarShell.bottom + result.page.height + result.footer.height).toBeLessThanOrEqual(641);
    const initialPageHeight = result.page.height;
    const initialFooterHeight = result.footer.height;
    await fixture.locator('nodel-footer [data-footer-shell]').evaluate((footer) => { footer.innerHTML = '<div style="height:120px">Expanded footer content</div>'; });
    await expect.poll(() => fixture.locator('nodel-footer [data-footer-shell]').evaluate((footer) => footer.getBoundingClientRect().height)).toBeGreaterThan(initialFooterHeight);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('[data-viewport-fixture] nodel-app')!).getPropertyValue('--nodel-fixed-footer-height'))).not.toBe(`${initialFooterHeight}px`);
    await expect.poll(() => page.evaluate(() => {
      const appElement = document.querySelector('[data-viewport-fixture] nodel-app')!;
      const shellElement = document.querySelector('[data-viewport-fixture] [data-footer-shell]')!;
      return Math.round(Number.parseFloat(getComputedStyle(appElement).paddingBottom)) - Math.ceil(shellElement.getBoundingClientRect().height);
    })).toBe(0);
    await fixture.locator('nodel-footer').evaluate((footer) => footer.remove());
    await expect(app).not.toHaveAttribute('data-fixed-footer', 'true');
    await expect.poll(() => fixture.locator('nodel-page[active]').evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(initialPageHeight);
  });

  test('lets a normal-flow footer consume natural height before page remainder', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 720, height: 640 });
    const fixture = await addFixture(page, `
      <nodel-app>
        <nodel-page title="Flow" min-height="viewport">
          <nodel-control-grid fill columns="1"><nodel-button>Content</nodel-button></nodel-control-grid>
        </nodel-page>
        <nodel-footer><div style="height:80px">Natural footer</div></nodel-footer>
      </nodel-app>`);
    const result = await fixture.evaluate((root) => ({
      app: root.querySelector('nodel-app')!.getBoundingClientRect(),
      page: root.querySelector('nodel-page')!.getBoundingClientRect(),
      footer: root.querySelector('[data-footer-shell]')!.getBoundingClientRect(),
      fixed: root.querySelector('nodel-app')!.hasAttribute('data-fixed-footer')
    }));
    expect(result.fixed).toBe(false);
    expect(result.footer.height).toBeGreaterThanOrEqual(80);
    expect(result.page.bottom).toBeCloseTo(result.footer.top, 0);
    expect(result.page.height + result.footer.height).toBeCloseTo(result.app.height, 0);
  });

  test('bleed preserves fixed-footer reservation without overlap or horizontal overflow', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 320, height: 640 });
    const fixture = await addFixture(page, `
      <nodel-app>
        <nodel-page title="Bleed footer" min-height="viewport" bleed>
          <nodel-control-grid fill columns="1"><nodel-button>Content</nodel-button></nodel-control-grid>
        </nodel-page>
        <nodel-footer fixed><span>Fixed footer</span></nodel-footer>
      </nodel-app>`);
    const result = await fixture.evaluate((root) => {
      const app = root.querySelector('nodel-app')!.getBoundingClientRect();
      const page = root.querySelector('nodel-page')!.getBoundingClientRect();
      const footer = root.querySelector('[data-footer-shell]')!.getBoundingClientRect();
      const button = root.querySelector('nodel-button')!.getBoundingClientRect();
      const appStyle = getComputedStyle(root.querySelector('nodel-app')!);
      return {
        app, page, footer, button,
        scrollWidth: document.documentElement.scrollWidth,
        reserved: Number.parseFloat(appStyle.paddingBottom),
        footerHeight: footer.height
      };
    });
    expect(result.scrollWidth).toBeLessThanOrEqual(320);
    expect(result.reserved).toBeGreaterThanOrEqual(result.footerHeight - 1);
    expect(result.page.bottom).toBeLessThanOrEqual(result.footer.top + 1);
    expect(result.button.bottom).toBeLessThanOrEqual(result.footer.top + 1);
    expect(result.app.height).toBeLessThanOrEqual(641);
  });

  test('normalizes page changes and active nested leaf routes', async ({ page }) => {
    await loadEntry(page);
    const fixture = await addFixture(page, `
      <nodel-app>
        <nodel-page title="Normal">Normal</nodel-page>
        <nodel-page title="Group"><nodel-page title="Nested" min-height="viewport"><nodel-button>Nested</nodel-button></nodel-page></nodel-page>
      </nodel-app>`, { expectViewport: false });
    const app = fixture.locator('nodel-app');
    const normal = fixture.locator('nodel-page[title="Normal"]');
    const nested = fixture.locator('nodel-page[title="Nested"]');
    await expect(nested).toHaveAttribute('data-nav-group-page', 'false');
    await expect(nested).toHaveAttribute('data-min-height', 'viewport');
    await expect(fixture.locator('nodel-page[title="Group"]')).toHaveAttribute('data-nav-group-page', 'true');
    await expect(normal).toHaveAttribute('active', '');
    await expect(normal).toBeVisible();
    await expect(app).not.toHaveCSS('display', 'flex');
    const normalHeight = await normal.boundingBox();
    expect(normalHeight).not.toBeNull();
    await page.evaluate(() => {
      history.replaceState(null, '', `${location.pathname}#Nested`);
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await expect(nested).toHaveAttribute('active', '');
    await expect(normal).not.toHaveAttribute('active', '');
    await expect(app).toHaveCSS('display', 'flex');
    await expect.poll(() => nested.boundingBox()).not.toBeNull();
    const nestedGeometry = await page.evaluate(() => {
      const appElement = document.querySelector('[data-viewport-fixture] nodel-app')!.getBoundingClientRect();
      const nestedElement = document.querySelector('[data-viewport-fixture] nodel-page[title="Nested"]')!.getBoundingClientRect();
      return { app: appElement, nested: nestedElement };
    });
    expect(nestedGeometry.app.height).toBeCloseTo(page.viewportSize()!.height, 0);
    expect(nestedGeometry.nested.height).toBeCloseTo(page.viewportSize()!.height, 0);
    expect(nestedGeometry.nested.top).toBeCloseTo(nestedGeometry.app.top, 0);
    expect(nestedGeometry.nested.bottom).toBeCloseTo(nestedGeometry.app.bottom, 0);
    expect(nestedGeometry.nested.height).toBeGreaterThan(normalHeight!.height + 100);
    expect(nestedGeometry.nested.bottom).toBeLessThanOrEqual((page.viewportSize()?.height ?? 0) + 1);
    await page.evaluate(() => {
      history.replaceState(null, '', `${location.pathname}#Normal`);
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await expect(normal).toHaveAttribute('active', '');
    await expect(app).not.toHaveCSS('display', 'flex');
    await expect.poll(() => nested.boundingBox()).toBeNull();
    await nested.evaluate((element) => element.removeAttribute('min-height'));
    await expect(nested).toHaveAttribute('data-min-height', 'auto');
    await nested.evaluate((element) => element.setAttribute('min-height', 'invalid'));
    await expect(nested).toHaveAttribute('data-min-height', 'auto');
  });

  test('switches dynamic parent wrappers without losing active viewport geometry', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 720, height: 640 });
    const fixture = await addFixture(page, `
      <nodel-app>
        <nodel-page title="Parent" min-height="viewport">
          <h2 data-shared-heading>Shared heading</h2>
          <nodel-page title="Nested" min-height="viewport">
            <nodel-group fill><nodel-button>Nested</nodel-button></nodel-group>
          </nodel-page>
          <footer data-shared-footer>Shared footer</footer>
        </nodel-page>
      </nodel-app>`, { expectViewport: false });
    const parent = fixture.locator('nodel-page[title="Parent"]');
    await expect(parent).toHaveAttribute('data-nav-group-page', 'true');
    await page.evaluate(() => {
      history.replaceState(null, '', `${location.pathname}#Nested`);
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    const nested = fixture.locator('nodel-page[title="Nested"]');
    await expect(nested).toHaveAttribute('active', '');
    await expect(nested.locator('[data-page-content]')).toHaveCSS('display', 'flex');
    const nestedGeometry = await fixture.evaluate((root) => {
      const app = root.querySelector('nodel-app')!.getBoundingClientRect();
      const group = root.querySelector('nodel-page[title="Parent"]')!.getBoundingClientRect();
      const heading = root.querySelector('[data-shared-heading]')!.getBoundingClientRect();
      const nested = root.querySelector('nodel-page[title="Nested"]')!.getBoundingClientRect();
      const footer = root.querySelector('[data-shared-footer]')!.getBoundingClientRect();
      return { app, group, heading, nested, footer };
    });
    expect(nestedGeometry.heading.bottom).toBeLessThanOrEqual(nestedGeometry.nested.top + 1);
    expect(nestedGeometry.nested.left).toBeCloseTo(nestedGeometry.group.left, 0);
    expect(nestedGeometry.nested.right).toBeCloseTo(nestedGeometry.group.right, 0);
    expect(nestedGeometry.nested.bottom).toBeLessThanOrEqual(nestedGeometry.footer.top + 1);
    expect(nestedGeometry.footer.bottom).toBeCloseTo(nestedGeometry.group.bottom, 0);
    expect(nestedGeometry.nested.bottom).toBeLessThanOrEqual(nestedGeometry.app.bottom + 1);

    await nested.evaluate((element) => element.remove());
    await page.evaluate(() => {
      history.replaceState(null, '', `${location.pathname}#Parent`);
      dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await expect(parent).toHaveAttribute('active', '');
    await expect(parent).toHaveAttribute('data-nav-group-page', 'false');
    await expect(parent.locator('[data-page-content]')).toHaveCSS('display', 'flex');
    expect((await parent.boundingBox())?.height).toBeCloseTo(640, 0);
  });

  test('grows document for intrinsic minimums and keeps last control focusable', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 390, height: 180 });
    const fixture = await addFixture(page, `
      <nodel-app>
        <nodel-page title="Overflow" min-height="viewport">
          <nodel-control-grid fill columns="1">
          <nodel-button>One</nodel-button><nodel-button>Two</nodel-button><nodel-button>Three</nodel-button><nodel-button>Last</nodel-button>
          </nodel-control-grid>
        </nodel-page>
      </nodel-app>`, { fixed: false });
    const last = fixture.locator('nodel-button').last().locator('button');
    await last.focus();
    await expect(last).toBeFocused();
    await last.evaluate((button) => button.scrollIntoView({ block: 'center' }));
    const result = await fixture.evaluate((root) => ({
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      buttons: [...root.querySelectorAll('nodel-button')].map((button) => button.getBoundingClientRect()),
      last: root.querySelector('nodel-button:last-of-type button')!.getBoundingClientRect(),
      focusStyle: (() => {
        const button = root.querySelector('nodel-button:last-of-type button')!;
        const style = getComputedStyle(button);
        return button.matches(':focus-visible') && (style.outlineStyle !== 'none' || style.boxShadow !== 'none');
      })(),
      focusClearance: (() => {
        const rect = root.querySelector('nodel-button:last-of-type button')!.getBoundingClientRect();
        return Math.min(rect.top, rect.left, window.innerHeight - rect.bottom, window.innerWidth - rect.right);
      })(),
      clippedAncestor: (() => {
        let ancestor = root.querySelector('nodel-button:last-of-type button')!.parentElement;
        while (ancestor && ancestor !== root) {
          const style = getComputedStyle(ancestor);
          if ([style.overflow, style.overflowX, style.overflowY].some((value) => value === 'hidden' || value === 'clip')) return ancestor.localName;
          ancestor = ancestor.parentElement;
        }
        return '';
      })()
    }));
    expect(result.scrollHeight).toBeGreaterThan(result.viewportHeight);
    expect(result.buttons[0]!.bottom).toBeLessThanOrEqual(result.buttons[1]!.top + 1);
    expect(result.buttons[2]!.bottom).toBeLessThanOrEqual(result.buttons[3]!.top + 1);
    expect(result.last.top).toBeGreaterThanOrEqual(8);
    expect(result.last.bottom).toBeLessThanOrEqual(result.viewportHeight - 8);
    expect(result.focusStyle).toBe(true);
    expect(result.focusClearance).toBeGreaterThanOrEqual(8);
    expect(result.clippedAncestor).toBe('');
  });

  test('bleed retains intrinsic overflow reachability without wrapper clipping', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 390, height: 180 });
    const fixture = await addFixture(page, `
      <nodel-app>
        <nodel-page title="Bleed overflow" min-height="viewport" bleed>
          <nodel-control-grid fill columns="1">
            <nodel-button>One</nodel-button><nodel-button>Two</nodel-button><nodel-button>Three</nodel-button><nodel-button>Last</nodel-button>
          </nodel-control-grid>
        </nodel-page>
      </nodel-app>`, { fixed: false });
    const last = fixture.locator('nodel-button').last().locator('button');
    await last.focus();
    await expect(last).toBeFocused();
    await last.evaluate((button) => button.scrollIntoView({ block: 'center' }));
    const result = await fixture.evaluate((root) => {
      const page = root.querySelector('nodel-page')!;
      const content = root.querySelector('[data-page-content]')!;
      const grid = root.querySelector('nodel-control-grid')!;
      const lastButton = root.querySelector('nodel-button:last-of-type button')!.getBoundingClientRect();
      let ancestor: Element | null = root.querySelector('nodel-button:last-of-type button')!.parentElement;
      let clippedAncestor = '';
      while (ancestor && ancestor !== root) {
        const style = getComputedStyle(ancestor);
        if ([style.overflow, style.overflowX, style.overflowY].some((value) => value === 'hidden' || value === 'clip')) {
          clippedAncestor = ancestor.localName;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      return {
        page: page.getBoundingClientRect(),
        content: content.getBoundingClientRect(),
        grid: grid.getBoundingClientRect(),
        paddingTop: getComputedStyle(content).paddingTop,
        paddingRight: getComputedStyle(content).paddingRight,
        paddingBottom: getComputedStyle(content).paddingBottom,
        paddingLeft: getComputedStyle(content).paddingLeft,
        lastButton,
        clippedAncestor,
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: innerHeight
      };
    });
    expect(result.scrollHeight).toBeGreaterThan(result.viewportHeight);
    expect(result.clippedAncestor).toBe('');
    expect(result.lastButton.top).toBeGreaterThanOrEqual(0);
    expect(result.lastButton.bottom).toBeLessThanOrEqual(result.viewportHeight);
    expect(result.paddingTop).toBe('0px');
    expect(result.paddingRight).toBe('0px');
    expect(result.paddingBottom).toBe('0px');
    expect(result.paddingLeft).toBe('0px');
    expect(result.content.left).toBeCloseTo(result.page.left, 0);
    expect(result.content.right).toBeCloseTo(result.page.right, 0);
    expect(result.grid.left).toBeCloseTo(result.content.left, 0);
    expect(result.grid.right).toBeCloseTo(result.content.right, 0);
  });

  test('updates min-height and responsive reflow without stale geometry', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 900, height: 600 });
    const fixture = await addFixture(page, `
      <nodel-app>
        <nodel-page title="Dynamic" min-height="viewport">
          <nodel-row>
            <nodel-column span="12" sm="6"><nodel-control-grid fill columns="1"><nodel-button>One</nodel-button></nodel-control-grid></nodel-column>
            <nodel-column span="12" sm="6"><nodel-control-grid fill columns="1"><nodel-button>Two</nodel-button></nodel-control-grid></nodel-column>
          </nodel-row>
        </nodel-page>
      </nodel-app>`);
    const wide = await boxes(page, '[data-viewport-fixture] nodel-column');
    expect(wide[0]!.left).not.toBe(wide[1]!.left);
    await page.setViewportSize({ width: 390, height: 600 });
    const narrow = await boxes(page, '[data-viewport-fixture] nodel-column');
    expect(Math.abs(narrow[0]!.left - narrow[1]!.left)).toBeLessThanOrEqual(1);
    await fixture.locator('nodel-page[title="Dynamic"]').evaluate((element) => element.removeAttribute('min-height'));
    await expect(fixture.locator('nodel-page[title="Dynamic"]')).toHaveAttribute('data-min-height', 'auto');
    const natural = await boxes(page, '[data-viewport-fixture] nodel-control-grid');
    expect(Math.max(...natural.map((box) => box.height))).toBeLessThan(600);
  });

  test('bleed viewport composition reaches all four edges without document overflow', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 240, height: 240 });
    const fixture = await addFixture(page, `
      <nodel-app>
        <nodel-page title="Display" min-height="viewport" bleed>
          <nodel-control-grid fill columns="1">
            <nodel-readout label="Brightness" type="percent" visual="ring" ring-layout="edge" value="50"></nodel-readout>
          </nodel-control-grid>
        </nodel-page>
      </nodel-app>`);
    await fixture.evaluate((root) => { root.style.width = '100vw'; });
    const result = await fixture.evaluate((root) => {
      const rect = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
      const page = rect('nodel-page');
      const content = rect('[data-page-content]');
      const grid = rect('nodel-control-grid');
      const readout = rect('nodel-readout');
      const svg = rect('.nodel-readout-edge-visual');
      const value = rect('.nodel-readout-value');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
        page, content, grid, readout, svg, value
      };
    });
    expect(result.viewport).toEqual({ width: 240, height: 240 });
    expect(result.scrollWidth).toBeLessThanOrEqual(240);
    expect(result.scrollHeight).toBeLessThanOrEqual(240);
    expect(result.clientHeight).toBeGreaterThan(0);
    for (const rect of [result.page, result.content, result.grid, result.readout]) {
      expect(rect.left).toBeCloseTo(0, 0);
      expect(rect.top).toBeCloseTo(0, 0);
      expect(rect.right).toBeCloseTo(240, 0);
      expect(rect.bottom).toBeCloseTo(240, 0);
    }
    expect(result.svg.width).toBeCloseTo(result.svg.height, 1);
    expect(result.value.left + result.value.width / 2).toBeCloseTo(120, 0);
    expect(result.value.top + result.value.height / 2).toBeCloseTo(120, 0);
    const typography = await fixture.locator('.nodel-readout-value').evaluate((element) => ({
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
      width: element.getBoundingClientRect().width
    }));
    expect(typography.fontSize).toBeGreaterThan(0);
    expect(typography.fontSize).toBeLessThanOrEqual(40);
    expect(typography.lineHeight).toBeGreaterThan(0);
    expect(typography.width).toBeGreaterThan(0);
  });

  test('updates edge notch orientation and progress while preserving normalized geometry', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 240, height: 240 });
    const fixture = await addFixture(page, `
      <nodel-app>
        <nodel-page min-height="viewport" bleed>
          <nodel-control-grid fill columns="1">
            <nodel-readout label="Level" type="percent" visual="ring" ring-layout="edge" value="0"></nodel-readout>
          </nodel-control-grid>
        </nodel-page>
      </nodel-app>`);
    const readout = fixture.locator('nodel-readout');
    const geometry = async () => readout.evaluate((element) => {
      const group = element.querySelector('svg > g')!;
      const track = element.querySelector('.nodel-readout-edge-track')!;
      const progress = element.querySelector('.nodel-readout-edge-progress') as SVGPathElement;
      return { transform: group.getAttribute('transform'), path: track.getAttribute('d') ?? '', dash: progress.style.strokeDasharray, display: progress.style.display, valueTransform: getComputedStyle(element.querySelector('.nodel-readout-value')!).transform };
    });
    const orientations = [
      ['bottom', 'rotate(0 120 120)'],
      ['left', 'rotate(90 120 120)'],
      ['top', 'rotate(180 120 120)'],
      ['right', 'rotate(270 120 120)']
    ] as const;
    let initialPath = '';
    const boundaries = { bottom: 203, left: 37, top: 37, right: 203 };
    for (const [position, transform] of orientations) {
      await readout.evaluate((element, value) => element.setAttribute('notch-position', value), position);
      const current = await geometry();
      const transformed = await edgeGeometry(page, '[data-viewport-fixture] nodel-readout');
      initialPath ||= current.path;
      expect(current.transform).toBe(transform);
      expect(current.path).toBe(initialPath);
      expect(current.valueTransform).toBe('none');
      expect(Math.abs(transformed.screen[0]!.x - transformed.screen[1]!.x) + Math.abs(transformed.screen[0]!.y - transformed.screen[1]!.y)).toBeGreaterThan(10);
      const coordinate = position === 'bottom' || position === 'top' ? 'y' : 'x';
      const center = transformed.center[coordinate];
      const scale = coordinate === 'x' ? transformed.scale.x : transformed.scale.y;
      const expected = center + (boundaries[position] - 120) * scale;
      expect(Math.abs(transformed.screen[0]![coordinate] - expected)).toBeLessThanOrEqual(2);
      expect(Math.abs(transformed.screen[3]![coordinate] - expected)).toBeLessThanOrEqual(2);
      if (position === 'bottom') {
        expect(transformed.screen[0]!.x).toBeLessThan(transformed.screen[3]!.x);
        expect(transformed.screen[0]!.y).toBeCloseTo(transformed.screen[3]!.y, 0);
      } else if (position === 'left') {
        expect(transformed.screen[0]!.y).toBeLessThan(transformed.screen[3]!.y);
        expect(transformed.screen[0]!.x).toBeCloseTo(transformed.screen[3]!.x, 0);
      } else if (position === 'top') {
        expect(transformed.screen[0]!.x).toBeGreaterThan(transformed.screen[3]!.x);
        expect(transformed.screen[0]!.y).toBeCloseTo(transformed.screen[3]!.y, 0);
      } else {
        expect(transformed.screen[0]!.y).toBeGreaterThan(transformed.screen[3]!.y);
        expect(transformed.screen[0]!.x).toBeCloseTo(transformed.screen[3]!.x, 0);
      }
    }
    await readout.evaluate((element) => element.setAttribute('notch-position', 'bottom'));
    const bottom = await edgeGeometry(page, '[data-viewport-fixture] nodel-readout');
    expect(bottom.points[0]!.x).toBeLessThan(120);
    expect(bottom.points[0]!.y).toBeGreaterThan(120);
    expect(bottom.points[1]!.x).toBeLessThan(bottom.points[0]!.x);
    expect(bottom.points[1]!.y).toBeLessThan(bottom.points[0]!.y);
    expect(bottom.points[2]!.y).toBeLessThan(bottom.points[0]!.y);
    for (const value of ['0', '50', '100']) {
      await readout.evaluate((element, next) => element.setAttribute('value', next), value);
      const current = await geometry();
      expect(current.path).toBe(initialPath);
      if (value === '0') expect(current.display).toBe('none');
      else {
        const dash = current.dash.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
        expect(dash[0]).toBeCloseTo(value === '50' ? 0.5 : 1, 5);
        expect(dash[1]).toBeCloseTo(1, 5);
      }
    }
  });

  test('uniformly scales edge geometry and inscribes it in ordinary rectangular containment', async ({ page }) => {
    await loadEntry(page);
    await page.setViewportSize({ width: 480, height: 300 });
    const fixture = await addFixture(page, `
      <nodel-app>
        <nodel-page title="Contained">
          <nodel-group surface="none" padding="none" style="width:320px;height:180px"><nodel-readout style="width:320px;height:180px" label="Level" type="number" visual="ring" ring-layout="edge" value="123456789" prefix="~" suffix=" ms"></nodel-readout></nodel-group>
        </nodel-page>
      </nodel-app>`, { expectViewport: false });
    const result = await fixture.evaluate((root) => {
      const page = root.querySelector('nodel-page')!.getBoundingClientRect();
      const group = root.querySelector('nodel-group')!.getBoundingClientRect();
      const readout = root.querySelector('nodel-readout')!.getBoundingClientRect();
      const svg = root.querySelector('.nodel-readout-edge-visual')!.getBoundingClientRect();
      const matrix = root.querySelector<SVGSVGElement>('.nodel-readout-edge-visual')!.getScreenCTM()!;
      const content = root.querySelector('.nodel-readout-content')!.getBoundingClientRect();
      const value = root.querySelector('.nodel-readout-value')!.getBoundingClientRect();
      const drawnSide = Math.min(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)) * 240;
      const contentElement = root.querySelector<HTMLElement>('.nodel-readout-content')!;
      const valueElement = root.querySelector<HTMLElement>('.nodel-readout-value')!;
      return {
        page, group, readout, svg, content, value, drawnSide,
        scaleX: Math.hypot(matrix.a, matrix.b), scaleY: Math.hypot(matrix.c, matrix.d), matrixE: matrix.e, matrixF: matrix.f,
        contentClient: { width: contentElement.clientWidth, height: contentElement.clientHeight },
        contentScroll: { width: contentElement.scrollWidth, height: contentElement.scrollHeight },
        valueClient: { width: valueElement.clientWidth, height: valueElement.clientHeight },
        valueScroll: { width: valueElement.scrollWidth, height: valueElement.scrollHeight },
        path: root.querySelector('.nodel-readout-edge-track')!.getAttribute('d')
      };
    });
    expect(result.group.left).toBeGreaterThan(result.page.left);
    expect(result.group.right).toBeLessThan(result.page.right);
    expect(result.readout.width).toBeCloseTo(320, 0);
    expect(result.readout.height).toBeCloseTo(180, 0);
    expect(result.scaleX).toBeCloseTo(result.scaleY, 5);
    expect(result.scaleX * 240).toBeLessThanOrEqual(Math.min(result.readout.width, result.readout.height) + 1);
    expect(Math.abs(result.scaleX * 240 - Math.min(result.readout.width, result.readout.height))).toBeLessThanOrEqual(3);
    expect(result.matrixE + result.scaleX * 120).toBeCloseTo(result.readout.left + result.readout.width / 2, 0);
    expect(result.matrixF + result.scaleY * 120).toBeCloseTo(result.readout.top + result.readout.height / 2, 0);
    expect(result.value.left + result.value.width / 2).toBeCloseTo(result.readout.left + result.readout.width / 2, 0);
    expect(result.value.top + result.value.height / 2).toBeCloseTo(result.readout.top + result.readout.height / 2, 0);
    expect(result.value.width).toBeGreaterThan(0);
    for (const box of [result.content, result.value]) {
      expect(box.width).toBeLessThanOrEqual(result.drawnSide * 0.72 + 1);
      expect(box.height).toBeLessThanOrEqual(result.drawnSide * 0.72 + 1);
      expect(box.left).toBeGreaterThanOrEqual(result.readout.left + result.readout.width / 2 - result.drawnSide * 0.36 - 1);
      expect(box.right).toBeLessThanOrEqual(result.readout.left + result.readout.width / 2 + result.drawnSide * 0.36 + 1);
      expect(box.top).toBeGreaterThanOrEqual(result.readout.top + result.readout.height / 2 - result.drawnSide * 0.36 - 1);
      expect(box.bottom).toBeLessThanOrEqual(result.readout.top + result.readout.height / 2 + result.drawnSide * 0.36 + 1);
    }
    for (const dimensions of [result.contentClient, result.valueClient]) {
      expect(dimensions.width).toBeGreaterThan(0);
      expect(dimensions.height).toBeGreaterThan(0);
    }
    expect(result.contentScroll.width).toBeLessThanOrEqual(result.contentClient.width + 1);
    expect(result.contentScroll.height).toBeLessThanOrEqual(result.contentClient.height + 1);
    expect(result.valueScroll.width).toBeLessThanOrEqual(result.valueClient.width + 1);
    expect(result.valueScroll.height).toBeLessThanOrEqual(result.valueClient.height + 1);
    expect(result.path).not.toContain('NaN');
  });

  test('preserves normalized edge endpoints across uniformly scaled square viewports', async ({ page }) => {
    await loadEntry(page);
    const fixture = await addFixture(page, `
      <nodel-app>
        <nodel-page min-height="viewport" bleed>
          <nodel-control-grid fill columns="1">
            <nodel-readout label="Level" type="percent" visual="ring" ring-layout="edge" value="50"></nodel-readout>
          </nodel-control-grid>
        </nodel-page>
      </nodel-app>`);
    const normalized = async () => {
      const geometry = await edgeGeometry(page, '[data-viewport-fixture] nodel-readout');
      return { scale: geometry.drawnSide, points: geometry.screen.map((point) => ({
        x: (point.x - geometry.center.x) / geometry.drawnSide,
        y: (point.y - geometry.center.y) / geometry.drawnSide
      })) };
    };
    await page.setViewportSize({ width: 240, height: 240 });
    await fixture.evaluate((root) => { root.style.width = '100vw'; });
    const nominal = await normalized();
    await page.setViewportSize({ width: 360, height: 360 });
    const alternate = await normalized();
    expect(alternate.scale).toBeGreaterThan(nominal.scale);
    for (const index of [0, 1, 2, 3]) {
      expect(alternate.points[index]!.x).toBeCloseTo(nominal.points[index]!.x, 2);
      expect(alternate.points[index]!.y).toBeCloseTo(nominal.points[index]!.y, 2);
    }
  });
});
