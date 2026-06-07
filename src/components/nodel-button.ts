import { callNodeAction } from '../api/nodel-host-client';
import { createSignalBindingController } from '../data/signal-bindings';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';

type NodelButtonVariant = 'default' | 'primary' | 'success' | 'info' | 'warning' | 'danger' | 'ghost' | 'link';
type NodelButtonArgType = 'string' | 'number' | 'boolean' | 'json';
type NodelButtonLayout = 'inline' | 'stack';

const variants: NodelButtonVariant[] = ['default', 'primary', 'success', 'info', 'warning', 'danger', 'ghost', 'link'];
const argTypes: NodelButtonArgType[] = ['string', 'number', 'boolean', 'json'];
const layouts: NodelButtonLayout[] = ['inline', 'stack'];

const variantClasses: Record<NodelButtonVariant, string> = {
  default: '',
  primary: 'nodel-button-primary',
  success: 'nodel-button-success',
  info: 'nodel-button-info',
  warning: 'nodel-button-warning',
  danger: 'nodel-button-danger',
  ghost: 'nodel-button-ghost',
  link: 'nodel-button-link'
};

function normalizeVariant(value: string | null): NodelButtonVariant {
  return variants.includes(value as NodelButtonVariant) ? (value as NodelButtonVariant) : 'default';
}

function normalizeArgType(value: string | null): NodelButtonArgType {
  return argTypes.includes(value as NodelButtonArgType) ? (value as NodelButtonArgType) : 'string';
}

function normalizeLayout(value: string | null): NodelButtonLayout {
  return layouts.includes(value as NodelButtonLayout) ? (value as NodelButtonLayout) : 'inline';
}

function parseBoolean(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
}

function parseArg(value: string, type: NodelButtonArgType) {
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

function valueMatches(value: string, expected: string | null) {
  if (expected === null) {
    const normalized = value.trim().toLocaleLowerCase();
    return normalized === 'active' || normalized === 'on' || normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  return value === expected;
}

function apiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export class NodelButton extends HTMLElement {
  static observedAttributes = ['variant', 'layout', 'action', 'arg', 'arg-type', 'disabled', 'active', 'active-value', 'signal', 'signals', 'aria-label', 'aria-labelledby', 'title'];

  private shellReady = false;
  private buttonNode: HTMLButtonElement | null = null;
  private contentNode: HTMLElement | null = null;
  private defaultLabel = 'Button';
  private busy = false;
  private connected = false;
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

  attributeChangedCallback() {
    if (this.connected) {
      this.render();
      this.syncSignalSubscription();
    }
  }

  private render(label = this.currentLabel()) {
    this.ensureShell();
    const variant = normalizeVariant(this.getAttribute('variant'));
    const layout = normalizeLayout(this.getAttribute('layout'));
    const active = this.hasAttribute('active');
    const disabled = this.hasAttribute('disabled') || this.busy;
    const variantClass = variantClasses[variant] ? ` ${variantClasses[variant]}` : '';
    const stateClass = active ? ' is-active' : '';
    const busyClass = this.busy ? ' is-busy' : '';

    this.dataset.variant = variant;
    this.dataset.layout = layout;
    this.dataset.active = String(active);
    this.buttonNode!.className = `nodel-button nodel-button-touch${variantClass}${stateClass}${busyClass}`;
    this.buttonNode!.disabled = disabled;
    this.syncNativeButtonMetadata();

    if (active) {
      this.buttonNode!.setAttribute('aria-pressed', 'true');
    } else {
      this.buttonNode!.removeAttribute('aria-pressed');
    }

    if (!this.contentNode?.querySelector('[data-button-label]') && !this.contentNode?.hasChildNodes()) {
      this.setLabel(label);
    }
  }

  private syncNativeButtonMetadata() {
    for (const attribute of ['aria-label', 'aria-labelledby', 'title']) {
      const value = this.getAttribute(attribute);
      if (value) {
        this.buttonNode?.setAttribute(attribute, value);
      } else {
        this.buttonNode?.removeAttribute(attribute);
      }
    }
  }

  private currentLabel() {
    return this.contentNode?.querySelector('[data-button-label]')?.textContent ?? this.defaultLabel;
  }

  private ensureShell() {
    if (this.shellReady) {
      return;
    }

    const children = Array.from(this.childNodes);
    const textLabel = children.map((child) => child.nodeType === Node.TEXT_NODE ? child.textContent?.trim() ?? '' : '').filter(Boolean).join(' ').trim();
    this.defaultLabel = textLabel || this.getAttribute('aria-label') || 'Button';

    this.innerHTML = '<button type="button"><span data-button-content class="nodel-button-content"></span></button>';
    this.buttonNode = this.querySelector('button');
    this.contentNode = this.querySelector('[data-button-content]');
    this.shellReady = true;

    for (const child of children) {
      this.appendContentChild(child);
    }

    if (!this.contentNode?.hasChildNodes()) {
      this.setLabel(this.defaultLabel);
    }
  }

  private appendContentChild(child: Node) {
    if (!this.contentNode) {
      return;
    }

    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (!text.trim()) {
        return;
      }

      const label = document.createElement('span');
      label.dataset.buttonLabel = '';
      label.textContent = text.trim();
      this.contentNode.appendChild(label);
      return;
    }

    this.contentNode.appendChild(child);
  }

  private payload() {
    if (!this.hasAttribute('arg')) {
      return {};
    }

    const arg = parseArg(this.getAttribute('arg') ?? '', normalizeArgType(this.getAttribute('arg-type')));
    return { arg };
  }

  private async submitAction(action: string) {
    if (this.busy) {
      return;
    }

    const payload = this.payload();
    this.busy = true;
    this.render();

    try {
      await callNodeAction(action, payload);
      this.dispatchEvent(new CustomEvent('nodel-button-submitted', {
        bubbles: true,
        detail: { action, payload }
      }));
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to call action');
      this.dispatchEvent(new CustomEvent('nodel-button-error', {
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

  private setActiveFromValue(value: string) {
    const expected = this.getAttribute('active-value') ?? this.getAttribute('arg');
    if (valueMatches(value, expected)) {
      this.setAttribute('active', '');
    } else {
      this.removeAttribute('active');
    }
  }

  private setDisabledFromValue(value: string) {
    if (valueMatches(value, null)) {
      this.setAttribute('disabled', '');
    } else {
      this.removeAttribute('disabled');
    }
  }

  private setLabel(value: string) {
    this.ensureShell();
    const label = value || this.defaultLabel;
    const labels = Array.from(this.contentNode?.querySelectorAll<HTMLElement>('[data-button-label]') ?? []);

    if (labels.length === 0) {
      const labelNode = document.createElement('span');
      labelNode.dataset.buttonLabel = '';
      labelNode.textContent = label;
      this.contentNode?.appendChild(labelNode);
      return;
    }

    labels[0].textContent = label;
    for (const extra of labels.slice(1)) {
      extra.textContent = '';
    }
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'active', {
      active: (value) => this.setActiveFromValue(value),
      disabled: (value) => this.setDisabledFromValue(value),
      label: (value) => this.setLabel(value)
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

    const action = this.getAttribute('action')?.trim() ?? '';
    if (!action || this.hasAttribute('disabled')) {
      return;
    }

    event.preventDefault();
    void this.submitAction(action);
  };
}

if (!customElements.get('nodel-button')) {
  customElements.define('nodel-button', NodelButton);
}
