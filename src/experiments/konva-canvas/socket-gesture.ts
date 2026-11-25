import { sameSocket, type SocketId } from './camera-selection';
import { PORT_ROW_HEIGHT, type Point } from './fixture';

/** Small socket-only disk; never reaches the adjacent row, even when zoomed out. */
export const socketHitRadius = (scale: number): number => Math.min(PORT_ROW_HEIGHT / 2 - 3, Math.max(6, 7 / scale));

export function hitsSocket(point: Point, center: Point, radius: number): boolean {
  return (point.x - center.x) ** 2 + (point.y - center.y) ** 2 <= radius ** 2;
}

interface SocketHit<Slot> extends SocketId { slot: Slot }
type Press = Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY' | 'pointerType'>;

export class SocketGesture<Slot> {
  private armed: { pointer: Press; hit: SocketHit<Slot> } | undefined;
  // Konva also emits a mouse click or touch tap for this press. Keep ownership
  // until a new primary press even if a drag/rebind/cancel invalidates the tap.
  ownsClick = false;

  get isArmed(): boolean { return !!this.armed; }

  begin(pointer: Press, hit?: SocketHit<Slot>): void {
    this.ownsClick = !!hit;
    this.armed = hit && { pointer, hit };
  }

  /** Return the origin exactly once when slop is exceeded, for drag handoff. */
  move(pointer: Press): SocketHit<Slot> | undefined {
    const armed = this.armed;
    const start = armed?.pointer;
    if (!armed || !start || start.pointerId !== pointer.pointerId) return undefined;
    const slop = start.pointerType === 'touch' ? 8 : 5;
    if ((pointer.clientX - start.clientX) ** 2 + (pointer.clientY - start.clientY) ** 2 <= slop ** 2) return undefined;
    this.cancel();
    return armed.hit;
  }

  finish(pointer: Press, hitAtRelease: () => SocketHit<Slot> | undefined): SocketHit<Slot> | undefined {
    this.move(pointer);
    const armed = this.armed;
    if (!armed || armed.pointer.pointerId !== pointer.pointerId) return;
    this.cancel();
    const hit = hitAtRelease();
    return hit && hit.slot === armed.hit.slot && sameSocket(hit, armed.hit) ? hit : undefined;
  }

  cancelSlot(slot: Slot): void {
    if (this.armed?.hit.slot === slot) this.cancel();
  }

  cancel(pointerId?: number): void {
    if (pointerId === undefined || this.armed?.pointer.pointerId === pointerId) this.armed = undefined;
  }
}
