import { callActionBindings, parseActionBindings } from '../data/action-bindings';
import { createSignalBindingController } from '../data/signal-bindings';
import { renderFontAwesomeIcon, uiIcons } from '../icons/fontawesome';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';
import {
  clampValue,
  defaultRangeForUnit,
  formatValue,
  fractionToValue,
  normalizeLevelUnit,
  normalizeStep,
  parseNumber,
  snapToStep,
  valueToFraction,
  type LevelUnit
} from '../utils/level-scale';
import { throttle, type ThrottledFunction } from '../utils/throttle';

type FaderOrientation = 'vertical' | 'horizontal';
type FaderReadout = 'show' | 'hide';
type FaderArgType = 'number' | 'string' | 'json';
type FaderVariant = 'default' | 'primary' | 'success' | 'info' | 'warning' | 'danger' | 'ghost';
type FaderTone = 'solid' | 'soft' | 'outline';
type FaderCompoundAlign = 'start' | 'center' | 'end';

const variants: FaderVariant[] = ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost'];
const tones: FaderTone[] = ['solid', 'soft', 'outline'];

interface PointerDragState {
  pointerId: number;
  startCoordinate: number;
  startValue: number;
  trackLength: number;
}

function normalizeOrientation(value: string | null): FaderOrientation {
  return value === 'horizontal' ? 'horizontal' : 'vertical';
}

function normalizeReadout(value: string | null): FaderReadout {
  return value === 'hide' ? 'hide' : 'show';
}

function normalizeArgType(value: string | null): FaderArgType {
  return value === 'string' || value === 'json' ? value : 'number';
}

function normalizeVariant(value: string | null): FaderVariant {
  return variants.includes(value as FaderVariant) ? (value as FaderVariant) : 'default';
}

function normalizeTone(value: string | null): FaderTone {
  return tones.includes(value as FaderTone) ? (value as FaderTone) : 'solid';
}

function normalizeCompoundAlign(value: string | null): FaderCompoundAlign {
  if (value === 'start' || value === 'top' || value === 'left') {
    return 'start';
  }
  if (value === 'center' || value === 'middle') {
    return 'center';
  }
  return 'end';
}

function truthy(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes' || normalized === 'disabled';
}

