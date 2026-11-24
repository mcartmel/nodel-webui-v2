import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardHeight, type FixtureNode } from '../src/experiments/konva-canvas/fixture';
import { restoreInitialLocalCards, restoreLateLocalCard } from '../src/experiments/konva-canvas/local-placement';
import {
  captureSessionCamera, decodeSessionLayout, encodeSessionLayout, mergeSessionCardPositions, readSessionLayout, retirePendingSessionCards, sessionCameraPosition,
  sessionLayoutStorageKey,
  SESSION_LAYOUT_MAX_BYTES, SESSION_LAYOUT_MAX_CARDS, SESSION_LAYOUT_STORAGE_KEY, SESSION_LAYOUT_WORLD_LIMIT,
  SessionLayoutWriter, writeSessionLayout, type SessionCardPosition
} from '../src/experiments/konva-canvas/session-layout';

const camera = { cx: -135.25, cy: 229.625, scale: 0.75 };
const saved = (x: number, y: number, pinned = false): SessionCardPosition => ({ x, y, pinned });
const layoutId = (value: string): string => `n-${Array.from({ length: value.length }, (_, i) => value.charCodeAt(i).toString(16).padStart(4, '0')).join('')}`;
const card = (id: string, x: number, y: number): FixtureNode => ({ id, name: id, x, y, width: 218, ports: [] });
const overlaps = (a: FixtureNode, b: FixtureNode) => a.x < b.x + b.width && b.x < a.x + a.width &&
  a.y < b.y + cardHeight(b) && b.y < a.y + cardHeight(a);

