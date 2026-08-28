import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const fixture = `<!doctype html>
<html lang="en"><head><script type="module" src="/v2/nodel-webui.js"></script></head>
<body><input id="input"><div id="editable" contenteditable></div><nodel-app offline-mode="overlay">
  <nodel-shortcut id="f2" key="F2" action="RunF2"></nodel-shortcut>
  <nodel-shortcut id="ctrl-a" key="A" ctrl action="RunCtrlA"></nodel-shortcut>
  <nodel-shortcut id="printable" key="x" action="RunPrintable"></nodel-shortcut>
  <nodel-shortcut id="escape" key="Escape" action="RunEscape"></nodel-shortcut>
  <nodel-shortcut id="confirm" key="C" action="RunConfirmed" confirm></nodel-shortcut>
  <nodel-shortcut id="disabled" key="D" action="RunDisabled" disabled></nodel-shortcut>
  <nodel-shortcut id="visible" key="v" action="RunVisible" visibility="Mode" visible-value="on" hidden></nodel-shortcut>
  <nodel-page title="Fixture"><div id="status"></div>
</nodel-app></body></html>`;

async function openFixture(page: Page) {
  const calls: string[] = [];
  await page.route('**/shortcut-fixture.html', (route) => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.route('**/REST/actions/*/call', async (route) => {
    calls.push(route.request().url().split('/actions/')[1]?.split('/call')[0] ?? '');
    await route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await page.route('**/REST', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route('**/REST/files', (route) => route.fulfill({ contentType: 'application/json', body: '[{"path":"script.py"}]' }));
  await page.route('**/REST/files/contents?*', (route) => route.fulfill({ contentType: 'text/plain', body: 'print("fixture")' }));
  await page.goto('/shortcut-fixture.html', { waitUntil: 'domcontentloaded' });
  await page.locator('nodel-page[active]').waitFor({ state: 'attached' });
  await page.locator('nodel-shortcut[data-state="ready"]').first().waitFor({ state: 'attached' });
  return calls;
}

test.describe('app-global keyboard shortcuts', () => {
  test('delivers F2 and enforces exact key and modifier equality', async ({ page }) => {
    const calls = await openFixture(page);
    await page.keyboard.press('F2');
    await expect.poll(() => calls).toEqual(['RunF2']);

    await page.keyboard.press('Control+A');
    await expect.poll(() => calls).toEqual(['RunF2', 'RunCtrlA']);
    await page.keyboard.press('a');
    await page.keyboard.press('Control+Shift+a');
    await expect.poll(() => calls).toEqual(['RunF2', 'RunCtrlA']);
  });

  test('captures printable input and contenteditable keys, including modal and inert focus', async ({ page }) => {
    const calls = await openFixture(page);
    const input = page.locator('#input');
    await input.click();
    await expect(input).toBeFocused();
    await page.keyboard.press('x');
    await expect.poll(() => calls).toEqual(['RunPrintable']);
    await expect(input).toHaveValue('');

    await page.locator('#editable').focus();
    await page.keyboard.press('x');
    await expect.poll(() => calls).toEqual(['RunPrintable', 'RunPrintable']);
    await expect(page.locator('#editable')).toHaveText('');

    await page.locator('nodel-app').evaluate((element) => element.dispatchEvent(new CustomEvent('nodel-confirm', {
      bubbles: true,
      cancelable: true,
      detail: { title: 'Fixture confirmation', text: 'Keep the modal open?', resolve: () => undefined }
    })));
    const host = page.locator('nodel-confirm-host');
    await expect(host).toBeVisible();
    await expect(page.locator('nodel-page')).toHaveAttribute('inert', '');
    const documentEscape = await page.evaluate(() => {
      (window as typeof window & { modalCancelled?: number }).modalCancelled = 0;
      document.addEventListener('keydown', () => {
        const target = window as typeof window & { modalCancelled?: number };
        target.modalCancelled = (target.modalCancelled ?? 0) + 1;
      }, { once: true });
      return (window as typeof window & { modalCancelled?: number }).modalCancelled;
    });
    expect(documentEscape).toBe(0);
    await page.keyboard.press('Escape');
    await expect.poll(() => calls).toEqual(['RunPrintable', 'RunPrintable', 'RunEscape']);
    expect(await page.evaluate(() => (window as typeof window & { modalCancelled?: number }).modalCancelled)).toBe(0);
    await expect(host).toBeVisible();
    await host.locator('button[data-confirm-action="cancel"]').click();
    await expect(host).toBeHidden();
  });

  test('confirmation cancellation and acceptance restore the original input focus', async ({ page }) => {
    const calls = await openFixture(page);
    const input = page.locator('#input');
    await input.focus();
    await expect(input).toBeFocused();
    await page.keyboard.press('C');
    const host = page.locator('nodel-confirm-host');
    await expect(host).toBeVisible();
    await host.locator('button[data-confirm-action="cancel"]').click();
    await expect(host).toBeHidden();
    await expect(input).toBeFocused();
    expect(calls).toEqual([]);

    await page.keyboard.press('C');
    await expect(host).toBeVisible();
    await host.locator('[data-confirm-action="confirm"]').click();
    await expect(host).toBeHidden();
    await expect.poll(() => calls).toEqual(['RunConfirmed']);
    await expect(input).toBeFocused();
  });

  test('captures F2 while the real CodeMirror editor has focus', async ({ page }) => {
    const calls = await openFixture(page);
    await page.locator('nodel-app').evaluate((app) => {
      const editor = document.createElement('nodel-editor');
      editor.setAttribute('default-file', 'script.py');
      app.append(editor);
    });
    const editor = page.locator('nodel-editor .cm-editor').first();
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press('C');
    const confirmHost = page.locator('nodel-confirm-host');
    await expect(confirmHost).toBeVisible();
    await confirmHost.locator('button[data-confirm-action="cancel"]').click();
    await expect(confirmHost).toBeHidden();
    await expect(editor.locator('.cm-content')).toBeFocused();
    expect(calls).toEqual([]);

    await page.keyboard.press('F2');
    await expect.poll(() => calls).toEqual(['RunF2']);
    await expect(editor.locator('.cm-content')).toBeFocused();
  });

  test('leaves disabled and common-visibility-hidden declarations native', async ({ page }) => {
    const calls = await openFixture(page);
    const input = page.locator('#input');
    await input.click();
    await expect(input).toBeFocused();
    await input.fill('');
    await page.keyboard.press('d');
    await expect(input).toHaveValue('d');
    const visibilityEvent = await input.evaluate((element) => {
      const event = new KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(visibilityEvent).toBe(false);
    expect(calls).toEqual([]);
  });

  test('continues to consume a matching chord while offline', async ({ page, context }) => {
    const calls = await openFixture(page);
    await context.setOffline(true);
    await page.unroute('**/REST/actions/*/call');
    await expect(page.locator('nodel-connectivity-host')).toBeVisible();
    const input = page.locator('#input');
    await input.focus();
    await input.press('x');
    await expect(input).toHaveValue('');
    expect(calls).toEqual([]);
    await context.setOffline(false);
    await expect(page.locator('nodel-connectivity-host')).toBeHidden();
  });

  test('fails closed for duplicates, consumes repeats, and applies dynamic attributes', async ({ page }) => {
    const calls = await openFixture(page);
    await page.evaluate(() => {
      (window as typeof window & { shortcutConflicts?: number }).shortcutConflicts = 0;
      document.querySelector('#f2')?.addEventListener('nodel-shortcut-conflict', () => {
        const target = window as typeof window & { shortcutConflicts?: number };
        target.shortcutConflicts = (target.shortcutConflicts ?? 0) + 1;
      });
    });
    await page.locator('#f2').evaluate((element) => {
      const duplicate = element.cloneNode(true) as HTMLElement;
      duplicate.id = 'duplicate';
      element.parentElement?.append(duplicate);
    });
    await page.keyboard.press('F2');
    expect(calls).toEqual([]);
    expect(await page.evaluate(() => (window as typeof window & { shortcutConflicts?: number }).shortcutConflicts)).toBe(1);

    await page.locator('#f2').evaluate((element) => element.removeAttribute('key'));
    await page.locator('#duplicate').evaluate((element) => element.remove());
    await page.locator('#f2').evaluate((element) => element.setAttribute('key', 'F4'));
    await page.keyboard.press('F4');
    await expect.poll(() => calls).toEqual(['RunF2']);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', repeat: true, cancelable: true })));
    await expect.poll(() => calls).toEqual(['RunF2']);
  });

  test('is absent from layout and accessibility semantics', async ({ page }) => {
    await openFixture(page);
    const axe = await new AxeBuilder({ page }).include('nodel-shortcut').analyze();
    expect(axe.violations).toEqual([]);
    const state = await page.locator('nodel-shortcut').first().evaluate((element) => ({
      rect: element.getBoundingClientRect().toJSON(),
      role: element.getAttribute('role'),
      tabIndex: (element as HTMLElement).tabIndex,
      text: element.textContent
    }));
    expect(state.rect).toMatchObject({ width: 0, height: 0 });
    expect(state.role).toBeNull();
    expect(state.tabIndex).toBe(-1);
    expect(state.text).toBe('');
    expect(await page.locator('nodel-app').ariaSnapshot()).not.toContain('nodel-shortcut');
    await expect(page.locator('nodel-app')).not.toContainText('nodel-shortcut');
  });
});
