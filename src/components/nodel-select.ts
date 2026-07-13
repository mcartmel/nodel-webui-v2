import { callActionBindings, parseActionBindings } from '../data/action-bindings';
import { confirmRequestFromAttributes, requestConfirm, shouldConfirm } from '../data/confirm';
import { DynamicOptionsController, type DynamicOptionsState } from '../data/dynamic-options';
import { createSignalBindingController, parseSignalBindings, signalBindingKey } from '../data/signal-bindings';
import { NODEL_TOAST, type NodelToastDetail } from './nodel-toast-host';
import { apiErrorMessage, formatBindingFailures, normalizeFromList, normalizeTone, normalizeVariant, parseTypedArg, truthy, type ControlArgType } from '../utils/control-values';
import './nodel-button';

type SelectArgType = ControlArgType;
const argTypes: SelectArgType[] = ['string', 'number', 'boolean', 'json'];
let selectIdCounter = 0;

export class NodelSelect extends HTMLElement {
  static observedAttributes = ['label', 'aria-label', 'aria-labelledby', 'placeholder', 'value', 'action', 'actions', 'join', 'arg-type', 'variant', 'tone', 'disabled', 'allow-deselect', 'open', 'signal', 'signals', 'options-signal', 'options-loading-label', 'options-empty-label', 'options-error-label', 'confirm', 'confirm-title', 'confirm-text', 'confirm-label', 'cancel-label', 'confirm-tone'];

