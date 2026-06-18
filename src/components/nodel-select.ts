import { callActionBindings, parseActionBindings } from '../data/action-bindings';
import { confirmRequestFromAttributes, requestConfirm, shouldConfirm } from '../data/confirm';
import { createSignalBindingController } from '../data/signal-bindings';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';
import { apiErrorMessage, formatBindingFailures, normalizeFromList, normalizeTone, normalizeVariant, parseTypedArg, truthy, type ControlArgType } from '../utils/control-values';
import './nodel-button';

type SelectArgType = ControlArgType;
const argTypes: SelectArgType[] = ['string', 'number', 'boolean', 'json'];

export class NodelSelect extends HTMLElement {
  static observedAttributes = ['label', 'placeholder', 'value', 'action', 'actions', 'join', 'arg-type', 'variant', 'tone', 'disabled', 'allow-deselect', 'open', 'signal', 'signals', 'confirm', 'confirm-title', 'confirm-text', 'confirm-label', 'cancel-label', 'confirm-tone'];

  private shellReady = false;
  private triggerNode: HTMLButtonElement | null = null;
  private labelNode: HTMLElement | null = null;
  private valueNode: HTMLElement | null = null;
  private panelNode: HTMLElement | null = null;
  private signalBindings = createSignalBindingController(this);

  connectedCallback() {
    this.ensureShell();
    this.render();
    this.syncSignalSubscription();
    this.triggerNode?.addEventListener('click', this.handleTriggerClick);
    this.addEventListener('click', this.handleOptionClick, true);
    this.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('pointerdown', this.handleDocumentPointerDown);
  }

