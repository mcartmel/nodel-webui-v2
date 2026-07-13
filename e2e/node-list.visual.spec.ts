import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

const nodes = {
  brightsign: { name: 'Brightsign' },
  example1: { name: 'Example 1' },
  example2: { name: 'Example 2' },
  example3: { name: 'Example 3' },
  frontend: { name: 'Example Frontend' },
  projector: { name: 'Projector Control' }
};

const networkNodes = [
  { address: 'http://alpha.test:8085/nodes/Alpha/', host: 'alpha.test:8085', name: 'Alpha Display', node: 'Alpha' },
  { address: 'http://beta.test:8085/nodes/Beta/', host: 'beta.test:8085', name: 'Beta Display', node: 'Beta' },
  { address: 'http://gamma.test:8085/nodes/Gamma/', host: 'gamma.test:8085', name: 'Gamma Display', node: 'Gamma' }
];

function isDesktopThemeProject(testInfo: TestInfo) {
  return testInfo.project.name === 'chromium-light-desktop' || testInfo.project.name === 'chromium-dark-desktop';
}

function isForcedColoursProject(testInfo: TestInfo) {
  return testInfo.project.name === 'chromium-forced-colors';
}

async function setMediaFeature(page: Page, name: string, value: string) {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setEmulatedMedia', { features: [{ name, value }] });
}

async function waitForNodeList(page: Page, scope: 'local' | 'network', count: number) {
  const list = page.locator(`nodel-node-list[scope="${scope}"] .nodel-list.nodel-node-list-items`);
  await expect(list).toBeVisible();
  await expect(list.locator(':scope > li > a.nodel-list-item')).toHaveCount(count);
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });
  return list;
}

async function openLocalNodeList(page: Page) {
  await page.route('**/REST', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ nodes })
  }));
  await page.goto('/nodes.html#Locals', { waitUntil: 'domcontentloaded' });
  return waitForNodeList(page, 'local', Object.keys(nodes).length);
}

async function openNetworkNodeList(page: Page) {
  await page.route('**/REST/nodeURLs', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(networkNodes)
  }));
  await page.route('http://alpha.test:8085/REST', (route) => route.fulfill({ status: 200, body: '{}' }));
  await page.route('http://beta.test:8085/REST', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.route('http://gamma.test:8085/REST', (route) => route.fulfill({ status: 200, body: '{}' }));
  await page.goto('/nodes.html#Network', { waitUntil: 'domcontentloaded' });
  return waitForNodeList(page, 'network', networkNodes.length);
}

async function openNodeDrawer(page: Page) {
  await page.route('**/nodel.html', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('<head>', '<head><base href="/">');
    await route.fulfill({ response, body });
  });
  await page.addInitScript(() => {
    if (window.location.pathname === '/nodel.html') {
      window.history.replaceState({}, '', '/nodes/GroupedListReview/');
    }
  });
  await page.route('**/REST/', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ name: 'Grouped List Review' })
  }));
  await page.route('**/REST/files', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([
      { path: 'content/control.html' },
      { path: 'content/overview.xml' },
      { path: 'script.py' }
    ])
  }));
  await page.goto('/nodel.html', { waitUntil: 'domcontentloaded' });
  await disableAnimations(page);
  await page.locator('[data-node-menu-open]').click();
  const drawer = page.locator('.nodel-node-menu-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.nodel-node-menu-link-list .nodel-list > li')).toHaveCount(4);
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });
  return drawer;
}

async function disableAnimations(page: Page) {
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
}

async function tabTo(page: Page, target: Locator, maxTabs = 30) {
  await target.waitFor();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => document.activeElement === element)) {
      return;
    }
  }
  throw new Error('Could not reach grouped list row through keyboard navigation.');
}