  private shellReady = false;
  private triggerNode: HTMLButtonElement | null = null;
  private valueNode: HTMLElement | null = null;
  private panelNode: HTMLElement | null = null;
  private statusNode: HTMLElement | null = null;
  private valueId = '';
  private signalBindings = createSignalBindingController(this);
  private dynamicOptions: DynamicOptionsController | null = null;
  private optionsState: DynamicOptionsState = 'static';
  private optionsBindingKey = '';
  private optionsSourceError = false;

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
    this.dynamicOptions?.dispose();
    this.optionsBindingKey = '';
    this.optionsSourceError = false;
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
    this.valueId = `nodel-select-value-${++selectIdCounter}`;
    this.innerHTML = `
      <button type="button" class="nodel-select-trigger" aria-haspopup="listbox">
        <span class="nodel-select-content">
          <span class="nodel-select-value" id="${this.valueId}"></span>
        </span>
        <span class="nodel-select-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="nodel-select-panel" role="listbox" hidden></div>
      <div class="nodel-options-status" aria-live="polite" hidden></div>
    `;
    this.triggerNode = this.querySelector('.nodel-select-trigger');
    this.valueNode = this.querySelector('.nodel-select-value');
    this.panelNode = this.querySelector('.nodel-select-panel');
    this.statusNode = this.querySelector('.nodel-options-status');
    for (const child of children) {
      if (child instanceof HTMLElement && child.localName === 'nodel-button') {
        this.panelNode?.appendChild(child);
      }
    }
    this.dynamicOptions = new DynamicOptionsController(this.panelNode!, (option) => {
      const node = document.createElement('nodel-button');
      node.setAttribute('value', option.value);
      node.textContent = option.label;
      return node;
    });
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
    const fallbackOption = this.optionsState === 'loading' && this.dynamicOptions?.hasFallbackOptions() ? this.options()[0] : null;
    return option?.textContent?.trim() || this.getAttribute('value') || this.getAttribute('placeholder') || fallbackOption?.textContent?.trim() || this.stateLabel() || 'Select';
  }

  private stateLabel() {
    if (this.optionsState === 'loading') {
      return this.getAttribute('options-loading-label') || 'Loading options...';
    }
    if (this.optionsState === 'empty') {
      return this.getAttribute('options-empty-label') || 'No options';
    }
    if (this.optionsState === 'error') {
      return this.getAttribute('options-error-label') || 'Options unavailable';
    }
    return '';
  }

  private hasInteractiveOptions() {
    return this.options().length > 0;
  }

  private render() {
    this.ensureShell();
    const variant = normalizeVariant(this.getAttribute('variant'));
    const tone = normalizeTone(this.getAttribute('tone'));
    const disabled = this.hasAttribute('disabled');
    const effectivelyUnavailable = !disabled && this.hasOptionsBinding() && !this.hasInteractiveOptions();
    const open = this.hasAttribute('open');
    const label = this.getAttribute('label') ?? '';
    const displayValue = this.displayValue();

    this.dataset.variant = variant;
    this.dataset.tone = tone;
    this.dataset.disabled = String(disabled);
    this.dataset.optionsState = this.optionsState;
    this.dataset.open = String(open);
    this.dataset.value = this.getAttribute('value') ?? '';
    this.triggerNode!.disabled = disabled;
    if (effectivelyUnavailable) {
      this.triggerNode!.setAttribute('aria-disabled', 'true');
    } else {
      this.triggerNode!.removeAttribute('aria-disabled');
    }
    this.triggerNode!.setAttribute('aria-expanded', String(open));
    this.valueNode!.textContent = displayValue;
    this.panelNode!.hidden = !open;
    this.syncStatus();
    this.syncTriggerAccessibility(label, displayValue);

    const value = this.getAttribute('value') ?? '';
    const options = this.options();
    const selected = options.find((option) => value !== '' && this.optionValue(option) === value) ?? null;
    const tabbable = open ? selected ?? options[0] ?? null : null;
    for (const option of options) {
      const active = value !== '' && this.optionValue(option) === value;
      option.dataset.selectOption = '';
      option.setAttribute('data-nodel-native-role', 'option');
      option.setAttribute('data-nodel-native-aria-selected', String(active));
      option.setAttribute('data-nodel-native-tabindex', open && option === tabbable ? '0' : '-1');
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

  private syncStatus() {
    if (!this.statusNode) {
      return;
    }
    const label = this.stateLabel();
    const showStatus = Boolean(label) && !(this.optionsState === 'loading' && this.dynamicOptions?.hasFallbackOptions());
    this.statusNode.textContent = showStatus ? label : '';
    this.statusNode.hidden = !showStatus;
    this.statusNode.dataset.state = this.optionsState;
  }

  private syncTriggerAccessibility(label: string, displayValue: string) {
    const labelledBy = this.getAttribute('aria-labelledby');
    if (labelledBy) {
      this.triggerNode!.setAttribute('aria-labelledby', `${labelledBy} ${this.valueId}`);
      this.triggerNode!.removeAttribute('aria-label');
      this.panelNode!.setAttribute('aria-labelledby', labelledBy);
      this.panelNode!.removeAttribute('aria-label');
      return;
    }

    this.triggerNode!.removeAttribute('aria-labelledby');
    this.panelNode!.removeAttribute('aria-labelledby');
    const baseLabel = this.getAttribute('aria-label') ?? label;
    if (baseLabel) {
      this.triggerNode!.setAttribute('aria-label', `${baseLabel}: ${displayValue}`);
      this.panelNode!.setAttribute('aria-label', `${baseLabel} options`);
    } else {
      this.triggerNode!.removeAttribute('aria-label');
      this.panelNode!.setAttribute('aria-label', 'Options');
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
    const nextOptionsBindingKey = this.optionsBindingIdentity();
    const hasOptionsBinding = nextOptionsBindingKey !== '';
    const optionsBindingChanged = nextOptionsBindingKey !== this.optionsBindingKey;
    if (optionsBindingChanged) {
      if (this.optionsBindingKey !== '' || nextOptionsBindingKey === '') {
        this.dynamicOptions?.clear();
      }
      this.optionsSourceError = false;
      this.optionsBindingKey = nextOptionsBindingKey;
    }
    const nextState = this.dynamicOptions?.setBindingActive(hasOptionsBinding) ?? 'static';
    this.setOptionsState(this.optionsSourceError && hasOptionsBinding ? 'error' : nextState);
    this.signalBindings.sync(this.getAttribute('signal'), this.getAttribute('signals'), 'value', {
      disabled: (value) => truthy(value) ? this.setAttribute('disabled', '') : this.removeAttribute('disabled'),
      label: (value) => this.setAttribute('label', value),
      options: (_value, rawValue) => this.applyDynamicOptions(rawValue),
      value: (value) => this.setAttribute('value', value)
    }, {
      join: this.getAttribute('join'),
      optionsSignal: this.getAttribute('options-signal'),
      aggregators: { disabled: { evaluate: truthy } },
      onSourceState: (state) => {
        if (!this.hasOptionsBinding()) {
          return;
        }
        if (state.error) {
          this.optionsSourceError = true;
          this.setOptionsState('error');
          this.render();
        } else if (state.loading && this.dynamicOptions?.getState() === 'loading') {
          this.optionsSourceError = false;
          this.setOptionsState('loading');
          this.render();
        } else {
          this.optionsSourceError = false;
          this.setOptionsState(this.dynamicOptions?.getState() ?? 'static');
          this.render();
        }
      }
    });
    if (optionsBindingChanged) {
      this.render();
    }
  }

  private hasOptionsBinding() {
    return this.optionsBindingIdentity() !== '';
  }

  private optionsBindingIdentity() {
    return signalBindingKey(parseSignalBindings(null, this.getAttribute('signals'), undefined, null, this.getAttribute('options-signal')).filter((binding) => binding.target === 'options' && binding.mode === 'last'));
  }

  private setOptionsState(state: DynamicOptionsState) {
    this.optionsState = state;
    this.dataset.optionsState = state;
    if (state === 'empty') {
      this.removeAttribute('open');
    }
    this.syncStatus();
  }

  private applyDynamicOptions(rawValue: unknown) {
    const result = this.dynamicOptions!.applyPayload(rawValue);
    this.setOptionsState(result.state);
    if (result.ok) {
      if (result.removedFocused) {
        this.removeAttribute('open');
        this.triggerNode?.focus();
      } else if (result.retainedFocused) {
        this.focusOption(this.options().find((option) => this.optionValue(option) === result.previousFocusedValue));
      }
      this.dispatchEvent(new CustomEvent('nodel-options-updated', { bubbles: true, detail: { count: result.count, state: result.state } }));
    } else {
      this.dispatchEvent(new CustomEvent('nodel-options-error', { bubbles: true, detail: { message: result.issues[0]?.message ?? 'Invalid options payload', issues: result.issues } }));
    }
    this.render();
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
    if (!this.hasAttribute('disabled') && this.hasInteractiveOptions()) {
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
    const targetOption = this.optionFromEvent(event);
    if (event.key === 'Escape') {
      this.removeAttribute('open');
      if (targetOption) {
        this.triggerNode?.focus();
      }
    } else if ((event.key === 'Enter' || event.key === ' ') && event.target === this.triggerNode) {
      event.preventDefault();
      if (this.hasInteractiveOptions()) {
        this.toggleAttribute('open');
        if (this.hasAttribute('open')) {
          this.focusOption(this.selectedOption() ?? this.options()[0]);
        }
      }
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.target === this.triggerNode) {
      event.preventDefault();
      if (this.hasInteractiveOptions()) {
        this.setAttribute('open', '');
        const options = this.options();
        this.focusOption(this.selectedOption() ?? (event.key === 'ArrowUp' ? options[options.length - 1] : options[0]));
      }
    } else if (targetOption && this.hasAttribute('open')) {
      this.handleOptionKeyDown(event, targetOption);
    }
  };

  private handleOptionKeyDown(event: KeyboardEvent, option: HTMLElement) {
    const options = this.options();
    const currentIndex = options.indexOf(option);
    if (event.key === 'Tab') {
      this.removeAttribute('open');
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void this.selectOption(option);
      return;
    }
    const keyOffsets: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    if (event.key in keyOffsets) {
      event.preventDefault();
      const nextIndex = (currentIndex + keyOffsets[event.key] + options.length) % options.length;
      this.focusOption(options[nextIndex]);
    } else if (event.key === 'Home') {
      event.preventDefault();
      this.focusOption(options[0]);
    } else if (event.key === 'End') {
      event.preventDefault();
      this.focusOption(options[options.length - 1]);
    }
  }

  private focusOption(option: HTMLElement | null | undefined) {
    if (!option) {
      return;
    }
    for (const item of this.options()) {
      item.setAttribute('data-nodel-native-tabindex', item === option ? '0' : '-1');
    }
    (option.querySelector('button') as HTMLButtonElement | null)?.focus();
  }
}

if (!customElements.get('nodel-select')) {
  customElements.define('nodel-select', NodelSelect);
}
