import { callNodeAction } from '../api/nodel-host-client';
import { confirmRequestFromAttributes, requestConfirm, shouldConfirm } from '../data/confirm';
import { createSignalBindingController } from '../data/signal-bindings';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';
import './nodel-button';

type NodelSegmentedArgType = 'string' | 'number' | 'boolean' | 'json';
type NodelSegmentedOrientation = 'horizontal' | 'vertical';
type NodelSegmentedVariant = 'default' | 'primary' | 'success' | 'info' | 'warning' | 'danger';
type NodelSegmentedTone = 'solid' | 'soft' | 'outline';

const argTypes: NodelSegmentedArgType[] = ['string', 'number', 'boolean', 'json'];
const orientations: NodelSegmentedOrientation[] = ['horizontal', 'vertical'];
const variants: NodelSegmentedVariant[] = ['default', 'primary', 'success', 'info', 'warning', 'danger'];
const tones: NodelSegmentedTone[] = ['solid', 'soft', 'outline'];

function normalizeArgType(value: string | null): NodelSegmentedArgType {
  return argTypes.includes(value as NodelSegmentedArgType) ? (value as NodelSegmentedArgType) : 'string';
}

function normalizeOrientation(value: string | null): NodelSegmentedOrientation {
  return orientations.includes(value as NodelSegmentedOrientation) ? (value as NodelSegmentedOrientation) : 'horizontal';
}

function normalizeVariant(value: string | null): NodelSegmentedVariant {
  return variants.includes(value as NodelSegmentedVariant) ? (value as NodelSegmentedVariant) : 'primary';
}

function normalizeTone(value: string | null): NodelSegmentedTone {
  return tones.includes(value as NodelSegmentedTone) ? (value as NodelSegmentedTone) : 'solid';
}

function parseBoolean(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
}

