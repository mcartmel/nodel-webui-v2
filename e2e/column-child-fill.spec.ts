import { expect, test, type Locator } from '@playwright/test';

async function expectVisibleFocus(control: Locator) {
  await control.focus();
  await expect(control).toBeFocused();
  const geometry = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      hasVisibleFocus: element.matches(':focus-visible') && (style.outlineStyle !== 'none' || style.boxShadow !== 'none'),
      insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
    };
  });
  expect(geometry.hasVisibleFocus).toBe(true);
  expect(geometry.insideViewport).toBe(true);
}

test.describe('column child fill', () => {
  test('fills available height without changing ambiguous or intrinsic flow', async ({ page }) => {
    await page.goto('/nodel.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nodel-app')).toBeVisible();

    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.dataset.geometryContract = 'column-child-fill';
      fixture.style.cssText = 'position:fixed;left:1rem;top:1rem;width:calc(100vw - 2rem);z-index:100;display:grid;gap:1rem;pointer-events:none';
      fixture.innerHTML = `
        <nodel-row data-fill-row="group">
          <nodel-column span="6">
            <nodel-group fill surface="none" padding="none"><nodel-button>Focused action</nodel-button></nodel-group>
          </nodel-column>
          <nodel-column span="6"><div style="height:26rem"></div></nodel-column>
        </nodel-row>
        <nodel-row data-fill-row="grid">
          <nodel-column span="6">
            <nodel-control-grid fill style="--nodel-control-min-height:3rem;--nodel-control-grid-gap:12px">
              <nodel-button>One</nodel-button><nodel-button>Two</nodel-button><nodel-button>Three</nodel-button>
            </nodel-control-grid>
          </nodel-column>
          <nodel-column span="6"><div style="height:24rem"></div></nodel-column>
        </nodel-row>
        <nodel-row data-fill-row="hidden">
          <nodel-column span="6">
            <nodel-group data-fill-alternative="first" fill surface="none" padding="none"><nodel-button>First</nodel-button></nodel-group>
            <nodel-group data-fill-alternative="second" fill hidden surface="none" padding="none"><nodel-button>Second</nodel-button></nodel-group>
          </nodel-column>
          <nodel-column span="6"><div style="height:22rem"></div></nodel-column>
        </nodel-row>
        <nodel-row data-fill-row="flow">
          <nodel-column span="6">
            <nodel-group fill surface="none" padding="none"><nodel-button>Flow first</nodel-button></nodel-group>
            <nodel-group fill surface="none" padding="none"><nodel-button>Flow second</nodel-button></nodel-group>
          </nodel-column>
        </nodel-row>
        <nodel-row data-fill-row="auto">
          <nodel-column span="6">
            <nodel-group fill surface="none" padding="none"><nodel-button>Auto height</nodel-button></nodel-group>
          </nodel-column>
        </nodel-row>
      `;
      document.body.append(fixture);
    });

    const fixture = page.locator('[data-geometry-contract="column-child-fill"]');
    const groupColumn = fixture.locator('[data-fill-row="group"] nodel-column').first();
    await expect(groupColumn).toHaveAttribute('data-fill-child', 'true');
    const groupGeometry = await groupColumn.evaluate((column) => ({
      group: column.querySelector('nodel-group')!.getBoundingClientRect(),
      sibling: column.parentElement!.querySelector('nodel-column:nth-child(2) > [data-column] > div')!.getBoundingClientRect(),
      row: column.parentElement!.getBoundingClientRect()
    }));
    expect(groupGeometry.group.height).toBeGreaterThan(300);
    expect(Math.abs(groupGeometry.group.height - groupGeometry.sibling.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(groupGeometry.group.height - groupGeometry.row.height)).toBeLessThanOrEqual(1);

    const gridColumn = fixture.locator('[data-fill-row="grid"] nodel-column').first();
    await expect(gridColumn).toHaveAttribute('data-fill-child', 'true');
    const gridGeometry = await gridColumn.evaluate((column) => {
      const grid = column.querySelector('nodel-control-grid')!;
      const rows = [...grid.querySelectorAll('nodel-button')].map((button) => button.getBoundingClientRect());
      return {
        column: column.getBoundingClientRect(),
        grid: grid.getBoundingClientRect(),
        sibling: column.parentElement!.querySelector('nodel-column:nth-child(2) > [data-column] > div')!.getBoundingClientRect(),
        rows
      };
    });
    expect(Math.abs(gridGeometry.column.height - gridGeometry.grid.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(gridGeometry.column.height - gridGeometry.sibling.height)).toBeLessThanOrEqual(1);
    expect(Math.max(...gridGeometry.rows.map((row) => row.height)) - Math.min(...gridGeometry.rows.map((row) => row.height))).toBeLessThanOrEqual(1);
    expect(Math.min(...gridGeometry.rows.map((row) => row.height))).toBeGreaterThanOrEqual(48);
    for (let index = 1; index < gridGeometry.rows.length; index += 1) {
      expect(gridGeometry.rows[index]!.top - gridGeometry.rows[index - 1]!.bottom).toBeCloseTo(12, 0);
    }
    expect(Math.abs(gridGeometry.rows.reduce((height, row) => height + row.height, 0) + 24 - gridGeometry.grid.height)).toBeLessThanOrEqual(1);

    const hiddenColumn = fixture.locator('[data-fill-row="hidden"] nodel-column').first();
    await expect(hiddenColumn).toHaveAttribute('data-fill-child', 'true');
    const measureActiveAlternative = () => hiddenColumn.evaluate((column) => {
      const active = [...column.querySelectorAll('[data-fill-alternative]')].find((group) => !(group as HTMLElement).hidden)!;
      return {
        name: active.getAttribute('data-fill-alternative'),
        active: active.getBoundingClientRect(),
        column: column.getBoundingClientRect(),
        sibling: column.parentElement!.querySelector('nodel-column:nth-child(2) > [data-column] > div')!.getBoundingClientRect()
      };
    });
    const beforeHandoff = await measureActiveAlternative();
    expect(beforeHandoff.name).toBe('first');
    expect(Math.abs(beforeHandoff.active.height - beforeHandoff.column.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(beforeHandoff.active.height - beforeHandoff.sibling.height)).toBeLessThanOrEqual(1);

    await hiddenColumn.locator('[data-fill-alternative="first"]').evaluate((element) => { (element as HTMLElement).hidden = true; });
    await hiddenColumn.locator('[data-fill-alternative="second"]').evaluate((element) => { (element as HTMLElement).hidden = false; });
    await expect(hiddenColumn).toHaveAttribute('data-fill-child', 'true');
    const afterHandoff = await measureActiveAlternative();
    expect(afterHandoff.name).toBe('second');
    expect(Math.abs(afterHandoff.active.height - afterHandoff.column.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterHandoff.active.height - afterHandoff.sibling.height)).toBeLessThanOrEqual(1);

    await hiddenColumn.locator('[data-fill-alternative="first"]').evaluate((element) => { (element as HTMLElement).hidden = false; });
    await expect(hiddenColumn).not.toHaveAttribute('data-fill-child', 'true');
    const bothVisibleGeometry = await hiddenColumn.locator('nodel-group').evaluateAll((groups) => groups.map((group) => group.getBoundingClientRect()));
    const hiddenColumnBox = await hiddenColumn.boundingBox();
    expect(bothVisibleGeometry[1]!.top).toBeGreaterThanOrEqual(bothVisibleGeometry[0]!.bottom - 1);
    for (const group of bothVisibleGeometry) {
      expect(group.left).toBeGreaterThanOrEqual((hiddenColumnBox?.x ?? 0) - 1);
      expect(group.right).toBeLessThanOrEqual((hiddenColumnBox ? hiddenColumnBox.x + hiddenColumnBox.width : 0) + 1);
      expect(group.top).toBeGreaterThanOrEqual((hiddenColumnBox?.y ?? 0) - 1);
      expect(group.bottom).toBeLessThanOrEqual((hiddenColumnBox ? hiddenColumnBox.y + hiddenColumnBox.height : 0) + 1);
    }

    const flowColumn = fixture.locator('[data-fill-row="flow"] nodel-column');
    await expect(flowColumn).not.toHaveAttribute('data-fill-child', 'true');
    const flowGeometry = await flowColumn.locator('nodel-group').evaluateAll((groups) => groups.map((group) => group.getBoundingClientRect()));
    const flowColumnBox = await flowColumn.boundingBox();
    expect(flowGeometry[1]!.top).toBeGreaterThanOrEqual(flowGeometry[0]!.bottom - 1);
    expect(flowGeometry[1]!.bottom).toBeLessThanOrEqual((flowColumnBox ? flowColumnBox.y + flowColumnBox.height : 0) + 1);

    const autoColumn = fixture.locator('[data-fill-row="auto"] nodel-column');
    await expect(autoColumn).toHaveAttribute('data-fill-child', 'true');
    const autoGeometry = await autoColumn.evaluate((column) => ({
      columnHeight: column.getBoundingClientRect().height,
      groupHeight: column.querySelector('nodel-group')!.getBoundingClientRect().height,
      buttonHeight: column.querySelector('nodel-button')!.getBoundingClientRect().height
    }));
    expect(Math.abs(autoGeometry.columnHeight - autoGeometry.groupHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(autoGeometry.columnHeight - autoGeometry.buttonHeight)).toBeLessThanOrEqual(1);

    await expectVisibleFocus(fixture.locator('[data-fill-row="group"] nodel-button button'));
  });
});
