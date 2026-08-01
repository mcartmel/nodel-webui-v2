import type { ConnectionScope } from '../utils/component-lifecycle';
import { bootstrapJsViews } from './jsviews-runtime';

export class JsViewsLinkController {
  private linkedGeneration: number | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly target: Element) {}

  link(scope: ConnectionScope, template: string, data: unknown, helpersOrContext?: object) {
    const generation = scope.generation;
    const result = this.enqueue(async () => {
      const jq = await bootstrapJsViews();
      if (!scope.isCurrent()) {
        return false;
      }
      const linkedTarget = jq(this.target as HTMLElement);
      if (this.linkedGeneration !== null) {
        jq.unlink(linkedTarget);
        this.linkedGeneration = null;
      }
      jq.templates(template).link(linkedTarget as JQuery<HTMLElement>, data, helpersOrContext);
      this.linkedGeneration = generation;
      return true;
    });
    scope.own(() => {
      void this.unlink(generation);
    });
    return result;
  }

  unlink(generation: number) {
    return this.enqueue(async () => {
      if (this.linkedGeneration !== generation) {
        return;
      }
      const jq = await bootstrapJsViews();
      if (this.linkedGeneration === generation) {
        jq.unlink(jq(this.target as HTMLElement));
        this.linkedGeneration = null;
      }
    });
  }

  whenSettled() {
    return this.queue;
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
