import {
  activateNodeRestartExpectation, cancelNodeRestartExpectation, commitNodeRestartExpectation,
  getNodeRestartExpectation, getNodeRestartScriptWriteState, isNodeRestartExpectationPreparedForWrite,
  NodeRestartExpectationObsoleteError, NodeRestartScriptWriteBlockedError,
  prepareNodeRestartExpectation, subscribeNodeRestart,
  type NodeRestartEvent, type NodeRestartExpectation, type NodeRestartExpectationState,
  type PreparedNodeRestartExpectation
} from '../data/node-restart-source';

interface RestartIdentity { id: number; generation: number; }
export interface EditorRestartState { id: number | null; generation: number | null; state: NodeRestartExpectationState; prepared: boolean; }
export interface EditorRestartDependencies {
  subscribe(listener: (event: NodeRestartEvent) => void): { dispose(): void };
  getExpectation(): NodeRestartExpectation | null;
  getWriteState(): string;
  prepare(init?: RequestInit): Promise<PreparedNodeRestartExpectation>;
  isPrepared(prepared: PreparedNodeRestartExpectation): boolean;
  commit(prepared: PreparedNodeRestartExpectation, activate: boolean): NodeRestartExpectation | null;
  activate(id: number, generation: number): boolean;
  cancel(expectation: PreparedNodeRestartExpectation | NodeRestartExpectation | null | undefined): void;
}

const globalDependencies: EditorRestartDependencies = {
  subscribe: subscribeNodeRestart, getExpectation: getNodeRestartExpectation, getWriteState: getNodeRestartScriptWriteState,
  prepare: prepareNodeRestartExpectation, isPrepared: isNodeRestartExpectationPreparedForWrite,
  commit: commitNodeRestartExpectation, activate: activateNodeRestartExpectation, cancel: cancelNodeRestartExpectation
};
const matches = (left: RestartIdentity | null, right: RestartIdentity) => Boolean(left && left.id === right.id && left.generation === right.generation);
const identity = (value: RestartIdentity): RestartIdentity => ({ id: value.id, generation: value.generation });

export class EditorRestartBridge {
  private active: NodeRestartExpectation | null = null;
  private preparation: RestartIdentity | null = null;
  private prepared: PreparedNodeRestartExpectation | null = null;
  constructor(private readonly deps: EditorRestartDependencies = globalDependencies) {}
  get state(): EditorRestartState {
    return this.active
      ? { id: this.active.id, generation: this.active.generation, state: this.active.state, prepared: this.preparation !== null }
      : { id: null, generation: null, state: 'idle', prepared: this.preparation !== null };
  }
  get writeBlocked() { const value = this.deps.getWriteState(); return value === 'preparing' || value === 'pending' || value === 'refreshing'; }
  get correctiveWrite() { return this.deps.getWriteState() === 'unconfirmed' || this.active?.state === 'unconfirmed'; }
  subscribe(listener: (event: NodeRestartEvent) => void) { return this.deps.subscribe((event) => { this.event(event); listener(event); }); }
  sync() {
    const expectation = this.deps.getExpectation();
    this.active = expectation && expectation.state !== 'idle' ? expectation : null;
    return this.state;
  }
  event(event: NodeRestartEvent) {
    if (event.type === 'expected-preparing') {
      this.preparation = identity(event.expectation);
      return this.state;
    }
    if (!('expectation' in event)) return this.state;
    const eventIdentity = identity(event.expectation);
    if (event.type === 'expected-superseded') {
      if (matches(this.preparation, eventIdentity)) {
        this.preparation = null;
        this.prepared = null;
      }
      if (matches(this.active, eventIdentity)) this.sync();
      return this.state;
    }
    // Only the tracked active expectation may mutate active state. A pending
    // event is also permitted to promote precisely the local preparation.
    if (matches(this.active, eventIdentity)) this.active = event.expectation;
    else if (event.type === 'expected-pending' && matches(this.preparation, eventIdentity)) {
      this.active = event.expectation;
      this.preparation = null;
      this.prepared = null;
    }
    return this.state;
  }
  track(expectation: NodeRestartExpectation) {
    if (!this.active) this.active = expectation;
  }
  isCurrent(expectation: RestartIdentity) {
    const global = this.deps.getExpectation();
    return matches(this.active, expectation) && (!global || matches(global, expectation));
  }
  async saveScript(content: BodyInit, options: { signal?: AbortSignal; isCurrent(): boolean; save(content: BodyInit, signal?: AbortSignal): Promise<unknown>; install(): void }) {
    if (this.writeBlocked) throw new NodeRestartScriptWriteBlockedError();
    let committed: NodeRestartExpectation | null = null;
    try {
      try { this.prepared = await this.deps.prepare(options.signal ? { signal: options.signal } : undefined); }
      catch (error) {
        if (error instanceof NodeRestartScriptWriteBlockedError) throw error;
        const detail = error instanceof Error ? error.message : 'The node reload baseline could not be read.';
        throw new Error(`Could not capture the node reload baseline; script.py was not saved. ${detail}`, { cause: error });
      }
      this.preparation = identity(this.prepared);
      if (!options.isCurrent() || !this.deps.isPrepared(this.prepared)) throw new NodeRestartExpectationObsoleteError();
      await options.save(content, options.signal);
      if (!options.isCurrent()) throw new NodeRestartExpectationObsoleteError();
      committed = this.deps.commit(this.prepared, false);
      if (!committed) throw new NodeRestartExpectationObsoleteError();
      options.install();
      if (!this.deps.activate(committed.id, committed.generation)) throw new NodeRestartExpectationObsoleteError();
      this.active = committed;
      this.preparation = null;
      this.prepared = null;
      return committed;
    } catch (error) {
      this.deps.cancel(committed ?? this.prepared);
      this.prepared = null;
      this.preparation = null;
      this.sync();
      throw error;
    }
  }
  dispose() {
    if (this.prepared) this.deps.cancel(this.prepared);
    this.prepared = null;
    this.preparation = null;
    this.active = null;
  }
}
