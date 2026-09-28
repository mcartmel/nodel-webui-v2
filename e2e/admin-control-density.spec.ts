import { readFileSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const administrationPath = '/nodes/Demo/admin-control-density.html';

const paramsSchema = {
  type: 'object',
  properties: {
    label: { type: 'string', title: 'Label' },
    amount: { type: 'number', title: 'Amount' },
    enabled: { type: 'boolean', title: 'Enabled' },
    mode: { type: 'string', title: 'Mode', enum: ['Auto', 'Manual'] },
    date: { type: 'string', title: 'Date', format: 'date' },
    time: { type: 'string', title: 'Time', format: 'time' },
    secret: { type: 'string', title: 'Secret', format: 'password' },
    tint: { type: 'string', title: 'Tint', format: 'color' },
    volume: { type: 'number', title: 'Volume', format: 'range', min: 0, max: 100 },
    description: { type: 'string', title: 'Description', format: 'long' },
    json: { title: 'JSON' },
    maybe: { type: [{ type: 'string' }, { type: 'null' }], title: 'Maybe' },
    network: { type: 'object', title: 'Network', properties: { hostname: { type: 'string', title: 'Hostname' } } },
    metrics: { type: 'object', title: 'Metrics', items: { type: 'number' } },
    values: { type: 'array', title: 'Values', items: { type: 'string' } },
    optionalValues: { type: 'array', title: 'Optional values', items: { type: [{ type: 'string' }, { type: 'null' }] } },
    endpoints: { type: 'array', title: 'Endpoints', items: { type: [{ type: 'object', properties: { name: { type: 'string', title: 'Name' }, port: { type: 'number', title: 'Port' } } }, { type: 'null' }] } }
  }
};

async function openSchemaDisclosures(host: Locator) {
  for (;;) {
    const closed = host.locator('details.nodel-schema-root-object:not([open]), details.nodel-schema-nested:not([open])');
    if (!await closed.count()) return;
    await closed.first().locator('summary').click();
  }
}

async function serveNodeAssets(page: Page) {
  const assetRoot = realpathSync(resolve(process.cwd(), 'dist/v2'));
  await page.route('**/nodes/Demo/v2/**', async (route) => {
    const requestPath = new URL(route.request().url()).pathname.replace(/^\/nodes\/Demo\/v2\//, '');
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(requestPath);
    } catch {
      await route.fulfill({ status: 400, body: 'Invalid asset path' });
      return;
    }
    const assetPath = resolve(assetRoot, decodedPath);
    const relativePath = relative(assetRoot, assetPath);
    if (!decodedPath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      await route.fulfill({ status: 400, body: 'Invalid asset path' });
      return;
    }
    try {
      const realAssetPath = realpathSync(assetPath);
      const realRelativePath = relative(assetRoot, realAssetPath);
      if (realRelativePath === '..' || realRelativePath.startsWith(`..${sep}`) || isAbsolute(realRelativePath)) {
        await route.fulfill({ status: 400, body: 'Invalid asset path' });
        return;
      }
      if (!statSync(realAssetPath).isFile()) {
        await route.fulfill({ status: 404, body: 'Asset not found' });
        return;
      }
      await route.fulfill({ path: realAssetPath });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') {
        await route.fulfill({ status: 404, body: 'Asset not found' });
        return;
      }
      throw error;
    }
  });
}

async function installAdminResponses(page: Page, savedParams: unknown[]) {
  await page.route('**/REST/console*', (route) => route.fulfill({ json: [] }));
  await page.route('**/REST/exec', (route) => route.fulfill({ json: {} }));
  await page.route('**/REST/activity*', (route) => route.fulfill({ json: [] }));
  await page.route('**/REST/actions', (route) => route.fulfill({ json: {
    Configure: { name: 'Configure', title: 'Configure', group: 'Operations', schema: paramsSchema },
    Secondary: { name: 'Secondary', title: 'Secondary', group: 'Operations', schema: { type: 'string' } }
  } }));
  await page.route('**/REST/events', (route) => route.fulfill({ json: {
    DensitySignal: { name: 'DensitySignal', title: 'Density Signal', group: 'Operations', schema: { type: 'boolean', title: 'Active' } }
  } }));
  await page.route('**/REST/params/schema', (route) => route.fulfill({ json: paramsSchema }));
  await page.route('**/REST/params', (route) => route.fulfill({ json: {
    label: 'Ready', amount: 3, enabled: true, mode: 'Auto', date: '2026-09-28', time: '12:00', secret: 'secret', tint: '#ff0000', volume: 50,
    description: 'A longer description', json: '{"ready":true}', maybe: null, network: { hostname: 'demo' }, metrics: { ceiling: 5 }, values: ['alpha', 'beta'], optionalValues: [null, 'present'], endpoints: [{ name: 'primary', port: 443 }, null]
  } }));
  await page.route('**/REST/params/save', (route) => {
    savedParams.push(route.request().postDataJSON());
    return route.fulfill({ json: {} });
  });
  await page.route('**/REST/remote/schema', (route) => route.fulfill({ json: {
    type: 'object',
    properties: { actions: { type: 'object', properties: { Open: { type: 'object', title: 'Open node', properties: { node: { type: 'string' }, action: { type: 'string' } } } } } }
  } }));
  await page.route('**/REST/remote', (route) => route.fulfill({ json: { actions: { Open: { node: 'Demo', action: 'Run' } } } }));
  await page.route('**/REST', (route) => route.fulfill({ json: { nodes: { Demo: { name: 'Demo' } } } }));
  await page.route('**/REST/nodeURLsForNode*', (route) => route.fulfill({ json: [{ node: 'Demo', address: 'http://localhost/nodes/Demo/', host: 'local' }] }));
  await page.route('**/REST/nodeURLs*', (route) => route.fulfill({ json: [{ node: 'Demo', address: 'http://localhost/nodes/Demo/', host: 'local' }] }));
}

