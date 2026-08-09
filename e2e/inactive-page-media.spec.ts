import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const releaseProjects = new Set([
  'chromium-light-desktop',
  'firefox-light-desktop',
  'webkit-light-desktop'
]);

const fixturePath = '/inactive-page-media.html';
const imagePaths = new Set([
  '/v2/test-images/overview.png',
  '/v2/test-images/detail.png',
  '/v2/test-images/detail-next.png',
  '/v2/test-images/nested-leaf.png',
  '/v2/test-images/nested-sibling.png'
]);
const imageBody = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function skipOutsideReleaseMatrix(testInfo: TestInfo) {
  test.skip(!releaseProjects.has(testInfo.project.name), 'The media contract runs once per browser engine.');
}

async function serveFixture(page: Page) {
  const fixture = await readFile(resolve(process.cwd(), 'e2e/fixtures/no-build-inactive-page-media.html'), 'utf8');
  await page.route(`**${fixturePath}`, async (route) => {
    if (new URL(route.request().url()).pathname !== fixturePath) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture });
  });
  await page.route('**/v2/test-images/*.png', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!imagePaths.has(pathname)) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 200, contentType: 'image/png', body: imageBody });
  });
}

function imageRequests(requests: string[]) {
  return requests.map((url) => new URL(url).pathname).filter((pathname) => imagePaths.has(pathname));
}

function imageRequestCount(requests: string[], pathname: string) {
  return imageRequests(requests).filter((requestPath) => requestPath === pathname).length;
}

async function waitForRoute(page: Page, pageId: string) {
  await expect(page.locator(`nodel-page[data-page-id="${pageId}"][active]`)).toHaveCount(1);
}

async function gotoFixture(page: Page, hash = '') {
  const requests: string[] = [];
  const responseStatuses = new Map<string, number[]>();
  page.on('request', (request) => requests.push(request.url()));
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    const statuses = responseStatuses.get(pathname) ?? [];
    statuses.push(response.status());
    responseStatuses.set(pathname, statuses);
  });
  await serveFixture(page);
  await page.goto(`${fixturePath}${hash}`, { waitUntil: 'domcontentloaded' });
  for (const asset of ['/v2/nodel-webui.js', '/v2/nodel-webui.css']) {
    await expect.poll(() => responseStatuses.get(asset)?.includes(200) ?? false).toBe(true);
  }
  await expect(page.locator('nodel-app')).toHaveAttribute('data-nodel-app', 'true');
  return { requests, responseStatuses };
}

test.describe('authored page inactive media', () => {
  test('defers, detaches, and restores page media at route boundaries', async ({ page }, testInfo) => {
    skipOutsideReleaseMatrix(testInfo);
    const { requests } = await gotoFixture(page);

    await waitForRoute(page, 'Overview');
    await expect(page.locator('#overview-image .nodel-image-media')).toHaveCount(1);
    await expect(page.locator('#detail-image .nodel-image-media')).toHaveCount(0);
    await expect(page.locator('#detail-data-image .nodel-image-media')).toHaveCount(0);
    expect(imageRequests(requests)).toEqual(['/v2/test-images/overview.png']);

    const detailRequestsBeforeActivation = imageRequests(requests).length;
    await page.evaluate(() => { window.location.hash = '#Detail'; });
    await waitForRoute(page, 'Detail');
    await expect(page.locator('#detail-image .nodel-image-media')).toHaveCount(1);
    await expect.poll(() => imageRequests(requests).length).toBe(detailRequestsBeforeActivation + 1);
    expect(imageRequests(requests)).toContain('/v2/test-images/detail.png');
    await expect(page.locator('#detail-data-image .nodel-image-media')).toHaveCount(1);

    await page.evaluate(() => { window.location.hash = '#Overview'; });
    await waitForRoute(page, 'Overview');
    await expect(page.locator('#detail-image .nodel-image-media')).toHaveCount(0);
    const hiddenDetailRequests = imageRequests(requests).length;
    expect(imageRequestCount(requests, '/v2/test-images/detail-next.png')).toBe(0);
    await page.locator('#detail-image').evaluate((image) => image.setAttribute('src', '/v2/test-images/detail-next.png'));
    await expect(page.locator('#detail-image')).toHaveAttribute('data-source-state', 'ready');
    await expect(page.locator('#detail-image .nodel-image-media')).toHaveCount(0);
    expect(imageRequests(requests).length).toBe(hiddenDetailRequests);

    await page.evaluate(() => { window.location.hash = '#Detail'; });
    await waitForRoute(page, 'Detail');
    await expect(page.locator('#detail-image .nodel-image-media')).toHaveAttribute('src', '/v2/test-images/detail-next.png');
    await expect.poll(() => imageRequests(requests).length).toBe(hiddenDetailRequests + 1);
    await expect.poll(() => imageRequestCount(requests, '/v2/test-images/detail-next.png')).toBe(1);
    await expect(page.locator('#detail-data-image .nodel-image-media')).toHaveCount(1);
  });

  test('activates only the selected nested leaf and keeps data URLs native-element-free while inactive', async ({ page }, testInfo) => {
    skipOutsideReleaseMatrix(testInfo);
    const { requests } = await gotoFixture(page, '#NestedLeaf');

    await waitForRoute(page, 'NestedLeaf');
    await expect(page.locator('nodel-page[data-page-id="Nested"][active]')).toHaveCount(1);
    await expect(page.locator('#nested-leaf-image .nodel-image-media')).toHaveCount(1);
    await expect(page.locator('#nested-sibling-image .nodel-image-media')).toHaveCount(0);
    await expect(page.locator('#overview-image .nodel-image-media')).toHaveCount(0);
    await expect(page.locator('#detail-data-image .nodel-image-media')).toHaveCount(0);
    expect(imageRequests(requests)).toEqual(['/v2/test-images/nested-leaf.png']);
  });
});
