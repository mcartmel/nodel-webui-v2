import type { Point } from './fixture';

export const SESSION_LAYOUT_MAX_BYTES = 512 * 1024;
export const SESSION_LAYOUT_MAX_CARDS = 2048;
export const SESSION_LAYOUT_WORLD_LIMIT = 1_000_000;
export const SESSION_LAYOUT_STORAGE_KEY = 'nodel.topology-canvas.layout.v1';
// A finite inverse transform even for a fit spanning both safe world limits.
export const SESSION_LAYOUT_MIN_SCALE = 1e-6;
const MAX_SCALE = 1.6;
const encoder = new TextEncoder();

export interface SessionCamera {
  readonly cx: number;
  readonly cy: number;
  readonly scale: number;
}

interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface SessionCardPosition extends Point {
  readonly pinned: boolean;
}

export interface SessionLayout {
  readonly cards: Map<string, SessionCardPosition>;
  readonly camera?: SessionCamera;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validCardId(id: unknown): id is string {
  return typeof id === 'string' && (id === 'n-empty' || /^n-(?:[0-9a-f]{4})+$/.test(id));
}

/** Session storage is already origin-scoped; isolate real pages by pathname only. */
export function sessionLayoutStorageKey(pathname: string): string | undefined {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.includes('?') || pathname.includes('#')) return;
  return `${SESSION_LAYOUT_STORAGE_KEY}:${pathname}`;
}

export function isSafeLayoutPoint(x: unknown, y: unknown): boolean {
  return typeof x === 'number' && Math.abs(x) <= SESSION_LAYOUT_WORLD_LIMIT &&
    typeof y === 'number' && Math.abs(y) <= SESSION_LAYOUT_WORLD_LIMIT;
}

function validViewport({ width, height }: Viewport): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

function validCamera({ cx, cy, scale }: SessionCamera): boolean {
  return isSafeLayoutPoint(cx, cy) && typeof scale === 'number' && Number.isFinite(scale) && scale >= SESSION_LAYOUT_MIN_SCALE && scale <= MAX_SCALE;
}

export function decodeSessionLayout(raw: string | null): SessionLayout | undefined {
  if (!raw || raw.length > SESSION_LAYOUT_MAX_BYTES || encoder.encode(raw).length > SESSION_LAYOUT_MAX_BYTES) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }
  if (!record(parsed) || parsed.version !== 1 || !Array.isArray(parsed.cards) || parsed.cards.length > SESSION_LAYOUT_MAX_CARDS) return;
  const cards = new Map<string, SessionCardPosition>();
  for (const row of parsed.cards) {
    if (!Array.isArray(row) || row.length !== 4) continue;
    const [id, x, y, pinned] = row as unknown[];
    if (!validCardId(id) || cards.has(id) || typeof x !== 'number' || typeof y !== 'number' || !isSafeLayoutPoint(x, y) || typeof pinned !== 'boolean') continue;
    cards.set(id, { x, y, pinned });
  }
  const saved = parsed.camera;
  if (record(saved)) {
    const { cx, cy, scale } = saved;
    if (typeof cx === 'number' && typeof cy === 'number' && typeof scale === 'number') {
      const camera = { cx, cy, scale };
      if (validCamera(camera)) return { cards, camera };
    }
  }
  return { cards };
}

/** Manual pins (mounted or pending), then live auto positions, then pending auto positions. */
export function* mergeSessionCardPositions(
  mounted: ReadonlyMap<string, Point>, pinned: ReadonlySet<string>, pending: ReadonlyMap<string, SessionCardPosition> | undefined,
  settledPosition: (id: string, position: Point) => Point
): IterableIterator<readonly [string, SessionCardPosition]> {
  for (const id of pinned) {
    const point = mounted.get(id);
    if (point) {
      const { x, y } = settledPosition(id, point);
      yield [id, { x, y, pinned: true }];
    } else {
      const stale = pending?.get(id);
      if (stale?.pinned) yield [id, stale];
    }
  }
  if (pending) for (const entry of pending) {
    if (!pinned.has(entry[0]) && entry[1].pinned && !mounted.has(entry[0])) yield entry;
  }
  for (const [id, point] of mounted) {
    if (pinned.has(id)) continue;
    const { x, y } = settledPosition(id, point);
    yield [id, { x, y, pinned: false }];
  }
  if (pending) for (const entry of pending) if (!mounted.has(entry[0]) && !entry[1].pinned) yield entry;
}