async function expectContainedFocus(row: Locator, list: Locator) {
  const focus = await row.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      boxShadow: style.boxShadow,
      outlineColor: style.outlineColor,
      outlineOffset: Number.parseFloat(style.outlineOffset),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth)
    };
  });
  const visibleOutline = focus.outlineStyle !== 'none'
    && focus.outlineWidth > 0
    && focus.outlineColor !== 'transparent'
    && focus.outlineColor !== 'rgba(0, 0, 0, 0)';
  expect(focus.boxShadow !== 'none' || visibleOutline).toBe(true);

  const rowBox = await row.boundingBox();
  const listBox = await list.boundingBox();
  expect(rowBox).not.toBeNull();
  expect(listBox).not.toBeNull();
  expect(rowBox!.x).toBeGreaterThanOrEqual(listBox!.x);
  expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(listBox!.x + listBox!.width);
}

function parseRgb(value: string) {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  if (channels.length !== 3) {
    throw new Error(`Expected RGB colour, received ${value}`);
  }
  return channels;
}

function luminance(channels: number[]) {
  const values = channels.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}

function contrast(left: number[], right: number[]) {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function renderedBackgroundBehind(page: Page, affordance: Locator) {
  const box = await affordance.boundingBox();
  expect(box).not.toBeNull();
  const previousVisibility = await affordance.evaluate((element) => {
    const svg = element as SVGElement;
    const previous = svg.style.visibility;
    svg.style.visibility = 'hidden';
    return previous;
  });

  try {
    const screenshot = await page.screenshot({ clip: box! });
    const image = PNG.sync.read(screenshot);
    const x = Math.floor(image.width / 2);
    const y = Math.floor(image.height / 2);
    const offset = (image.width * y + x) * 4;
    return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
  } finally {
    await affordance.evaluate((element, visibility) => {
      (element as SVGElement).style.visibility = visibility;
    }, previousVisibility);
  }
}

test.describe('grouped node list', () => {
  test('renders one quiet collection surface in responsive themes', async ({ page }, testInfo) => {
    test.skip(isForcedColoursProject(testInfo), 'Forced colours uses focused assertions rather than screenshots.');
    const list = await openLocalNodeList(page);
    await disableAnimations(page);

    const rows = list.locator(':scope > li > .nodel-list-item');
    const metrics = await rows.evaluateAll((elements) => elements.map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderRadius: style.borderRadius,
        borderWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
        height: rect.height
      };
    }));
    const entries = await list.locator(':scope > li').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { bottom: rect.bottom, top: rect.top };
    }));
    expect(metrics.every((row) => row.height >= 44)).toBe(true);
    expect(metrics.every((row) => row.backgroundColor === 'rgba(0, 0, 0, 0)' && row.backgroundImage === 'none')).toBe(true);
    expect(metrics.every((row) => row.borderWidth === '0px' && row.borderRadius === '0px' && row.boxShadow === 'none')).toBe(true);
    expect(entries.slice(1).every((entry, index) => Math.abs(entries[index].bottom - entry.top) < 0.5)).toBe(true);
    await expect(list.locator(':scope > li + li').first()).toHaveCSS('border-top-width', '1px');
    const affordances = list.locator('.nodel-list-item-affordance[data-icon="chevron-right"]');
    await expect(affordances).toHaveCount(Object.keys(nodes).length);
    expect(await affordances.evaluateAll((elements) => elements.every((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }))).toBe(true);

    if (testInfo.project.name.includes('mobile')) {
      const overflow = await list.evaluate((element) => ({
        document: document.documentElement.scrollWidth > window.innerWidth,
        list: element.scrollWidth > element.clientWidth
      }));
      expect(overflow).toEqual({ document: false, list: false });
    }

    await expect(list).toHaveScreenshot('node-list-collection.png');
  });

  test('renders the network collection consistently in responsive themes', async ({ page }, testInfo) => {
    test.skip(isForcedColoursProject(testInfo), 'Forced colours uses focused assertions rather than screenshots.');
    const list = await openNetworkNodeList(page);
    await disableAnimations(page);
    await expect(list.locator('.nodel-list-item.is-unreachable')).toHaveCount(1);
    await expect(list).toHaveScreenshot('network-node-list-collection.png');
  });

  test('renders grouped links in the node drawer across responsive themes', async ({ page }, testInfo) => {
    test.skip(isForcedColoursProject(testInfo), 'Forced colours uses focused assertions rather than screenshots.');
    const drawer = await openNodeDrawer(page);
    const list = drawer.locator('.nodel-node-menu-link-list .nodel-list');
    await expect(list).toBeVisible();
    await expect(list.locator('.nodel-list-item-affordance[data-icon="chevron-right"]')).toHaveCount(4);
    await expect(drawer).toHaveScreenshot('node-drawer-grouped-list.png');
  });

  test('keeps grouped rows accessible and visibly keyboard focused', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Axe and standard focus checks run in desktop colour themes.');
    const list = await openLocalNodeList(page);
    const row = list.locator('.nodel-list-item').first();
    const results = await new AxeBuilder({ page })
      .include('nodel-node-list')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);

    const affordance = row.locator('.nodel-list-item-affordance');
    const foreground = await row.evaluate((element) => {
      const affordance = element.querySelector<SVGElement>('.nodel-list-item-affordance');
      if (!affordance) throw new Error('Missing row affordance.');
      return getComputedStyle(affordance).color;
    });
    const background = await renderedBackgroundBehind(page, affordance);
    expect(contrast(parseRgb(foreground), background)).toBeGreaterThanOrEqual(3);

    await tabTo(page, row);
    await expect(row).toBeFocused();
    await expectContainedFocus(row, list);
  });

  test('uses quiet hover and pressed feedback without raising a row', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Pointer-state checks run in desktop colour themes.');
    const list = await openLocalNodeList(page);
    const row = list.locator('.nodel-list-item').first();
    const readStyle = () => row.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
        railOpacity: getComputedStyle(element, '::before').opacity
      };
    });
    const rest = await readStyle();
    await row.hover();
    await expect.poll(async () => {
      const style = await readStyle();
      return `${style.backgroundColor}|${style.backgroundImage}`;
    }).not.toBe(`${rest.backgroundColor}|${rest.backgroundImage}`);
    const hovered = await readStyle();
    expect(hovered.railOpacity).toBe('1');
    expect(hovered.borderWidth).toBe('0px');
    expect(hovered.boxShadow).toBe('none');

    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    await row.evaluate((element) => element.addEventListener('click', (event) => event.preventDefault(), { once: true }));
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await expect.poll(async () => (await readStyle()).backgroundImage).not.toBe(rest.backgroundImage);
    const active = await readStyle();
    expect(active.backgroundImage).not.toBe(rest.backgroundImage);
    expect(active.railOpacity).toBe('1');
    expect(active.borderWidth).toBe('0px');
    expect(active.boxShadow).toBe('none');
    await page.mouse.up();
  });

  test('keeps grouped focus visible in increased contrast', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Increased-contrast checks run in desktop colour themes.');
    await setMediaFeature(page, 'prefers-contrast', 'more');
    const supported = await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches);
    test.skip(!supported, 'This Chromium build cannot emulate prefers-contrast.');
    const list = await openLocalNodeList(page);
    const row = list.locator('.nodel-list-item').first();
    await tabTo(page, row);
    await expect(row).toHaveCSS('outline-width', '3px');
    const offset = await row.evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineOffset));
    expect(offset).toBeLessThanOrEqual(0);
    await expectContainedFocus(row, list);
  });

  test('uses a solid collection surface with reduced transparency', async ({ page }, testInfo) => {
    test.skip(!isDesktopThemeProject(testInfo), 'Reduced-transparency checks run in desktop colour themes.');
    await setMediaFeature(page, 'prefers-reduced-transparency', 'reduce');
    const supported = await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches);
    test.skip(!supported, 'This Chromium build cannot emulate prefers-reduced-transparency.');
    const list = await openLocalNodeList(page);
    await expect(list).toHaveCSS('background-image', 'none');
  });

  test('keeps grouped focus visible in forced colours', async ({ page }, testInfo) => {
    test.skip(!isForcedColoursProject(testInfo), 'Forced-colours checks run in the dedicated project.');
    const list = await openLocalNodeList(page);
    const row = list.locator('.nodel-list-item').first();
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
    await tabTo(page, row);
    await expect(row).toHaveCSS('outline-width', '3px');
    const offset = await row.evaluate((element) => Number.parseFloat(getComputedStyle(element).outlineOffset));
    expect(offset).toBeLessThanOrEqual(0);
    await expectContainedFocus(row, list);
  });
});
