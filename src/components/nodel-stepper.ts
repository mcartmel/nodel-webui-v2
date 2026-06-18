import { callActionBindings, parseActionBindings } from '../data/action-bindings';
import { confirmRequestFromAttributes, requestConfirm, shouldConfirm } from '../data/confirm';
import { createSignalBindingController } from '../data/signal-bindings';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';
import { clampValue, formatValue, normalizeLevelUnit, normalizeStep, parseNumber, snapToStep } from '../utils/level-scale';
import { apiErrorMessage, formatBindingFailures, formatPlainNumber, normalizeFromList, normalizeTone, normalizeVariant, parseTypedArg, truthy, type ControlArgType } from '../utils/control-values';

type StepperRepeat = 'hold' | 'off';
type StepperReadout = 'show' | 'hide';
type StepperArgType = Extract<ControlArgType, 'number' | 'string' | 'json'>;

const argTypes: StepperArgType[] = ['number', 'string', 'json'];

export class NodelStepper extends HTMLElement {
  static observedAttributes = ['label', 'value', 'min', 'max', 'step', 'unit', 'prefix', 'suffix', 'precision', 'repeat', 'repeat-delay', 'repeat-interval', 'action', 'actions', 'join', 'arg-type', 'variant', 'tone', 'disabled', 'readout', 'signal', 'signals', 'confirm', 'confirm-title', 'confirm-text', 'confirm-label', 'cancel-label', 'confirm-tone'];

  private shellReady = false;
  private labelNode: HTMLElement | null = null;
  private readoutNode: HTMLElement | null = null;
  private decreaseNode: HTMLButtonElement | null = null;
  private increaseNode: HTMLButtonElement | null = null;
  private signalBindings = createSignalBindingController(this);
  private repeatDelay: number | null = null;
  private repeatTimer: number | null = null;
  private repeatDirection: -1 | 1 | null = null;
  private repeatStartValue: string | null = null;

  connectedCallback() {
    this.ensureShell();
    this.render();
    this.syncSignalSubscription();
    this.decreaseNode?.addEventListener('pointerdown', this.handleDecreasePointerDown);
    this.increaseNode?.addEventListener('pointerdown', this.handleIncreasePointerDown);
    this.decreaseNode?.addEventListener('click', this.preventClick);
    this.increaseNode?.addEventListener('click', this.preventClick);
    this.addEventListener('keydown', this.handleKeyDown);
  }

