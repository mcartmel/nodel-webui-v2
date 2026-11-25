import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const receiver = 'Receiver';
const longPrefix = 'A structured endpoint label for the shared receiver — command channel ';
const aliases = Array.from({ length: 100 }, (_, index) => `${longPrefix}${String(index + 1).padStart(3, '0')}`);

async function installFanout(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(process.env.KONVA_EXPERIMENT_URL!).origin) {
      await route.abort('blockedbyclient');
      throw new Error(`Unexpected external request ${url.href}`);
    }
    if (url.pathname === '/REST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: { Publisher: {}, [receiver]: {} } }) });
      return;
    }
    const match = /^\/nodes\/(Publisher|Receiver)\/REST\/remote$/.exec(url.pathname);
    if (match) {
      requests.push(url.pathname);
      const bindings = match[1] === 'Publisher'
        ? { actions: Object.fromEntries(aliases.map((alias) => [alias, { node: receiver, action: 'Accept' }])) }
        : { actions: {} };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bindings) });
      return;
    }
    if (url.pathname === '/REST/nodeURLs' || url.pathname === '/REST/nodeURLsForNode') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    if (/\/REST(?:\/|$)/i.test(url.pathname)) {
      await route.abort('blockedbyclient');
      throw new Error(`Unexpected API access ${route.request().method()} ${url.pathname}`);
    }
    await route.continue();
  });
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('[data-fixture-summary]')).toContainText('2 nodes');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await expect.poll(() => requests.length).toBe(2);
  await page.waitForTimeout(200);
  return requests;
}

