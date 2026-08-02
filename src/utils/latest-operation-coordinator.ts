export interface LatestOperationTicket<K extends string> {
  readonly key: K;
  readonly generation: number;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  finish(): void;
}

interface OperationSlot {
  controller: AbortController | null;
  generation: number;
  detachParent: (() => void) | null;
}

export class LatestOperationCoordinator<K extends string> {
  private slots = new Map<K, OperationSlot>();

  begin(key: K, parentSignal?: AbortSignal): LatestOperationTicket<K> {
    const slot = this.slots.get(key) ?? { controller: null, generation: 0, detachParent: null };
    this.slots.set(key, slot);
    slot.controller?.abort();
    slot.detachParent?.();
    slot.controller = null;
    slot.detachParent = null;

    const controller = new AbortController();
    const generation = ++slot.generation;
    let finished = false;
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    const detachParent = () => parentSignal?.removeEventListener('abort', abortFromParent);
    slot.controller = controller;
    slot.detachParent = detachParent;

    if (parentSignal?.aborted) {
      abortFromParent();
    } else {
      parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    }

    const isCurrent = () => slot.generation === generation
      && slot.controller === controller
      && !controller.signal.aborted;
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      detachParent();
      if (slot.generation === generation && slot.controller === controller) {
        slot.controller = null;
        slot.detachParent = null;
      }
    };

    return { key, generation, signal: controller.signal, isCurrent, finish };
  }

  invalidate(key: K) {
    const slot = this.slots.get(key);
    if (!slot) {
      return;
    }
    slot.generation += 1;
    slot.controller?.abort();
    slot.detachParent?.();
    slot.controller = null;
    slot.detachParent = null;
  }

  invalidateAll() {
    for (const key of this.slots.keys()) {
      this.invalidate(key);
    }
  }

  isActive(key: K) {
    return Boolean(this.slots.get(key)?.controller);
  }
}
