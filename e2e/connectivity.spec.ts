import { expect, test } from '@playwright/test';

const releaseEngineProjects = new Set(['chromium-light-desktop', 'firefox-light-desktop', 'webkit-light-desktop']);

test.afterEach(async ({ context }) => {
  await context.setOffline(false);
});

test.describe('shared host connectivity', () => {
  test('defaults custom pages to a blocking modal and preserves page state on recovery', async ({ page, context }) => {
    await page.goto('/components.html', { waitUntil: 'domcontentloaded' });
    await page.locator('nodel-app').waitFor();
    await page.evaluate(() => {
      const app = document.querySelector('nodel-app')!;
      const holder = document.createElement('section');
      holder.id = 'connectivity-state-holder';
      holder.innerHTML = '<label>Operator value <input id="connectivity-state-input" /></label><button id="connectivity-state-button" type="button">Test control</button>';
      app.append(holder);
      const input = holder.querySelector<HTMLInputElement>('input')!;
      input.value = 'preserved value';
      input.focus();
      (window as typeof window & { __connectivityClicks?: number; __connectivityMarker?: string }).__connectivityClicks = 0;
      (window as typeof window & { __connectivityClicks?: number; __connectivityMarker?: string }).__connectivityMarker = 'same document';
      holder.querySelector('button')?.addEventListener('click', () => {
        const target = window as typeof window & { __connectivityClicks?: number };
        target.__connectivityClicks = (target.__connectivityClicks ?? 0) + 1;
      });
    });
    const toolbar = page.locator('nodel-toolbar');
    const toolbarBefore = await toolbar.boundingBox();

    await context.setOffline(true);
    const host = page.locator('nodel-connectivity-host');
    await expect(host).toBeVisible();
    await expect(host.locator('[role="alertdialog"]')).toBeFocused();
    await expect(host.locator('[role="alertdialog"]')).toContainText('Offline');
    await expect(host.locator('[role="alertdialog"]')).toContainText('Retrying...');
    await expect(page.locator('#connectivity-state-holder')).toHaveAttribute('inert', '');
    expect((await toolbar.boundingBox())?.y).toBe(toolbarBefore?.y);
    await expect(host.locator('.nodel-connectivity-dialog')).toHaveScreenshot('connectivity-modal.png');

    await page.locator('#connectivity-state-button').click({ timeout: 500 }).catch(() => undefined);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as typeof window & { __connectivityClicks?: number }).__connectivityClicks)).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.closest('#connectivity-state-holder') === null)).toBe(true);
    await host.locator('.nodel-connectivity-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(host).toBeVisible();

    await page.route('**/REST', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"reachable"}' }));
    await context.setOffline(false);
    await expect(host).toBeHidden();

    await expect(page.locator('#connectivity-state-holder')).not.toHaveAttribute('inert', '');
    await expect(page.locator('#connectivity-state-input')).toHaveValue('preserved value');
    await expect(page.locator('#connectivity-state-input')).toBeFocused();
    expect(await page.evaluate(() => (window as typeof window & { __connectivityMarker?: string }).__connectivityMarker)).toBe('same document');
  });

  test('keeps the default modal usable in the 240x240 bleed display composition', async ({ page, context }) => {
    await page.setViewportSize({ width: 240, height: 240 });
    await page.goto('/components.html', { waitUntil: 'domcontentloaded' });
    await page.locator('nodel-app').first().waitFor();
    await page.evaluate(() => {
      for (const app of document.querySelectorAll<HTMLElement>('nodel-app')) app.hidden = true;
      const app = document.createElement('nodel-app');
      app.dataset.connectivityFixture = '';
      app.innerHTML = `
        <nodel-page title="Display" min-height="viewport" bleed>
          <nodel-control-grid fill columns="1">
            <nodel-readout label="Brightness" type="percent" visual="ring" ring-layout="edge" value="50"></nodel-readout>
          </nodel-control-grid>
        </nodel-page>`;
      document.body.append(app);
      const readout = app.querySelector<HTMLElement>('nodel-readout')!;
      readout.tabIndex = 0;
    });

    const app = page.locator('nodel-app[data-connectivity-fixture]');
    const readout = app.locator('nodel-readout');
    await readout.focus();
    await expect(readout).toBeFocused();
    await context.setOffline(true);

    const host = app.locator('nodel-connectivity-host');
    const dialog = host.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('aria-labelledby', 'nodel-connectivity-title');
    await expect(dialog).toHaveAttribute('aria-describedby', 'nodel-connectivity-message');
    await expect(dialog.locator('#nodel-connectivity-title')).toHaveText('Offline');
    await expect(dialog.locator('#nodel-connectivity-message')).toContainText('Retrying...');
    await expect(app.locator('nodel-page')).toHaveAttribute('inert', '');

    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>('nodel-app[data-connectivity-fixture] [role="alertdialog"]')!;
      const message = dialog.querySelector<HTMLElement>('.nodel-connectivity-message')!;
      const dialogRect = dialog.getBoundingClientRect();
      const messageRect = message.getBoundingClientRect();
      return {
        dialog: { bottom: dialogRect.bottom, height: dialogRect.height, left: dialogRect.left, right: dialogRect.right, top: dialogRect.top, width: dialogRect.width },
        message: { height: messageRect.height, width: messageRect.width },
        messageLineHeight: Number.parseFloat(getComputedStyle(message).lineHeight),
        dialogScrollHeight: dialog.scrollHeight,
        dialogClientHeight: dialog.clientHeight,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        viewport: { width: innerWidth, height: innerHeight }
      };
    });
    expect(geometry.dialog.left).toBeGreaterThanOrEqual(0);
    expect(geometry.dialog.top).toBeGreaterThanOrEqual(0);
    expect(geometry.dialog.right).toBeLessThanOrEqual(geometry.viewport.width);
    expect(geometry.dialog.bottom).toBeLessThanOrEqual(geometry.viewport.height);
    expect(geometry.message.width).toBeLessThan(geometry.dialog.width);
    expect(geometry.message.height).toBeGreaterThan(geometry.messageLineHeight);
    expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.viewport.width);
    expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewport.width);
    expect(geometry.dialogScrollHeight).toBeGreaterThanOrEqual(geometry.dialogClientHeight);

    await host.locator('.nodel-connectivity-backdrop').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    await readout.evaluate((element) => element.setAttribute('value', '75'));
    await page.route('**/REST', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"reachable"}' }));
    await context.setOffline(false);
    await expect(host).toBeHidden();
    await expect(app.locator('nodel-page')).not.toHaveAttribute('inert', '');
    await expect(readout).toHaveAttribute('value', '75');
    await expect(readout).toBeFocused();
  });

  test('uses a fixed non-blocking overlay on core administration pages', async ({ page, context }) => {
    await page.goto('/nodes.html#Locals', { waitUntil: 'domcontentloaded' });
    const app = page.locator('nodel-app');
    await expect(app).toHaveAttribute('offline-mode', 'overlay');
    await page.evaluate(() => {
      const app = document.querySelector('nodel-app')!;
      const holder = document.createElement('section');
      holder.id = 'overlay-state-holder';
      holder.innerHTML = '<input id="overlay-state-input" value="retained" /><button id="overlay-state-button" type="button">Local control</button>';
      app.append(holder);
      (window as typeof window & { __overlayClicks?: number }).__overlayClicks = 0;
      holder.querySelector('button')?.addEventListener('click', () => {
        const target = window as typeof window & { __overlayClicks?: number };
        target.__overlayClicks = (target.__overlayClicks ?? 0) + 1;
      });
    });
    const toolbar = page.locator('nodel-toolbar');
    const toolbarBefore = await toolbar.boundingBox();

    await context.setOffline(true);
    const host = page.locator('nodel-connectivity-host');
    await expect(host.locator('[role="alert"]')).toBeVisible();
    await expect(page.locator('#overlay-state-holder')).not.toHaveAttribute('inert', '');
    const toolbarAfter = await toolbar.boundingBox();
    expect(toolbarAfter?.y).toBe(toolbarBefore?.y);
    await expect(host.locator('.nodel-connectivity-banner')).toHaveScreenshot('connectivity-overlay.png');

    await page.locator('#overlay-state-button').focus();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as typeof window & { __overlayClicks?: number }).__overlayClicks)).toBe(1);

    await page.route('**/REST', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
    await context.setOffline(false);
    await expect(host).toBeHidden();
    await expect(page.locator('#overlay-state-input')).toHaveValue('retained');
  });

  test('keeps every core entry page on the recoverable overlay path', async ({ page, context }, testInfo) => {
    test.skip(!releaseEngineProjects.has(testInfo.project.name), 'Core-page release smoke runs once per browser engine.');
    await page.route('**/REST', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));

    for (const entry of ['/nodes.html#Locals', '/nodel.html#Activity', '/toolkit.html']) {
      await page.goto(entry, { waitUntil: 'domcontentloaded' });
      const app = page.locator('nodel-app');
      await expect(app).toHaveAttribute('offline-mode', 'overlay');
      await context.setOffline(true);
      await expect(page.locator('nodel-connectivity-host [role="alert"]')).toBeVisible();
      await expect(app).not.toHaveAttribute('inert', '');
      await context.setOffline(false);
      await expect(page.locator('nodel-connectivity-host')).toBeHidden();
    }
  });
});