/** Retire records only when a complete fresh snapshot proves the IDs no longer exist. */
export function retirePendingSessionCards(pending: Map<string, SessionCardPosition>, liveIds: ReadonlySet<string>): number {
  let retired = 0;
  for (const id of pending.keys()) {
    if (liveIds.has(id)) continue;
    pending.delete(id);
    retired += 1;
  }
  return retired;
}

/** Encode only scalar fields in priority order, never serializing the graph or an over-limit snapshot. */
export function encodeSessionLayout(cards: Iterable<readonly [string, SessionCardPosition]>, camera?: SessionCamera): string {
  const prefix = '{"version":1,"cards":[';
  const suffix = camera && validCamera(camera)
    ? `],"camera":${JSON.stringify({ cx: camera.cx, cy: camera.cy, scale: camera.scale })}}` : ']}';
  let remaining = SESSION_LAYOUT_MAX_BYTES - prefix.length - suffix.length;
  const rows: string[] = [];
  const seen = new Set<string>();
  for (const [id, { x, y, pinned }] of cards) {
    if (!validCardId(id) || id.length >= remaining || seen.has(id) || !isSafeLayoutPoint(x, y) || typeof pinned !== 'boolean') continue;
    const row = JSON.stringify([id, x, y, pinned]);
    const bytes = row.length > remaining ? row.length : encoder.encode(row).length;
    const cost = bytes + (rows.length ? 1 : 0);
    if (cost > remaining) continue;
    rows.push(row);
    seen.add(id);
    remaining -= cost;
    if (rows.length >= SESSION_LAYOUT_MAX_CARDS || remaining < 15) break;
  }
  return `${prefix}${rows.join(',')}${suffix}`;
}

export function readSessionLayout(getStorage: () => Pick<Storage, 'getItem'>): SessionLayout | undefined {
  try { return decodeSessionLayout(getStorage().getItem(sessionLayoutStorageKey(window.location.pathname) ?? SESSION_LAYOUT_STORAGE_KEY)); } catch { return undefined; }
}

export function writeSessionLayout(
  getStorage: () => Pick<Storage, 'setItem'>,
  cards: Iterable<readonly [string, SessionCardPosition]>,
  camera?: SessionCamera
): void {
  let key: string;
  try { key = sessionLayoutStorageKey(window.location.pathname) ?? SESSION_LAYOUT_STORAGE_KEY; } catch { key = SESSION_LAYOUT_STORAGE_KEY; }
  try { getStorage().setItem(key, encodeSessionLayout(cards, camera)); } catch { /* Preserve the previous atomic snapshot. */ }
}

export function captureSessionCamera(position: Point, scale: number, viewport: Viewport): SessionCamera | undefined {
  if (!validViewport(viewport)) return;
  if (!Number.isFinite(scale) || scale <= 0) return;
  const camera = { cx: (viewport.width / 2 - position.x) / scale, cy: (viewport.height / 2 - position.y) / scale, scale };
  return validCamera(camera) ? camera : undefined;
}

export function sessionCameraPosition(camera: SessionCamera, viewport: Viewport): Point | undefined {
  if (!validCamera(camera) || !validViewport(viewport)) return;
  return { x: viewport.width / 2 - camera.cx * camera.scale, y: viewport.height / 2 - camera.cy * camera.scale };
}

/** A pagehide flush consumes the pending write; a cache hit can later schedule a new one. */
export class SessionLayoutWriter {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private maxTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private discovering = false;
  private dirty = false;
  private gestureActive = false;

  constructor(private readonly save: () => void, private readonly delay = 350, private readonly maxWait = 1_000) {}

  schedule(): void {
    if (this.disposed) return;
    this.dirty = true;
    if (this.gestureActive) return;
    if (this.maxTimer === undefined) this.maxTimer = setTimeout(() => this.flush(), this.maxWait);
    if (this.discovering) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  setDiscovering(discovering: boolean): void {
    if (this.disposed || this.discovering === discovering) return;
    this.discovering = discovering;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.dirty) this.schedule();
  }

  setGestureActive(active: boolean): void {
    this.gestureActive = active;
    if (active) this.cancelTimers();
    else if (this.dirty) this.schedule();
  }

  flush(): void {
    if (!this.dirty || this.gestureActive) return;
    this.cancel();
    this.save();
  }

  cancel(): void {
    this.dirty = false;
    this.cancelTimers();
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
  }

  private cancelTimers(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.maxTimer !== undefined) clearTimeout(this.maxTimer);
    this.maxTimer = undefined;
  }

}
