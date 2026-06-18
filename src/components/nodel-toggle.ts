import { callActionBindings, parseActionBindings } from '../data/action-bindings';
import { confirmRequestFromAttributes, requestConfirm, shouldConfirm } from '../data/confirm';
import { createSignalBindingController } from '../data/signal-bindings';
import { isToggleOnish, resolveToggleState, toggleAriaChecked, type ToggleState } from '../utils/toggle-state';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';

type NodelToggleVariant = 'default' | 'primary' | 'success' | 'info' | 'warning' | 'danger';
type NodelToggleTone = 'solid' | 'soft' | 'outline';
type NodelToggleArgType = 'string' | 'number' | 'boolean' | 'json';
type NodelToggleStateLabel = 'show' | 'hide';

const variants: NodelToggleVariant[] = ['default', 'primary', 'success', 'info', 'warning', 'danger'];
const tones: NodelToggleTone[] = ['solid', 'soft', 'outline'];
const argTypes: NodelToggleArgType[] = ['string', 'number', 'boolean', 'json'];
const stateLabels: NodelToggleStateLabel[] = ['show', 'hide'];

function normalizeVariant(value: string | null): NodelToggleVariant {
  return variants.includes(value as NodelToggleVariant) ? (value as NodelToggleVariant) : 'success';
}

function normalizeOffVariant(value: string | null): NodelToggleVariant {
  return variants.includes(value as NodelToggleVariant) ? (value as NodelToggleVariant) : 'default';
}

function normalizeTone(value: string | null): NodelToggleTone {
  return tones.includes(value as NodelToggleTone) ? (value as NodelToggleTone) : 'solid';
}

function normalizeArgType(value: string | null): NodelToggleArgType {
  return argTypes.includes(value as NodelToggleArgType) ? (value as NodelToggleArgType) : 'boolean';
}

function normalizeStateLabel(value: string | null): NodelToggleStateLabel {
  return stateLabels.includes(value as NodelToggleStateLabel) ? (value as NodelToggleStateLabel) : 'hide';
}

function parseBoolean(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
}