async function openLiveDensityFixture(page: Page, savedParams: unknown[] = []) {
  const fixture = readFileSync(resolve(process.cwd(), 'e2e/fixtures/admin-control-density-live.html'), 'utf8');
  await serveNodeAssets(page);
  await page.route(`**${administrationPath}`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture }));
  await installAdminResponses(page, savedParams);
  await page.goto(administrationPath, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('nodel-app')).toHaveAttribute('data-nodel-app', 'true');
}

test('published CSS sizes raw admin controls without changing public controls', async ({ page }, testInfo) => {
  const fixture = readFileSync(resolve(process.cwd(), 'e2e/fixtures/admin-control-density-raw-hosts.html'), 'utf8');
  await page.route('**/admin-control-density-fixture.html', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: fixture
  }));
  await page.goto('/admin-control-density-fixture.html', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('nodel-bindings.nodel-controls-touch').evaluate((host) => getComputedStyle(host).getPropertyValue('--nodel-admin-control-min-height').trim())).toBe('3.5rem');

  const geometry = await page.evaluate(() => {
    const height = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect().height;
    return {
      defaults: [
        height('nodel-console input'), height('nodel-console button'),
        height('nodel-actsig input'), height('nodel-actsig select'),
        height('nodel-log input'), height('nodel-log select'),
        height('nodel-params input'), height('nodel-params button'),
        height('nodel-bindings input'), height('nodel-bindings button')
      ],
      compact: height('nodel-params.nodel-controls-compact input'),
      touch: [
        height('nodel-bindings.nodel-controls-touch input'),
        height('nodel-bindings.nodel-controls-touch select'),
        height('nodel-bindings.nodel-controls-touch button')
      ],
      touchVariable: getComputedStyle(document.querySelector('nodel-bindings.nodel-controls-touch')!).getPropertyValue('--nodel-admin-control-min-height'),
      publicField: height('[aria-label="Public field"]'),
      publicButton: height('[aria-label="Unscoped public controls"] button')
    };
  });

  expect(geometry.touchVariable).toBe('3.5rem');
  for (const actual of geometry.defaults) expect(actual).toBeCloseTo(36, 0);
  expect(geometry.compact).toBeCloseTo(36, 0);
  for (const actual of geometry.touch) expect(actual).toBeCloseTo(56, 0);
  expect(geometry.publicField).toBeCloseTo(38, 0);
  expect(geometry.publicButton).toBeCloseTo(44, 0);
  await expect(page.locator('nodel-bindings.nodel-controls-touch input')).toHaveCSS('font-size', '16px');
  await expect(page.locator('nodel-console input')).toHaveCSS('font-size', '14px');

  const evidenceDirectory = resolve(process.cwd(), 'build/admin-density/unit3', testInfo.project.name);
  mkdirSync(evidenceDirectory, { recursive: true });
  const geometryPath = resolve(evidenceDirectory, 'raw-hosts-geometry.json');
  const screenshotPath = resolve(evidenceDirectory, 'raw-hosts.png');
  writeFileSync(geometryPath, `${JSON.stringify(geometry, null, 2)}\n`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('unit3-raw-hosts-geometry', { path: geometryPath, contentType: 'application/json' });
  await testInfo.attach('unit3-raw-hosts-screenshot', { path: screenshotPath, contentType: 'image/png' });
});

