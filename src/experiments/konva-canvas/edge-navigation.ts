export type EdgeDirection = 'left' | 'right' | 'up' | 'down';

export interface CardBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeNavigationCamera {
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
}

export interface OffscreenCard {
  card: CardBounds;
  direction: EdgeDirection;
  distance: number;
}

const DIRECTIONS: readonly EdgeDirection[] = ['left', 'right', 'up', 'down'];
const ARROWS: Readonly<Record<EdgeDirection, string>> = { left: '←', right: '→', up: '↑', down: '↓' };

/** Assign a wholly offscreen card to one nearest edge. Normalized corner ties prefer horizontal. */
export function classifyCard(card: CardBounds, camera: EdgeNavigationCamera): OffscreenCard | undefined {
  const left = camera.x + card.x * camera.scale;
  const top = camera.y + card.y * camera.scale;
  const right = left + card.width * camera.scale;
  const bottom = top + card.height * camera.scale;
  const { width, height } = camera;
  if (!(width > 0 && height > 0) || !(camera.scale > 0)) return;
  if (right > 0 && left < width && bottom > 0 && top < height) return;

  const horizontal = right <= 0 ? { direction: 'left' as const, gap: -right } : left >= width ? { direction: 'right' as const, gap: left - width } : undefined;
  const vertical = bottom <= 0 ? { direction: 'up' as const, gap: -bottom } : top >= height ? { direction: 'down' as const, gap: top - height } : undefined;
  const distance = Math.hypot(horizontal?.gap ?? 0, vertical?.gap ?? 0);
  if (!horizontal) {
    if (!vertical) return;
    return { card, direction: vertical.direction, distance };
  }
  if (!vertical) return { card, direction: horizontal.direction, distance };
  // On a corner, use the more separated axis relative to its viewport extent.
  return horizontal.gap / width >= vertical.gap / height
    ? { card, direction: horizontal.direction, distance }
    : { card, direction: vertical.direction, distance };
}

export function classifyCards(cards: Iterable<CardBounds>, camera: EdgeNavigationCamera): Map<EdgeDirection, OffscreenCard[]> {
  const grouped = new Map<EdgeDirection, OffscreenCard[]>(DIRECTIONS.map(direction => [direction, []]));
  for (const card of cards) {
    const result = classifyCard(card, camera);
    if (result) grouped.get(result.direction)!.push(result);
  }
  for (const cardsInDirection of grouped.values()) cardsInDirection.sort((a, b) => a.distance - b.distance || (a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0));
  return grouped;
}

export interface EdgeNavigationOptions {
  container: HTMLElement;
  cards: () => Iterable<CardBounds>;
  navigate: (center: { x: number; y: number }, scale: number) => void;
  focusFallback: () => HTMLElement;
  enabled?: boolean;
}