function parseArg(value: string, type: NodelToggleArgType) {
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

export class NodelToggle extends HTMLElement {
  static observedAttributes = [
    'action', 'actions', 'join', 'on-arg', 'off-arg', 'arg-type', 'signal', 'signals', 'value', 'on-value', 'off-value',
    'partial-on-value', 'partial-off-value', 'label', 'on-label', 'off-label', 'state-label', 'variant', 'off-variant', 'tone',
    'disabled', 'confirm', 'confirm-title', 'confirm-text', 'confirm-label', 'cancel-label', 'confirm-tone',
    'aria-label', 'aria-labelledby', 'title'
  ];

  private buttonNode: HTMLButtonElement | null = null;
  private labelNode: HTMLElement | null = null;
  private stateNode: HTMLElement | null = null;
  private busy = false;
  private connected = false;
  private state: ToggleState = 'off';
  private signalBindings = createSignalBindingController(this);

  connectedCallback() {
    this.connected = true;
    this.ensureShell();
    this.render();
    this.syncSignalSubscription();
    this.addEventListener('click', this.handleClick);
  }

  disconnectedCallback() {
    this.connected = false;
    this.removeEventListener('click', this.handleClick);
    this.signalBindings.dispose();
  }

  attributeChangedCallback(name: string) {
    if (name === 'value') {
      this.state = this.stateFromValue(this.getAttribute('value') ?? '');
    }

    if (this.connected) {
      this.render();
      this.syncSignalSubscription();
    }
  }

  private ensureShell() {
    if (this.buttonNode) {
      return;
    }

    const initialText = Array.from(this.childNodes)
      .map((child) => child.nodeType === Node.TEXT_NODE ? child.textContent?.trim() ?? '' : '')
      .filter(Boolean)
      .join(' ')
      .trim();
    if (initialText && !this.hasAttribute('label')) {
      this.setAttribute('label', initialText);
    }

    this.innerHTML = `
      <button type="button" class="nodel-toggle" role="switch">
        <span class="nodel-toggle-label" data-toggle-label></span>
        <span class="nodel-toggle-track" aria-hidden="true"><span class="nodel-toggle-thumb"></span></span>
        <span class="nodel-toggle-state" data-toggle-state></span>
      </button>
    `;
    this.buttonNode = this.querySelector('button');
    this.labelNode = this.querySelector('[data-toggle-label]');
    this.stateNode = this.querySelector('[data-toggle-state]');
  }

  private render() {
    this.ensureShell();
    const variant = normalizeVariant(this.getAttribute('variant'));
    const offVariant = normalizeOffVariant(this.getAttribute('off-variant'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const stateLabelMode = normalizeStateLabel(this.getAttribute('state-label'));
    const disabled = this.hasAttribute('disabled') || this.busy;
    const label = this.getAttribute('label') || this.getAttribute('aria-label') || 'Toggle';
    const onLabel = this.getAttribute('on-label') || 'On';
    const offLabel = this.getAttribute('off-label') || 'Off';
    const stateLabel = isToggleOnish(this.state) ? onLabel : offLabel;

    this.dataset.state = this.state;
    this.dataset.variant = variant;
    this.dataset.offVariant = offVariant;
    this.dataset.tone = tone;
    this.dataset.stateLabel = stateLabelMode;
    this.dataset.disabled = String(disabled);

    this.buttonNode!.className = `nodel-toggle${this.busy ? ' is-busy' : ''}`;
    this.buttonNode!.disabled = disabled;
    this.buttonNode!.setAttribute('aria-checked', toggleAriaChecked(this.state));
    this.buttonNode!.setAttribute('aria-label', this.getAttribute('aria-label') || label);

    for (const attribute of ['aria-labelledby', 'title']) {
      const value = this.getAttribute(attribute);
      if (value) {
        this.buttonNode!.setAttribute(attribute, value);
      } else {
        this.buttonNode!.removeAttribute(attribute);
      }
    }

    if (this.labelNode) {
      this.labelNode.textContent = label;
    }
    if (this.stateNode) {
      this.stateNode.hidden = stateLabelMode !== 'show';
      this.stateNode.textContent = stateLabelMode === 'show'
        ? (this.state.startsWith('partially-') ? `Partial ${stateLabel}` : stateLabel)
        : '';
    }
  }

  private payloadFor(nextOn: boolean) {
    const raw = nextOn
      ? this.getAttribute('on-arg') ?? 'true'
      : this.getAttribute('off-arg') ?? 'false';
    return { arg: parseArg(raw, normalizeArgType(this.getAttribute('arg-type'))) };
  }

  private async submitAction(action: string) {
    if (this.busy) {
      return;
    }

    const nextOn = !isToggleOnish(this.state);
    const payload = this.payloadFor(nextOn);
    const bindings = parseActionBindings({
      action: this.getAttribute('action'),
      actions: this.getAttribute('actions'),
      join: this.getAttribute('join'),
      defaultPhase: 'toggle'
    });
    if (shouldConfirm(this)) {
      const confirmed = await requestConfirm(this, confirmRequestFromAttributes(this, {
        title: 'Confirm toggle',
        text: `Set ${this.getAttribute('label') || 'toggle'} ${nextOn ? 'on' : 'off'}?`,
        tone: nextOn ? 'success' : 'info'
      }));
      if (!confirmed) {
        return;
      }
    }

    this.busy = true;
    this.render();

    try {
      const toggleExecution = await callActionBindings(bindings, 'toggle', payload);
      const stateExecution = await callActionBindings(bindings, nextOn ? 'on' : 'off', payload);
      const failures = [...toggleExecution.failures, ...stateExecution.failures];
      if (failures.length > 0) {
        const detail = failures.length === 1
          ? failures[0].error ?? 'Failed to call action'
          : failures.map((failure) => `${failure.action}: ${failure.error}`).join('; ');
        this.dispatchEvent(new CustomEvent('nodel-toggle-error', {
          bubbles: true,
          detail: { action, payload, failures, error: detail }
        }));
        this.showToast({ message: 'Failed to call action', detail, tone: 'danger', durationMs: 7000 });
        return;
      }
      this.dispatchEvent(new CustomEvent('nodel-toggle-change', {
        bubbles: true,
        detail: { action, state: nextOn ? 'on' : 'off', arg: payload.arg, payload, results: [...toggleExecution.results, ...stateExecution.results] }
      }));
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to call action');
      this.dispatchEvent(new CustomEvent('nodel-toggle-error', {
        bubbles: true,
        detail: { action, payload, error: message }
      }));
      this.showToast({ message: 'Failed to call action', detail: message, tone: 'danger', durationMs: 7000 });
    } finally {
      this.busy = false;
      if (this.isConnected) {
        this.render();
      }
    }
  }

  private stateFromValue(value: string) {
    return resolveToggleState(value, {
      onValue: this.getAttribute('on-value'),
      offValue: this.getAttribute('off-value'),
      partialOnValue: this.getAttribute('partial-on-value'),
      partialOffValue: this.getAttribute('partial-off-value')
    });
  }

  private setStateFromValue(value: string) {
    this.state = this.stateFromValue(value);
    this.setAttribute('value', value);
    this.render();
  }

  private setDisabledFromValue(value: string) {
    const disabled = resolveToggleState(value) === 'on';
    if (disabled) {
      this.setAttribute('disabled', '');
    } else {
      this.removeAttribute('disabled');
    }
  }

  private setLabel(value: string) {
    this.setAttribute('label', value);
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'state', {
      state: (value) => this.setStateFromValue(value),
      disabled: (value) => this.setDisabledFromValue(value),
      label: (value) => this.setLabel(value)
    }, {
      join: this.getAttribute('join'),
      aggregators: {
        disabled: { evaluate: (value) => resolveToggleState(value) === 'on' }
      }
    });
  }

  private showToast(detail: NodelToastDetail) {
    this.dispatchEvent(new CustomEvent<NodelToastDetail>(NODEL_TOAST, {
      bubbles: true,
      detail
    }));
  }

  private handleClick = (event: Event) => {
    if (event.target !== this.buttonNode && !this.buttonNode?.contains(event.target as Node)) {
      return;
    }

    const action = this.getAttribute('action')?.trim() || this.getAttribute('join')?.trim() || '';
    const bindings = parseActionBindings({ action: this.getAttribute('action'), actions: this.getAttribute('actions'), join: this.getAttribute('join'), defaultPhase: 'toggle' });
    if (bindings.length === 0 || this.hasAttribute('disabled')) {
      return;
    }

    event.preventDefault();
    void this.submitAction(action);
  };
}

if (!customElements.get('nodel-toggle')) {
  customElements.define('nodel-toggle', NodelToggle);
}