describe('Konva session layout codec', () => {
  it('round-trips only card coordinates, pins, and the camera', () => {
    const cards = new Map([['n-03b1', saved(-270.5, 840, true)], ['n-005f005f00700072006f0074006f005f005f', saved(0, 1)]]);
    const raw = encodeSessionLayout(cards, camera);
    expect(JSON.parse(raw)).toEqual({ version: 1, cards: [['n-03b1', -270.5, 840, true], ['n-005f005f00700072006f0074006f005f005f', 0, 1, false]], camera });
    expect(decodeSessionLayout(raw)).toEqual({ cards, camera });
  });

  it('rejects malformed, non-v1, and over-limit payloads before applying any layout', () => {
    expect(decodeSessionLayout('{broken')).toBeUndefined();
    expect(decodeSessionLayout('null')).toBeUndefined();
    expect(decodeSessionLayout('{"version":2,"cards":[]}')).toBeUndefined();
    expect(decodeSessionLayout('{"version":1,"cards":{}}')).toBeUndefined();
    expect(decodeSessionLayout(`{"version":1,"cards":[],"extra":"${'é'.repeat(SESSION_LAYOUT_MAX_BYTES / 2)}"}`)).toBeUndefined();
    const cards = Array.from({ length: SESSION_LAYOUT_MAX_CARDS + 1 }, (_, i) => [`n-${i}`, 0, 0, false]);
    expect(decodeSessionLayout(JSON.stringify({ version: 1, cards }))).toBeUndefined();
  });

  it('requires canonical projected card IDs and isolates storage by pathname only', () => {
    expect(sessionLayoutStorageKey('/experiments/topology-canvas.html')).toBe(`${SESSION_LAYOUT_STORAGE_KEY}:/experiments/topology-canvas.html`);
    expect(sessionLayoutStorageKey('/canvas?source=local')).toBeUndefined();
    expect(sessionLayoutStorageKey('/canvas#panel')).toBeUndefined();
    expect(decodeSessionLayout(JSON.stringify({ version: 1, cards: [
      ['n-0041', 1, 2, true], ['n-empty', 3, 4, false], ['n-41', 5, 6, false], ['N-0041', 7, 8, false], ['plain-name', 9, 10, true]
    ] }))?.cards).toEqual(new Map([['n-0041', saved(1, 2, true)], ['n-empty', saved(3, 4)]]));
  });

  it('drops unsafe entries without losing valid peers or coercing input', () => {
    const limit = SESSION_LAYOUT_WORLD_LIMIT;
    const input = JSON.stringify({ version: 1, cards: [
      ['', 0, 0, true], [layoutId('out-of-range'), limit + 1, 0, false], [layoutId('coercion'), '1', 0, false],
      [layoutId('wrong-pin'), 0, 1, 0], [layoutId('wrong-length'), 0, 1, true, 'extra'], [layoutId('infinite'), null, 0, false],
      [layoutId('valid'), -limit, limit, true], [layoutId('valid'), 10, 10, false]
    ], camera: { ...camera, scale: 0 } }).replace(`"${layoutId('infinite')}",null`, `"${layoutId('infinite')}",1e500`);
    expect(decodeSessionLayout(input)).toEqual({ cards: new Map([[layoutId('valid'), saved(-limit, limit, true)]]) });
    expect(decodeSessionLayout(JSON.stringify({ version: 1, cards: [], camera: { ...camera, cx: limit + 1 } })))
      .toEqual({ cards: new Map() });
  });

  it('stops reading at the entry cap and bounds output in UTF-8 bytes for canonical IDs', () => {
    let yielded = 0;
    function* manyCards() {
      for (let i = 0; i <= SESSION_LAYOUT_MAX_CARDS; i += 1) {
        yielded += 1;
        yield [`n-${i.toString(16).padStart(4, '0')}`, saved(i, i)] as const;
      }
    }
    expect(decodeSessionLayout(encodeSessionLayout(manyCards(), camera))?.cards.size).toBe(SESSION_LAYOUT_MAX_CARDS);
    expect(yielded).toBe(SESSION_LAYOUT_MAX_CARDS);

    const longCards = new Map<string, SessionCardPosition>([['n-006d0061006e00750061006c', saved(1, 2, true)]]);
    for (let i = 0; i < SESSION_LAYOUT_MAX_CARDS; i += 1) longCards.set(`n-${i.toString(16).padStart(4, '0')}${'abcd'.repeat(250)}`, saved(i, i));
    const tooLarge = `n-${'abcd'.repeat(Math.ceil(SESSION_LAYOUT_MAX_BYTES / 2))}`;
    expect(decodeSessionLayout(encodeSessionLayout([[tooLarge, saved(0, 0)], [layoutId('short'), saved(0, 0)]], camera))?.cards)
      .toEqual(new Map([[layoutId('short'), saved(0, 0)]]));
    const encoded = encodeSessionLayout(longCards, camera);
    const decoded = decodeSessionLayout(encoded)!;
    expect(new TextEncoder().encode(encoded).length).toBeLessThanOrEqual(SESSION_LAYOUT_MAX_BYTES);
    expect(decoded.cards.size).toBeLessThan(SESSION_LAYOUT_MAX_CARDS);
    expect(decoded.cards.get(layoutId('manual'))).toEqual(saved(1, 2, true));
    expect(decoded.camera).toEqual(camera);
  });

  it('fails open when browser storage getters, reads, or writes throw', () => {
    const unavailable = () => { throw new Error('not available'); };
    expect(readSessionLayout(unavailable)).toBeUndefined();
    expect(readSessionLayout(() => ({ getItem: unavailable }))).toBeUndefined();
    expect(() => writeSessionLayout(unavailable, [])).not.toThrow();
    expect(() => writeSessionLayout(() => ({ setItem: unavailable }), [])).not.toThrow();
    const setItem = vi.fn();
    writeSessionLayout(() => ({ setItem }), [], camera);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(`${SESSION_LAYOUT_STORAGE_KEY}:/`, encodeSessionLayout([], camera));
  });

  it('retains the previous bytes when a larger replacement exceeds quota', () => {
    const pinsFirst = [[layoutId('pin'), saved(1, 2, true)], [layoutId('auto'), saved(3, 4)]] as const;
    const previous = encodeSessionLayout([pinsFirst[0]], camera);
    let stored = previous;
    const setItem = vi.fn((_key: string, value: string) => {
      if (value.length > previous.length) throw new DOMException('quota', 'QuotaExceededError');
      stored = value;
    });
    writeSessionLayout(() => ({ setItem }), pinsFirst, camera);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(stored).toBe(previous);
  });

  it('merges late cards into an early save without reviving stale positions or capturing a drag frame', () => {
    const dragging = layoutId('dragging');
    const moved = layoutId('moved');
    const notShown = layoutId('not-shown');
    const mounted = new Map([[dragging, { x: 90, y: 110 }], [moved, { x: -40, y: 80 }]]);
    const pending = new Map([[notShown, saved(600, 500, true)], [moved, saved(0, 0, true)]]);
    const merged = mergeSessionCardPositions(mounted, new Set([dragging]), pending,
      (id, point) => id === dragging ? { x: 10, y: 20 } : point);
    expect([...decodeSessionLayout(encodeSessionLayout(merged))!.cards]).toEqual([
      [dragging, saved(10, 20, true)], [notShown, saved(600, 500, true)], [moved, saved(-40, 80)]
    ]);
  });

  it('keeps all pins ahead of live auto positions and pending autos, then retires stale pending IDs explicitly', () => {
    const pending = new Map([['n-70696e', saved(10, 20, true)], ['n-6c617465', saved(30, 40)], ['n-6f6c64', saved(50, 60)]]);
    const mounted = new Map([['n-6175746f', { x: 1, y: 2 }]]);
    const merged = [...mergeSessionCardPositions(mounted, new Set(), pending, (_id, point) => point)];
    expect(merged.map(([id]) => id)).toEqual(['n-70696e', 'n-6175746f', 'n-6c617465', 'n-6f6c64']);
    expect(retirePendingSessionCards(pending, new Set(['n-70696e', 'n-6c617465']))).toBe(1);
    expect(pending.has('n-6f6c64')).toBe(false);
  });
});

