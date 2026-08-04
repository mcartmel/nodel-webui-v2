import { parseActionBindings, type ActionBinding } from '../data/action-bindings';
import {
  actionErrorMessage,
  actionName,
  buildActionPayload,
  ControlActionController,
  type ControlActionScope,
  dispatchControlActionError,
  executeActionPhases
} from '../data/control-actions';
import { confirmRequestFromAttributes, requestConfirm, shouldConfirm } from '../data/confirm';
import { createSignalBindingController } from '../data/signal-bindings';
import { accessibleLabelText, syncHostAccessibleLabel } from '../utils/accessibility';
import { normalizeFromList, normalizeTone, normalizeVariant, truthy } from '../utils/control-values';

type PadCenter = 'auto' | 'show' | 'hide' | 'disabled';
type PadPressMode = 'click' | 'momentary';
type PadDirection = 'up' | 'down' | 'left' | 'right' | 'center';

const centers: PadCenter[] = ['auto', 'show', 'hide', 'disabled'];
const pressModes: PadPressMode[] = ['click', 'momentary'];
const directions: PadDirection[] = ['up', 'down', 'left', 'right', 'center'];

const directionLabels: Record<PadDirection, string> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  center: 'Center'
};

const directionGlyphs: Record<PadDirection, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  center: '•'
};

export class NodelPad extends HTMLElement {
  static observedAttributes = [
    'label', 'aria-label', 'aria-labelledby', 'center', 'press-mode', 'action', 'actions', 'arg-type', 'variant', 'tone', 'disabled', 'center-disabled', 'signal', 'signals',
    'up-action', 'down-action', 'left-action', 'right-action', 'center-action',
    'up-actions', 'down-actions', 'left-actions', 'right-actions', 'center-actions',
    'up-arg', 'down-arg', 'left-arg', 'right-arg', 'center-arg',
    'up-label', 'down-label', 'left-label', 'right-label', 'center-label',
    'confirm', 'confirm-title', 'confirm-text', 'confirm-label', 'cancel-label', 'confirm-tone', 'confirm-mode', 'confirm-code-signal'
  ];

  private shellReady = false;
  private signalBindings = createSignalBindingController(this);
  private activeDirection: PadDirection | null = null;
  private startingDirection: PadDirection | null = null;
  private releaseRequested = false;
  private actionController = new ControlActionController();
  private momentaryScope: ControlActionScope | null = null;

  connectedCallback() {
    this.actionController.connect();
    this.ensureShell();
    this.render();
    this.syncSignalSubscription();
    this.addEventListener('click', this.handleClick);
    this.addEventListener('pointerdown', this.handlePointerDown);
    this.addEventListener('keydown', this.handleKeyDown);
    this.addEventListener('keyup', this.handleKeyUp);
  }