for (const mode of ['default', 'compact', 'touch'] as const) {
  test(`authored ${mode} density sizes every real admin renderer exactly`, async ({ page }, testInfo) => {
    await openLiveDensityFixture(page);
    const signalWrites: string[] = [];
    page.on('request', (request) => {
      if (/REST\/(events\/.*\/emit|actions\/.*\/call)/.test(request.url())) signalWrites.push(request.url());
    });
    const expectedHeight = mode === 'touch' ? 56 : 36;
    const hosts = page.locator(`[data-density-case="${mode}"] > nodel-console, [data-density-case="${mode}"] > nodel-actsig, [data-density-case="${mode}"] > nodel-log, [data-density-case="${mode}"] > nodel-params, [data-density-case="${mode}"] > nodel-bindings`);
    for (let index = 0; index < await hosts.count(); index += 1) {
      const host = hosts.nth(index);
      await expect(host).toBeVisible();
      if (await host.evaluate((element) => element.localName === 'nodel-actsig')) {
        await host.locator('details[data-actsig-section-id] > summary').click();
        await expect(host.locator('.nodel-actsig-form')).toHaveCount(3);
        await openSchemaDisclosures(host);
      } else if (await host.evaluate((element) => element.localName === 'nodel-params')) {
        await openSchemaDisclosures(host);
      }
    }
    await expect(page.locator(`[data-density-case="${mode}"] [data-console-input]`)).toBeVisible();
    await expect(page.locator(`[data-density-case="${mode}"] [data-log-filter]`)).toBeVisible();
    await expect(page.locator(`[data-density-case="${mode}"] [data-params-form]`)).toBeVisible();
    await expect(page.locator(`[data-density-case="${mode}"] [data-bindings-form]`)).toBeVisible();

    const geometry = await page.locator(`[data-density-case="${mode}"]`).evaluate((section) => {
      const hosts = [...section.querySelectorAll<HTMLElement>('nodel-console, nodel-actsig, nodel-log, nodel-params, nodel-bindings')];
      return hosts.map((host) => ({
        component: host.localName,
        controls: [...host.querySelectorAll<HTMLElement>("button:not(.nodel-menu-item):not([hidden]), input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file']):not([type='color']):not([type='hidden']):not([hidden]), select:not([hidden])")]
          .filter((control) => control.getClientRects().length > 0)
          .map((control) => ({ type: control.localName, height: control.getBoundingClientRect().height }))
      }));
    });
    for (const host of geometry) {
      expect(host.controls.length, `${mode} ${host.component} rendered controls`).toBeGreaterThan(0);
      for (const control of host.controls) expect(control.height, `${mode} ${host.component} ${control.type}`).toBeCloseTo(expectedHeight, 0);
    }
    const hold = page.locator(`[data-density-case="${mode}"] nodel-log [data-log-hold]`);
    const holdLabel = hold.locator('xpath=..');
    const [holdLabelBox, holdCheckboxBox] = await Promise.all([holdLabel.boundingBox(), hold.boundingBox()]);
    expect(holdLabelBox!.height).toBeCloseTo(expectedHeight, 0);
    expect(holdCheckboxBox!.width).toBeCloseTo(16, 0);
    expect(holdCheckboxBox!.height).toBeCloseTo(16, 0);
    const holdFontSize = await holdLabel.evaluate((label) => getComputedStyle(label).fontSize);
    expect(holdFontSize).toBe('14px');
    await hold.focus();
    await hold.press('Space');
    await expect(hold).toBeChecked();
    await hold.press('Space');
    await expect(hold).not.toBeChecked();
    await holdLabel.getByText('Hold', { exact: true }).click();
    await expect(hold).toBeChecked();
    await holdLabel.getByText('Hold', { exact: true }).click();
    await expect(hold).not.toBeChecked();

    const override = page.locator(`[data-density-case="${mode}"] nodel-actsig [data-actsig-override]`);
    const overrideLabel = override.locator('xpath=..');
    const [overrideLabelBox, overrideCheckboxBox] = await Promise.all([overrideLabel.boundingBox(), override.boundingBox()]);
    expect(overrideLabelBox!.height).toBeCloseTo(expectedHeight, 0);
    expect(overrideCheckboxBox!.width).toBeCloseTo(16, 0);
    expect(overrideCheckboxBox!.height).toBeCloseTo(16, 0);
    const overrideFontSize = await overrideLabel.evaluate((label) => getComputedStyle(label).fontSize);
    expect(overrideFontSize).toBe('14px');
    const signalForm = page.locator(`[data-density-case="${mode}"] nodel-actsig .nodel-actsig-form`).filter({ hasText: 'Density Signal' });
    const emit = signalForm.locator('button[type="submit"]');
    await expect(emit).toHaveText('Emit');
    await expect(emit).toBeDisabled();
    await override.focus();
    await override.press('Space');
    await expect(override).toBeChecked();
    await expect(emit).toBeEnabled();
    await expect(override.locator('xpath=..')).toHaveCSS('font-size', '14px');
    await override.press('Space');
    await expect(override).not.toBeChecked();
    await overrideLabel.getByText('Override signals', { exact: true }).click();
    await expect(override).toBeChecked();
    await expect(emit).toBeEnabled();
    await overrideLabel.getByText('Override signals', { exact: true }).click();
    await expect(override).not.toBeChecked();
    expect(signalWrites).toEqual([]);

    const params = page.locator(`[data-density-case="${mode}"] nodel-params`);
    const schemaCheckbox = params.locator('.nodel-schema-check').first();
    expect((await schemaCheckbox.boundingBox())!.height).toBeGreaterThanOrEqual(expectedHeight);
    expect((await schemaCheckbox.locator('input[type="checkbox"]').boundingBox())!.width).toBeCloseTo(16, 0);
    for (const type of ['number', 'date', 'time', 'password', 'color', 'range']) {
      await expect(params.locator(`[data-schema-field-input][type="${type}"]`).first()).toBeVisible();
    }
    const textarea = params.locator('textarea[data-schema-field-input]').first();
    const jsonTextarea = params.locator('textarea[data-schema-field-input]').nth(1);
    expect((await textarea.boundingBox())!.height).toBeGreaterThanOrEqual(96);
    expect((await jsonTextarea.boundingBox())!.height).toBeGreaterThanOrEqual(128);
    expect(await jsonTextarea.evaluate((control) => getComputedStyle(control).fontFamily)).toMatch(/monospace/);
    for (const type of ['color', 'range']) {
      expect((await params.locator(`[data-schema-field-input][type="${type}"]`).boundingBox())!.height).toBeCloseTo(expectedHeight, 0);
    }

    const evidenceDirectory = resolve(process.cwd(), 'build/admin-density/unit3', testInfo.project.name);
    mkdirSync(evidenceDirectory, { recursive: true });
    const geometryPath = resolve(evidenceDirectory, `real-renderers-${mode}-geometry.json`);
    const screenshotPath = resolve(evidenceDirectory, `real-renderers-${mode}.png`);
    writeFileSync(geometryPath, `${JSON.stringify({ controls: geometry, toggleLabels: {
      hold: { label: holdLabelBox, checkbox: holdCheckboxBox, fontSize: holdFontSize },
      override: { label: overrideLabelBox, checkbox: overrideCheckboxBox, fontSize: overrideFontSize }
    } }, null, 2)}\n`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach(`unit3-${mode}-renderer-geometry`, { path: geometryPath, contentType: 'application/json' });
    await testInfo.attach(`unit3-${mode}-renderer-screenshot`, { path: screenshotPath, contentType: 'image/png' });
  });
}

test('touch-mode nullable array controls stay usable inside 320px cards', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openLiveDensityFixture(page);
  const params = page.locator('[data-density-case="touch"] nodel-params');
  const arrays = page.locator('[data-density-case="touch"] nodel-params details.nodel-schema-nested');
  await expect(arrays).toHaveCount(5);
  const values = arrays.nth(2);
  const optionalValues = arrays.nth(3);
  const endpoints = arrays.nth(4);
  for (const array of [values, optionalValues, endpoints]) {
    if (!await array.evaluate((details) => (details as HTMLDetailsElement).open)) await array.locator('summary').click();
    await expect.poll(() => array.evaluate((details) => (details as HTMLDetailsElement).open)).toBe(true);
  }
  await expect(values.locator('[data-schema-array-entry]')).toHaveCount(2);
  const valueEntry = values.locator('[data-schema-array-entry]').first();
  await valueEntry.locator('[data-schema-field-input]').fill('An intentionally long value that exercises a narrow array card toolbar');

  const nullableScalarEntry = optionalValues.locator('[data-schema-array-entry]').first();
  await nullableScalarEntry.locator('[data-schema-presence]').selectOption('value');
  await nullableScalarEntry.locator('[data-schema-field-input]').fill('A long nullable scalar value for the touch-width regression probe');

  const nullableObjectEntry = endpoints.locator('[data-schema-array-entry]').last();
  await nullableObjectEntry.locator('[data-schema-array-presence]').selectOption('value');
  await nullableObjectEntry.locator('[data-schema-field-input]').first().fill('A long endpoint name that exercises card-header wrapping');
  await nullableObjectEntry.locator('[data-schema-field-input]').nth(1).fill('8443');

  const evidenceDirectory = resolve(process.cwd(), 'build/admin-density/review-array-probe');
  mkdirSync(evidenceDirectory, { recursive: true });
  const geometryPath = resolve(evidenceDirectory, `${testInfo.project.name}-geometry.json`);
  const geometry: Array<Record<string, unknown>> = [];
  const addButtonGeometry: Array<Record<string, unknown>> = [];
  for (const [arrayName, array] of [['Values', values], ['Optional values', optionalValues], ['Endpoints', endpoints]] as const) {
    const entries = array.locator('[data-schema-array-entry]');
    for (let index = 0; index < await entries.count(); index += 1) {
      const entry = entries.nth(index);
      await entry.scrollIntoViewIfNeeded();
      const measured = await entry.evaluate((card) => {
        const box = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        const header = card.querySelector(':scope > div')!;
        const controls = [...card.querySelectorAll<HTMLElement>('select, input, textarea, button')]
          .filter((control) => control.getClientRects().length > 0)
          .map((control) => ({
            tag: control.localName,
            type: (control as HTMLInputElement).type || '',
            name: control.getAttribute('aria-label') || control.title || control.textContent?.trim() || '',
            ...box(control)
          }));
        const headerItems = [...header.children].map((item) => ({ text: item.textContent?.trim() || '', ...box(item) }));
        const remove = card.querySelector<HTMLButtonElement>('[data-schema-array-remove]');
        const removeTextRange = document.createRange();
        if (remove?.firstChild) removeTextRange.selectNodeContents(remove);
        const removeTextRects = [...removeTextRange.getClientRects()].map((rect) => ({ x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }));
        return {
          card: box(card),
          cardClientWidth: (card as HTMLElement).clientWidth,
          cardScrollWidth: (card as HTMLElement).scrollWidth,
          header: box(header),
          headerItems,
          controls,
          removeBox: remove ? box(remove) : null,
          removeText: remove?.textContent?.trim() ?? '',
          removeTextRects
        };
      });
      geometry.push({ arrayName, index, ...measured });
      writeFileSync(geometryPath, `${JSON.stringify(geometry, null, 2)}\n`);
      await entry.screenshot({ path: resolve(evidenceDirectory, `${testInfo.project.name}-card-${geometry.length - 1}.png`), animations: 'disabled' });

      const card = measured.card as { x: number; y: number; right: number; bottom: number; width: number };
      expect(card.x, `${arrayName} card left edge`).toBeGreaterThanOrEqual(0);
      expect(card.right, `${arrayName} card right edge`).toBeLessThanOrEqual(320);
      expect(card.y, `${arrayName} card top edge`).toBeGreaterThanOrEqual(0);
      expect(card.bottom, `${arrayName} card bottom edge`).toBeLessThanOrEqual(800);
      expect(measured.cardScrollWidth, `${arrayName} card horizontal overflow`).toBeLessThanOrEqual(measured.cardClientWidth as number);

      const controls = measured.controls as Array<{ tag: string; type: string; name: string; x: number; y: number; right: number; bottom: number; width: number; height: number }>;
      for (let controlIndex = 0; controlIndex < controls.length; controlIndex += 1) {
        const control = controls[controlIndex]!;
        expect(control.x, `${arrayName} ${control.name} left`).toBeGreaterThanOrEqual(card.x);
        expect(control.right, `${arrayName} ${control.name} right`).toBeLessThanOrEqual(card.right);
        expect(control.y, `${arrayName} ${control.name} top`).toBeGreaterThanOrEqual(card.y);
        expect(control.bottom, `${arrayName} ${control.name} bottom`).toBeLessThanOrEqual(card.bottom);
        expect(control.height, `${arrayName} ${control.name} touch height`).toBeCloseTo(56, 0);
        if (control.tag === 'button') {
          expect(control.width, `${arrayName} ${control.name} hit width`).toBeGreaterThanOrEqual(36);
        }
        if (control.tag === 'select') expect(control.width, `${arrayName} presence select width`).toBeGreaterThanOrEqual(80);
        if (control.tag === 'input' && control.type === 'text') expect(control.width, `${arrayName} text input width`).toBeGreaterThanOrEqual(120);
        for (const other of controls.slice(controlIndex + 1)) {
          const overlapsX = control.x < other.right && other.x < control.right;
          const overlapsY = control.y < other.bottom && other.y < control.bottom;
          expect(overlapsX && overlapsY, `${arrayName} controls overlap: ${control.name} / ${other.name}`).toBe(false);
        }
      }
      expect(measured.removeText, `${arrayName} remove label`).toBe('Remove');
      const removeTextRects = measured.removeTextRects as Array<{ x: number; y: number; right: number; bottom: number; width: number; height: number }>;
      const removeBox = measured.removeBox as { x: number; y: number; right: number; bottom: number };
      expect(removeTextRects).toHaveLength(1);
      expect(removeTextRects[0]!.x).toBeGreaterThanOrEqual(removeBox.x);
      expect(removeTextRects[0]!.right).toBeLessThanOrEqual(removeBox.right);
      expect(removeTextRects[0]!.y).toBeGreaterThanOrEqual(removeBox.y);
      expect(removeTextRects[0]!.bottom).toBeLessThanOrEqual(removeBox.bottom);

      const headerItems = measured.headerItems as Array<{ text: string; x: number; y: number; right: number; bottom: number }>;
      for (let first = 0; first < headerItems.length; first += 1) {
        for (let second = first + 1; second < headerItems.length; second += 1) {
          const a = headerItems[first]!;
          const b = headerItems[second]!;
          const overlapsX = a.x < b.right && b.x < a.right;
          const overlapsY = a.y < b.bottom && b.y < a.bottom;
          expect(overlapsX && overlapsY, `${arrayName} header items overlap: ${a.text} / ${b.text}`).toBe(false);
        }
      }
    }
    const addButton = array.locator('[data-schema-array-add]');
    await addButton.scrollIntoViewIfNeeded();
    const addButtonBox = await addButton.boundingBox();
    const arrayBox = await array.boundingBox();
    const arrayOverflow = await array.evaluate((element) => ({ clientWidth: (element as HTMLElement).clientWidth, scrollWidth: (element as HTMLElement).scrollWidth }));
    expect(addButtonBox).not.toBeNull();
    expect(addButtonBox!.x).toBeGreaterThanOrEqual(arrayBox!.x);
    expect(addButtonBox!.x + addButtonBox!.width).toBeLessThanOrEqual(arrayBox!.x + arrayBox!.width);
    expect(addButtonBox!.x).toBeGreaterThanOrEqual(0);
    expect(addButtonBox!.x + addButtonBox!.width).toBeLessThanOrEqual(320);
    expect(addButtonBox!.width).toBeGreaterThanOrEqual(44);
    expect(addButtonBox!.height).toBeCloseTo(56, 0);
    expect(arrayOverflow.scrollWidth).toBeLessThanOrEqual(arrayOverflow.clientWidth);
    addButtonGeometry.push({ arrayName, array: arrayBox, addButton: addButtonBox, ...arrayOverflow });
  }

  const screenshotPath = resolve(evidenceDirectory, `${testInfo.project.name}.png`);
  writeFileSync(geometryPath, `${JSON.stringify({ entries: geometry, addButtons: addButtonGeometry }, null, 2)}\n`);
  await params.screenshot({ path: screenshotPath, animations: 'disabled' });
  await testInfo.attach('320px touch array geometry', { path: geometryPath, contentType: 'application/json' });
  await testInfo.attach('320px touch array screenshot', { path: screenshotPath, contentType: 'image/png' });
});

