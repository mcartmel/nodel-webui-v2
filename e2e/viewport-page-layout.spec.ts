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
});
