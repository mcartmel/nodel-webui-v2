import { isAbortError } from './errors';

export type LifecycleDisposer = (() => void) | { dispose(): void };
type LifecycleEventListener = EventListenerOrEventListenerObject | ((event: never) => void);

export interface ConnectionScope {
  readonly generation: number;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  own<T extends LifecycleDisposer>(disposer: T): T;
  guard<T extends unknown[]>(listener: (...args: T) => void): (...args: T) => void;
  listen(target: EventTarget, type: string, listener: LifecycleEventListener, options?: AddEventListenerOptions | boolean): void;
  setTimeout(callback: () => void, delayMs: number): number | null;
  run(operation: () => Promise<void> | void, onError?: (error: unknown) => void): Promise<void>;
}

function disposerFunction(disposer: LifecycleDisposer) {
  return typeof disposer === 'function' ? disposer : () => disposer.dispose();
}

class ConnectionScopeImpl implements ConnectionScope {
  private disposers: Array<() => void> = [];
  private disposed = false;

  constructor(
    readonly generation: number,
    readonly signal: AbortSignal,
    private readonly lifecycle: ComponentLifecycle
  ) {}

  isCurrent() {
    return !this.disposed && !this.signal.aborted && this.lifecycle.currentScope === this;
  }

  private registerDisposer(dispose: () => void) {
    let active = true;
    const once = () => {
      if (!active) {
        return;
      }
      active = false;
      const index = this.disposers.indexOf(once);
      if (index >= 0) {
        this.disposers.splice(index, 1);
      }
      try {
        dispose();
      } catch {
        // Cleanup must not interrupt the remaining connection disposers.
      }
    };

    if (!this.isCurrent()) {
      once();
    } else {
      this.disposers.push(once);
    }
    return once;
  }

  own<T extends LifecycleDisposer>(disposer: T): T {
    this.registerDisposer(disposerFunction(disposer));
    return disposer;
  }

  guard<T extends unknown[]>(listener: (...args: T) => void) {
    return (...args: T) => {
      if (!this.isCurrent()) {
        return;
      }
      listener(...args);
    };
  }

  listen(target: EventTarget, type: string, listener: LifecycleEventListener, options?: AddEventListenerOptions | boolean) {
    if (!this.isCurrent()) {
      return;
    }
    const eventListener: EventListenerOrEventListenerObject = typeof listener === 'function'
      ? (event) => listener(event as never)
      : listener;
    target.addEventListener(type, eventListener, options);
    this.own(() => target.removeEventListener(type, eventListener, options));
  }

  setTimeout(callback: () => void, delayMs: number) {
    if (!this.isCurrent()) {
      return null;
    }
    let cancel: () => void = () => undefined;
    const timer = window.setTimeout(() => {
      cancel();
      if (this.isCurrent()) {
        callback();
      }
    }, Math.max(0, delayMs));
    cancel = this.registerDisposer(() => window.clearTimeout(timer));
    return timer;
  }

  async run(operation: () => Promise<void> | void, onError?: (error: unknown) => void) {
    if (!this.isCurrent()) {
      return;
    }
    try {
      await operation();
    } catch (error) {
      if (!this.isCurrent() || isAbortError(error)) {
        return;
      }
      onError?.(error);
    }
  }

  close() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const dispose of this.disposers.splice(0).reverse()) {
      dispose();
    }
  }
}

export class ComponentLifecycle {
  private generation = 0;
  private controller: AbortController | null = null;
  currentScope: ConnectionScopeImpl | null = null;

  connect(): ConnectionScope | null {
    if (this.currentScope?.isCurrent()) {
      return null;
    }
    this.generation += 1;
    this.controller = new AbortController();
    this.currentScope = new ConnectionScopeImpl(this.generation, this.controller.signal, this);
    return this.currentScope;
  }

  disconnect() {
    const scope = this.currentScope;
    if (!scope) {
      return;
    }
    this.currentScope = null;
    const controller = this.controller;
    this.controller = null;
    controller?.abort();
    scope.close();
  }

  get current() {
    return this.currentScope as ConnectionScope | null;
  }
}