describe('Konva session placement', () => {
  it('restores deliberate pin overlaps, protects accepted cards, and reserves unseen pins', () => {
    const a = card('pin-a', 0, 0);
    const b = card('pin-b', 220, 0);
    const fresh = card('fresh', 600, 100);
    const conflicting = card('conflicting', 0, 350);
    const compatible = card('compatible', 400, 350);
    const cards = [fresh, conflicting, compatible, b, a];
    const pending = new Map([['pin-a', saved(600, 100, true)], ['pin-b', saved(610, 110, true)],
      ['compatible', saved(-400, 400)], ['conflicting', saved(620, 120)], ['late', saved(-800, -900, true)]]);
    const pins = new Set<string>();
    expect(restoreInitialLocalCards(cards, pending, pins)).toBe(true);
    expect(pins).toEqual(new Set(['pin-a', 'pin-b']));
    expect(overlaps(a, b)).toBe(true);
    expect(compatible).toMatchObject({ x: -400, y: 400 });
    expect(overlaps(conflicting, a) || overlaps(conflicting, b)).toBe(false);
    expect(overlaps(fresh, a) || overlaps(fresh, b)).toBe(false);
    expect(pending).toEqual(new Map([['late', saved(-800, -900, true)]]));
  });

  it('uses stable ordering for conflicting saved auto cards and does not disturb a fresh layout', () => {
    const first = card('a', 0, 0);
    const second = card('b', 400, 0);
    expect(restoreInitialLocalCards([second, first], new Map(), new Set())).toBe(false);
    expect([first.x, second.x]).toEqual([0, 400]);
    restoreInitialLocalCards([second, first], new Map([['a', saved(800, 0)], ['b', saved(800, 0)]]), new Set());
    expect(overlaps(first, second)).toBe(false);
  });

  it('restores late pins exactly, while unpinned cards avoid occupied cards', () => {
    const limit = SESSION_LAYOUT_WORLD_LIMIT;
    const mounted = card('mounted', 40, limit);
    const activeOrigin = card('drag-origin', 400, 100);
    const late = card('late', 40, limit);
    const good = card('good', 600, 0);
    const pins = new Set<string>();
    const occupied = [mounted, activeOrigin];
    restoreLateLocalCard(late, saved(420, 100, true), occupied, pins);
    expect(mounted).toMatchObject({ x: 40, y: limit });
    expect(late).toMatchObject({ x: 420, y: 100 });
    expect(pins.has('late')).toBe(true);
    restoreLateLocalCard(good, saved(-700, -20, true), [...occupied, late], pins);
    expect(good).toMatchObject({ x: -700, y: -20 });
    expect(pins.has('good')).toBe(true);
  });
});

describe('Konva session camera and lifetime', () => {
  afterEach(() => vi.useRealTimers());

  it('restores a world centre at the current viewport size, not the old pixel translation', () => {
    const oldViewport = { width: 1366, height: 768 };
    const nextViewport = { width: 780, height: 520 };
    const oldPosition = sessionCameraPosition(camera, oldViewport)!;
    expect(captureSessionCamera(oldPosition, camera.scale, oldViewport)).toEqual(camera);
    const nextPosition = sessionCameraPosition(camera, nextViewport)!;
    expect(nextPosition).toEqual({ x: oldPosition.x - 293, y: oldPosition.y - 124 });
    expect(captureSessionCamera(nextPosition, camera.scale, nextViewport)).toEqual(camera);
    expect(sessionCameraPosition(camera, { width: 0, height: 768 })).toBeUndefined();
    expect(captureSessionCamera(oldPosition, 0, nextViewport)).toBeUndefined();
  });

  it('debounces, flushes once, cancels the timer, and allows scheduling after a BFCache hit', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const writer = new SessionLayoutWriter(save, 350);
    writer.flush();
    expect(save).not.toHaveBeenCalled();
    writer.schedule();
    vi.advanceTimersByTime(200);
    writer.schedule();
    vi.advanceTimersByTime(200);
    expect(save).not.toHaveBeenCalled();
    writer.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    writer.flush();
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(1);
    writer.schedule();
    vi.advanceTimersByTime(350);
    expect(save).toHaveBeenCalledTimes(2);
    writer.schedule();
    writer.cancel();
    vi.advanceTimersByTime(500);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('bounds repeated scheduling by one second and disposes permanently', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const writer = new SessionLayoutWriter(save);
    for (let i = 0; i < 12; i += 1) {
      writer.schedule();
      vi.advanceTimersByTime(100);
    }
    expect(save).toHaveBeenCalledTimes(1);
    writer.schedule();
    writer.dispose();
    writer.schedule();
    vi.advanceTimersByTime(2_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('writes dirty discovery snapshots at a one-second cadence, including sparse edits', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const writer = new SessionLayoutWriter(save);
    writer.setDiscovering(true);
    writer.schedule();
    vi.advanceTimersByTime(999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    writer.schedule();
    vi.advanceTimersByTime(600);
    writer.schedule();
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(400);
    expect(save).toHaveBeenCalledTimes(2);
  });
});
