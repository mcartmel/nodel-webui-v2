// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyCard, classifyCards, EdgeNavigation, type CardBounds, type EdgeNavigationCamera } from '../src/experiments/konva-canvas/edge-navigation';

const camera: EdgeNavigationCamera = { width: 100, height: 100, x: 0, y: 0, scale: 1 };
const card = (id: string, x: number, y: number, width = 10, height = 10): CardBounds => ({ id, x, y, width, height });

describe('edge navigation card classification', () => {
  it('ignores partial intersections and classifies wholly outside cards once', () => {
    expect(classifyCard(card('partial', -5, 20), camera)).toBeUndefined();
    expect(classifyCard(card('inside', 10, 10), camera)).toBeUndefined();
    expect(classifyCard(card('left', -30, 20), camera)?.direction).toBe('left');
    expect(classifyCard(card('right', 100, 20), camera)?.direction).toBe('right');
    expect(classifyCard(card('above', 20, -10), camera)?.direction).toBe('up');
    expect(classifyCard(card('below', 20, 100), camera)?.direction).toBe('down');
  });

  it('uses normalized corner separation and horizontal fixed tie-break', () => {
    expect(classifyCard(card('corner', 120, 120), camera)?.direction).toBe('right');
    expect(classifyCard(card('vertical', 120, 130), camera)?.direction).toBe('down');
    expect(classifyCard(card('scaled', -15, 0), { ...camera, x: 0, scale: 2 })?.direction).toBe('left');
    expect(classifyCard(card('invalid', 200, 0), { ...camera, width: 0 })).toBeUndefined();
  });

  it('counts distinct cards by direction and orders nearest ties by stable ID', () => {
    const result = classifyCards([card('b', 120, 20), card('a', 120, 20), card('far', 160, 20), card('partial', -5, 20)], camera);
    expect(result.get('right')?.map(entry => entry.card.id)).toEqual(['a', 'b', 'far']);
    expect([...result.values()].reduce((sum, entries) => sum + entries.length, 0)).toBe(3);
  });
});

describe('edge navigation DOM controls', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it('renders only arrow and count, exposes tooltip/accessibility, navigates nearest at unchanged scale and cleans up', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    const container = document.createElement('section');
    document.body.append(container);
    let cards = [card('far', 200, 20), card('near', 120, 30)];
    const navigate = vi.fn();
    const nav = new EdgeNavigation({ container, cards: () => cards, navigate, focusFallback: () => container });
    nav.markGeometryDirty();
    nav.updateViewport(camera);
    vi.advanceTimersByTime(20);

    const button = container.querySelector<HTMLButtonElement>('.edge-navigation-right')!;
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('→2');
    expect(button.querySelector('[aria-hidden="true"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('2 cards to the right; go to nearest');
    expect(button.title).toBe(button.getAttribute('aria-label'));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(navigate).toHaveBeenCalledWith({ x: 125, y: 35 }, 1);

    cards = [card('left', -30, 20)];
    nav.markGeometryDirty();
    vi.advanceTimersByTime(20);
    expect(button.hidden).toBe(true);
    expect(container.querySelector('.edge-navigation-left')?.getAttribute('aria-label')).toBe('1 card to the left; go to nearest');
    nav.dispose();
    expect(container.querySelector('.edge-navigation')).toBeNull();
  });

  it('has no DOM listeners or controls when disabled', () => {
    const container = document.createElement('div');
    const nav = new EdgeNavigation({ container, enabled: false, cards: () => [], navigate: vi.fn(), focusFallback: () => container });
    nav.updateViewport(camera);
    nav.markGeometryDirty();
    expect(container.childElementCount).toBe(0);
    nav.dispose();
  });

  it('uses cached card rectangles during camera gestures, throttles scans, and applies the final position', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    const container = document.createElement('section');
    document.body.append(container);
    const cards = vi.fn(() => [card('near-right-edge', 105, 30)]);
    const nav = new EdgeNavigation({ container, cards, navigate: vi.fn(), focusFallback: () => container });
    nav.markGeometryDirty();
    nav.updateViewport(camera);
    vi.advanceTimersByTime(20);
    const right = container.querySelector<HTMLButtonElement>('.edge-navigation-right')!;
    expect(right.hidden).toBe(false);
    expect(cards).toHaveBeenCalledTimes(1);

    nav.updateDuringCameraGesture({ ...camera, x: -20 });
    vi.advanceTimersByTime(100);
    expect(right.hidden).toBe(true);
    expect(cards).toHaveBeenCalledTimes(1);
    nav.updateDuringCameraGesture(camera);
    nav.setCameraMoving(false);
    expect(right.hidden).toBe(false);
    expect(cards).toHaveBeenCalledTimes(1);
    nav.updateDuringCameraGesture({ ...camera, x: -5 });
    nav.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns focus without scrolling only when a focused arrow is hidden', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    const container = document.createElement('section');
    const fallback = document.createElement('div');
    fallback.tabIndex = -1;
    const unrelated = document.createElement('button');
    unrelated.textContent = 'Keep focus';
    document.body.append(container, fallback, unrelated);
    let cards = [card('right', 120, 20), card('left', -30, 20)];
    const nav = new EdgeNavigation({ container, cards: () => cards, navigate: vi.fn(), focusFallback: () => fallback });
    nav.markGeometryDirty();
    nav.updateViewport(camera);
    vi.advanceTimersByTime(20);

    const focusSpy = vi.spyOn(fallback, 'focus');
    const right = container.querySelector<HTMLButtonElement>('.edge-navigation-right')!;
    right.focus();
    expect(document.activeElement).toBe(right);
    cards = [card('left', -30, 20)];
    nav.markGeometryDirty();
    vi.advanceTimersByTime(20);
    expect(right.hidden).toBe(true);
    expect(document.activeElement).toBe(fallback);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });

    focusSpy.mockClear();
    unrelated.focus();
    cards = [card('right-again', 120, 20), card('left', -30, 20)];
    nav.markGeometryDirty();
    vi.advanceTimersByTime(20);
    expect(document.activeElement).toBe(unrelated);
    cards = [card('left', -30, 20)];
    nav.markGeometryDirty();
    vi.advanceTimersByTime(20);
    expect(document.activeElement).toBe(unrelated);
    expect(focusSpy).not.toHaveBeenCalled();
    nav.dispose();
  });
});
