import { expect, test } from '@playwright/test';

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
});
