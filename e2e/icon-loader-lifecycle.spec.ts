import { expect, test } from '@playwright/test';

const releaseProjects = new Set(['chromium-light-desktop', 'firefox-light-desktop', 'webkit-light-desktop']);
const fixture = '<!doctype html><html><head><script type="module" src="/v2/nodel-webui.js"></script></head><body><nodel-page id="outer"><nodel-page><nodel-icon id="icon" name="mdi:power"></nodel-icon></nodel-page></nodel-page></body></html>';

for (const stage of ['import', 'index'] as const) {
  for (const transition of ['hide', 'disconnect', 'rename'] as const) {
    test(`icon ${transition} during delayed ${stage} does not start obsolete requests`, async ({ page }, testInfo) => {
      test.skip(!releaseProjects.has(testInfo.project.name), 'Deferred icon requests run once per browser engine.');
      const requests: string[] = [];
      page.on('request', request => requests.push(new URL(request.url()).pathname));
      await page.route('**/icon-lifecycle.html', route => route.fulfill({ contentType: 'text/html', body: fixture }));
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      let intercepted = false;
      await page.route(stage === 'import' ? '**/v2/chunks/catalogue-loader-*.js' : '**/v2/nodel-icons.json', async route => {
        const response = await route.fetch();
        intercepted = true;
        await pending;
        await route.fulfill({ response });
      });
      try {
        await page.goto('/icon-lifecycle.html', { waitUntil: 'domcontentloaded' });
        await expect.poll(() => intercepted).toBe(true);
        expect(requests.filter(path => /\/icons\//.test(path))).toEqual([]);
        await page.evaluate(transition => {
          const icon = document.querySelector('#icon')!;
          if (transition === 'hide') document.querySelector<HTMLElement>('#outer')!.hidden = true;
          else if (transition === 'disconnect') {
            const retained = document.createElement('template');
            retained.id = 'retained';
            retained.content.append(icon);
            document.body.append(retained);
          } else {
            icon.setAttribute('name', 'address-book');
            icon.setAttribute('style', 'regular');
          }
        }, transition);
        release();
        await page.waitForLoadState('networkidle');
        expect(requests.filter(path => /\/icons\/mdi-/.test(path))).toEqual([]);
        const indexRequests = () => requests.filter(path => path.endsWith('/nodel-icons.json'));
        expect(indexRequests()).toHaveLength(stage === 'index' || transition === 'rename' ? 1 : 0);
        if (transition !== 'rename') expect(requests.filter(path => /\/icons\//.test(path))).toEqual([]);

        await page.evaluate(() => {
          const retained = document.querySelector<HTMLTemplateElement>('#retained');
          const icon = retained?.content.querySelector('#icon') ?? document.querySelector('#icon')!;
          icon.setAttribute('name', 'address-book');
          icon.setAttribute('style', 'regular');
          document.querySelector<HTMLElement>('#outer')!.hidden = false;
          if (retained) document.querySelector('#outer nodel-page')!.append(icon);
        });
        await expect(page.locator('#icon')).toHaveAttribute('data-icon-state', 'ready');
        await expect(page.locator('#icon svg')).toHaveAttribute('data-icon', 'address-book');
        expect(indexRequests()).toHaveLength(1);
        expect(requests.filter(path => /\/icons\//.test(path))).toEqual([expect.stringContaining('/classic-regular-')]);

        // Another activation reuses both the validated index and the shard.
        await page.locator('#outer').evaluate(element => { (element as HTMLElement).hidden = true; });
        await page.locator('#outer').evaluate(element => { (element as HTMLElement).hidden = false; });
        await expect(page.locator('#icon')).toHaveAttribute('data-icon-state', 'ready');
        expect(indexRequests()).toHaveLength(1);
        expect(requests.filter(path => /\/icons\//.test(path))).toHaveLength(1);
      } finally {
        release();
      }
    });
  }
}

for (const stage of ['index', 'shard'] as const) {
  for (const transition of ['hide', 'disconnect', 'rename'] as const) {
    for (const activePeer of [false, true]) {
      test(`icon ${transition} before ${stage} retry, active peer=${activePeer}`, async ({ page }, testInfo) => {
        test.skip(!releaseProjects.has(testInfo.project.name), 'Deferred icon retries run once per browser engine.');
        await page.route('**/icon-retry.html', route => route.fulfill({ contentType: 'text/html', body: fixture }));
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        let attempts = 0;
        await page.route(stage === 'index' ? '**/v2/nodel-icons.json' : '**/v2/icons/mdi-*.json', async route => {
          if (++attempts !== 1) return route.fallback();
          await pending;
          await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
        });
        try {
          await page.goto('/icon-retry.html', { waitUntil: 'domcontentloaded' });
          await expect.poll(() => attempts).toBe(1);
          if (activePeer) {
            await page.evaluate(() => {
              const peer = document.createElement('nodel-icon');
              peer.id = 'peer';
              peer.setAttribute('name', 'mdi:power');
              document.body.append(peer);
            });
          }
          await page.evaluate(transition => {
            const icon = document.querySelector('#icon')!;
            if (transition === 'hide') document.querySelector<HTMLElement>('#outer')!.hidden = true;
            else if (transition === 'disconnect') {
              const retained = document.createElement('template');
              retained.id = 'retained';
              retained.content.append(icon);
              document.body.append(retained);
            } else {
              icon.setAttribute('name', 'address-book');
              icon.setAttribute('style', 'regular');
            }
          }, transition);
          // Let the latest selection/peer join the already-loaded module's
          // shared request before completing its first attempt.
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          release();
          await page.waitForLoadState('networkidle');
          expect(attempts).toBe(activePeer || (stage === 'index' && transition === 'rename') ? 2 : 1);
          if (activePeer) await expect(page.locator('#peer')).toHaveAttribute('data-icon-state', 'ready');
          await page.evaluate(() => {
            document.querySelector<HTMLElement>('#outer')!.hidden = false;
            const retained = document.querySelector<HTMLTemplateElement>('#retained');
            if (retained) document.querySelector('#outer nodel-page')!.append(retained.content.firstChild!);
          });
          await expect(page.locator('#icon')).toHaveAttribute('data-icon-state', 'ready');
          await expect(page.locator('#icon svg')).toHaveAttribute('data-icon', transition === 'rename' ? 'address-book' : 'power');
          expect(attempts).toBe(stage === 'shard' && transition === 'rename' && !activePeer ? 1 : 2);
        } finally {
          release();
        }
      });
    }
  }
}
