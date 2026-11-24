import { expect, test, type Page } from '@playwright/test';

type SceneCard = { title: string; x: number; y: number };
type SceneBounds = { left: number; right: number; top: number; bottom: number };
type MeasuredCard = SceneCard & { bounds: SceneBounds };
type SceneState = {
  scale: number;
  camera: { x: number; y: number };
  viewport: { width: number; height: number };
  card: MeasuredCard;
  rightCards: MeasuredCard[];
  rightCount: number;
};

async function snapshot(page: Page, title: string): Promise<SceneState> {
  return page.evaluate((cardTitle) => {
    type Shape = {
      find(selector: string): Shape[];
      text(): string;
      x(): number;
      y(): number;
      scaleX(): number;
      scaleY(): number;
      width(): number;
      height(): number;
    };
    const stages = (window as Window & { Konva?: { stages?: Shape[] } }).Konva?.stages;
    const stage = stages?.[0];
    if (!stage) throw new Error('Konva stage was not mounted');
    const cards = stage.find('.topology-card').map((node) => {
      const label = node.find('Text').find((text) => text.text() && text.y() <= 28 && !['Local', 'Remote'].includes(text.text()));
      const rect = node.find('Rect').find((shape) => shape.width() > 100);
      if (!label || !rect) return undefined;
      const x = node.x() + rect.x();
      const y = node.y() + rect.y();
      const bounds = {
        left: stage.x() + x * stage.scaleX(), right: stage.x() + (x + rect.width()) * stage.scaleX(),
        top: stage.y() + y * stage.scaleY(), bottom: stage.y() + (y + rect.height()) * stage.scaleY()
      };
      return { title: label.text(), x, y, bounds };
    }).filter((candidate): candidate is MeasuredCard => Boolean(candidate));
    const card = cards.find((candidate) => candidate.title === cardTitle);
    if (!card) throw new Error(`Card ${cardTitle} was not found`);
    const rightCards = cards.filter((candidate) => candidate.bounds.left >= stage.width())
      .sort((a, b) => a.bounds.left - b.bounds.left || a.title.localeCompare(b.title));
    const count = document.querySelector<HTMLButtonElement>('.edge-navigation-right .edge-navigation-count')?.textContent ?? '0';
    return { scale: stage.scaleX(), camera: { x: stage.x(), y: stage.y() }, viewport: { width: stage.width(), height: stage.height() }, card, rightCards, rightCount: Number(count) || 0 };
  }, title);
}

async function physicallyDropOffscreenAndCheck(page: Page, title: string): Promise<void> {
  const before = await snapshot(page, title);
  const point = await page.evaluate((cardTitle) => {
    type Shape = {
      find(selector: string): Shape[];
      text(): string;
      getAbsolutePosition(top?: Shape): { x: number; y: number };
      width(): number;
    };
    type Stage = Shape & { x(): number; y(): number; scaleX(): number; scaleY(): number; getContent(): HTMLElement };
    const stage = (window as Window & { Konva?: { stages?: Stage[] } }).Konva?.stages?.[0];
    if (!stage) throw new Error('Konva stage was not mounted');
    const node = stage.find('.topology-card').find((candidate) => candidate.find('Text').some((text) => text.text() === cardTitle));
    if (!node) throw new Error(`Card ${cardTitle} was not found`);
    const background = node.find('Rect').find((rect) => rect.width() > 100);
    if (!background) throw new Error(`Card background for ${cardTitle} was not found`);
    const position = node.getAbsolutePosition(stage);
    const bounds = stage.getContent().getBoundingClientRect();
    return {
      x: bounds.left + stage.x() + (position.x + Math.min(70, background.width() / 2)) * stage.scaleX(),
      y: bounds.top + stage.y() + (position.y + 48) * stage.scaleY()
    };
  }, title);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 1500, point.y, { steps: 10 });
  await page.mouse.up();

  const button = page.locator('.edge-navigation-right');
  const afterDrop = await snapshot(page, title);
  expect(afterDrop.card.bounds.left).toBeGreaterThanOrEqual(afterDrop.viewport.width);
  expect(afterDrop.rightCards[0]?.title).toBe(title);
  await expect(button, JSON.stringify({ cardBounds: afterDrop.card.bounds, viewport: afterDrop.viewport,
    rightCards: afterDrop.rightCards.map(({ title: name }) => name) })).toBeVisible();
  expect(afterDrop.rightCount).toBe(afterDrop.rightCards.length);
  await expect(button.locator('.edge-navigation-count')).toHaveText(String(before.rightCount + 1));
  expect(afterDrop.card.x).toBeGreaterThan(before.card.x + 1000);
  expect(afterDrop.scale).toBe(before.scale);
  expect(afterDrop.viewport).toEqual(before.viewport);
  expect(afterDrop.camera).toEqual(before.camera);

  await button.click();
  await expect(button).toBeHidden();
  const navigated = await snapshot(page, title);
  expect(navigated.scale).toBe(before.scale);
  expect(Math.abs((navigated.card.bounds.left + navigated.card.bounds.right) / 2 - navigated.viewport.width / 2)).toBeLessThan(2);
  expect(Math.abs((navigated.card.bounds.top + navigated.card.bounds.bottom) / 2 - navigated.viewport.height / 2)).toBeLessThan(2);
}

test('synthetic card dragend refreshes edge navigation after dragmove has already synchronized the node', async ({ page }) => {
  await page.goto('/topology-canvas.html?nodes=9');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  await physicallyDropOffscreenAndCheck(page, 'Schedule');
});

test('local/real card dragend refreshes edge navigation without changing zoom', async ({ page }) => {
  await page.route('**/REST', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: { DragFixture: {} } }) }));
  await page.route('**/REST/nodeURLs', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/nodes/DragFixture/REST/remote', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/topology-canvas.html?source=local');
  await expect(page.locator('[data-fixture-summary]')).toContainText('1 complete');
  await expect(page.locator('.canvas-stage canvas')).toHaveCount(2);
  // Discovery can complete before the painted startup controls collapse. Let
  // ResizeObserver apply that viewport change before measuring a card drag.
  await expect(page.locator('[data-topology-scrim]')).toBeHidden();
  await expect(page.locator('[data-fixture-summary]')).toContainText('scheduler settled');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await physicallyDropOffscreenAndCheck(page, 'DragFixture');
});
