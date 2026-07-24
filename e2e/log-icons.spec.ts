import { expect, test, type Page, type TestInfo } from '@playwright/test';

const animationReset = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

function isForcedColoursProject(testInfo: TestInfo) {
  return testInfo.project.name === 'chromium-forced-colors';
}

async function mountLogFixture(page: Page) {
  await page.addInitScript(() => {
    class BlockedWebSocket {
      constructor() {
        throw new Error('WebSocket blocked for log icon geometry test');
      }
    }
    window.WebSocket = BlockedWebSocket as never;
  });

  await page.route('**/nodes/Demo/REST/activity?from=*', async (route) => {
    const entries = [
      { seq: 1, source: 'local', type: 'action', alias: 'LocalAction' },
      { seq: 2, source: 'remote', type: 'action', alias: 'RemoteAction' },
      { seq: 3, source: 'unbound', type: 'action', alias: 'UnboundAction' },
      { seq: 4, source: 'local', type: 'event', alias: 'LocalSignal' },
      { seq: 5, source: 'remote', type: 'event', alias: 'RemoteSignal' },
      { seq: 6, source: 'unbound', type: 'event', alias: 'UnboundSignal' },
      { seq: 7, source: 'remote', type: 'actionBinding', alias: 'ActionBinding' },
      { seq: 8, source: 'remote', type: 'eventBinding', alias: 'EventBinding' },
      { seq: 9 },
      { seq: 10, source: 'remote', type: 'unknown', alias: 'UnknownRemote' }
    ];
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(entries.map((entry) => ({
        ...entry,
        timestamp: '2026-07-25T00:00:00Z'
      })))
    });
  });

  await page.goto('/components.html#Text', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.history.replaceState(null, '', '/nodes/Demo/components.html#Text');
  });
  await page.locator('nodel-page[data-page-id="Text"][active]').waitFor();
  await page.addStyleTag({ content: animationReset });
  await page.locator('nodel-page[data-page-id="Text"][active]').evaluate((pageContent) => {
    const log = document.createElement('nodel-log');
    pageContent.appendChild(log);
  });
  await expect(page.locator('nodel-log .nodel-log-row')).toHaveCount(10);
}

test.describe('log icon geometry', () => {
  test('keeps base and badge icons compact and accessible', async ({ page }, testInfo) => {
    await mountLogFixture(page);

    const metrics = await page.locator('nodel-log .nodel-log-row').evaluateAll((rows) => rows.map((row) => {
      const icon = row.querySelector<HTMLElement>('.nodel-log-icon')!;
      const primary = row.querySelector<SVGElement>('.nodel-log-icon-primary')!;
      const badge = row.querySelector<SVGElement>('.nodel-log-icon-badge');
      const iconRect = icon.getBoundingClientRect();
      const primaryRect = primary.getBoundingClientRect();
      const badgeRect = badge?.getBoundingClientRect() ?? null;
      const gridColumns = getComputedStyle(row).gridTemplateColumns.split(' ');

      return {
        ariaLabel: icon.getAttribute('aria-label'),
        badgeIcon: badge?.dataset.icon ?? null,
        badgeOverlapsPrimary: badgeRect
          ? badgeRect.left < primaryRect.right && badgeRect.right > primaryRect.left && badgeRect.top < primaryRect.bottom && badgeRect.bottom > primaryRect.top
          : false,
        iconHeight: iconRect.height,
        iconWidth: iconRect.width,
        color: getComputedStyle(icon).color,
        primaryIcon: primary.dataset.icon,
        rowHeight: row.getBoundingClientRect().height,
        firstGridColumn: Number.parseFloat(gridColumns[0])
      };
    }));

    const first = metrics[0];
    expect(first.iconWidth).toBeGreaterThan(0);
    expect(first.iconHeight).toBeGreaterThan(0);
    for (const metric of metrics) {
      expect(metric.iconWidth).toBe(first.iconWidth);
      expect(metric.iconHeight).toBe(first.iconHeight);
      expect(metric.rowHeight).toBe(first.rowHeight);
      expect(metric.firstGridColumn).toBeCloseTo(first.iconWidth, 1);
    }

    expect(metrics.find((metric) => metric.primaryIcon === 'person-running' && metric.badgeIcon === 'arrow-right')?.badgeOverlapsPrimary).toBe(true);
    expect(metrics.find((metric) => metric.primaryIcon === 'traffic-light' && metric.badgeIcon === 'arrow-right')?.badgeOverlapsPrimary).toBe(true);
    expect(metrics.find((metric) => metric.primaryIcon === 'person-running' && metric.badgeIcon === 'link')?.badgeOverlapsPrimary).toBe(true);
    expect(metrics.find((metric) => metric.primaryIcon === 'traffic-light' && metric.badgeIcon === 'link')?.badgeOverlapsPrimary).toBe(true);
    expect(metrics.find((metric) => metric.ariaLabel === 'Activity' && metric.badgeIcon === 'arrow-right')?.primaryIcon).toBe('traffic-light');

    expect(metrics.map((metric) => metric.ariaLabel)).toEqual([
      'Activity',
      'Activity',
      'Remote signal binding status',
      'Remote action binding status',
      'Unbound signal',
      'Remote signal',
      'Local signal',
      'Unbound action',
      'Remote action',
      'Local action'
    ]);

    if (!isForcedColoursProject(testInfo)) {
      const localAction = metrics.find((metric) => metric.ariaLabel === 'Local action')!;
      const remoteAction = metrics.find((metric) => metric.ariaLabel === 'Remote action')!;
      const localSignal = metrics.find((metric) => metric.ariaLabel === 'Local signal')!;
      const remoteSignal = metrics.find((metric) => metric.ariaLabel === 'Remote signal')!;
      const actionBinding = metrics.find((metric) => metric.ariaLabel === 'Remote action binding status')!;
      const eventBinding = metrics.find((metric) => metric.ariaLabel === 'Remote signal binding status')!;

      expect(localAction.color).not.toBe(remoteAction.color);
      expect(localSignal.color).not.toBe(remoteSignal.color);
      expect(actionBinding.color).toBe(eventBinding.color);
    }

    if (isForcedColoursProject(testInfo)) {
      expect(await page.locator('nodel-log .nodel-log-icon-badge').first().evaluate((element) => getComputedStyle(element).borderStyle)).toBe('solid');
    }
  });
});
