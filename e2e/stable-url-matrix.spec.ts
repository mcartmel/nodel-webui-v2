import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

const releaseProjects = new Set([
  'chromium-light-desktop',
  'firefox-light-desktop',
  'webkit-light-desktop'
]);

const builtPages = ['components', 'nodes', 'nodel', 'toolkit'] as const;
const lazyComponentTags = [
  'nodel-description',
  'nodel-node-list',
  'nodel-add-node',
  'nodel-node-menu',
  'nodel-diagnostics',
  'nodel-host-log',
  'nodel-diagnostic-charts',
  'nodel-toolkit',
  'nodel-console',
  'nodel-log',
  'nodel-actsig',
  'nodel-params',
  'nodel-bindings',
  'nodel-editor',
  'nodel-link'
] as const;

async function lazyComponentsInPage(pageName: (typeof builtPages)[number]) {
  const source = await readFile(resolve(process.cwd(), `${pageName}.html`), 'utf8');
  return lazyComponentTags.filter((tagName) => source.includes(`<${tagName}`));
}

function skipOutsideReleaseMatrix(testInfo: TestInfo) {
  test.skip(!releaseProjects.has(testInfo.project.name), 'The stable URL matrix runs once per browser engine.');
}

async function serveNodeAssets(page: Page) {
  await page.route('**/nodes/Demo/v2/**', async (route) => {
    const sourceUrl = new URL(route.request().url());
    sourceUrl.pathname = sourceUrl.pathname.replace(/^\/nodes\/Demo/, '');
    const response = await page.request.get(sourceUrl.toString());
    await route.fulfill({ response });
  });
}

async function serveBuiltPages(page: Page) {
  await page.route('**/nodes/Demo/*.html', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const match = pathname.match(/^\/nodes\/Demo\/(components|nodes|nodel|toolkit)\.html$/);
    if (!match) {
      await route.fallback();
      return;
    }
    const sourceUrl = new URL(route.request().url());
    sourceUrl.pathname = `/${match[1]}.html`;
    const response = await page.request.get(sourceUrl.toString());
    await route.fulfill({ response });
  });
}

async function serveMinimalNodeRest(page: Page) {
  const fulfillNodeRest = async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith('/nodes/Demo/REST')) {
      await route.fallback();
      return;
    }

    if (pathname.includes('/files/contents')) {
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'print("matrix")' });
      return;
    }

    let contentType = 'application/json';
    let body = '{}';
    if (pathname.endsWith('/activity')
      || pathname.endsWith('/console')
      || pathname.endsWith('/logs')
      || pathname.endsWith('/files')
      || pathname.endsWith('/nodeURLs')
      || pathname.endsWith('/recipes/list')
      || pathname.endsWith('/diagnostics/measurements')) {
      body = '[]';
    } else if (pathname.endsWith('/toolkit')) {
      body = JSON.stringify({ script: '# matrix fixture' });
    } else if (pathname.endsWith('/hasRestarted')) {
      body = JSON.stringify({ timestamp: null });
    } else if (pathname.endsWith('/schema')) {
      body = JSON.stringify({ type: 'object' });
    }
    await route.fulfill({ status: 200, contentType, body });
  };
  await page.route('**/nodes/Demo/REST/**', fulfillNodeRest);
  await page.route('**/nodes/Demo/REST', fulfillNodeRest);
}

test.describe('stable authored URL matrix', () => {
  for (const builtPage of builtPages) {
    test(`serves ${builtPage}.html below a node URL with stable assets`, async ({ page }, testInfo) => {
      skipOutsideReleaseMatrix(testInfo);
      const expectedLazyComponents = await lazyComponentsInPage(builtPage);
      expect(expectedLazyComponents.length).toBeGreaterThan(0);
      await page.addInitScript(() => {
        const componentLoadErrors: unknown[] = [];
        window.addEventListener('nodel-component-load-error', (event) => {
          componentLoadErrors.push((event as CustomEvent).detail);
        });
        (window as typeof window & { __componentLoadErrors?: unknown[] }).__componentLoadErrors = componentLoadErrors;
        class BlockedWebSocket {
          constructor() {
            throw new Error('WebSocket blocked for stable URL matrix');
          }
        }
        window.WebSocket = BlockedWebSocket as never;
      });
      await serveNodeAssets(page);
      await serveBuiltPages(page);
      await serveMinimalNodeRest(page);

      const webSockets: string[] = [];
      const requests: string[] = [];
      const requestFailures: string[] = [];
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

      await page.goto(`/nodes/Demo/${builtPage}.html`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('nodel-app')).toHaveAttribute('data-nodel-app', 'true');
      await expect(page.locator('link[href*="v2/nodel-webui.css"]')).toHaveCount(1);
      const entryPath = builtPage === 'components' ? '/nodes/Demo/v2/entries/components.js' : '/nodes/Demo/v2/nodel-webui.js';
      await expect(page.locator(`script[src*="${entryPath.slice('/nodes/Demo/'.length)}"]`)).toHaveCount(1);
      await expect.poll(() => responseStatuses.get('/nodes/Demo/v2/nodel-webui.css')?.includes(200) ?? false).toBe(true);
      await expect.poll(() => responseStatuses.get(entryPath)?.includes(200) ?? false).toBe(true);
      for (const lazyTag of expectedLazyComponents) {
        await expect.poll(() => page.evaluate((tagName) => Boolean(customElements.get(tagName)), lazyTag)).toBe(true);
        await expect.poll(() => requests.some((url) => (
          new URL(url).pathname.startsWith(`/nodes/Demo/v2/chunks/${lazyTag}-`)
        ))).toBe(true);
      }
      const componentLoadErrors = await page.evaluate(() => (
        (window as typeof window & { __componentLoadErrors?: unknown[] }).__componentLoadErrors ?? []
      ));
      expect(componentLoadErrors).toEqual([]);
      expect(requestFailures.filter((url) => new URL(url).pathname.includes('/v2/'))).toEqual([]);
      expect(webSockets).toEqual([]);
    });
  }
});