  disconnectedCallback() {
    this.actionController.disconnect();
    this.signalBindings.dispose();
    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('pointerdown', this.handlePointerDown);
    this.removeEventListener('keydown', this.handleKeyDown);
    this.removeEventListener('keyup', this.handleKeyUp);
    this.activeDirection = null;
    this.clearMomentaryStart();
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
      this.syncSignalSubscription();
    }
  }

  private ensureShell() {
    if (this.shellReady) {
      return;
    }
    const text = Array.from(this.childNodes).map((child) => child.textContent?.trim() ?? '').filter(Boolean).join(' ').trim();
    if (text && !this.hasAttribute('label')) {
      this.setAttribute('label', text);
    }
    this.innerHTML = `
      <div class="nodel-pad-shell">
        <div class="nodel-pad-grid">
          ${directions.map((direction) => `<button type="button" class="nodel-pad-button" data-direction="${direction}"><span aria-hidden="true">${directionGlyphs[direction]}</span></button>`).join('')}
        </div>
      </div>
    `;
    this.shellReady = true;
  }

  private centerMode() {
    return normalizeFromList(this.getAttribute('center'), centers, 'auto');
  }

  private pressMode() {
    return normalizeFromList(this.getAttribute('press-mode'), pressModes, 'click');
  }

  private visibleDirections() {
    const visible = new Set<PadDirection>();
    visible.add('up');
    visible.add('down');
    visible.add('left');
    visible.add('right');
    if (this.shouldShowCenter()) {
      visible.add('center');
    }
    return visible;
  }

  private shouldShowCenter() {
    const mode = this.centerMode();
    if (mode === 'show' || mode === 'disabled') {
      return true;
    }
    if (mode === 'hide') {
      return false;
    }
    return Boolean(this.getAttribute('center-action') || this.getAttribute('center-actions') || this.getAttribute('center-label') || this.getAttribute('action') || this.getAttribute('actions'));
  }

  private button(direction: PadDirection) {
    return this.querySelector<HTMLButtonElement>(`[data-direction="${direction}"]`);
  }

  private render() {
    this.ensureShell();
    const variant = normalizeVariant(this.getAttribute('variant'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const accessibleLabel = accessibleLabelText(this);
    const center = this.centerMode();
    const pressMode = this.pressMode();
    const disabled = this.hasAttribute('disabled');
    const centerDisabled = this.hasAttribute('center-disabled') || center === 'disabled';
    const visible = this.visibleDirections();

    this.dataset.variant = variant;
    this.dataset.tone = tone;
    this.dataset.center = center;
    this.dataset.pressMode = pressMode;
    this.dataset.disabled = String(disabled);
    this.dataset.centerDisabled = String(centerDisabled);
    this.setAttribute('role', 'group');
    syncHostAccessibleLabel(this);

    for (const direction of directions) {
      const button = this.button(direction)!;
      const explicitDirectionLabel = this.getAttribute(`${direction}-label`);
      const directionLabel = explicitDirectionLabel ?? (accessibleLabel ? `${accessibleLabel} ${directionLabels[direction].toLowerCase()}` : directionLabels[direction]);
      const isVisible = visible.has(direction);
      const isDisabled = disabled || (direction === 'center' && centerDisabled);
      button.hidden = !isVisible;
      button.disabled = isDisabled;
      button.setAttribute('aria-label', directionLabel);
      button.classList.toggle('is-active', this.activeDirection === direction || this.startingDirection === direction);
    }
  }

  private directionFromEvent(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return null;
    }
    const button = target.closest<HTMLButtonElement>('[data-direction]');
    if (!button || !this.contains(button) || button.hidden || button.disabled) {
      return null;
    }
    return button.dataset.direction as PadDirection;
  }

  private payload(direction: PadDirection) {
    const raw = this.getAttribute(`${direction}-arg`) ?? direction;
    const argType = normalizeFromList(this.getAttribute('arg-type'), ['string', 'json'] as const, 'string');
    return buildActionPayload(raw, argType);
  }

  private bindings(direction: PadDirection, defaultPhase: string) {
    const specific = parseActionBindings({ action: this.getAttribute(`${direction}-action`), actions: this.getAttribute(`${direction}-actions`), defaultPhase });
    if (specific.length > 0) {
      return specific;
    }
    return parseActionBindings({ action: this.getAttribute('action'), actions: this.getAttribute('actions'), defaultPhase });
  }

  private async submit(direction: PadDirection, phase: 'click' | 'press' | 'release', bindings: ActionBinding[] = this.bindings(direction, phase), scope = this.actionController.captureScope()): Promise<boolean> {
    if (!scope || !scope.isCurrent()) {
      return false;
    }
    if (this.hasAttribute('disabled') || (direction === 'center' && (this.hasAttribute('center-disabled') || this.centerMode() === 'disabled'))) {
      return false;
    }
    const payloadResult = this.payload(direction);
    const action = actionName(bindings);
    if (!payloadResult.ok) {
      dispatchControlActionError(this, {
        eventName: 'nodel-pad-error',
        action,
        phase,
        value: direction,
        payload: {},
        committed: phase !== 'press',
        live: phase === 'press',
        error: payloadResult.error
      });
      return false;
    }
    if (phase !== 'release' && shouldConfirm(this)) {
      const confirmed = await requestConfirm(this, confirmRequestFromAttributes(this, { title: 'Confirm action', text: `Run ${this.getAttribute(`${direction}-label`) ?? directionLabels[direction]}?`, tone: 'info' }), this.button(direction), scope.signal);
      if (!confirmed || !scope.isCurrent()) {
        return false;
      }
    }
    const payload = payloadResult.payload;
    try {
      const execution = await executeActionPhases(bindings, [phase], payload, scope);
      if (!scope.isCurrent()) {
        return false;
      }
      if (execution.failures.length > 0) {
        dispatchControlActionError(this, {
          eventName: 'nodel-pad-error',
          action,
          phase,
          value: direction,
          payload,
          arg: payloadResult.arg,
          committed: phase !== 'press',
          live: phase === 'press',
          results: execution.results,
          failures: execution.failures
        });
        return false;
      }
      this.dispatchEvent(new CustomEvent('nodel-pad-action', { bubbles: true, detail: { action, direction, phase, phases: [phase], value: direction, payload, arg: payloadResult.arg, results: execution.results, failures: [], committed: phase !== 'press', live: phase === 'press' } }));
      return true;
    } catch (error) {
      if (!scope.isCurrent()) {
        return false;
      }
      dispatchControlActionError(this, {
        eventName: 'nodel-pad-error',
        action,
        phase,
        value: direction,
        payload,
        arg: payloadResult.arg,
        committed: phase !== 'press',
        live: phase === 'press',
        error: actionErrorMessage(error)
      });
      return false;
    }
  }

  private async startMomentary(direction: PadDirection, event?: Event) {
    if (this.activeDirection || this.startingDirection || this.pressMode() !== 'momentary') {
      return;
    }
    event?.preventDefault();
    this.startingDirection = direction;
    this.releaseRequested = false;
    this.render();
    document.addEventListener('pointerup', this.handleDocumentPointerUp);
    document.addEventListener('pointercancel', this.handleDocumentPointerUp);
    window.addEventListener('blur', this.handleWindowBlur);
    const scope = this.actionController.captureScope();
    if (!scope) {
      this.clearMomentaryStart();
      this.render();
      return;
    }
    const bindings = this.bindings(direction, 'press');
    const pressed = await this.actionController.runSerial(scope, () => this.submit(direction, 'press', bindings, scope)).catch(() => false);
    if (!scope.isCurrent()) {
      return;
    }
    this.startingDirection = null;
    if (!pressed) {
      this.clearMomentaryStart();
      this.render();
      return;
    }
    this.activeDirection = direction;
    this.momentaryScope = scope;
    this.render();
    if (this.releaseRequested) {
      this.finishMomentary();
    }
  }

  private finishMomentary() {
    if (this.startingDirection && !this.activeDirection) {
      this.releaseRequested = true;
      return;
    }
    const direction = this.activeDirection;
    if (!direction) {
      return;
    }
    const scope = this.momentaryScope;
    this.activeDirection = null;
    this.clearMomentaryStart();
    this.render();
    this.momentaryScope = null;
    if (scope?.isCurrent()) {
      void this.actionController.runSerial(scope, () => this.submit(direction, 'release', this.bindings(direction, 'release'), scope)).catch(() => undefined);
    }
  }

  private clearMomentaryStart() {
    this.startingDirection = null;
    this.releaseRequested = false;
    this.momentaryScope = null;
    document.removeEventListener('pointerup', this.handleDocumentPointerUp);
    document.removeEventListener('pointercancel', this.handleDocumentPointerUp);
    window.removeEventListener('blur', this.handleWindowBlur);
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), undefined, {
      'center-disabled': (value) => truthy(value) ? this.setAttribute('center-disabled', '') : this.removeAttribute('center-disabled'),
      disabled: (value) => truthy(value) ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'),
      label: (value) => this.setAttribute('label', value)
    }, { aggregators: { disabled: { evaluate: truthy }, 'center-disabled': { evaluate: truthy } } });
  }

  private handleClick = (event: Event) => {
    const direction = this.directionFromEvent(event);
    if (!direction) {
      return;
    }
    if (this.pressMode() === 'momentary') {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    void this.submit(direction, 'click', this.bindings(direction, 'click'));
  };

  private handlePointerDown = (event: PointerEvent) => {
    const direction = this.directionFromEvent(event);
    if (direction && this.pressMode() === 'momentary') {
      void this.startMomentary(direction, event);
    }
  };

  private handleDocumentPointerUp = () => this.finishMomentary();
  private handleWindowBlur = () => this.finishMomentary();

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || (event.key !== ' ' && event.key !== 'Enter')) {
      return;
    }
    const direction = this.directionFromEvent(event);
    if (direction && this.pressMode() === 'momentary') {
      void this.startMomentary(direction, event);
    }
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    if (event.key === ' ' || event.key === 'Enter') {
      this.finishMomentary();
    }
  };
}

if (!customElements.get('nodel-pad')) {
  customElements.define('nodel-pad', NodelPad);
}
