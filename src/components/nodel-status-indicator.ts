import { createSignalBindingController } from '../data/signal-bindings';

type NodelStatusTone = 'success' | 'info' | 'warning' | 'danger';
type NodelStatusState = 'on' | 'off';

const truthyValues = new Set(['true', '1', 'on', 'yes', 'active', 'present', 'available', 'signal']);
const falseyValues = new Set(['', 'false', '0', 'off', 'no', 'inactive', 'absent']);

function normalizeTone(value: string | null): NodelStatusTone {
  return value === 'info' || value === 'warning' || value === 'danger' ? value : 'success';
}

function stateFromValue(value: string, onValue: string | null, offValue: string | null): NodelStatusState {
  const normalized = value.trim().toLocaleLowerCase();
  if (onValue !== null) {
    return value === onValue ? 'on' : 'off';
  }
  if (offValue !== null && value === offValue) {
    return 'off';
  }
  if (truthyValues.has(normalized)) {
    return 'on';
  }
  if (falseyValues.has(normalized)) {
    return 'off';
  }
  return 'off';
}

export class NodelStatusIndicator extends HTMLElement {
  static observedAttributes = ['signal', 'signals', 'value', 'on-value', 'off-value', 'tone', 'off-tone', 'label'];

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
    const state = stateFromValue(value, this.getAttribute('on-value'), this.getAttribute('off-value'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const offTone = this.getAttribute('off-tone') === 'muted' ? 'muted' : 'off';
    const label = this.getAttribute('label') ?? '';

    this.dataset.state = state;
    this.dataset.tone = tone;
    this.dataset.offTone = offTone;

    if (label) {
      this.setAttribute('role', 'status');
      this.setAttribute('aria-label', label);
      this.setAttribute('title', label);
      this.removeAttribute('aria-hidden');
    } else {
      this.removeAttribute('role');
      this.removeAttribute('aria-label');
      this.removeAttribute('title');
      this.setAttribute('aria-hidden', 'true');
    }

    this.innerHTML = '<span class="nodel-status-indicator-dot"></span>';
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