  disconnectedCallback() {
    this.signalBindings.dispose();
    this.triggerNode?.removeEventListener('click', this.handleTriggerClick);
    this.removeEventListener('click', this.handleOptionClick, true);
    this.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown);
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
    this.innerHTML = `
      <button type="button" class="nodel-select-trigger" aria-haspopup="listbox">
        <span class="nodel-select-content">
          <span class="nodel-select-label" hidden></span>
          <span class="nodel-select-value"></span>
        </span>
        <span class="nodel-select-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="nodel-select-panel" role="listbox" hidden></div>
    `;
    this.triggerNode = this.querySelector('.nodel-select-trigger');
    this.labelNode = this.querySelector('.nodel-select-label');
    this.valueNode = this.querySelector('.nodel-select-value');
    this.panelNode = this.querySelector('.nodel-select-panel');
    for (const child of children) {
      if (child instanceof HTMLElement && child.localName === 'nodel-button') {
        this.panelNode?.appendChild(child);
      }
    }
    this.shellReady = true;
  }

  private options() {
    return Array.from(this.panelNode?.children ?? []).filter((child): child is HTMLElement => child.localName === 'nodel-button');
  }

  private optionValue(option: HTMLElement) {
    return option.getAttribute('value') ?? option.getAttribute('arg') ?? option.textContent?.trim() ?? '';
  }

  private selectedOption() {
    const value = this.getAttribute('value') ?? '';
    return this.options().find((option) => this.optionValue(option) === value) ?? null;
  }

  private displayValue() {
    const option = this.selectedOption();
    return option?.textContent?.trim() || this.getAttribute('value') || this.getAttribute('placeholder') || 'Select';
  }

  private render() {
    this.ensureShell();
    const variant = normalizeVariant(this.getAttribute('variant'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const disabled = this.hasAttribute('disabled');
    const open = this.hasAttribute('open');
    const label = this.getAttribute('label') ?? '';

    this.dataset.variant = variant;
    this.dataset.tone = tone;
    this.dataset.disabled = String(disabled);
    this.dataset.open = String(open);
    this.dataset.value = this.getAttribute('value') ?? '';
    this.triggerNode!.disabled = disabled;
    this.triggerNode!.setAttribute('aria-expanded', String(open));
    this.labelNode!.hidden = !label;
    this.labelNode!.textContent = label;
    this.valueNode!.textContent = this.displayValue();
    this.panelNode!.hidden = !open;
    if (label) {
      this.triggerNode!.setAttribute('aria-label', `${label}: ${this.displayValue()}`);
    }

    const value = this.getAttribute('value') ?? '';
    for (const option of this.options()) {
      const active = value !== '' && this.optionValue(option) === value;
      option.dataset.selectOption = '';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(active));
      option.setAttribute('size', option.getAttribute('size') ?? 'md');
      if (active) {
        option.setAttribute('active', '');
        option.setAttribute('variant', option.getAttribute('variant') ?? variant);
        option.setAttribute('tone', option.getAttribute('tone') ?? tone);
      } else {
        option.removeAttribute('active');
      }
    }
  }

  private async selectOption(option: HTMLElement) {
    if (this.hasAttribute('disabled')) {
      return;
    }
    const optionValue = this.optionValue(option);
    const currentValue = this.getAttribute('value') ?? '';
    const nextValue = currentValue === optionValue && this.hasAttribute('allow-deselect') ? '' : optionValue;
    const argType = normalizeFromList(this.getAttribute('arg-type'), argTypes, 'string');
    const payload = { arg: parseTypedArg(nextValue, argType) };
    const bindings = parseActionBindings({ action: this.getAttribute('action'), actions: this.getAttribute('actions'), join: this.getAttribute('join'), defaultPhase: 'select' });
    const action = this.getAttribute('action')?.trim() || this.getAttribute('join')?.trim() || '';
    const confirmSource = shouldConfirm(option) ? option : this;

    if (shouldConfirm(confirmSource)) {
      const confirmed = await requestConfirm(confirmSource, confirmRequestFromAttributes(confirmSource, { title: 'Confirm selection', text: `Select ${option.textContent?.trim() || nextValue}?`, tone: 'info' }));
      if (!confirmed) {
        return;
      }
    }

    if (bindings.length === 0) {
      this.setAttribute('value', nextValue);
      this.removeAttribute('open');
      this.dispatchChange(action, nextValue, payload);
      return;
    }

    try {
      const execution = await callActionBindings(bindings, 'select', payload);
      if (execution.failures.length > 0) {
        const detail = formatBindingFailures(execution.failures);
        this.dispatchEvent(new CustomEvent('nodel-select-error', { bubbles: true, detail: { action, value: nextValue, payload, failures: execution.failures, error: detail } }));
        this.showToast({ message: 'Failed to call action', detail, tone: 'danger', durationMs: 7000 });
        return;
      }
      this.setAttribute('value', nextValue);
      this.removeAttribute('open');
      this.dispatchChange(action, nextValue, payload, execution.results);
    } catch (error) {
      const message = apiErrorMessage(error, 'Failed to call action');
      this.dispatchEvent(new CustomEvent('nodel-select-error', { bubbles: true, detail: { action, value: nextValue, payload, error: message } }));
      this.showToast({ message: 'Failed to call action', detail: message, tone: 'danger', durationMs: 7000 });
    }
  }

  private dispatchChange(action: string, value: string, payload: { arg: unknown }, results: unknown[] = []) {
    this.dispatchEvent(new CustomEvent('nodel-select-change', { bubbles: true, detail: { action, value, arg: payload.arg, payload, results } }));
  }

  private syncSignalSubscription() {
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      disabled: (value) => truthy(value) ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'),
      label: (value) => this.setAttribute('label', value),
      value: (value) => this.setAttribute('value', value)
    }, { join: this.getAttribute('join'), aggregators: { disabled: { evaluate: truthy } } });
  }

  private optionFromEvent(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return null;
    }
    const option = target.closest<HTMLElement>('nodel-button');
    return option && option.parentElement === this.panelNode ? option : null;
  }

  private showToast(detail: NodelToastDetail) {
    this.dispatchEvent(new CustomEvent<NodelToastDetail>(NODEL_TOAST, { bubbles: true, detail }));
  }

  private handleTriggerClick = () => {
    if (!this.hasAttribute('disabled')) {
      this.toggleAttribute('open');
    }
  };

  private handleOptionClick = (event: Event) => {
    const option = this.optionFromEvent(event);
    if (!option) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void this.selectOption(option);
  };

  private handleDocumentPointerDown = (event: PointerEvent) => {
    if (this.hasAttribute('open') && !this.contains(event.target as Node)) {
      this.removeAttribute('open');
    }
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.removeAttribute('open');
    } else if ((event.key === 'Enter' || event.key === ' ') && event.target === this.triggerNode) {
      event.preventDefault();
      this.toggleAttribute('open');
    }
  };
}

if (!customElements.get('nodel-select')) {
  customElements.define('nodel-select', NodelSelect);
}