/** DOM edge controls backed by cached card geometry. Geometry is rebuilt only when explicitly dirtied. */
export class EdgeNavigation {
  private readonly buttons = new Map<EdgeDirection, HTMLButtonElement>();
  private readonly cardCache = new Map<string, CardBounds>();
  private geometryDirty = true;
  private camera: EdgeNavigationCamera = { width: 0, height: 0, x: 0, y: 0, scale: 1 };
  private scanFrame: number | undefined;
  private movingTimer: ReturnType<typeof setInterval> | undefined;
  private gestureEndTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly options: EdgeNavigationOptions) {
    if (options.enabled === false) return;
    const controls = document.createElement('div');
    controls.className = 'edge-navigation';
    controls.setAttribute('aria-label', 'Offscreen card navigation');
    for (const direction of DIRECTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `edge-navigation-button edge-navigation-${direction}`;
      button.hidden = true;
      button.setAttribute('aria-label', '');
      button.title = '';
      const arrow = document.createElement('span');
      arrow.className = 'edge-navigation-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = ARROWS[direction];
      const count = document.createElement('span');
      count.className = 'edge-navigation-count';
      count.setAttribute('aria-hidden', 'true');
      button.append(arrow, count);
      button.addEventListener('pointerdown', event => { event.stopPropagation(); });
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const nearest = classifyCards(this.cardCache.values(), this.camera).get(direction)?.[0];
        if (!nearest || !this.camera.width || !this.camera.height) return;
        this.options.navigate({ x: nearest.card.x + nearest.card.width / 2, y: nearest.card.y + nearest.card.height / 2 }, this.camera.scale);
      });
      controls.append(button);
      this.buttons.set(direction, button);
    }
    options.container.append(controls);
  }

  updateViewport(camera: EdgeNavigationCamera): void {
    if (this.disposed) return;
    this.camera = camera;
    this.scheduleScan();
  }

  updateDuringCameraGesture(camera: EdgeNavigationCamera): void {
    if (this.disposed) return;
    this.camera = camera;
    this.setCameraMoving(true);
    if (this.gestureEndTimer !== undefined) clearTimeout(this.gestureEndTimer);
    this.gestureEndTimer = setTimeout(() => {
      this.gestureEndTimer = undefined;
      this.setCameraMoving(false);
    }, 140);
  }

  /** Call for card membership or geometry changes, never for port-window scrolling. */
  markGeometryDirty(): void {
    if (this.disposed || !this.buttons.size) return;
    this.geometryDirty = true;
    this.scheduleScan();
  }

  setCameraMoving(moving: boolean): void {
    if (this.disposed || !this.buttons.size) return;
    if (moving) {
      if (this.scanFrame !== undefined) cancelAnimationFrame(this.scanFrame);
      this.scanFrame = undefined;
      if (this.movingTimer === undefined) this.movingTimer = setInterval(() => this.scan(), 100);
      return;
    }
    if (this.movingTimer !== undefined) clearInterval(this.movingTimer);
    if (this.gestureEndTimer !== undefined) clearTimeout(this.gestureEndTimer);
    this.movingTimer = undefined;
    this.gestureEndTimer = undefined;
    this.scan();
  }

  dispose(): void {
    this.disposed = true;
    if (this.scanFrame !== undefined) cancelAnimationFrame(this.scanFrame);
    if (this.movingTimer !== undefined) clearInterval(this.movingTimer);
    if (this.gestureEndTimer !== undefined) clearTimeout(this.gestureEndTimer);
    this.scanFrame = undefined;
    this.movingTimer = undefined;
    this.gestureEndTimer = undefined;
    this.buttons.clear();
    this.cardCache.clear();
    this.geometryDirty = false;
    this.options.container.querySelector('.edge-navigation')?.remove();
  }

  private scheduleScan(): void {
    if (this.scanFrame !== undefined || !this.buttons.size) return;
    this.scanFrame = requestAnimationFrame(() => {
      this.scanFrame = undefined;
      this.scan();
    });
  }

  private scan(): void {
    if (this.disposed || !this.buttons.size) return;
    if (this.geometryDirty) {
      this.cardCache.clear();
      for (const card of this.options.cards()) this.cardCache.set(card.id, { ...card });
      this.geometryDirty = false;
    }
    const grouped = classifyCards(this.cardCache.values(), this.camera);
    for (const direction of DIRECTIONS) {
      const button = this.buttons.get(direction)!;
      const matches = grouped.get(direction)!;
      const count = matches.length;
      const hidden = count === 0;
      if (button.hidden !== hidden) {
        if (hidden && document.activeElement === button) this.options.focusFallback().focus({ preventScroll: true });
        button.hidden = hidden;
      }
      if (!count) continue;
      const location = direction === 'left' || direction === 'right' ? `to the ${direction}` : direction === 'up' ? 'above' : 'below';
      const tooltip = `${count} ${count === 1 ? 'card' : 'cards'} ${location}; go to nearest`;
      if (button.getAttribute('aria-label') !== tooltip) button.setAttribute('aria-label', tooltip);
      if (button.title !== tooltip) button.title = tooltip;
      const countLabel = button.querySelector('.edge-navigation-count')!;
      if (countLabel.textContent !== String(count)) countLabel.textContent = String(count);
    }
  }
}
