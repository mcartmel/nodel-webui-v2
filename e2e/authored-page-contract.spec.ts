import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const releaseProjects = new Set([
  'chromium-light-desktop',
  'firefox-light-desktop',
  'webkit-light-desktop'
]);

const authoredPagePaths = [
  '/authored-page.contract.html',
  '/nodes/Demo/authored-page.contract.html'
];

const heavyChunkPattern = /\/v2\/chunks\/(?:jsviews-|codemirror-editor-|auto-)/;

function skipOutsideReleaseMatrix(testInfo: TestInfo) {
  test.skip(!releaseProjects.has(testInfo.project.name), 'The authored-page contract runs once per browser engine.');
}

function observePage(page: Page) {
  const requests: string[] = [];
  const requestFailures: string[] = [];
  const webSockets: string[] = [];
  const responseStatuses = new Map<string, number[]>();
  page.on('request', (request) => requests.push(request.url()));
  page.on('requestfailed', (request) => requestFailures.push(request.url()));
  page.on('websocket', (socket) => webSockets.push(socket.url()));
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    const statuses = responseStatuses.get(pathname) ?? [];
    statuses.push(response.status());
    responseStatuses.set(pathname, statuses);
  });
  return { requests, requestFailures, webSockets, responseStatuses };
}

async function serveNodeAssets(page: Page) {
  await page.route('**/nodes/Demo/v2/**', async (route) => {
    const sourceUrl = new URL(route.request().url());
    sourceUrl.pathname = sourceUrl.pathname.replace(/^\/nodes\/Demo/, '');
    const response = await page.request.get(sourceUrl.toString());
    await route.fulfill({ response });
  });
}

async function serveAuthoredFixture(page: Page, path: string, fixture: string) {
  await page.route(`**${path}`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== path) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: fixture
    });
  });
}

function requestPath(url: string) {
  return new URL(url).pathname;
}

function assertNoBackendTraffic(requests: string[]) {
  const backendRequests = requests.filter((url) => /\/REST(?:\/|$)/.test(requestPath(url)));
  expect(backendRequests, `Unexpected backend traffic: ${backendRequests.join(', ')}`).toEqual([]);
}

function assertNoHeavyChunks(requests: string[]) {
  expect(requests.some((url) => heavyChunkPattern.test(requestPath(url)))).toBe(false);
}

async function expectStableAssets(
  page: Page,
  responseStatuses: Map<string, number[]>,
  authoredPath: string
) {
  const prefix = authoredPath.startsWith('/nodes/Demo/') ? '/nodes/Demo' : '';
  for (const asset of ['nodel-webui.css', 'nodel-webui.js']) {
    const path = `${prefix}/v2/${asset}`;
    await expect.poll(() => responseStatuses.get(path)?.includes(200) ?? false).toBe(true);
  }
  await expect(page.locator('nodel-app')).toHaveAttribute('data-nodel-app', 'true');
}