test('real admin renderers preserve dynamic form behavior and payloads', async ({ page }, testInfo) => {
  const savedParams: unknown[] = [];
  await openLiveDensityFixture(page, savedParams);

  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const defaultParams = page.locator('[data-density-case="default"] nodel-params');
  await openSchemaDisclosures(defaultParams);

  const defaultBindings = page.locator('[data-density-case="default"] nodel-bindings');
  const bindingRow = defaultBindings.locator('[data-bindings-row-id]').first();
  const [nodeBox, targetBox] = await Promise.all([
    bindingRow.locator('[data-bindings-node]').boundingBox(),
    bindingRow.locator('[data-bindings-target]').boundingBox()
  ]);
  expect(nodeBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  expect(Math.abs(nodeBox!.height - targetBox!.height)).toBeLessThanOrEqual(1);
  const nodePadding = await bindingRow.locator('[data-bindings-node]').evaluate((input) => ({
    inlineEnd: getComputedStyle(input).paddingInlineEnd,
    reservedHeight: getComputedStyle(input).getPropertyValue('--nodel-admin-control-min-height'),
    right: getComputedStyle(input).paddingRight
  }));
  expect(nodePadding).toEqual({ inlineEnd: '40px', reservedHeight: '2.25rem', right: '40px' });
  const link = bindingRow.locator('[data-bindings-open-node]');
  await expect(link).toBeVisible();
  const linkBox = await link.boundingBox();
  expect(linkBox).not.toBeNull();
  expect(linkBox!.width).toBeCloseTo(nodeBox!.height - 2, 0);
  expect(linkBox!.height).toBeCloseTo(nodeBox!.height - 2, 0);
  expect(linkBox!.x).toBeGreaterThanOrEqual(nodeBox!.x);
  expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(nodeBox!.x + nodeBox!.width);

  const touchBindings = page.locator('[data-density-case="touch"] nodel-bindings');
  const checkboxLabel = touchBindings.locator('[data-bindings-row-select]').locator('xpath=..');
  const checkboxLabelBox = await checkboxLabel.boundingBox();
  expect(checkboxLabelBox).not.toBeNull();
  expect(checkboxLabelBox!.width).toBeGreaterThanOrEqual(44);
  expect(checkboxLabelBox!.height).toBeGreaterThanOrEqual(44);
  const touchRow = touchBindings.locator('[data-bindings-row-id]').first();
  const [touchNode, touchLink] = await Promise.all([
    touchRow.locator('[data-bindings-node]').boundingBox(),
    touchRow.locator('[data-bindings-open-node]').boundingBox()
  ]);
  expect(touchNode).not.toBeNull();
  expect(touchLink).not.toBeNull();
  expect(touchLink!.width).toBeCloseTo(touchNode!.height - 2, 0);
  expect(touchLink!.height).toBeCloseTo(touchNode!.height - 2, 0);
  expect(await touchRow.locator('[data-bindings-node]').evaluate((input) => getComputedStyle(input).paddingRight)).toBe('60px');

  for (const mode of ['default', 'compact', 'touch']) {
    const params = page.locator(`[data-density-case="${mode}"] nodel-params`);
    const schemaCheckbox = params.locator('.nodel-schema-check').first();
    const schemaCheckboxGlyph = schemaCheckbox.locator('input[type="checkbox"]');
    expect((await schemaCheckbox.boundingBox())!.height).toBeGreaterThanOrEqual(mode === 'touch' ? 56 : 36);
    expect((await schemaCheckboxGlyph.boundingBox())!.width).toBeCloseTo(16, 0);
    for (const type of ['number', 'date', 'time', 'password', 'color', 'range']) {
      await expect(params.locator(`[data-schema-field-input][type="${type}"]`).first()).toBeVisible();
    }
    const textarea = params.locator('textarea[data-schema-field-input]').first();
    const jsonTextarea = params.locator('textarea[data-schema-field-input]').nth(1);
    expect((await textarea.boundingBox())!.height).toBeGreaterThanOrEqual(96);
    expect((await jsonTextarea.boundingBox())!.height).toBeGreaterThanOrEqual(128);
    expect(await jsonTextarea.evaluate((control) => getComputedStyle(control).fontFamily)).toMatch(/monospace/);
    for (const type of ['color', 'range']) {
      expect((await params.locator(`[data-schema-field-input][type="${type}"]`).boundingBox())!.height).toBeCloseTo(mode === 'touch' ? 56 : 36, 0);
    }
  }

  const params = defaultParams;
  const labelInput = params.locator('[data-schema-field-input][type="text"]').first();
  const inputHandle = await labelInput.elementHandle();
  await labelInput.fill('preserved draft');
  await labelInput.focus();
  const writesBeforeDensityChange = requests.filter((url) => /REST\/(params\/save|actions\/Configure\/call|events\/)/.test(url)).length;
  await params.evaluate((host) => host.classList.add('nodel-controls-touch'));
  await expect(labelInput).toHaveValue('preserved draft');
  await expect(labelInput).toBeFocused();
  expect(await params.evaluate((host, input) => host.querySelector('[data-schema-field-input][type="text"]') === input, inputHandle)).toBe(true);
  expect((await labelInput.boundingBox())!.height).toBeCloseTo(56, 0);
  await params.evaluate((host) => host.classList.replace('nodel-controls-touch', 'nodel-controls-compact'));
  expect((await labelInput.boundingBox())!.height).toBeCloseTo(36, 0);
  expect(requests.filter((url) => /REST\/(params\/save|actions\/Configure\/call|events\/)/.test(url))).toHaveLength(writesBeforeDensityChange);
  expect(await params.evaluate((host, input) => host.querySelector('[data-schema-field-input][type="text"]') === input, inputHandle)).toBe(true);
  await expect(labelInput).toHaveValue('preserved draft');

  const values = params.getByText('Values', { exact: true }).locator('xpath=ancestor::details[1]');
  if (!await values.evaluate((details) => (details as HTMLDetailsElement).open)) await values.locator('summary').click();
  await values.locator('[data-schema-array-add]').click();
  const addedValue = values.locator('[data-schema-array-entry] [data-schema-field-input]').last();
  await expect(addedValue).toBeVisible();
  await addedValue.fill('gamma');
  expect((await addedValue.boundingBox())!.height).toBeCloseTo(36, 0);
  const entries = values.locator('[data-schema-array-entry]');
  await entries.first().locator('[data-schema-array-move="down"]').click();
  await expect.poll(() => entries.locator('[data-schema-field-input]').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual(['beta', 'alpha', 'gamma']);
  await entries.last().locator('[data-schema-array-remove]').click();
  await expect.poll(() => entries.locator('[data-schema-field-input]').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual(['beta', 'alpha']);

  const optionalValues = params.locator('details.nodel-schema-nested').filter({ hasText: 'Optional values' });
  if (!await optionalValues.evaluate((details) => (details as HTMLDetailsElement).open)) await optionalValues.locator('summary').click();
  const nullableEntry = optionalValues.locator('[data-schema-array-entry]').first();
  await expect(nullableEntry.locator('[data-schema-presence]')).toHaveValue('null');
  await nullableEntry.locator('[data-schema-presence]').selectOption('value');
  await nullableEntry.locator('[data-schema-field-input]').fill('now present');

  const endpoints = params.locator('details.nodel-schema-nested').filter({ hasText: 'Endpoints' });
  if (!await endpoints.evaluate((details) => (details as HTMLDetailsElement).open)) await endpoints.locator('summary').click();
  await expect(endpoints.locator('[data-schema-array-entry] [data-schema-field-input]')).toHaveCount(2);
  const newEndpoint = endpoints.locator('[data-schema-array-entry]').last();
  await newEndpoint.locator('[data-schema-array-presence]').selectOption('value');
  await expect(newEndpoint.locator('[data-schema-field-input]')).toHaveCount(2);
  await newEndpoint.locator('[data-schema-field-input]').first().fill('backup');
  await newEndpoint.locator('[data-schema-field-input]').nth(1).fill('8443');
  await params.locator('button[type="submit"]').click();
  await expect.poll(() => savedParams.length).toBe(1);
  expect(savedParams[0]).toMatchObject({ label: 'preserved draft', metrics: { ceiling: 5 }, values: ['beta', 'alpha'], optionalValues: ['now present', 'present'], endpoints: [{ name: 'primary', port: 443 }, { name: 'backup', port: 8443 }] });
  await params.evaluate((host) => host.classList.replace('nodel-controls-compact', 'nodel-controls-touch'));
  expect((await addedValue.boundingBox())!.height).toBeCloseTo(56, 0);
  await params.evaluate((host) => host.classList.remove('nodel-controls-touch'));

  const evidenceDirectory = resolve(process.cwd(), 'build/admin-density/unit3', testInfo.project.name);
  mkdirSync(evidenceDirectory, { recursive: true });
  const screenshotPath = resolve(evidenceDirectory, 'real-renderers-interactions.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('unit3-renderer-interactions-screenshot', { path: screenshotPath, contentType: 'image/png' });
});

test('public controls remain independent beside real admin density hosts', async ({ page }) => {
  await page.route('**/density-public-isolation.html', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/v2/nodel-webui.css"><script type="module" src="/v2/nodel-webui.js"></script>
      <nodel-control-grid fill columns="1"><nodel-button id="auto">Auto</nodel-button><nodel-button id="sm" size="sm">Small</nodel-button><nodel-button id="md" size="md">Medium</nodel-button><nodel-button id="lg" size="lg">Large</nodel-button><nodel-select id="public-select"><nodel-button value="one">One</nodel-button></nodel-select></nodel-control-grid>
      <nodel-console class="nodel-controls-compact"><label>Admin <input aria-label="Admin"></label></nodel-console>`
  }));
  await page.goto('/density-public-isolation.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#lg button')).toBeVisible();
  await expect(page.locator('nodel-select .nodel-select-trigger')).toBeVisible();
  const heights = await page.evaluate(() => Object.fromEntries(
    ['auto', 'sm', 'md', 'lg'].map((id) => [id, document.querySelector(`#${id} button`)!.getBoundingClientRect().height])
  ));
  expect(heights).toEqual({ auto: 56, sm: 36, md: 44, lg: 56 });
  const publicSelect = page.locator('#public-select .nodel-select-trigger');
  await expect(publicSelect).toHaveCSS('min-height', '56px');
  expect((await publicSelect.boundingBox())!.height).toBeCloseTo(56, 0);
  const grid = page.locator('nodel-control-grid');
  const gridCell = grid.locator('#auto').boundingBox();
  const selectBox = page.locator('#public-select').boundingBox();
  expect((await gridCell)!.width).toBeCloseTo((await selectBox)!.width, 0);
  const filledButton = await page.locator('#auto button').boundingBox();
  const filledSelectTrigger = await publicSelect.boundingBox();
  expect(filledButton!.width).toBeCloseTo((await gridCell)!.width, 0);
  expect(filledSelectTrigger!.width).toBeCloseTo((await selectBox)!.width, 0);
  expect(await page.locator('nodel-console input').evaluate((input) => input.getBoundingClientRect().height)).toBeCloseTo(36, 0);
});

test('live density fixture reflows at mobile width and keeps error, disabled, busy, and focus geometry stable', async ({ page }) => {
  const fixture = readFileSync(resolve(process.cwd(), 'e2e/fixtures/admin-control-density-live.html'), 'utf8');
  await page.setViewportSize({ width: 320, height: 800 });
  await serveNodeAssets(page);
  await page.route(`**${administrationPath}`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture }));
  await installAdminResponses(page, []);
  await page.goto(administrationPath, { waitUntil: 'domcontentloaded' });
  const params = page.locator('[data-density-case="default"] nodel-params');
  const input = params.locator('[data-schema-field-input][type="text"]').first();
  await expect(input).toBeVisible();
  const before = await input.boundingBox();
  await input.focus();
  await input.evaluate((element) => { element.setAttribute('disabled', ''); element.setAttribute('aria-invalid', 'true'); });
  const disabledError = await input.boundingBox();
  expect(disabledError!.height).toBeCloseTo(36, 0);
  await input.evaluate((element) => { element.removeAttribute('disabled'); element.removeAttribute('aria-invalid'); });
  await input.focus();
  const focused = await input.boundingBox();
  expect(focused!.height).toBeCloseTo(before!.height, 0);
  await page.emulateMedia({ contrast: 'more' });
  expect(await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches)).toBe(true);
  expect((await input.boundingBox())!.height).toBeCloseTo(36, 0);
  await page.emulateMedia({ contrast: 'no-preference' });
  const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  await input.evaluate((element) => { element.style.width = '100%'; element.style.minWidth = '0'; });
  await expect(input).toBeFocused();
  await page.evaluate(() => {
    for (const host of document.querySelectorAll('[data-density-case] > nodel-console, [data-density-case] > nodel-actsig, [data-density-case] > nodel-log, [data-density-case] > nodel-bindings')) {
      (host as HTMLElement).hidden = true;
    }
  });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect((await input.boundingBox())!.height).toBeCloseTo(72, 0);
  const enlargedOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  expect(enlargedOverflow).toBe(true);
});