async function frame(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function sceneState(page: Page) {
  return page.evaluate(() => {
    const stage = (window as Window & { Konva?: { stages?: any[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage unavailable');
    const state = window as Window & { __shapeIdentities?: WeakMap<object, number>; __shapeIdentityNext?: number };
    state.__shapeIdentities ??= new WeakMap();
    state.__shapeIdentityNext ??= 0;
    const identity = (shape: object) => {
      let id = state.__shapeIdentities!.get(shape);
      if (id === undefined) { id = ++state.__shapeIdentityNext!; state.__shapeIdentities!.set(shape, id); }
      return id;
    };
    const cards = stage.find('.topology-card');
    const wires = stage.find('.topology-wire');
    const sockets = cards.flatMap((card: any) => card.find('Circle').filter((shape: any) => shape.name().startsWith('socket-')));
    return {
      cardCount: cards.length,
      wireCount: wires.length,
      socketCount: sockets.length,
      cards: cards.map((shape: any) => [shape.id(), identity(shape)]),
      wires: wires.map((shape: any) => [shape.id(), identity(shape)]),
      sockets: sockets.map((shape: any) => [shape.name(), identity(shape)]),
      positions: cards.map((shape: any) => [shape.id(), shape.x(), shape.y()])
    };
  });
}

async function socketPoint(page: Page, title: string, portLabel: string) {
  return page.evaluate(({ title, portLabel }) => {
    const stage = (window as Window & { Konva?: { stages?: any[] } }).Konva?.stages?.[0];
    const card = stage?.find('.topology-card').find((item: any) => item.find('Text').some((text: any) => text.text() === title));
    const label = card?.find('Text').find((text: any) => text.text() === portLabel);
    const socket = card?.find('Circle').find((shape: any) => shape.name().startsWith('socket-') && Math.abs(shape.y() - label?.y() - 7) < 0.1);
    if (!stage || !label || !socket) throw new Error(`Could not locate ${title}/${portLabel} socket`);
    const point = socket.getAbsolutePosition(stage);
    const rect = stage.getContent().getBoundingClientRect();
    return { x: rect.left + stage.x() + point.x * stage.scaleX(), y: rect.top + stage.y() + point.y * stage.scaleY(), id: socket.name(), cardId: card.id() };
  }, { title, portLabel });
}

async function hitWirePoint(page: Page, between: [string, string], fromOverflow = false) {
  return page.evaluate(({ titles, fromOverflow }) => {
    const stage = (window as Window & { Konva?: { stages?: any[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage unavailable');
    const ends: Array<{ owner: string; point: { x: number; y: number }; overflow: boolean }> = [];
    for (const card of stage.find('.topology-card')) {
      const owner = card.find('Text').map((text: any) => text.text()).find((text: string) => ['Publisher', 'Receiver'].includes(text));
      if (!owner) continue;
      for (const socket of card.find('Circle').filter((item: any) => item.isVisible() && /^(socket-|overflow-takeoff-)/.test(item.name()))) {
        ends.push({ owner, point: socket.getAbsolutePosition(stage), overflow: socket.name().startsWith('overflow-') });
      }
    }
    for (const wire of stage.find('.topology-wire')) {
      const curves: any[] = [];
      let current: any;
      const context = { strokeStyle: '', fillStyle: '', lineWidth: 0,
        beginPath() { current = undefined; }, moveTo(x: number, y: number) { current = { start: { x, y } }; },
        bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) { if (current) { current.c1 = { x: x1, y: y1 }; current.c2 = { x: x2, y: y2 }; current.end = { x, y }; } },
        lineTo() {}, closePath() {}, fill() {}, stroke() { if (current?.c1 && current?.c2 && current?.end) curves.push(current); current = undefined; } };
      wire.getSceneFunc().call(wire, context, wire);
      for (const curve of curves) {
        const near = (point: { x: number; y: number }) => ends.find((item) => Math.hypot(item.point.x - point.x, item.point.y - point.y) < 1);
        const first = near(curve.start), last = near(curve.end);
        if (!first || !last || first.overflow !== fromOverflow || !titles.includes(first.owner) || !titles.includes(last.owner)) continue;
        for (const t of [0.5, 0.4, 0.6]) {
          const u = 1 - t;
          const world = { x: u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.c1.x + 3 * u * t ** 2 * curve.c2.x + t ** 3 * curve.end.x,
            y: u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.c1.y + 3 * u * t ** 2 * curve.c2.y + t ** 3 * curve.end.y };
          const hit = stage.getIntersection({ x: stage.x() + world.x * stage.scaleX(), y: stage.y() + world.y * stage.scaleY() });
          if (hit?.id() === wire.id()) {
            const rect = stage.getContent().getBoundingClientRect();
            return { id: wire.id(), x: rect.left + stage.x() + world.x * stage.scaleX(), y: rect.top + stage.y() + world.y * stage.scaleY() };
          }
        }
      }
    }
    throw new Error('Could not identify a physical wire hit point');
  }, { titles: between, fromOverflow });
}

async function snapshot(page: Page, name: string) {
  await mkdir('artifacts/konva-local/selection', { recursive: true });
  await frame(page);
  return page.screenshot({ path: `artifacts/konva-local/selection/${name}.png`, animations: 'disabled' });
}

test('trusted socket groups, exact wire narrowing, chooser structure, and stable shape identity', async ({ page }) => {
  const requests = await installFanout(page);
  await page.locator('.canvas-stage').focus();
  const initial = await sceneState(page);
  expect(initial.cardCount).toBe(2);
  expect(initial.wireCount).toBe(100);
  expect(initial.socketCount).toBeGreaterThan(0);

  const unselectedPixels = await snapshot(page, 'light-unselected');
  await page.selectOption('[data-theme-select]', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await snapshot(page, 'dark-unselected');
  await page.selectOption('[data-theme-select]', 'light');

  const sharedSocket = await socketPoint(page, 'Receiver', 'Accept');
  await page.evaluate(() => {
    const state = window as Window & { __selectionDraws?: number; Konva?: { stages?: any[] } };
    state.__selectionDraws = 0;
    for (const layer of state.Konva?.stages?.[0]?.getLayers() ?? []) layer.on('draw.selectionEvidence', () => { state.__selectionDraws = (state.__selectionDraws ?? 0) + 1; });
  });
  await page.mouse.click(sharedSocket.x, sharedSocket.y);
  await frame(page);
  const drawsAfterClick = await page.evaluate(() => (window as Window & { __selectionDraws?: number }).__selectionDraws ?? 0);
  expect(drawsAfterClick).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  const drawsAtIdle = await page.evaluate(() => (window as Window & { __selectionDraws?: number }).__selectionDraws ?? 0);
  expect(drawsAtIdle).toBe(drawsAfterClick);
  const grouped = await page.evaluate(() => {
    const stage = (window as Window & { Konva?: { stages?: any[] } }).Konva?.stages?.[0];
    const paint = stage?.findOne('.connection-selection-paint');
    let amber = 0;
    if (paint) {
      const context = { beginPath() {}, moveTo() {}, bezierCurveTo() {}, lineTo() {}, closePath() {}, fill() {}, strokeStyle: '', fillStyle: '', lineWidth: 0,
        stroke() { if (String(this.strokeStyle).toLowerCase().includes('b45309') || String(this.strokeStyle).includes('180, 83, 9')) amber += 1; } };
      paint.getSceneFunc().call(paint, context, paint);
    }
    const group = stage?.find('.topology-card').find((card: any) => card.find('Text').some((text: any) => text.text() === 'Receiver'));
    return { amberStrokes: amber, description: document.querySelector('.canvas-failure')?.textContent ?? '', sockets: group?.find('Circle').filter((socket: any) => socket.name().startsWith('socket-')).map((socket: any) => ({ id: socket.name(), connectionSelected: socket.getAttr('connectionSelected') })) ?? [] };
  });
  expect(grouped.amberStrokes).toBeGreaterThan(0);
  expect(grouped.description).toContain('100 action connections selected');
  expect(grouped.sockets.filter((socket: { connectionSelected: boolean }) => socket.connectionSelected)).toHaveLength(1);
  const selectedSocketPixels = await snapshot(page, 'light-socket-selected');
  expect(selectedSocketPixels.equals(unselectedPixels)).toBe(false);
  await page.selectOption('[data-theme-select]', 'dark');
  await snapshot(page, 'dark-socket-selected');
  await page.selectOption('[data-theme-select]', 'light');

  await page.keyboard.press('Escape');
  await frame(page);
  const target = await hitWirePoint(page, ['Publisher', 'Receiver']);
  await page.mouse.click(target.x, target.y);
  await frame(page);
  const exact = await page.evaluate(() => {
    const stage = (window as Window & { Konva?: { stages?: any[] } }).Konva?.stages?.[0];
    const wires = stage?.find('.topology-wire') ?? [];
    const paint = stage?.findOne('.connection-selection-paint');
    let amberStrokes = 0;
    if (paint) {
      const context = { beginPath() {}, moveTo() {}, bezierCurveTo() {}, lineTo() {}, closePath() {}, fill() {}, strokeStyle: '', fillStyle: '', lineWidth: 0,
        stroke() { if (String(this.strokeStyle).toLowerCase().includes('b45309') || String(this.strokeStyle).includes('180, 83, 9')) amberStrokes += 1; } };
      paint.getSceneFunc().call(paint, context, paint);
    }
    return { amberStrokes, wireCount: wires.length, description: document.querySelector('.canvas-failure')?.textContent ?? '' };
  });
  expect(exact.wireCount).toBe(100);
  expect(exact.amberStrokes).toBeGreaterThan(0);
  expect(exact.description).toContain('Action call selected: Publisher');
  expect(exact.description).toContain('to Receiver, Accept');
  await snapshot(page, 'light-wire-selected');
  await page.selectOption('[data-theme-select]', 'dark');
  await snapshot(page, 'dark-wire-selected');
  await page.selectOption('[data-theme-select]', 'light');

  const focus = page.locator('.canvas-stage');
  await focus.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('p');
  const dialog = page.locator('.canvas-binding-chooser');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Connection details' })).toBeVisible();
  await expect(dialog.locator('[data-binding-id]')).toHaveCount(8);
  const longRow = dialog.locator('[data-binding-id]').first();
  await expect(longRow).toContainText('Action call');
  await expect(longRow.locator('.canvas-binding-endpoint-node')).toHaveCount(2);
  await expect(longRow.locator('.canvas-binding-endpoint-name')).toHaveCount(2);
  await expect(longRow.locator('.canvas-binding-owner')).toHaveCount(1);
  expect(await longRow.getAttribute('aria-label')).toContain(longPrefix);
  expect(await longRow.evaluate((row) => row.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await snapshot(page, 'light-structured-chooser');
  await page.selectOption('[data-theme-select]', 'dark');
  await snapshot(page, 'dark-structured-chooser');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const final = await sceneState(page);
  expect(final.cardCount).toBe(initial.cardCount);
  expect(final.wireCount).toBe(initial.wireCount);
  expect(final.socketCount).toBe(initial.socketCount);
  expect(final.cards).toEqual(initial.cards);
  expect(final.wires).toEqual(initial.wires);
  expect(final.sockets).toEqual(initial.sockets);
  expect(requests).toHaveLength(2);
});

test('mock touch activation, drag slop, pointer cancellation, and keyboard selection are bounded', async ({ page }) => {
  await installFanout(page);
  const target = await socketPoint(page, 'Receiver', 'Accept');
  await page.evaluate(({ x, y }) => {
    const host = document.querySelector('.canvas-stage')!;
    const point = { clientX: x, clientY: y, pointerId: 17, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true };
    host.dispatchEvent(new PointerEvent('pointerdown', point));
    window.dispatchEvent(new PointerEvent('pointerup', point));
  }, target);
  await expect.poll(() => page.locator('.canvas-failure').textContent()).toContain('100 action connections selected');

  await page.reload();
  await page.waitForFunction(() => window.Konva?.stages?.[0]?.find('.topology-wire').length === 100);
  const afterReload = await socketPoint(page, 'Receiver', 'Accept');
  const oldLabel = await page.locator('.canvas-failure').textContent();
  await page.evaluate(({ x, y }) => {
    const host = document.querySelector('.canvas-stage')!;
    const down = { clientX: x, clientY: y, pointerId: 21, pointerType: 'touch', isPrimary: true, button: 0, bubbles: true };
    host.dispatchEvent(new PointerEvent('pointerdown', down));
    window.dispatchEvent(new PointerEvent('pointermove', { ...down, clientX: x + 18 }));
    window.dispatchEvent(new PointerEvent('pointercancel', down));
    window.dispatchEvent(new PointerEvent('pointerup', down));
  }, afterReload);
  expect(await page.locator('.canvas-failure').textContent()).toBe(oldLabel);

  await page.locator('.canvas-stage').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('.canvas-stage').getAttribute('aria-label')).toMatch(/Publisher|Receiver/);
  await page.keyboard.press('p');
  await expect(page.locator('.canvas-binding-chooser')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.canvas-binding-chooser')).toBeHidden();
});

test('native touch socket drift selects without dragging; deliberate movement still drags the card', async ({ page }) => {
  await installFanout(page);
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const target = await socketPoint(page, receiver, 'Accept');
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', dx = 0, dy = 0, origin = target) => client.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ id: 1, x: origin.x + dx, y: origin.y + dy }]
  });
  const moved = (before: Awaited<ReturnType<typeof sceneState>>['positions'], after: typeof before) =>
    after.filter((position, index) => position[1] !== before[index]?.[1] || position[2] !== before[index]?.[2]).map(([id]) => id);
  const status = page.locator('.canvas-failure');
  const before = (await sceneState(page)).positions;

  await touch('touchStart');
  await touch('touchMove', 0, 4);
  await touch('touchEnd');
  await expect(status).toContainText('100 action connections selected');
  expect((await sceneState(page)).positions).toEqual(before);

  await page.keyboard.press('Escape');
  await touch('touchStart');
  await touch('touchMove', 24, 16);
  await touch('touchEnd');
  const dragged = (await sceneState(page)).positions;
  expect(moved(before, dragged)).toEqual([target.cardId]);
  await expect(status).not.toContainText('100 action connections selected');

  const movedSocket = await socketPoint(page, receiver, 'Accept');
  const body = { ...movedSocket, x: movedSocket.x + 25 };
  await touch('touchStart', 0, 0, body);
  await touch('touchMove', 0, 4, body);
  await touch('touchEnd');
  expect(moved(dragged, (await sceneState(page)).positions)).toEqual([target.cardId]);
});

test('native mouse socket drift and drag honor slop, and exact wires name hidden endpoints', async ({ page }) => {
  await installFanout(page);
  const target = await socketPoint(page, receiver, 'Accept');
  const before = (await sceneState(page)).positions;
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y + 4);
  await page.mouse.up();
  const status = page.locator('.canvas-failure');
  await expect(status).toContainText('100 action connections selected');
  expect((await sceneState(page)).positions).toEqual(before);

  await page.keyboard.press('Escape');
  await frame(page);
  const wire = await hitWirePoint(page, ['Publisher', receiver], true);
  const visibleNames = await page.evaluate(() => window.Konva!.stages[0]!.find('Circle').filter(socket => socket.name().startsWith('socket-')).map(socket => socket.getAttr('accessibleDescription')));
  await page.mouse.click(wire.x, wire.y);
  await expect(status).toContainText('Action call selected: Publisher,');
  const match = /Action call selected: Publisher, (.*?) to Receiver, Accept/.exec((await status.textContent()) ?? '');
  expect(aliases).toContain(match?.[1]);
  expect(visibleNames).not.toContain(match?.[1]);

  await page.keyboard.press('Escape');
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 24, target.y + 16);
  await page.mouse.up();
  expect((await sceneState(page)).positions).not.toEqual(before);
  await expect(status).not.toContainText('100 action connections selected');
});

test('touch users can open existing details on a card with bindings and no overflow', async ({ page }) => {
  await installFanout(page);
  const target = await socketPoint(page, receiver, 'Accept');
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: target.x + 28, y: target.y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const control = page.getByRole('button', { name: 'Receiver: Ports and bindings', exact: true });
  await expect(control).toBeVisible();
  await control.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Connection details' })).toBeVisible();
  await expect(dialog.locator('[data-binding-id]')).toHaveCount(8);
});

test('stationary native mouse and touch socket taps repaint without hit rebuilds, then remain idle', async ({ page }, testInfo) => {
  await installFanout(page);
  const target = await socketPoint(page, receiver, 'Accept');
  const status = page.locator('.canvas-failure');
  const client = await page.context().newCDPSession(page);
  const monitor = await page.evaluateHandle(() => {
    const counts: Record<string, { scene: number; hit: number }> = {};
    let timing: { down?: number; up?: number; scene?: number; afterPaint?: number } = {};
    for (const name of ['pointerdown', 'pointerup'] as const) window.addEventListener(name, (evt) => {
      if (evt.isTrusted) timing[name === 'pointerdown' ? 'down' : 'up'] = evt.timeStamp;
    }, true);
    for (const layer of window.Konva!.stages[0]!.getLayers()) {
      const count = counts[layer.name()] = { scene: 0, hit: 0 };
      const originalHit = layer.drawHit;
      layer.drawHit = function (...args: Parameters<typeof originalHit>) {
        count.hit++;
        return originalHit.apply(this, args);
      };
      layer.on('draw.socketTiming', () => {
        count.scene++;
        if (timing.up === undefined || timing.scene !== undefined || !Object.values(counts).every(layer => layer.scene)) return;
        const sample = timing;
        sample.scene = performance.now();
        // Next animation-frame callback follows the rendering opportunity that
        // submitted these canvas draws. It is not a hardware scanout timestamp.
        requestAnimationFrame(() => { sample.afterPaint = performance.now(); });
      });
    }
    return (reset = false) => {
      if (reset) {
        timing = {};
        Object.values(counts).forEach(count => { count.scene = count.hit = 0; });
      }
      return { counts, timing };
    };
  });
  const samples = [];
  for (const pointer of ['mouse', 'touch'] as const) {
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: pointer === 'touch' });
    if (pointer === 'mouse') await page.mouse.move(target.x, target.y);
    for (let sample = 0; sample < 5; sample++) {
      await page.keyboard.press('Escape');
      await frame(page);
      const before = (await sceneState(page)).positions;
      await monitor.evaluate(read => read(true));
      if (pointer === 'touch') {
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: target.x, y: target.y }] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else await page.mouse.click(target.x, target.y);
      await expect(status).toHaveText('Accept, 100 action connections selected.');
      await frame(page);
      const { counts, timing } = await monitor.evaluate(read => read());
      expect(counts).toEqual({ wires: { scene: 1, hit: 0 }, cards: { scene: 1, hit: 0 } });
      expect(timing).toMatchObject({ down: expect.any(Number), up: expect.any(Number), scene: expect.any(Number), afterPaint: expect.any(Number) });
      expect((await sceneState(page)).positions).toEqual(before);
      samples.push({ pointer, downToAfterPaintMs: timing.afterPaint! - timing.down!, releaseToAfterPaintMs: timing.afterPaint! - timing.up!, releaseToSceneMs: timing.scene! - timing.up! });
      if (sample === 4) {
        await page.waitForTimeout(250);
        expect((await monitor.evaluate(read => read())).counts).toEqual(counts);
      }
    }
  }
  const evidence = JSON.stringify(samples, null, 2);
  await testInfo.attach('100-wire native input-to-paint samples', { body: evidence, contentType: 'application/json' });
  console.log(evidence);
});

test('incident socket updates are distinct from scene repaint and do not rebuild native hit layers', async ({ page }) => {
  await installFanout(page);
  const diagram = page.locator('.canvas-stage');
  await diagram.focus();
  if (!(await diagram.getAttribute('aria-label'))?.startsWith('Receiver.')) await page.keyboard.press('ArrowRight');
  await page.keyboard.press(']');
  await expect(diagram).toHaveAttribute('aria-label', /Port: Accept\./);
  await frame(page);

  const measure = await page.evaluateHandle(() => {
    const stage = window.Konva!.stages[0]!;
    const counts: Record<string, { scene: number; hit: number }> = {};
    const changed = new Set<object>();
    let writes = 0;
    for (const layer of stage.getLayers()) {
      const count = counts[layer.name()] = { scene: 0, hit: 0 };
      layer.on('draw.selectionCost', () => count.scene++);
      const original = layer.drawHit;
      layer.drawHit = function (...args: Parameters<typeof original>) {
        count.hit++;
        return original.apply(this, args);
      };
    }
    const wires = stage.find('.topology-wire');
    const sockets = stage.find('Circle').filter((socket) => /^(socket-|overflow-takeoff-)/.test(socket.name()));
    for (const shape of [...sockets, ...wires]) {
      const attrs = shape.getAttrs();
      let value: unknown = attrs.connectionSelected;
      Object.defineProperty(attrs, 'connectionSelected', { configurable: true, get: () => value, set: (next: unknown) => {
        writes++;
        changed.add(shape);
        value = next;
      } });
    }
    return () => ({ counts, updatedShapes: changed.size, writes, selected: sockets.filter(socket => socket.getAttr('connectionSelected')).length });
  });
  await page.keyboard.press('Space');
  await expect(page.locator('.canvas-failure')).toContainText('100 action connections selected');
  await frame(page);
  const selected = await measure.evaluate(read => read());
  expect(selected.selected).toBeGreaterThan(1);
  expect(selected.selected).toBeLessThan(100); // shared socket and takeoff; do not mutate one shape per binding
  expect(selected.updatedShapes).toBe(selected.selected);
  expect(selected.writes).toBe(selected.selected);
  expect(selected.counts).toEqual({ wires: { scene: 1, hit: 0 }, cards: { scene: 1, hit: 0 } });
  await page.keyboard.press('Space');
  await frame(page);
  expect(await measure.evaluate(read => read())).toEqual(selected);

  // This is a real hit-geometry change; it still takes the normal full draw.
  await page.locator('[data-view="zoom-in"]').click();
  await frame(page);
  const zoomed = await measure.evaluate(read => read());
  expect(zoomed.counts).toEqual({ wires: { scene: 2, hit: 1 }, cards: { scene: 2, hit: 1 } });
  expect(zoomed.writes).toBe(selected.writes);
});
