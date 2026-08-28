import { parseActionBindings, type ActionBinding, type ActionBindingResult } from '../data/action-bindings';
import {
  actionErrorMessage, actionName, buildActionPayload, ControlActionController,
  dispatchControlActionError, executeActionPhases, type ControlActionScope
} from '../data/control-actions';
import { confirmRequestFromAttributes, requestConfirm, shouldConfirm } from '../data/confirm';
import { registerShortcut, unregisterShortcut, type ShortcutChord, type ShortcutRuntimeEntry } from '../data/shortcut-runtime';
import type { ControlArgType } from '../utils/control-values';
import { isStrictActionBindingList } from '../utils/action-binding-validation';

const confirmationAttributes = ['confirm', 'confirm-title', 'confirm-text', 'confirm-label', 'cancel-label', 'confirm-tone', 'confirm-mode', 'confirm-code-signal'];
const observed = ['key', 'ctrl', 'alt', 'shift', 'meta', 'action', 'actions', 'arg', 'arg-type', 'label', 'disabled', ...confirmationAttributes];
const argTypes = new Set<ControlArgType>(['string', 'number', 'boolean', 'json']);

const MAX_CONFLICT_KEY_LENGTH = 256;
const MAX_CONFLICT_ID_LENGTH = 128;
const MAX_CONFLICT_IDS = 32;
const MAX_CONFLICT_ID_ALLOCATION = 4096;
const MAX_ERROR_LABEL_LENGTH = 120;

export class NodelShortcut extends HTMLElement implements ShortcutRuntimeEntry {
  static observedAttributes = observed;
  private controller = new ControlActionController();
  private busy = false;

  get element() { return this; }

  connectedCallback() {
    this.controller.connect();
    this.syncState();
    if (this.parentElement?.localName === 'nodel-app') registerShortcut(this);
  }

  disconnectedCallback() {
    unregisterShortcut(this);
    this.controller.disconnect();
    this.busy = false;
    this.syncState();
  }

  attributeChangedCallback() { if (this.isConnected) this.syncState(); }

  chord(): ShortcutChord | null {
    const key = this.getAttribute('key');
    return key ? { key, ctrl: this.hasAttribute('ctrl'), alt: this.hasAttribute('alt'), shift: this.hasAttribute('shift'), meta: this.hasAttribute('meta') } : null;
  }

  eligible() {
    const app = this.parentElement;
    return this.isConnected && app?.localName === 'nodel-app' && !this.hidden && !app.hidden
      && !this.hasAttribute('disabled') && this.validDeclaration();
  }

  conflict(entries: readonly ShortcutRuntimeEntry[]) {
    const chord = this.chord();
    if (!chord) return;
    const ids: string[] = [];
    let allocation = 0;
    for (const entry of entries) {
      if (ids.length >= MAX_CONFLICT_IDS) break;
      const id = entry.element.id;
      if (!id) continue;
      const bounded = id.slice(0, MAX_CONFLICT_ID_LENGTH);
      if (allocation + bounded.length > MAX_CONFLICT_ID_ALLOCATION) break;
      ids.push(bounded);
      allocation += bounded.length;
    }
    this.dispatchEvent(new CustomEvent('nodel-shortcut-conflict', {
      bubbles: true,
      detail: { ...chord, key: chord.key.slice(0, MAX_CONFLICT_KEY_LENGTH), count: entries.length, ids }
    }));
  }

  activate() {
    if (this.busy) return;
    const scope = this.controller.captureScope();
    if (!scope || !this.controller.startSingleFlight(scope)) return;
    this.busy = true;
    this.syncState();
    void this.submit(scope).catch(() => undefined).finally(() => {
      if (scope.isCurrent()) {
        this.busy = false;
        this.controller.finishSingleFlight(scope);
        this.syncState();
      }
    });
  }

  private bindings(): ActionBinding[] {
    return parseActionBindings({ action: this.getAttribute('action'), actions: this.getAttribute('actions'), defaultPhase: 'trigger' });
  }

  private validDeclaration() {
    const key = this.getAttribute('key');
    const bindings = this.bindings();
    return key !== null && key.length > 0 && isStrictActionBindingList(this.getAttribute('action'))
      && isStrictActionBindingList(this.getAttribute('actions')) && bindings.length > 0
      && bindings.every((binding) => binding.phase === 'trigger') && argTypes.has((this.getAttribute('arg-type') ?? 'string') as ControlArgType);
  }

  private payload() {
    return buildActionPayload(this.hasAttribute('arg') ? this.getAttribute('arg') ?? '' : null, (this.getAttribute('arg-type') ?? 'string') as ControlArgType);
  }

  private async submit(scope: ControlActionScope) {
    const bindings = this.bindings();
    const action = actionName(bindings);
    const chord = this.chord()!;
    const payloadResult = this.payload();
    if (!payloadResult.ok) {
      this.dispatchError(action, payloadResult.error, {}, undefined, chord);
      return;
    }
    const active = document.activeElement;
    const trigger = active instanceof HTMLElement && active.isConnected && active !== this && !active.hidden ? active : document.body;
    if (shouldConfirm(this) && !(await requestConfirm(this, confirmRequestFromAttributes(this, {
      title: 'Confirm action', text: `Run ${this.getAttribute('label') || action || 'shortcut action'}?`, tone: 'warning'
    }), trigger, scope.signal))) return;
    if (!scope.isCurrent()) return;
    try {
      const execution = await executeActionPhases(bindings, ['trigger'], payloadResult.payload, scope);
      if (!scope.isCurrent()) return;
      if (execution.failures.length) {
        this.dispatchError(action, undefined, payloadResult.payload, payloadResult.arg, chord, execution.results, execution.failures);
        return;
      }
      this.dispatchEvent(new CustomEvent('nodel-shortcut-submitted', { bubbles: true, detail: {
        action, phase: 'trigger', phases: ['trigger'], arg: payloadResult.arg, payload: payloadResult.payload,
        results: execution.results, failures: [], committed: true, live: false, ...chord
      }}));
    } catch (error) {
      if (scope.isCurrent()) this.dispatchError(action, actionErrorMessage(error), payloadResult.payload, payloadResult.arg, chord);
    }
  }

  private dispatchError(action: string, error: string | undefined, payload: unknown, arg: unknown, chord: ShortcutChord, results: ActionBindingResult[] = [], failures: ActionBindingResult[] = []) {
    dispatchControlActionError(this, {
      eventName: 'nodel-shortcut-error', action, phase: 'trigger', phases: ['trigger'], payload, arg,
      committed: true, live: false, results, failures, ...(error ? { error } : {}), extra: { ...chord },
      toastMessage: this.errorToastMessage(action)
    });
  }

  private errorToastMessage(action: string) {
    const label = (this.getAttribute('label') || action || 'shortcut action').slice(0, MAX_ERROR_LABEL_LENGTH);
    return `Failed to run ${label}`;
  }

  private syncState() { this.dataset.state = this.busy ? 'busy' : this.validDeclaration() ? 'ready' : 'invalid'; }
}

if (!customElements.get('nodel-shortcut')) customElements.define('nodel-shortcut', NodelShortcut);