test.describe('no-build authored-page contract', () => {
  test('upgrades initial and later markup through stable built assets', async ({ page }, testInfo) => {
    skipOutsideReleaseMatrix(testInfo);

    const fixture = await readFile(resolve(process.cwd(), 'e2e/fixtures/no-build-authored-page.html'), 'utf8');
    await serveNodeAssets(page);
    await serveAuthoredFixture(page, '/authored-page.contract.html', fixture);
    await serveAuthoredFixture(page, '/nodes/Demo/authored-page.contract.html', fixture);
    const traffic = observePage(page);

    for (const authoredPath of authoredPagePaths) {
      const requestStart = traffic.requests.length;
      const failureStart = traffic.requestFailures.length;
      const socketStart = traffic.webSockets.length;
      await page.goto(authoredPath, { waitUntil: 'domcontentloaded' });
      await expectStableAssets(page, traffic.responseStatuses, authoredPath);
      await expect(page.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);
      await expect(page.locator('#contract-button button')).toHaveText('Ready');
      const toggle = page.locator('#contract-toggle');
      await expect(toggle.locator('button')).toHaveAttribute('role', 'switch');
      await expect(toggle).toHaveAttribute('data-state', 'off');
      await expect(page.locator('nodel-markdown h2')).toHaveText('Stable assets');
      await expect(page.locator('script[data-nodel-runtime="memory"]')).toHaveCount(0);

      const definitions = await page.evaluate(() => [
        'nodel-app',
        'nodel-button',
        'nodel-toggle',
        'nodel-select',
        'nodel-markdown'
      ].map((name) => Boolean(customElements.get(name))));
      expect(definitions).toEqual([true, true, true, true, true]);

      await page.locator('#dynamic-contract').evaluate((host) => {
        host.innerHTML = `
          <nodel-group label="Inserted after startup">
            <nodel-select id="contract-select" value="A">
              <nodel-button value="A">Alpha</nodel-button>
              <nodel-button value="B">Beta</nodel-button>
            </nodel-select>
          </nodel-group>
        `;
      });
      const select = page.locator('#contract-select');
      await expect(select.locator('.nodel-select-value')).toHaveText('Alpha');
      await select.locator('.nodel-select-trigger').click();
      await select.locator('nodel-button[value="B"] button').click();
      await expect(select).toHaveAttribute('value', 'B');

      const requests = traffic.requests.slice(requestStart);
      expect(traffic.requestFailures.slice(failureStart)).toEqual([]);
      expect(traffic.webSockets.slice(socketStart)).toEqual([]);
      expect(requests.some((url) => requestPath(url).startsWith('/src/'))).toBe(false);
      if (!authoredPath.startsWith('/nodes/Demo/')) {
        assertNoBackendTraffic(requests);
      }
      assertNoHeavyChunks(requests);
    }
  });

  test('automatically loads an inserted lazy core component once', async ({ page }, testInfo) => {
    skipOutsideReleaseMatrix(testInfo);
    const fixture = await readFile(resolve(process.cwd(), 'e2e/fixtures/no-build-authored-page.html'), 'utf8');
    await serveNodeAssets(page);
    await serveAuthoredFixture(page, '/authored-page.contract.html', fixture);
    const traffic = observePage(page);

    await page.goto('/authored-page.contract.html', { waitUntil: 'domcontentloaded' });
    await expectStableAssets(page, traffic.responseStatuses, '/authored-page.contract.html');
    expect(traffic.requests.filter((url) => /\/v2\/chunks\/nodel-link-[^/]+\.js$/.test(requestPath(url)))).toHaveLength(0);

    await page.locator('#dynamic-contract').evaluate((host) => {
      host.innerHTML = '<nodel-link id="inserted-link" href="#inserted">Inserted link</nodel-link>';
    });
    const link = page.locator('#inserted-link');
    await expect(link).toHaveAttribute('data-state', 'ready');
    await expect(link.locator('a[data-nodel-link-anchor]')).toHaveAttribute('href', '#inserted');
    await expect.poll(() => traffic.requests.filter((url) => /\/v2\/chunks\/nodel-link-[^/]+\.js$/.test(requestPath(url))).length).toBe(1);
    expect(traffic.requestFailures).toEqual([]);
    expect(traffic.webSockets).toEqual([]);
    assertNoBackendTraffic(traffic.requests);
    assertNoHeavyChunks(traffic.requests);
  });

  test('automatically loads initial parsed lazy core markup', async ({ page }, testInfo) => {
    skipOutsideReleaseMatrix(testInfo);
    const fixture = await readFile(resolve(process.cwd(), 'e2e/fixtures/no-build-initial-lazy-authored-page.html'), 'utf8');
    await serveNodeAssets(page);
    await serveAuthoredFixture(page, '/initial-lazy-authored-page.html', fixture);
    const traffic = observePage(page);

    await page.goto('/initial-lazy-authored-page.html', { waitUntil: 'domcontentloaded' });
    await expectStableAssets(page, traffic.responseStatuses, '/initial-lazy-authored-page.html');
    const link = page.locator('#initial-lazy-link');
    await expect(link).toHaveAttribute('data-state', 'ready');
    await expect(link.locator('a[data-nodel-link-anchor]')).toHaveAttribute('href', '#initial-lazy');
    await expect.poll(() => traffic.requests.filter((url) => /\/v2\/chunks\/nodel-link-[^/]+\.js$/.test(requestPath(url))).length).toBe(1);
    expect(traffic.requestFailures).toEqual([]);
    expect(traffic.webSockets).toEqual([]);
    assertNoBackendTraffic(traffic.requests);
    assertNoHeavyChunks(traffic.requests);
  });

  test('loads a lazy component through the stable imperative API with dedupe and bounded errors', async ({ page }, testInfo) => {
    skipOutsideReleaseMatrix(testInfo);
    const fixture = await readFile(resolve(process.cwd(), 'e2e/fixtures/no-build-authored-page.html'), 'utf8');
    await serveNodeAssets(page);
    await serveAuthoredFixture(page, '/authored-page.contract.html', fixture);
    const traffic = observePage(page);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/authored-page.contract.html', { waitUntil: 'domcontentloaded' });
    const result = await page.evaluate(async () => {
      const moduleUrl = new URL('./v2/nodel-webui.js', window.location.href).href;
      const stableModule = await import(moduleUrl);
      if (typeof stableModule.loadNodelComponent !== 'function') {
        throw new Error('Stable nodel-webui.js does not export loadNodelComponent');
      }
      await Promise.all([
        stableModule.loadNodelComponent('nodel-link'),
        stableModule.loadNodelComponent('nodel-link')
      ]);
      return Boolean(customElements.get('nodel-link'));
    });
    expect(result).toBe(true);
    await page.locator('#dynamic-contract').evaluate((host) => {
      host.innerHTML = '<nodel-link id="imperative-link" href="#imperative">Imperative link</nodel-link>';
    });
    const link = page.locator('#imperative-link');
    await expect(link).toHaveAttribute('data-state', 'ready');
    await expect(link.locator('a[data-nodel-link-anchor]')).toHaveAttribute('href', '#imperative');
    await expect.poll(() => traffic.requests.filter((url) => /\/v2\/chunks\/nodel-link-[^/]+\.js$/.test(requestPath(url))).length).toBe(1);

    const unknown = await page.evaluate(async () => {
      const moduleUrl = new URL('./v2/nodel-webui.js', window.location.href).href;
      const stableModule = await import(moduleUrl);
      try {
        await stableModule.loadNodelComponent('nodel-unknown');
        return null;
      } catch (error) {
        return { message: error instanceof Error ? error.message : String(error) };
      }
    });
    expect(unknown?.message).toMatch(/^Unknown Nodel component/);
    expect(unknown?.message.length).toBeLessThanOrEqual(200);
    expect(pageErrors).toEqual([]);
    expect(traffic.requestFailures).toEqual([]);
    expect(traffic.webSockets).toEqual([]);
  });

  test('reports failed lazy chunks through a bounded event without an unhandled page error', async ({ page }, testInfo) => {
    skipOutsideReleaseMatrix(testInfo);
    const fixture = await readFile(resolve(process.cwd(), 'e2e/fixtures/no-build-authored-page.html'), 'utf8');
    await serveNodeAssets(page);
    await serveAuthoredFixture(page, '/authored-page.contract.html', fixture);
    await page.route('**/v2/chunks/nodel-link-*.js', (route) => route.fulfill({
      status: 503,
      contentType: 'text/plain',
      body: 'blocked lazy component fixture'
    }));
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/authored-page.contract.html', { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const details: Array<{ tagName?: string; message?: string }> = [];
      window.addEventListener('nodel-component-load-error', (event) => {
        const detail = (event as CustomEvent).detail;
        details.push({ tagName: detail?.tagName, message: detail?.message });
      }, { once: true });
      const moduleUrl = new URL('./v2/nodel-webui.js', window.location.href).href;
      const stableModule = await import(moduleUrl);
      if (typeof stableModule.loadNodelComponent !== 'function') {
        return { detail: null, rejection: '', api: false };
      }
      let rejection = '';
      try {
        await stableModule.loadNodelComponent('nodel-link');
      } catch (error) {
        rejection = error instanceof Error ? error.message : String(error);
      }
      return { detail: details[0] ?? null, rejection, api: true };
    });

    expect(result.api).toBe(true);
    expect(result.detail?.tagName).toBe('nodel-link');
    expect(result.detail?.message).toMatch(/^Failed to load Nodel component/);
    expect(result.detail?.message?.length).toBeLessThanOrEqual(200);
    expect(result.rejection).toMatch(/^Failed to load Nodel component/);
    expect(result.rejection.length).toBeLessThanOrEqual(200);
    expect(pageErrors).toEqual([]);
  });

  test('shows a recoverable adjacent alert for automatic lazy failures', async ({ page }, testInfo) => {
    skipOutsideReleaseMatrix(testInfo);
    const fixture = await readFile(resolve(process.cwd(), 'e2e/fixtures/no-build-authored-page.html'), 'utf8');
    await serveNodeAssets(page);
    await serveAuthoredFixture(page, '/authored-page.contract.html', fixture);
    await page.route('**/v2/chunks/nodel-link-*.js', (route) => route.fulfill({
      status: 503,
      contentType: 'text/plain',
      body: 'blocked lazy component response with private details'
    }));
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const traffic = observePage(page);
    await page.goto('/authored-page.contract.html', { waitUntil: 'domcontentloaded' });
    await expectStableAssets(page, traffic.responseStatuses, '/authored-page.contract.html');

    await page.evaluate(() => {
      const generations: number[] = [];
      const unhandledRejections: string[] = [];
      window.addEventListener('nodel-component-load-error', (event) => {
        const generation = (event as CustomEvent).detail?.attemptGeneration;
        if (typeof generation === 'number') generations.push(generation);
      });
      window.addEventListener('unhandledrejection', (event) => {
        unhandledRejections.push(event.reason instanceof Error ? event.reason.message : String(event.reason));
      });
      (window as Window & { __nodelFailureGenerations?: number[] }).__nodelFailureGenerations = generations;
      (window as Window & { __nodelUnhandledRejections?: string[] }).__nodelUnhandledRejections = unhandledRejections;
      const host = document.querySelector('#dynamic-contract');
      host?.insertAdjacentHTML('beforeend', '<nodel-link id="blocked-link" data-authored="keep"><span>Authored fallback content</span></nodel-link>');
    });
    const unresolved = page.locator('#blocked-link');
    const fallback = unresolved.locator('xpath=following-sibling::*[1]');
    await expect(fallback).toHaveAttribute('role', 'alert');
    await expect(fallback).toHaveClass(/nodel-component-fallback/);
    await expect(fallback).toContainText('nodel-link');
    await expect(fallback).not.toContainText('blocked lazy component response');
    await expect(fallback).toHaveText(/nodel-link/);
    expect((await fallback.textContent())?.length ?? 0).toBeLessThanOrEqual(200);
    await expect(unresolved).toBeHidden();
    await expect(unresolved).toHaveAttribute('data-authored', 'keep');
    await expect(unresolved).toContainText('Authored fallback content');
    await expect(fallback.locator('[data-nodel-component-retry]')).toBeEnabled();
    await expect(fallback.locator('[data-nodel-component-reload]')).toBeEnabled();
    await expect(page.locator('nodel-toast-host .nodel-toast')).toHaveCount(1);

    const retry = fallback.locator('[data-nodel-component-retry]');
    await retry.focus();
    await expect(retry).toBeFocused();
    await retry.press('Enter');
    await expect(fallback.locator('[data-nodel-component-retry]')).toBeEnabled();
    await expect(fallback).toBeVisible();
    const reload = fallback.locator('[data-nodel-component-reload]');
    await reload.focus();
    await expect(reload).toBeFocused();
    await expect(retry).toHaveCSS('transition-duration', '0s');
    await expect(page.locator('nodel-toast-host .nodel-toast')).toHaveCount(2);
    const generations = await page.evaluate(() => (window as Window & { __nodelFailureGenerations?: number[] }).__nodelFailureGenerations ?? []);
    const unhandledRejections = await page.evaluate(() => (window as Window & { __nodelUnhandledRejections?: string[] }).__nodelUnhandledRejections ?? []);
    expect(generations).toEqual([1, 2]);
    expect(unhandledRejections).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('does not create a toast host when automatic loading fails without an app', async ({ page }, testInfo) => {
    skipOutsideReleaseMatrix(testInfo);
    const fixture = await readFile(resolve(process.cwd(), 'e2e/fixtures/no-build-authored-page.html'), 'utf8');
    await serveNodeAssets(page);
    await serveAuthoredFixture(page, '/authored-page.contract.html', fixture);
    await page.route('**/v2/chunks/nodel-link-*.js', (route) => route.fulfill({ status: 503, body: 'blocked' }));
    await page.goto('/authored-page.contract.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => document.querySelector('nodel-app')?.remove());
    await page.evaluate(() => {
      const unhandledRejections: string[] = [];
      window.addEventListener('unhandledrejection', (event) => {
        unhandledRejections.push(event.reason instanceof Error ? event.reason.message : String(event.reason));
      });
      (window as Window & { __nodelUnhandledRejections?: string[] }).__nodelUnhandledRejections = unhandledRejections;
      document.body.insertAdjacentHTML('beforeend', '<nodel-link id="no-app-blocked"><span>Keep me</span></nodel-link>');
    });
    await expect(page.locator('#no-app-blocked + .nodel-component-fallback')).toBeVisible();
    expect(await page.locator('nodel-toast-host').count()).toBe(0);
    expect(await page.evaluate(() => (window as Window & { __nodelUnhandledRejections?: string[] }).__nodelUnhandledRejections ?? [])).toEqual([]);
  });

  test('keeps the failure alert and controls visible in forced colors', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-forced-colors', 'Forced-colors fallback coverage runs in its dedicated project.');
    const fixture = await readFile(resolve(process.cwd(), 'e2e/fixtures/no-build-authored-page.html'), 'utf8');
    await serveNodeAssets(page);
    await serveAuthoredFixture(page, '/authored-page.contract.html', fixture);
    await page.route('**/v2/chunks/nodel-link-*.js', (route) => route.fulfill({ status: 503, body: 'blocked' }));
    await page.goto('/authored-page.contract.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      document.querySelector('#dynamic-contract')?.insertAdjacentHTML(
        'beforeend',
        '<nodel-link id="forced-colors-blocked"><span>Keep authored content</span></nodel-link>'
      );
    });
    const unresolved = page.locator('#forced-colors-blocked');
    const fallback = unresolved.locator('xpath=following-sibling::*[1]');
    await expect(fallback).toBeVisible();
    await expect(unresolved).toBeHidden();
    const retry = fallback.locator('[data-nodel-component-retry]');
    await retry.focus();
    await expect(retry).toBeFocused();
    const reload = fallback.locator('[data-nodel-component-reload]');
    await reload.focus();
    await expect(reload).toBeFocused();
    await expect(unresolved).toContainText('Keep authored content');
  });
});