test('density changes preserve an in-flight action form without duplicate requests', async ({ page }) => {
  const fixture = readFileSync(resolve(process.cwd(), 'e2e/fixtures/admin-control-density-live.html'), 'utf8');
  let finishCall!: () => void;
  const actionCalls: string[] = [];
  await serveNodeAssets(page);
  await page.route(`**${administrationPath}`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture }));
  await page.route('**/REST/actions/Configure/call', async (route) => {
    actionCalls.push(route.request().url());
    await new Promise<void>((resolve) => { finishCall = resolve; });
    await route.fulfill({ json: {} });
  });
  await installAdminResponses(page, []);
  await page.goto(administrationPath, { waitUntil: 'domcontentloaded' });
  const host = page.locator('[data-density-case="default"] nodel-actsig');
  await host.locator('details[data-actsig-section-id] > summary').click();
  await expect(host.locator('.nodel-actsig-form')).toHaveCount(3);
  await openSchemaDisclosures(host);
  const actionForm = host.locator('.nodel-actsig-form').filter({ hasText: 'Configure' });
  const field = actionForm.locator('input[data-schema-field-input]').first();
  await expect(field).toBeVisible();
  await field.fill('in-flight draft');
  await field.focus();
  await field.evaluate((element) => (element as HTMLInputElement).setSelectionRange(2, 8));
  await host.evaluate((element) => element.classList.add('nodel-controls-compact'));
  await expect(field).toBeFocused();
  expect(await field.evaluate((element) => [(element as HTMLInputElement).selectionStart, (element as HTMLInputElement).selectionEnd])).toEqual([2, 8]);
  const submit = actionForm.locator('button[type="submit"]');
  await submit.click();
  await expect(submit).toHaveAttribute('aria-busy', 'true');
  const formNode = await actionForm.elementHandle();
  await host.evaluate((element) => { element.classList.remove('nodel-controls-compact'); element.classList.add('nodel-controls-touch'); });
  await expect(field).toHaveValue('in-flight draft');
  expect(await actionForm.evaluate((element, original) => element === original, formNode)).toBe(true);
  expect((await field.boundingBox())!.height).toBeCloseTo(56, 0);
  expect(actionCalls).toHaveLength(1);
  finishCall();
  await expect(submit).toHaveAttribute('aria-busy', 'false');
  expect(actionCalls).toHaveLength(1);
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
});