function parseArg(value: string, type: NodelSegmentedArgType) {
  if (type === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }

  if (type === 'boolean') {
    return parseBoolean(value);
  }

  if (type === 'json') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function valueMatches(value: string, expected: string) {
  return String(value) === String(expected);
}

export class NodelSegmented extends HTMLElement {
  static observedAttributes = [
    'action', 'arg-type', 'signal', 'signals', 'value', 'variant', 'tone', 'orientation', 'disabled',
    'allow-deselect', 'label', 'confirm', 'confirm-title', 'confirm-text', 'confirm-label', 'cancel-label', 'confirm-tone'
  ];

  private connected = false;
  private busy = false;
  private signalBindings = createSignalBindingController(this);

  connectedCallback() {
    this.connected = true;
    this.classList.add('nodel-segmented');
    this.setAttribute('role', 'radiogroup');
    this.render();
    this.syncSignalSubscription();
    this.addEventListener('click', this.handleClick, true);
  }

  disconnectedCallback() {
    this.connected = false;
    this.removeEventListener('click', this.handleClick, true);
    this.signalBindings.dispose();
  }

  attributeChangedCallback() {
    if (this.connected) {
      this.render();
      this.syncSignalSubscription();
    }
  }

  private render() {
    const value = this.getAttribute('value') ?? '';
    const disabled = this.hasAttribute('disabled') || this.busy;
    const variant = normalizeVariant(this.getAttribute('variant'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const orientation = normalizeOrientation(this.getAttribute('orientation'));

    this.dataset.value = value;
    this.dataset.variant = variant;
    this.dataset.tone = tone;
    this.dataset.orientation = orientation;
    this.dataset.disabled = String(disabled);
    this.setAttribute('aria-orientation', orientation);
    if (this.getAttribute('label')) {
      this.setAttribute('aria-label', this.getAttribute('label') ?? '');
    } else if (!this.hasAttribute('aria-label')) {
      this.setAttribute('aria-label', 'Segmented control');
    }

    for (const option of this.options()) {
      const optionValue = this.optionValue(option);
      const active = valueMatches(value, optionValue) && value !== '';
      option.dataset.segmentedOption = '';
      option.dataset.segmentedValue = optionValue;
      option.setAttribute('role', 'radio');
      option.setAttribute('aria-checked', String(active));
      option.setAttribute('size', option.getAttribute('size') ?? 'md');
      if (active) {
        option.setAttribute('active', '');
        option.setAttribute('variant', option.getAttribute('variant') ?? variant);
        option.setAttribute('tone', option.getAttribute('tone') ?? tone);
      } else {
        option.removeAttribute('active');
      }
      if (disabled) {
        option.setAttribute('aria-disabled', 'true');
      } else {
        option.removeAttribute('aria-disabled');
      }
    }
  }

  private options() {
    return Array.from(this.children).filter((child): child is HTMLElement => child.localName === 'nodel-button');
  }

  private optionFromEvent(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return null;
    }

    const option = target.closest<HTMLElement>('nodel-button');
    return option && option.parentElement === this ? option : null;
  }

  private optionValue(option: HTMLElement) {
    return option.getAttribute('value') ?? option.getAttribute('arg') ?? option.textContent?.trim() ?? '';
  }

  private async selectOption(option: HTMLElement) {
    if (this.busy || this.hasAttribute('disabled')) {
      return;
    }

    const optionValue = this.optionValue(option);
    const currentValue = this.getAttribute('value') ?? '';
    const nextValue = currentValue === optionValue && this.hasAttribute('allow-deselect') ? '' : optionValue;
    const action = this.getAttribute('action')?.trim() ?? '';
    const payload = { arg: parseArg(nextValue, normalizeArgType(this.getAttribute('arg-type'))) };
    const confirmSource = shouldConfirm(option) ? option : this;

    if (shouldConfirm(confirmSource)) {
      const confirmed = await requestConfirm(confirmSource, confirmRequestFromAttributes(confirmSource, {
        title: 'Confirm selection',
        text: `Select ${option.textContent?.trim() || nextValue}?`,
        tone: 'info'
      }));
      if (!confirmed) {
        return;
      }
    }

    if (!action) {
      this.setAttribute('value', nextValue);
      this.dispatchChange(action, payload, nextValue);
      return;
    }

    this.busy = true;
    this.render();
    try {
      await callNodeAction(action, payload);
      this.setAttribute('value', nextValue);
      this.dispatchChange(action, payload, nextValue);
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to call action');
      this.dispatchEvent(new CustomEvent('nodel-segmented-error', {
        bubbles: true,
        detail: { action, value: nextValue, payload, error: message }
      }));
      this.showToast({ message: 'Failed to call action', detail: message, tone: 'danger', durationMs: 7000 });
    } finally {
      this.busy = false;
      if (this.isConnected) {
        this.render();
      }
    }
  }

  private dispatchChange(action: string, payload: { arg: unknown }, value: string) {
    this.dispatchEvent(new CustomEvent('nodel-segmented-change', {
      bubbles: true,
      detail: { action, value, arg: payload.arg, payload }
    }));
  }

  private setDisabledFromValue(value: string) {
    const normalized = value.trim().toLocaleLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes') {
      this.setAttribute('disabled', '');
    } else {
      this.removeAttribute('disabled');
    }
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      value: (value) => this.setAttribute('value', value),
      disabled: (value) => this.setDisabledFromValue(value),
      label: (value) => this.setAttribute('label', value)
    });
  }

  private showToast(detail: NodelToastDetail) {
    this.dispatchEvent(new CustomEvent<NodelToastDetail>(NODEL_TOAST, {
      bubbles: true,
      detail
    }));
  }

  private handleClick = (event: Event) => {
    const option = this.optionFromEvent(event);
    if (!option) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void this.selectOption(option);
  };
}

if (!customElements.get('nodel-segmented')) {
  customElements.define('nodel-segmented', NodelSegmented);
}
