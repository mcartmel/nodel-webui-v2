import { createSignalBindingController } from '../data/signal-bindings';
import { escapeHtml } from '../utils/html';
import { asciiToken } from '../utils/text-normalization';

type NodelStatusTone = 'success' | 'info' | 'warning' | 'danger';
type NodelStatusState = 'on' | 'off' | 'partially-on' | 'partially-off';

const truthyValues = new Set(['true', '1', 'on', 'yes', 'active', 'present', 'available', 'signal']);

function normalizeTone(value: string | null): NodelStatusTone {
  return value === 'info' || value === 'warning' || value === 'danger' ? value : 'success';
}

function stateFromValue(value: string, partialOnValue: string | null, partialOffValue: string | null, onValue: string | null, offValue: string | null): NodelStatusState {
  const normalized = asciiToken(value);
  if (partialOnValue !== null && value === partialOnValue) {
    return 'partially-on';
  }
  if (partialOffValue !== null && value === partialOffValue) {
    return 'partially-off';
  }
  if (onValue !== null && value === onValue) {
    return 'on';
  }
  if (offValue !== null && value === offValue) {
    return 'off';
  }
  if (truthyValues.has(normalized)) {
    return 'on';
  }
  return 'off';
}

export class NodelStatusIndicator extends HTMLElement {
  static observedAttributes = ['signal', 'signals', 'value', 'on-value', 'off-value', 'partial-on-value', 'partial-off-value', 'tone', 'off-tone', 'partial-tone', 'label', 'show-state-label', 'on-label', 'off-label', 'partial-on-label', 'partial-off-label'];

  private signalBindings = createSignalBindingController(this);

  connectedCallback() {
    this.render();
    this.syncSignalSubscription();
  }

  disconnectedCallback() {
    this.signalBindings.dispose();
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
      this.syncSignalSubscription();
    }
  }

  private render() {
    const value = this.getAttribute('value') ?? '';
    const state = stateFromValue(value, this.getAttribute('partial-on-value'), this.getAttribute('partial-off-value'), this.getAttribute('on-value'), this.getAttribute('off-value'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const partialToneValue = this.getAttribute('partial-tone');
    const partialTone = partialToneValue === 'success' || partialToneValue === 'info' || partialToneValue === 'danger' ? partialToneValue : 'warning';
    const offTone = this.getAttribute('off-tone') === 'muted' ? 'muted' : 'off';
    const label = this.getAttribute('label') ?? '';
    const showStateLabel = this.hasAttribute('show-state-label');
    const stateLabel = state === 'on' ? this.getAttribute('on-label') || 'On'
      : state === 'off' ? this.getAttribute('off-label') || 'Off'
        : state === 'partially-on' ? this.getAttribute('partial-on-label') || 'Partially on'
          : this.getAttribute('partial-off-label') || 'Partially off';

    this.dataset.state = state;
    this.dataset.tone = tone;
    this.dataset.offTone = offTone;
    this.dataset.partialTone = partialTone;
    this.dataset.stateLabel = stateLabel;

    if (label || showStateLabel) {
      this.setAttribute('role', 'status');
      if (label) {
        this.setAttribute('aria-label', label);
        this.setAttribute('title', label);
      } else {
        this.removeAttribute('aria-label');
        this.removeAttribute('title');
      }
      this.removeAttribute('aria-hidden');
    } else {
      this.removeAttribute('role');
      this.removeAttribute('aria-label');
      this.removeAttribute('title');
      this.setAttribute('aria-hidden', 'true');
    }

    this.innerHTML = `<span class="nodel-status-indicator-dot" aria-hidden="true"></span>${showStateLabel ? `<span class="nodel-status-indicator-label">${escapeHtml(stateLabel)}</span>` : ''}`;
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      label: (value) => this.setSignalAttribute('label', value),
      value: (value) => this.setSignalAttribute('value', value)
    });
  }

  private setSignalAttribute(name: string, value: string) {
    if (value) {
      this.setAttribute(name, value);
    } else if (name === 'value') {
      this.setAttribute(name, '');
    } else {
      this.removeAttribute(name);
    }
  }

}

if (!customElements.get('nodel-status-indicator')) {
  customElements.define('nodel-status-indicator', NodelStatusIndicator);
}