function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function parseCssPixelValue(value: string, fallback: number): number {
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (trimmed.endsWith('rem')) {
    return parsed * parseCssPixelValue(window.getComputedStyle(document.documentElement).fontSize, 16);
  }
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class NodelFader extends HTMLElement {
  static observedAttributes = ['orientation', 'compound-align', 'variant', 'tone', 'min', 'max', 'step', 'unit', 'nudge', 'increment', 'action', 'actions', 'join', 'arg-type', 'signal', 'signals', 'value', 'disabled', 'readout', 'label', 'live-interval', 'aria-label', 'aria-labelledby', 'title'];

  private shellReady = false;
  private shellNode: HTMLElement | null = null;
  private bodyNode: HTMLElement | null = null;
  private controlNode: HTMLElement | null = null;
  private decreaseNode: HTMLButtonElement | null = null;
  private increaseNode: HTMLButtonElement | null = null;
  private trackNode: HTMLElement | null = null;
  private fillNode: HTMLElement | null = null;
  private thumbNode: HTMLElement | null = null;
  private railNode: HTMLElement | null = null;
  private readoutNode: HTMLElement | null = null;
  private defaultLabel = '';
  private drag: PointerDragState | null = null;
  private signalBindings = createSignalBindingController(this);
  private liveEmitter: ThrottledFunction<[number]> | null = null;
  private nudgeDelay: number | null = null;
  private nudgeRepeat: number | null = null;

  connectedCallback() {
    this.ensureShell();
    this.render();
    this.syncSignalSubscription();
    this.trackNode?.addEventListener('pointerdown', this.handlePointerDown);
    this.trackNode?.addEventListener('keydown', this.handleKeyDown);
    this.decreaseNode?.addEventListener('pointerdown', this.handleDecreasePointerDown);
    this.increaseNode?.addEventListener('pointerdown', this.handleIncreasePointerDown);
    this.decreaseNode?.addEventListener('click', this.preventClick);
    this.increaseNode?.addEventListener('click', this.preventClick);
  }

  disconnectedCallback() {
    this.signalBindings.dispose();
    this.liveEmitter?.cancel();
    this.trackNode?.removeEventListener('pointerdown', this.handlePointerDown);
    this.trackNode?.removeEventListener('keydown', this.handleKeyDown);
    this.decreaseNode?.removeEventListener('pointerdown', this.handleDecreasePointerDown);
    this.increaseNode?.removeEventListener('pointerdown', this.handleIncreasePointerDown);
    this.decreaseNode?.removeEventListener('click', this.preventClick);
    this.increaseNode?.removeEventListener('click', this.preventClick);
    this.clearNudgeTimers();
    this.removeDocumentPointerListeners();
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

    const children = Array.from(this.childNodes);
    const textLabel = children
      .map((child) => child.nodeType === Node.TEXT_NODE ? child.textContent?.trim() ?? '' : '')
      .filter(Boolean)
      .join(' ')
      .trim();
    this.defaultLabel = this.getAttribute('label') ?? textLabel;

    this.innerHTML = `
      <div class="nodel-fader-shell">
        <div class="nodel-fader-body">
          <div class="nodel-fader-control">
            <button type="button" class="nodel-fader-nudge nodel-fader-nudge-down" aria-label="Decrease" hidden>${renderFontAwesomeIcon(uiIcons.minus)}</button>
            <div class="nodel-fader-track" tabindex="0">
              <div class="nodel-fader-fill"></div>
              <div class="nodel-fader-thumb"></div>
              <div class="nodel-fader-readout"></div>
            </div>
            <button type="button" class="nodel-fader-nudge nodel-fader-nudge-up" aria-label="Increase" hidden>${renderFontAwesomeIcon(uiIcons.plus)}</button>
          </div>
          <div class="nodel-fader-rail" hidden></div>
        </div>
      </div>
    `;

    this.shellNode = this.querySelector('.nodel-fader-shell');
    this.bodyNode = this.querySelector('.nodel-fader-body');
    this.controlNode = this.querySelector('.nodel-fader-control');
    this.decreaseNode = this.querySelector('.nodel-fader-nudge-down');
    this.increaseNode = this.querySelector('.nodel-fader-nudge-up');
    this.trackNode = this.querySelector('.nodel-fader-track');
    this.fillNode = this.querySelector('.nodel-fader-fill');
    this.thumbNode = this.querySelector('.nodel-fader-thumb');
    this.railNode = this.querySelector('.nodel-fader-rail');
    this.readoutNode = this.querySelector('.nodel-fader-readout');
    this.shellReady = true;

    for (const child of children) {
      this.appendRailChild(child);
    }
  }

  private appendRailChild(child: Node) {
    if (!this.railNode) {
      return;
    }

    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim() ?? '';
      if (text && !this.getAttribute('label')) {
        this.defaultLabel = text;
      }
      return;
    }

    if (child instanceof HTMLElement) {
      this.railNode.appendChild(child);
    }
  }

  private render() {
    this.ensureShell();
    const unit = normalizeLevelUnit(this.getAttribute('unit'));
    const { min, max } = this.range(unit);
    const step = normalizeStep(parseNumber(this.getAttribute('step'), 1));
    const value = this.normalizedValue(min, max, step);
    const orientation = normalizeOrientation(this.getAttribute('orientation'));
    const compoundAlign = normalizeCompoundAlign(this.getAttribute('compound-align'));
    const variant = normalizeVariant(this.getAttribute('variant'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const readout = normalizeReadout(this.getAttribute('readout'));
    const fraction = valueToFraction(value, min, max);
    const disabled = this.hasAttribute('disabled');
    const label = this.getAttribute('label') ?? this.defaultLabel;
    const showIncrement = this.shouldShowIncrement();

    this.dataset.orientation = orientation;
    this.dataset.compoundAlign = compoundAlign;
    this.dataset.variant = variant;
    this.dataset.tone = tone;
    this.dataset.unit = unit;
    this.dataset.increment = String(showIncrement);
    this.dataset.disabled = String(disabled);
    this.dataset.readoutPosition = orientation === 'vertical'
      ? (fraction < 0.5 ? 'top' : 'bottom')
      : (fraction < 0.5 ? 'right' : 'left');
    this.style.setProperty('--nodel-fader-value', String(fraction));
    this.readoutNode!.hidden = readout === 'hide';
    this.readoutNode!.textContent = formatValue(value, unit);
    this.railNode!.hidden = !this.railNode!.hasChildNodes();
    this.decreaseNode!.hidden = !showIncrement;
    this.increaseNode!.hidden = !showIncrement;
    this.decreaseNode!.disabled = disabled || value <= min;
    this.increaseNode!.disabled = disabled || value >= max;
    this.syncTrackAccessibility(label, value, min, max, unit, disabled);
  }

  private range(unit: LevelUnit) {
    const defaults = defaultRangeForUnit(unit);
    const min = parseNumber(this.getAttribute('min'), defaults.min);
    const max = parseNumber(this.getAttribute('max'), defaults.max);
    if (max <= min) {
      return defaults;
    }
    return { min, max };
  }

  private normalizedValue(min: number, max: number, step: number) {
    const parsed = parseNumber(this.getAttribute('value'), min);
    return clampValue(snapToStep(parsed, min, step), min, max);
  }

  private nudgeAmount(step: number) {
    const explicit = this.getAttribute('nudge');
    return normalizeStep(parseNumber(explicit, step));
  }

  private shouldShowIncrement() {
    return this.hasAttribute('increment') || this.hasAttribute('nudge');
  }

  private liveInterval() {
    return Math.max(50, parseNumber(this.getAttribute('live-interval'), 250));
  }

  private syncTrackAccessibility(label: string, value: number, min: number, max: number, unit: LevelUnit, disabled: boolean) {
    if (!this.trackNode) {
      return;
    }

    this.trackNode.setAttribute('role', 'slider');
    this.trackNode.setAttribute('aria-valuemin', String(min));
    this.trackNode.setAttribute('aria-valuemax', String(max));
    this.trackNode.setAttribute('aria-valuenow', String(value));
    this.trackNode.setAttribute('aria-valuetext', formatValue(value, unit));
    this.trackNode.setAttribute('aria-disabled', String(disabled));
    this.trackNode.tabIndex = disabled ? -1 : 0;

    const labelledBy = this.getAttribute('aria-labelledby');
    if (labelledBy) {
      this.trackNode.setAttribute('aria-labelledby', labelledBy);
      this.trackNode.removeAttribute('aria-label');
    } else if (this.getAttribute('aria-label') ?? label) {
      this.trackNode.removeAttribute('aria-labelledby');
      this.trackNode.setAttribute('aria-label', this.getAttribute('aria-label') ?? label);
    } else {
      this.trackNode.removeAttribute('aria-labelledby');
      this.trackNode.removeAttribute('aria-label');
    }

    const title = this.getAttribute('title');
    if (title) {
      this.trackNode.setAttribute('title', title);
    } else {
      this.trackNode.removeAttribute('title');
    }
  }

  private setValue(value: number, options: { live?: boolean; commit?: boolean } = {}) {
    const unit = normalizeLevelUnit(this.getAttribute('unit'));
    const { min, max } = this.range(unit);
    const step = normalizeStep(parseNumber(this.getAttribute('step'), 1));
    const nextValue = clampValue(snapToStep(value, min, step), min, max);
    this.setAttribute('value', String(nextValue));

    if (options.live) {
      this.emitLive(nextValue);
    }
    if (options.commit) {
      this.commitValue(nextValue);
    }
  }

  private actionPayload(value: number) {
    const argType = normalizeArgType(this.getAttribute('arg-type'));
    if (argType === 'string') {
      return { arg: String(value) };
    }
    if (argType === 'json') {
      return { arg: value };
    }
    return { arg: value };
  }

  private emitLive(value: number) {
    const bindings = parseActionBindings({ action: this.getAttribute('action'), actions: this.getAttribute('actions'), join: this.getAttribute('join'), defaultPhase: 'change' });
    if (bindings.length === 0) {
      this.dispatchChange(value, false);
      return;
    }

    const waitMs = this.liveInterval();
    if (!this.liveEmitter) {
      this.liveEmitter = throttle<[number]>((nextValue) => {
        void this.submitValue(nextValue, false);
      }, waitMs);
    }

    this.liveEmitter(value);
  }

  private commitValue(value: number) {
    this.liveEmitter?.cancel();
    void this.submitValue(value, true);
  }

  private async submitValue(value: number, committed: boolean) {
    const action = this.getAttribute('action')?.trim() || this.getAttribute('join')?.trim() || '';
    const bindings = parseActionBindings({ action: this.getAttribute('action'), actions: this.getAttribute('actions'), join: this.getAttribute('join'), defaultPhase: 'change' });
    if (bindings.length === 0 || this.hasAttribute('disabled')) {
      this.dispatchChange(value, committed);
      return;
    }

    const payload = this.actionPayload(value);
    try {
      const changeExecution = await callActionBindings(bindings, 'change', payload);
      const phaseExecution = await callActionBindings(bindings, committed ? 'commit' : 'live', payload);
      const failures = [...changeExecution.failures, ...phaseExecution.failures];
      if (failures.length > 0) {
        const detail = failures.length === 1
          ? failures[0].error ?? 'Failed to call action'
          : failures.map((failure) => `${failure.action}: ${failure.error}`).join('; ');
        this.dispatchEvent(new CustomEvent('nodel-fader-error', {
          bubbles: true,
          detail: { action, payload, value, committed, failures, error: detail }
        }));
        this.showToast({ message: 'Failed to call action', detail, tone: 'danger', durationMs: 7000 });
        return;
      }
      this.dispatchChange(value, committed);
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to call action');
      this.dispatchEvent(new CustomEvent('nodel-fader-error', {
        bubbles: true,
        detail: { action, payload, value, committed, error: message }
      }));
      this.showToast({ message: 'Failed to call action', detail: message, tone: 'danger', durationMs: 7000 });
    }
  }

  private dispatchChange(value: number, committed: boolean) {
    this.dispatchEvent(new CustomEvent('nodel-fader-change', {
      bubbles: true,
      detail: { value, committed }
    }));
  }

  private showToast(detail: NodelToastDetail) {
    this.dispatchEvent(new CustomEvent<NodelToastDetail>(NODEL_TOAST, {
      bubbles: true,
      detail
    }));
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (this.hasAttribute('disabled') || !this.trackNode) {
      return;
    }

    event.preventDefault();
    const orientation = normalizeOrientation(this.getAttribute('orientation'));
    const rect = this.trackNode.getBoundingClientRect();
    const rawLength = orientation === 'vertical' ? rect.height : rect.width;
    const styles = window.getComputedStyle(this.trackNode);
    const thumbSize = parseCssPixelValue(styles.getPropertyValue('--nodel-fader-thumb-size'), 36);
    const thumbInset = parseCssPixelValue(styles.getPropertyValue('--nodel-fader-thumb-inset'), 2);
    const length = rawLength - thumbSize - (thumbInset * 2);
    if (length <= 0) {
      return;
    }

    this.drag = {
      pointerId: event.pointerId,
      startCoordinate: orientation === 'vertical' ? event.clientY : event.clientX,
      startValue: parseNumber(this.getAttribute('value'), this.range(normalizeLevelUnit(this.getAttribute('unit'))).min),
      trackLength: length
    };
    this.dataset.dragging = 'true';
    this.trackNode.setPointerCapture?.(event.pointerId);
    document.addEventListener('pointermove', this.handlePointerMove);
    document.addEventListener('pointerup', this.handlePointerUp);
    document.addEventListener('pointercancel', this.handlePointerUp);
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) {
      return;
    }

    const unit = normalizeLevelUnit(this.getAttribute('unit'));
    const { min, max } = this.range(unit);
    const orientation = normalizeOrientation(this.getAttribute('orientation'));
    const currentCoordinate = orientation === 'vertical' ? event.clientY : event.clientX;
    const delta = currentCoordinate - this.drag.startCoordinate;
    const directionDelta = orientation === 'vertical' ? -delta : delta;
    const startFraction = valueToFraction(this.drag.startValue, min, max);
    const nextFraction = startFraction + (directionDelta / this.drag.trackLength);
    this.setValue(fractionToValue(nextFraction, min, max), { live: true });
  };

  private handlePointerUp = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) {
      return;
    }

    this.trackNode?.releasePointerCapture?.(event.pointerId);
    this.drag = null;
    delete this.dataset.dragging;
    this.removeDocumentPointerListeners();
    this.commitValue(parseNumber(this.getAttribute('value'), 0));
  };

  private removeDocumentPointerListeners() {
    document.removeEventListener('pointermove', this.handlePointerMove);
    document.removeEventListener('pointerup', this.handlePointerUp);
    document.removeEventListener('pointercancel', this.handlePointerUp);
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (this.hasAttribute('disabled')) {
      return;
    }

    const unit = normalizeLevelUnit(this.getAttribute('unit'));
    const { min, max } = this.range(unit);
    const step = normalizeStep(parseNumber(this.getAttribute('step'), 1));
    const nudge = this.nudgeAmount(step);
    const current = parseNumber(this.getAttribute('value'), min);
    let next: number | null = null;

    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      next = current + step;
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      next = current - step;
    } else if (event.key === 'PageUp') {
      next = current + nudge;
    } else if (event.key === 'PageDown') {
      next = current - nudge;
    } else if (event.key === 'Home') {
      next = min;
    } else if (event.key === 'End') {
      next = max;
    }

    if (next !== null) {
      event.preventDefault();
      this.setValue(next, { commit: true });
    }
  };

  private handleDecreasePointerDown = (event: PointerEvent) => this.startNudge(event, -1);
  private handleIncreasePointerDown = (event: PointerEvent) => this.startNudge(event, 1);

  private startNudge(event: PointerEvent, direction: -1 | 1) {
    if (this.hasAttribute('disabled')) {
      return;
    }

    event.preventDefault();
    this.applyNudge(direction, { live: true });
    this.clearNudgeTimers();
    document.addEventListener('pointerup', this.handleNudgePointerUp);
    document.addEventListener('pointercancel', this.handleNudgePointerUp);
    this.nudgeDelay = window.setTimeout(() => {
      this.nudgeDelay = null;
      this.nudgeRepeat = window.setInterval(() => {
        this.applyNudge(direction, { live: true });
      }, 200);
    }, 300);
  }

  private handleNudgePointerUp = () => {
    this.clearNudgeTimers();
    document.removeEventListener('pointerup', this.handleNudgePointerUp);
    document.removeEventListener('pointercancel', this.handleNudgePointerUp);
    this.commitValue(parseNumber(this.getAttribute('value'), 0));
  };

  private clearNudgeTimers() {
    if (this.nudgeDelay !== null) {
      window.clearTimeout(this.nudgeDelay);
      this.nudgeDelay = null;
    }
    if (this.nudgeRepeat !== null) {
      window.clearInterval(this.nudgeRepeat);
      this.nudgeRepeat = null;
    }
  }

  private applyNudge(direction: -1 | 1, options: { live?: boolean; commit?: boolean }) {
    const unit = normalizeLevelUnit(this.getAttribute('unit'));
    const { min } = this.range(unit);
    const step = normalizeStep(parseNumber(this.getAttribute('step'), 1));
    const current = parseNumber(this.getAttribute('value'), min);
    this.setValue(current + this.nudgeAmount(step) * direction, options);
  }

  private preventClick = (event: Event) => {
    event.preventDefault();
  };

  private setSignalAttribute(name: string, value: string) {
    if (name === 'disabled') {
      if (truthy(value)) {
        this.setAttribute('disabled', '');
      } else {
        this.removeAttribute('disabled');
      }
      return;
    }

    if (value || name === 'value') {
      this.setAttribute(name, value);
    } else {
      this.removeAttribute(name);
    }
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      disabled: (value) => this.setSignalAttribute('disabled', value),
      label: (value) => this.setSignalAttribute('label', value),
      value: (value) => this.setSignalAttribute('value', value)
    }, {
      join: this.getAttribute('join'),
      aggregators: {
        disabled: { evaluate: truthy }
      }
    });
  }
}

if (!customElements.get('nodel-fader')) {
  customElements.define('nodel-fader', NodelFader);
}
