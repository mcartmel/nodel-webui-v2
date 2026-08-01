export type EditorOperationKind = 'list' | 'open' | 'save' | 'create' | 'delete';

export interface EditorOperationTicket {
  readonly kind: EditorOperationKind;
  readonly generation: number;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  finish(): void;
}

interface OperationSlot {
  controller: AbortController | null;
  generation: number;
}

const operationKinds: EditorOperationKind[] = ['list', 'open', 'save', 'create', 'delete'];

export class EditorOperationCoordinator {
  private slots = new Map<EditorOperationKind, OperationSlot>(
    operationKinds.map((kind) => [kind, { controller: null, generation: 0 }])
  );

  begin(kind: EditorOperationKind, parentSignal?: AbortSignal): EditorOperationTicket {
    const slot = this.slots.get(kind)!;
    slot.controller?.abort();
    const controller = new AbortController();
    const generation = ++slot.generation;
    slot.controller = controller;
    const abort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) {
      abort();
    } else {
      parentSignal?.addEventListener('abort', abort, { once: true });
    }

    const isCurrent = () => slot.generation === generation
      && slot.controller === controller
      && !controller.signal.aborted;
    const finish = () => {
      parentSignal?.removeEventListener('abort', abort);
      if (slot.generation === generation && slot.controller === controller) {
        slot.controller = null;
      }
    };

    return { kind, generation, signal: controller.signal, isCurrent, finish };
  }

  invalidate(kind: EditorOperationKind) {
    const slot = this.slots.get(kind)!;
    slot.generation += 1;
    slot.controller?.abort();
    slot.controller = null;
  }

  invalidateAll() {
    for (const kind of operationKinds) {
      this.invalidate(kind);
    }
  }

  isActive(kind: EditorOperationKind) {
    return this.slots.get(kind)?.controller !== null;
  }
}
