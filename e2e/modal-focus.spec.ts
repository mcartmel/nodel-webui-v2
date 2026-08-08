import { expect, test } from '@playwright/test';

test.describe('modal focus layers', () => {
  test('keeps only the top interaction path available on the real node page', async ({ page }, testInfo) => {
    await page.goto('/nodel.html', { waitUntil: 'domcontentloaded' });
    const app = page.locator('nodel-app');
    const trigger = page.locator('[data-node-menu-open]');
    const drawer = page.locator('.nodel-node-menu-drawer');
    const close = page.locator('[data-node-menu-close]');
    const backdrop = page.locator('[data-node-menu-backdrop]');

    await expect(app).toBeVisible();
    await trigger.focus();
    await trigger.click();
    await expect(drawer).toBeVisible();
    await expect(close).toBeFocused();
    await expect(page.locator('nodel-page').first()).toHaveAttribute('inert', '');
    await expect(trigger).toHaveAttribute('inert', '');
    await expect(drawer).not.toHaveAttribute('aria-hidden', 'true');
    expect(await drawer.evaluate((element) => {
      for (let current: Element | null = element; current; current = current.parentElement) {
        if (current.getAttribute('aria-hidden') === 'true') {
          return false;
        }
      }
      return true;
    })).toBe(true);

    await close.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('.nodel-node-menu-link-list a').last()).toBeFocused();

    await page.evaluate(() => {
      const sibling = document.createElement('aside');
      sibling.id = 'modal-focus-dynamic-sibling';
      document.querySelector('nodel-app')?.append(sibling);
    });
    await expect(page.locator('#modal-focus-dynamic-sibling')).toHaveAttribute('inert', '');

    if (testInfo.project.use.isMobile) {
      const drawerBox = await drawer.boundingBox();
      expect(drawerBox?.x).toBe(0);
      expect(drawerBox?.y).toBe(0);
      expect(drawerBox?.width).toBe(await page.evaluate(() => window.innerWidth));
      expect(drawerBox?.height).toBe(await page.evaluate(() => window.innerHeight));
      expect(await page.evaluate(() => {
        const backdrop = document.querySelector<HTMLElement>('[data-node-menu-backdrop]');
        if (!backdrop) {
          return false;
        }
         return [[1, 1], [window.innerWidth - 2, 1], [1, window.innerHeight - 2], [window.innerWidth - 2, window.innerHeight - 2]]
           .every((point) => {
             const [x, y] = point;
             return x !== undefined && y !== undefined && !backdrop.contains(document.elementFromPoint(x, y));
           });
      })).toBe(true);
      await expect(close).toBeVisible();
      await close.click();
    } else {
      const backdropBox = await backdrop.boundingBox();
      expect(backdropBox).not.toBeNull();
       if (backdropBox === null) {
         throw new Error('Missing modal backdrop bounds.');
       }
       const x = backdropBox.x + 5;
       const y = backdropBox.y + 5;
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.matches('[data-node-menu-backdrop]'), { x, y })).toBe(true);
      await page.mouse.click(x, y);
    }
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.locator('#modal-focus-dynamic-sibling')).not.toHaveAttribute('inert', '');

    await trigger.click();
    await expect(drawer).toBeVisible();
    await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('nodel-confirm-host') as (HTMLElement & {
        confirm?: (detail: { text: string; resolve: (confirmed: boolean) => void }, trigger: Element | null) => void;
      }) | null;
      host?.confirm?.({ text: 'Confirm layered focus?', resolve: () => undefined }, document.querySelector('[data-node-menu-close]'));
    });
    const confirm = page.locator('nodel-confirm-host [data-confirm-action="confirm"]');
    await expect(confirm).toBeFocused();
    await expect(page.locator('nodel-toolbar')).toHaveAttribute('inert', '');
    await expect(page.locator('nodel-confirm-host .nodel-confirm-backdrop')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeVisible();
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