  disconnectedCallback() {
    this.signalBindings.dispose();
    this.clearRepeat();
    this.decreaseNode?.removeEventListener('pointerdown', this.handleDecreasePointerDown);
    this.increaseNode?.removeEventListener('pointerdown', this.handleIncreasePointerDown);
    this.decreaseNode?.removeEventListener('click', this.preventClick);
    this.increaseNode?.removeEventListener('click', this.preventClick);
    this.removeEventListener('keydown', this.handleKeyDown);
    this.removeRepeatListeners();
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
      <div class="nodel-stepper-shell" tabindex="0">
        <div class="nodel-stepper-label" hidden></div>
        <div class="nodel-stepper-row">
          <button type="button" class="nodel-stepper-button nodel-stepper-decrease" aria-label="Decrease">−</button>
          <output class="nodel-stepper-readout"></output>
          <button type="button" class="nodel-stepper-button nodel-stepper-increase" aria-label="Increase">+</button>
        </div>
      </div>
    `;
    this.labelNode = this.querySelector('.nodel-stepper-label');
    this.readoutNode = this.querySelector('.nodel-stepper-readout');
    this.decreaseNode = this.querySelector('.nodel-stepper-decrease');
    this.increaseNode = this.querySelector('.nodel-stepper-increase');
    this.shellReady = true;
  }

  private range() {
    const min = parseNumber(this.getAttribute('min'), 0);
    const max = parseNumber(this.getAttribute('max'), 100);
    return max > min ? { min, max } : { min: 0, max: 100 };
  }

  private step() {
    return normalizeStep(parseNumber(this.getAttribute('step'), 1));
  }

  private currentValue() {
    const { min, max } = this.range();
    return clampValue(snapToStep(parseNumber(this.getAttribute('value'), min), min, this.step()), min, max);
  }

  private formattedValue(value: number) {
    const unit = normalizeLevelUnit(this.getAttribute('unit'));
    if (this.getAttribute('unit') === 'percent' || this.getAttribute('unit') === 'db') {
      return formatValue(value, unit);
    }
    const precisionAttr = this.getAttribute('precision');
    const precision = precisionAttr === null ? null : Number.parseInt(precisionAttr, 10);
    return `${this.getAttribute('prefix') ?? ''}${formatPlainNumber(value, Number.isFinite(precision) ? precision : null)}${this.getAttribute('suffix') ?? ''}`;
  }

  private render() {
    this.ensureShell();
    const value = this.currentValue();
    const { min, max } = this.range();
    const label = this.getAttribute('label') ?? '';
    const variant = normalizeVariant(this.getAttribute('variant'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const disabled = this.hasAttribute('disabled');
    const readout = normalizeFromList(this.getAttribute('readout'), ['show', 'hide'] as const, 'show' as StepperReadout);

    this.dataset.variant = variant;
    this.dataset.tone = tone;
    this.dataset.disabled = String(disabled);
    this.dataset.readout = readout;
    this.dataset.value = String(value);
    this.labelNode!.hidden = !label;
    this.labelNode!.textContent = label;
    this.readoutNode!.hidden = readout === 'hide';
    this.readoutNode!.textContent = this.formattedValue(value);
    this.decreaseNode!.disabled = disabled || value <= min;
    this.increaseNode!.disabled = disabled || value >= max;
    this.setAttribute('role', 'group');
    if (label) {
      this.setAttribute('aria-label', label);
    }
  }

  private payload(value: number) {
    const argType = normalizeFromList(this.getAttribute('arg-type'), argTypes, 'number');
    return { arg: parseTypedArg(String(value), argType) };
  }

  private async setValue(value: number, direction: -1 | 1 | 0, committed: boolean) {
    if (this.hasAttribute('disabled')) {
      return;
    }
    const { min, max } = this.range();
    const nextValue = clampValue(snapToStep(value, min, this.step()), min, max);
    const previousValue = committed && this.repeatStartValue !== null ? this.repeatStartValue : this.getAttribute('value');

    if (shouldConfirm(this) && committed) {
      const confirmed = await requestConfirm(this, confirmRequestFromAttributes(this, {
        title: 'Confirm value',
        text: `Set ${this.getAttribute('label') || 'value'} to ${this.formattedValue(nextValue)}?`,
        tone: 'info'
      }));
      if (!confirmed) {
        return;
      }
    }

    const bindings = parseActionBindings({ action: this.getAttribute('action'), actions: this.getAttribute('actions'), join: this.getAttribute('join'), defaultPhase: 'change' });
    const payload = this.payload(nextValue);
    const action = this.getAttribute('action')?.trim() || this.getAttribute('join')?.trim() || '';

    if (bindings.length === 0) {
      this.setAttribute('value', String(nextValue));
      this.dispatchChange(nextValue, committed, direction, payload);
      return;
    }

    this.setAttribute('value', String(nextValue));

    try {
      const changeExecution = await callActionBindings(bindings, 'change', payload);
      const phaseExecution = await callActionBindings(bindings, committed ? 'commit' : 'live', payload);
      const directionExecution = direction === 1
        ? await callActionBindings(bindings, 'increase', payload)
        : direction === -1
          ? await callActionBindings(bindings, 'decrease', payload)
          : { results: [], failures: [] };
      const failures = [...changeExecution.failures, ...phaseExecution.failures, ...directionExecution.failures];
      if (failures.length > 0) {
        const detail = formatBindingFailures(failures);
        if (previousValue === null) {
          this.removeAttribute('value');
        } else {
          this.setAttribute('value', previousValue);
        }
        this.dispatchEvent(new CustomEvent('nodel-stepper-error', { bubbles: true, detail: { action, value: nextValue, payload, failures, error: detail } }));
        this.showToast({ message: 'Failed to call action', detail, tone: 'danger', durationMs: 7000 });
        return;
      }
      this.dispatchChange(nextValue, committed, direction, payload, [...changeExecution.results, ...phaseExecution.results, ...directionExecution.results]);
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to call action');
      if (previousValue === null) {
        this.removeAttribute('value');
      } else {
        this.setAttribute('value', previousValue);
      }
      this.dispatchEvent(new CustomEvent('nodel-stepper-error', { bubbles: true, detail: { action, value: nextValue, payload, error: message } }));
      this.showToast({ message: 'Failed to call action', detail: message, tone: 'danger', durationMs: 7000 });
    }
  }

  private dispatchChange(value: number, committed: boolean, direction: -1 | 1 | 0, payload: { arg: unknown }, results: unknown[] = []) {
    this.dispatchEvent(new CustomEvent('nodel-stepper-change', { bubbles: true, detail: { value, committed, direction, arg: payload.arg, payload, results } }));
  }

  private startRepeat(event: PointerEvent, direction: -1 | 1) {
    if (this.hasAttribute('disabled')) {
      return;
    }
    event.preventDefault();
    if (this.repeatDirection === null) {
      this.repeatStartValue = this.getAttribute('value');
    }
    this.repeatDirection = direction;
    void this.setValue(this.currentValue() + this.step() * direction, direction, false);
    if (normalizeFromList(this.getAttribute('repeat'), ['hold', 'off'] as const, 'hold' as StepperRepeat) === 'hold') {
      document.addEventListener('pointerup', this.handleRepeatEnd);
      document.addEventListener('pointercancel', this.handleRepeatEnd);
      const delay = Math.max(0, parseNumber(this.getAttribute('repeat-delay'), 300));
      const interval = Math.max(50, parseNumber(this.getAttribute('repeat-interval'), 200));
      this.repeatDelay = window.setTimeout(() => {
        this.repeatDelay = null;
        this.repeatTimer = window.setInterval(() => {
          if (this.repeatDirection !== null) {
            void this.setValue(this.currentValue() + this.step() * this.repeatDirection, this.repeatDirection, false);
          }
        }, interval);
      }, delay);
    } else {
      void this.setValue(this.currentValue(), direction, true);
      this.clearRepeat();
      this.repeatStartValue = null;
    }
  }

  private endRepeat() {
    const direction = this.repeatDirection ?? 0;
    this.clearRepeat();
    this.removeRepeatListeners();
    void this.setValue(this.currentValue(), direction, true);
    this.repeatStartValue = null;
  }

  private clearRepeat() {
    if (this.repeatDelay !== null) {
      window.clearTimeout(this.repeatDelay);
      this.repeatDelay = null;
    }
    if (this.repeatTimer !== null) {
      window.clearInterval(this.repeatTimer);
      this.repeatTimer = null;
    }
    this.repeatDirection = null;
  }

  private removeRepeatListeners() {
    document.removeEventListener('pointerup', this.handleRepeatEnd);
    document.removeEventListener('pointercancel', this.handleRepeatEnd);
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      disabled: (value) => value && truthy(value) ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'),
      label: (value) => this.setAttribute('label', value),
      value: (value) => this.setAttribute('value', value)
    }, { join: this.getAttribute('join'), aggregators: { disabled: { evaluate: truthy } } });
  }

  private showToast(detail: NodelToastDetail) {
    this.dispatchEvent(new CustomEvent<NodelToastDetail>(NODEL_TOAST, { bubbles: true, detail }));
  }

  private handleDecreasePointerDown = (event: PointerEvent) => this.startRepeat(event, -1);
  private handleIncreasePointerDown = (event: PointerEvent) => this.startRepeat(event, 1);
  private handleRepeatEnd = () => this.endRepeat();
  private preventClick = (event: Event) => event.preventDefault();

  private handleKeyDown = (event: KeyboardEvent) => {
    let next: number | null = null;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      next = this.currentValue() + this.step();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      next = this.currentValue() - this.step();
    } else if (event.key === 'Home') {
      next = this.range().min;
    } else if (event.key === 'End') {
      next = this.range().max;
    }
    if (next !== null) {
      event.preventDefault();
      void this.setValue(next, next > this.currentValue() ? 1 : next < this.currentValue() ? -1 : 0, true);
    }
  };
}

if (!customElements.get('nodel-stepper')) {
  customElements.define('nodel-stepper', NodelStepper);
}
